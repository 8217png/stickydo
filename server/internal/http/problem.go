package httpserver

import (
	"encoding/json"
	"fmt"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"

	"github.com/8217png/stickydo/server/internal/apperr"
	"github.com/8217png/stickydo/server/internal/http/api"
)

// writeProblem 把错误写成 application/problem+json（RFC 9457）。
// 非业务错误一律当作 500，细节只写日志，不返回给客户端。
func writeProblem(w http.ResponseWriter, r *http.Request, log *slog.Logger, err error) {
	e := apperr.As(err)
	if e == nil {
		log.ErrorContext(r.Context(), "unhandled error", slog.String("path", r.URL.Path), slog.Any("err", err))
		e = apperr.New(http.StatusInternalServerError, apperr.Internal, "服务器出了点问题，请稍后再试")
	}
	p := api.Problem{
		Title:  e.Title,
		Status: e.Status,
		Code:   api.ErrorCode(e.Code),
	}
	if e.Detail != "" {
		p.Detail = &e.Detail
	}
	if len(e.Fields) > 0 {
		p.Fields = &e.Fields
	}
	if e.Status == http.StatusUnauthorized {
		w.Header().Set("WWW-Authenticate", `Bearer realm="stickydo"`)
	}
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(e.Status)
	_ = json.NewEncoder(w).Encode(p)
}

// validationError 把 OpenAPI 请求校验失败转换成业务错误：
// 认证失败 → 401；字段不合规 → 422（汇总所有字段）；其余 → 400 / 404 / 405。
func validationError(err error, status int) error {
	if ae := securityError(err); ae != nil {
		return ae
	}
	fields := map[string]string{}
	var reason string
	collectFieldErrors(err, "", fields, &reason)
	if len(fields) > 0 {
		return apperr.Validation(fields)
	}
	switch status {
	case http.StatusNotFound:
		return apperr.ErrNotFound
	case http.StatusMethodNotAllowed:
		return apperr.New(http.StatusMethodNotAllowed, apperr.BadRequest, "不支持这个请求方法")
	}
	e := apperr.New(http.StatusBadRequest, apperr.BadRequest, "请求格式不正确")
	if reason != "" {
		e = e.WithDetail(reason)
	}
	return e
}

// securityError 找出认证失败（包括嵌在 MultiError 里的），返回对应的业务错误。
func securityError(err error) *apperr.Error {
	if multi, ok := err.(openapi3.MultiError); ok {
		for _, e := range multi {
			if ae := securityError(e); ae != nil {
				return ae
			}
		}
		return nil
	}
	var sec *openapi3filter.SecurityRequirementsError
	if !errors.As(err, &sec) {
		return nil
	}
	for _, e := range sec.Errors {
		if ae := apperr.As(e); ae != nil {
			return ae
		}
	}
	return apperr.ErrUnauthorized
}

// collectFieldErrors 遍历校验错误树（MultiError / RequestError / SchemaError），
// 把每个字段的第一条错误收集到 fields。param 是当前所在的参数名（路径、查询参数）。
func collectFieldErrors(err error, param string, fields map[string]string, reason *string) {
	switch e := err.(type) {
	case openapi3.MultiError:
		for _, sub := range e {
			collectFieldErrors(sub, param, fields, reason)
		}
	case *openapi3filter.RequestError:
		if e.Parameter != nil {
			param = e.Parameter.Name
		}
		if e.Err == nil {
			if param != "" {
				addField(fields, param, "格式不正确")
			} else if *reason == "" {
				*reason = e.Reason
			}
			return
		}
		before := len(fields)
		collectFieldErrors(e.Err, param, fields, reason)
		if len(fields) == before && param != "" {
			addField(fields, param, "格式不正确")
		}
		if len(fields) == before && *reason == "" {
			*reason = e.Reason
		}
	case *openapi3.SchemaError:
		field := strings.Join(e.JSONPointer(), ".")
		if field == "" {
			field = param
		}
		if field == "" {
			field = "body"
		}
		addField(fields, field, fieldMessage(e))
	}
}

func addField(fields map[string]string, k, v string) {
	if _, ok := fields[k]; !ok {
		fields[k] = v
	}
}

func fieldMessage(e *openapi3.SchemaError) string {
	switch e.SchemaField {
	case "required":
		return "必填"
	case "minLength":
		if e.Schema != nil {
			return fmt.Sprintf("至少 %d 个字符", e.Schema.MinLength)
		}
		return "太短了"
	case "maxLength":
		if e.Schema != nil && e.Schema.MaxLength != nil {
			return fmt.Sprintf("最多 %d 个字符", *e.Schema.MaxLength)
		}
		return "太长了"
	case "format":
		if e.Schema != nil && e.Schema.Format == "email" {
			return "请输入有效的邮箱地址"
		}
		return "格式不正确"
	case "enum":
		return "不支持的取值"
	case "type":
		return "类型不正确"
	}
	return "格式不正确"
}
