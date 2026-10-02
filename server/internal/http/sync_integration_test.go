package httpserver_test

// 同步接口的集成测试：覆盖 docs/architecture.md §5.2 “谁新谁赢”的每一种情况。

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func doc(text string) map[string]any {
	return map[string]any{"type": "doc", "content": []any{
		map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": text}}},
	}}
}

func noteData(text string) map[string]any {
	return map[string]any{
		"content": doc(text), "color": "lemon", "pos_x": 10, "pos_y": 20, "width": 220, "height": 200,
		"z_index": 1, "pinned": false, "archived": false,
	}
}

type change struct {
	id      string
	base    int64
	at      time.Time
	deleted bool
	text    string
}

func (e *env) push(token string, cs ...change) resp {
	e.t.Helper()
	items := make([]any, len(cs))
	for i, c := range cs {
		m := map[string]any{"id": c.id, "base_version": c.base, "updated_at": c.at.UTC().Format(time.RFC3339Nano), "deleted": c.deleted}
		if !c.deleted {
			m["data"] = noteData(c.text)
		}
		items[i] = m
	}
	r := e.do("POST", "/sync/push", token, map[string]any{"notes": items})
	expectStatus(e.t, r, 200)
	return r
}

func (e *env) pull(token string, since int64, limit int) resp {
	e.t.Helper()
	q := fmt.Sprintf("/sync/pull?since=%d", since)
	if limit > 0 {
		q += fmt.Sprintf("&limit=%d", limit)
	}
	r := e.do("GET", q, token, nil)
	expectStatus(e.t, r, 200)
	return r
}

type result struct {
	status  string
	version int64
	text    string
	deleted bool
	hasNote bool
}

func results(t *testing.T, r resp) []result {
	t.Helper()
	var out []result
	for _, x := range r.body["results"].([]any) {
		m := x.(map[string]any)
		res := result{status: m["status"].(string)}
		if n, ok := m["note"].(map[string]any); ok {
			res.hasNote = true
			res.version = int64(n["version"].(float64))
			res.text = noteText(n)
			res.deleted = n["deleted_at"] != nil
		}
		out = append(out, res)
	}
	return out
}

func noteText(n map[string]any) string {
	b, _ := json.Marshal(n["data"].(map[string]any)["content"])
	var d struct {
		Content []struct {
			Content []struct{ Text string } `json:"content"`
		} `json:"content"`
	}
	_ = json.Unmarshal(b, &d)
	if len(d.Content) == 0 || len(d.Content[0].Content) == 0 {
		return ""
	}
	return d.Content[0].Content[0].Text
}

func one(t *testing.T, r resp) result {
	t.Helper()
	rs := results(t, r)
	if len(rs) != 1 {
		t.Fatalf("results = %v", r.body)
	}
	return rs[0]
}

func TestSyncRequiresAuth(t *testing.T) {
	e := newEnv(t)
	expectProblem(t, e.do("GET", "/sync/pull?since=0", "", nil), 401, "unauthorized")
	expectProblem(t, e.do("POST", "/sync/push", "", map[string]any{"notes": []any{}}), 401, "unauthorized")
}

func TestSyncNewNoteRoundTrip(t *testing.T) {
	e := newEnv(t)
	s := e.register(uniqueEmail(), "correct horse")
	id := uuid.Must(uuid.NewV7()).String()

	r := one(t, e.push(s.access, change{id: id, at: e.clock.Now(), text: "买牛奶"}))
	if r.status != "applied" || r.version != 1 || r.text != "买牛奶" {
		t.Fatalf("push new: %+v", r)
	}

	p := e.pull(s.access, 0, 0)
	notes := p.body["notes"].([]any)
	if len(notes) != 1 || noteText(notes[0].(map[string]any)) != "买牛奶" {
		t.Fatalf("pull: %v", p.body)
	}
	if p.body["server_version"].(float64) != 1 || p.body["has_more"] != false {
		t.Fatalf("pull meta: %v", p.body)
	}
	// 游标之后没有变化
	if got := e.pull(s.access, 1, 0).body["notes"].([]any); len(got) != 0 {
		t.Fatalf("pull since 1: %v", got)
	}
}

// 本地改过、服务端没变：客户端新，即使本地时钟落后也写入
func TestSyncClientNewerWhenServerUnchanged(t *testing.T) {
	e := newEnv(t)
	s := e.register(uniqueEmail(), "correct horse")
	id := uuid.Must(uuid.NewV7()).String()
	t0 := e.clock.Now()
	v1 := one(t, e.push(s.access, change{id: id, at: t0, text: "v1"})).version

	r := one(t, e.push(s.access, change{id: id, base: v1, at: t0.Add(-time.Hour), text: "v2"}))
	if r.status != "applied" || r.text != "v2" || r.version <= v1 {
		t.Fatalf("%+v", r)
	}
}

// 服务端变了、本地也改了：比较编辑时间
func TestSyncBothChangedLaterEditWins(t *testing.T) {
	e := newEnv(t)
	s := e.register(uniqueEmail(), "correct horse")
	id := uuid.Must(uuid.NewV7()).String()
	t0 := e.clock.Now()
	v1 := one(t, e.push(s.access, change{id: id, at: t0, text: "原文"})).version

	// 设备 B 在 t0+2m 改了
	e.clock.Advance(5 * time.Minute)
	vB := one(t, e.push(s.access, change{id: id, base: v1, at: t0.Add(2 * time.Minute), text: "B 改的"})).version

	// 设备 A 离线时在 t0+1m 改过（更早）：服务端新，返回 B 的版本
	r := one(t, e.push(s.access, change{id: id, base: v1, at: t0.Add(1 * time.Minute), text: "A 改的"}))
	if r.status != "stale" || r.text != "B 改的" || r.version != vB {
		t.Fatalf("older edit should be stale: %+v", r)
	}

	// 设备 C 离线时在 t0+3m 改过（更晚）：客户端新，覆盖
	r = one(t, e.push(s.access, change{id: id, base: v1, at: t0.Add(3 * time.Minute), text: "C 改的"}))
	if r.status != "applied" || r.text != "C 改的" || r.version <= vB {
		t.Fatalf("later edit should win: %+v", r)
	}
}

func TestSyncDeleteAndResurrect(t *testing.T) {
	e := newEnv(t)
	s := e.register(uniqueEmail(), "correct horse")
	id := uuid.Must(uuid.NewV7()).String()
	t0 := e.clock.Now()
	v1 := one(t, e.push(s.access, change{id: id, at: t0, text: "要删的"})).version

	e.clock.Advance(10 * time.Minute)
	del := one(t, e.push(s.access, change{id: id, base: v1, at: t0.Add(time.Minute), deleted: true}))
	if del.status != "applied" || !del.deleted {
		t.Fatalf("delete: %+v", del)
	}
	// 删除会出现在拉取结果里，其他设备据此删除本地副本
	p := e.pull(s.access, v1, 0).body["notes"].([]any)
	if len(p) != 1 || p[0].(map[string]any)["deleted_at"] == nil {
		t.Fatalf("pull after delete: %v", p)
	}

	// 早于删除的离线编辑：服务端新（已删除）
	stale := one(t, e.push(s.access, change{id: id, base: v1, at: t0.Add(30 * time.Second), text: "旧编辑"}))
	if stale.status != "stale" || !stale.deleted {
		t.Fatalf("edit older than delete: %+v", stale)
	}
	// 晚于删除的编辑：复活
	back := one(t, e.push(s.access, change{id: id, base: v1, at: t0.Add(2 * time.Minute), text: "复活了"}))
	if back.status != "applied" || back.deleted || back.text != "复活了" {
		t.Fatalf("resurrect: %+v", back)
	}
}

func TestSyncDeleteNeverUploadedNote(t *testing.T) {
	e := newEnv(t)
	s := e.register(uniqueEmail(), "correct horse")
	r := one(t, e.push(s.access, change{id: uuid.Must(uuid.NewV7()).String(), at: e.clock.Now(), deleted: true}))
	if r.status != "applied" || r.hasNote {
		t.Fatalf("%+v", r)
	}
	if e.pull(s.access, 0, 0).body["server_version"].(float64) != 0 {
		t.Fatal("deleting an unknown note must not create anything")
	}
}

func TestSyncUsersAreIsolated(t *testing.T) {
	e := newEnv(t)
	alice := e.register(uniqueEmail(), "correct horse")
	bob := e.register(uniqueEmail(), "correct horse")
	id := uuid.Must(uuid.NewV7()).String()
	one(t, e.push(alice.access, change{id: id, at: e.clock.Now(), text: "alice 的"}))

	// bob 用同一个 id 推送（无论是改还是删）都不会动到 alice 的便利贴
	for _, c := range []change{
		{id: id, base: 1, at: e.clock.Now().Add(time.Hour), text: "bob 想改"},
		{id: id, base: 1, at: e.clock.Now().Add(time.Hour), deleted: true},
	} {
		if r := one(t, e.push(bob.access, c)); r.status != "invalid" || r.hasNote {
			t.Fatalf("bob push: %+v", r)
		}
	}
	if got := e.pull(bob.access, 0, 0).body["notes"].([]any); len(got) != 0 {
		t.Fatalf("bob must not see alice's notes: %v", got)
	}
	a := e.pull(alice.access, 0, 0).body["notes"].([]any)
	if len(a) != 1 || noteText(a[0].(map[string]any)) != "alice 的" || a[0].(map[string]any)["deleted_at"] != nil {
		t.Fatalf("alice's note changed: %v", a)
	}
}

// 时钟走快的设备不能永远胜出
func TestSyncClampsFutureTimestamps(t *testing.T) {
	e := newEnv(t)
	s := e.register(uniqueEmail(), "correct horse")
	id := uuid.Must(uuid.NewV7()).String()
	now := e.clock.Now()
	v1 := one(t, e.push(s.access, change{id: id, at: now.Add(24 * time.Hour), text: "未来设备"})).version

	e.clock.Advance(time.Minute)
	r := one(t, e.push(s.access, change{id: id, base: 0, at: now.Add(30 * time.Second), text: "正常设备"}))
	if r.status != "applied" || r.version <= v1 {
		t.Fatalf("future timestamp should have been clamped: %+v", r)
	}
}

func TestSyncValidation(t *testing.T) {
	e := newEnv(t)
	s := e.register(uniqueEmail(), "correct horse")
	now := e.clock.Now().UTC().Format(time.RFC3339Nano)

	bad := noteData("x")
	bad["content"] = map[string]any{"type": "paragraph"}
	nul := noteData("x")
	nul["content"] = map[string]any{"type": "doc", "content": []any{map[string]any{"type": "text", "text": "a\u0000b"}}}
	good := uuid.Must(uuid.NewV7()).String()
	r := e.do("POST", "/sync/push", s.access, map[string]any{"notes": []any{
		map[string]any{"id": uuid.Must(uuid.NewV7()).String(), "base_version": 0, "updated_at": now, "deleted": false, "data": bad},
		map[string]any{"id": uuid.Must(uuid.NewV7()).String(), "base_version": 0, "updated_at": now, "deleted": false, "data": nul},
		map[string]any{"id": uuid.Must(uuid.NewV7()).String(), "base_version": 0, "updated_at": now, "deleted": false},
		map[string]any{"id": good, "base_version": 0, "updated_at": now, "deleted": false, "data": noteData("好的")},
		map[string]any{"id": good, "base_version": 0, "updated_at": now, "deleted": false, "data": noteData("重复")},
	}})
	expectStatus(t, r, 200)
	got := results(t, r)
	want := []string{"invalid", "invalid", "invalid", "applied", "invalid"}
	for i, w := range want {
		if got[i].status != w {
			t.Fatalf("result %d = %s, want %s (%v)", i, got[i].status, w, r.body)
		}
	}

	// 结构层面的错误（颜色不在枚举里、条数超限）整个请求 422
	badColor := noteData("x")
	badColor["color"] = "neon"
	expectProblem(t, e.do("POST", "/sync/push", s.access, map[string]any{"notes": []any{
		map[string]any{"id": uuid.NewString(), "base_version": 0, "updated_at": now, "deleted": false, "data": badColor},
	}}), 422, "validation_failed")
	many := make([]any, 501)
	for i := range many {
		many[i] = map[string]any{"id": uuid.NewString(), "base_version": 0, "updated_at": now, "deleted": true}
	}
	expectProblem(t, e.do("POST", "/sync/push", s.access, map[string]any{"notes": many}), 422, "validation_failed")
	expectProblem(t, e.do("GET", "/sync/pull?since=-1", s.access, nil), 422, "validation_failed")
}

func TestSyncPullPagination(t *testing.T) {
	e := newEnv(t)
	s := e.register(uniqueEmail(), "correct horse")
	var cs []change
	for i := 0; i < 5; i++ {
		cs = append(cs, change{id: uuid.Must(uuid.NewV7()).String(), at: e.clock.Now(), text: fmt.Sprintf("第 %d 张", i)})
	}
	e.push(s.access, cs...)

	var seen []string
	since := int64(0)
	for pages := 0; ; pages++ {
		if pages > 5 {
			t.Fatal("pagination did not terminate")
		}
		p := e.pull(s.access, since, 2)
		for _, n := range p.body["notes"].([]any) {
			seen = append(seen, noteText(n.(map[string]any)))
		}
		since = int64(p.body["server_version"].(float64))
		if p.body["has_more"] == false {
			break
		}
	}
	if strings.Join(seen, ",") != "第 0 张,第 1 张,第 2 张,第 3 张,第 4 张" || since != 5 {
		t.Fatalf("seen = %v, since = %d", seen, since)
	}
}
