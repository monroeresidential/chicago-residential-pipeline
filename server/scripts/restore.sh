#!/usr/bin/env bash
# Restores a backup from Spaces into production, safely:
# API stopped → download → restore into a fresh database (all-or-nothing) → validate → swap → migrate → start → check.
# Any failure stops before the swap and restarts the API on the untouched live database.
# Usage (in /opt/chicago-pipeline/server, as deploy):  scripts/restore.sh pipeline-2026-10-02T081500Z.dump
set -euo pipefail
dump="${1:?usage: scripts/restore.sh <backup file name in s3://\$SPACES_BUCKET/backups/>}"
cd "$(dirname "$0")/.."
psql() { docker compose exec -T db psql -v ON_ERROR_STOP=1 -U pipeline "$@"; }

docker compose stop api
swapped=0
trap '[ "$swapped" = 1 ] || { echo "restore failed before the swap; live database untouched" >&2; docker compose up -d api; }' EXIT

docker compose --profile tools run --rm -v /tmp:/out --entrypoint sh backup -c \
  "aws --endpoint-url \"\$SPACES_ENDPOINT\" s3 cp \"s3://\$SPACES_BUCKET/backups/$dump\" /out/restore.dump"
psql -d postgres -c "drop database if exists pipeline_restore" -c "create database pipeline_restore"
docker compose exec -T db pg_restore -U pipeline -d pipeline_restore --no-owner --exit-on-error --single-transaction < /tmp/restore.dump
projects=$(psql -d pipeline_restore -At -c "select count(*) from projects")
latest=$(psql -d pipeline_restore -At -c "select max(name) from schema_migrations")
echo "restored copy: $projects projects, latest migration $latest"
[ "$projects" -gt 0 ] || { echo "restored copy has no projects; refusing to swap" >&2; exit 1; }

psql -d postgres -c "drop database if exists pipeline_before_restore" \
  -c "alter database pipeline rename to pipeline_before_restore" -c "alter database pipeline_restore rename to pipeline"
swapped=1
docker compose run --rm --no-deps api node dist/migrate.js
docker compose up -d --wait api
curl -fsS -k --resolve api.chicagopipeline.com:443:127.0.0.1 https://api.chicagopipeline.com/healthz
echo "restore done. The previous data is kept as database pipeline_before_restore; drop it once the restore is confirmed."
