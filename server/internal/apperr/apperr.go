// Package apperr 定义业务错误。HTTP 层把它统一转换成 problem+json（RFC 9457）。
package apperr

import (
	"errors"
	"net/http"
)

// Code 与 api/openapi.yaml 中的 ErrorCode 枚举一致，给客户端程序判断用。
type Code string

const (
	BadRequest         Code = "bad_request"
	ValidationFailed   Code = "validation_failed"
	Unauthorized       Code = "unauthorized"
	TokenExpired       Code = "token_expired"
	InvalidCredentials Code = "invalid_credentials"
	EmailTaken         Code = "email_taken"
	WrongPassword      Code = "wrong_password"
	NotFound           Code = "not_found"
	RateLimited        Code = "rate_limited"
	Unavailable        Code = "unavailable"
	Internal           Code = "internal"
)

type Error struct {
	Status int
	Code   Code
	Title  string
	Detail string
	// Fields 是字段级的校验错误，键是请求里的字段名
	Fields map[string]string
}

func (e *Error) Error() string {
	if e.Detail != "" {
		return string(e.Code) + ": " + e.Detail
	}
	return string(e.Code) + ": " + e.Title
}

func New(status int, code Code, title string) *Error {
	return &Error{Status: status, Code: code, Title: title}
}

func (e *Error) WithDetail(detail string) *Error {
	c := *e
	c.Detail = detail
	return &c
}

// Validation 返回字段级校验错误。
func Validation(fields map[string]string) *Error {
	return &Error{Status: http.StatusUnprocessableEntity, Code: ValidationFailed, Title: "提交的内容有误", Fields: fields}
}

// As 取出 err 链中的 *Error；不是业务错误时返回 nil。
func As(err error) *Error {
	var e *Error
	if errors.As(err, &e) {
		return e
	}
	return nil
}

var (
	ErrUnauthorized       = New(http.StatusUnauthorized, Unauthorized, "请先登录")
	ErrTokenExpired       = New(http.StatusUnauthorized, TokenExpired, "登录已过期，请刷新令牌")
	ErrInvalidCredentials = New(http.StatusUnauthorized, InvalidCredentials, "邮箱或密码不正确")
	ErrEmailTaken         = New(http.StatusConflict, EmailTaken, "这个邮箱已经注册过了")
	ErrWrongPassword      = New(http.StatusForbidden, WrongPassword, "当前密码不正确")
	ErrNotFound           = New(http.StatusNotFound, NotFound, "找不到这条记录")
	ErrRateLimited        = New(http.StatusTooManyRequests, RateLimited, "操作太频繁，请稍后再试")
	ErrUnavailable        = New(http.StatusServiceUnavailable, Unavailable, "服务暂时不可用")
)
