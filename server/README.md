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

## 2. One-time setup

The droplet itself (accounts, SSH, hardening, Docker, and this app's files on the server) is managed by the private
infra repo `monroeresidential/infra` (`~/Github/infra`, Ansible). App secrets live in Bitwarden and infra's Ansible
Vault, never on anyone's laptop. Drew does the dashboard steps.

**Access:** admin login is `ops@161.35.125.21` (`ssh chicago-pipeline`). Root cannot SSH, password logins are refused,
and only `ops` and `deploy` may log in. Break-glass: DigitalOcean Droplet Console as `ops`. The `deploy` account (docker
group, no sudo, owns `/opt/chicago-pipeline`) is used only by the deploy workflow; its key is `restrict`ed (no PTY or
forwarding), so the workflow must keep using plain `ssh deploy@host "<command>"`. A forced `command=` wrapper that only
accepts `deploy <commit sha>` is planned in infra; the workflow's remote command will change with it.

1. **Droplet:** Ubuntu 24.04, Basic, 2 GB RAM, weekly backups on, IP `161.35.125.21`. Region: the README originally
   said NYC3 but the droplet's hostname says `nyc1` — confirm in the dashboard. (If it is NYC1, the Spaces bucket can
   stay in NYC3.)
2. **Cloud Firewall:** managed by infra's `playbooks/cloud.yml` — inbound TCP 443 from Cloudflare's ranges, inbound 22
   from admin IPs, outbound all. The deploy workflow temporarily adds and then removes an SSH rule for its runner on the
   same firewall, so **don't run `cloud.yml` while a deploy is running** (one could remove the other's rule).
3. **Server shell setup** (Docker, `deploy` user, clone to `/opt/chicago-pipeline`): done by the infra repo
   (`ansible-playbook playbooks/site.yml`, app role `app_chicago_pipeline`).
4. **GHCR login for `deploy`:** done by infra's app role (read-only `read:packages` token from its Vault).
5. **`server/.env`:** written by infra's app role from its Vault (mode 600). Values: `POSTGRES_PASSWORD`, `JWT_SECRET`,
   the Spaces key, `RESEND_API_KEY`, `ALERT_FROM`, `ALERT_TO`, optional `SITE_BUILD_HOOK_*`. It must **not** set
   `API_TAG`: compose defaults to the locally tagged `:deployed` image that `deploy.sh` maintains.
6. **Cloudflare (chicagopipeline.com zone)** — Drew in the dashboard:
   - DNS: `A api → 161.35.125.21`, **Proxied**.
   - SSL/TLS → Origin Server → Create certificate for `api.chicagopipeline.com` (15 years) and store it in infra's
     Vault; infra's app role writes `server/certs/origin.pem` and `origin-key.pem` (mode 600).
   - Rules → Configuration Rules: hostname equals `api.chicagopipeline.com` → SSL **Full (strict)**.
   - Security → WAF → Rate limiting rule: hostname `api.chicagopipeline.com` and URI path does not start with
     `/v1/submissions` → 100 requests per minute per IP → block for 1 minute.
7. **Spaces:** private bucket `chicago-pipeline-backups` and an access key limited to it (stored in infra's Vault).
8. **Nightly backup** (08:15 UTC = 3:15 am CT): the `deploy` crontab entry is installed by infra's app role.
9. **Uptime:** DigitalOcean Monitoring → Uptime → HTTPS check on `https://api.chicagopipeline.com/healthz`, alert email to Drew.
10. **GitHub** → Settings → Secrets and variables → Actions → **Repository secrets** (not environment secrets):
    - `DEPLOY_SSH_KEY` — private half of the ed25519 key made only for GitHub Actions (Bitwarden SSH key item
      "chicago-pipeline deploy (GitHub Actions)"); infra installs the public half for `deploy`.
    - `DEPLOY_HOST` — `161.35.125.21`
    - `DEPLOY_KNOWN_HOSTS` — a single line:
      `161.35.125.21 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICMEx2/2XhBjOtNJW9gXfIb9ybUB/D2W/mw8SQxvjUXl`
      (`SHA256:FCGnSEHpeYeR74/E5tO2QyFt49aZnWlzSJ8IcINwcOI`, verified against the host).
    - `DO_API_TOKEN` — a DigitalOcean token limited to firewall changes; `DO_FIREWALL_ID` — the droplet's Cloud Firewall.
11. **Cloudflare Workers Builds** → chicago-pipeline → Settings → Build → Build watch paths: include `*`, exclude
    `server/*`, so server-only changes don't rebuild the site.

**Host facts the stack relies on** (set by infra): Docker daemon with `log-driver: local` (20 MB × 5), `live-restore`
and `no-new-privileges` for every container (don't add setuid-based escalation to images); ufw allows 22 and 443 only
(Docker-published ports bypass ufw, so the Cloud Firewall is the real gate); fail2ban on sshd; `/proc` mounted
`hidepid=invisible`. Security updates install daily but never reboot automatically, so every long-running service keeps
`restart: unless-stopped` (compose.yaml does).

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

**Restore a backup** (production): `scripts/restore.sh pipeline-<timestamp>.dump`. It stops the API, restores into
a fresh database all-or-nothing (`--exit-on-error --single-transaction`), refuses to swap if the copy has no projects,
then swaps it in, runs migrations, starts the API and checks HTTPS. Any failure before the swap leaves the live
database untouched and restarts the API. The previous data stays as database `pipeline_before_restore` until you drop it.

**Which image runs:** each successful deploy tags its image `:deployed` (and writes the commit to `.api_tag`), so plain
`docker compose …` commands use the deployed version; no `API_TAG` needed.

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
