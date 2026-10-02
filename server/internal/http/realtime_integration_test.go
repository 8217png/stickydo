package httpserver_test

// 实时通知（WebSocket）的集成测试：认证、推送后通知其他设备、吊销设备时断开。

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"
)

type wsMsg struct {
	Type          string `json:"type"`
	ServerVersion int64  `json:"server_version"`
}

func (e *env) dialWS(origin string) *websocket.Conn {
	e.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	h := http.Header{}
	if origin != "" {
		h.Set("Origin", origin)
	}
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(e.srv.URL, "http")+"/api/v1/sync/ws", &websocket.DialOptions{HTTPHeader: h})
	if err != nil {
		e.t.Fatalf("dial: %v", err)
	}
	e.t.Cleanup(func() { c.CloseNow() })
	return c
}

func send(t *testing.T, c *websocket.Conn, v any) {
	t.Helper()
	b, _ := json.Marshal(v)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := c.Write(ctx, websocket.MessageText, b); err != nil {
		t.Fatalf("write: %v", err)
	}
}

// recv 读下一条消息；超时返回 nil
func recv(t *testing.T, c *websocket.Conn, wait time.Duration) (*wsMsg, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), wait)
	defer cancel()
	_, data, err := c.Read(ctx)
	if err != nil {
		return nil, err
	}
	var m wsMsg
	_ = json.Unmarshal(data, &m)
	return &m, nil
}

func (e *env) connect(s session) *websocket.Conn {
	e.t.Helper()
	c := e.dialWS("")
	send(e.t, c, map[string]string{"type": "auth", "token": s.access})
	m, err := recv(e.t, c, 3*time.Second)
	if err != nil || m.Type != "ready" {
		e.t.Fatalf("ready: %v %+v", err, m)
	}
	return c
}

func closeCode(err error) websocket.StatusCode { return websocket.CloseStatus(err) }

func TestRealtimeRequiresAuth(t *testing.T) {
	e := newEnv(t)
	// 第一条不是认证消息
	c := e.dialWS("")
	send(t, c, map[string]string{"type": "hello"})
	_, err := recv(t, c, 3*time.Second)
	if closeCode(err) != 4001 {
		t.Fatalf("want 4001, got %v", err)
	}
	// 错误的 Token
	c = e.dialWS("")
	send(t, c, map[string]string{"type": "auth", "token": "nope"})
	if _, err := recv(t, c, 3*time.Second); closeCode(err) != 4001 {
		t.Fatalf("bad token: %v", err)
	}
	// 一直不发认证：超时关闭
	c = e.dialWS("")
	if _, err := recv(t, c, 4*time.Second); closeCode(err) != 4001 {
		t.Fatalf("auth timeout: %v", err)
	}
	// 其他网站的页面不能连
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	h := http.Header{"Origin": []string{"https://evil.example"}}
	if _, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(e.srv.URL, "http")+"/api/v1/sync/ws", &websocket.DialOptions{HTTPHeader: h}); err == nil {
		t.Fatal("cross-origin dial should fail")
	}
}

func TestRealtimeNotifiesOtherDevices(t *testing.T) {
	e := newEnv(t)
	a := e.register(uniqueEmail(), "correct horse")
	b := e.login(a.email, a.password, webDevice)
	other := e.register(uniqueEmail(), "correct horse")

	ca := e.connect(a)
	cb := e.connect(b)
	co := e.connect(other)
	if n := e.hub.Connections(uuid.MustParse(userIDOf(t, e, a))); n != 2 {
		t.Fatalf("connections = %d", n)
	}
	// 注意：recv 超时会关闭客户端连接（coder/websocket 的行为），所以“收不到”的检查放在最后

	// 设备 A 推送：B 收到通知，A 自己和别的用户收不到
	r := one(t, e.push(a.access, change{id: uuid.Must(uuid.NewV7()).String(), at: e.clock.Now(), text: "x"}))
	m, err := recv(t, cb, 3*time.Second)
	if err != nil || m.Type != "changed" || m.ServerVersion != r.version {
		t.Fatalf("B: %v %+v (want version %d)", err, m, r.version)
	}
	// 连接建立时告诉客户端当前版本
	cb2 := e.dialWS("")
	send(t, cb2, map[string]string{"type": "auth", "token": b.access})
	if m, err := recv(t, cb2, 3*time.Second); err != nil || m.Type != "ready" || m.ServerVersion != r.version {
		t.Fatalf("ready version: %v %+v", err, m)
	}

	// 什么都没写入的推送不通知
	e.push(a.access, change{id: uuid.Must(uuid.NewV7()).String(), at: e.clock.Now(), deleted: true})
	if m, err := recv(t, cb, 300*time.Millisecond); err == nil {
		t.Fatalf("no-op push notified: %+v", m)
	}
	if m, err := recv(t, ca, 300*time.Millisecond); err == nil {
		t.Fatalf("A should not be notified of its own push: %+v", m)
	}
	if m, err := recv(t, co, 300*time.Millisecond); err == nil {
		t.Fatalf("other user notified: %+v", m)
	}
}

func TestRealtimeClosesRevokedDevices(t *testing.T) {
	e := newEnv(t)
	a := e.register(uniqueEmail(), "correct horse")
	b := e.login(a.email, a.password, webDevice)
	c := e.login(a.email, a.password, webDevice)
	cb := e.connect(b)
	cc := e.connect(c)

	// 在 A 上让 B 退出
	expectStatus(t, e.do("DELETE", "/me/devices/"+b.deviceID, a.access, nil), 204)
	if _, err := recv(t, cb, 3*time.Second); closeCode(err) != 4003 {
		t.Fatalf("revoked B: %v", err)
	}
	// 修改密码：除 A 以外全部断开
	expectStatus(t, e.do("POST", "/me/password", a.access, map[string]any{"current_password": "correct horse", "new_password": "battery staple"}), 204)
	if _, err := recv(t, cc, 3*time.Second); closeCode(err) != 4003 {
		t.Fatalf("password change C: %v", err)
	}
	// 被吊销的设备连不上
	cb2 := e.dialWS("")
	send(t, cb2, map[string]string{"type": "auth", "token": b.access})
	if _, err := recv(t, cb2, 3*time.Second); closeCode(err) != 4001 {
		t.Fatalf("revoked reconnect: %v", err)
	}
}

// 多实例时别的实例吊销的设备：定期检查时断开
func TestRealtimePeriodicDeviceCheck(t *testing.T) {
	e := newEnv(t, envOpts{rateEvery: time.Millisecond, rateBurst: 1000, wsCheckEvery: 300 * time.Millisecond})
	a := e.register(uniqueEmail(), "correct horse")
	ca := e.connect(a)
	// 直接在数据库里吊销（模拟另一个实例）
	if _, err := pool.Exec(context.Background(), "UPDATE devices SET revoked_at = now() WHERE id = $1", a.deviceID); err != nil {
		t.Fatal(err)
	}
	_, err := recv(t, ca, 3*time.Second)
	var ce websocket.CloseError
	if !errors.As(err, &ce) || ce.Code != 4003 {
		t.Fatalf("want 4003, got %v", err)
	}
}

func userIDOf(t *testing.T, e *env, s session) string {
	t.Helper()
	r := e.do("GET", "/me", s.access, nil)
	expectStatus(t, r, 200)
	return r.body["id"].(string)
}
