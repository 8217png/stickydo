# Sticky-Do 常用命令
#   make gen        由 api/openapi.yaml 和 SQL 生成 Go / TS 代码
#   make db         启动本地 PostgreSQL + Redis（Docker）
#   make dev        启动 API 服务（:8080），连接 make db 的数据库
#   make web        启动前端开发服务器（:5173）
#   make test       服务端测试（需要 Docker）+ 前端类型检查
#   make up / down  用 docker compose 启动 / 停止全部服务

GOTOOL := cd server && go tool -modfile=tools/go.mod
DEV_DB := postgres://stickydo:stickydo@localhost:5432/stickydo?sslmode=disable
DEV_SECRET := dev-only-secret-change-me-0123456789
COMPOSE := docker compose -f deploy/docker-compose.yml

.PHONY: gen gen-go gen-ts db dev web test test-server test-web lint up down migrate-up migrate-down

gen: gen-go gen-ts

gen-go:
	$(GOTOOL) oapi-codegen -config oapi-codegen.yaml ../api/openapi.yaml
	$(GOTOOL) sqlc generate

gen-ts:
	cd web && npm run gen:api

db:
	$(COMPOSE) up -d postgres redis

dev:
	cd server && STICKYDO_DATABASE_URL='$(DEV_DB)' STICKYDO_JWT_SECRET='$(DEV_SECRET)' go run ./cmd/server

web:
	cd web && npm run dev

test: test-server test-web

test-server:
	cd server && go vet ./... && go test -race ./...

test-web:
	cd web && npm run typecheck

migrate-up:
	$(GOTOOL) goose -dir migrations postgres '$(DEV_DB)' up

migrate-down:
	$(GOTOOL) goose -dir migrations postgres '$(DEV_DB)' down

up:
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down
