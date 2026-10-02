package httpserver

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/go-chi/chi/v5/middleware"
	"golang.org/x/time/rate"

	"github.com/8217png/stickydo/server/internal/apperr"
	"github.com/8217png/stickydo/server/internal/auth"
)

// ---------- 认证 ----------

// 认证结果放在请求上下文的一个“槽位”里：OpenAPI 校验中间件的认证回调
// 无法替换请求的 context，所以先放一个空槽位，回调里填进去。
type principalSlot struct{ p *auth.Principal }

type principalKey struct{}

func withPrincipalSlot(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), principalKey{}, &principalSlot{})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// principalFrom 取出当前请求的调用者。只有 OpenAPI 中要求认证的接口才会有。
func principalFrom(ctx context.Context) (auth.Principal, bool) {
	slot, _ := ctx.Value(principalKey{}).(*principalSlot)
	if slot == nil || slot.p == nil {
		return auth.Principal{}, false
	}
	return *slot.p, true
}

type authenticator interface {
	Authenticate(ctx context.Context, accessToken string) (auth.Principal, error)
}

// authenticationFunc 由 OpenAPI 校验中间件对需要认证的接口调用（按 openapi.yaml 的 security 声明）。
func authenticationFunc(a authenticator) openapi3filter.AuthenticationFunc {
	return func(ctx context.Context, in *openapi3filter.AuthenticationInput) error {
		if in.SecuritySchemeName != "bearerAuth" {
			return apperr.ErrUnauthorized
		}
		req := in.RequestValidationInput.Request
		h := req.Header.Get("Authorization")
		token, ok := strings.CutPrefix(h, "Bearer ")
		if !ok || token == "" {
			return apperr.ErrUnauthorized
		}
		p, err := a.Authenticate(req.Context(), strings.TrimSpace(token))
		if err != nil {
			return err
		}
		if slot, _ := req.Context().Value(principalKey{}).(*principalSlot); slot != nil {
			slot.p = &p
		}
		return nil
	}
}

// ---------- 日志 ----------

func requestLogger(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)
			status := ww.Status()
			level := slog.LevelInfo
			if status >= 500 {
				level = slog.LevelError
			}
			attrs := []slog.Attr{
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", status),
				slog.Duration("duration", time.Since(start)),
				slog.String("request_id", middleware.GetReqID(r.Context())),
			}
			if p, ok := principalFrom(r.Context()); ok {
				attrs = append(attrs, slog.String("user_id", p.UserID.String()))
			}
			log.LogAttrs(r.Context(), level, "http", attrs...)
		})
	}
}

// limitBody 限制请求体大小。
func limitBody(n int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, n)
			next.ServeHTTP(w, r)
		})
	}
}

// ---------- 限流 ----------

// ipLimiter 按客户端 IP 限流，用于注册、登录、刷新令牌，防止暴力破解。
// 单实例内存实现；多实例部署时换成 Redis（docs/architecture.md）。
type ipLimiter struct {
	mu      sync.Mutex
	entries map[string]*limiterEntry
	every   time.Duration
	burst   int
}

type limiterEntry struct {
	lim  *rate.Limiter
	seen time.Time
}

func newIPLimiter(every time.Duration, burst int) *ipLimiter {
	return &ipLimiter{entries: map[string]*limiterEntry{}, every: every, burst: burst}
}

func (l *ipLimiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	e := l.entries[key]
	if e == nil {
		// 顺带清理一段时间没出现的 IP，防止表无限增长
		if len(l.entries) > 10_000 {
			for k, v := range l.entries {
				if now.Sub(v.seen) > 10*time.Minute {
					delete(l.entries, k)
				}
			}
		}
		e = &limiterEntry{lim: rate.NewLimiter(rate.Every(l.every), l.burst)}
		l.entries[key] = e
	}
	e.seen = now
	return e.lim.AllowN(now, 1)
}

func (l *ipLimiter) middleware(onLimited func(http.ResponseWriter, *http.Request)) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !l.allow(clientIP(r), time.Now()) {
				w.Header().Set("Retry-After", "60")
				onLimited(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
