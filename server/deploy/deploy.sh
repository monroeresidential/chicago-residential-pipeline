#!/usr/bin/env bash
# Called by .github/workflows/deploy-server.yml after it checks out <sha> in /opt/chicago-pipeline.
# Backup → migrate → restart → reload Caddy's config → check HTTPS through Caddy; on failure, roll the api back.
# Migrations are forward-only: a rollback runs the previous image against the already-migrated schema, which is
# safe only while migrations stay additive (new tables/columns/constraints the old code ignores).
set -euo pipefail
sha="$1"
cd "$(dirname "$0")/.."
prev=$(cat .api_tag 2>/dev/null || true)
export API_TAG="$sha"

docker compose pull api
docker compose build db backup
docker compose up -d --wait db
docker compose --profile tools run --rm backup
docker compose run --rm --no-deps api node dist/migrate.js
https_ok() {
  # Through Caddy on this host (origin certificate, so -k), the same path Cloudflare uses.
  curl -fsS -k --max-time 10 --resolve api.chicagopipeline.com:443:127.0.0.1 https://api.chicagopipeline.com/healthz >/dev/null
}
if docker compose up -d --wait --wait-timeout 120 \
   && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile \
   && https_ok; then
  echo "$sha" > .api_tag
  echo "deployed $sha"
else
  echo "health check failed for $sha; rolling back to ${prev:-<none>}" >&2
  if [ -n "$prev" ]; then API_TAG="$prev" docker compose up -d --wait api; fi
  exit 1
fi
