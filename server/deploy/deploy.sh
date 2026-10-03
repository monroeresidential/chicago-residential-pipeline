#!/usr/bin/env bash
# Called by .github/workflows/deploy-server.yml after it checks out <sha> in /opt/chicago-pipeline.
# Backup → migrate → restart (recreating Caddy if its config changed) → check HTTPS through Caddy → tag the image
# ":deployed". On failure the api goes back to the previous image.
# Migrations are forward-only: a rollback runs the previous image against the already-migrated schema, which is
# safe only while migrations stay additive (new tables/columns/constraints the old code ignores).
set -euo pipefail
sha="$1"
cd "$(dirname "$0")/.."
IMAGE=ghcr.io/monroeresidential/chicago-pipeline-api
prev=$(cat .api_tag 2>/dev/null || true)
export API_TAG="$sha"

https_ok() {
  # Through Caddy on this host (origin certificate, so -k), the same path Cloudflare uses.
  for _ in 1 2 3 4 5 6; do
    curl -fsS -k --max-time 10 --resolve api.chicagopipeline.com:443:127.0.0.1 https://api.chicagopipeline.com/healthz >/dev/null && return 0
    sleep 5
  done
  return 1
}

docker compose pull api
docker compose build db backup
docker compose up -d --wait db
docker compose --profile tools run --rm backup
docker compose run --rm --no-deps api node dist/migrate.js

# Caddy runs with its admin API off, so a config change means recreating the container (a second or two of downtime).
caddy_hash=$(sha256sum Caddyfile | cut -d' ' -f1)
caddy_recreate=()
[ "$caddy_hash" = "$(cat .caddy_hash 2>/dev/null || true)" ] || caddy_recreate=(--force-recreate caddy)

if docker compose up -d --wait --wait-timeout 120 \
   && { [ ${#caddy_recreate[@]} -eq 0 ] || docker compose up -d "${caddy_recreate[@]}"; } \
   && https_ok; then
  docker tag "$IMAGE:$sha" "$IMAGE:deployed"   # every later compose command (no API_TAG set) uses this image
  echo "$sha" > .api_tag
  echo "$caddy_hash" > .caddy_hash
  echo "deployed $sha"
else
  echo "deploy of $sha failed health checks; rolling back to ${prev:-<none>}" >&2
  if [ -n "$prev" ]; then
    # Back to the previous commit's compose.yaml and Caddyfile as well as its image, then prove HTTPS works again.
    git -C .. checkout --quiet --detach "$prev"
    docker tag "$IMAGE:$prev" "$IMAGE:deployed"
    export API_TAG="$prev"
    docker compose up -d --wait --wait-timeout 120
    if [ "$(sha256sum Caddyfile | cut -d' ' -f1)" != "$caddy_hash" ]; then docker compose up -d --force-recreate caddy; fi
    if https_ok; then echo "rolled back to $prev" >&2; else echo "ROLLBACK TO $prev ALSO FAILED HTTPS CHECKS — investigate now" >&2; fi
  fi
  exit 1
fi
