#!/usr/bin/env bash
# 从备份恢复生产数据库：会用备份内容覆盖当前数据库。
#   deploy/restore.sh backups/stickydo-20261002-033000.dump
# 恢复期间停止 API 服务，恢复在一个事务里完成，失败时数据库保持原样。
set -euo pipefail
cd "$(dirname "$0")/.."

file="${1:?用法：deploy/restore.sh <备份文件>}"
[ -f "$file" ] || { echo "找不到备份文件：$file" >&2; exit 1; }
COMPOSE=(docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env)

read -r -p "将用 $file 覆盖当前数据库，输入 yes 继续：" answer
[ "$answer" = yes ] || { echo "已取消"; exit 1; }

# 先备份当前数据，恢复错了还能回去
deploy/backup.sh

"${COMPOSE[@]}" stop server
trap '"${COMPOSE[@]}" start server' EXIT
"${COMPOSE[@]}" exec -T postgres pg_restore -U stickydo -d stickydo --clean --if-exists --no-owner --single-transaction < "$file"
echo "恢复完成"
