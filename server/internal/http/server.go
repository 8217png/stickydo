// Package httpserver 组装 HTTP 路由：中间件 → OpenAPI 请求校验（含认证）→ 生成的 strict handler。
package httpserver

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
	oapimw "github.com/oapi-codegen/nethttp-middleware"

	"github.com/8217png/stickydo/server/internal/apperr"
	"github.com/8217png/stickydo/server/internal/http/api"
	"github.com/8217png/stickydo/server/internal/service"
)

const apiPrefix = "/api/v1"

type Deps struct {
	Pool        *pgxpool.Pool
	Auth        *service.Auth
	Log         *slog.Logger
	CORSOrigins []string
	TrustProxy  bool
	// 注册、登录、刷新令牌的限流：每个 IP 每 AuthRateEvery 补充 1 次，最多连续 AuthRateBurst 次。
	// 为零时使用默认值（6 秒、10 次）。
	AuthRateEvery time.Duration
	AuthRateBurst int
}

func init() {
	// OpenAPI 里的 format: email 做粗略检查；精确校验在 Service 层
	openapi3.DefineStringFormatValidator("email", openapi3.NewRegexpFormatValidator(openapi3.FormatOfStringForEmail))
}

func New(d Deps) (http.Handler, error) {
	spec, err := api.GetSwagger()
	if err != nil {
		return nil, err
	}

	problem := func(w http.ResponseWriter, r *http.Request, err error) { writeProblem(w, r, d.Log, err) }

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	if d.TrustProxy {
		r.Use(middleware.RealIP)
	}
	r.Use(requestLogger(d.Log))
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: d.CORSOrigins,
		AllowedMethods: []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete},
		AllowedHeaders: []string{"Authorization", "Content-Type"},
		ExposedHeaders: []string{"Retry-After", "X-Request-Id"},
		MaxAge:         600,
	}))
	r.Use(limitBody(1 << 20))
	r.Use(withPrincipalSlot)

	every, burst := d.AuthRateEvery, d.AuthRateBurst
	if every == 0 {
		every = 6 * time.Second
	}
	if burst == 0 {
		burst = 10
	}
	authLimiter := newIPLimiter(every, burst)
	limited := authLimiter.middleware(func(w http.ResponseWriter, r *http.Request) { problem(w, r, apperr.ErrRateLimited) })

	validator := oapimw.OapiRequestValidatorWithOptions(spec, &oapimw.Options{
		DoNotValidateServers: true,
		Prefix:               apiPrefix,
		Options: openapi3filter.Options{
			AuthenticationFunc: authenticationFunc(d.Auth),
			// 一次返回所有字段的错误，表单可以同时标出来
			MultiError: true,
		},
		ErrorHandlerWithOpts: func(_ context.Context, err error, w http.ResponseWriter, r *http.Request, opts oapimw.ErrorHandlerOpts) {
			problem(w, r, validationError(err, opts.StatusCode))
		},
	})

	strict := api.NewStrictHandlerWithOptions(&handlers{pool: d.Pool, auth: d.Auth}, nil, api.StrictHTTPServerOptions{
		RequestErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			problem(w, r, apperr.New(http.StatusBadRequest, apperr.BadRequest, "请求格式不正确"))
		},
		ResponseErrorHandlerFunc: problem,
	})

	r.Route(apiPrefix, func(ar chi.Router) {
		ar.Use(onlyPaths(limited, apiPrefix+"/auth/register", apiPrefix+"/auth/login", apiPrefix+"/auth/refresh"))
		ar.Use(validator)
		api.HandlerWithOptions(strict, api.ChiServerOptions{
			BaseRouter: ar,
			ErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
				// 路径、查询参数解析失败（例如 deviceId 不是 UUID）按字段错误返回
				var pe *api.InvalidParamFormatError
				if errors.As(err, &pe) {
					problem(w, r, apperr.Validation(map[string]string{pe.ParamName: "格式不正确"}))
					return
				}
				problem(w, r, apperr.New(http.StatusBadRequest, apperr.BadRequest, "请求格式不正确"))
			},
		})
	})
	r.NotFound(func(w http.ResponseWriter, r *http.Request) { problem(w, r, apperr.ErrNotFound) })
	return r, nil
}

// onlyPaths 只对指定路径应用中间件。
func onlyPaths(mw func(http.Handler) http.Handler, paths ...string) func(http.Handler) http.Handler {
	set := make(map[string]bool, len(paths))
	for _, p := range paths {
		set[p] = true
	}
	return func(next http.Handler) http.Handler {
		wrapped := mw(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if set[r.URL.Path] {
				wrapped.ServeHTTP(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
