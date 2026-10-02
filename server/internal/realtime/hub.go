// Package realtime 是同步的实时通知（docs/architecture.md §5.6）：同一用户的某台设备推送了改动，
// 立刻通知这个用户其他在线的设备去拉取。通知只说“有新版本”，数据仍然走 /sync/pull。
//
// 协议（WebSocket，GET /api/v1/sync/ws）：
//
//	客户端 → {"type":"auth","token":"<access token>"}       连上后 10 秒内发送
//	服务端 → {"type":"ready","server_version":N}             认证通过；N 比本地游标新就去拉取
//	服务端 → {"type":"changed","server_version":N}           其他设备推送了改动
//
// 浏览器的 WebSocket 不能带 Authorization 头，所以 Token 放在第一条消息里，不放在 URL 上（避免进访问日志）。
// 认证失败以 4001 关闭（客户端刷新 Token 后重连）；设备被吊销以 4003 关闭（不再重连）。
//
// 目前是单实例的内存实现；多实例部署时换成 Redis Pub/Sub 广播（Notify / Disconnect 的调用方不变）。
package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"github.com/8217png/stickydo/server/internal/auth"
)

const (
	CloseUnauthorized websocket.StatusCode = 4001
	CloseRevoked      websocket.StatusCode = 4003
)

// Options 由调用方提供：认证、读取用户当前版本、确认设备仍有效。
type Options struct {
	Authenticate func(ctx context.Context, token string) (auth.Principal, error)
	Version      func(ctx context.Context, user uuid.UUID) (int64, error)
	DeviceActive func(ctx context.Context, p auth.Principal) (bool, error)
	// 允许的来源（Origin），与 CORS 设置一致；为空时只允许同源
	OriginPatterns []string
	Log            *slog.Logger

	AuthTimeout  time.Duration // 默认 10 秒
	PingInterval time.Duration // 默认 25 秒（反向代理通常 60 秒没有数据就断开）
	CheckEvery   time.Duration // 默认 5 分钟：定期确认设备没被吊销（多实例时其他实例吊销的设备）
}

type client struct {
	p    auth.Principal
	send chan []byte
	// 关闭连接（带关闭码），只生效一次
	closeOnce sync.Once
	closeCh   chan websocket.StatusCode
}

func (c *client) close(code websocket.StatusCode) {
	c.closeOnce.Do(func() { c.closeCh <- code })
}

type Hub struct {
	opts  Options
	mu    sync.Mutex
	users map[uuid.UUID]map[*client]struct{}
}

func NewHub(o Options) *Hub {
	if o.AuthTimeout == 0 {
		o.AuthTimeout = 10 * time.Second
	}
	if o.PingInterval == 0 {
		o.PingInterval = 25 * time.Second
	}
	if o.CheckEvery == 0 {
		o.CheckEvery = 5 * time.Minute
	}
	if o.Log == nil {
		o.Log = slog.Default()
	}
	return &Hub{opts: o, users: map[uuid.UUID]map[*client]struct{}{}}
}

type message struct {
	Type          string `json:"type"`
	ServerVersion int64  `json:"server_version,omitempty"`
	Token         string `json:"token,omitempty"`
}

// Notify 通知用户的所有在线设备（除了 exceptDevice，即推送改动的那台）有新版本。不阻塞：
// 发送队列满了（对方太慢）就断开它，重连后会自己拉取。
func (h *Hub) Notify(user uuid.UUID, exceptDevice uuid.UUID, serverVersion int64) {
	msg, _ := json.Marshal(message{Type: "changed", ServerVersion: serverVersion})
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.users[user] {
		if c.p.DeviceID == exceptDevice {
			continue
		}
		select {
		case c.send <- msg:
		default:
			c.close(websocket.StatusTryAgainLater)
		}
	}
}

// DisconnectDevice 断开某台设备的连接（退出登录、被吊销）。
func (h *Hub) DisconnectDevice(user, device uuid.UUID) {
	h.each(user, func(c *client) bool { return c.p.DeviceID == device })
}

// DisconnectOthers 断开用户除 keep 以外的设备（修改密码后其他设备退出）。
func (h *Hub) DisconnectOthers(user, keep uuid.UUID) {
	h.each(user, func(c *client) bool { return c.p.DeviceID != keep })
}

func (h *Hub) each(user uuid.UUID, match func(*client) bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.users[user] {
		if match(c) {
			c.close(CloseRevoked)
		}
	}
}

// Connections 当前在线连接数（测试和监控用）。
func (h *Hub) Connections(user uuid.UUID) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.users[user])
}

func (h *Hub) add(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	set := h.users[c.p.UserID]
	if set == nil {
		set = map[*client]struct{}{}
		h.users[c.p.UserID] = set
	}
	set[c] = struct{}{}
}

func (h *Hub) remove(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	set := h.users[c.p.UserID]
	delete(set, c)
	if len(set) == 0 {
		delete(h.users, c.p.UserID)
	}
}

// ServeHTTP 接受 WebSocket 连接。
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// http.Server 的读写超时对长连接不适用
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Time{})
	_ = rc.SetWriteDeadline(time.Time{})

	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: h.opts.OriginPatterns})
	if err != nil {
		return // Accept 已经写好了错误响应
	}
	ws.SetReadLimit(4 << 10)
	ctx := r.Context()

	p, ok := h.authenticate(ctx, ws)
	if !ok {
		return
	}
	version, err := h.opts.Version(ctx, p.UserID)
	if err != nil {
		ws.Close(websocket.StatusInternalError, "")
		return
	}

	c := &client{p: p, send: make(chan []byte, 8), closeCh: make(chan websocket.StatusCode, 1)}
	h.add(c)
	defer h.remove(c)

	ready, _ := json.Marshal(message{Type: "ready", ServerVersion: version})
	if err := write(ctx, ws, ready); err != nil {
		return
	}
	h.loop(ctx, ws, c)
}

func (h *Hub) authenticate(ctx context.Context, ws *websocket.Conn) (auth.Principal, bool) {
	// 不用带超时的 context 读：超时会直接掐断连接，客户端收不到 4001
	timer := time.AfterFunc(h.opts.AuthTimeout, func() { ws.Close(CloseUnauthorized, "auth timeout") })
	_, data, err := ws.Read(ctx)
	if !timer.Stop() || err != nil {
		ws.Close(CloseUnauthorized, "auth timeout")
		return auth.Principal{}, false
	}
	actx, cancel := context.WithTimeout(ctx, h.opts.AuthTimeout)
	defer cancel()
	var m message
	if json.Unmarshal(data, &m) != nil || m.Type != "auth" || m.Token == "" {
		ws.Close(CloseUnauthorized, "auth required")
		return auth.Principal{}, false
	}
	p, err := h.opts.Authenticate(actx, m.Token)
	if err != nil {
		ws.Close(CloseUnauthorized, "unauthorized")
		return auth.Principal{}, false
	}
	return p, true
}

func (h *Hub) loop(ctx context.Context, ws *websocket.Conn, c *client) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	// 读：客户端不需要再发消息；读到错误（对方关闭、断网）就结束。CloseRead 同时处理 ping/pong
	ctx = ws.CloseRead(ctx)

	ping := time.NewTicker(h.opts.PingInterval)
	defer ping.Stop()
	check := time.NewTicker(h.opts.CheckEvery)
	defer check.Stop()

	for {
		select {
		case <-ctx.Done():
			ws.Close(websocket.StatusNormalClosure, "")
			return
		case code := <-c.closeCh:
			ws.Close(code, "")
			return
		case msg := <-c.send:
			if err := write(ctx, ws, msg); err != nil {
				return
			}
		case <-ping.C:
			pctx, pcancel := context.WithTimeout(ctx, 10*time.Second)
			err := ws.Ping(pctx)
			pcancel()
			if err != nil {
				return
			}
		case <-check.C:
			ok, err := h.opts.DeviceActive(ctx, c.p)
			if err != nil && !errors.Is(err, context.Canceled) {
				h.opts.Log.Warn("realtime: 检查设备失败", slog.Any("err", err))
				continue
			}
			if !ok {
				ws.Close(CloseRevoked, "")
				return
			}
		}
	}
}

func write(ctx context.Context, ws *websocket.Conn, msg []byte) error {
	wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return ws.Write(wctx, websocket.MessageText, msg)
}

// HostPatterns 把 CORS 设置里的地址（http://localhost:5173）转成 WebSocket 的来源匹配（localhost:5173）。
func HostPatterns(origins []string) []string {
	out := make([]string, 0, len(origins))
	for _, o := range origins {
		if u, err := url.Parse(o); err == nil && u.Host != "" {
			out = append(out, u.Host)
		}
	}
	return out
}
