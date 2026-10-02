#!/usr/bin/env bash
# Restores last night's production backup into the local dev database (server/compose.dev.yaml),
# revokes every production token (they cannot work locally anyway: different JWT secret) and issues a
# local editor token. Needs server/.env.local with DATABASE_URL, JWT_SECRET and read access to Spaces:
#   SPACES_ENDPOINT, SPACES_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env.local; set +a
: "${SPACES_ENDPOINT:?}" "${SPACES_BUCKET:?}" "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
ca=()
if [ -n "${NODE_EXTRA_CA_CERTS:-}" ]; then ca=(-v "$NODE_EXTRA_CA_CERTS:/ca.pem:ro" -e AWS_CA_BUNDLE=/ca.pem); fi

echo "downloading latest backup…"
docker run --rm "${ca[@]}" -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION=us-east-1 \
  -v "$tmp:/out" amazon/aws-cli --endpoint-url "$SPACES_ENDPOINT" s3 cp "s3://$SPACES_BUCKET/backups/latest.dump" /out/latest.dump

dc() { docker compose -f compose.dev.yaml "$@"; }
dc up -d --wait db
dc exec -T db psql -q -U pipeline -d postgres -c "drop database if exists pipeline with (force)" -c "create database pipeline"
dc exec -T db pg_restore -U pipeline -d pipeline --no-owner < "$tmp/latest.dump"
dc exec -T db psql -q -U pipeline -d pipeline -c "update tokens set revoked_at = now() where revoked_at is null"
echo "restored. local editor token:"
pnpm run token issue drew-local --role editor
