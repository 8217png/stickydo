package httpserver_test

// 认证接口的集成测试：testcontainers 启动真实的 PostgreSQL，执行迁移，
// 通过 HTTP 调用完整的路由（中间件 → OpenAPI 校验 → handler → service → repo）。
// 需要 Docker；没有 Docker 时整个包跳过。

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/8217png/stickydo/server/internal/auth"
	"github.com/8217png/stickydo/server/internal/db"
	httpserver "github.com/8217png/stickydo/server/internal/http"
	"github.com/8217png/stickydo/server/internal/service"
)

var pool *pgxpool.Pool

func TestMain(m *testing.M) {
	os.Exit(runMain(m))
}

func runMain(m *testing.M) int {
	ctx := context.Background()
	pg, err := tcpostgres.Run(ctx, "postgres:16-alpine",
		tcpostgres.WithDatabase("stickydo"),
		tcpostgres.WithUsername("stickydo"),
		tcpostgres.WithPassword("stickydo"),
		tcpostgres.BasicWaitStrategies(),
	)
	if err != nil {
		// make test 设置了 STICKYDO_REQUIRE_DOCKER=1：没有 Docker 时直接失败，而不是悄悄跳过
		if os.Getenv("STICKYDO_REQUIRE_DOCKER") == "1" {
			fmt.Fprintf(os.Stderr, "集成测试需要 Docker，但无法启动 PostgreSQL 容器：%v\n", err)
			return 1
		}
		fmt.Fprintf(os.Stderr, "跳过集成测试：无法启动 PostgreSQL 容器（需要 Docker）：%v\n", err)
		return 0
	}
	defer func() { _ = testcontainers.TerminateContainer(pg) }()

	url, err := pg.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	pool, err = db.Connect(ctx, url)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool, slog.New(slog.DiscardHandler)); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return m.Run()
}

// ---------- 测试环境 ----------

type clock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *clock) Now() time.Time       { c.mu.Lock(); defer c.mu.Unlock(); return c.now }
func (c *clock) Advance(d time.Duration) { c.mu.Lock(); c.now = c.now.Add(d); c.mu.Unlock() }

type env struct {
	t     *testing.T
	srv   *httptest.Server
	clock *clock
}

type envOpts struct {
	rateEvery time.Duration
	rateBurst int
}

func newEnv(t *testing.T, opts ...envOpts) *env {
	t.Helper()
	if pool == nil {
		t.Skip("需要 Docker 才能运行集成测试")
	}
	o := envOpts{rateEvery: time.Millisecond, rateBurst: 1000}
	if len(opts) > 0 {
		o = opts[0]
	}
	clk := &clock{now: time.Now()}
	log := slog.New(slog.DiscardHandler)
	svc := service.NewAuth(pool, auth.NewTokens(strings.Repeat("k", 32), 15*time.Minute), 30*24*time.Hour, log)
	svc.Now = clk.Now
	syncSvc := service.NewSync(pool)
	syncSvc.Now = clk.Now
	h, err := httpserver.New(httpserver.Deps{
		Pool: pool, Auth: svc, Sync: syncSvc, Log: log, CORSOrigins: []string{"http://localhost:5173"},
		AuthRateEvery: o.rateEvery, AuthRateBurst: o.rateBurst,
	})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return &env{t: t, srv: srv, clock: clk}
}

type resp struct {
	status int
	header http.Header
	body   map[string]any
	list   []any
}

func (e *env) do(method, path, token string, body any) resp {
	e.t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, e.srv.URL+"/api/v1"+path, r)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	out := resp{status: res.StatusCode, header: res.Header}
	if len(raw) > 0 {
		if raw[0] == '[' {
			_ = json.Unmarshal(raw, &out.list)
		} else {
			_ = json.Unmarshal(raw, &out.body)
		}
	}
	return out
}

var emailSeq atomic.Int64

func uniqueEmail() string {
	return fmt.Sprintf("user%d-%d@example.com", time.Now().UnixNano(), emailSeq.Add(1))
}

var webDevice = map[string]any{"name": "Chrome · macOS", "platform": "web"}

type session struct {
	email, password, access, refresh, deviceID string
}

func (e *env) register(email, password string) session {
	e.t.Helper()
	r := e.do("POST", "/auth/register", "", map[string]any{"email": email, "password": password, "device": webDevice})
	expectStatus(e.t, r, 201)
	return sessionFrom(r, email, password)
}

func (e *env) login(email, password string, device map[string]any) session {
	e.t.Helper()
	r := e.do("POST", "/auth/login", "", map[string]any{"email": email, "password": password, "device": device})
	expectStatus(e.t, r, 200)
	return sessionFrom(r, email, password)
}

func sessionFrom(r resp, email, password string) session {
	tokens := r.body["tokens"].(map[string]any)
	return session{
		email: email, password: password,
		access: tokens["access_token"].(string), refresh: tokens["refresh_token"].(string),
		deviceID: r.body["device_id"].(string),
	}
}

func (e *env) refresh(token string) resp {
	return e.do("POST", "/auth/refresh", "", map[string]any{"refresh_token": token})
}

func expectStatus(t *testing.T, r resp, want int) {
	t.Helper()
	if r.status != want {
		t.Fatalf("status = %d, want %d; body = %v", r.status, want, r.body)
	}
}

func expectProblem(t *testing.T, r resp, status int, code string) {
	t.Helper()
	expectStatus(t, r, status)
	if r.header.Get("Content-Type") != "application/problem+json" {
		t.Fatalf("content-type = %q", r.header.Get("Content-Type"))
	}
	if r.body["code"] != code {
		t.Fatalf("code = %v, want %s; body = %v", r.body["code"], code, r.body)
	}
}

// ---------- 用例 ----------

func TestHealth(t *testing.T) {
	e := newEnv(t)
	r := e.do("GET", "/healthz", "", nil)
	expectStatus(t, r, 200)
	if r.body["status"] != "ok" {
		t.Fatalf("body = %v", r.body)
	}
}

func TestRegisterAndMe(t *testing.T) {
	e := newEnv(t)
	email := uniqueEmail()
	s := e.register(email, "correct horse")

	r := e.do("GET", "/me", s.access, nil)
	expectStatus(t, r, 200)
	if r.body["email"] != email {
		t.Fatalf("email = %v", r.body["email"])
	}
	// 没填名字时，用邮箱 @ 前面的部分
	if want := strings.SplitN(email, "@", 2)[0]; r.body["name"] != want {
		t.Fatalf("name = %v, want %s", r.body["name"], want)
	}
}

func TestRegisterDuplicateEmailIsCaseInsensitive(t *testing.T) {
	e := newEnv(t)
	email := uniqueEmail()
	e.register(email, "correct horse")
	r := e.do("POST", "/auth/register", "", map[string]any{
		"email": strings.ToUpper(email), "password": "another pass", "device": webDevice,
	})
	expectProblem(t, r, 409, "email_taken")
}

func TestRegisterValidationReportsAllFields(t *testing.T) {
	e := newEnv(t)
	r := e.do("POST", "/auth/register", "", map[string]any{
		"email": "not-an-email", "password": "short", "device": map[string]any{"name": "x", "platform": "tv"},
	})
	expectProblem(t, r, 422, "validation_failed")
	fields := r.body["fields"].(map[string]any)
	for _, f := range []string{"email", "password", "device.platform"} {
		if _, ok := fields[f]; !ok {
			t.Errorf("missing field error for %s: %v", f, fields)
		}
	}

	// 只有空格的密码由 Service 层拦下
	r = e.do("POST", "/auth/register", "", map[string]any{"email": uniqueEmail(), "password": "         ", "device": webDevice})
	expectProblem(t, r, 422, "validation_failed")

	r = e.do("POST", "/auth/register", "", nil)
	if r.status != 400 && r.status != 422 {
		t.Fatalf("empty body: status %d", r.status)
	}
}

func TestLoginFailuresLookTheSame(t *testing.T) {
	e := newEnv(t)
	email := uniqueEmail()
	e.register(email, "correct horse")

	wrongPw := e.do("POST", "/auth/login", "", map[string]any{"email": email, "password": "wrong horse", "device": webDevice})
	expectProblem(t, wrongPw, 401, "invalid_credentials")
	unknown := e.do("POST", "/auth/login", "", map[string]any{"email": uniqueEmail(), "password": "wrong horse", "device": webDevice})
	expectProblem(t, unknown, 401, "invalid_credentials")
	if wrongPw.body["title"] != unknown.body["title"] {
		t.Fatal("wrong password and unknown email must be indistinguishable")
	}

	// 邮箱大小写不敏感
	e.login(strings.ToUpper(email), "correct horse", webDevice)
}

func TestProtectedEndpointsRequireToken(t *testing.T) {
	e := newEnv(t)
	for _, c := range []struct{ method, path string }{
		{"GET", "/me"}, {"GET", "/me/devices"}, {"POST", "/auth/logout"},
	} {
		r := e.do(c.method, c.path, "", nil)
		expectProblem(t, r, 401, "unauthorized")
		if !strings.HasPrefix(r.header.Get("WWW-Authenticate"), "Bearer") {
			t.Errorf("%s %s: missing WWW-Authenticate", c.method, c.path)
		}
	}
	expectProblem(t, e.do("GET", "/me", "garbage", nil), 401, "unauthorized")
}

func TestAccessTokenExpiry(t *testing.T) {
	e := newEnv(t)
	s := e.register(uniqueEmail(), "correct horse")
	e.clock.Advance(16 * time.Minute)
	// 过期返回 token_expired，客户端据此去刷新
	expectProblem(t, e.do("GET", "/me", s.access, nil), 401, "token_expired")

	r := e.refresh(s.refresh)
	expectStatus(t, r, 200)
	expectStatus(t, e.do("GET", "/me", r.body["access_token"].(string), nil), 200)
}

func TestRefreshRotation(t *testing.T) {
	e := newEnv(t)
	s := e.register(uniqueEmail(), "correct horse")

	r1 := e.refresh(s.refresh)
	expectStatus(t, r1, 200)
	newRefresh := r1.body["refresh_token"].(string)
	if newRefresh == s.refresh {
		t.Fatal("refresh token was not rotated")
	}

	// 宽限期内（另一个标签页同时刷新）：旧 Token 失败，但设备不受影响
	expectProblem(t, e.refresh(s.refresh), 401, "unauthorized")
	r2 := e.refresh(newRefresh)
	expectStatus(t, r2, 200)
	latest := r2.body["refresh_token"].(string)
	expectStatus(t, e.do("GET", "/me", r2.body["access_token"].(string), nil), 200)

	// 宽限期过后重放上一个 Token：视为泄露，吊销设备
	e.clock.Advance(2 * time.Minute)
	expectProblem(t, e.refresh(newRefresh), 401, "unauthorized")
	expectProblem(t, e.refresh(latest), 401, "unauthorized")
	expectProblem(t, e.do("GET", "/me", r2.body["access_token"].(string), nil), 401, "unauthorized")
}

func TestRefreshTokenExpiry(t *testing.T) {
	e := newEnv(t)
	s := e.register(uniqueEmail(), "correct horse")
	e.clock.Advance(31 * 24 * time.Hour)
	expectProblem(t, e.refresh(s.refresh), 401, "unauthorized")
	expectProblem(t, e.refresh("not-a-real-token"), 401, "unauthorized")
}

func TestLogoutRevokesDeviceImmediately(t *testing.T) {
	e := newEnv(t)
	s := e.register(uniqueEmail(), "correct horse")
	expectStatus(t, e.do("POST", "/auth/logout", s.access, nil), 204)
	// Access Token 还没过期，但设备已吊销，立即失效
	expectProblem(t, e.do("GET", "/me", s.access, nil), 401, "unauthorized")
	expectProblem(t, e.refresh(s.refresh), 401, "unauthorized")
}

func TestChangePassword(t *testing.T) {
	e := newEnv(t)
	web := e.register(uniqueEmail(), "correct horse")
	phone := e.login(web.email, web.password, map[string]any{"name": "iPhone", "platform": "ios"})

	r := e.do("POST", "/me/password", web.access, map[string]any{"current_password": "nope nope", "new_password": "brand new pass"})
	expectProblem(t, r, 403, "wrong_password")
	r = e.do("POST", "/me/password", web.access, map[string]any{"current_password": "correct horse", "new_password": "short"})
	expectProblem(t, r, 422, "validation_failed")

	expectStatus(t, e.do("POST", "/me/password", web.access, map[string]any{
		"current_password": "correct horse", "new_password": "brand new pass",
	}), 204)

	// 当前设备保持登录，其他设备全部退出
	expectStatus(t, e.do("GET", "/me", web.access, nil), 200)
	expectProblem(t, e.do("GET", "/me", phone.access, nil), 401, "unauthorized")
	expectProblem(t, e.refresh(phone.refresh), 401, "unauthorized")

	expectProblem(t, e.do("POST", "/auth/login", "", map[string]any{"email": web.email, "password": "correct horse", "device": webDevice}), 401, "invalid_credentials")
	e.login(web.email, "brand new pass", webDevice)
}

func TestDevices(t *testing.T) {
	e := newEnv(t)
	web := e.register(uniqueEmail(), "correct horse")
	ext := e.login(web.email, web.password, map[string]any{"name": "Chrome 插件", "platform": "extension"})

	r := e.do("GET", "/me/devices", web.access, nil)
	expectStatus(t, r, 200)
	if len(r.list) != 2 {
		t.Fatalf("devices = %v", r.list)
	}
	current := 0
	for _, d := range r.list {
		if d.(map[string]any)["current"] == true {
			current++
			if d.(map[string]any)["id"] != web.deviceID {
				t.Fatalf("wrong current device: %v", d)
			}
		}
	}
	if current != 1 {
		t.Fatalf("exactly one device should be current: %v", r.list)
	}

	// 让插件退出
	expectStatus(t, e.do("DELETE", "/me/devices/"+ext.deviceID, web.access, nil), 204)
	expectProblem(t, e.do("GET", "/me", ext.access, nil), 401, "unauthorized")
	expectProblem(t, e.do("DELETE", "/me/devices/"+ext.deviceID, web.access, nil), 404, "not_found")

	// 不能吊销别人的设备
	other := e.register(uniqueEmail(), "correct horse")
	expectProblem(t, e.do("DELETE", "/me/devices/"+other.deviceID, web.access, nil), 404, "not_found")
	expectStatus(t, e.do("GET", "/me", other.access, nil), 200)

	expectProblem(t, e.do("DELETE", "/me/devices/not-a-uuid", web.access, nil), 422, "validation_failed")
}

func TestAuthEndpointsAreRateLimited(t *testing.T) {
	e := newEnv(t, envOpts{rateEvery: time.Hour, rateBurst: 3})
	body := map[string]any{"email": uniqueEmail(), "password": "wrong horse", "device": webDevice}
	for i := 0; i < 3; i++ {
		expectProblem(t, e.do("POST", "/auth/login", "", body), 401, "invalid_credentials")
	}
	r := e.do("POST", "/auth/login", "", body)
	expectProblem(t, r, 429, "rate_limited")
	if r.header.Get("Retry-After") == "" {
		t.Fatal("missing Retry-After")
	}
	// 其他接口不受影响
	expectStatus(t, e.do("GET", "/healthz", "", nil), 200)
}

func TestCORSPreflight(t *testing.T) {
	e := newEnv(t)
	req, _ := http.NewRequest("OPTIONS", e.srv.URL+"/api/v1/auth/login", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	req.Header.Set("Access-Control-Request-Method", "POST")
	req.Header.Set("Access-Control-Request-Headers", "content-type")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if got := res.Header.Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Fatalf("allow-origin = %q", got)
	}

	req.Header.Set("Origin", "https://evil.example")
	res, _ = http.DefaultClient.Do(req)
	res.Body.Close()
	if got := res.Header.Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("unexpected allow-origin for unknown origin: %q", got)
	}
}
