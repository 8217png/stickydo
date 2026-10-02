// Package auth 提供密码哈希与令牌签发、校验。
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// argon2id 参数，取 OWASP 推荐的下限：19 MiB 内存、2 次迭代、1 线程。
// 参数写进哈希字符串里，以后调高参数不影响已有用户登录。
type argonParams struct {
	memory  uint32
	time    uint32
	threads uint8
	keyLen  uint32
}

var defaultParams = argonParams{memory: 19 * 1024, time: 2, threads: 1, keyLen: 32}

// HashPassword 返回 PHC 格式的 argon2id 哈希：$argon2id$v=19$m=...,t=...,p=...$salt$hash
func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	p := defaultParams
	key := argon2.IDKey([]byte(password), salt, p.time, p.memory, p.threads, p.keyLen)
	enc := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, p.memory, p.time, p.threads, enc.EncodeToString(salt), enc.EncodeToString(key)), nil
}

var errBadHash = errors.New("auth: 无法解析的密码哈希")

// VerifyPassword 以常数时间比较密码与哈希。
func VerifyPassword(password, encoded string) (bool, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, errBadHash
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false, errBadHash
	}
	var p argonParams
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &p.memory, &p.time, &p.threads); err != nil {
		return false, errBadHash
	}
	enc := base64.RawStdEncoding
	salt, err := enc.DecodeString(parts[4])
	if err != nil {
		return false, errBadHash
	}
	want, err := enc.DecodeString(parts[5])
	if err != nil {
		return false, errBadHash
	}
	got := argon2.IDKey([]byte(password), salt, p.time, p.memory, p.threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}

// dummyHash 用于“邮箱不存在”的登录请求：照样算一次哈希，
// 让响应时间与“密码错误”一致，避免通过耗时探测哪些邮箱已注册。
var dummyHash, _ = HashPassword("sticky-do-dummy-password")

func BurnPasswordCheck(password string) {
	_, _ = VerifyPassword(password, dummyHash)
}
