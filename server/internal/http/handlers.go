package httpserver

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/8217png/stickydo/server/internal/apperr"
	"github.com/8217png/stickydo/server/internal/auth"
	"github.com/8217png/stickydo/server/internal/http/api"
	"github.com/8217png/stickydo/server/internal/realtime"
	"github.com/8217png/stickydo/server/internal/repo"
	"github.com/8217png/stickydo/server/internal/service"
)

// handlers 实现由 api/openapi.yaml 生成的 StrictServerInterface。
// 只返回成功响应；错误交给 writeProblem 统一处理。
type handlers struct {
	hub *realtime.Hub
	pool *pgxpool.Pool
	auth *service.Auth
	sync *service.Sync
}

var _ api.StrictServerInterface = (*handlers)(nil)

func (h *handlers) GetHealth(ctx context.Context, _ api.GetHealthRequestObject) (api.GetHealthResponseObject, error) {
	if err := h.pool.Ping(ctx); err != nil {
		return nil, apperr.ErrUnavailable.WithDetail("数据库连接失败")
	}
	return api.GetHealth200JSONResponse{Status: api.Ok}, nil
}

func (h *handlers) Register(ctx context.Context, req api.RegisterRequestObject) (api.RegisterResponseObject, error) {
	b := req.Body
	name := ""
	if b.Name != nil {
		name = *b.Name
	}
	sess, err := h.auth.Register(ctx, string(b.Email), b.Password, name, deviceInfo(b.Device))
	if err != nil {
		return nil, err
	}
	return api.Register201JSONResponse(authResponse(sess)), nil
}

func (h *handlers) Login(ctx context.Context, req api.LoginRequestObject) (api.LoginResponseObject, error) {
	b := req.Body
	sess, err := h.auth.Login(ctx, string(b.Email), b.Password, deviceInfo(b.Device))
	if err != nil {
		return nil, err
	}
	return api.Login200JSONResponse(authResponse(sess)), nil
}

func (h *handlers) RefreshTokens(ctx context.Context, req api.RefreshTokensRequestObject) (api.RefreshTokensResponseObject, error) {
	pair, err := h.auth.Refresh(ctx, req.Body.RefreshToken)
	if err != nil {
		return nil, err
	}
	return api.RefreshTokens200JSONResponse(tokenPair(pair)), nil
}

func (h *handlers) Logout(ctx context.Context, _ api.LogoutRequestObject) (api.LogoutResponseObject, error) {
	p, err := mustPrincipal(ctx)
	if err != nil {
		return nil, err
	}
	if err := h.auth.Logout(ctx, p); err != nil {
		return nil, err
	}
	return api.Logout204Response{}, nil
}

func (h *handlers) GetMe(ctx context.Context, _ api.GetMeRequestObject) (api.GetMeResponseObject, error) {
	p, err := mustPrincipal(ctx)
	if err != nil {
		return nil, err
	}
	u, err := h.auth.Me(ctx, p)
	if err != nil {
		return nil, err
	}
	return api.GetMe200JSONResponse(user(u)), nil
}

func (h *handlers) ChangePassword(ctx context.Context, req api.ChangePasswordRequestObject) (api.ChangePasswordResponseObject, error) {
	p, err := mustPrincipal(ctx)
	if err != nil {
		return nil, err
	}
	if err := h.auth.ChangePassword(ctx, p, req.Body.CurrentPassword, req.Body.NewPassword); err != nil {
		return nil, err
	}
	return api.ChangePassword204Response{}, nil
}

func (h *handlers) ListDevices(ctx context.Context, _ api.ListDevicesRequestObject) (api.ListDevicesResponseObject, error) {
	p, err := mustPrincipal(ctx)
	if err != nil {
		return nil, err
	}
	devs, err := h.auth.ListDevices(ctx, p)
	if err != nil {
		return nil, err
	}
	out := make(api.ListDevices200JSONResponse, len(devs))
	for i, d := range devs {
		out[i] = api.Device{
			Id:         d.ID,
			Name:       d.Name,
			Platform:   api.Platform(d.Platform),
			CreatedAt:  d.CreatedAt,
			LastSeenAt: d.LastSeenAt,
			Current:    d.Current,
		}
	}
	return out, nil
}

func (h *handlers) RevokeDevice(ctx context.Context, req api.RevokeDeviceRequestObject) (api.RevokeDeviceResponseObject, error) {
	p, err := mustPrincipal(ctx)
	if err != nil {
		return nil, err
	}
	if err := h.auth.RevokeDevice(ctx, p, req.DeviceId); err != nil {
		return nil, err
	}
	return api.RevokeDevice204Response{}, nil
}

// ---------- 转换 ----------

func mustPrincipal(ctx context.Context) (auth.Principal, error) {
	p, ok := principalFrom(ctx)
	if !ok {
		return p, apperr.ErrUnauthorized
	}
	return p, nil
}

func deviceInfo(d api.DeviceInfo) service.DeviceInfo {
	return service.DeviceInfo{Name: d.Name, Platform: string(d.Platform)}
}

func user(u repo.User) api.User {
	return api.User{Id: u.ID, Email: openapi_types.Email(u.Email), Name: u.Name, CreatedAt: u.CreatedAt}
}

func tokenPair(t service.TokenPair) api.TokenPair {
	return api.TokenPair{
		AccessToken:      t.AccessToken,
		AccessExpiresAt:  t.AccessExpiresAt,
		RefreshToken:     t.RefreshToken,
		RefreshExpiresAt: t.RefreshExpiresAt,
		TokenType:        api.Bearer,
	}
}

func authResponse(s service.Session) api.AuthResponse {
	return api.AuthResponse{User: user(s.User), DeviceId: s.DeviceID, Tokens: tokenPair(s.Tokens)}
}
