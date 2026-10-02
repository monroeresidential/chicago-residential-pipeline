#!/usr/bin/env bash
# Called by .github/workflows/deploy-server.yml after it checks out <sha> in /opt/chicago-pipeline.
# Backup → migrate → restart → wait for health; on failure, roll the api back to the previous image.
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
if docker compose up -d --wait --wait-timeout 120; then
  echo "$sha" > .api_tag
  echo "deployed $sha"
else
  echo "health check failed for $sha; rolling back to ${prev:-<none>}" >&2
  if [ -n "$prev" ]; then API_TAG="$prev" docker compose up -d --wait api; fi
  exit 1
fi
