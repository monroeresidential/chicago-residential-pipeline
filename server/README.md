# Chicago Pipeline data platform — operator's guide

The API, review queue and MCP server behind chicagopipeline.com. Design:
`docs/superpowers/specs/2026-10-02-data-platform-design.md`; Grok's wire format:
`docs/superpowers/specs/2026-10-02-grok-submission-api.md`.

## 1. What runs where

One DigitalOcean droplet runs a Docker Compose stack from `/opt/chicago-pipeline/server` (a clone of this repo):

| Service | What it is |
|---|---|
| `db` | Postgres 17 + PostGIS + pgvector (`server/db/Dockerfile`), data in the `pgdata` volume |
| `api` | API + MCP + scheduler (`ghcr.io/monroeresidential/chicago-pipeline-api:<sha>`), port 8787 inside the stack only |
| `caddy` | HTTPS on 443 with the Cloudflare Origin certificate; the only published port |
| `backup` | on demand (`--profile tools`): `pg_dump` to DigitalOcean Spaces, 30-day retention |

Files on the droplet that are **not** in git: `server/.env` (secrets, from `.env.example`), `server/certs/origin.pem`
and `origin-key.pem`, `server/.api_tag` (the deployed image tag, written by the deploy script).

## 2. One-time droplet setup

Drew does the dashboard steps; the shell steps run over SSH.

1. **Droplet:** Ubuntu 24.04, Basic, 2 GB RAM, region NYC3, weekly backups on, Drew's SSH key. Note the IP.
2. **Cloud Firewall** attached to the droplet: inbound TCP 443 from every Cloudflare range listed at
   https://www.cloudflare.com/ips/ (IPv4 and IPv6); inbound TCP 22 from Drew's current IP only; outbound all.
   Note the firewall id (`doctl compute firewall list`). The deploy workflow opens 22 for its runner and closes it again.
3. **On the droplet as root:**
   ```bash
   curl -fsSL https://get.docker.com | sh
   adduser --disabled-password --gecos "" deploy && usermod -aG docker deploy
   install -d -m 700 -o deploy -g deploy /home/deploy/.ssh   # put the CI deploy key's public half in authorized_keys
   git clone https://github.com/monroeresidential/chicago-residential-pipeline /opt/chicago-pipeline
   chown -R deploy:deploy /opt/chicago-pipeline
   ```
4. **As `deploy`:** `docker login ghcr.io -u <github user>` with a GitHub token that has only `read:packages`.
5. **Secrets:** `cp server/.env.example server/.env`, fill it in (`openssl rand -hex 24` for `POSTGRES_PASSWORD`,
   `openssl rand -hex 32` for `JWT_SECRET`, the Spaces key, the Resend key, `ALERT_FROM`, `ALERT_TO`), `chmod 600 server/.env`.
6. **Cloudflare (chicagopipeline.com zone):**
   - DNS: `A api → <droplet IP>`, **Proxied**.
   - SSL/TLS → Origin Server → Create certificate for `api.chicagopipeline.com` (15 years). Save the certificate as
     `server/certs/origin.pem` and the key as `server/certs/origin-key.pem` (`chmod 600`).
   - Rules → Configuration Rules: hostname equals `api.chicagopipeline.com` → SSL **Full (strict)**.
   - Security → WAF → Rate limiting rule: hostname `api.chicagopipeline.com` and URI path does not start with
     `/v1/submissions` → 100 requests per minute per IP → block for 1 minute.
7. **Spaces:** private bucket `chicago-pipeline-backups` and an access key limited to it.
8. **Nightly backup** (`crontab -e` as `deploy`; 08:15 UTC = 3:15 am CT):
   `15 8 * * * cd /opt/chicago-pipeline/server && docker compose --profile tools run --rm backup >> /home/deploy/backup.log 2>&1`
9. **Uptime:** DigitalOcean Monitoring → Uptime → HTTPS check on `https://api.chicagopipeline.com/healthz`, alert email to Drew.
10. **GitHub** → Settings → Environments → `production`, secrets: `DO_API_TOKEN` (a DigitalOcean token that can edit
    firewalls), `DO_FIREWALL_ID`, `DEPLOY_HOST` (droplet IP), `DEPLOY_SSH_KEY` (private half of the deploy key),
    `DEPLOY_KNOWN_HOSTS` (output of `ssh-keyscan <droplet IP>`).
11. **Cloudflare Workers Builds** → chicago-pipeline → Settings → Build → Build watch paths: include `*`, exclude
    `server/*`, so server-only changes don't rebuild the site.

## 3. Deploys

- Automatic on every merge to `main` that touches `server/`, `shared/`, `src/lib/` or `data/projects.csv`
  (`.github/workflows/deploy-server.yml`); manual from Actions → **Deploy server** → Run workflow.
- The workflow runs the server tests, pushes the image to GHCR tagged with the commit, opens SSH for its own IP,
  checks out the commit on the droplet and runs `server/deploy/deploy.sh <sha>`: pull image → build db/backup images →
  backup → migrate → restart and wait for health checks. If health checks fail, the api goes back to the tag in
  `.api_tag`.
- Migrations are forward-only. Undoing one means writing a new migration (the pre-deploy backup is the safety net).

## 4. Everyday commands

Run in `/opt/chicago-pipeline/server` as `deploy`:

```bash
docker compose logs -f api                                         # request log, one JSON line per request
docker compose exec api node dist/token.js issue grok --role submitter
docker compose exec api node dist/token.js issue drew --role editor
docker compose exec api node dist/token.js list
docker compose exec api node dist/token.js revoke <jti>
docker compose exec api node dist/import-csv.js data/projects.csv   # one time only
docker compose --profile tools run --rm backup                      # backup now
```

**Restore a backup** (production; writers stopped, restored into a fresh database, checked before switching):

```bash
docker compose stop api                                    # nothing writes while restoring
docker compose --profile tools run --rm -v /tmp:/out --entrypoint sh backup -c \
  'aws --endpoint-url "$SPACES_ENDPOINT" s3 cp "s3://$SPACES_BUCKET/backups/<file>.dump" /out/restore.dump'   # aws lives in the backup image
docker compose exec -T db psql -U pipeline -d postgres -c "create database pipeline_restore"
docker compose exec -T db pg_restore -U pipeline -d pipeline_restore --no-owner --exit-on-error --single-transaction < /tmp/restore.dump
docker compose exec -T db psql -U pipeline -d pipeline_restore -c "select count(*) from projects; select max(name) from schema_migrations;"
# compare the latest migration with server/migrations in the deployed commit; if older, the next step applies the rest
docker compose exec -T db psql -U pipeline -d postgres \
  -c "alter database pipeline rename to pipeline_before_restore" -c "alter database pipeline_restore rename to pipeline"
docker compose run --rm --no-deps api node dist/migrate.js
docker compose up -d --wait api && curl -fsS -k --resolve api.chicagopipeline.com:443:127.0.0.1 https://api.chicagopipeline.com/healthz
# keep pipeline_before_restore until the restored data is confirmed, then: drop database pipeline_before_restore
```

`--exit-on-error --single-transaction` makes a failed restore leave `pipeline_restore` empty instead of half-restored;
the live database is only swapped once the restore succeeded.

## 5. Local development

```bash
pnpm db:up              # Postgres on localhost:5433 (databases pipeline and pipeline_test)
pnpm server:test        # integration tests
pnpm db:pull            # restore last night's production backup into the local `pipeline` database
pnpm server:dev         # API + MCP on http://localhost:8787
pnpm server:replay <id> # dry-run a past Grok submission through the current code (add --write to apply)
```

`server/.env.local` (git-ignored) holds `DATABASE_URL=postgres://pipeline:pipeline@localhost:5433/pipeline`, a
local `JWT_SECRET` (32+ characters), and for `db:pull` a read-only Spaces key: `SPACES_ENDPOINT`, `SPACES_BUCKET`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`. Local tokens: `cd server && pnpm run token issue drew-local --role editor`.
Production tokens never work locally (different `JWT_SECRET`); `db:pull` also revokes them in the copy.

Behind Cloudflare Gateway, build the image with the Gateway CA as a build secret:
`docker build --secret id=ca,src=$NODE_EXTRA_CA_CERTS -f server/Dockerfile .` (from the repo root).

Connect Claude Code to the local server:
`claude mcp add --transport http chicago-pipeline-local http://localhost:8787/mcp --header "Authorization: Bearer <local token>"`

## 6. Connecting Claude Code to production

`claude mcp add --transport http chicago-pipeline https://api.chicagopipeline.com/mcp --header "Authorization: Bearer <editor token>"`

Without a token, the same URL offers only the public tools (`search_projects`, `get_project`, `pipeline_stats`).
