#!/bin/sh
# pg_dump → DigitalOcean Spaces (timestamped + latest.dump); deletes timestamped dumps older than 30 days.
set -eu
: "${SPACES_ENDPOINT:?}" "${SPACES_BUCKET:?}"
stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
file="/tmp/pipeline-$stamp.dump"
pg_dump -Fc -f "$file"
s3() { aws --endpoint-url "$SPACES_ENDPOINT" s3 "$@"; }
s3 cp --only-show-errors "$file" "s3://$SPACES_BUCKET/backups/pipeline-$stamp.dump"
s3 cp --only-show-errors "$file" "s3://$SPACES_BUCKET/backups/latest.dump"
rm -f "$file"
cutoff=$(date -u -d '30 days ago' +%Y-%m-%d)
s3 ls "s3://$SPACES_BUCKET/backups/" | awk '{print $4}' | grep '^pipeline-' | while read -r key; do
  day=$(echo "$key" | cut -c10-19)
  if [ "$day" \< "$cutoff" ]; then s3 rm --only-show-errors "s3://$SPACES_BUCKET/backups/$key"; fi
done
echo "backup ok: pipeline-$stamp.dump"
