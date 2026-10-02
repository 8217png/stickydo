#!/usr/bin/env bash
# 备份生产数据库（deploy/docker-compose.prod.yml）：pg_dump 自定义格式（已压缩），保留最近 N 天。
#   deploy/backup.sh
# 环境变量：
#   STICKYDO_BACKUP_DIR        备份目录，默认 <项目>/backups
#   STICKYDO_BACKUP_KEEP_DAYS  保留天数，默认 14
# 定时执行见 README「数据库备份」。
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR="${STICKYDO_BACKUP_DIR:-$PWD/backups}"
KEEP_DAYS="${STICKYDO_BACKUP_KEEP_DAYS:-14}"
COMPOSE=(docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env)

# 备份里有用户数据：只有当前用户可读
umask 077
mkdir -p "$BACKUP_DIR"

out="$BACKUP_DIR/stickydo-$(date +%Y%m%d-%H%M%S).dump"
tmp="$out.partial"
trap 'rm -f "$tmp"' EXIT

"${COMPOSE[@]}" exec -T postgres pg_dump -U stickydo -d stickydo --format=custom > "$tmp"
# 确认备份文件完整可读，再改成正式文件名；写了一半的文件不会被当成备份
"${COMPOSE[@]}" exec -T postgres pg_restore --list < "$tmp" > /dev/null
mv "$tmp" "$out"

# 只在这次备份成功后清理旧备份：备份一直失败时，旧备份不会被删光
find "$BACKUP_DIR" -maxdepth 1 -name 'stickydo-*.dump' -mtime "+$KEEP_DAYS" -delete

echo "$(date '+%F %T') 备份完成：$out（$(du -h "$out" | cut -f1)）"
