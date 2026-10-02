// Package config 从环境变量读取配置（前缀 STICKYDO_）。
package config

import (
	"errors"
	"time"

	"github.com/kelseyhightower/envconfig"
)

type Config struct {
	// HTTP 监听地址
	Addr string `envconfig:"ADDR" default:":8080"`
	// PostgreSQL 连接串，例如 postgres://stickydo:stickydo@localhost:5432/stickydo?sslmode=disable
	DatabaseURL string `envconfig:"DATABASE_URL" required:"true"`
	// 签名 Access Token 的密钥，至少 32 字节
	JWTSecret string `envconfig:"JWT_SECRET" required:"true"`
	AccessTTL  time.Duration `envconfig:"ACCESS_TTL" default:"15m"`
	RefreshTTL time.Duration `envconfig:"REFRESH_TTL" default:"720h"`
	// 允许跨域访问的前端地址，逗号分隔
	CORSOrigins []string `envconfig:"CORS_ORIGINS" default:"http://localhost:5173"`
	// 启动时自动执行数据库迁移
	AutoMigrate bool `envconfig:"AUTO_MIGRATE" default:"true"`
	// 部署在反向代理后面时打开，才会信任 X-Forwarded-For 获取客户端 IP（用于限流）
	TrustProxy bool `envconfig:"TRUST_PROXY" default:"false"`
	// 日志：text 或 json
	LogFormat string `envconfig:"LOG_FORMAT" default:"text"`
	LogLevel  string `envconfig:"LOG_LEVEL" default:"info"`
}

func Load() (Config, error) {
	var c Config
	if err := envconfig.Process("STICKYDO", &c); err != nil {
		return c, err
	}
	if len(c.JWTSecret) < 32 {
		return c, errors.New("STICKYDO_JWT_SECRET 至少需要 32 个字符")
	}
	return c, nil
}
