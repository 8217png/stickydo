// Package service 是业务逻辑层：Handler → Service → Repository。
package service

import (
	"context"
	"errors"
	"log/slog"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/8217png/stickydo/server/internal/apperr"
	"github.com/8217png/stickydo/server/internal/auth"
	"github.com/8217png/stickydo/server/internal/repo"
)

// reuseGrace：Refresh Token 轮换后的这段时间里，旧 Token 再被使用不视为泄露。
// 同一浏览器的多个标签页可能同时刷新，只有一个能成功，另一个拿到 401 后
// 会从本地存储读到新 Token，不应该因此把整台设备踢下线。
const reuseGrace = 60 * time.Second

type Auth struct {
	pool       *pgxpool.Pool
	q          *repo.Queries
	tokens     *auth.Tokens
	refreshTTL time.Duration
	log        *slog.Logger
	// Now 可在测试中替换
	Now func() time.Time
	// Sessions 在设备被吊销时断开它的实时连接（可为空）
	Sessions SessionCloser
}

// SessionCloser 断开实时连接（realtime.Hub 实现）
type SessionCloser interface {
	DisconnectDevice(user, device uuid.UUID)
	DisconnectOthers(user, keep uuid.UUID)
}

func (s *Auth) closeDevice(user, device uuid.UUID) {
	if s.Sessions != nil {
		s.Sessions.DisconnectDevice(user, device)
	}
}

func NewAuth(pool *pgxpool.Pool, tokens *auth.Tokens, refreshTTL time.Duration, log *slog.Logger) *Auth {
	return &Auth{pool: pool, q: repo.New(pool), tokens: tokens, refreshTTL: refreshTTL, log: log, Now: time.Now}
}

type DeviceInfo struct {
	Name     string
	Platform string
}

type TokenPair struct {
	AccessToken      string
	AccessExpiresAt  time.Time
	RefreshToken     string
	RefreshExpiresAt time.Time
}

type Session struct {
	User     repo.User
	DeviceID uuid.UUID
	Tokens   TokenPair
}

type DeviceView struct {
	repo.Device
	Current bool
}

// ---------- 注册与登录 ----------

func (s *Auth) Register(ctx context.Context, email, password, name string, dev DeviceInfo) (Session, error) {
	email = strings.TrimSpace(email)
	name = strings.TrimSpace(name)
	fields := map[string]string{}
	if !validEmail(email) {
		fields["email"] = "请输入有效的邮箱地址"
	}
	if msg := checkPassword(password); msg != "" {
		fields["password"] = msg
	}
	if utf8.RuneCountInString(name) > 50 {
		fields["name"] = "名字最多 50 个字"
	}
	checkDevice(dev, fields)
	if len(fields) > 0 {
		return Session{}, apperr.Validation(fields)
	}
	if name == "" {
		name = strings.SplitN(email, "@", 2)[0]
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		return Session{}, err
	}

	var sess Session
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		user, err := q.CreateUser(ctx, repo.CreateUserParams{
			ID: uuid.Must(uuid.NewV7()), Email: email, PasswordHash: hash, Name: name,
		})
		if err != nil {
			if isUniqueViolation(err) {
				return apperr.ErrEmailTaken
			}
			return err
		}
		if err := q.InitUserSyncSeq(ctx, user.ID); err != nil {
			return err
		}
		sess, err = s.newSession(ctx, q, user, dev)
		return err
	})
	return sess, err
}

func (s *Auth) Login(ctx context.Context, email, password string, dev DeviceInfo) (Session, error) {
	fields := map[string]string{}
	checkDevice(dev, fields)
	if len(fields) > 0 {
		return Session{}, apperr.Validation(fields)
	}
	user, err := s.q.GetUserByEmail(ctx, strings.TrimSpace(email))
	if errors.Is(err, pgx.ErrNoRows) {
		auth.BurnPasswordCheck(password)
		return Session{}, apperr.ErrInvalidCredentials
	}
	if err != nil {
		return Session{}, err
	}
	ok, err := auth.VerifyPassword(password, user.PasswordHash)
	if err != nil {
		return Session{}, err
	}
	if !ok {
		return Session{}, apperr.ErrInvalidCredentials
	}
	return s.newSession(ctx, s.q, user, dev)
}

func (s *Auth) newSession(ctx context.Context, q *repo.Queries, user repo.User, dev DeviceInfo) (Session, error) {
	now := s.Now()
	refresh, refreshHash, err := auth.NewRefreshToken()
	if err != nil {
		return Session{}, err
	}
	device, err := q.CreateDevice(ctx, repo.CreateDeviceParams{
		ID:               uuid.Must(uuid.NewV7()),
		UserID:           user.ID,
		Name:             strings.TrimSpace(dev.Name),
		Platform:         dev.Platform,
		RefreshTokenHash: refreshHash,
		RefreshExpiresAt: now.Add(s.refreshTTL),
	})
	if err != nil {
		return Session{}, err
	}
	access, accessExp, err := s.tokens.IssueAccess(user.ID, device.ID, now)
	if err != nil {
		return Session{}, err
	}
	return Session{
		User:     user,
		DeviceID: device.ID,
		Tokens: TokenPair{
			AccessToken: access, AccessExpiresAt: accessExp,
			RefreshToken: refresh, RefreshExpiresAt: device.RefreshExpiresAt,
		},
	}, nil
}

// ---------- 令牌 ----------

// Refresh 用 Refresh Token 换一对新令牌；旧 Refresh Token 立即失效。
func (s *Auth) Refresh(ctx context.Context, refreshToken string) (TokenPair, error) {
	if refreshToken == "" {
		return TokenPair{}, apperr.ErrUnauthorized
	}
	hash := auth.HashRefreshToken(refreshToken)
	now := s.Now()

	var pair TokenPair
	unknown := false
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		dev, err := q.GetDeviceByRefreshHashForUpdate(ctx, hash)
		if errors.Is(err, pgx.ErrNoRows) {
			unknown = true
			return nil
		}
		if err != nil {
			return err
		}
		if dev.RevokedAt != nil || !now.Before(dev.RefreshExpiresAt) {
			return apperr.ErrUnauthorized
		}
		newToken, newHash, err := auth.NewRefreshToken()
		if err != nil {
			return err
		}
		expires := now.Add(s.refreshTTL)
		n, err := q.RotateDeviceRefreshToken(ctx, repo.RotateDeviceRefreshTokenParams{
			ID: dev.ID, OldHash: hash, NewHash: newHash, ExpiresAt: expires,
		})
		if err != nil {
			return err
		}
		if n != 1 {
			return apperr.ErrUnauthorized
		}
		access, accessExp, err := s.tokens.IssueAccess(dev.UserID, dev.ID, now)
		if err != nil {
			return err
		}
		pair = TokenPair{AccessToken: access, AccessExpiresAt: accessExp, RefreshToken: newToken, RefreshExpiresAt: expires}
		return nil
	})
	if err == nil && unknown {
		// 在事务之外处理：吊销需要真正提交，而返回错误会让事务回滚
		err = s.handleUnknownRefreshToken(ctx, hash, now)
	}
	return pair, err
}

// handleUnknownRefreshToken：Token 不是任何设备当前的 Refresh Token。
// 如果它是某台设备“上一个” Token，且已经过了宽限期，说明旧 Token 被重放，
// 可能已经泄露：吊销这台设备，攻击者和真实用户都需要重新登录。
func (s *Auth) handleUnknownRefreshToken(ctx context.Context, hash []byte, now time.Time) error {
	dev, err := s.q.GetDeviceByPrevRefreshHash(ctx, hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.ErrUnauthorized
	}
	if err != nil {
		return err
	}
	if dev.RevokedAt == nil && now.Sub(dev.LastSeenAt) > reuseGrace {
		if _, err := s.q.RevokeDevice(ctx, repo.RevokeDeviceParams{ID: dev.ID, UserID: dev.UserID}); err != nil {
			return err
		}
		s.closeDevice(dev.UserID, dev.ID)
		s.log.Warn("refresh token reuse detected, device revoked",
			slog.String("user_id", dev.UserID.String()), slog.String("device_id", dev.ID.String()))
	}
	return apperr.ErrUnauthorized
}

// Authenticate 校验 Access Token，并确认设备没有被吊销。
func (s *Auth) Authenticate(ctx context.Context, accessToken string) (auth.Principal, error) {
	p, err := s.tokens.ParseAccess(accessToken, s.Now())
	if errors.Is(err, auth.ErrTokenExpired) {
		return p, apperr.ErrTokenExpired
	}
	if err != nil {
		return p, apperr.ErrUnauthorized
	}
	_, err = s.q.GetActiveDevice(ctx, repo.GetActiveDeviceParams{ID: p.DeviceID, UserID: p.UserID})
	if errors.Is(err, pgx.ErrNoRows) {
		return p, apperr.ErrUnauthorized
	}
	return p, err
}

// ---------- 当前用户 ----------

func (s *Auth) Logout(ctx context.Context, p auth.Principal) error {
	_, err := s.q.RevokeDevice(ctx, repo.RevokeDeviceParams{ID: p.DeviceID, UserID: p.UserID})
	if err == nil {
		s.closeDevice(p.UserID, p.DeviceID)
	}
	return err
}

// DeviceActive 设备是否仍然有效（没有退出、没有被吊销）。实时连接定期检查。
func (s *Auth) DeviceActive(ctx context.Context, p auth.Principal) (bool, error) {
	_, err := s.q.GetActiveDevice(ctx, repo.GetActiveDeviceParams{ID: p.DeviceID, UserID: p.UserID})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (s *Auth) Me(ctx context.Context, p auth.Principal) (repo.User, error) {
	u, err := s.q.GetUserByID(ctx, p.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return u, apperr.ErrUnauthorized
	}
	return u, err
}

// ChangePassword 修改密码，并让其他设备全部退出；当前设备保持登录。
func (s *Auth) ChangePassword(ctx context.Context, p auth.Principal, current, next string) error {
	if msg := checkPassword(next); msg != "" {
		return apperr.Validation(map[string]string{"new_password": msg})
	}
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		user, err := q.GetUserByID(ctx, p.UserID)
		if err != nil {
			return err
		}
		ok, err := auth.VerifyPassword(current, user.PasswordHash)
		if err != nil {
			return err
		}
		if !ok {
			return apperr.ErrWrongPassword
		}
		hash, err := auth.HashPassword(next)
		if err != nil {
			return err
		}
		if err := q.UpdateUserPassword(ctx, repo.UpdateUserPasswordParams{ID: user.ID, PasswordHash: hash}); err != nil {
			return err
		}
		return q.RevokeOtherDevices(ctx, repo.RevokeOtherDevicesParams{UserID: user.ID, KeepID: p.DeviceID})
	})
	if err == nil && s.Sessions != nil {
		s.Sessions.DisconnectOthers(p.UserID, p.DeviceID)
	}
	return err
}

func (s *Auth) ListDevices(ctx context.Context, p auth.Principal) ([]DeviceView, error) {
	devs, err := s.q.ListActiveDevices(ctx, p.UserID)
	if err != nil {
		return nil, err
	}
	out := make([]DeviceView, len(devs))
	for i, d := range devs {
		out[i] = DeviceView{Device: d, Current: d.ID == p.DeviceID}
	}
	return out, nil
}

func (s *Auth) RevokeDevice(ctx context.Context, p auth.Principal, deviceID uuid.UUID) error {
	n, err := s.q.RevokeDevice(ctx, repo.RevokeDeviceParams{ID: deviceID, UserID: p.UserID})
	if err != nil {
		return err
	}
	if n == 0 {
		return apperr.ErrNotFound
	}
	s.closeDevice(p.UserID, deviceID)
	return nil
}

// ---------- 校验 ----------

func validEmail(email string) bool {
	if len(email) > 254 {
		return false
	}
	addr, err := mail.ParseAddress(email)
	if err != nil || addr.Address != email {
		return false
	}
	at := strings.LastIndexByte(email, '@')
	return at > 0 && strings.Contains(email[at+1:], ".")
}

func checkPassword(pw string) string {
	n := utf8.RuneCountInString(pw)
	switch {
	case n < 8:
		return "密码至少 8 位"
	case n > 200:
		return "密码最多 200 位"
	case strings.TrimSpace(pw) == "":
		return "密码不能全是空格"
	}
	return ""
}

var platforms = map[string]bool{"web": true, "extension": true, "android": true, "ios": true, "other": true}

func checkDevice(d DeviceInfo, fields map[string]string) {
	n := utf8.RuneCountInString(strings.TrimSpace(d.Name))
	if n == 0 || n > 100 {
		fields["device.name"] = "设备名称需要 1–100 个字"
	}
	if !platforms[d.Platform] {
		fields["device.platform"] = "不支持的平台"
	}
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
