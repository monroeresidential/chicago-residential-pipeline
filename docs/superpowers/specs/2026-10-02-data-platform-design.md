# Data Platform (Grok → API → Review Queue → Site + MCP) — Design

**Date:** 2026-10-02
**Status:** Draft for review
**Builds on:** `2026-09-28-chicago-pipeline-map-design.md`, `2026-09-28-llm-friendly-design.md` (both live)
**Companion:** `2026-10-02-grok-submission-api.md` (the instructions handed to Grok)

## 1. Purpose

Replace the hand-edited `data/projects.csv` with a Postgres-backed data platform that:

- receives the permit and zoning records Grok scrapes every day, through an authenticated API;
- holds every push in a review queue — **nothing Grok sends is published without approval**;
- links filings (permits, rezonings, hearings, ZBA cases) to curated projects over time;
- stores every shared fact (PIN, address, identifiers, names) once, in one canonical format;
- records the full history of every change;
- feeds the public site at build time and exposes the data over a public read API and an MCP server.

**Success criteria**

- Grok can POST a day's records with a submit-only token and get a per-record result; re-sending
  the same data creates no new review work.
- Drew can review, approve (singly or in bulk), link, edit, delete and restore records through
  Claude (MCP), and see the history of any record.
- A rezoning approved in 2025 and a permit issued nine months later for the same building end
  up linked to one project, with the second link suggested as "strong" when the permit cites
  the ordinance or DPD app #.
- After the switchover, the site renders the same 29 projects / 4,321 units / $1.84B as today,
  plus a filings timeline on each project page.
- If the server is down, the public site keeps working.

## 2. Scope and stages

One spec, three stages, each with its own implementation plan and each useful on its own:

1. **Data platform core** (this spec in full detail): Postgres + API + MCP on a DigitalOcean
   droplet; Grok submissions; review queue; normalization; matching; history; public read API;
   import of `projects.csv` and Grok's history; deploy pipeline; local dev from production data.
2. **Site on the API:** `loadProjects()` reads the API at build time; filings timeline on project
   pages; rebuild on publish; retire `projects.csv`.
3. **Admin page:** queue and record editor behind Cloudflare Access, using the same REST endpoints.

**Out of scope:** OAuth for claude.ai/desktop custom connectors (bearer tokens in Claude Code
first); public map layers of unlinked filings; vector search (pgvector is installed, unused);
routing Formspree suggestions into the queue; changes to how Grok scrapes.

## 3. Decisions

| Topic | Decision |
|---|---|
| Review | Every Grok record goes through the queue. Drew's own edits (editor token) apply directly and are recorded in history. |
| Public site | Projects only, plus the filings linked to each published project. Unlinked filings stay private. |
| Review surface | MCP first (stage 1), admin page later (stage 3). |
| API/MCP access | Public read of published data; editor tier for everything else. |
| Hosting | Docker Compose on one DigitalOcean droplet; site stays static on Cloudflare Workers. |
| Database | Postgres 17 + PostGIS; pgvector extension installed for later. |
| Repo | One repo: site, `shared/`, `server/`. Site and server build and deploy separately. |

## 4. Architecture

```
Grok (daily, 7:39 CT) ── POST /v1/submissions (submitter JWT) ──┐
                                                                ▼
Claude Code (MCP) ── /mcp (editor JWT) ──►  api: Hono on Node 24 (TypeScript)  ──►  db: Postgres 17
Public / agents ── GET /v1/… , /mcp ────►   behind Caddy, behind Cloudflare         + PostGIS + pgvector
                                                │
                      publish-affecting change ─┴─► trigger site build ──► Cloudflare Workers (static site)
```

**Compose services** (`server/compose.yaml`):

- `db` — custom image `FROM postgis/postgis:17-3.5` adding the `pgvector` package; data on a named volume.
- `api` — the API, MCP server, rebuild trigger and scheduled jobs (missed-run check, debounce timer) in one Node process.
- `caddy` — TLS termination with a Cloudflare Origin CA certificate; port 443 only; rejects plain HTTP.
- `backup` — nightly `pg_dump -Fc` to DigitalOcean Spaces, 30-day retention.

**Transport security.** `api.chicagopipeline.com` is proxied by Cloudflare with SSL mode *Full (strict)*.
The DigitalOcean firewall allows 443 only from Cloudflare's published IP ranges and 22 from
Drew's/CI's addresses. MCP uses the streamable HTTP transport, served only over HTTPS. Tokens
travel only in the `Authorization` header. Cloudflare rate-limits public routes.

## 5. Authentication

- Tokens are JWTs (HS256) signed with a server secret, claims `sub`, `role`, `jti`, `iat`. A token
  is valid only if its `jti` is in the `tokens` table and not revoked, so a single token can be
  revoked without rotating the secret. The table stores `jti`, `sub`, `role`, created/revoked/last-used
  times — never the token itself.
- Roles: **`submitter`** — `POST /v1/submissions` only (Grok). **`editor`** — everything (Drew).
  No token — public read routes and public MCP tools.
- Tokens are issued and revoked only from the server shell:
  `docker compose exec api pnpm token issue <sub> --role <role>` / `pnpm token revoke <jti>`.
  No API or MCP route can create tokens.

## 6. Data model

All tables have `created_at`, `updated_at`. Records that can be deleted use `deleted_at`
(soft delete); deleted rows are hidden from every read except history and `restore_*`.

### 6.1 Canonical shared values (stored once)

| Table | Key / canonical form |
|---|---|
| `parcels` | `pin` text, 14 digits, digits only. 10-digit PINs get `0000` appended. Displayed as `17-09-123-004-0000`. |
| `addresses` | `number_from`, `number_to` (equal for a single number), `predir` (N/S/E/W), `street_name` (uppercase, as in the city street list), `suffix` (USPS abbreviation: ST, AVE, BLVD…), `zip` (5 digits), `point` geography(Point). Unique on (number_from, number_to, predir, street_name, suffix). |
| `identifiers` | (`type`, `value`) unique. Types: `dpd_app_no` (digits, e.g. `23020`), `record_number` (uppercase, e.g. `O2026-0025202`), `matter_key`, `elms_matter_id` (lowercase GUID), `zba_case_no` (e.g. `420-24-S`), `permit_number`. |
| `organizations` | `name_key` unique (uppercase, punctuation and extra spaces removed, `L.L.C.`/`L L C` → `LLC`, `INC.` → `INC`), `display_name`. `organization_aliases` maps other spellings seen to the organization. |
| `community_areas` | the 77 areas: `number` (PK), `name`. Stored by number everywhere. |
| `zoning_districts` | canonical code (`B3-2`, `DX-12`, `PD 1234`). |

Wards are integers 1–50 with a check constraint. Dates are `date`; money is whole dollars
(`bigint`); unit counts are integers; Y/N fields are nullable booleans.

Join tables connect records to shared values: `filing_parcels`, `filing_addresses`,
`filing_identifiers`, `filing_organizations` (with `role`: applicant, owner, attorney, contractor,
architect, other), and the same four for projects where curated (`project_addresses`, …).

### 6.2 Records

**`projects`** — the curated pipeline. Columns mirror today's CSV: `id` (slug PK), `dpd_map_no`,
`name`, `developer_org_id`, `units`, `units_source_filing_id`, `affordable_units`, `tpc_usd`,
`program`, `public_support`, `status`, `status_note`, `flag`, `confidence`, `built_by_3f_url`,
`point` (map pin), `sources` (text[] of URLs), `notes`, plus `visibility` (`draft` | `published`),
`deleted_at`. Primary address and parcels come through `project_addresses` / `project_parcels`.
Enum values come from `shared/` (today's `src/lib/constants.ts`).

**`filings`** — accepted Grok records. `id` (PK), `kind` (`permit` | `zoning_matter` |
`hearing_item` | `zba_case`), `source_key` (unique with `kind`), and typed common columns:
`primary_address_id`, `point`, `community_area`, `ward`, `units`, `status`, `event_date`
(issue/filed/hearing date used for timelines), `in_target`, `flag`, `notes`, `source_url`
(official city URL). Kind-specific fields go in `attributes jsonb`, validated by the Zod schema
for that kind (see the companion Grok document for every field). Fields represented by a
canonical table (§6.1) are never also kept in `attributes`.

**`project_filings`** — (`project_id`, `filing_id`) unique; `role` (`zoning`, `hearing`,
`permit`, `early_signal`), `linked_by`, `linked_at`, `reason` (text, e.g. "ordinance cited").

### 6.3 Intake

**`submissions`** — every request from Grok exactly as received: `id`, `token_jti`,
`idempotency_key` (unique per token), `body_sha256`, `body` (jsonb), `response` (jsonb),
`received_at`. Read-only audit log; read only for replay and idempotent responses.

**`queue_items`** — one per record in a submission: `id`, `submission_id`, `record_index`,
`kind`, `source_key`, `action` (`create` | `update`), `proposed` (normalized record, jsonb),
`diff` (per-field old/new against the accepted filing), `normalization_issues` (jsonb list),
`suggestions` (project matches with strength and reasons; possible duplicate shared values),
`state` (`pending` | `approved` | `rejected` | `superseded` | `no_change`), `reviewed_by`,
`reviewed_at`, `review_note`.

### 6.4 History

**`revisions`** — `id`, `table_name`, `record_id`, `version` (per record, from 1), `op`
(`insert` | `update` | `delete` | `restore` | `merge`), `before` jsonb, `after` jsonb,
`actor` (token `sub`, e.g. `drew`, `grok`, `import`), `reason` (`queue_item:<id>`, `admin_edit`,
`import`, `merge:<id>`, `revert:<revision id>`), `at`.

A single PL/pgSQL trigger function is attached to `projects`, `filings`, `project_filings`, the
§6.1 tables and their join tables. The API opens every write transaction with
`set_config('app.actor', …, true)` and `set_config('app.reason', …, true)`; the trigger refuses
writes when `app.actor` is unset, so no code path can skip history. Soft deletes are recorded as
`delete`. `revert(record, version)` writes the old values back as a new revision.

## 7. Normalization

One TypeScript module, `shared/normalize/`, used by the API and the site. Every incoming record
is normalized **before** it is diffed or queued, so format-only differences (`W.` vs `W`, PIN with
or without dashes) produce `no_change`.

- **PIN:** strip non-digits; 10 digits → append `0000`; anything other than 14 digits is an issue.
- **Address:** uppercase; remove periods; split ranges (`111-123`, `111 - 123`, `111 TO 123`);
  directions to N/S/E/W; suffixes to USPS abbreviations; validate `street_name` against the city
  street list (Chicago Data Portal street names, vendored as `shared/data/streets.json`);
  ZIP to 5 digits. Unit/suite designators are dropped from the address and kept in `notes`.
- **Identifiers:** as in §6.1 (`APP23020T1` → `dpd_app_no` `23020`; record numbers uppercase;
  `matter_key` = record number without a leading `S`).
- **Organizations:** compute `name_key`; exact `name_key` matches reuse the organization.
- **Community area:** accept `21`, `Avondale`, `21 Avondale` → `21`. Ward, numbers, dates and
  booleans are type-checked.

A value that cannot be normalized (unknown street, malformed PIN, unknown community area) is
listed in `normalization_issues`; the queue item cannot be approved until the reviewer supplies
a corrected value or clears the field. Raw values never reach the record tables.

**Near-duplicates** are suggested, never merged automatically: organizations whose `name_key`
is within a small edit distance (OCR artifacts such as `I],`) or matches after dropping
`ESQ`/`LLC`/`INC`; addresses on the same street whose ranges overlap. `merge(type, from, into)`
repoints every reference to the surviving row, soft-deletes the other and records `merge` revisions.

**Same fact vs. different facts.** Different spellings of one fact collapse into one row.
Different values from different sources (a rezoning says 220 units, the permit 214) stay on their
own filings; the project shows the value Drew chooses, with `units_source_filing_id`.

## 8. Matching

**Same filing:** (`kind`, `source_key`) exact. Every record number a matter has carried is kept in
`filing_identifiers`, so renumbering still matches.

**Filing → project suggestions.** A filing matching any filing already linked to a project counts
as matching that project. Signals:

| Signal | Strength |
|---|---|
| Shared identifier: DPD app #, record/ordinance # (including ones cited in a permit's `permit_condition`), eLMS GUID; Grok's CPC→eLMS link | strong |
| Shared parcel (PIN) | strong |
| Same street with overlapping number range | likely |
| Within 40 m of the project point or of a linked filing (PostGIS `ST_DWithin`) | possible; likely when combined with an address match |
| Shared organization | tie-breaker only (raises possible → likely, never to strong) |

Suggestions list the project, strength and human-readable reasons, sorted strongest first. Links
are created only by a reviewer. When a filing is approved and linked, the matcher may also suggest
a project status change from the filing kind (e.g. new-construction or renovation permit issued
→ `permitted`); it is applied only if the reviewer accepts it.

## 9. Grok submission API

Full instructions, field lists and examples are in the companion document. Summary:

- `POST /v1/submissions`, `Authorization: Bearer <submitter JWT>`, `Idempotency-Key: <run_id>`.
  Body: `{ run: { program, run_id, started_at, bot_version }, records: [ { kind, source_key,
  observed_at, data, field_sources? } ] }`. At most 500 records per request.
- Grok sends the **full current version** of every record found in the run (target area and
  citywide); the server computes differences.
- Each record is validated, normalized and compared independently. Outcomes per record:
  `queued_create`, `queued_update` (with `changed` field names), `no_change`, `invalid` (with
  `errors[]`). A newer push for a record with a pending item marks the older item `superseded`.
  Data identical to a rejected item returns `no_change`.
- Status codes: `202` processed (even if some records are invalid); `400` malformed envelope;
  `401` missing/invalid/revoked token; `403` wrong role; `409` idempotency key reused with a
  different body; `413` more than 500 records; `429` rate-limited. Replaying an identical request
  returns the stored response.
- `?dry_run=true` validates and reports outcomes without writing. `GET /v1/schema/submission.json`
  serves the JSON Schema generated from the Zod schemas.
- **Grok's run order:** write the pending JSON → POST it (chunked) → only on all-2xx, run its
  `commit` step. On failure, skip the commit; the next day's overlap re-sends. Sheets writes continue
  in parallel until Drew turns them off.

## 10. Review and editing

**Approve** (`approve(ids, { link_to?, create_project?, overrides?, accept_suggestions? })`) in one
transaction: applies overrides, writes the filing and its shared-value links, optionally links it
to a project or creates a `draft` project from it, optionally applies suggested project changes
and merges, and marks the item `approved`. **Reject** stores a reason.

**Bulk review** is two-step: `bulk_review({ filter, action })` returns the count, a 10-item sample
and a `confirm` code valid for 10 minutes; calling it again with the code executes. Filters: kind,
`in_target`, flag present, action, suggestion strength, has normalization issues, submission.

**Direct editing** (editor token): create/update/soft-delete/restore projects and filings,
link/unlink, merge shared values, revert to a version. These skip the queue and are recorded in
history with reason `admin_edit`.

**Publishing.** A change is publish-affecting if it touches a `published` project or a filing
linked to one. Publish-affecting changes start a 10-minute debounce timer; when it fires, the API
triggers a site build. `publish_site` triggers immediately. The trigger uses the Workers Builds
API if it supports starting a build for the connected branch; otherwise a GitHub Actions workflow
(`repository_dispatch`) running `wrangler deploy`. Which one is confirmed in the stage-2 plan.

## 11. Read API and MCP

**Public REST** (no token, cached at Cloudflare for 5 minutes):
`GET /v1/projects?include=filings` (all published projects, the site's build input),
`GET /v1/projects/:id`, `GET /v1/projects.geojson` (same shape as today's `/data/projects.geojson`),
`GET /v1/stats`, `GET /healthz`.

**Editor REST** mirrors every MCP editor tool (`/v1/queue…`, `/v1/filings…`, `/v1/projects…`
writes, `/v1/history…`), so the stage-3 admin page needs no new server logic.

**MCP** (`https://api.chicagopipeline.com/mcp`, streamable HTTP):

| Tier | Tools |
|---|---|
| Public | `search_projects`, `get_project`, `pipeline_stats` |
| Editor — queue | `queue_summary`, `list_queue`, `get_queue_item`, `approve`, `reject`, `bulk_review` |
| Editor — records | `search_filings`, `get_filing`, `match_candidates`, `link`, `unlink`, `create_project`, `update_project`, `update_filing`, `delete_project`, `delete_filing`, `restore_project`, `restore_filing`, `merge` |
| Editor — history | `history`, `revert`, `publish_site` |

Drew connects from Claude Code with
`claude mcp add --transport http chicago-pipeline https://api.chicagopipeline.com/mcp --header "Authorization: Bearer <editor token>"`.

## 12. Site switchover (stage 2)

- `loadProjects()` fetches `GET /v1/projects?include=filings` from `API_URL` at build time and
  validates it with the shared Zod schema; any invalid record or unreachable API fails the build,
  leaving the live site unchanged.
- All existing outputs keep their shape; the CSV/JSON/GeoJSON downloads are generated from the API
  data. `DATA_AS_OF` becomes the API's last-publish time.
- Project pages, `/projects/<id>.md` and `llms-full.txt` gain a filings timeline (newest first):
  kind, date, one-line summary, link to the official city source. Drive PDF links are never public.
- CI and unit/e2e tests use `tests/fixtures/published.json` (a committed snapshot of the API
  response) instead of the live API; a contract test checks the fixture against the API schema.

**Migration order:** (1) import `projects.csv` through the normalizers; (2) round-trip test —
API output reproduces 29 projects / 4,321 units / $1.84B and every field; (3) import Grok's history
as one large submission and review the matching batch (strongest first, bulk-approvable);
(4) switch `loadProjects()`; (5) freeze `projects.csv`, delete it one release later, README notes
the database is the source of truth; (6) Drew turns off Grok's Sheets writes when ready.

## 13. Repo, local development and deploys

```
shared/   Zod schemas, enums, normalizers, street list — imported by the site and the server
server/   Dockerfile, compose.yaml, compose.dev.yaml, migrations/ (plain SQL), src/, tests/
src/, tests/   the site, unchanged layout
```

- **Queries:** Kysely (typed) over plain SQL migrations (PostGIS, triggers, extensions written directly).
- **Local:** `pnpm db:pull` restores the latest nightly production backup into a local Postgres
  container, deletes all `tokens` rows and issues a local editor token. `pnpm server:dev` runs the
  API/MCP on `localhost:8787`; `API_URL=http://localhost:8787 pnpm dev` builds the site against it.
  `pnpm server:replay <submission_id>` re-runs a real past submission locally. Grok only ever
  targets production.
- **Server deploy:** on merge to `main` touching `server/` or `shared/`, a GitHub Action builds the
  image, pushes `ghcr.io/monroeresidential/chicago-pipeline-api:<sha>` (private), SSHes to the
  droplet, takes a backup, runs migrations, restarts, checks `/healthz`, and redeploys the previous
  tag if the check fails.
- **Site deploy:** Workers Builds as today, with build watch paths excluding `server/` so
  server-only changes don't rebuild the site.
- Every migration is run locally against a fresh production restore before merging. No staging server.

## 14. Operations

- Droplet: 2 GB RAM, DigitalOcean droplet backups on, plus nightly `pg_dump` to Spaces (30 days).
- Uptime check on `/healthz`. **Missed-run alert:** if no submission from the `submitter` token
  has arrived by 9:30 CT, the API emails Drew (Resend, same provider as the Monroe site form).
- Logs: `docker compose logs`; the API logs one JSON line per request (no token values, no bodies).
- Secrets (`JWT_SECRET`, database password, Spaces keys, build-trigger token, Resend key) live in
  `server/.env` on the droplet only; `.env*` is git-ignored and covered by the private-guard test.

## 15. Error handling

| Condition | Behavior |
|---|---|
| Grok sends an invalid record | That record returns `invalid` with paths and messages; others proceed. |
| Grok retries after a timeout | Same `Idempotency-Key` + body → stored response; nothing duplicated. |
| Value can't be normalized | Queued with `normalization_issues`; approval blocked until fixed. |
| eLMS status moves backwards | Shown as a normal diff; reviewer decides. |
| Server down | Grok's POST fails → Grok skips its commit and re-sends next day; public site unaffected. |
| API unreachable during site build | Build fails; live site unchanged; Workers Builds emails. |
| Write without actor | Trigger raises; transaction rolls back. |
| Migration or deploy fails health check | Previous image redeployed; pre-deploy backup available. |

## 16. Testing

- **Unit (shared/):** normalizers with real messy values from Grok's data (PIN formats, address
  ranges, OCR'd names, community-area spellings); matcher signal scoring; diff/no-change logic.
- **Integration (server/, real PostGIS in CI as a service container):** submit → queue → approve →
  link → history → public read; superseded and rejected-then-resent paths; idempotency; dry run;
  bulk-review confirm flow; every route and MCP tool refuses roles below its tier; trigger refuses
  writes without an actor; soft delete hides records from public reads.
- **Contract:** every example in the Grok document validates against `/v1/schema/submission.json`;
  `tests/fixtures/published.json` matches the API response schema; CSV import round-trips with
  identical totals and fields.
- **Site:** existing unit and e2e suites run against the fixture; new e2e test for the filings timeline.
