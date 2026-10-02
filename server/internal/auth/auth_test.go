package auth

import (
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func TestPasswordHashRoundTrip(t *testing.T) {
	h, err := HashPassword("correct horse battery")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(h, "$argon2id$v=19$m=19456,t=2,p=1$") {
		t.Fatalf("unexpected hash format: %s", h)
	}
	if ok, err := VerifyPassword("correct horse battery", h); err != nil || !ok {
		t.Fatalf("correct password rejected: ok=%v err=%v", ok, err)
	}
	if ok, _ := VerifyPassword("wrong", h); ok {
		t.Fatal("wrong password accepted")
	}
	h2, _ := HashPassword("correct horse battery")
	if h == h2 {
		t.Fatal("same password produced identical hashes; salt missing")
	}
}

func TestVerifyPasswordRejectsMalformedHash(t *testing.T) {
	for _, h := range []string{"", "plain", "$argon2i$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA", "$argon2id$v=19$m=x$c2FsdA$aGFzaA"} {
		if _, err := VerifyPassword("x", h); err == nil {
			t.Errorf("expected error for %q", h)
		}
	}
}

func TestAccessTokenRoundTrip(t *testing.T) {
	tk := NewTokens(strings.Repeat("s", 32), 15*time.Minute)
	uid, did := uuid.New(), uuid.New()
	now := time.Now()
	token, exp, err := tk.IssueAccess(uid, did, now)
	if err != nil {
		t.Fatal(err)
	}
	if got := exp.Sub(now); got != 15*time.Minute {
		t.Fatalf("expiry = %v", got)
	}
	p, err := tk.ParseAccess(token, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if p.UserID != uid || p.DeviceID != did {
		t.Fatalf("claims mismatch: %+v", p)
	}
	if _, err := tk.ParseAccess(token, now.Add(16*time.Minute)); err != ErrTokenExpired {
		t.Fatalf("expected ErrTokenExpired, got %v", err)
	}
}

func TestAccessTokenRejectsForgery(t *testing.T) {
	tk := NewTokens(strings.Repeat("s", 32), 15*time.Minute)
	other := NewTokens(strings.Repeat("o", 32), 15*time.Minute)
	now := time.Now()
	forged, _, _ := other.IssueAccess(uuid.New(), uuid.New(), now)
	if _, err := tk.ParseAccess(forged, now); err != ErrTokenInvalid {
		t.Fatalf("token signed with another secret: got %v", err)
	}

	// alg=none 必须被拒绝
	claims := AccessClaims{DeviceID: uuid.NewString(), RegisteredClaims: jwt.RegisteredClaims{
		Issuer: issuer, Subject: uuid.NewString(), ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
	}}
	none, _ := jwt.NewWithClaims(jwt.SigningMethodNone, claims).SignedString(jwt.UnsafeAllowNoneSignatureType)
	if _, err := tk.ParseAccess(none, now); err != ErrTokenInvalid {
		t.Fatalf("alg=none: got %v", err)
	}

	// 其他签发方
	claims.Issuer = "someone-else"
	wrongIss, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(strings.Repeat("s", 32)))
	if _, err := tk.ParseAccess(wrongIss, now); err != ErrTokenInvalid {
		t.Fatalf("wrong issuer: got %v", err)
	}
}

func TestRefreshTokenHash(t *testing.T) {
	tok, hash, err := NewRefreshToken()
	if err != nil {
		t.Fatal(err)
	}
	if len(tok) < 40 || len(hash) != 32 {
		t.Fatalf("token len %d hash len %d", len(tok), len(hash))
	}
	if string(HashRefreshToken(tok)) != string(hash) {
		t.Fatal("hash mismatch")
	}
	tok2, _, _ := NewRefreshToken()
	if tok == tok2 {
		t.Fatal("refresh tokens repeat")
	}
}
