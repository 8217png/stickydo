// Package migrations 把 SQL 迁移文件嵌入二进制，服务启动时用 goose 执行。
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
