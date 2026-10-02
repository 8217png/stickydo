package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const issuer = "stickydo"

// AccessClaims 是 Access Token（JWT）里的内容：用户 ID 和设备 ID。
type AccessClaims struct {
	DeviceID string `json:"did"`
	jwt.RegisteredClaims
}

type Tokens struct {
	secret []byte
	ttl    time.Duration
}

func NewTokens(secret string, accessTTL time.Duration) *Tokens {
	return &Tokens{secret: []byte(secret), ttl: accessTTL}
}

// IssueAccess 签发 Access Token（HS256）。
func (t *Tokens) IssueAccess(userID, deviceID uuid.UUID, now time.Time) (token string, expiresAt time.Time, err error) {
	expiresAt = now.Add(t.ttl)
	claims := AccessClaims{
		DeviceID: deviceID.String(),
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Subject:   userID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}
	token, err = jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(t.secret)
	return token, expiresAt, err
}

var (
	ErrTokenExpired = errors.New("auth: token expired")
	ErrTokenInvalid = errors.New("auth: token invalid")
)

// Principal 是通过认证的调用者。
type Principal struct {
	UserID   uuid.UUID
	DeviceID uuid.UUID
}

// ParseAccess 校验 Access Token：只接受 HS256、本服务签发、未过期。
func (t *Tokens) ParseAccess(token string, now time.Time) (Principal, error) {
	var claims AccessClaims
	_, err := jwt.ParseWithClaims(token, &claims, func(*jwt.Token) (any, error) { return t.secret, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(issuer),
		jwt.WithExpirationRequired(),
		jwt.WithTimeFunc(func() time.Time { return now }),
	)
	if errors.Is(err, jwt.ErrTokenExpired) {
		return Principal{}, ErrTokenExpired
	}
	if err != nil {
		return Principal{}, ErrTokenInvalid
	}
	uid, err1 := uuid.Parse(claims.Subject)
	did, err2 := uuid.Parse(claims.DeviceID)
	if err1 != nil || err2 != nil {
		return Principal{}, ErrTokenInvalid
	}
	return Principal{UserID: uid, DeviceID: did}, nil
}

// NewRefreshToken 生成 256 位随机的 Refresh Token；数据库只存它的 SHA-256。
func NewRefreshToken() (token string, hash []byte, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", nil, err
	}
	token = base64.RawURLEncoding.EncodeToString(b)
	return token, HashRefreshToken(token), nil
}

func HashRefreshToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}
