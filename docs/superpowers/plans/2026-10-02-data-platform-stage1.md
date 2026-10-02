# Data Platform — Stage 1 (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Postgres-backed data platform — Grok submission API, review queue, normalization, matching, history, editing, public read API and MCP — running as a Docker Compose stack on a DigitalOcean droplet, with local development against restored production data and automated deploys.

**Architecture:** A `server/` package (Hono on Node 24, Kysely over Postgres 17 + PostGIS + pgvector) in the same repo as the site, plus a `shared/` folder of Zod schemas and normalizers. Every incoming record is validated and normalized into a canonical shape, hashed, diffed against the accepted filing, and queued with project-match suggestions; approvals, edits and merges run inside a transaction that sets the acting user, and a Postgres trigger writes the history. REST and MCP are thin layers over one `ops` facade.

**Tech Stack:** TypeScript (strict), Node 24, Hono 4 + @hono/node-server 2, Kysely 0.29 + pg 8, jose 6 (JWT HS256), Zod 4, @modelcontextprotocol/sdk 1.29 (McpServer + WebStandardStreamableHTTPServerTransport), Vitest 5, esbuild, Docker Compose, Caddy 2, Postgres 17 / PostGIS 3.5 / pgvector / fuzzystrmatch.

**Branch:** `data-platform-stage1`, created from `spec-data-platform` (so the spec and this plan travel in the same PR).

**Spec:** `docs/superpowers/specs/2026-10-02-data-platform-design.md` (stage 1) and its companion `docs/superpowers/specs/2026-10-02-grok-submission-api.md` (the exact wire format Grok uses — the Zod schemas in Task 5 must match it field for field).

## Global Constraints

- Node 24 in CI and Docker; pnpm 10.28.0 (`packageManager`); TypeScript `strict`.
- Database: Postgres 17 + PostGIS 3.5 + `vector` + `fuzzystrmatch`, image built from `server/db/Dockerfile`.
- Zod 4 for every schema; the Grok wire format is defined once in `shared/records/schemas.ts`.
- Submissions: at most 500 records per request; request body limit 10 MB; status codes `202/400/401/403/409/413/429` exactly as spec §9.
- Every write to record tables happens inside `withActor(db, actor, reason, fn)`; the history trigger raises when `app.actor` is unset.
- Values are normalized **before** hashing/diffing; raw source values never reach the record tables (only `submissions.body`).
- Matching: shared identifier or PIN = `strong`; overlapping address range = `likely`; within **40 m** = `possible` (`likely` with a shared organization); organization alone never suggests a project. Links are created only by a reviewer.
- Publishing debounce **10 minutes**; bulk-review confirm codes valid **10 minutes**; missed-run alert at **9:30 America/Chicago**; backups kept **30 days**.
- Roles: `submitter` (POST `/v1/submissions` only), `editor` (everything); no token = public read. Tokens are created/revoked only by the CLI inside the container.
- Public output: only `published`, non-deleted projects and the filings linked to them; never `drive_pdf_url`; public routes send `Cache-Control: public, max-age=300` and `Access-Control-Allow-Origin: *`.
- Logs: one JSON line per request; never token values, headers or bodies.
- The repo is public: `.env*` (except `.env.example`) and `server/certs/` are git-ignored; `private/`, `inbox/`, `data/raw/`, `.env*` never enter the Docker build context.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Deviations from the spec (decided while planning — confirm with Drew at plan review)

1. **Project `developer` stays curated text**, not an organization row: today's values are multi-party descriptions ("Mo2 Properties with Monroe Residential; GC 3F Construction"). Organizations come from filings.
2. **Aliases are merged rows**: `organizations.merged_into_id` / `addresses.merged_into_id` replace a separate `organization_aliases` table; a merged row keeps its spelling so future pushes resolve to the survivor.
3. **Zoning district codes** are canonical strings inside `attributes` (e.g. `PD 1234`), no `zoning_districts` table.
4. **`no_change` results are not stored as queue rows** (Grok's re-sends would add thousands of rows a day); they are reported in the response only.
5. **Geocode lives on the address row** (first trusted point wins); filings don't carry their own point. Projects keep their own curated map pin.
6. **Project parcels/identifiers are derived** through linked filings; only the project's primary address is stored on the project (`project_addresses`).
7. **Token CLI inside the container** is `node dist/token.js issue <sub> --role <role>` (no pnpm in the runtime image).
8. A project's public `address` is generated from its canonical address, so a few display strings change (expected: `620 N. LaSalle St` → `620 N. LaSalle Dr`, per the city street list).

## Review Focus

1. Reviewer corrected a value with an override, then Grok re-sends its original value next day → must be `no_change`, not a new queue item (Task 12 test `override then original resend is no_change`).
2. Drew soft-deleted a filing and Grok re-sends it unchanged → `no_change`; changed → queued as `create`, and approving restores it (Task 10 tests `deleted filing resent unchanged is no_change`, `deleted filing resent changed is queued_create`).
3. After merging two spellings of an organization or address, Grok's next push with the old spelling → `no_change` (Task 13 test `push with merged spelling is no_change`).
4. The same `source_key` twice in one submission or across chunks → only the last stays `pending`; earlier ones `superseded` (Task 10 test `same key twice in one submission`).
5. Messy addresses — unit/suite tails, abbreviated ranges (`1601-15`), `LaSalle` vs `LA SALLE`, missing suffix, wrong suffix for the block — normalize to one canonical address and never create a duplicate address row (Task 4 tests + Task 8 test `same address in two spellings is one row`).

## File structure

```
pnpm-workspace.yaml                 workspace: root site + server
.dockerignore                       keeps private/, inbox/, data/raw/, .env* out of image builds
shared/
  constants.ts                      moved from src/lib/constants.ts (site re-exports it)
  data/community-areas.ts           the 77 community areas
  data/streets.json                 city street list [dir, street, suffix, min, max]
  scripts/fetch-streets.ts          refreshes streets.json from the Chicago Data Portal
  normalize/primitives.ts           PIN, identifiers, org name keys, community area, ZIP, zoning
  normalize/address.ts              address parsing, validation, canonical key and display
  records/types.ts                  NormalizedRecord and friends
  records/schemas.ts                Zod wire format (envelope + 4 kinds) and JSON Schema export
  records/normalize-record.ts       wire record → NormalizedRecord + issues
  records/denormalize-record.ts     NormalizedRecord → wire record (for edits)
  records/hash.ts                   stable JSON + content hash
  records/diff.ts                   field-level diff
  tests/*.test.ts                   unit tests (run by root vitest)
server/
  package.json, tsconfig.json, vitest.config.ts, build.mjs, Dockerfile
  compose.yaml, compose.dev.yaml, Caddyfile, .env.example, README.md (runbook)
  db/Dockerfile, db/dev-init.sql    Postgres 17 + PostGIS + pgvector image; test database
  backup/Dockerfile, backup/backup.sh
  deploy/deploy.sh                  run on the droplet by the deploy workflow
  scripts/db-pull.sh                restore latest production backup locally
  migrations/001_extensions_reference.sql, 002_core.sql
  src/config.ts                     env → Config
  src/errors.ts                     HttpError
  src/db/{migrate,client,types,actor}.ts
  src/auth/{tokens,middleware}.ts
  src/store/{shared-values,filings,projects,edit,merge,history,search}.ts
  src/match/{suggest,status,duplicates}.ts
  src/intake/submit.ts
  src/review/{queue,review}.ts
  src/publish/{state,trigger}.ts
  src/read/public.ts
  src/ops.ts                        facade used by REST and MCP
  src/http/{app,logging}.ts, src/http/routes/{public,submissions,editor}.ts
  src/mcp/{tools,server}.ts
  src/jobs/{missed-run,scheduler}.ts
  src/importers/projects-csv.ts
  src/cli/{migrate,token,import-csv,replay}.ts
  src/main.ts
  tests/global-setup.ts, tests/helpers/{db,fixtures,app}.ts, tests/*.test.ts
.github/workflows/server-tests.yml (reusable), ci.yml (calls it), deploy-server.yml
```

---

### Task 1: Workspace, `shared/` and the server package skeleton

**Files:**
- Create: `pnpm-workspace.yaml`, `shared/constants.ts`, `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`, `server/tests/smoke.test.ts`, `.dockerignore`
- Modify: `src/lib/constants.ts` (becomes a re-export), `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `tests/unit/private-guard.test.ts`, `package.json` (scripts)

**Interfaces:**
- Produces: `shared/constants.ts` exporting everything `src/lib/constants.ts` exports today (`STATUSES`, `Status`, `STATUS_LABELS`, `STATUS_COLORS`, `PROGRAMS`, `Program`, `PROGRAM_LABELS`, `DOWNTOWN_BBOX`). Root scripts `server:test`, `server:dev`, `db:up`.

- [ ] **Step 1: Write the failing guard tests**

Append to `tests/unit/private-guard.test.ts` inside the `describe` block:

```ts
  it("ignores server secrets and certificates", () => {
    const out = execSync("git check-ignore server/.env server/.env.local server/certs/origin.pem || true", { encoding: "utf8" });
    expect(out.trim().split("\n")).toEqual(["server/.env", "server/.env.local", "server/certs/origin.pem"]);
  });

  it("keeps .env.example tracked-able", () => {
    expect(execSync("git check-ignore server/.env.example || true", { encoding: "utf8" }).trim()).toBe("");
  });

  it("keeps confidential folders out of Docker build context", () => {
    const lines = readFileSync(".dockerignore", "utf8").split("\n").map((l) => l.trim());
    for (const entry of ["private", "inbox", "data/raw", "**/.env*", "server/certs", ".git", "node_modules"]) {
      expect(lines).toContain(entry);
    }
  });
```

Add `import { readFileSync } from "node:fs";` at the top.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test tests/unit/private-guard.test.ts`
Expected: FAIL — `server/.env.local` and `server/certs/origin.pem` are not ignored; `.dockerignore` does not exist.

- [ ] **Step 3: Update `.gitignore` and add `.dockerignore`**

In `.gitignore` replace the two lines `.env` and `.env.production` with:

```
.env*
!.env.example
server/certs/
server/dist/
```

Create `.dockerignore`:

```
.git
node_modules
**/node_modules
dist
.astro
.wrangler
tiles
test-results
playwright-report
.superpowers
private
inbox
data/raw
**/.env*
!server/.env.example
server/certs
server/dist
```

- [ ] **Step 4: Run the guard tests**

Run: `pnpm test tests/unit/private-guard.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Move constants into `shared/`**

`git mv src/lib/constants.ts shared/constants.ts`, then fix the header comment of `shared/constants.ts` to say it is shared by the site, the browser bundle and the server. Create `src/lib/constants.ts`:

```ts
// The enums live in shared/ so the server uses the same definitions. Keep this file Zod-free.
export * from "../../shared/constants";
```

- [ ] **Step 6: Create the workspace and the server package**

`pnpm-workspace.yaml`:

```yaml
packages:
  - server
```

`server/package.json`:

```json
{
  "name": "server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file-if-exists=.env.local src/main.ts",
    "build": "node build.mjs",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "migrate": "tsx --env-file-if-exists=.env.local src/cli/migrate.ts",
    "token": "tsx --env-file-if-exists=.env.local src/cli/token.ts",
    "import-csv": "tsx --env-file-if-exists=.env.local src/cli/import-csv.ts",
    "replay": "tsx --env-file-if-exists=.env.local src/cli/replay.ts"
  }
}
```

Install dependencies (from the repo root, with the Gateway CA env loaded):

```bash
pnpm --filter server add hono @hono/node-server kysely pg jose zod @modelcontextprotocol/sdk papaparse
pnpm --filter server add -D typescript vitest tsx esbuild @types/pg @types/node @types/papaparse
```

`server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "tests", "../shared", "../src/lib/parse-projects.ts", "../src/lib/geojson.ts", "../src/lib/stats.ts"]
}
```

`server/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
```

`server/tests/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { STATUSES } from "../../shared/constants";

describe("server package", () => {
  it("imports the shared enums", () => {
    expect(STATUSES).toEqual(["completed", "under_construction", "permitted", "approved", "planning"]);
  });
});
```

- [ ] **Step 7: Keep the site's tooling away from `server/` and include `shared/` tests**

`tsconfig.json` → `"exclude": ["dist", "tiles", "server"]`.

`vitest.config.ts` → `include: ["tests/unit/**/*.test.ts", "shared/tests/**/*.test.ts"]`.

Root `package.json` scripts, add:

```json
    "server:dev": "pnpm --filter server dev",
    "server:test": "pnpm --filter server test",
    "server:replay": "pnpm --filter server replay",
    "db:up": "docker compose -f server/compose.dev.yaml up -d --wait",
    "db:pull": "bash server/scripts/db-pull.sh"
```

- [ ] **Step 8: Run everything**

Run: `pnpm test && pnpm check && pnpm --filter server test && pnpm --filter server typecheck`
Expected: all site unit tests PASS, `astro check` 0 errors, server smoke test PASS, typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add -A pnpm-workspace.yaml pnpm-lock.yaml .dockerignore .gitignore shared server src/lib/constants.ts tsconfig.json vitest.config.ts package.json tests/unit/private-guard.test.ts
git commit -m "chore: pnpm workspace with server package and shared constants

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Database image, dev compose, migration runner, reference data

**Files:**
- Create: `server/db/Dockerfile`, `server/db/dev-init.sql`, `server/compose.dev.yaml`, `server/migrations/001_extensions_reference.sql`, `server/src/db/migrate.ts`, `server/src/cli/migrate.ts`, `shared/data/community-areas.ts`, `server/tests/global-setup.ts`, `server/tests/migrate.test.ts`
- Modify: `server/vitest.config.ts` (globalSetup)

**Interfaces:**
- Produces: `migrate(databaseUrl: string, dir: string): Promise<string[]>` (returns newly applied file names); `COMMUNITY_AREAS: readonly { number: number; name: string }[]`; test database URL convention `TEST_DATABASE_URL` default `postgres://pipeline:pipeline@localhost:5433/pipeline_test`.

- [ ] **Step 1: Database image and dev compose**

`server/db/Dockerfile`:

```dockerfile
# Postgres 17 + PostGIS 3.5 (base image) + pgvector (PGDG package, already configured in the base image)
FROM postgis/postgis:17-3.5
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-17-pgvector \
 && rm -rf /var/lib/apt/lists/*
```

`server/db/dev-init.sql`:

```sql
-- Runs once when the dev volume is created: a second database for the test suite.
CREATE DATABASE pipeline_test;
```

`server/compose.dev.yaml`:

```yaml
name: chicago-pipeline-dev
services:
  db:
    build: ./db
    image: chicago-pipeline-db:17
    environment:
      POSTGRES_USER: pipeline
      POSTGRES_PASSWORD: pipeline
      POSTGRES_DB: pipeline
    ports: ["5433:5432"]
    volumes:
      - devdata:/var/lib/postgresql/data
      - ./db/dev-init.sql:/docker-entrypoint-initdb.d/90-dev-init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pipeline -d pipeline_test"]
      interval: 2s
      timeout: 3s
      retries: 60
volumes:
  devdata: {}
```

Run: `pnpm db:up`
Expected: container `chicago-pipeline-dev-db-1` healthy.

- [ ] **Step 2: Community areas constant**

`shared/data/community-areas.ts`:

```ts
// Chicago's 77 community areas, by official number.
export const COMMUNITY_AREAS = [
  { number: 1, name: "Rogers Park" }, { number: 2, name: "West Ridge" }, { number: 3, name: "Uptown" },
  { number: 4, name: "Lincoln Square" }, { number: 5, name: "North Center" }, { number: 6, name: "Lake View" },
  { number: 7, name: "Lincoln Park" }, { number: 8, name: "Near North Side" }, { number: 9, name: "Edison Park" },
  { number: 10, name: "Norwood Park" }, { number: 11, name: "Jefferson Park" }, { number: 12, name: "Forest Glen" },
  { number: 13, name: "North Park" }, { number: 14, name: "Albany Park" }, { number: 15, name: "Portage Park" },
  { number: 16, name: "Irving Park" }, { number: 17, name: "Dunning" }, { number: 18, name: "Montclare" },
  { number: 19, name: "Belmont Cragin" }, { number: 20, name: "Hermosa" }, { number: 21, name: "Avondale" },
  { number: 22, name: "Logan Square" }, { number: 23, name: "Humboldt Park" }, { number: 24, name: "West Town" },
  { number: 25, name: "Austin" }, { number: 26, name: "West Garfield Park" }, { number: 27, name: "East Garfield Park" },
  { number: 28, name: "Near West Side" }, { number: 29, name: "North Lawndale" }, { number: 30, name: "South Lawndale" },
  { number: 31, name: "Lower West Side" }, { number: 32, name: "Loop" }, { number: 33, name: "Near South Side" },
  { number: 34, name: "Armour Square" }, { number: 35, name: "Douglas" }, { number: 36, name: "Oakland" },
  { number: 37, name: "Fuller Park" }, { number: 38, name: "Grand Boulevard" }, { number: 39, name: "Kenwood" },
  { number: 40, name: "Washington Park" }, { number: 41, name: "Hyde Park" }, { number: 42, name: "Woodlawn" },
  { number: 43, name: "South Shore" }, { number: 44, name: "Chatham" }, { number: 45, name: "Avalon Park" },
  { number: 46, name: "South Chicago" }, { number: 47, name: "Burnside" }, { number: 48, name: "Calumet Heights" },
  { number: 49, name: "Roseland" }, { number: 50, name: "Pullman" }, { number: 51, name: "South Deering" },
  { number: 52, name: "East Side" }, { number: 53, name: "West Pullman" }, { number: 54, name: "Riverdale" },
  { number: 55, name: "Hegewisch" }, { number: 56, name: "Garfield Ridge" }, { number: 57, name: "Archer Heights" },
  { number: 58, name: "Brighton Park" }, { number: 59, name: "McKinley Park" }, { number: 60, name: "Bridgeport" },
  { number: 61, name: "New City" }, { number: 62, name: "West Elsdon" }, { number: 63, name: "Gage Park" },
  { number: 64, name: "Clearing" }, { number: 65, name: "West Lawn" }, { number: 66, name: "Chicago Lawn" },
  { number: 67, name: "West Englewood" }, { number: 68, name: "Englewood" }, { number: 69, name: "Greater Grand Crossing" },
  { number: 70, name: "Ashburn" }, { number: 71, name: "Auburn Gresham" }, { number: 72, name: "Beverly" },
  { number: 73, name: "Washington Heights" }, { number: 74, name: "Mount Greenwood" }, { number: 75, name: "Morgan Park" },
  { number: 76, name: "O'Hare" }, { number: 77, name: "Edgewater" },
] as const;
```

- [ ] **Step 3: Write the failing migration test**

`server/tests/migrate.test.ts`:

```ts
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { COMMUNITY_AREAS } from "../../shared/data/community-areas";
import { migrate } from "../src/db/migrate";
import { MIGRATIONS_DIR, TEST_DATABASE_URL } from "./helpers/db";

const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
await client.connect();
afterAll(() => client.end());

describe("migrations", () => {
  it("installs postgis, vector and fuzzystrmatch", async () => {
    const { rows } = await client.query("select extname from pg_extension order by extname");
    expect(rows.map((r) => r.extname)).toEqual(expect.arrayContaining(["fuzzystrmatch", "postgis", "vector"]));
  });

  it("seeds the 77 community areas exactly as shared/data lists them", async () => {
    const { rows } = await client.query("select number, name from community_areas order by number");
    expect(rows).toEqual(COMMUNITY_AREAS.map((a) => ({ number: a.number, name: a.name })));
  });

  it("is idempotent", async () => {
    expect(await migrate(TEST_DATABASE_URL, MIGRATIONS_DIR)).toEqual([]);
  });
});
```

`server/tests/helpers/db.ts` (first version; Task 6 extends it):

```ts
import { fileURLToPath } from "node:url";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://pipeline:pipeline@localhost:5433/pipeline_test";
export const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations", import.meta.url));
```

`server/tests/global-setup.ts`:

```ts
import pg from "pg";
import { migrate } from "../src/db/migrate";
import { MIGRATIONS_DIR, TEST_DATABASE_URL } from "./helpers/db";

// Recreate the test schema once per run, then apply every migration.
export default async function setup() {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  for (let attempt = 0; ; attempt++) {
    try { await client.connect(); break; } catch (e) {
      if (attempt >= 30) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await client.query("drop schema if exists public cascade; create schema public;");
  await client.end();
  await migrate(TEST_DATABASE_URL, MIGRATIONS_DIR);
}
```

In `server/vitest.config.ts` add `globalSetup: ["tests/global-setup.ts"],` inside `test`.

- [ ] **Step 4: Run it to see it fail**

Run: `pnpm --filter server test tests/migrate.test.ts`
Expected: FAIL — cannot resolve `../src/db/migrate`.

- [ ] **Step 5: Migration runner, CLI and migration 001**

`server/src/db/migrate.ts`:

```ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const LOCK_ID = 727274;

/** Applies every not-yet-applied `*.sql` file in `dir`, in name order, each in its own transaction. */
export async function migrate(databaseUrl: string, dir: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(
      "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    const done = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name as string));
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(dir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (name) values ($1)", [file]);
        await client.query("commit");
      } catch (e) {
        await client.query("rollback");
        throw new Error(`migration ${file} failed: ${(e as Error).message}`);
      }
      applied.push(file);
    }
    return applied;
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    await client.end();
  }
}
```

`server/src/cli/migrate.ts`:

```ts
import { resolve } from "node:path";
import { migrate } from "../db/migrate";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const applied = await migrate(url, resolve(process.env.MIGRATIONS_DIR ?? "migrations"));
console.log(applied.length ? `applied: ${applied.join(", ")}` : "migrations: up to date");
```

`server/migrations/001_extensions_reference.sql` — extensions plus the 77 areas (generate the `values` list from `COMMUNITY_AREAS`; it must match exactly, the test checks):

```sql
create extension if not exists postgis;
create extension if not exists vector;
create extension if not exists fuzzystrmatch;

create table community_areas (
  number int primary key check (number between 1 and 77),
  name text not null unique
);

insert into community_areas (number, name) values
  (1, 'Rogers Park'), (2, 'West Ridge'), (3, 'Uptown'), (4, 'Lincoln Square'), (5, 'North Center'),
  (6, 'Lake View'), (7, 'Lincoln Park'), (8, 'Near North Side'), (9, 'Edison Park'), (10, 'Norwood Park'),
  (11, 'Jefferson Park'), (12, 'Forest Glen'), (13, 'North Park'), (14, 'Albany Park'), (15, 'Portage Park'),
  (16, 'Irving Park'), (17, 'Dunning'), (18, 'Montclare'), (19, 'Belmont Cragin'), (20, 'Hermosa'),
  (21, 'Avondale'), (22, 'Logan Square'), (23, 'Humboldt Park'), (24, 'West Town'), (25, 'Austin'),
  (26, 'West Garfield Park'), (27, 'East Garfield Park'), (28, 'Near West Side'), (29, 'North Lawndale'),
  (30, 'South Lawndale'), (31, 'Lower West Side'), (32, 'Loop'), (33, 'Near South Side'), (34, 'Armour Square'),
  (35, 'Douglas'), (36, 'Oakland'), (37, 'Fuller Park'), (38, 'Grand Boulevard'), (39, 'Kenwood'),
  (40, 'Washington Park'), (41, 'Hyde Park'), (42, 'Woodlawn'), (43, 'South Shore'), (44, 'Chatham'),
  (45, 'Avalon Park'), (46, 'South Chicago'), (47, 'Burnside'), (48, 'Calumet Heights'), (49, 'Roseland'),
  (50, 'Pullman'), (51, 'South Deering'), (52, 'East Side'), (53, 'West Pullman'), (54, 'Riverdale'),
  (55, 'Hegewisch'), (56, 'Garfield Ridge'), (57, 'Archer Heights'), (58, 'Brighton Park'), (59, 'McKinley Park'),
  (60, 'Bridgeport'), (61, 'New City'), (62, 'West Elsdon'), (63, 'Gage Park'), (64, 'Clearing'),
  (65, 'West Lawn'), (66, 'Chicago Lawn'), (67, 'West Englewood'), (68, 'Englewood'),
  (69, 'Greater Grand Crossing'), (70, 'Ashburn'), (71, 'Auburn Gresham'), (72, 'Beverly'),
  (73, 'Washington Heights'), (74, 'Mount Greenwood'), (75, 'Morgan Park'), (76, 'O''Hare'), (77, 'Edgewater');
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter server test`
Expected: PASS (smoke + 3 migration tests).

- [ ] **Step 7: Commit**

```bash
git add server shared/data/community-areas.ts
git commit -m "feat(server): Postgres image, dev compose, migration runner, community areas

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Primitive normalizers

**Files:**
- Create: `shared/normalize/primitives.ts`, `shared/tests/primitives.test.ts`

**Interfaces:**
- Produces (all pure):
  - `type Result<T> = { ok: true; value: T; warning?: string } | { ok: false; message: string }`
  - `normalizePin(raw: string): Result<string>`, `formatPin(pin: string): string`
  - `normalizeDpdAppNo(raw: string): Result<string>`, `normalizeRecordNumber(raw: string): Result<string>`, `matterKeyOf(recordNumber: string): string`
  - `extractCitedKeys(text: string): { dpd_app_no: string[]; record_number: string[] }`
  - `orgNameKey(raw: string): string | null`, `looseOrgKey(nameKey: string): string`
  - `normalizeCommunityArea(raw: string | number): Result<number>`, `normalizeZip(raw: string): Result<string>`, `normalizeZoning(raw: string): string`, `blankToNull(v: string | null | undefined): string | null`

- [ ] **Step 1: Write the failing tests**

`shared/tests/primitives.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  blankToNull, extractCitedKeys, formatPin, looseOrgKey, matterKeyOf, normalizeCommunityArea, normalizeDpdAppNo,
  normalizePin, normalizeRecordNumber, normalizeZip, normalizeZoning, orgNameKey,
} from "../normalize/primitives";

describe("normalizePin", () => {
  it.each([
    ["17-09-123-004-0000", "17091230040000"],
    ["17091230040000", "17091230040000"],
    ["17-09-123-004", "17091230040000"],
    [" 17 09 123 004 0000 ", "17091230040000"],
  ])("%s → %s", (raw, pin) => expect(normalizePin(raw)).toEqual({ ok: true, value: pin }));

  it("rejects other lengths", () => expect(normalizePin("17-09-123").ok).toBe(false));
  it("formats for display", () => expect(formatPin("17091230040000")).toBe("17-09-123-004-0000"));
});

describe("identifiers", () => {
  it.each([["APP23020T1", "23020"], ["23020", "23020"], ["app #23020", "23020"], ["23020T1", "23020"]])(
    "DPD app # %s → %s", (raw, v) => expect(normalizeDpdAppNo(raw)).toEqual({ ok: true, value: v }),
  );
  it("rejects a DPD app # without digits", () => expect(normalizeDpdAppNo("pending").ok).toBe(false));

  it.each([["o2026-0025202", "O2026-0025202"], ["SO2026-0023894", "SO2026-0023894"], [" O2026 -0025202", "O2026-0025202"]])(
    "record number %s → %s", (raw, v) => expect(normalizeRecordNumber(raw)).toEqual({ ok: true, value: v }),
  );
  it("rejects a malformed record number", () => expect(normalizeRecordNumber("2026-25202").ok).toBe(false));
  it("matter key strips one leading S", () => {
    expect(matterKeyOf("SO2026-0023894")).toBe("O2026-0023894");
    expect(matterKeyOf("O2026-0025202")).toBe("O2026-0025202");
  });

  it("finds ordinance and APP numbers cited in permit conditions", () => {
    expect(extractCitedKeys("PER SO2026-0023894 ... APP23020T1; also app 23021")).toEqual({
      dpd_app_no: ["23020", "23021"], record_number: ["SO2026-0023894"],
    });
    expect(extractCitedKeys("NO CONDITIONS")).toEqual({ dpd_app_no: [], record_number: [] });
  });
});

describe("organization keys", () => {
  it.each([
    ["4645 North Clark, LLC", "4645 NORTH CLARK LLC"],
    ["4645 NORTH CLARK L.L.C.", "4645 NORTH CLARK LLC"],
    ["4645 North Clark L L C", "4645 NORTH CLARK LLC"],
    ["Golub & Co.", "GOLUB AND CO"],
    ["Acme, Inc.", "ACME INC"],
  ])("%s → %s", (raw, key) => expect(orgNameKey(raw)).toBe(key));

  it("returns null for punctuation-only names", () => expect(orgNameKey(" ., ")).toBeNull());
  it("loose key drops entity suffixes", () => {
    expect(looseOrgKey("XIMENA CASTRO ESQ")).toBe("XIMENA CASTRO");
    expect(looseOrgKey("4645 NORTH CLARK LLC")).toBe("4645 NORTH CLARK");
  });
});

describe("community area, ZIP, zoning, blanks", () => {
  it.each([["21", 21], [21, 21], ["21 Avondale", 21], ["Avondale", 21], ["lake view", 6], ["Lakeview", 6], ["O'Hare", 76]])(
    "community area %s → %s", (raw, n) => expect(normalizeCommunityArea(raw)).toEqual({ ok: true, value: n }),
  );
  it("rejects unknown areas and out-of-range numbers", () => {
    expect(normalizeCommunityArea("Gotham").ok).toBe(false);
    expect(normalizeCommunityArea("78").ok).toBe(false);
  });
  it("ZIP keeps five digits", () => {
    expect(normalizeZip("60603-1234")).toEqual({ ok: true, value: "60603" });
    expect(normalizeZip("6060").ok).toBe(false);
  });
  it.each([["b3-2", "B3-2"], ["DX - 12", "DX-12"], ["PD1234", "PD 1234"], ["PD #1234", "PD 1234"], ["pd", "PD"], ["PMD 4a", "PMD 4A"]])(
    "zoning %s → %s", (raw, v) => expect(normalizeZoning(raw)).toBe(v),
  );
  it("blankToNull", () => {
    expect(blankToNull("  ")).toBeNull();
    expect(blankToNull(" x ")).toBe("x");
    expect(blankToNull(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test shared/tests/primitives.test.ts`
Expected: FAIL — cannot resolve `../normalize/primitives`.

- [ ] **Step 3: Implement**

`shared/normalize/primitives.ts`:

```ts
import { COMMUNITY_AREAS } from "../data/community-areas";

export type Result<T> = { ok: true; value: T; warning?: string } | { ok: false; message: string };
const ok = <T>(value: T, warning?: string): Result<T> => (warning ? { ok: true, value, warning } : { ok: true, value });
const fail = <T>(message: string): Result<T> => ({ ok: false, message });

export function blankToNull(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/** Cook County PIN → 14 digits. 10-digit PINs get the 0000 unit suffix. */
export function normalizePin(raw: string): Result<string> {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 14) return ok(digits);
  if (digits.length === 10) return ok(`${digits}0000`);
  return fail(`PIN "${raw.trim()}" must have 10 or 14 digits, found ${digits.length}`);
}

export function formatPin(pin: string): string {
  return `${pin.slice(0, 2)}-${pin.slice(2, 4)}-${pin.slice(4, 7)}-${pin.slice(7, 10)}-${pin.slice(10)}`;
}

/** DPD application number → its digits (APP23020T1, 23020T1, "app #23020" → 23020). */
export function normalizeDpdAppNo(raw: string): Result<string> {
  const m = raw.toUpperCase().replace(/\s+/g, "").match(/^(?:APP)?#?(\d{4,})/);
  return m ? ok(m[1]!) : fail(`DPD app # "${raw.trim()}" has no number`);
}

/** City Clerk record number → uppercase, no spaces (O2026-0025202, SO2026-0023894). */
export function normalizeRecordNumber(raw: string): Result<string> {
  const v = raw.toUpperCase().replace(/\s+/g, "");
  return /^[A-Z]{1,4}\d{4}-\d{1,8}$/.test(v) ? ok(v) : fail(`record number "${raw.trim()}" is not like O2026-0025202`);
}

/** Grok's dedupe key for eLMS matters: the record number without one leading S. */
export function matterKeyOf(recordNumber: string): string {
  return recordNumber.replace(/^S(?=[A-Z])/, "");
}

/** Ordinance and DPD application numbers cited in free text (permit_condition). */
export function extractCitedKeys(text: string): { dpd_app_no: string[]; record_number: string[] } {
  const upper = text.toUpperCase();
  const apps = [...upper.matchAll(/\bAPP\s*#?\s*(\d{4,})/g)].map((m) => m[1]!);
  const records = [...upper.matchAll(/\b(S?O\d{4}-\d{5,8})\b/g)].map((m) => m[1]!);
  return { dpd_app_no: [...new Set(apps)], record_number: [...new Set(records)] };
}

/** Comparison key for organization and person names. */
export function orgNameKey(raw: string): string | null {
  let s = raw.toUpperCase().replace(/&/g, " AND ").replace(/[.,'"`’]/g, "");
  s = s.replace(/[^A-Z0-9 ]+/g, " ");
  s = s.replace(/\bL L C\b/g, "LLC").replace(/\bI N C\b/g, "INC").replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

const ENTITY_SUFFIXES = new Set(["LLC", "INC", "ESQ", "CORP", "CO", "LTD", "LP", "LLP", "PC", "JR"]);

/** Name key without trailing entity/person suffixes — used only to suggest possible duplicates. */
export function looseOrgKey(nameKey: string): string {
  const words = nameKey.split(" ");
  while (words.length > 1 && ENTITY_SUFFIXES.has(words[words.length - 1]!)) words.pop();
  return words.join(" ");
}

const compactName = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, "");
const AREA_BY_NAME = new Map(COMMUNITY_AREAS.map((a) => [compactName(a.name), a.number]));

/** "21", 21, "21 Avondale", "Avondale" → 21. */
export function normalizeCommunityArea(raw: string | number): Result<number> {
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,3})\b/);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= 77 ? ok(n) : fail(`community area ${n} is not between 1 and 77`);
  }
  const hit = AREA_BY_NAME.get(compactName(s));
  return hit ? ok(hit) : fail(`unknown community area "${s}"`);
}

export function normalizeZip(raw: string): Result<string> {
  const m = raw.trim().match(/^(\d{5})(?:-\d{4})?$/);
  return m ? ok(m[1]!) : fail(`ZIP "${raw.trim()}" is not 5 digits`);
}

/** Chicago zoning district code in canonical spacing: B3-2, DX-12, PD 1234, PMD 4A. */
export function normalizeZoning(raw: string): string {
  let s = raw.toUpperCase().trim().replace(/\s*-\s*/g, "-").replace(/\s+/g, " ");
  s = s.replace(/^(PD|PMD)\s*#?\s*(\w+)$/, "$1 $2");
  return s;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test shared/tests/primitives.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/normalize/primitives.ts shared/tests/primitives.test.ts
git commit -m "feat(shared): normalizers for PINs, identifiers, names, community areas, ZIP, zoning

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: City street list and the address normalizer

**Files:**
- Create: `shared/scripts/fetch-streets.ts`, `shared/data/streets.json` (generated), `shared/normalize/address.ts`, `shared/tests/address.test.ts`
- Modify: root `package.json` (script `streets:fetch`)

**Interfaces:**
- Consumes: `Result`, `normalizeZip` from Task 3.
- Produces:
  - `interface CanonicalAddress { number_from: number; number_to: number; predir: "N" | "S" | "E" | "W" | null; street_name: string; suffix: string | null; zip: string | null }` (exported from `shared/records/types.ts` in Task 5; define it in `address.ts` now and re-export it there)
  - `normalizeAddress(raw: string, zip?: string | null): Result<CanonicalAddress>`
  - `addressKey(a: CanonicalAddress): string` — e.g. `"111 W MONROE ST"`, `"116-122 W ILLINOIS ST"`
  - `formatAddressDisplay(a: CanonicalAddress): string` — e.g. `"111 W. Monroe St"`, `"208 S. LaSalle St"`

- [ ] **Step 1: Fetch the street list**

`shared/scripts/fetch-streets.ts`:

```ts
// Refreshes shared/data/streets.json from the Chicago Data Portal "Chicago Street Names" dataset (i6bp-fvbx).
// Each row: [direction, street, suffix, min_address, max_address]. Run: pnpm streets:fetch
import { writeFileSync } from "node:fs";

const res = await fetch("https://data.cityofchicago.org/resource/i6bp-fvbx.json?$limit=10000");
if (!res.ok) throw new Error(`street list: HTTP ${res.status}`);
const rows = (await res.json()) as { direction?: string; street: string; suffix?: string; min_address: string; max_address: string }[];
const out = rows
  .map((r) => [(r.direction ?? "").trim(), r.street.trim(), (r.suffix ?? "").trim(), Number(r.min_address), Number(r.max_address)] as const)
  .sort((a, b) => a.join("|").localeCompare(b.join("|")));
writeFileSync("shared/data/streets.json", JSON.stringify(out).replace(/\],\[/g, "],\n[") + "\n");
console.log(`wrote ${out.length} streets`);
```

Root `package.json` script: `"streets:fetch": "tsx shared/scripts/fetch-streets.ts"`.

Run: `pnpm streets:fetch`
Expected: `wrote 2582 streets` (± a few). Spot-check: `grep '"LA SALLE"' shared/data/streets.json` shows `["N","LA SALLE","DR",300,1726]` and `["N","LA SALLE","ST",1,311]`.

- [ ] **Step 2: Write the failing tests**

`shared/tests/address.test.ts`:

```ts
import { readFileSync } from "node:fs";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import streets from "../data/streets.json";
import { addressKey, formatAddressDisplay, normalizeAddress, SUFFIXES } from "../normalize/address";

const value = (raw: string, zip?: string) => {
  const r = normalizeAddress(raw, zip);
  if (!r.ok) throw new Error(r.message);
  return r;
};

describe("normalizeAddress", () => {
  it("canonicalizes a simple address", () => {
    expect(value("111 W. Monroe Street").value).toEqual({
      number_from: 111, number_to: 111, predir: "W", street_name: "MONROE", suffix: "ST", zip: null,
    });
  });

  it.each([
    ["111-123 W. Monroe Street", "111-123 W MONROE ST"],
    ["111 - 123 W MONROE ST", "111-123 W MONROE ST"],
    ["111 TO 123 West Monroe St.", "111-123 W MONROE ST"],
    ["1601-15 N. Clark St", "1601-1615 N CLARK ST"],
    ["208 S. LaSalle St", "208 S LA SALLE ST"],
    ["208 South La Salle Street", "208 S LA SALLE ST"],
    ["55 E. Washington St, Suite 300", "55 E WASHINGTON ST"],
    ["55 E Washington St #300", "55 E WASHINGTON ST"],
    ["3642 W. Oakdale Avenue", "3642 W OAKDALE AVE"],
  ])("%s → %s", (raw, key) => expect(addressKey(value(raw).value)).toBe(key));

  it("fills a missing suffix when the block has only one", () => {
    expect(addressKey(value("3642 W Oakdale").value)).toBe("3642 W OAKDALE AVE");
  });

  it("corrects the suffix to the one valid for that block, with a warning", () => {
    const r = value("620 N. LaSalle St");
    expect(addressKey(r.value)).toBe("620 N LA SALLE DR");
    expect(r.warning).toMatch(/suffix/i);
  });

  it("keeps a valid ZIP and rejects nothing because of a missing one", () => {
    expect(value("111 W Monroe St", "60603-1234").value.zip).toBe("60603");
  });

  it("rejects unknown streets and addresses without a number", () => {
    expect(normalizeAddress("12 Gotham Blvd").ok).toBe(false);
    expect(normalizeAddress("W Monroe St").ok).toBe(false);
  });

  it("knows every suffix the city list uses", () => {
    const used = new Set((streets as [string, string, string, number, number][]).map((r) => r[2]).filter(Boolean));
    const canonical = new Set(Object.values(SUFFIXES));
    expect([...used].filter((s) => !canonical.has(s))).toEqual([]);
  });
});

describe("formatAddressDisplay", () => {
  it.each([
    ["111 W MONROE ST", "111 W. Monroe St"],
    ["116-122 W. Illinois St", "116-122 W. Illinois St"],
    ["208 S LA SALLE ST", "208 S. LaSalle St"],
    ["1060 W VAN BUREN ST", "1060 W. Van Buren St"],
  ])("%s → %s", (raw, display) => expect(formatAddressDisplay(value(raw).value)).toBe(display));

  it("reproduces today's project addresses (except the one whose suffix the city list corrects)", () => {
    const rows = Papa.parse<{ address: string }>(readFileSync("data/projects.csv", "utf8"), { header: true, skipEmptyLines: true }).data;
    const changed = rows
      .map((r) => ({ from: r.address, to: formatAddressDisplay(value(r.address).value) }))
      .filter((c) => c.from !== c.to);
    expect(changed).toEqual([{ from: "620 N. LaSalle St", to: "620 N. LaSalle Dr" }]);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm test shared/tests/address.test.ts`
Expected: FAIL — cannot resolve `../normalize/address`.

- [ ] **Step 4: Implement**

`shared/normalize/address.ts`:

```ts
import streetsJson from "../data/streets.json";
import { normalizeZip, type Result } from "./primitives";

export interface CanonicalAddress {
  number_from: number;
  number_to: number;
  predir: "N" | "S" | "E" | "W" | null;
  street_name: string;
  suffix: string | null;
  zip: string | null;
}

type StreetRow = readonly [dir: string, street: string, suffix: string, min: number, max: number];
const ROWS = streetsJson as unknown as StreetRow[];
const RAMP_SUFFIXES = new Set(["ER", "XR"]); // expressway ramps in the city list, never a building address

const compact = (s: string) => s.replace(/[^A-Z0-9]/g, "");
const BY_NAME = new Map<string, StreetRow[]>();
for (const row of ROWS) {
  const key = `${row[0]}|${compact(row[1])}`;
  BY_NAME.set(key, [...(BY_NAME.get(key) ?? []), row]);
}

const DIRS: Record<string, CanonicalAddress["predir"]> = {
  N: "N", NORTH: "N", S: "S", SOUTH: "S", E: "E", EAST: "E", W: "W", WEST: "W",
};

/** Spelling → the abbreviation the city list uses. Every suffix in streets.json must be a value here (tested). */
export const SUFFIXES: Record<string, string> = {
  ST: "ST", STREET: "ST", AVE: "AVE", AV: "AVE", AVENUE: "AVE", BLVD: "BLVD", BOULEVARD: "BLVD",
  DR: "DR", DRIVE: "DR", PL: "PL", PLACE: "PL", RD: "RD", ROAD: "RD", CT: "CT", COURT: "CT",
  PKWY: "PKWY", PARKWAY: "PKWY", TER: "TER", TERRACE: "TER", WAY: "WAY", LN: "LN", LANE: "LN",
  HWY: "HWY", HIGHWAY: "HWY", SQ: "SQ", SQUARE: "SQ", PLZ: "PLZ", PLAZA: "PLZ", ROW: "ROW",
  CIR: "CIR", CIRCLE: "CIR", EXPY: "EXPY", EXPRESSWAY: "EXPY", ER: "ER", XR: "XR",
};

const inRange = (row: StreetRow, n: number) => n >= row[3] && n <= row[4];
const distinct = <T>(xs: T[]) => [...new Set(xs)];

function expandRange(a: string, b: string): number {
  return Number(b.length < a.length ? a.slice(0, a.length - b.length) + b : b);
}

export function normalizeAddress(raw: string, zipRaw?: string | null): Result<CanonicalAddress> {
  let s = raw.toUpperCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/\s(?:#|UNIT|STE|SUITE|APT|FL|FLOOR|RM|ROOM)\s*\S*.*$/, "").replace(/#\S*$/, "").trim();

  const m = s.match(/^(\d+)(?:\s*(?:-|TO|THRU|THROUGH)\s*(\d+))?\s+(.+)$/);
  if (!m) return { ok: false, message: `address "${raw.trim()}" has no house number` };
  const from = Number(m[1]);
  const to = m[2] ? expandRange(m[1]!, m[2]) : from;
  if (to < from) return { ok: false, message: `address range "${raw.trim()}" runs backwards` };

  const tokens = m[3]!.split(" ");
  let predir: CanonicalAddress["predir"] = null;
  if (tokens.length > 1 && DIRS[tokens[0]!]) predir = DIRS[tokens.shift()!]!;
  let suffix: string | null = null;
  if (tokens.length > 1 && SUFFIXES[tokens[tokens.length - 1]!]) suffix = SUFFIXES[tokens.pop()!]!;
  const name = tokens.join(" ");

  const warnings: string[] = [];
  let candidates: StreetRow[];
  if (predir) {
    candidates = BY_NAME.get(`${predir}|${compact(name)}`) ?? [];
  } else {
    const dirs = distinct(["N", "S", "E", "W"].filter((d) => (BY_NAME.get(`${d}|${compact(name)}`) ?? []).some((r) => inRange(r, from))));
    if (dirs.length !== 1) return { ok: false, message: `address "${raw.trim()}" needs a direction (N/S/E/W)` };
    predir = dirs[0] as CanonicalAddress["predir"];
    candidates = BY_NAME.get(`${predir}|${compact(name)}`) ?? [];
    warnings.push(`direction ${predir} added`);
  }
  if (!suffix || !RAMP_SUFFIXES.has(suffix)) candidates = candidates.filter((r) => !RAMP_SUFFIXES.has(r[2]));
  if (candidates.length === 0) return { ok: false, message: `unknown street "${predir} ${name}" (not in the city street list)` };

  const streetName = candidates[0]![1];
  const blockSuffixes = distinct(candidates.filter((r) => inRange(r, from)).map((r) => r[2]));
  const allSuffixes = distinct(candidates.map((r) => r[2]));

  if (suffix) {
    const fits = candidates.some((r) => r[2] === suffix && inRange(r, from));
    if (!fits) {
      if (blockSuffixes.length === 1) {
        warnings.push(`suffix ${suffix} corrected to ${blockSuffixes[0]} for the ${from} block`);
        suffix = blockSuffixes[0]!;
      } else if (!allSuffixes.includes(suffix)) {
        return { ok: false, message: `"${predir} ${streetName} ${suffix}" is not in the city street list` };
      }
    }
  } else {
    const options = blockSuffixes.length > 0 ? blockSuffixes : allSuffixes;
    if (options.length !== 1) return { ok: false, message: `address "${raw.trim()}" needs a street type (ST, AVE…)` };
    suffix = options[0] || null;
  }

  let zip: string | null = null;
  if (zipRaw && zipRaw.trim()) {
    const z = normalizeZip(zipRaw);
    if (!z.ok) return { ok: false, message: z.message };
    zip = z.value;
  }

  const value: CanonicalAddress = { number_from: from, number_to: to, predir, street_name: streetName, suffix, zip };
  return warnings.length ? { ok: true, value, warning: warnings.join("; ") } : { ok: true, value };
}

const range = (a: CanonicalAddress) => (a.number_from === a.number_to ? `${a.number_from}` : `${a.number_from}-${a.number_to}`);

export function addressKey(a: CanonicalAddress): string {
  return [range(a), a.predir, a.street_name, a.suffix].filter(Boolean).join(" ");
}

const STREET_DISPLAY: Record<string, string> = {
  "LA SALLE": "LaSalle", "MC CLURG": "McClurg", "MC FETRIDGE": "McFetridge", "DE KOVEN": "DeKoven", "MC CORMICK": "McCormick",
};
const title = (w: string) => (/^\d/.test(w) ? w.toLowerCase() : w.charAt(0) + w.slice(1).toLowerCase());

export function formatAddressDisplay(a: CanonicalAddress): string {
  const street = STREET_DISPLAY[a.street_name] ?? a.street_name.split(" ").map(title).join(" ");
  return [range(a), a.predir ? `${a.predir}.` : null, street, a.suffix ? title(a.suffix) : null].filter(Boolean).join(" ");
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm test shared/tests/address.test.ts`
Expected: PASS. If the "knows every suffix" test lists a suffix, add it to `SUFFIXES` (abbreviation → itself). If the projects.csv test lists more changes than 620 N. LaSalle, stop and show Drew the list — each is a public address change (ledger a `Ruling:`).

- [ ] **Step 6: Commit**

```bash
git add shared/scripts/fetch-streets.ts shared/data/streets.json shared/normalize/address.ts shared/tests/address.test.ts package.json
git commit -m "feat(shared): canonical addresses validated against the city street list

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Wire schemas, record normalization, hash, diff

**Files:**
- Create: `shared/records/types.ts`, `shared/records/schemas.ts`, `shared/records/normalize-record.ts`, `shared/records/denormalize-record.ts`, `shared/records/hash.ts`, `shared/records/diff.ts`, `shared/tests/records.test.ts`, `shared/tests/fixtures.ts`

**Interfaces:**
- Consumes: Task 3 primitives, Task 4 `normalizeAddress`, `addressKey`, `formatAddressDisplay`, `CanonicalAddress`.
- Produces:
  - `KINDS`, `type Kind`, `IDENTIFIER_TYPES`, `type IdentifierType`, `ORG_ROLES`, `type OrgRole`, `FIELD_SOURCES`
  - `interface RecordIdentifier { type: IdentifierType; value: string; relation: "self" | "cited" }`
  - `interface RecordOrganization { role: OrgRole; name_key: string; display_name: string }`
  - `interface NormalizedRecord { kind: Kind; source_key: string; addresses: CanonicalAddress[]; point: { lat: number; lon: number } | null; community_area: number | null; ward: number | null; units: number | null; status: string | null; event_date: string | null; in_target: boolean; flag: string | null; notes: string | null; source_url: string | null; parcels: string[]; identifiers: RecordIdentifier[]; organizations: RecordOrganization[]; attributes: Record<string, unknown>; field_sources: Record<string, string> }`
  - `interface Issue { field: string; raw: unknown; message: string; blocking: boolean }`
  - `interface NormalizeResult { record: NormalizedRecord; issues: Issue[] }`
  - `SubmissionEnvelope`, `RecordEnvelope`, `DATA_SCHEMAS: Record<Kind, z.ZodType>`, `type WireRecord = { kind: Kind; source_key: string; observed_at?: string; data: Record<string, unknown>; field_sources?: Record<string, string> }`, `submissionJsonSchema(): object`, `MAX_RECORDS = 500`
  - `normalizeRecord(rec: WireRecord): NormalizeResult` (rec.data already validated by `DATA_SCHEMAS[kind]`)
  - `denormalizeRecord(r: NormalizedRecord): WireRecord`
  - `stableStringify(v: unknown): string`, `contentHash(record: NormalizedRecord, issues?: Issue[]): string`
  - `diffRecords(before: NormalizedRecord | null, after: NormalizedRecord): Record<string, { before: unknown; after: unknown }>`

- [ ] **Step 1: Types and wire schemas**

`shared/records/types.ts`:

```ts
import type { CanonicalAddress } from "../normalize/address";
export type { CanonicalAddress } from "../normalize/address";

export const KINDS = ["permit", "zoning_matter", "hearing_item", "zba_case"] as const;
export type Kind = (typeof KINDS)[number];

export const IDENTIFIER_TYPES = ["permit_number", "matter_key", "record_number", "elms_matter_id", "dpd_app_no", "zba_case_no"] as const;
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];

export const ORG_ROLES = ["applicant", "owner", "attorney", "contractor", "architect", "other"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const FIELD_SOURCES = ["ocr", "ward_map", "cpc_description", "permit_text", "socrata", "elms", "minutes", "decisions", "resolution"] as const;

export interface RecordIdentifier { type: IdentifierType; value: string; relation: "self" | "cited" }
export interface RecordOrganization { role: OrgRole; name_key: string; display_name: string }

export interface NormalizedRecord {
  kind: Kind;
  source_key: string;
  addresses: CanonicalAddress[]; // [0] is the primary address
  point: { lat: number; lon: number } | null; // trusted geocode from the source; stored on the address row
  community_area: number | null;
  ward: number | null;
  units: number | null;
  status: string | null;
  event_date: string | null;
  in_target: boolean;
  flag: string | null;
  notes: string | null;
  source_url: string | null;
  parcels: string[];
  identifiers: RecordIdentifier[];
  organizations: RecordOrganization[];
  attributes: Record<string, unknown>; // kind-specific fields, wire names, never a value held by a shared table
  field_sources: Record<string, string>;
}

export interface Issue { field: string; raw: unknown; message: string; blocking: boolean }
export interface NormalizeResult { record: NormalizedRecord; issues: Issue[] }

export interface WireRecord {
  kind: Kind;
  source_key: string;
  observed_at?: string;
  data: Record<string, unknown>;
  field_sources?: Record<string, string>;
}
```

`shared/records/schemas.ts` (must match the companion Grok document §3–§4 field for field):

```ts
import { z } from "zod";
import { FIELD_SOURCES, KINDS } from "./types";

export const MAX_RECORDS = 500;

const isRealDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD").refine(isRealDate, "not a real date");
const req = z.string().trim().min(1);
const str = z.string().nullish(); // "" is accepted and treated as null by the normalizer
const int = z.number().int();
const count = int.min(0).nullish();
const bool = z.boolean().nullish();
const url = z.url().nullish();
const lat = z.number().min(41.6).max(42.1).nullish();
const lon = z.number().min(-87.95).max(-87.5).nullish();

const location = {
  zip: str,
  community_area: z.union([z.string(), int]).nullish(),
  ward: int.min(1).max(50).nullish(),
  lat,
  lon,
  notes: str,
};

export const PermitData = z.strictObject({
  permit_number: req,
  classification: z.enum(["qualifying_20plus", "early_signal"]),
  issue_date: date,
  permit_type: str,
  address: req,
  ...location,
  units: z.strictObject({ total: count, dwelling: count, efficiency: count, affordable: count }).nullish(),
  unit_flag: str,
  reported_cost: count,
  contacts: z.array(z.strictObject({ role: req, name: req })).nullish(),
  short_description: str,
  work_description: str,
  permit_status: str,
  permit_condition: str,
  pin_list: z.array(z.string()).nullish(),
  portal_url: url,
  scope: str,
  in_target: z.boolean(),
});

export const ZoningMatterData = z.strictObject({
  record_number: req,
  matter_id: str,
  dpd_app_no: str,
  title: str,
  filed_date: date.nullish(),
  introduced_date: date.nullish(),
  hearing_date: date.nullish(),
  address: str,
  additional_addresses: z.array(z.string()).nullish(),
  ...location,
  applicant: str,
  owner: str,
  attorney: str,
  zoning_from: str,
  zoning_to: str,
  lot_size_sqft: count,
  units: count,
  height_ft: z.number().min(0).nullish(),
  parking: count,
  aro: bool,
  pd: bool,
  aldermanic: bool,
  status: req,
  flag: str,
  source_url: z.url(),
  drive_pdf_url: url,
  in_target: z.boolean(),
});

export const HearingItemData = z.strictObject({
  body: z.literal("cpc"),
  hearing_date: date,
  dpd_app_no: str,
  matter_key: str,
  address: req,
  ...location,
  applicant: str,
  request: str,
  zoning_from: str,
  zoning_to: str,
  units: count,
  height_ft: z.number().min(0).nullish(),
  parking: count,
  pd: bool,
  source_url: z.url(),
  in_target: z.boolean(),
});

export const ZbaCaseData = z.strictObject({
  case_no: req,
  request_type: str,
  first_hearing: date.nullish(),
  hearing_date: date.nullish(),
  address: req,
  ...location,
  applicant: str,
  owner: str,
  attorney: str,
  zoning_district: str,
  request: str,
  units: count,
  residential: bool,
  outcome: str,
  vote: str,
  decision_date: date.nullish(),
  hearings: z
    .array(z.strictObject({ date, outcome: str, vote: str, continued_to: date.nullish(), source_url: url }))
    .nullish(),
  source_pdf_url: url,
  resolution_pdf_url: url,
  flag: str,
  in_target: z.boolean(),
});

export const DATA_SCHEMAS = {
  permit: PermitData,
  zoning_matter: ZoningMatterData,
  hearing_item: HearingItemData,
  zba_case: ZbaCaseData,
} as const;

export const RecordEnvelope = z.strictObject({
  kind: z.enum(KINDS),
  source_key: req,
  observed_at: z.iso.datetime({ offset: true }),
  data: z.record(z.string(), z.unknown()),
  field_sources: z.record(z.string(), z.enum(FIELD_SOURCES)).optional(),
});

export const SubmissionEnvelope = z.strictObject({
  run: z.strictObject({
    program: z.enum(["permits", "zoning", "permits-backfill", "zoning-backfill"]),
    run_id: req,
    started_at: z.iso.datetime({ offset: true }),
    bot_version: str,
  }),
  records: z.array(z.unknown()),
});

/** JSON Schema of a whole submission, records typed by kind — served at /v1/schema/submission.json. */
export function submissionJsonSchema(): object {
  const typed = (kind: (typeof KINDS)[number], data: z.ZodType) =>
    RecordEnvelope.extend({ kind: z.literal(kind), data });
  const schema = SubmissionEnvelope.extend({
    records: z
      .array(z.discriminatedUnion("kind", [
        typed("permit", PermitData), typed("zoning_matter", ZoningMatterData),
        typed("hearing_item", HearingItemData), typed("zba_case", ZbaCaseData),
      ]))
      .max(MAX_RECORDS),
  });
  return z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
}
```

- [ ] **Step 2: Fixtures and failing tests**

`shared/tests/fixtures.ts` — one valid wire record per kind (reused by server tests):

```ts
import type { WireRecord } from "../records/types";

export const permitRecord = (over: Record<string, unknown> = {}): WireRecord => ({
  kind: "permit",
  source_key: "100912345",
  observed_at: "2026-10-02T12:40:00Z",
  data: {
    permit_number: "100912345", classification: "qualifying_20plus", issue_date: "2026-09-30",
    permit_type: "PERMIT - RENOVATION/ALTERATION", address: "111 W. Monroe Street", zip: "60603",
    community_area: "32 Loop", ward: 42, lat: 41.880635, lon: -87.631098,
    units: { total: 345, dwelling: 345, efficiency: null, affordable: 104 }, unit_flag: null,
    reported_cost: 120000000, contacts: [{ role: "OWNER", name: "Example Owner, L.L.C." }],
    short_description: "Convert office to 345 dwelling units", work_description: "Interior conversion",
    permit_status: "ISSUED", permit_condition: "PER SO2026-0023894 AND APP23020T1",
    pin_list: ["17-16-123-004-0000"], portal_url: "https://webapps1.chicago.gov/buildingrecords/", scope: "North of I-290",
    in_target: true, notes: null,
    ...over,
  },
});

export const zoningRecord = (over: Record<string, unknown> = {}): WireRecord => ({
  kind: "zoning_matter",
  source_key: "O2026-0023894",
  observed_at: "2026-10-02T12:44:10Z",
  data: {
    record_number: "SO2026-0023894", matter_id: null, dpd_app_no: "23020", title: null,
    filed_date: "2026-03-02", introduced_date: "2026-03-18", hearing_date: "2026-06-17",
    address: "111-123 W. Monroe Street", additional_addresses: [], zip: "60603", community_area: "32 Loop", ward: 42,
    lat: null, lon: null, applicant: "Example Owner LLC", owner: "Example Owner LLC", attorney: "Ximena Castro",
    zoning_from: "DC-16", zoning_to: "PD", lot_size_sqft: null, units: 345, height_ft: null, parking: null,
    aro: true, pd: true, aldermanic: false, status: "In Committee - Referred", flag: null,
    source_url: "https://chicityclerkelms.chicago.gov/Matter/?matterId=example", drive_pdf_url: "https://drive.google.com/file/d/example",
    in_target: true, notes: null,
    ...over,
  },
  field_sources: { units: "ocr" },
});

export const hearingRecord = (over: Record<string, unknown> = {}): WireRecord => ({
  kind: "hearing_item",
  source_key: "2026-06-11|23020",
  observed_at: "2026-10-02T12:42:00Z",
  data: {
    body: "cpc", hearing_date: "2026-06-11", dpd_app_no: "23020", matter_key: "O2026-0023894",
    address: "111 W Monroe St", zip: "60603", community_area: 32, ward: 42, lat: null, lon: null,
    applicant: "Example Owner LLC", request: "Planned Development for 345 units", zoning_from: "DC-16", zoning_to: "PD",
    units: 345, height_ft: null, parking: null, pd: true,
    source_url: "https://www.chicago.gov/city/en/depts/dcd/supp_info/chicago_plan_commission.html", in_target: true, notes: null,
    ...over,
  },
});

export const zbaRecord = (over: Record<string, unknown> = {}): WireRecord => ({
  kind: "zba_case",
  source_key: "420-24-S",
  observed_at: "2026-10-02T12:51:02Z",
  data: {
    case_no: "420-24-S", request_type: "Special use", first_hearing: "2024-10-18", hearing_date: "2024-10-18",
    address: "3642 W. Oakdale Avenue", zip: "60618", community_area: "21 Avondale", ward: 35, lat: null, lon: null,
    applicant: "4645 North Clark, LLC", owner: "4645 North Clark, LLC", attorney: "Ximena Castro",
    zoning_district: "B3-2", request: "Special use to establish residential use below the second floor",
    units: 4, residential: true, outcome: "Approved", vote: "4-0", decision_date: "2024-10-18",
    hearings: [{ date: "2024-10-18", outcome: "Approved", vote: "4-0", continued_to: null,
      source_url: "https://www.chicago.gov/content/dam/city/depts/zlup/Administrative_Reviews_and_Approvals/Agendas/ZBA_Oct_2024_Minutes.pdf" }],
    source_pdf_url: "https://www.chicago.gov/content/dam/city/depts/zlup/Administrative_Reviews_and_Approvals/Agendas/ZBA_Oct_2024_Minutes.pdf",
    resolution_pdf_url: null, flag: null, in_target: true, notes: null,
    ...over,
  },
});

export const ALL_FIXTURES = [permitRecord, zoningRecord, hearingRecord, zbaRecord];
```

`shared/tests/records.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { denormalizeRecord } from "../records/denormalize-record";
import { diffRecords } from "../records/diff";
import { contentHash, stableStringify } from "../records/hash";
import { normalizeRecord } from "../records/normalize-record";
import { DATA_SCHEMAS, RecordEnvelope, SubmissionEnvelope, submissionJsonSchema } from "../records/schemas";
import { ALL_FIXTURES, permitRecord, zbaRecord, zoningRecord } from "./fixtures";

describe("wire schemas", () => {
  it.each(ALL_FIXTURES.map((f) => [f().kind, f]))("%s fixture is valid", (_k, f) => {
    const rec = f();
    expect(RecordEnvelope.safeParse(rec).success).toBe(true);
    expect(DATA_SCHEMAS[rec.kind].safeParse(rec.data).success).toBe(true);
  });

  it("rejects unknown fields, string numbers and bad dates", () => {
    expect(DATA_SCHEMAS.permit.safeParse({ ...permitRecord().data, extra: 1 }).success).toBe(false);
    expect(DATA_SCHEMAS.permit.safeParse({ ...permitRecord().data, ward: "42" }).success).toBe(false);
    expect(DATA_SCHEMAS.permit.safeParse({ ...permitRecord().data, issue_date: "2026-02-30" }).success).toBe(false);
  });

  it("accepts the example request in the Grok instructions document", () => {
    const doc = readFileSync("docs/superpowers/specs/2026-10-02-grok-submission-api.md", "utf8");
    const section = doc.slice(doc.indexOf("## 5."));
    const example = JSON.parse(section.slice(section.indexOf("```json") + 7, section.indexOf("```", section.indexOf("```json") + 7)));
    expect(SubmissionEnvelope.safeParse(example).success).toBe(true);
    for (const rec of example.records) {
      expect(RecordEnvelope.safeParse(rec).success).toBe(true);
      expect(DATA_SCHEMAS[rec.kind as keyof typeof DATA_SCHEMAS].safeParse(rec.data).error).toBeUndefined();
    }
  });

  it("publishes a JSON Schema with all four kinds", () => {
    const text = JSON.stringify(submissionJsonSchema());
    for (const k of ["permit", "zoning_matter", "hearing_item", "zba_case", "permit_condition", "hearings"]) expect(text).toContain(k);
  });
});

describe("normalizeRecord", () => {
  it("normalizes a permit into canonical values", () => {
    const { record, issues } = normalizeRecord(permitRecord());
    expect(issues).toEqual([]);
    expect(record.source_key).toBe("100912345");
    expect(record.addresses.map((a) => [a.street_name, a.suffix, a.zip])).toEqual([["MONROE", "ST", "60603"]]);
    expect(record.community_area).toBe(32);
    expect(record.units).toBe(345);
    expect(record.parcels).toEqual(["17161230040000"]);
    expect(record.identifiers).toEqual([
      { type: "dpd_app_no", value: "23020", relation: "cited" },
      { type: "matter_key", value: "O2026-0023894", relation: "cited" },
      { type: "permit_number", value: "100912345", relation: "self" },
      { type: "record_number", value: "SO2026-0023894", relation: "cited" },
    ]);
    expect(record.organizations).toEqual([{ role: "owner", name_key: "EXAMPLE OWNER LLC", display_name: "Example Owner, L.L.C." }]);
    expect(record.attributes).toMatchObject({ classification: "qualifying_20plus", reported_cost: 120000000 });
    expect(record.attributes).not.toHaveProperty("address");
    expect(record.attributes).not.toHaveProperty("contacts");
    expect(record.source_url).toBe("https://webapps1.chicago.gov/buildingrecords/");
  });

  it("normalizes a zoning matter: matter key, all identifiers, organizations, zoning codes", () => {
    const { record } = normalizeRecord(zoningRecord());
    expect(record.source_key).toBe("O2026-0023894");
    expect(record.identifiers.filter((i) => i.relation === "self").map((i) => `${i.type}:${i.value}`)).toEqual([
      "dpd_app_no:23020", "matter_key:O2026-0023894", "record_number:SO2026-0023894",
    ]);
    expect(record.organizations.map((o) => `${o.role}:${o.name_key}`)).toEqual([
      "applicant:EXAMPLE OWNER LLC", "attorney:XIMENA CASTRO", "owner:EXAMPLE OWNER LLC",
    ]);
    expect(record.attributes).toMatchObject({ zoning_from: "DC-16", zoning_to: "PD", drive_pdf_url: "https://drive.google.com/file/d/example" });
    expect(record.event_date).toBe("2026-03-18");
    expect(record.field_sources).toEqual({ units: "ocr" });
  });

  it("reports blocking issues instead of storing raw values", () => {
    const { record, issues } = normalizeRecord(zbaRecord({ address: "12 Gotham Blvd", community_area: "Gotham" }));
    expect(record.addresses).toEqual([]);
    expect(record.community_area).toBeNull();
    expect(issues.map((i) => [i.field, i.blocking])).toEqual([["address", true], ["community_area", true]]);
    expect(issues[0]!.raw).toBe("12 Gotham Blvd");
  });

  it("records non-blocking warnings (corrected suffix)", () => {
    const { issues } = normalizeRecord(permitRecord({ address: "620 N. LaSalle St" }));
    expect(issues).toEqual([expect.objectContaining({ field: "address", blocking: false })]);
  });

  it("treats empty strings as null", () => {
    const { record } = normalizeRecord(zbaRecord({ attorney: "", vote: "" }));
    expect(record.organizations.some((o) => o.role === "attorney")).toBe(false);
    expect(record.attributes.vote).toBeNull();
  });
});

describe("hash and diff", () => {
  it("is insensitive to formatting differences", () => {
    const a = normalizeRecord(permitRecord()).record;
    const b = normalizeRecord(permitRecord({ address: "111 WEST MONROE ST", pin_list: ["17161230040000"],
      contacts: [{ role: "Owner", name: "EXAMPLE OWNER LLC" }] })).record;
    expect(contentHash(b)).toBe(contentHash(a));
    expect(diffRecords(a, b)).toEqual({});
  });

  it("reports changed fields by name", () => {
    const a = normalizeRecord(zoningRecord()).record;
    const b = normalizeRecord(zoningRecord({ status: "Final - Passed (2026-06-17)", zoning_to: "PD 1550" })).record;
    expect(Object.keys(diffRecords(a, b)).sort()).toEqual(["status", "zoning_to"]);
    expect(diffRecords(a, b).status).toEqual({ before: "In Committee - Referred", after: "Final - Passed (2026-06-17)" });
  });

  it("diff against nothing lists every non-empty field", () => {
    // A ZBA outcome is stored as the record's status.
    expect(Object.keys(diffRecords(null, normalizeRecord(zbaRecord()).record))).toEqual(expect.arrayContaining(["status", "request_type", "address"]));
  });

  it("stableStringify sorts keys", () => {
    expect(stableStringify({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
  });

  it.each(ALL_FIXTURES.map((f) => [f().kind, f]))("%s survives denormalize → normalize unchanged", (_k, f) => {
    const first = normalizeRecord(f()).record;
    const again = normalizeRecord(denormalizeRecord(first)).record;
    expect(contentHash(again)).toBe(contentHash(first));
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm test shared/tests/records.test.ts`
Expected: FAIL — cannot resolve `../records/normalize-record`.

- [ ] **Step 4: Hash and diff**

`shared/records/hash.ts`:

```ts
import { createHash } from "node:crypto";
import { addressKey } from "../normalize/address";
import type { Issue, NormalizedRecord } from "./types";

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}

/**
 * What makes two records "the same": canonical values only — no display names, geocode, ZIP (it lives on the
 * shared address row, first value wins) or provenance. Lists are sorted by code point so storage order never matters.
 */
export function hashable(r: NormalizedRecord): unknown {
  const { point: _p, field_sources: _f, organizations, identifiers, parcels, addresses, ...rest } = r;
  return {
    ...rest,
    addresses: addresses.map(addressKey), // order kept: [0] is the primary address
    parcels: [...parcels].sort(),
    identifiers: identifiers.map((i) => `${i.type}:${i.value}:${i.relation}`).sort(),
    organizations: organizations.map((o) => `${o.role}:${o.name_key}`).sort(),
  };
}

export function contentHash(record: NormalizedRecord, issues: Issue[] = []): string {
  const blocking = issues.filter((i) => i.blocking).map((i) => [i.field, i.raw]);
  return createHash("sha256").update(stableStringify({ r: hashable(record), i: blocking })).digest("hex");
}
```

`shared/records/diff.ts`:

```ts
import { addressKey } from "../normalize/address";
import { stableStringify } from "./hash";
import type { NormalizedRecord } from "./types";

type Flat = Record<string, unknown>;

function flatten(r: NormalizedRecord): Flat {
  const { kind: _k, source_key: _s, point: _p, field_sources: _f, attributes, addresses, organizations, identifiers, ...scalars } = r;
  return {
    ...scalars,
    ...attributes,
    address: addresses[0] ? addressKey(addresses[0]) : null,
    additional_addresses: addresses.slice(1).map(addressKey),
    organizations: organizations.map((o) => `${o.role}: ${o.display_name}`).sort(),
    organization_keys: organizations.map((o) => `${o.role}:${o.name_key}`).sort(),
    identifiers: identifiers.map((i) => `${i.type}:${i.value}${i.relation === "cited" ? " (cited)" : ""}`).sort(),
  };
}

const empty = (v: unknown) => v === null || v === undefined || (Array.isArray(v) && v.length === 0);

/** Field-by-field changes. Organization display names are shown, but only name-key changes count. */
export function diffRecords(before: NormalizedRecord | null, after: NormalizedRecord): Record<string, { before: unknown; after: unknown }> {
  const a = before ? flatten(before) : {};
  const b = flatten(after);
  const out: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === "organizations") continue;
    const x = a[key] ?? null;
    const y = b[key] ?? null;
    if (!before && empty(y)) continue;
    if (stableStringify(x) !== stableStringify(y)) {
      out[key === "organization_keys" ? "organizations" : key] =
        key === "organization_keys" ? { before: a.organizations ?? [], after: b.organizations } : { before: x, after: y };
    }
  }
  return out;
}
```

- [ ] **Step 5: normalizeRecord**

`shared/records/normalize-record.ts`:

```ts
import { normalizeAddress, type CanonicalAddress } from "../normalize/address";
import {
  blankToNull, extractCitedKeys, matterKeyOf, normalizeCommunityArea, normalizeDpdAppNo, normalizePin,
  normalizeRecordNumber, normalizeZoning, orgNameKey,
} from "../normalize/primitives";
import type { Issue, NormalizeResult, NormalizedRecord, OrgRole, RecordIdentifier, RecordOrganization, WireRecord } from "./types";

type Data = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? blankToNull(v) : null);
const n = (v: unknown) => (typeof v === "number" ? v : null);
const b = (v: unknown) => (typeof v === "boolean" ? v : null);

class Collector {
  issues: Issue[] = [];
  identifiers = new Map<string, RecordIdentifier>();
  orgs = new Map<string, RecordOrganization>();
  parcels = new Set<string>();
  addresses: CanonicalAddress[] = [];

  address(field: string, raw: string | null, zip: string | null, primary: boolean) {
    if (!raw) return;
    const r = normalizeAddress(raw, zip);
    if (!r.ok) { this.issues.push({ field, raw, message: r.message, blocking: primary }); return; }
    if (r.warning) this.issues.push({ field, raw, message: r.warning, blocking: false });
    this.addresses.push(r.value);
  }
  id(type: RecordIdentifier["type"], value: string, relation: RecordIdentifier["relation"]) {
    this.identifiers.set(`${type}|${value}|${relation}`, { type, value, relation });
  }
  dpd(raw: string | null, relation: RecordIdentifier["relation"], field = "dpd_app_no") {
    if (!raw) return;
    const r = normalizeDpdAppNo(raw);
    if (r.ok) this.id("dpd_app_no", r.value, relation);
    else this.issues.push({ field, raw, message: r.message, blocking: true });
  }
  recordNumber(raw: string | null, relation: RecordIdentifier["relation"], field = "record_number") {
    if (!raw) return;
    const r = normalizeRecordNumber(raw);
    if (!r.ok) { this.issues.push({ field, raw, message: r.message, blocking: true }); return; }
    this.id("record_number", r.value, relation);
    this.id("matter_key", matterKeyOf(r.value), relation);
  }
  org(role: OrgRole, raw: string | null) {
    if (!raw) return;
    const key = orgNameKey(raw);
    if (key) this.orgs.set(`${role}|${key}`, { role, name_key: key, display_name: raw });
  }
  pin(raw: string) {
    const r = normalizePin(raw);
    if (r.ok) this.parcels.add(r.value);
    else this.issues.push({ field: "pin_list", raw, message: r.message, blocking: true });
  }
  communityArea(raw: unknown): number | null {
    if (raw === null || raw === undefined || raw === "") return null;
    const r = normalizeCommunityArea(raw as string | number);
    if (r.ok) return r.value;
    this.issues.push({ field: "community_area", raw, message: r.message, blocking: true });
    return null;
  }
}

const zoning = (v: unknown) => { const t = s(v); return t ? normalizeZoning(t) : null; };

function contactRole(role: string): OrgRole {
  const r = role.toUpperCase();
  if (r.includes("OWNER")) return "owner";
  if (r.includes("ARCHITECT")) return "architect";
  if (r.includes("CONTRACTOR")) return "contractor";
  if (r.includes("ATTORNEY")) return "attorney";
  if (r.includes("APPLICANT")) return "applicant";
  return "other";
}

function sorted<T>(xs: Iterable<T>, key: (x: T) => string): T[] {
  return [...xs].sort((x, y) => key(x).localeCompare(key(y)));
}

/** Wire record (already validated by DATA_SCHEMAS[kind]) → canonical record + issues. Pure. */
export function normalizeRecord(rec: WireRecord): NormalizeResult {
  const d: Data = rec.data;
  const c = new Collector();
  const zip = s(d.zip);
  let sourceKey = rec.source_key.trim();
  let units: number | null = n(d.units);
  let status: string | null = null;
  let eventDate: string | null = null;
  let sourceUrl: string | null = s(d.source_url);
  let flag: string | null = s(d.flag);
  let attributes: Data = {};

  switch (rec.kind) {
    case "permit": {
      sourceKey = (s(d.permit_number) ?? sourceKey).toUpperCase();
      c.id("permit_number", sourceKey, "self");
      c.address("address", s(d.address), zip, true);
      const cited = extractCitedKeys(s(d.permit_condition) ?? "");
      for (const app of cited.dpd_app_no) c.id("dpd_app_no", app, "cited");
      for (const rn of cited.record_number) c.recordNumber(rn, "cited", "permit_condition");
      for (const contact of (d.contacts as { role: string; name: string }[] | null) ?? []) c.org(contactRole(contact.role), s(contact.name));
      for (const pin of (d.pin_list as string[] | null) ?? []) if (blankToNull(pin)) c.pin(pin);
      const u = (d.units as Record<string, number | null> | null) ?? null;
      units = u ? (u.total ?? u.dwelling ?? null) : null;
      status = s(d.permit_status);
      eventDate = s(d.issue_date);
      sourceUrl = s(d.portal_url);
      flag = null;
      attributes = {
        classification: d.classification, permit_type: s(d.permit_type), issue_date: s(d.issue_date),
        units_detail: u, unit_flag: s(d.unit_flag), reported_cost: n(d.reported_cost),
        short_description: s(d.short_description), work_description: s(d.work_description),
        permit_condition: s(d.permit_condition), scope: s(d.scope),
      };
      break;
    }
    case "zoning_matter": {
      c.recordNumber(s(d.record_number), "self");
      const rn = normalizeRecordNumber(s(d.record_number) ?? "");
      sourceKey = rn.ok ? matterKeyOf(rn.value) : matterKeyOf(sourceKey.toUpperCase());
      c.id("matter_key", sourceKey, "self");
      const guid = s(d.matter_id);
      if (guid) c.id("elms_matter_id", guid.toLowerCase(), "self");
      c.dpd(s(d.dpd_app_no), "self");
      c.address("address", s(d.address), zip, true);
      for (const extra of (d.additional_addresses as string[] | null) ?? []) c.address("additional_addresses", blankToNull(extra), zip, false);
      c.org("applicant", s(d.applicant)); c.org("owner", s(d.owner)); c.org("attorney", s(d.attorney));
      status = s(d.status);
      eventDate = s(d.introduced_date) ?? s(d.filed_date);
      attributes = {
        title: s(d.title), filed_date: s(d.filed_date), introduced_date: s(d.introduced_date), hearing_date: s(d.hearing_date),
        zoning_from: zoning(d.zoning_from), zoning_to: zoning(d.zoning_to), lot_size_sqft: n(d.lot_size_sqft),
        height_ft: n(d.height_ft), parking: n(d.parking), aro: b(d.aro), pd: b(d.pd), aldermanic: b(d.aldermanic),
        drive_pdf_url: s(d.drive_pdf_url),
      };
      break;
    }
    case "hearing_item": {
      const [datePart, ref] = sourceKey.split("|");
      const app = normalizeDpdAppNo(s(d.dpd_app_no) ?? ref ?? "");
      sourceKey = `${s(d.hearing_date) ?? datePart}|${app.ok ? app.value : (ref ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      c.dpd(s(d.dpd_app_no), "self");
      const mk = s(d.matter_key);
      if (mk) c.recordNumber(mk, "cited", "matter_key");
      c.address("address", s(d.address), zip, true);
      c.org("applicant", s(d.applicant));
      eventDate = s(d.hearing_date);
      attributes = {
        body: d.body, hearing_date: s(d.hearing_date), request: s(d.request), zoning_from: zoning(d.zoning_from),
        zoning_to: zoning(d.zoning_to), height_ft: n(d.height_ft), parking: n(d.parking), pd: b(d.pd),
      };
      flag = null;
      break;
    }
    case "zba_case": {
      sourceKey = (s(d.case_no) ?? sourceKey).toUpperCase();
      c.id("zba_case_no", sourceKey, "self");
      c.address("address", s(d.address), zip, true);
      c.org("applicant", s(d.applicant)); c.org("owner", s(d.owner)); c.org("attorney", s(d.attorney));
      status = s(d.outcome);
      eventDate = s(d.decision_date) ?? s(d.hearing_date) ?? s(d.first_hearing);
      sourceUrl = s(d.source_pdf_url);
      attributes = {
        request_type: s(d.request_type), first_hearing: s(d.first_hearing), hearing_date: s(d.hearing_date),
        zoning_district: zoning(d.zoning_district), request: s(d.request), residential: b(d.residential),
        vote: s(d.vote), decision_date: s(d.decision_date), hearings: d.hearings ?? [], resolution_pdf_url: s(d.resolution_pdf_url),
      };
      break;
    }
  }

  const lat = n(d.lat);
  const lon = n(d.lon);
  const record: NormalizedRecord = {
    kind: rec.kind,
    source_key: sourceKey,
    addresses: c.addresses,
    point: lat !== null && lon !== null ? { lat, lon } : null,
    community_area: c.communityArea(d.community_area),
    ward: n(d.ward),
    units,
    status,
    event_date: eventDate,
    in_target: d.in_target === true,
    flag,
    notes: s(d.notes),
    source_url: sourceUrl,
    parcels: [...c.parcels].sort(),
    identifiers: sorted(c.identifiers.values(), (i) => `${i.type}|${i.value}|${i.relation}`),
    organizations: sorted(c.orgs.values(), (o) => `${o.role}|${o.name_key}`),
    attributes,
    field_sources: rec.field_sources ?? {},
  };
  return { record, issues: c.issues };
}
```

Note the ordering expected by the tests: identifiers sorted by `type|value|relation`, issues in the order fields are processed (address, then community area last).

- [ ] **Step 6: denormalizeRecord**

`shared/records/denormalize-record.ts`:

```ts
import { formatAddressDisplay } from "../normalize/address";
import type { NormalizedRecord, OrgRole, WireRecord } from "./types";

const ids = (r: NormalizedRecord, type: string, relation: "self" | "cited") =>
  r.identifiers.filter((i) => i.type === type && i.relation === relation).map((i) => i.value);
const org = (r: NormalizedRecord, role: OrgRole) => r.organizations.find((o) => o.role === role)?.display_name ?? null;
const ROLE_LABEL: Record<OrgRole, string> = { applicant: "Applicant", owner: "Owner", attorney: "Attorney", contractor: "Contractor", architect: "Architect", other: "Other" };

/** Canonical record → wire format, so an edit can be re-validated and re-normalized like a Grok push. */
export function denormalizeRecord(r: NormalizedRecord): WireRecord {
  const a = r.attributes as Record<string, unknown>;
  const primary = r.addresses[0];
  const common = {
    address: primary ? formatAddressDisplay(primary) : null,
    zip: primary?.zip ?? null,
    community_area: r.community_area,
    ward: r.ward,
    lat: r.point?.lat ?? null,
    lon: r.point?.lon ?? null,
    notes: r.notes,
    in_target: r.in_target,
  };
  let data: Record<string, unknown>;
  switch (r.kind) {
    case "permit":
      data = {
        ...common, permit_number: r.source_key, classification: a.classification, issue_date: a.issue_date,
        permit_type: a.permit_type, units: a.units_detail, unit_flag: a.unit_flag, reported_cost: a.reported_cost,
        contacts: r.organizations.map((o) => ({ role: ROLE_LABEL[o.role], name: o.display_name })),
        short_description: a.short_description, work_description: a.work_description, permit_status: r.status,
        permit_condition: a.permit_condition, pin_list: r.parcels, portal_url: r.source_url, scope: a.scope,
      };
      break;
    case "zoning_matter":
      data = {
        ...common, record_number: ids(r, "record_number", "self")[0] ?? r.source_key,
        matter_id: ids(r, "elms_matter_id", "self")[0] ?? null, dpd_app_no: ids(r, "dpd_app_no", "self")[0] ?? null,
        title: a.title, filed_date: a.filed_date, introduced_date: a.introduced_date, hearing_date: a.hearing_date,
        additional_addresses: r.addresses.slice(1).map(formatAddressDisplay),
        applicant: org(r, "applicant"), owner: org(r, "owner"), attorney: org(r, "attorney"),
        zoning_from: a.zoning_from, zoning_to: a.zoning_to, lot_size_sqft: a.lot_size_sqft, units: r.units,
        height_ft: a.height_ft, parking: a.parking, aro: a.aro, pd: a.pd, aldermanic: a.aldermanic,
        status: r.status, flag: r.flag, source_url: r.source_url, drive_pdf_url: a.drive_pdf_url,
      };
      break;
    case "hearing_item":
      data = {
        ...common, body: a.body, hearing_date: a.hearing_date, dpd_app_no: ids(r, "dpd_app_no", "self")[0] ?? null,
        matter_key: ids(r, "record_number", "cited")[0] ?? null, applicant: org(r, "applicant"), request: a.request,
        zoning_from: a.zoning_from, zoning_to: a.zoning_to, units: r.units, height_ft: a.height_ft, parking: a.parking,
        pd: a.pd, source_url: r.source_url,
      };
      break;
    case "zba_case":
      data = {
        ...common, case_no: r.source_key, request_type: a.request_type, first_hearing: a.first_hearing,
        hearing_date: a.hearing_date, applicant: org(r, "applicant"), owner: org(r, "owner"), attorney: org(r, "attorney"),
        zoning_district: a.zoning_district, request: a.request, units: r.units, residential: a.residential,
        outcome: r.status, vote: a.vote, decision_date: a.decision_date, hearings: a.hearings,
        source_pdf_url: r.source_url, resolution_pdf_url: a.resolution_pdf_url, flag: r.flag,
      };
      break;
  }
  return { kind: r.kind, source_key: r.source_key, data, field_sources: r.field_sources };
}
```

- [ ] **Step 7: Run the tests**

Run: `pnpm test shared/tests/records.test.ts`
Expected: PASS. (If the permit identifier list differs only in order, fix the sort in `normalizeRecord`, not the test.)

- [ ] **Step 8: Commit**

```bash
git add shared/records shared/tests/records.test.ts shared/tests/fixtures.ts
git commit -m "feat(shared): Grok wire schemas, record normalization, content hash and diff

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 6: Core schema, history trigger, database client and `withActor`

**Files:**
- Create: `server/migrations/002_core.sql`, `server/src/db/types.ts`, `server/src/db/client.ts`, `server/src/db/actor.ts`, `server/tests/history.test.ts`
- Modify: `server/tests/helpers/db.ts` (add `getTestDb`, `resetDb`)

**Interfaces:**
- Produces:
  - `type Db = Kysely<DB>`; `createDb(url: string): Db` (bigint → number, date → `YYYY-MM-DD` string)
  - `geogPoint(lat: number, lon: number): RawBuilder<unknown>`
  - `withActor<T>(db: Db, actor: string, reason: string, fn: (q: Db) => Promise<T>): Promise<T>`
  - test helpers `getTestDb(): Db`, `resetDb(db: Db): Promise<void>`
  - every table in spec §6 (with the plan's deviations) and the `record_revision()` trigger

- [ ] **Step 1: Write the failing history tests**

`server/tests/history.test.ts`:

```ts
import { sql } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";
import { withActor } from "../src/db/actor";
import { getTestDb, resetDb } from "./helpers/db";

const db = getTestDb();
beforeEach(() => resetDb(db));

const revisions = () => db.selectFrom("revisions").selectAll().orderBy("id").execute();

describe("history trigger", () => {
  it("refuses writes without an actor", async () => {
    await expect(db.insertInto("parcels").values({ pin: "17161230040000" }).execute()).rejects.toThrow(/app\.actor/);
  });

  it("records inserts, updates, soft deletes and restores with actor and reason", async () => {
    await withActor(db, "drew", "admin_edit", (q) =>
      q.insertInto("organizations").values({ name_key: "ACME LLC", display_name: "Acme LLC" }).execute());
    await withActor(db, "drew", "admin_edit", (q) =>
      q.updateTable("organizations").set({ display_name: "Acme, LLC" }).where("name_key", "=", "ACME LLC").execute());
    await withActor(db, "drew", "admin_edit", (q) =>
      q.updateTable("organizations").set({ deleted_at: new Date() }).where("name_key", "=", "ACME LLC").execute());
    await withActor(db, "grok", "queue_item:9", (q) =>
      q.updateTable("organizations").set({ deleted_at: null }).where("name_key", "=", "ACME LLC").execute());

    const rows = await revisions();
    expect(rows.map((r) => [r.table_name, r.version, r.op, r.actor, r.reason])).toEqual([
      ["organizations", 1, "insert", "drew", "admin_edit"],
      ["organizations", 2, "update", "drew", "admin_edit"],
      ["organizations", 3, "delete", "drew", "admin_edit"],
      ["organizations", 4, "restore", "grok", "queue_item:9"],
    ]);
    expect((rows[1]!.before as { display_name: string }).display_name).toBe("Acme LLC");
    expect((rows[1]!.after as { display_name: string }).display_name).toBe("Acme, LLC");
  });

  it("ignores updates that change nothing but updated_at", async () => {
    await withActor(db, "drew", "admin_edit", async (q) => {
      await q.insertInto("parcels").values({ pin: "17161230040000" }).execute();
      await q.updateTable("parcels").set({ pin: "17161230040000" }).execute();
    });
    expect((await revisions()).length).toBe(1);
  });

  it("marks merges and keys composite rows by all key columns", async () => {
    await withActor(db, "drew", "merge:organization:2->1", async (q) => {
      await q.insertInto("parcels").values({ pin: "17161230040000" }).execute();
    });
    const [rev] = await revisions();
    expect(rev!.op).toBe("merge");
    expect(rev!.record_id).toBe("17161230040000");
  });

  it("allows only one site_state row", async () => {
    await expect(sql`insert into site_state (id) values (2)`.execute(db)).rejects.toThrow();
  });
});
```

Extend `server/tests/helpers/db.ts`:

```ts
import { sql } from "kysely";
import { createDb, type Db } from "../../src/db/client";

let shared: Db | undefined;
export function getTestDb(): Db {
  shared ??= createDb(TEST_DATABASE_URL);
  return shared;
}

const DATA_TABLES = [
  "revisions", "bulk_previews", "queue_items", "submissions", "tokens", "project_filings", "project_addresses",
  "filing_organizations", "filing_identifiers", "filing_parcels", "filing_addresses", "projects", "filings",
  "organizations", "identifiers", "addresses", "parcels", "job_runs", "site_state",
];

/** Empties every data table (statement-level, so no history rows) and re-creates the site_state row. */
export async function resetDb(db: Db): Promise<void> {
  await sql.raw(`truncate ${DATA_TABLES.join(", ")} restart identity cascade`).execute(db);
  await sql`insert into site_state default values`.execute(db);
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter server test tests/history.test.ts`
Expected: FAIL — cannot resolve `../../src/db/client`.

- [ ] **Step 3: Migration 002**

`server/migrations/002_core.sql`:

```sql
-- ---------- helpers ----------
create function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- History for every record table. TG_ARGV = key columns. Refuses writes when app.actor is unset.
create function record_revision() returns trigger language plpgsql as $$
declare
  actor text := nullif(current_setting('app.actor', true), '');
  reason text := coalesce(nullif(current_setting('app.reason', true), ''), 'unspecified');
  old_j jsonb;
  new_j jsonb;
  rec jsonb;
  rid text;
  op text;
  v int;
begin
  if actor is null then
    raise exception 'app.actor is not set: run writes inside withActor()';
  end if;
  if tg_op = 'INSERT' then
    new_j := to_jsonb(new); rec := new_j; op := 'insert';
  elsif tg_op = 'DELETE' then
    old_j := to_jsonb(old); rec := old_j; op := 'delete';
  else
    old_j := to_jsonb(old); new_j := to_jsonb(new); rec := new_j;
    if (old_j - 'updated_at') = (new_j - 'updated_at') then
      return new;
    end if;
    op := case
      when old_j->>'deleted_at' is null and new_j->>'deleted_at' is not null then 'delete'
      when old_j->>'deleted_at' is not null and new_j->>'deleted_at' is null then 'restore'
      else 'update' end;
  end if;
  if reason like 'merge:%' then op := 'merge'; end if;
  select string_agg(rec->>k, ':' order by ord) into rid from unnest(tg_argv) with ordinality as t(k, ord);
  select coalesce(max(version), 0) + 1 into v from revisions where table_name = tg_table_name and record_id = rid;
  insert into revisions (table_name, record_id, version, op, before, after, actor, reason)
    values (tg_table_name, rid, v, op, old_j, new_j, actor, reason);
  return coalesce(new, old);
end $$;

-- ---------- history ----------
create table revisions (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id text not null,
  version int not null,
  op text not null check (op in ('insert', 'update', 'delete', 'restore', 'merge')),
  before jsonb,
  after jsonb,
  actor text not null,
  reason text not null,
  at timestamptz not null default now(),
  unique (table_name, record_id, version)
);

-- ---------- canonical shared values ----------
create table parcels (
  pin text primary key check (pin ~ '^[0-9]{14}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table addresses (
  id bigint generated always as identity primary key,
  number_from int not null check (number_from > 0),
  number_to int not null,
  predir text check (predir in ('N', 'S', 'E', 'W')),
  street_name text not null,
  suffix text,
  zip text check (zip ~ '^[0-9]{5}$'),
  point geography(Point, 4326),
  merged_into_id bigint references addresses (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (number_to >= number_from),
  unique nulls not distinct (number_from, number_to, predir, street_name, suffix)
);
create index addresses_street on addresses (street_name, predir);
create index addresses_point on addresses using gist (point);

create table identifiers (
  id bigint generated always as identity primary key,
  type text not null check (type in ('permit_number', 'matter_key', 'record_number', 'elms_matter_id', 'dpd_app_no', 'zba_case_no')),
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (type, value)
);

create table organizations (
  id bigint generated always as identity primary key,
  name_key text not null unique,
  display_name text not null,
  merged_into_id bigint references organizations (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------- records ----------
create table filings (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('permit', 'zoning_matter', 'hearing_item', 'zba_case')),
  source_key text not null,
  primary_address_id bigint references addresses (id),
  community_area int references community_areas (number),
  ward int check (ward between 1 and 50),
  units int check (units >= 0),
  status text,
  event_date date,
  in_target boolean not null,
  flag text,
  notes text,
  source_url text,
  attributes jsonb not null default '{}',
  field_sources jsonb not null default '{}',
  content_hash text not null,
  last_source_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (kind, source_key)
);

create table projects (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  dpd_map_no int check (dpd_map_no between 1 and 25),
  name text,
  developer text,
  units int check (units > 0),
  units_source_filing_id bigint references filings (id),
  affordable_units int check (affordable_units >= 0),
  tpc_usd bigint check (tpc_usd > 0),
  program text not null check (program in ('lasalle', 'private')),
  public_support text,
  status text not null check (status in ('completed', 'under_construction', 'permitted', 'approved', 'planning')),
  status_note text not null check (status_note <> ''),
  flag text,
  confidence text not null check (confidence in ('dpd', 'reported')),
  built_by_3f_url text,
  point geography(Point, 4326) not null,
  sources text[] not null check (cardinality(sources) >= 1),
  notes text,
  visibility text not null default 'draft' check (visibility in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index projects_point on projects using gist (point);

create table project_addresses (
  project_id text not null references projects (id),
  address_id bigint not null references addresses (id),
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (project_id, address_id)
);
create unique index project_primary_address on project_addresses (project_id) where is_primary;

create table filing_addresses (
  filing_id bigint not null references filings (id),
  address_id bigint not null references addresses (id),
  position int not null,
  primary key (filing_id, address_id)
);
create table filing_parcels (
  filing_id bigint not null references filings (id),
  pin text not null references parcels (pin),
  primary key (filing_id, pin)
);
create table filing_identifiers (
  filing_id bigint not null references filings (id),
  identifier_id bigint not null references identifiers (id),
  relation text not null check (relation in ('self', 'cited')),
  current boolean not null default true,
  primary key (filing_id, identifier_id, relation)
);
create index filing_identifiers_identifier on filing_identifiers (identifier_id);
create table filing_organizations (
  filing_id bigint not null references filings (id),
  organization_id bigint not null references organizations (id),
  role text not null check (role in ('applicant', 'owner', 'attorney', 'contractor', 'architect', 'other')),
  primary key (filing_id, organization_id, role)
);
create index filing_organizations_org on filing_organizations (organization_id);

create table project_filings (
  project_id text not null references projects (id),
  filing_id bigint not null references filings (id),
  role text not null check (role in ('zoning', 'hearing', 'permit', 'early_signal')),
  linked_by text not null,
  linked_at timestamptz not null default now(),
  reason text not null,
  primary key (project_id, filing_id)
);
create index project_filings_filing on project_filings (filing_id);

-- ---------- intake ----------
create table tokens (
  jti text primary key,
  sub text not null,
  role text not null check (role in ('submitter', 'editor')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);

create table submissions (
  id bigint generated always as identity primary key,
  token_jti text not null references tokens (jti),
  idempotency_key text not null,
  body_sha256 text not null,
  body jsonb not null,
  response jsonb,
  received_at timestamptz not null default now(),
  unique (token_jti, idempotency_key)
);

create table queue_items (
  id bigint generated always as identity primary key,
  submission_id bigint not null references submissions (id),
  record_index int not null,
  kind text not null,
  source_key text not null,
  action text not null check (action in ('create', 'update')),
  proposed jsonb not null,
  content_hash text not null,
  diff jsonb not null default '{}',
  normalization_issues jsonb not null default '[]',
  suggestions jsonb not null default '{}',
  in_target boolean not null,
  has_flag boolean not null,
  has_blocking_issues boolean not null,
  top_strength text check (top_strength in ('strong', 'likely', 'possible')),
  address_display text,
  state text not null default 'pending' check (state in ('pending', 'approved', 'rejected', 'superseded')),
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index queue_items_key on queue_items (kind, source_key, state);
create index queue_items_pending on queue_items (kind) where state = 'pending';

create table bulk_previews (
  code text primary key,
  action text not null check (action in ('approve', 'reject')),
  filter jsonb not null,
  item_ids bigint[] not null,
  link_strong boolean not null,
  reason text,
  created_by text not null,
  expires_at timestamptz not null
);

-- ---------- publishing and jobs ----------
create table site_state (
  id int primary key default 1 check (id = 1),
  dirty boolean not null default false,
  last_change_at timestamptz,
  last_build_requested_at timestamptz,
  last_published_at timestamptz
);
insert into site_state default values;

create table job_runs (
  name text not null,
  run_date date not null,
  at timestamptz not null default now(),
  primary key (name, run_date)
);

-- ---------- triggers ----------
create trigger parcels_updated before update on parcels for each row execute function set_updated_at();
create trigger addresses_updated before update on addresses for each row execute function set_updated_at();
create trigger identifiers_updated before update on identifiers for each row execute function set_updated_at();
create trigger organizations_updated before update on organizations for each row execute function set_updated_at();
create trigger filings_updated before update on filings for each row execute function set_updated_at();
create trigger projects_updated before update on projects for each row execute function set_updated_at();

create trigger parcels_history after insert or update or delete on parcels for each row execute function record_revision('pin');
create trigger addresses_history after insert or update or delete on addresses for each row execute function record_revision('id');
create trigger identifiers_history after insert or update or delete on identifiers for each row execute function record_revision('id');
create trigger organizations_history after insert or update or delete on organizations for each row execute function record_revision('id');
create trigger filings_history after insert or update or delete on filings for each row execute function record_revision('id');
create trigger projects_history after insert or update or delete on projects for each row execute function record_revision('id');
create trigger project_addresses_history after insert or update or delete on project_addresses for each row execute function record_revision('project_id', 'address_id');
create trigger filing_addresses_history after insert or update or delete on filing_addresses for each row execute function record_revision('filing_id', 'address_id');
create trigger filing_parcels_history after insert or update or delete on filing_parcels for each row execute function record_revision('filing_id', 'pin');
create trigger filing_identifiers_history after insert or update or delete on filing_identifiers for each row execute function record_revision('filing_id', 'identifier_id', 'relation');
create trigger filing_organizations_history after insert or update or delete on filing_organizations for each row execute function record_revision('filing_id', 'organization_id', 'role');
create trigger project_filings_history after insert or update or delete on project_filings for each row execute function record_revision('project_id', 'filing_id');
```

- [ ] **Step 4: Kysely types, client and `withActor`**

`server/src/db/types.ts`:

```ts
import type { ColumnType, Generated } from "kysely";

type Ts = ColumnType<Date, Date | string | undefined, Date | string>;
type TsNull = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
/** jsonb: always written as JSON.stringify(...) (pg would turn JS arrays into Postgres arrays). */
type Jsonb<T = unknown> = ColumnType<T, string | undefined, string>;
type JsonbNull<T = unknown> = ColumnType<T | null, string | null | undefined, string | null>;
/** geography: written only through geogPoint(); read through ST_X/ST_Y. */
type Geo = ColumnType<unknown, unknown, unknown>;

export interface DB {
  schema_migrations: { name: string; applied_at: Generated<Date> };
  community_areas: { number: number; name: string };
  revisions: {
    id: Generated<number>; table_name: string; record_id: string; version: number; op: string;
    before: JsonbNull; after: JsonbNull; actor: string; reason: string; at: Generated<Date>;
  };
  parcels: { pin: string; created_at: Generated<Date>; updated_at: Generated<Date>; deleted_at: TsNull };
  addresses: {
    id: Generated<number>; number_from: number; number_to: number; predir: string | null; street_name: string;
    suffix: string | null; zip: string | null; point: Geo; merged_into_id: number | null;
    created_at: Generated<Date>; updated_at: Generated<Date>; deleted_at: TsNull;
  };
  identifiers: { id: Generated<number>; type: string; value: string; created_at: Generated<Date>; updated_at: Generated<Date> };
  organizations: {
    id: Generated<number>; name_key: string; display_name: string; merged_into_id: number | null;
    created_at: Generated<Date>; updated_at: Generated<Date>; deleted_at: TsNull;
  };
  filings: {
    id: Generated<number>; kind: string; source_key: string; primary_address_id: number | null;
    community_area: number | null; ward: number | null; units: number | null; status: string | null;
    event_date: string | null; in_target: boolean; flag: string | null; notes: string | null; source_url: string | null;
    attributes: Jsonb<Record<string, unknown>>; field_sources: Jsonb<Record<string, string>>;
    content_hash: string; last_source_hash: string | null;
    created_at: Generated<Date>; updated_at: Generated<Date>; deleted_at: TsNull;
  };
  projects: {
    id: string; dpd_map_no: number | null; name: string | null; developer: string | null; units: number | null;
    units_source_filing_id: number | null; affordable_units: number | null; tpc_usd: number | null; program: string;
    public_support: string | null; status: string; status_note: string; flag: string | null; confidence: string;
    built_by_3f_url: string | null; point: Geo; sources: string[]; notes: string | null; visibility: Generated<string>;
    created_at: Generated<Date>; updated_at: Generated<Date>; deleted_at: TsNull;
  };
  project_addresses: { project_id: string; address_id: number; is_primary: Generated<boolean>; created_at: Generated<Date> };
  filing_addresses: { filing_id: number; address_id: number; position: number };
  filing_parcels: { filing_id: number; pin: string };
  filing_identifiers: { filing_id: number; identifier_id: number; relation: string; current: Generated<boolean> };
  filing_organizations: { filing_id: number; organization_id: number; role: string };
  project_filings: { project_id: string; filing_id: number; role: string; linked_by: string; linked_at: Generated<Date>; reason: string };
  tokens: { jti: string; sub: string; role: string; created_at: Generated<Date>; revoked_at: TsNull; last_used_at: TsNull };
  submissions: {
    id: Generated<number>; token_jti: string; idempotency_key: string; body_sha256: string;
    body: Jsonb; response: JsonbNull; received_at: Generated<Date>;
  };
  queue_items: {
    id: Generated<number>; submission_id: number; record_index: number; kind: string; source_key: string; action: string;
    proposed: Jsonb; content_hash: string; diff: Jsonb; normalization_issues: Jsonb; suggestions: Jsonb;
    in_target: boolean; has_flag: boolean; has_blocking_issues: boolean; top_strength: string | null;
    address_display: string | null; state: Generated<string>; reviewed_by: string | null; reviewed_at: TsNull;
    review_note: string | null; created_at: Generated<Date>;
  };
  bulk_previews: {
    code: string; action: string; filter: Jsonb; item_ids: number[]; link_strong: boolean; reason: string | null;
    created_by: string; expires_at: Ts;
  };
  site_state: {
    id: Generated<number>; dirty: Generated<boolean>; last_change_at: TsNull; last_build_requested_at: TsNull; last_published_at: TsNull;
  };
  job_runs: { name: string; run_date: string; at: Generated<Date> };
}
```

`server/src/db/client.ts`:

```ts
import { Kysely, PostgresDialect, sql, type RawBuilder } from "kysely";
import pg from "pg";
import type { DB } from "./types";

pg.types.setTypeParser(20, (v) => Number(v)); // int8 ids and dollar amounts fit in a double
pg.types.setTypeParser(1082, (v) => v); // date stays "YYYY-MM-DD"

export type Db = Kysely<DB>;

export function createDb(url: string): Db {
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 10 }) }) });
}

export function geogPoint(lat: number, lon: number): RawBuilder<unknown> {
  return sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography`;
}
```

`server/src/db/actor.ts`:

```ts
import { sql } from "kysely";
import type { Db } from "./client";

/** Runs fn in a transaction whose writes are attributed to `actor` with `reason` (read by the history trigger). */
export function withActor<T>(db: Db, actor: string, reason: string, fn: (q: Db) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.actor', ${actor}, true), set_config('app.reason', ${reason}, true)`.execute(trx);
    return fn(trx);
  });
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter server test`
Expected: PASS (smoke, migrate, history).

- [ ] **Step 6: Commit**

```bash
git add server
git commit -m "feat(server): core schema with history trigger, Kysely client and withActor

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Configuration, tokens and auth middleware

**Files:**
- Create: `server/src/config.ts`, `server/src/errors.ts`, `server/src/auth/tokens.ts`, `server/src/auth/middleware.ts`, `server/src/cli/token.ts`, `server/tests/helpers/app.ts` (config part), `server/tests/auth.test.ts`

**Interfaces:**
- Consumes: `Db`, `createDb` (Task 6).
- Produces:
  - `interface Config { DATABASE_URL: string; JWT_SECRET: string; PORT: number; MIGRATIONS_DIR: string; SITE_BUILD_HOOK_URL?: string; SITE_BUILD_HOOK_TOKEN?: string; RESEND_API_KEY?: string; ALERT_FROM?: string; ALERT_TO?: string }`, `loadConfig(env?: NodeJS.ProcessEnv): Config`
  - `class HttpError extends Error { status: number; details?: unknown }`
  - `type Role = "submitter" | "editor"`, `interface Principal { sub: string; role: Role; jti: string }`
  - `issueToken(db, secret, sub, role): Promise<{ token: string; jti: string }>`, `revokeToken(db, jti): Promise<boolean>`, `verifyToken(db, secret, token): Promise<Principal | null>`
  - `type AppEnv = { Variables: { principal: Principal | null } }`, `authenticate(deps: { db: Db; config: Config }): MiddlewareHandler<AppEnv>`, `requireRole(role: Role): MiddlewareHandler<AppEnv>`
  - `testConfig: Config` in `tests/helpers/app.ts`

- [ ] **Step 1: Write the failing tests**

`server/tests/helpers/app.ts` (first version; Task 10 adds `makeApp`):

```ts
import type { Config } from "../../src/config";
import { MIGRATIONS_DIR, TEST_DATABASE_URL } from "./db";

export const testConfig: Config = {
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: "test-secret-that-is-at-least-32-characters",
  PORT: 0,
  MIGRATIONS_DIR,
};
```

`server/tests/auth.test.ts`:

```ts
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { authenticate, requireRole, type AppEnv } from "../src/auth/middleware";
import { issueToken, revokeToken, verifyToken } from "../src/auth/tokens";
import { loadConfig } from "../src/config";
import { testConfig } from "./helpers/app";
import { getTestDb, resetDb } from "./helpers/db";

const db = getTestDb();
beforeEach(() => resetDb(db));

function app() {
  const a = new Hono<AppEnv>();
  a.use("*", authenticate({ db, config: testConfig }));
  a.get("/who", (c) => c.json({ principal: c.get("principal") }));
  a.get("/editor", requireRole("editor"), (c) => c.text("ok"));
  a.get("/submit", requireRole("submitter"), (c) => c.text("ok"));
  return a;
}
const get = (path: string, token?: string) =>
  app().request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

describe("tokens", () => {
  it("issues, verifies and revokes", async () => {
    const { token, jti } = await issueToken(db, testConfig.JWT_SECRET, "grok", "submitter");
    expect(await verifyToken(db, testConfig.JWT_SECRET, token)).toEqual({ sub: "grok", role: "submitter", jti });
    expect(await revokeToken(db, jti)).toBe(true);
    expect(await verifyToken(db, testConfig.JWT_SECRET, token)).toBeNull();
  });

  it("rejects tokens signed with another secret or not in the table", async () => {
    const { token, jti } = await issueToken(db, testConfig.JWT_SECRET, "drew", "editor");
    expect(await verifyToken(db, "another-secret-another-secret-another", token)).toBeNull();
    await db.deleteFrom("tokens").where("jti", "=", jti).execute();
    expect(await verifyToken(db, testConfig.JWT_SECRET, token)).toBeNull();
  });

  it("never stores the token itself", async () => {
    const { token } = await issueToken(db, testConfig.JWT_SECRET, "grok", "submitter");
    const row = await db.selectFrom("tokens").selectAll().executeTakeFirstOrThrow();
    expect(JSON.stringify(row)).not.toContain(token);
  });
});

describe("middleware", () => {
  it("treats a missing header as anonymous", async () => {
    expect(await (await get("/who")).json()).toEqual({ principal: null });
  });

  it("401s an invalid token even on public routes", async () => {
    expect((await get("/who", "garbage")).status).toBe(401);
  });

  it("enforces roles: anonymous 401, submitter 403 on editor routes, editor allowed everywhere", async () => {
    const grok = (await issueToken(db, testConfig.JWT_SECRET, "grok", "submitter")).token;
    const drew = (await issueToken(db, testConfig.JWT_SECRET, "drew", "editor")).token;
    expect((await get("/editor")).status).toBe(401);
    expect((await get("/editor", grok)).status).toBe(403);
    expect((await get("/editor", drew)).status).toBe(200);
    expect((await get("/submit", grok)).status).toBe(200);
    expect((await get("/submit", drew)).status).toBe(200);
  });
});

describe("config", () => {
  it("requires a long JWT secret", () => {
    expect(() => loadConfig({ DATABASE_URL: "postgres://x@y/z", JWT_SECRET: "short" })).toThrow(/JWT_SECRET/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter server test tests/auth.test.ts`
Expected: FAIL — cannot resolve `../src/auth/middleware`.

- [ ] **Step 3: Implement config, errors, tokens, middleware**

`server/src/config.ts`:

```ts
import { z } from "zod";

const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  PORT: z.coerce.number().int().default(8787),
  MIGRATIONS_DIR: z.string().default("migrations"),
  SITE_BUILD_HOOK_URL: z.url().optional(),
  SITE_BUILD_HOOK_TOKEN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  ALERT_FROM: z.string().optional(),
  ALERT_TO: z.string().optional(),
});
export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Empty values in .env mean "not set".
  const parsed = ConfigSchema.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== "")));
  if (!parsed.success) {
    throw new Error(`invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}
```

`server/src/errors.ts`:

```ts
export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}
```

`server/src/auth/tokens.ts`:

```ts
import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import type { Db } from "../db/client";

export type Role = "submitter" | "editor";
export interface Principal { sub: string; role: Role; jti: string }

const ALG = "HS256";
const key = (secret: string) => new TextEncoder().encode(secret);

export async function issueToken(db: Db, secret: string, sub: string, role: Role): Promise<{ token: string; jti: string }> {
  const jti = randomUUID();
  await db.insertInto("tokens").values({ jti, sub, role }).execute();
  const token = await new SignJWT({ role }).setProtectedHeader({ alg: ALG }).setSubject(sub).setJti(jti).setIssuedAt().sign(key(secret));
  return { token, jti };
}

export async function revokeToken(db: Db, jti: string): Promise<boolean> {
  const r = await db.updateTable("tokens").set({ revoked_at: new Date() }).where("jti", "=", jti).where("revoked_at", "is", null).executeTakeFirst();
  return Number(r.numUpdatedRows) === 1;
}

export async function verifyToken(db: Db, secret: string, token: string): Promise<Principal | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: [ALG] });
    if (!payload.jti || !payload.sub) return null;
    const row = await db.selectFrom("tokens").selectAll().where("jti", "=", payload.jti).executeTakeFirst();
    if (!row || row.revoked_at || row.sub !== payload.sub || row.role !== payload.role) return null;
    await db.updateTable("tokens").set({ last_used_at: new Date() }).where("jti", "=", row.jti).execute();
    return { sub: row.sub, role: row.role as Role, jti: row.jti };
  } catch {
    return null;
  }
}
```

`server/src/auth/middleware.ts`:

```ts
import type { MiddlewareHandler } from "hono";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { verifyToken, type Principal, type Role } from "./tokens";

export type AppEnv = { Variables: { principal: Principal | null } };

export function authenticate(deps: { db: Db; config: Config }): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header("Authorization");
    if (!header) {
      c.set("principal", null);
      return next();
    }
    const m = header.match(/^Bearer\s+(\S+)$/i);
    const principal = m ? await verifyToken(deps.db, deps.config.JWT_SECRET, m[1]!) : null;
    if (!principal) return c.json({ error: "invalid or revoked token" }, 401);
    c.set("principal", principal);
    return next();
  };
}

/** submitter routes accept submitter and editor tokens; editor routes accept editor tokens only. */
export function requireRole(role: Role): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const p = c.get("principal");
    if (!p) return c.json({ error: "authentication required" }, 401);
    if (role === "editor" && p.role !== "editor") return c.json({ error: "this token is not allowed to do that" }, 403);
    return next();
  };
}
```

- [ ] **Step 4: Token CLI**

`server/src/cli/token.ts`:

```ts
// Usage: token issue <sub> --role submitter|editor   |   token revoke <jti>   |   token list
import { issueToken, revokeToken, type Role } from "../auth/tokens";
import { loadConfig } from "../config";
import { createDb } from "../db/client";

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const [cmd, arg, flag, roleArg] = process.argv.slice(2);

try {
  if (cmd === "issue" && arg && flag === "--role" && (roleArg === "submitter" || roleArg === "editor")) {
    const { token, jti } = await issueToken(db, config.JWT_SECRET, arg, roleArg as Role);
    console.error(`issued ${roleArg} token for ${arg} (jti ${jti}) — shown once, store it now:`);
    console.log(token);
  } else if (cmd === "revoke" && arg) {
    console.log((await revokeToken(db, arg)) ? `revoked ${arg}` : `no active token ${arg}`);
  } else if (cmd === "list") {
    const rows = await db.selectFrom("tokens").select(["jti", "sub", "role", "created_at", "revoked_at", "last_used_at"]).orderBy("created_at").execute();
    console.table(rows);
  } else {
    console.error("usage: token issue <sub> --role submitter|editor | token revoke <jti> | token list");
    process.exitCode = 2;
  }
} finally {
  await db.destroy();
}
```

- [ ] **Step 5: Run the tests and try the CLI**

Run: `pnpm --filter server test tests/auth.test.ts`
Expected: PASS (7 tests).

Run: `cd server && DATABASE_URL=postgres://pipeline:pipeline@localhost:5433/pipeline JWT_SECRET=local-dev-secret-local-dev-secret-0000 pnpm migrate && DATABASE_URL=postgres://pipeline:pipeline@localhost:5433/pipeline JWT_SECRET=local-dev-secret-local-dev-secret-0000 pnpm token issue drew-local --role editor`
Expected: `applied: 001_extensions_reference.sql, 002_core.sql`, then a JWT on stdout.

Create `server/.env.local` (git-ignored) for local dev:

```
DATABASE_URL=postgres://pipeline:pipeline@localhost:5433/pipeline
JWT_SECRET=local-dev-secret-local-dev-secret-0000
```

- [ ] **Step 6: Commit**

```bash
git add server/src server/tests
git commit -m "feat(server): config, JWT tokens with revocation, role middleware, token CLI

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Filing store — shared values, write and load

**Files:**
- Create: `server/src/store/shared-values.ts`, `server/src/store/filings.ts`, `server/tests/store.test.ts`

**Interfaces:**
- Consumes: `Db`, `geogPoint`, `withActor` (Task 6); `NormalizedRecord`, `contentHash`, `CanonicalAddress` (Task 5).
- Produces:
  - `findAddress(q: Db, a: CanonicalAddress): Promise<{ id: number; merged_into_id: number | null } | undefined>`
  - `upsertAddress(q, a, point?: { lat: number; lon: number } | null): Promise<number>` (follows merges; zip and point: first value wins)
  - `upsertIdentifier(q, type: string, value: string): Promise<number>`
  - `upsertOrganization(q, nameKey: string, displayName: string): Promise<number>` (follows merges)
  - `resolveAliases(q, record: NormalizedRecord): Promise<NormalizedRecord>` (no writes)
  - `rowToAddress(row): CanonicalAddress`
  - `writeFiling(q, record: NormalizedRecord, opts: { sourceHash: string | null }): Promise<number>`
  - `loadFilingRecord(q, filingId: number): Promise<NormalizedRecord>`
  - `refreshFilingHash(q, filingId: number): Promise<void>`
  - `filingRole(kind: Kind, attributes: Record<string, unknown>): "zoning" | "hearing" | "permit" | "early_signal"`

- [ ] **Step 1: Write the failing tests**

`server/tests/store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { diffRecords } from "../../shared/records/diff";
import { contentHash } from "../../shared/records/hash";
import { normalizeRecord } from "../../shared/records/normalize-record";
import { ALL_FIXTURES, permitRecord, zbaRecord, zoningRecord } from "../../shared/tests/fixtures";
import { withActor } from "../src/db/actor";
import { loadFilingRecord, writeFiling } from "../src/store/filings";
import { resolveAliases, upsertOrganization } from "../src/store/shared-values";
import { getTestDb, resetDb } from "./helpers/db";

const db = getTestDb();
beforeEach(() => resetDb(db));
const write = (rec: ReturnType<typeof permitRecord>) =>
  withActor(db, "test", "test", (q) => writeFiling(q, normalizeRecord(rec).record, { sourceHash: "h" }));

describe("writeFiling / loadFilingRecord", () => {
  it.each(ALL_FIXTURES.map((f) => [f().kind, f]))("%s round-trips with the same hash and no diff", async (_k, f) => {
    const record = normalizeRecord(f()).record;
    const id = await withActor(db, "test", "test", (q) => writeFiling(q, record, { sourceHash: "h" }));
    const loaded = await loadFilingRecord(db, id);
    expect(contentHash(loaded)).toBe(contentHash(record));
    expect(diffRecords(record, loaded)).toEqual({});
    const row = await db.selectFrom("filings").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
    expect(row.content_hash).toBe(contentHash(record));
    expect(row.last_source_hash).toBe("h");
  });

  it("same address in two spellings is one row", async () => {
    await write(permitRecord({ address: "111 W. Monroe Street" }));
    await write(zbaRecord({ address: "111 WEST MONROE ST", zip: "60603" }));
    const rows = await db.selectFrom("addresses").selectAll().where("street_name", "=", "MONROE").execute();
    expect(rows).toHaveLength(1);
  });

  it("keeps the first ZIP and point for an address", async () => {
    await write(permitRecord({ zip: "60603", lat: 41.8806, lon: -87.6311 }));
    await write(permitRecord({ permit_number: "100999999", zip: "60602", lat: 41.9, lon: -87.7 }));
    const row = await db.selectFrom("addresses").select(["zip"]).executeTakeFirstOrThrow();
    expect(row.zip).toBe("60603");
    const loaded = await loadFilingRecord(db, 2);
    expect(loaded.point).toEqual({ lat: 41.8806, lon: -87.6311 });
  });

  it("keeps an old record number as a non-current identifier after renumbering", async () => {
    const id = await write(zoningRecord({ record_number: "SO2026-0023894" }));
    await write(zoningRecord({ record_number: "O2026-0023894" }));
    const loaded = await loadFilingRecord(db, id);
    expect(loaded.identifiers.filter((i) => i.type === "record_number").map((i) => i.value)).toEqual(["O2026-0023894"]);
    const all = await db.selectFrom("filing_identifiers").innerJoin("identifiers", "identifiers.id", "filing_identifiers.identifier_id")
      .select(["identifiers.value", "filing_identifiers.current"]).where("identifiers.type", "=", "record_number").orderBy("identifiers.value").execute();
    expect(all).toEqual([{ value: "O2026-0023894", current: true }, { value: "SO2026-0023894", current: false }]);
  });

  it("restores a soft-deleted filing when it is written again", async () => {
    const id = await write(permitRecord());
    await withActor(db, "test", "test", (q) => q.updateTable("filings").set({ deleted_at: new Date() }).where("id", "=", id).execute());
    await write(permitRecord());
    const row = await db.selectFrom("filings").select("deleted_at").where("id", "=", id).executeTakeFirstOrThrow();
    expect(row.deleted_at).toBeNull();
  });

  it("writes history for the filing and its join rows", async () => {
    await write(permitRecord());
    const tables = await db.selectFrom("revisions").select("table_name").distinct().execute();
    expect(tables.map((t) => t.table_name).sort()).toEqual(expect.arrayContaining(["filing_addresses", "filing_identifiers", "filings", "parcels"]));
  });
});

describe("resolveAliases", () => {
  it("replaces a merged organization spelling with the survivor", async () => {
    await withActor(db, "test", "test", async (q) => {
      const keep = await upsertOrganization(q, "4645 NORTH CLARK LLC", "4645 North Clark, LLC");
      const typo = await upsertOrganization(q, "4645 N0RTH CLARK LLC", "4645 N0RTH CLARK LLC");
      await q.updateTable("organizations").set({ merged_into_id: keep, deleted_at: new Date() }).where("id", "=", typo).execute();
    });
    const record = normalizeRecord(zbaRecord({ applicant: "4645 N0RTH CLARK LLC" })).record;
    const resolved = await resolveAliases(db, record);
    expect(resolved.organizations.find((o) => o.role === "applicant")?.name_key).toBe("4645 NORTH CLARK LLC");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter server test tests/store.test.ts`
Expected: FAIL — cannot resolve `../src/store/filings`.

- [ ] **Step 3: Shared values**

`server/src/store/shared-values.ts`:

```ts
import { sql } from "kysely";
import type { CanonicalAddress } from "../../../shared/normalize/address";
import type { NormalizedRecord, RecordOrganization } from "../../../shared/records/types";
import { geogPoint, type Db } from "../db/client";

const notDistinct = (col: string, v: unknown) => sql<boolean>`${sql.ref(col)} is not distinct from ${v}`;

export function rowToAddress(row: { number_from: number; number_to: number; predir: string | null; street_name: string; suffix: string | null; zip: string | null }): CanonicalAddress {
  return {
    number_from: row.number_from, number_to: row.number_to, predir: row.predir as CanonicalAddress["predir"],
    street_name: row.street_name, suffix: row.suffix, zip: row.zip,
  };
}

async function followMerged(q: Db, table: "addresses" | "organizations", id: number): Promise<number> {
  let current = id;
  for (let i = 0; i < 20; i++) {
    const row = await q.selectFrom(table).select(["id", "merged_into_id"]).where("id", "=", current).executeTakeFirstOrThrow();
    if (!row.merged_into_id) return row.id;
    current = row.merged_into_id;
  }
  throw new Error(`${table} ${id}: merge chain is too long`);
}

export function findAddress(q: Db, a: CanonicalAddress) {
  return q.selectFrom("addresses").select(["id", "merged_into_id"])
    .where("number_from", "=", a.number_from).where("number_to", "=", a.number_to)
    .where(notDistinct("predir", a.predir)).where("street_name", "=", a.street_name).where(notDistinct("suffix", a.suffix))
    .executeTakeFirst();
}

export async function upsertAddress(q: Db, a: CanonicalAddress, point?: { lat: number; lon: number } | null): Promise<number> {
  const found = await findAddress(q, a);
  if (!found) {
    const row = await q.insertInto("addresses").values({
      number_from: a.number_from, number_to: a.number_to, predir: a.predir, street_name: a.street_name,
      suffix: a.suffix, zip: a.zip, point: point ? geogPoint(point.lat, point.lon) : null,
    }).returning("id").executeTakeFirstOrThrow();
    return row.id;
  }
  const id = await followMerged(q, "addresses", found.id);
  if (a.zip) await q.updateTable("addresses").set({ zip: a.zip }).where("id", "=", id).where("zip", "is", null).execute();
  if (point) await q.updateTable("addresses").set({ point: geogPoint(point.lat, point.lon) }).where("id", "=", id).where("point", "is", null).execute();
  return id;
}

export async function upsertParcel(q: Db, pin: string): Promise<void> {
  await q.insertInto("parcels").values({ pin }).onConflict((oc) => oc.column("pin").doNothing()).execute();
}

export async function upsertIdentifier(q: Db, type: string, value: string): Promise<number> {
  const inserted = await q.insertInto("identifiers").values({ type, value })
    .onConflict((oc) => oc.columns(["type", "value"]).doNothing()).returning("id").executeTakeFirst();
  if (inserted) return inserted.id;
  return (await q.selectFrom("identifiers").select("id").where("type", "=", type).where("value", "=", value).executeTakeFirstOrThrow()).id;
}

export async function upsertOrganization(q: Db, nameKey: string, displayName: string): Promise<number> {
  const found = await q.selectFrom("organizations").select("id").where("name_key", "=", nameKey).executeTakeFirst();
  if (found) return followMerged(q, "organizations", found.id);
  return (await q.insertInto("organizations").values({ name_key: nameKey, display_name: displayName }).returning("id").executeTakeFirstOrThrow()).id;
}

/** Rewrites addresses and organizations that were merged into others to the surviving canonical values. Read-only. */
export async function resolveAliases(q: Db, record: NormalizedRecord): Promise<NormalizedRecord> {
  const addresses: CanonicalAddress[] = [];
  for (const a of record.addresses) {
    const found = await findAddress(q, a);
    if (found?.merged_into_id) {
      const target = await q.selectFrom("addresses").selectAll().where("id", "=", await followMerged(q, "addresses", found.id)).executeTakeFirstOrThrow();
      addresses.push({ ...rowToAddress(target), zip: target.zip ?? a.zip });
    } else addresses.push(a);
  }
  const orgs = new Map<string, RecordOrganization>();
  for (const o of record.organizations) {
    const found = await q.selectFrom("organizations").select(["id", "merged_into_id"]).where("name_key", "=", o.name_key).executeTakeFirst();
    let resolved = o;
    if (found?.merged_into_id) {
      const target = await q.selectFrom("organizations").select(["name_key", "display_name"]).where("id", "=", await followMerged(q, "organizations", found.id)).executeTakeFirstOrThrow();
      resolved = { role: o.role, name_key: target.name_key, display_name: target.display_name };
    }
    orgs.set(`${resolved.role}|${resolved.name_key}`, resolved);
  }
  const organizations = [...orgs.values()].sort((x, y) => `${x.role}|${x.name_key}`.localeCompare(`${y.role}|${y.name_key}`));
  return { ...record, addresses, organizations };
}
```

- [ ] **Step 4: Filings**

`server/src/store/filings.ts`:

```ts
import { sql } from "kysely";
import { contentHash } from "../../../shared/records/hash";
import type { IdentifierType, Kind, NormalizedRecord, OrgRole, RecordIdentifier } from "../../../shared/records/types";
import type { Db } from "../db/client";
import { rowToAddress, upsertAddress, upsertIdentifier, upsertOrganization, upsertParcel } from "./shared-values";

/** Identifier types kept (not current) when a filing stops carrying them, so renumbered matters still match. */
const KEEP_HISTORY = new Set(["record_number", "matter_key"]);

export function filingRole(kind: Kind, attributes: Record<string, unknown>): "zoning" | "hearing" | "permit" | "early_signal" {
  if (kind === "permit") return attributes.classification === "early_signal" ? "early_signal" : "permit";
  return kind === "zoning_matter" ? "zoning" : "hearing";
}

export async function writeFiling(q: Db, record: NormalizedRecord, opts: { sourceHash: string | null }): Promise<number> {
  const addressIds: number[] = [];
  for (const [i, a] of record.addresses.entries()) {
    const id = await upsertAddress(q, a, i === 0 ? record.point : null);
    if (!addressIds.includes(id)) addressIds.push(id);
  }
  const values = {
    kind: record.kind, source_key: record.source_key, primary_address_id: addressIds[0] ?? null,
    community_area: record.community_area, ward: record.ward, units: record.units, status: record.status,
    event_date: record.event_date, in_target: record.in_target, flag: record.flag, notes: record.notes,
    source_url: record.source_url, attributes: JSON.stringify(record.attributes),
    field_sources: JSON.stringify(record.field_sources), content_hash: contentHash(record), deleted_at: null,
  };
  const existing = await q.selectFrom("filings").select(["id", "last_source_hash"])
    .where("kind", "=", record.kind).where("source_key", "=", record.source_key).executeTakeFirst();
  let filingId: number;
  if (existing) {
    filingId = existing.id;
    await q.updateTable("filings").set({ ...values, last_source_hash: opts.sourceHash ?? existing.last_source_hash }).where("id", "=", filingId).execute();
  } else {
    filingId = (await q.insertInto("filings").values({ ...values, last_source_hash: opts.sourceHash }).returning("id").executeTakeFirstOrThrow()).id;
  }

  // addresses (position 0 = primary)
  await q.deleteFrom("filing_addresses").where("filing_id", "=", filingId)
    .where("address_id", "not in", addressIds.length ? addressIds : [-1]).execute();
  for (const [position, addressId] of addressIds.entries()) {
    await q.insertInto("filing_addresses").values({ filing_id: filingId, address_id: addressId, position })
      .onConflict((oc) => oc.columns(["filing_id", "address_id"]).doUpdateSet({ position })).execute();
  }

  // parcels
  for (const pin of record.parcels) await upsertParcel(q, pin);
  await q.deleteFrom("filing_parcels").where("filing_id", "=", filingId)
    .where("pin", "not in", record.parcels.length ? record.parcels : ["-"]).execute();
  for (const pin of record.parcels) {
    await q.insertInto("filing_parcels").values({ filing_id: filingId, pin }).onConflict((oc) => oc.columns(["filing_id", "pin"]).doNothing()).execute();
  }

  // identifiers
  const wanted: { id: number; relation: string }[] = [];
  for (const i of record.identifiers) wanted.push({ id: await upsertIdentifier(q, i.type, i.value), relation: i.relation });
  const current = await q.selectFrom("filing_identifiers").innerJoin("identifiers", "identifiers.id", "filing_identifiers.identifier_id")
    .select(["filing_identifiers.identifier_id", "filing_identifiers.relation", "identifiers.type"])
    .where("filing_identifiers.filing_id", "=", filingId).execute();
  for (const row of current) {
    if (wanted.some((w) => w.id === row.identifier_id && w.relation === row.relation)) continue;
    const match = q.updateTable("filing_identifiers").where("filing_id", "=", filingId).where("identifier_id", "=", row.identifier_id).where("relation", "=", row.relation);
    if (KEEP_HISTORY.has(row.type)) await match.set({ current: false }).execute();
    else await q.deleteFrom("filing_identifiers").where("filing_id", "=", filingId).where("identifier_id", "=", row.identifier_id).where("relation", "=", row.relation).execute();
  }
  for (const w of wanted) {
    await q.insertInto("filing_identifiers").values({ filing_id: filingId, identifier_id: w.id, relation: w.relation, current: true })
      .onConflict((oc) => oc.columns(["filing_id", "identifier_id", "relation"]).doUpdateSet({ current: true })).execute();
  }

  // organizations
  const orgRows: { id: number; role: string }[] = [];
  for (const o of record.organizations) orgRows.push({ id: await upsertOrganization(q, o.name_key, o.display_name), role: o.role });
  const existingOrgs = await q.selectFrom("filing_organizations").selectAll().where("filing_id", "=", filingId).execute();
  for (const row of existingOrgs) {
    if (!orgRows.some((o) => o.id === row.organization_id && o.role === row.role)) {
      await q.deleteFrom("filing_organizations").where("filing_id", "=", filingId).where("organization_id", "=", row.organization_id).where("role", "=", row.role).execute();
    }
  }
  for (const o of orgRows) {
    await q.insertInto("filing_organizations").values({ filing_id: filingId, organization_id: o.id, role: o.role })
      .onConflict((oc) => oc.columns(["filing_id", "organization_id", "role"]).doNothing()).execute();
  }

  await refreshFilingHash(q, filingId);
  return filingId;
}

export async function loadFilingRecord(q: Db, filingId: number): Promise<NormalizedRecord> {
  const f = await q.selectFrom("filings").selectAll().where("id", "=", filingId).executeTakeFirstOrThrow();
  const addressRows = await q.selectFrom("filing_addresses").innerJoin("addresses", "addresses.id", "filing_addresses.address_id")
    .select(["addresses.id", "number_from", "number_to", "predir", "street_name", "suffix", "zip",
      sql<number | null>`ST_Y(addresses.point::geometry)`.as("lat"), sql<number | null>`ST_X(addresses.point::geometry)`.as("lon")])
    .where("filing_addresses.filing_id", "=", filingId).orderBy("filing_addresses.position").execute();
  const parcels = (await q.selectFrom("filing_parcels").select("pin").where("filing_id", "=", filingId).execute()).map((r) => r.pin).sort();
  const identifiers: RecordIdentifier[] = (await q.selectFrom("filing_identifiers").innerJoin("identifiers", "identifiers.id", "filing_identifiers.identifier_id")
    .select(["identifiers.type", "identifiers.value", "filing_identifiers.relation"])
    .where("filing_identifiers.filing_id", "=", filingId).where("filing_identifiers.current", "=", true).execute())
    .map((r) => ({ type: r.type as IdentifierType, value: r.value, relation: r.relation as "self" | "cited" }))
    .sort((a, b) => `${a.type}|${a.value}|${a.relation}`.localeCompare(`${b.type}|${b.value}|${b.relation}`));
  const organizations = (await q.selectFrom("filing_organizations").innerJoin("organizations", "organizations.id", "filing_organizations.organization_id")
    .select(["filing_organizations.role", "organizations.name_key", "organizations.display_name"])
    .where("filing_organizations.filing_id", "=", filingId).execute())
    .map((r) => ({ role: r.role as OrgRole, name_key: r.name_key, display_name: r.display_name }))
    .sort((a, b) => `${a.role}|${a.name_key}`.localeCompare(`${b.role}|${b.name_key}`));
  const primary = addressRows[0];
  return {
    kind: f.kind as Kind,
    source_key: f.source_key,
    addresses: addressRows.map(rowToAddress),
    point: primary && primary.lat !== null && primary.lon !== null ? { lat: primary.lat, lon: primary.lon } : null,
    community_area: f.community_area, ward: f.ward, units: f.units, status: f.status, event_date: f.event_date,
    in_target: f.in_target, flag: f.flag, notes: f.notes, source_url: f.source_url,
    parcels, identifiers, organizations,
    attributes: f.attributes as Record<string, unknown>,
    field_sources: f.field_sources as Record<string, string>,
  };
}

export async function refreshFilingHash(q: Db, filingId: number): Promise<void> {
  const hash = contentHash(await loadFilingRecord(q, filingId));
  await q.updateTable("filings").set({ content_hash: hash }).where("id", "=", filingId).where("content_hash", "<>", hash).execute();
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter server test tests/store.test.ts`
Expected: PASS (all round-trips, single address row, first ZIP/point, renumber history, restore, history, alias resolution).

- [ ] **Step 6: Commit**

```bash
git add server/src/store server/tests/store.test.ts
git commit -m "feat(server): filing store with canonical shared values and alias resolution

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Matcher — project suggestions, status changes, possible duplicates

**Files:**
- Create: `server/src/match/suggest.ts`, `server/src/match/status.ts`, `server/src/match/duplicates.ts`, `server/tests/helpers/fixtures.ts`, `server/tests/match.test.ts`

**Interfaces:**
- Consumes: `Db`, `geogPoint`, `withActor` (Task 6); `writeFiling`, `findAddress`, `upsertAddress` (Task 8); `formatPin`, `looseOrgKey`, `formatAddressDisplay`, `addressKey` (Tasks 3–4); `STATUSES`, `Status` (shared/constants).
- Produces:
  - `type Strength = "strong" | "likely" | "possible"`
  - `interface StatusChange { from: Status; to: Status; reason: string }`
  - `interface ProjectSuggestion { project_id: string; project_name: string | null; strength: Strength; reasons: string[]; status_change: StatusChange | null }`
  - `suggestProjects(q: Db, record: NormalizedRecord): Promise<ProjectSuggestion[]>` (strongest first)
  - `suggestStatusChange(current: Status, record: NormalizedRecord): StatusChange | null`
  - `interface DuplicateSuggestion { type: "organization" | "address"; value: string; candidates: { id: number; display: string }[] }`
  - `suggestDuplicates(q: Db, record: NormalizedRecord): Promise<DuplicateSuggestion[]>`
  - test helper `insertProject(q: Db, p: { id: string; lat: number; lng: number; status?: Status; name?: string; address?: string; visibility?: "draft" | "published" }): Promise<void>` and `linkForTest(q, projectId, filingId)`

- [ ] **Step 1: Test helpers and failing tests**

`server/tests/helpers/fixtures.ts`:

```ts
import { normalizeAddress } from "../../../shared/normalize/address";
import type { Status } from "../../../shared/constants";
import { geogPoint, type Db } from "../../src/db/client";
import { upsertAddress } from "../../src/store/shared-values";

export async function insertProject(
  q: Db,
  p: { id: string; lat: number; lng: number; status?: Status; name?: string; address?: string; visibility?: "draft" | "published" },
): Promise<void> {
  await q.insertInto("projects").values({
    id: p.id, name: p.name ?? p.id, program: "private", status: p.status ?? "planning", status_note: "test",
    confidence: "reported", point: geogPoint(p.lat, p.lng), sources: ["https://example.com/source"],
    visibility: p.visibility ?? "published",
  }).execute();
  if (p.address) {
    const a = normalizeAddress(p.address);
    if (!a.ok) throw new Error(a.message);
    const addressId = await upsertAddress(q, a.value);
    await q.insertInto("project_addresses").values({ project_id: p.id, address_id: addressId }).execute();
  }
}

export async function linkForTest(q: Db, projectId: string, filingId: number): Promise<void> {
  await q.insertInto("project_filings").values({ project_id: projectId, filing_id: filingId, role: "zoning", linked_by: "test", reason: "test" }).execute();
}
```

`server/tests/match.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { normalizeRecord } from "../../shared/records/normalize-record";
import { permitRecord, zbaRecord, zoningRecord } from "../../shared/tests/fixtures";
import { withActor } from "../src/db/actor";
import { suggestDuplicates } from "../src/match/duplicates";
import { suggestStatusChange } from "../src/match/status";
import { suggestProjects } from "../src/match/suggest";
import { writeFiling } from "../src/store/filings";
import { getTestDb, resetDb } from "./helpers/db";
import { insertProject, linkForTest } from "./helpers/fixtures";

const db = getTestDb();
beforeEach(() => resetDb(db));
const tx = <T>(fn: (q: typeof db) => Promise<T>) => withActor(db, "test", "test", fn);
const norm = (r: ReturnType<typeof permitRecord>) => normalizeRecord(r).record;

// 111 W Monroe is at 41.880635, -87.631098; 0.0003° of latitude ≈ 33 m.
describe("suggestProjects", () => {
  it("strong: a permit citing the ordinance of a linked zoning matter", async () => {
    await tx(async (q) => {
      await insertProject(q, { id: "111-w-monroe", lat: 41.880635, lng: -87.631098 });
      const z = await writeFiling(q, norm(zoningRecord({ address: "200 W Adams St" })), { sourceHash: null });
      await linkForTest(q, "111-w-monroe", z);
    });
    const s = await suggestProjects(db, norm(permitRecord({ address: "300 W Adams St", lat: null, lon: null, pin_list: [] })));
    expect(s).toEqual([expect.objectContaining({ project_id: "111-w-monroe", strength: "strong" })]);
    expect(s[0]!.reasons.join(" ")).toMatch(/O2026-0023894|23020/);
  });

  it("strong: a shared PIN", async () => {
    await tx(async (q) => {
      await insertProject(q, { id: "p", lat: 41.95, lng: -87.7 });
      const f = await writeFiling(q, norm(permitRecord({ address: "200 W Adams St", permit_condition: null })), { sourceHash: null });
      await linkForTest(q, "p", f);
    });
    const s = await suggestProjects(db, norm(permitRecord({ permit_number: "100999999", address: "300 W Adams St", permit_condition: null, lat: null, lon: null })));
    expect(s[0]).toMatchObject({ project_id: "p", strength: "strong" });
    expect(s[0]!.reasons.join(" ")).toContain("17-16-123-004-0000");
  });

  it("likely: an address inside the project's range", async () => {
    await tx((q) => insertProject(q, { id: "111-w-monroe", lat: 41.95, lng: -87.7, address: "111-123 W. Monroe St" }));
    const s = await suggestProjects(db, norm(zbaRecord({ address: "115 W Monroe St", zip: null })));
    expect(s).toEqual([expect.objectContaining({ project_id: "111-w-monroe", strength: "likely" })]);
  });

  it("possible: within 40 m; nothing at 60 m", async () => {
    await tx((q) => insertProject(q, { id: "near", lat: 41.880635, lng: -87.631098 }));
    const at = (lat: number) => norm(permitRecord({ address: "1 N State St", lat, lon: -87.631098, permit_condition: null, pin_list: [] }));
    expect((await suggestProjects(db, at(41.880935)))[0]).toMatchObject({ project_id: "near", strength: "possible" });
    expect(await suggestProjects(db, at(41.881175))).toEqual([]);
  });

  it("an organization alone suggests nothing; with distance it is likely", async () => {
    await tx(async (q) => {
      await insertProject(q, { id: "org", lat: 41.880635, lng: -87.631098 });
      const f = await writeFiling(q, norm(zbaRecord({ address: "4000 W Irving Park Rd", applicant: "Shared Owner LLC" })), { sourceHash: null });
      await linkForTest(q, "org", f);
    });
    const far = norm(zbaRecord({ case_no: "1-26-Z", address: "3642 W Oakdale Ave", applicant: "Shared Owner LLC" }));
    expect(await suggestProjects(db, { ...far, source_key: "1-26-Z" })).toEqual([]);
    const near = { ...far, source_key: "1-26-Z", point: { lat: 41.880735, lon: -87.631098 } };
    expect((await suggestProjects(db, near))[0]).toMatchObject({ project_id: "org", strength: "likely" });
  });

  it("ignores deleted projects", async () => {
    await tx(async (q) => {
      await insertProject(q, { id: "gone", lat: 41.880635, lng: -87.631098 });
      await q.updateTable("projects").set({ deleted_at: new Date() }).execute();
    });
    expect(await suggestProjects(db, norm(permitRecord({ permit_condition: null, pin_list: [] })))).toEqual([]);
  });
});

describe("suggestStatusChange", () => {
  it("permit issued moves approved → permitted, never backwards", () => {
    const permit = norm(permitRecord());
    expect(suggestStatusChange("approved", permit)).toMatchObject({ from: "approved", to: "permitted" });
    expect(suggestStatusChange("under_construction", permit)).toBeNull();
  });
  it("passed rezoning moves planning → approved", () => {
    expect(suggestStatusChange("planning", norm(zoningRecord({ status: "Final - Passed (2026-06-17)" })))).toMatchObject({ to: "approved" });
    expect(suggestStatusChange("planning", norm(zoningRecord()))).toBeNull();
  });
  it("early-signal permits never change status", () => {
    expect(suggestStatusChange("planning", norm(permitRecord({ classification: "early_signal" })))).toBeNull();
  });
});

describe("suggestDuplicates", () => {
  it("flags a near-identical organization name and an overlapping address", async () => {
    await tx((q) => writeFiling(q, norm(zbaRecord({ applicant: "4645 North Clark, LLC", address: "3640-3650 W Oakdale Ave" })), { sourceHash: null }));
    const d = await suggestDuplicates(db, norm(zbaRecord({ case_no: "9-26-Z", applicant: "4645 N0RTH CLARK LLC", address: "3642 W Oakdale Ave" })));
    expect(d).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "organization", value: "4645 N0RTH CLARK LLC", candidates: [expect.objectContaining({ display: "4645 North Clark, LLC" })] }),
      expect.objectContaining({ type: "address", value: "3642 W OAKDALE AVE" }),
    ]));
  });

  it("does not flag exact matches", async () => {
    await tx((q) => writeFiling(q, norm(zbaRecord()), { sourceHash: null }));
    expect(await suggestDuplicates(db, norm(zbaRecord()))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter server test tests/match.test.ts`
Expected: FAIL — cannot resolve `../src/match/duplicates`.

- [ ] **Step 3: Status rules**

`server/src/match/status.ts`:

```ts
import { STATUSES, type Status } from "../../../shared/constants";
import type { NormalizedRecord } from "../../../shared/records/types";

export interface StatusChange { from: Status; to: Status; reason: string }

const ORDER = [...STATUSES].reverse(); // planning → approved → permitted → under_construction → completed

/** Forward-only stage move implied by a filing; null when the filing implies nothing new. */
export function suggestStatusChange(current: Status, record: NormalizedRecord): StatusChange | null {
  let to: Status | null = null;
  let reason = "";
  const status = record.status ?? "";
  if (record.kind === "zoning_matter" && /passed|approved|adopted/i.test(status)) {
    to = "approved"; reason = `zoning matter ${record.source_key}: ${status}`;
  } else if (record.kind === "zba_case" && /approved|granted/i.test(status)) {
    to = "approved"; reason = `ZBA case ${record.source_key}: ${status}`;
  } else if (record.kind === "permit" && record.attributes.classification === "qualifying_20plus") {
    to = "permitted"; reason = `building permit ${record.source_key} issued ${record.event_date ?? ""}`.trim();
  }
  if (!to || ORDER.indexOf(to) <= ORDER.indexOf(current)) return null;
  return { from: current, to, reason };
}
```

- [ ] **Step 4: Project suggestions**

`server/src/match/suggest.ts`:

```ts
import { sql } from "kysely";
import type { Status } from "../../../shared/constants";
import { formatAddressDisplay } from "../../../shared/normalize/address";
import { formatPin } from "../../../shared/normalize/primitives";
import type { NormalizedRecord } from "../../../shared/records/types";
import { geogPoint, type Db } from "../db/client";
import { findAddress } from "../store/shared-values";
import { suggestStatusChange, type StatusChange } from "./status";

export type Strength = "strong" | "likely" | "possible";
export interface ProjectSuggestion { project_id: string; project_name: string | null; strength: Strength; reasons: string[]; status_change: StatusChange | null }

export const MATCH_RADIUS_M = 40;
const RANK: Record<Strength, number> = { strong: 0, likely: 1, possible: 2 };
type Signal = "identifier" | "parcel" | "address" | "distance" | "organization";

const ID_LABEL: Record<string, string> = {
  dpd_app_no: "DPD app #", record_number: "record #", matter_key: "matter", elms_matter_id: "eLMS id",
  permit_number: "permit #", zba_case_no: "ZBA case",
};

export async function suggestProjects(q: Db, record: NormalizedRecord): Promise<ProjectSuggestion[]> {
  const evidence = new Map<string, { signals: Set<Signal>; reasons: string[] }>();
  const add = (projectId: string, signal: Signal, reason: string) => {
    const e = evidence.get(projectId) ?? { signals: new Set<Signal>(), reasons: [] };
    e.signals.add(signal);
    if (!e.reasons.includes(reason)) e.reasons.push(reason);
    evidence.set(projectId, e);
  };

  // 1. shared official identifiers with any filing already linked to a project
  if (record.identifiers.length) {
    const rows = await q.selectFrom("identifiers as i")
      .innerJoin("filing_identifiers as fi", "fi.identifier_id", "i.id")
      .innerJoin("filings as f", "f.id", "fi.filing_id")
      .innerJoin("project_filings as pf", "pf.filing_id", "f.id")
      .innerJoin("projects as p", "p.id", "pf.project_id")
      .select(["pf.project_id", "i.type", "i.value", "f.kind", "f.source_key"])
      .where("f.deleted_at", "is", null).where("p.deleted_at", "is", null)
      .where((eb) => eb.or(record.identifiers.map((x) => eb.and([eb("i.type", "=", x.type), eb("i.value", "=", x.value)]))))
      .execute();
    for (const r of rows) add(r.project_id, "identifier", `${ID_LABEL[r.type] ?? r.type} ${r.value} also on ${r.kind.replace("_", " ")} ${r.source_key}`);
  }

  // 2. shared parcels
  if (record.parcels.length) {
    const rows = await q.selectFrom("filing_parcels as fp")
      .innerJoin("filings as f", "f.id", "fp.filing_id")
      .innerJoin("project_filings as pf", "pf.filing_id", "f.id")
      .innerJoin("projects as p", "p.id", "pf.project_id")
      .select(["pf.project_id", "fp.pin"])
      .where("fp.pin", "in", record.parcels).where("f.deleted_at", "is", null).where("p.deleted_at", "is", null)
      .execute();
    for (const r of rows) add(r.project_id, "parcel", `PIN ${formatPin(r.pin)}`);
  }

  // 3. overlapping address ranges on the same street (project address or a linked filing's address)
  for (const a of record.addresses) {
    const overlapping = q.selectFrom("addresses as a").select(["a.id", "a.number_from", "a.number_to", "a.predir", "a.street_name", "a.suffix", "a.zip"])
      .where("a.street_name", "=", a.street_name)
      .where(sql<boolean>`a.predir is not distinct from ${a.predir}`)
      .where(sql<boolean>`(a.suffix is null or ${a.suffix}::text is null or a.suffix = ${a.suffix})`)
      .where("a.number_from", "<=", a.number_to).where("a.number_to", ">=", a.number_from)
      .where("a.deleted_at", "is", null);
    const viaProject = await q.selectFrom("project_addresses as pa").innerJoin("projects as p", "p.id", "pa.project_id")
      .innerJoin(overlapping.as("o"), "o.id", "pa.address_id")
      .select(["p.id as project_id", "o.number_from", "o.number_to", "o.predir", "o.street_name", "o.suffix", "o.zip"])
      .where("p.deleted_at", "is", null).execute();
    const viaFilings = await q.selectFrom("filing_addresses as fa").innerJoin("filings as f", "f.id", "fa.filing_id")
      .innerJoin("project_filings as pf", "pf.filing_id", "f.id").innerJoin("projects as p", "p.id", "pf.project_id")
      .innerJoin(overlapping.as("o"), "o.id", "fa.address_id")
      .select(["p.id as project_id", "o.number_from", "o.number_to", "o.predir", "o.street_name", "o.suffix", "o.zip"])
      .where("f.deleted_at", "is", null).where("p.deleted_at", "is", null).execute();
    for (const r of [...viaProject, ...viaFilings]) {
      add(r.project_id, "address", `address ${formatAddressDisplay(a)} overlaps ${formatAddressDisplay({ ...r, predir: r.predir as "N" | "S" | "E" | "W" | null })}`);
    }
  }

  // 4. distance from the project pin or from a linked filing's address
  let point = record.point;
  if (!point && record.addresses[0]) {
    const found = await findAddress(q, record.addresses[0]);
    if (found) {
      const row = await q.selectFrom("addresses").select([sql<number | null>`ST_Y(point::geometry)`.as("lat"), sql<number | null>`ST_X(point::geometry)`.as("lon")])
        .where("id", "=", found.merged_into_id ?? found.id).executeTakeFirst();
      if (row?.lat != null && row.lon != null) point = { lat: row.lat, lon: row.lon };
    }
  }
  if (point) {
    const pt = geogPoint(point.lat, point.lon);
    const rows = await sql<{ project_id: string; d: number }>`
      select p.id as project_id, ST_Distance(p.point, ${pt}) as d from projects p
       where p.deleted_at is null and ST_DWithin(p.point, ${pt}, ${MATCH_RADIUS_M})
      union all
      select pf.project_id, ST_Distance(a.point, ${pt}) from project_filings pf
        join filings f on f.id = pf.filing_id and f.deleted_at is null
        join projects p on p.id = pf.project_id and p.deleted_at is null
        join addresses a on a.id = f.primary_address_id
       where a.point is not null and ST_DWithin(a.point, ${pt}, ${MATCH_RADIUS_M})`.execute(q);
    const nearest = new Map<string, number>();
    for (const r of rows.rows) nearest.set(r.project_id, Math.min(nearest.get(r.project_id) ?? Infinity, Number(r.d)));
    for (const [projectId, d] of nearest) add(projectId, "distance", `${Math.round(d)} m away`);
  }

  // 5. shared organizations (tie-breaker only)
  if (record.organizations.length) {
    const rows = await q.selectFrom("organizations as o")
      .innerJoin("filing_organizations as fo", "fo.organization_id", "o.id")
      .innerJoin("filings as f", "f.id", "fo.filing_id")
      .innerJoin("project_filings as pf", "pf.filing_id", "f.id")
      .innerJoin("projects as p", "p.id", "pf.project_id")
      .select(["pf.project_id", "o.display_name", "fo.role"])
      .where("o.name_key", "in", record.organizations.map((o) => o.name_key))
      .where("f.deleted_at", "is", null).where("p.deleted_at", "is", null).execute();
    for (const r of rows) add(r.project_id, "organization", `same ${r.role} ${r.display_name}`);
  }

  const out: ProjectSuggestion[] = [];
  for (const [projectId, e] of evidence) {
    const s = e.signals;
    const strength: Strength | null =
      s.has("identifier") || s.has("parcel") ? "strong"
      : s.has("address") || (s.has("distance") && s.has("organization")) ? "likely"
      : s.has("distance") ? "possible" : null;
    if (!strength) continue;
    const p = await q.selectFrom("projects").select(["name", "status"]).where("id", "=", projectId).executeTakeFirstOrThrow();
    out.push({ project_id: projectId, project_name: p.name, strength, reasons: e.reasons, status_change: suggestStatusChange(p.status as Status, record) });
  }
  return out.sort((a, b) => RANK[a.strength] - RANK[b.strength] || a.project_id.localeCompare(b.project_id));
}
```

- [ ] **Step 5: Possible duplicates**

`server/src/match/duplicates.ts`:

```ts
import { sql } from "kysely";
import { addressKey, formatAddressDisplay } from "../../../shared/normalize/address";
import { looseOrgKey } from "../../../shared/normalize/primitives";
import type { NormalizedRecord } from "../../../shared/records/types";
import type { Db } from "../db/client";
import { findAddress } from "../store/shared-values";

export interface DuplicateSuggestion { type: "organization" | "address"; value: string; candidates: { id: number; display: string }[] }

/** Shared values in this record that look like an existing row spelled differently. Never merges anything. */
export async function suggestDuplicates(q: Db, record: NormalizedRecord): Promise<DuplicateSuggestion[]> {
  const out: DuplicateSuggestion[] = [];
  for (const key of new Set(record.organizations.map((o) => o.name_key))) {
    const exact = await q.selectFrom("organizations").select("id").where("name_key", "=", key).executeTakeFirst();
    if (exact) continue;
    const loose = looseOrgKey(key);
    const rows = await q.selectFrom("organizations").select(["id", "name_key", "display_name"])
      .where("deleted_at", "is", null)
      .where((eb) => eb.or([
        eb(sql<number>`levenshtein(left(name_key, 250), left(${key}, 250))`, "<=", 2),
        eb("name_key", "like", `${loose}%`),
      ]))
      .limit(5).execute();
    const candidates = rows.filter((r) => r.name_key !== key).map((r) => ({ id: r.id, display: r.display_name }));
    if (candidates.length) out.push({ type: "organization", value: key, candidates });
  }
  for (const a of record.addresses) {
    if (await findAddress(q, a)) continue;
    const rows = await q.selectFrom("addresses").select(["id", "number_from", "number_to", "predir", "street_name", "suffix", "zip"])
      .where("street_name", "=", a.street_name).where(sql<boolean>`predir is not distinct from ${a.predir}`)
      .where("number_from", "<=", a.number_to).where("number_to", ">=", a.number_from)
      .where("deleted_at", "is", null).limit(5).execute();
    const candidates = rows.map((r) => ({ id: r.id, display: formatAddressDisplay({ ...r, predir: r.predir as "N" | "S" | "E" | "W" | null }) }));
    if (candidates.length) out.push({ type: "address", value: addressKey(a), candidates });
  }
  return out;
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter server test tests/match.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/match server/tests/match.test.ts server/tests/helpers/fixtures.ts
git commit -m "feat(server): project match suggestions, status-change rules, duplicate hints

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Submission intake — `POST /v1/submissions`

**Files:**
- Create: `server/src/intake/submit.ts`, `server/src/http/app.ts`, `server/src/http/routes/submissions.ts`, `server/tests/submissions.test.ts`
- Modify: `server/tests/helpers/app.ts` (add `makeApp`, `postJson`)

**Interfaces:**
- Consumes: Tasks 5–9 (`SubmissionEnvelope`, `RecordEnvelope`, `DATA_SCHEMAS`, `MAX_RECORDS`, `normalizeRecord`, `contentHash`, `diffRecords`, `formatAddressDisplay`, `resolveAliases`, `loadFilingRecord`, `suggestProjects`, `suggestDuplicates`, `authenticate`, `requireRole`, `HttpError`).
- Produces:
  - `interface RecordResult { index: number; source_key: string | null; outcome: "queued_create" | "queued_update" | "no_change" | "invalid"; queue_item_id?: number; changed?: string[]; errors?: { path: string; message: string }[] }`
  - `interface SubmissionResponse { submission_id: number | null; dry_run?: true; results: RecordResult[] }`
  - `processSubmission(db: Db, principal: Principal, input: { body: unknown; rawBody: string; idempotencyKey: string | undefined; dryRun: boolean }): Promise<SubmissionResponse>`
  - `validateRecord(raw: unknown): { ok: true; record: WireRecord } | { ok: false; source_key: string | null; errors: { path: string; message: string }[] }`
  - `interface AppDeps { db: Db; config: Config }`, `createApp(deps: AppDeps): Hono<AppEnv>` (later tasks register more routes inside it)
  - test helpers `makeApp(): Promise<{ app; db; grok: string; drew: string }>`, `postJson(app, path, body, token?, headers?)`

- [ ] **Step 1: Test helpers and failing tests**

Add to `server/tests/helpers/app.ts`:

```ts
import { issueToken } from "../../src/auth/tokens";
import { createApp } from "../../src/http/app";
import { getTestDb, resetDb } from "./db";

export async function makeApp() {
  const db = getTestDb();
  await resetDb(db);
  const app = createApp({ db, config: testConfig });
  const grok = (await issueToken(db, testConfig.JWT_SECRET, "grok", "submitter")).token;
  const drew = (await issueToken(db, testConfig.JWT_SECRET, "drew", "editor")).token;
  return { app, db, grok, drew };
}

export function postJson(app: ReturnType<typeof createApp>, path: string, body: unknown, token?: string, headers: Record<string, string> = {}, method = "POST") {
  return app.request(path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
```

`server/tests/submissions.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { normalizeRecord } from "../../shared/records/normalize-record";
import { permitRecord, zbaRecord, zoningRecord } from "../../shared/tests/fixtures";
import type { WireRecord } from "../../shared/records/types";
import { withActor } from "../src/db/actor";
import { writeFiling } from "../src/store/filings";
import { makeApp, postJson } from "./helpers/app";

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => { ctx = await makeApp(); });

const envelope = (records: unknown[], runId = "zoning-2026-10-02") => ({
  run: { program: "zoning", run_id: runId, started_at: "2026-10-02T12:39:00Z", bot_version: "test" },
  records,
});
let keyN = 0;
const submit = (records: unknown[], opts: { token?: string; key?: string; query?: string } = {}) =>
  postJson(ctx.app, `/v1/submissions${opts.query ?? ""}`, envelope(records), opts.token ?? ctx.grok, { "Idempotency-Key": opts.key ?? `k-${++keyN}` });
const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as any });
const pending = () => ctx.db.selectFrom("queue_items").selectAll().where("state", "=", "pending").execute();

describe("POST /v1/submissions", () => {
  it("queues new records and reports per-record outcomes", async () => {
    const { status, body } = await json(await submit([permitRecord(), zbaRecord()]));
    expect(status).toBe(202);
    expect(body.results.map((r: any) => r.outcome)).toEqual(["queued_create", "queued_create"]);
    expect((await pending()).length).toBe(2);
  });

  it("returns no_change for an identical re-send under a new key", async () => {
    await submit([permitRecord()]);
    const { body } = await json(await submit([permitRecord({ address: "111 WEST MONROE ST" })]));
    expect(body.results[0].outcome).toBe("no_change");
    expect((await pending()).length).toBe(1);
  });

  it("supersedes the pending item when a changed version arrives", async () => {
    await submit([zoningRecord()]);
    const { body } = await json(await submit([zoningRecord({ status: "Final - Passed (2026-06-17)" })]));
    expect(body.results[0]).toMatchObject({ outcome: "queued_create" });
    const states = await ctx.db.selectFrom("queue_items").select("state").orderBy("id").execute();
    expect(states.map((s) => s.state)).toEqual(["superseded", "pending"]);
  });

  it("queues an update with the changed field names for an accepted filing", async () => {
    await withActor(ctx.db, "test", "test", (q) => writeFiling(q, normalizeRecord(zoningRecord()).record, { sourceHash: null }));
    const { body } = await json(await submit([zoningRecord({ status: "Final - Passed (2026-06-17)" })]));
    expect(body.results[0]).toMatchObject({ outcome: "queued_update", changed: ["status"] });
  });

  it("same key twice in one submission: only the last stays pending", async () => {
    const { body } = await json(await submit([zoningRecord(), zoningRecord({ units: 400 })]));
    expect(body.results.map((r: any) => r.outcome)).toEqual(["queued_create", "queued_create"]);
    const rows = await ctx.db.selectFrom("queue_items").select(["state", "record_index"]).orderBy("id").execute();
    expect(rows).toEqual([{ state: "superseded", record_index: 0 }, { state: "pending", record_index: 1 }]);
  });

  it("deleted filing resent unchanged is no_change", async () => {
    const rec = normalizeRecord(permitRecord()).record;
    await withActor(ctx.db, "test", "test", async (q) => {
      const id = await writeFiling(q, rec, { sourceHash: null });
      await q.updateTable("filings").set({ deleted_at: new Date() }).where("id", "=", id).execute();
    });
    expect((await json(await submit([permitRecord()]))).body.results[0].outcome).toBe("no_change");
  });

  it("deleted filing resent changed is queued_create", async () => {
    await withActor(ctx.db, "test", "test", async (q) => {
      const id = await writeFiling(q, normalizeRecord(permitRecord()).record, { sourceHash: null });
      await q.updateTable("filings").set({ deleted_at: new Date() }).where("id", "=", id).execute();
    });
    expect((await json(await submit([permitRecord({ permit_status: "COMPLETE" })]))).body.results[0].outcome).toBe("queued_create");
  });

  it("reports invalid records and still queues the valid ones", async () => {
    const bad = permitRecord({ issue_date: "10/01/2026", ward: "42" });
    const { status, body } = await json(await submit([bad, zbaRecord()]));
    expect(status).toBe(202);
    expect(body.results[0].outcome).toBe("invalid");
    expect([...new Set(body.results[0].errors.map((e: any) => e.path))].sort()).toEqual(["data.issue_date", "data.ward"]);
    expect(body.results[1].outcome).toBe("queued_create");
  });

  it("rejects a source_key that disagrees with the record", async () => {
    const r: WireRecord = { ...zbaRecord(), source_key: "999-99-Z" };
    const { body } = await json(await submit([r]));
    expect(body.results[0]).toMatchObject({ outcome: "invalid", errors: [expect.objectContaining({ path: "source_key" })] });
  });

  it("queues records with blocking normalization issues and flags them", async () => {
    await submit([zbaRecord({ address: "12 Gotham Blvd" })]);
    const [item] = await pending();
    expect(item!.has_blocking_issues).toBe(true);
    expect((item!.normalization_issues as any[])[0]).toMatchObject({ field: "address", raw: "12 Gotham Blvd" });
  });

  it("is idempotent: same key and body returns the stored response; different body is 409", async () => {
    const first = await json(await submit([permitRecord()], { key: "same" }));
    const again = await json(await submit([permitRecord()], { key: "same" }));
    expect(again).toEqual(first);
    expect((await ctx.db.selectFrom("submissions").select("id").execute()).length).toBe(1);
    expect((await submit([zbaRecord()], { key: "same" })).status).toBe(409);
  });

  it("dry run reports outcomes and writes nothing", async () => {
    const { status, body } = await json(await submit([permitRecord()], { query: "?dry_run=true" }));
    expect(status).toBe(202);
    expect(body).toMatchObject({ submission_id: null, dry_run: true, results: [{ outcome: "queued_create" }] });
    expect((await ctx.db.selectFrom("submissions").select("id").execute()).length).toBe(0);
    expect((await pending()).length).toBe(0);
  });

  it("enforces envelope, size, header and auth rules", async () => {
    expect((await postJson(ctx.app, "/v1/submissions", "{nope", ctx.grok, { "Idempotency-Key": "a" })).status).toBe(400);
    expect((await postJson(ctx.app, "/v1/submissions", { records: [] }, ctx.grok, { "Idempotency-Key": "b" })).status).toBe(400);
    expect((await postJson(ctx.app, "/v1/submissions", envelope([]), ctx.grok)).status).toBe(400);
    expect((await submit(Array.from({ length: 501 }, () => permitRecord()))).status).toBe(413);
    expect((await postJson(ctx.app, "/v1/submissions", envelope([]), undefined, { "Idempotency-Key": "c" })).status).toBe(401);
    expect((await submit([permitRecord()], { token: ctx.drew })).status).toBe(202);
  });

  it("stores suggestions and the display address on the queue item", async () => {
    await submit([permitRecord()]);
    const [item] = await pending();
    expect(item!.address_display).toBe("111 W. Monroe St");
    expect(item!.suggestions).toEqual({ projects: [], duplicates: [] });
  });
});

describe("GET /v1/schema/submission.json", () => {
  it("serves the JSON Schema publicly", async () => {
    const r = await ctx.app.request("/v1/schema/submission.json");
    expect(r.status).toBe(200);
    expect(JSON.stringify(await r.json())).toContain("zba_case");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter server test tests/submissions.test.ts`
Expected: FAIL — cannot resolve `../../src/http/app`.

- [ ] **Step 3: Intake**

`server/src/intake/submit.ts`:

```ts
import { createHash, randomUUID } from "node:crypto";
import type { z } from "zod";
import { formatAddressDisplay } from "../../../shared/normalize/address";
import { matterKeyOf, normalizeRecordNumber } from "../../../shared/normalize/primitives";
import { diffRecords } from "../../../shared/records/diff";
import { contentHash } from "../../../shared/records/hash";
import { normalizeRecord } from "../../../shared/records/normalize-record";
import { DATA_SCHEMAS, MAX_RECORDS, RecordEnvelope, SubmissionEnvelope } from "../../../shared/records/schemas";
import type { WireRecord } from "../../../shared/records/types";
import type { Principal } from "../auth/tokens";
import type { Db } from "../db/client";
import { HttpError } from "../errors";
import { suggestDuplicates } from "../match/duplicates";
import { suggestProjects } from "../match/suggest";
import { loadFilingRecord } from "../store/filings";
import { resolveAliases } from "../store/shared-values";

export interface RecordResult {
  index: number;
  source_key: string | null;
  outcome: "queued_create" | "queued_update" | "no_change" | "invalid";
  queue_item_id?: number;
  changed?: string[];
  errors?: { path: string; message: string }[];
}
export interface SubmissionResponse { submission_id: number | null; dry_run?: true; results: RecordResult[] }

const issuesOf = (e: z.ZodError, prefix = "") =>
  e.issues.map((i) => ({ path: [prefix, ...i.path.map(String)].filter(Boolean).join("."), message: i.message }));

export function validateRecord(raw: unknown):
  | { ok: true; record: WireRecord }
  | { ok: false; source_key: string | null; errors: { path: string; message: string }[] } {
  const env = RecordEnvelope.safeParse(raw);
  const sk = typeof (raw as { source_key?: unknown })?.source_key === "string" ? ((raw as { source_key: string }).source_key) : null;
  if (!env.success) return { ok: false, source_key: sk, errors: issuesOf(env.error) };
  const data = DATA_SCHEMAS[env.data.kind].safeParse(env.data.data);
  if (!data.success) return { ok: false, source_key: sk, errors: issuesOf(data.error, "data") };
  const d = data.data as Record<string, unknown>;
  const key = env.data.source_key.trim().toUpperCase();
  const mismatch =
    (env.data.kind === "permit" && String(d.permit_number).trim().toUpperCase() !== key) ? "must equal data.permit_number"
    : (env.data.kind === "zba_case" && String(d.case_no).trim().toUpperCase() !== key) ? "must equal data.case_no"
    : (env.data.kind === "zoning_matter" && (() => {
        const rn = normalizeRecordNumber(String(d.record_number));
        return rn.ok && matterKeyOf(rn.value) !== matterKeyOf(key);
      })()) ? "must be data.record_number without the leading S"
    : null;
  if (mismatch) return { ok: false, source_key: sk, errors: [{ path: "source_key", message: mismatch }] };
  return { ok: true, record: { ...env.data, data: d } };
}

class DryRunRollback extends Error {
  constructor(public results: RecordResult[]) { super("dry run"); }
}

async function processRecord(q: Db, submissionId: number, index: number, raw: unknown): Promise<RecordResult> {
  const v = validateRecord(raw);
  if (!v.ok) return { index, source_key: v.source_key, outcome: "invalid", errors: v.errors };

  const normalized = normalizeRecord(v.record);
  const record = await resolveAliases(q, normalized.record);
  const issues = normalized.issues;
  const hash = contentHash(record, issues);
  const base = { index, source_key: record.source_key };

  const filing = await q.selectFrom("filings").select(["id", "content_hash", "last_source_hash", "deleted_at"])
    .where("kind", "=", record.kind).where("source_key", "=", record.source_key).executeTakeFirst();
  if (filing && (hash === filing.content_hash || hash === filing.last_source_hash)) return { ...base, outcome: "no_change" };

  const prior = await q.selectFrom("queue_items").select(["id", "content_hash"])
    .where("kind", "=", record.kind).where("source_key", "=", record.source_key).where("state", "in", ["pending", "rejected"]).execute();
  if (prior.some((p) => p.content_hash === hash)) return { ...base, outcome: "no_change" };

  await q.updateTable("queue_items").set({ state: "superseded" })
    .where("kind", "=", record.kind).where("source_key", "=", record.source_key).where("state", "=", "pending").execute();

  const live = filing && !filing.deleted_at ? filing : null;
  const diff = diffRecords(live ? await loadFilingRecord(q, live.id) : null, record);
  const projects = await suggestProjects(q, record);
  const duplicates = await suggestDuplicates(q, record);
  const item = await q.insertInto("queue_items").values({
    submission_id: submissionId, record_index: index, kind: record.kind, source_key: record.source_key,
    action: live ? "update" : "create", proposed: JSON.stringify(record), content_hash: hash,
    diff: JSON.stringify(diff), normalization_issues: JSON.stringify(issues),
    suggestions: JSON.stringify({ projects, duplicates }), in_target: record.in_target,
    has_flag: Boolean(record.flag || record.attributes.unit_flag), has_blocking_issues: issues.some((i) => i.blocking),
    top_strength: projects[0]?.strength ?? null,
    address_display: record.addresses[0] ? formatAddressDisplay(record.addresses[0]) : null,
  }).returning("id").executeTakeFirstOrThrow();

  return live
    ? { ...base, outcome: "queued_update", queue_item_id: item.id, changed: Object.keys(diff).sort() }
    : { ...base, outcome: "queued_create", queue_item_id: item.id };
}

async function stored(db: Db, jti: string, key: string, sha: string): Promise<SubmissionResponse> {
  const row = await db.selectFrom("submissions").select(["body_sha256", "response"]).where("token_jti", "=", jti).where("idempotency_key", "=", key).executeTakeFirstOrThrow();
  if (row.body_sha256 !== sha) throw new HttpError(409, "this Idempotency-Key was already used with a different body");
  if (!row.response) throw new HttpError(409, "a request with this Idempotency-Key is still being processed");
  return row.response as SubmissionResponse;
}

export async function processSubmission(
  db: Db,
  principal: Principal,
  input: { body: unknown; rawBody: string; idempotencyKey: string | undefined; dryRun: boolean },
): Promise<SubmissionResponse> {
  const key = input.idempotencyKey?.trim();
  if (!key) throw new HttpError(400, "the Idempotency-Key header is required");
  const env = SubmissionEnvelope.safeParse(input.body);
  if (!env.success) throw new HttpError(400, "malformed submission", issuesOf(env.error));
  if (env.data.records.length > MAX_RECORDS) throw new HttpError(413, `at most ${MAX_RECORDS} records per request; split the run into chunks`);
  const sha = createHash("sha256").update(input.rawBody).digest("hex");

  if (!input.dryRun) {
    const existing = await db.selectFrom("submissions").select("id").where("token_jti", "=", principal.jti).where("idempotency_key", "=", key).executeTakeFirst();
    if (existing) return stored(db, principal.jti, key, sha);
  }

  try {
    return await db.transaction().execute(async (trx) => {
      const inserted = await trx.insertInto("submissions").values({
        token_jti: principal.jti, idempotency_key: input.dryRun ? `dry-run:${randomUUID()}` : key, body_sha256: sha, body: input.rawBody,
      }).onConflict((oc) => oc.columns(["token_jti", "idempotency_key"]).doNothing()).returning("id").executeTakeFirst();
      if (!inserted) return null; // a concurrent identical request won the race; answered below
      const results: RecordResult[] = [];
      for (const [index, raw] of env.data.records.entries()) results.push(await processRecord(trx, inserted.id, index, raw));
      if (input.dryRun) throw new DryRunRollback(results);
      const response: SubmissionResponse = { submission_id: inserted.id, results };
      await trx.updateTable("submissions").set({ response: JSON.stringify(response) }).where("id", "=", inserted.id).execute();
      return response;
    }) ?? (await stored(db, principal.jti, key, sha));
  } catch (e) {
    if (e instanceof DryRunRollback) return { submission_id: null, dry_run: true, results: e.results };
    throw e;
  }
}
```

Note: `body` is stored from `rawBody` (already JSON text), which satisfies the `Jsonb` insert type and keeps Grok's exact payload.

- [ ] **Step 4: App and route**

`server/src/http/routes/submissions.ts`:

```ts
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { submissionJsonSchema } from "../../../../shared/records/schemas";
import { requireRole, type AppEnv } from "../../auth/middleware";
import { HttpError } from "../../errors";
import { processSubmission } from "../../intake/submit";
import type { AppDeps } from "../app";

export function registerSubmissionRoutes(app: Hono<AppEnv>, deps: AppDeps): void {
  app.post(
    "/v1/submissions",
    requireRole("submitter"),
    bodyLimit({ maxSize: 10 * 1024 * 1024, onError: (c) => c.json({ error: "request body is larger than 10 MB" }, 413) }),
    async (c) => {
      const rawBody = await c.req.text();
      let body: unknown;
      try { body = JSON.parse(rawBody); } catch { throw new HttpError(400, "request body is not valid JSON"); }
      const res = await processSubmission(deps.db, c.get("principal")!, {
        body, rawBody, idempotencyKey: c.req.header("Idempotency-Key"), dryRun: c.req.query("dry_run") === "true",
      });
      return c.json(res, 202);
    },
  );
  const schema = submissionJsonSchema();
  app.get("/v1/schema/submission.json", (c) => c.json(schema));
}
```

`server/src/http/app.ts`:

```ts
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { authenticate, type AppEnv } from "../auth/middleware";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { HttpError } from "../errors";
import { registerSubmissionRoutes } from "./routes/submissions";

export interface AppDeps { db: Db; config: Config }

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", authenticate(deps));
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: err.message, ...(err.details === undefined ? {} : { details: err.details }) }, err.status as ContentfulStatusCode);
    }
    console.error(JSON.stringify({ t: new Date().toISOString(), level: "error", path: c.req.path, message: (err as Error).message }));
    return c.json({ error: "internal error" }, 500);
  });
  app.notFound((c) => c.json({ error: "not found" }, 404));
  registerSubmissionRoutes(app, deps);
  return app;
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter server test tests/submissions.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/intake server/src/http server/tests/submissions.test.ts server/tests/helpers/app.ts
git commit -m "feat(server): Grok submission intake with idempotency, dry run and per-record outcomes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 11: Projects store, direct edits, publish-affecting tracking

**Files:**
- Create: `server/src/store/projects.ts`, `server/src/store/edit.ts`, `server/src/publish/state.ts`, `server/tests/edit.test.ts`

**Interfaces:**
- Consumes: `ProjectSchema` (`src/lib/schema.ts`), `normalizeAddress` (Task 4), `upsertAddress`, `writeFiling`, `loadFilingRecord`, `resolveAliases`, `filingRole` (Task 8), `validateRecord` (Task 10), `denormalizeRecord`, `normalizeRecord` (Task 5), `HttpError`, `withActor`, `geogPoint`.
- Produces:
  - `ProjectCreateInput` (Zod; site `ProjectSchema` + `visibility`, optional nullable fields and `confidence` default `"reported"`), `type ProjectCreate = z.infer<typeof ProjectCreateInput>`
  - `ProjectPatch` (Zod; every field except `id` optional, strict), `type ProjectPatchInput`
  - `createProjectRow(q, input: ProjectCreate): Promise<void>`, `updateProjectRow(q, id, patch: ProjectPatchInput): Promise<void>`, `setProjectDeleted(q, id, deleted: boolean): Promise<void>`
  - `linkFiling(q, projectId, filingId, linkedBy, reason): Promise<void>`, `unlinkFiling(q, projectId, filingId): Promise<void>`
  - `updateFilingRecord(q, filingId, patch: Record<string, unknown>): Promise<void>`, `setFilingDeleted(q, filingId, deleted: boolean): Promise<void>`
  - `affectsPublic(q, scope: { projectIds?: string[]; filingIds?: number[] }): Promise<boolean>`, `markDirty(q): Promise<void>`, `markChanged(q, scope): Promise<void>`, `trackPublic<T>(q, scope, fn: () => Promise<T>): Promise<T>`

- [ ] **Step 1: Write the failing tests**

`server/tests/edit.test.ts`:

```ts
import { sql } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";
import { normalizeRecord } from "../../shared/records/normalize-record";
import { zoningRecord } from "../../shared/tests/fixtures";
import { withActor } from "../src/db/actor";
import { markChanged, trackPublic } from "../src/publish/state";
import { linkFiling, setFilingDeleted, unlinkFiling, updateFilingRecord } from "../src/store/edit";
import { loadFilingRecord, writeFiling } from "../src/store/filings";
import { createProjectRow, setProjectDeleted, updateProjectRow, type ProjectCreate } from "../src/store/projects";
import { getTestDb, resetDb } from "./helpers/db";

const db = getTestDb();
beforeEach(() => resetDb(db));
const drew = <T>(fn: (q: typeof db) => Promise<T>) => withActor(db, "drew", "admin_edit", fn);

const project = (over: Partial<ProjectCreate> = {}): ProjectCreate => ({
  id: "111-w-monroe", name: "Harris Bank building", address: "111 W. Monroe St", program: "lasalle", status: "approved",
  status_note: "Approved", confidence: "dpd", lat: 41.880635, lng: -87.631098,
  sources: ["https://www.chicago.gov/content/city/en/sites/lasalle-street/proposals.html"], visibility: "published",
  ...over,
});
const dirty = async () => (await db.selectFrom("site_state").select("dirty").executeTakeFirstOrThrow()).dirty;
const point = (id: string) => sql<{ lat: number; lng: number }>`select ST_Y(point::geometry) as lat, ST_X(point::geometry) as lng from projects where id = ${id}`.execute(db).then((r) => r.rows[0]);

describe("projects", () => {
  it("creates a project with its canonical address and history", async () => {
    await drew((q) => createProjectRow(q, project()));
    const row = await db.selectFrom("projects").selectAll().executeTakeFirstOrThrow();
    expect(row).toMatchObject({ id: "111-w-monroe", tpc_usd: null, visibility: "published" });
    const addr = await db.selectFrom("project_addresses").innerJoin("addresses", "addresses.id", "project_addresses.address_id").select(["street_name", "suffix"]).executeTakeFirstOrThrow();
    expect(addr).toEqual({ street_name: "MONROE", suffix: "ST" });
    const rev = await db.selectFrom("revisions").select(["actor", "reason"]).where("table_name", "=", "projects").executeTakeFirstOrThrow();
    expect(rev).toEqual({ actor: "drew", reason: "admin_edit" });
  });

  it("stores TPC in dollars", async () => {
    await drew((q) => createProjectRow(q, project({ tpc_musd: 6.5 })));
    expect((await db.selectFrom("projects").select("tpc_usd").executeTakeFirstOrThrow()).tpc_usd).toBe(6_500_000);
  });

  it("rejects an unknown street (422) and a duplicate id (409)", async () => {
    await expect(drew((q) => createProjectRow(q, project({ address: "12 Gotham Blvd" })))).rejects.toMatchObject({ status: 422 });
    await drew((q) => createProjectRow(q, project()));
    await expect(drew((q) => createProjectRow(q, project()))).rejects.toMatchObject({ status: 409 });
  });

  it("updates fields, the primary address, and one coordinate at a time", async () => {
    await drew((q) => createProjectRow(q, project()));
    await drew((q) => updateProjectRow(q, "111-w-monroe", { name: "Renamed", address: "79 W Monroe St", lat: 41.8807 }));
    const row = await db.selectFrom("projects").select(["name"]).executeTakeFirstOrThrow();
    expect(row.name).toBe("Renamed");
    expect(await point("111-w-monroe")).toEqual({ lat: 41.8807, lng: -87.631098 });
    const addrs = await db.selectFrom("project_addresses").innerJoin("addresses", "addresses.id", "project_addresses.address_id").select(["number_from"]).execute();
    expect(addrs).toEqual([{ number_from: 79 }]);
  });

  it("404s edits to missing or deleted projects, and restores", async () => {
    await expect(drew((q) => updateProjectRow(q, "nope", { name: "x" }))).rejects.toMatchObject({ status: 404 });
    await drew((q) => createProjectRow(q, project()));
    await drew((q) => setProjectDeleted(q, "111-w-monroe", true));
    await expect(drew((q) => updateProjectRow(q, "111-w-monroe", { name: "x" }))).rejects.toMatchObject({ status: 404 });
    await drew((q) => setProjectDeleted(q, "111-w-monroe", false));
    await drew((q) => updateProjectRow(q, "111-w-monroe", { name: "back" }));
  });
});

describe("links and filing edits", () => {
  async function setup() {
    return drew(async (q) => {
      await createProjectRow(q, project());
      return writeFiling(q, normalizeRecord(zoningRecord()).record, { sourceHash: "grok-hash" });
    });
  }

  it("links and unlinks with history", async () => {
    const f = await setup();
    await drew((q) => linkFiling(q, "111-w-monroe", f, "drew", "manual"));
    expect(await db.selectFrom("project_filings").select(["role", "reason"]).execute()).toEqual([{ role: "zoning", reason: "manual" }]);
    await drew((q) => unlinkFiling(q, "111-w-monroe", f));
    const ops = await db.selectFrom("revisions").select("op").where("table_name", "=", "project_filings").orderBy("id").execute();
    expect(ops.map((o) => o.op)).toEqual(["insert", "delete"]);
  });

  it("refuses links to deleted projects or filings", async () => {
    const f = await setup();
    await drew((q) => setFilingDeleted(q, f, true));
    await expect(drew((q) => linkFiling(q, "111-w-monroe", f, "drew", "x"))).rejects.toMatchObject({ status: 404 });
  });

  it("edits a filing through the normalizers and keeps Grok's source hash", async () => {
    const f = await setup();
    await drew((q) => updateFilingRecord(q, f, { status: "Final - Passed (2026-06-17)", applicant: "Example Owner, LLC" }));
    const rec = await loadFilingRecord(db, f);
    expect(rec.status).toBe("Final - Passed (2026-06-17)");
    expect((await db.selectFrom("filings").select("last_source_hash").executeTakeFirstOrThrow()).last_source_hash).toBe("grok-hash");
  });

  it("rejects filing edits that fail validation or normalization", async () => {
    const f = await setup();
    await expect(drew((q) => updateFilingRecord(q, f, { ward: "42" }))).rejects.toMatchObject({ status: 422 });
    await expect(drew((q) => updateFilingRecord(q, f, { address: "12 Gotham Blvd" }))).rejects.toMatchObject({ status: 422 });
    await expect(drew((q) => updateFilingRecord(q, f, { kind: "permit" }))).rejects.toMatchObject({ status: 422 });
  });
});

describe("publish-affecting changes", () => {
  it("marks the site dirty only for published projects", async () => {
    await drew(async (q) => {
      await createProjectRow(q, project({ id: "draft-one", visibility: "draft" }));
      await markChanged(q, { projectIds: ["draft-one"] });
    });
    expect(await dirty()).toBe(false);
    await drew((q) => trackPublic(q, { projectIds: ["draft-one"] }, () => updateProjectRow(q, "draft-one", { visibility: "published" })));
    expect(await dirty()).toBe(true);
  });

  it("counts unpublishing and deleting as public changes", async () => {
    await drew((q) => createProjectRow(q, project()));
    await sql`update site_state set dirty = false`.execute(db);
    await drew((q) => trackPublic(q, { projectIds: ["111-w-monroe"] }, () => setProjectDeleted(q, "111-w-monroe", true)));
    expect(await dirty()).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter server test tests/edit.test.ts`
Expected: FAIL — cannot resolve `../src/publish/state`.

- [ ] **Step 3: Publish state**

`server/src/publish/state.ts`:

```ts
import { sql } from "kysely";
import type { Db } from "../db/client";

export interface PublicScope { projectIds?: string[]; filingIds?: number[] }

/** True when any published, non-deleted project in scope (directly or through a linked filing) exists. */
export async function affectsPublic(q: Db, scope: PublicScope): Promise<boolean> {
  const projectIds = scope.projectIds ?? [];
  const filingIds = scope.filingIds ?? [];
  if (!projectIds.length && !filingIds.length) return false;
  const row = await q.selectFrom("projects").select("id")
    .where("visibility", "=", "published").where("deleted_at", "is", null)
    .where((eb) => eb.or([
      ...(projectIds.length ? [eb("id", "in", projectIds)] : []),
      ...(filingIds.length ? [eb("id", "in", eb.selectFrom("project_filings").select("project_id").where("filing_id", "in", filingIds))] : []),
    ]))
    .limit(1).executeTakeFirst();
  return Boolean(row);
}

export async function markDirty(q: Db): Promise<void> {
  await sql`update site_state set dirty = true, last_change_at = now()`.execute(q);
}

export async function markChanged(q: Db, scope: PublicScope): Promise<void> {
  if (await affectsPublic(q, scope)) await markDirty(q);
}

/** Runs fn and marks the site dirty if the scope touched public data before or after (covers publish, unpublish, delete). */
export async function trackPublic<T>(q: Db, scope: PublicScope, fn: () => Promise<T>): Promise<T> {
  const before = await affectsPublic(q, scope);
  const result = await fn();
  if (before || (await affectsPublic(q, scope))) await markDirty(q);
  return result;
}
```

- [ ] **Step 4: Projects**

`server/src/store/projects.ts`:

```ts
import { sql } from "kysely";
import { z } from "zod";
import { normalizeAddress } from "../../../shared/normalize/address";
import { ProjectSchema } from "../../../src/lib/schema";
import { geogPoint, type Db } from "../db/client";
import { HttpError } from "../errors";
import { upsertAddress } from "./shared-values";

const Visibility = z.enum(["draft", "published"]);

export const ProjectCreateInput = ProjectSchema.extend({
  visibility: Visibility.default("draft"),
  confidence: z.enum(["dpd", "reported"]).default("reported"),
}).partial({
  dpd_map_no: true, name: true, developer: true, units: true, affordable_units: true, tpc_musd: true,
  public_support: true, flag: true, built_by_3f_url: true, notes: true,
});
export type ProjectCreate = z.input<typeof ProjectCreateInput>;

export const ProjectPatch = ProjectSchema.omit({ id: true }).extend({ visibility: Visibility }).partial().strict();
export type ProjectPatchInput = z.infer<typeof ProjectPatch>;

const toUsd = (musd: number | null | undefined) => (musd == null ? null : Math.round(musd * 1_000_000));

async function canonicalAddressId(q: Db, raw: string, point: { lat: number; lon: number }): Promise<number> {
  const a = normalizeAddress(raw);
  if (!a.ok) throw new HttpError(422, `address: ${a.message}`);
  return upsertAddress(q, a.value, point);
}

export async function createProjectRow(q: Db, raw: ProjectCreate): Promise<void> {
  const parsed = ProjectCreateInput.safeParse(raw);
  if (!parsed.success) throw new HttpError(422, "invalid project", parsed.error.issues);
  const p = parsed.data;
  if (await q.selectFrom("projects").select("id").where("id", "=", p.id).executeTakeFirst()) {
    throw new HttpError(409, `project ${p.id} already exists`);
  }
  const addressId = await canonicalAddressId(q, p.address, { lat: p.lat, lon: p.lng });
  await q.insertInto("projects").values({
    id: p.id, dpd_map_no: p.dpd_map_no ?? null, name: p.name ?? null, developer: p.developer ?? null,
    units: p.units ?? null, affordable_units: p.affordable_units ?? null, tpc_usd: toUsd(p.tpc_musd),
    program: p.program, public_support: p.public_support ?? null, status: p.status, status_note: p.status_note,
    flag: p.flag ?? null, confidence: p.confidence, built_by_3f_url: p.built_by_3f_url ?? null,
    point: geogPoint(p.lat, p.lng), sources: p.sources, notes: p.notes ?? null, visibility: p.visibility,
  }).execute();
  await q.insertInto("project_addresses").values({ project_id: p.id, address_id: addressId }).execute();
}

async function liveProject(q: Db, id: string) {
  const row = await q.selectFrom("projects")
    .select(["id", sql<number>`ST_Y(point::geometry)`.as("lat"), sql<number>`ST_X(point::geometry)`.as("lng")])
    .where("id", "=", id).where("deleted_at", "is", null).executeTakeFirst();
  if (!row) throw new HttpError(404, `no project ${id}`);
  return row;
}

export async function updateProjectRow(q: Db, id: string, raw: ProjectPatchInput): Promise<void> {
  const parsed = ProjectPatch.safeParse(raw);
  if (!parsed.success) throw new HttpError(422, "invalid project patch", parsed.error.issues);
  const { address, lat, lng, tpc_musd, ...rest } = parsed.data;
  const current = await liveProject(q, id);
  const nextLat = lat ?? current.lat;
  const nextLng = lng ?? current.lng;
  const set: Record<string, unknown> = { ...rest };
  if (tpc_musd !== undefined) set.tpc_usd = toUsd(tpc_musd);
  if (lat !== undefined || lng !== undefined) set.point = geogPoint(nextLat, nextLng);
  if (Object.keys(set).length) await q.updateTable("projects").set(set).where("id", "=", id).execute();
  if (address !== undefined) {
    const addressId = await canonicalAddressId(q, address, { lat: nextLat, lon: nextLng });
    const primary = await q.selectFrom("project_addresses").select("address_id").where("project_id", "=", id).where("is_primary", "=", true).executeTakeFirst();
    if (primary?.address_id !== addressId) {
      await q.deleteFrom("project_addresses").where("project_id", "=", id).where("is_primary", "=", true).execute();
      await q.insertInto("project_addresses").values({ project_id: id, address_id: addressId }).execute();
    }
  }
}

export async function setProjectDeleted(q: Db, id: string, deleted: boolean): Promise<void> {
  const r = await q.updateTable("projects").set({ deleted_at: deleted ? new Date() : null })
    .where("id", "=", id).where("deleted_at", deleted ? "is" : "is not", null).executeTakeFirst();
  if (Number(r.numUpdatedRows) !== 1) throw new HttpError(404, deleted ? `no live project ${id}` : `no deleted project ${id}`);
}
```

- [ ] **Step 5: Links and filing edits**

`server/src/store/edit.ts`:

```ts
import { denormalizeRecord } from "../../../shared/records/denormalize-record";
import { normalizeRecord } from "../../../shared/records/normalize-record";
import type { Kind } from "../../../shared/records/types";
import type { Db } from "../db/client";
import { HttpError } from "../errors";
import { validateRecord } from "../intake/submit";
import { filingRole, loadFilingRecord, writeFiling } from "./filings";
import { resolveAliases } from "./shared-values";

async function liveFiling(q: Db, filingId: number) {
  const f = await q.selectFrom("filings").select(["id", "kind", "attributes"]).where("id", "=", filingId).where("deleted_at", "is", null).executeTakeFirst();
  if (!f) throw new HttpError(404, `no live filing ${filingId}`);
  return f;
}

export async function linkFiling(q: Db, projectId: string, filingId: number, linkedBy: string, reason: string): Promise<void> {
  const p = await q.selectFrom("projects").select("id").where("id", "=", projectId).where("deleted_at", "is", null).executeTakeFirst();
  if (!p) throw new HttpError(404, `no live project ${projectId}`);
  const f = await liveFiling(q, filingId);
  await q.insertInto("project_filings").values({
    project_id: projectId, filing_id: filingId, role: filingRole(f.kind as Kind, f.attributes as Record<string, unknown>), linked_by: linkedBy, reason,
  }).onConflict((oc) => oc.columns(["project_id", "filing_id"]).doNothing()).execute();
}

export async function unlinkFiling(q: Db, projectId: string, filingId: number): Promise<void> {
  const r = await q.deleteFrom("project_filings").where("project_id", "=", projectId).where("filing_id", "=", filingId).executeTakeFirst();
  if (Number(r.numDeletedRows) !== 1) throw new HttpError(404, `filing ${filingId} is not linked to ${projectId}`);
}

/** Applies a patch in Grok's wire field names, re-validated and re-normalized exactly like a submission. */
export async function updateFilingRecord(q: Db, filingId: number, patch: Record<string, unknown>): Promise<void> {
  await liveFiling(q, filingId);
  if ("kind" in patch || "source_key" in patch) throw new HttpError(422, "kind and source_key cannot be edited");
  const current = denormalizeRecord(await loadFilingRecord(q, filingId));
  const v = validateRecord({ ...current, observed_at: new Date().toISOString(), data: { ...current.data, ...patch } });
  if (!v.ok) throw new HttpError(422, "invalid filing edit", v.errors);
  const { record, issues } = normalizeRecord(v.record);
  const blocking = issues.filter((i) => i.blocking);
  if (blocking.length) throw new HttpError(422, "values could not be normalized", blocking);
  await writeFiling(q, await resolveAliases(q, record), { sourceHash: null });
}

export async function setFilingDeleted(q: Db, filingId: number, deleted: boolean): Promise<void> {
  const r = await q.updateTable("filings").set({ deleted_at: deleted ? new Date() : null })
    .where("id", "=", filingId).where("deleted_at", deleted ? "is" : "is not", null).executeTakeFirst();
  if (Number(r.numUpdatedRows) !== 1) throw new HttpError(404, deleted ? `no live filing ${filingId}` : `no deleted filing ${filingId}`);
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter server test tests/edit.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/store/projects.ts server/src/store/edit.ts server/src/publish/state.ts server/tests/edit.test.ts
git commit -m "feat(server): project and filing editing, links, publish-affecting tracking

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Review — queue listing, approve, reject, bulk review

**Files:**
- Create: `server/src/review/queue.ts`, `server/src/review/review.ts`, `server/tests/review.test.ts`
- Modify: `server/tests/helpers/app.ts` (add `queueRecords`)

**Interfaces:**
- Consumes: Tasks 8–11.
- Produces:
  - `QueueFilterSchema`, `type QueueFilter`; `listQueue(q, filter: Partial<QueueFilter>, page?: { limit?: number; offset?: number }): Promise<{ total: number; items: QueueItemSummary[] }>`; `getQueueItem(q, id): Promise<QueueItemDetail>`; `queueSummary(q): Promise<QueueSummary>`
  - `interface QueueItemSummary { id: number; kind: string; source_key: string; action: string; state: string; address: string | null; in_target: boolean; has_flag: boolean; has_blocking_issues: boolean; top_suggestion: { project_id: string; strength: string } | null; changed: string[]; created_at: Date }`
  - `ApproveOptionsSchema`, `type ApproveOptions`; `approveItem(db: Db, reviewer: string, id: number, opts?: ApproveOptions): Promise<ApproveResult>` where `ApproveResult = { queue_item_id: number; filing_id: number; linked_project_id: string | null; status_change: StatusChange | null }`
  - `rejectItem(db, reviewer, id, reason: string): Promise<void>`
  - `BulkReviewSchema`, `type BulkReviewRequest`; `bulkReview(db, reviewer, req): Promise<BulkPreview | BulkResult>`; `BulkPreview = { preview: true; count: number; sample: QueueItemSummary[]; confirm: string; expires_at: string }`, `BulkResult = { preview: false; approved: number; rejected: number; skipped: number; errors: { id: number; error: string }[] }`
  - test helper `queueRecords(ctx, records): Promise<number[]>` (returns queue item ids)

- [ ] **Step 1: Helper and failing tests**

Add to `server/tests/helpers/app.ts`:

```ts
let queueKey = 0;
/** Submits records as Grok and returns the new queue item ids (in record order; null for non-queued). */
export async function queueRecords(ctx: Awaited<ReturnType<typeof makeApp>>, records: unknown[]): Promise<(number | null)[]> {
  const res = await postJson(ctx.app, "/v1/submissions", {
    run: { program: "zoning", run_id: `t-${++queueKey}`, started_at: "2026-10-02T12:39:00Z" }, records,
  }, ctx.grok, { "Idempotency-Key": `q-${queueKey}` });
  const body = (await res.json()) as { results: { queue_item_id?: number }[] };
  return body.results.map((r) => r.queue_item_id ?? null);
}
```

`server/tests/review.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { permitRecord, zbaRecord, zoningRecord } from "../../shared/tests/fixtures";
import { withActor } from "../src/db/actor";
import { bulkReview, approveItem, rejectItem } from "../src/review/review";
import { getQueueItem, listQueue, queueSummary } from "../src/review/queue";
import { loadFilingRecord } from "../src/store/filings";
import { makeApp, queueRecords } from "./helpers/app";
import { insertProject } from "./helpers/fixtures";

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => { ctx = await makeApp(); });
const one = async (rec: unknown) => (await queueRecords(ctx, [rec]))[0]!;
const project = (id: string, status: "approved" | "planning" = "approved", visibility: "draft" | "published" = "published") =>
  withActor(ctx.db, "test", "test", (q) => insertProject(q, { id, lat: 41.880635, lng: -87.631098, status, visibility, address: "111-123 W Monroe St" }));
const dirty = async () => (await ctx.db.selectFrom("site_state").select("dirty").executeTakeFirstOrThrow()).dirty;

describe("approve", () => {
  it("writes the filing under the reviewer and the queue item id", async () => {
    const id = await one(permitRecord());
    const r = await approveItem(ctx.db, "drew", id);
    expect(r).toMatchObject({ queue_item_id: id, linked_project_id: null, status_change: null });
    const revs = await ctx.db.selectFrom("revisions").select(["actor", "reason"]).where("table_name", "=", "filings").execute();
    expect(revs).toEqual([{ actor: "drew", reason: `queue_item:${id}` }]);
    expect((await getQueueItem(ctx.db, id)).state).toBe("approved");
  });

  it("links to a project with the matcher's reasons and marks the site dirty", async () => {
    await project("111-w-monroe");
    const id = await one(permitRecord());
    await approveItem(ctx.db, "drew", id, { link_to: "111-w-monroe" });
    const link = await ctx.db.selectFrom("project_filings").select(["role", "reason", "linked_by"]).executeTakeFirstOrThrow();
    expect(link).toMatchObject({ role: "permit", linked_by: "drew" });
    expect(link.reason).toMatch(/^(likely|possible|strong):/);
    expect(await dirty()).toBe(true);
  });

  it("creates a draft project from the filing", async () => {
    // A point inside the site's DOWNTOWN_BBOX (project pins must be downtown).
    const id = await one(zbaRecord({ lat: 41.905, lon: -87.65 }));
    const r = await approveItem(ctx.db, "drew", id, { create_project: { id: "3642-w-oakdale", name: "Oakdale" } });
    expect(r.linked_project_id).toBe("3642-w-oakdale");
    const p = await ctx.db.selectFrom("projects").select(["visibility", "sources", "status"]).executeTakeFirstOrThrow();
    expect(p).toEqual({ visibility: "draft", sources: [zbaRecord().data.source_pdf_url], status: "planning" });
    expect(await dirty()).toBe(false);
  });

  it("blocks approval while values are unnormalized; overrides fix them", async () => {
    const id = await one(zbaRecord({ address: "12 Gotham Blvd" }));
    await expect(approveItem(ctx.db, "drew", id)).rejects.toMatchObject({ status: 422 });
    await approveItem(ctx.db, "drew", id, { overrides: { address: "3642 W. Oakdale Avenue" } });
    const filing = await ctx.db.selectFrom("filings").select("id").executeTakeFirstOrThrow();
    expect((await loadFilingRecord(ctx.db, filing.id)).addresses[0]?.street_name).toBe("OAKDALE");
  });

  it("override then original resend is no_change", async () => {
    const id = await one(zbaRecord({ attorney: "Ximena Castr0" }));
    await approveItem(ctx.db, "drew", id, { overrides: { attorney: "Ximena Castro" } });
    expect(await queueRecords(ctx, [zbaRecord({ attorney: "Ximena Castr0" })])).toEqual([null]);
    expect((await listQueue(ctx.db, {})).total).toBe(0);
  });

  it("accepting the status change moves the project forward", async () => {
    await project("111-w-monroe", "approved");
    const id = await one(permitRecord());
    const r = await approveItem(ctx.db, "drew", id, { link_to: "111-w-monroe", accept_status_change: true });
    expect(r.status_change).toMatchObject({ from: "approved", to: "permitted" });
    const p = await ctx.db.selectFrom("projects").select(["status", "status_note"]).executeTakeFirstOrThrow();
    expect(p.status).toBe("permitted");
    expect(p.status_note).toMatch(/permit 100912345/);
  });

  it("409s on items that are not pending", async () => {
    const id = await one(permitRecord());
    await approveItem(ctx.db, "drew", id);
    await expect(approveItem(ctx.db, "drew", id)).rejects.toMatchObject({ status: 409 });
  });
});

describe("reject", () => {
  it("needs a reason, sticks for identical data, reopens for changed data", async () => {
    const id = await one(zoningRecord());
    await expect(rejectItem(ctx.db, "drew", id, " ")).rejects.toMatchObject({ status: 400 });
    await rejectItem(ctx.db, "drew", id, "not residential");
    expect(await queueRecords(ctx, [zoningRecord()])).toEqual([null]);
    expect((await queueRecords(ctx, [zoningRecord({ units: 400 })]))[0]).not.toBeNull();
  });
});

describe("queue listing", () => {
  it("filters and summarizes", async () => {
    await project("111-w-monroe");
    await queueRecords(ctx, [permitRecord(), zbaRecord({ in_target: false }), zbaRecord({ case_no: "1-26-Z", address: "12 Gotham Blvd" })]);
    expect((await listQueue(ctx.db, { in_target: false })).total).toBe(1);
    expect((await listQueue(ctx.db, { has_issues: true })).items.map((i) => i.source_key)).toEqual(["1-26-Z"]);
    expect((await listQueue(ctx.db, { kind: "permit" })).items[0]!.top_suggestion?.project_id).toBe("111-w-monroe");
    const s = await queueSummary(ctx.db);
    expect(s).toMatchObject({ pending: 3, with_blocking_issues: 1, by_kind: { permit: 1, zba_case: 2 } });
  });
});

describe("bulk review", () => {
  it("previews, then executes with a confirm code that works once", async () => {
    await queueRecords(ctx, [zbaRecord(), zbaRecord({ case_no: "2-26-Z" }), zbaRecord({ case_no: "3-26-Z", address: "12 Gotham Blvd" })]);
    const preview = await bulkReview(ctx.db, "drew", { filter: { kind: "zba_case" }, action: "approve" });
    if (!preview.preview) throw new Error("expected a preview");
    expect(preview.count).toBe(2); // the item with blocking issues is excluded
    const result = await bulkReview(ctx.db, "drew", { filter: { kind: "zba_case" }, action: "approve", confirm: preview.confirm });
    expect(result).toMatchObject({ preview: false, approved: 2, skipped: 0, errors: [] });
    await expect(bulkReview(ctx.db, "drew", { filter: { kind: "zba_case" }, action: "approve", confirm: preview.confirm })).rejects.toMatchObject({ status: 400 });
  });

  it("link_strong links only items with exactly one strong suggestion", async () => {
    await project("111-w-monroe");
    const [z] = await queueRecords(ctx, [zoningRecord()]);
    await approveItem(ctx.db, "drew", z!, { link_to: "111-w-monroe" });
    await queueRecords(ctx, [permitRecord(), zbaRecord({ address: "4000 W Irving Park Rd", lat: null, lon: null, applicant: null, owner: null, attorney: null })]);
    const preview = await bulkReview(ctx.db, "drew", { filter: {}, action: "approve", link_strong: true });
    if (!preview.preview) throw new Error("expected a preview");
    await bulkReview(ctx.db, "drew", { filter: {}, action: "approve", link_strong: true, confirm: preview.confirm });
    const links = await ctx.db.selectFrom("project_filings").innerJoin("filings", "filings.id", "project_filings.filing_id").select("filings.kind").execute();
    expect(links.map((l) => l.kind).sort()).toEqual(["permit", "zoning_matter"]);
  });

  it("bulk reject requires a reason", async () => {
    await expect(bulkReview(ctx.db, "drew", { filter: {}, action: "reject" })).rejects.toMatchObject({ status: 400 });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter server test tests/review.test.ts`
Expected: FAIL — cannot resolve `../src/review/review`.

- [ ] **Step 3: Queue listing**

`server/src/review/queue.ts`:

```ts
import { z } from "zod";
import { KINDS } from "../../../shared/records/types";
import type { Db } from "../db/client";
import { HttpError } from "../errors";

export const QueueFilterSchema = z.strictObject({
  state: z.enum(["pending", "approved", "rejected", "superseded"]).default("pending"),
  kind: z.enum(KINDS).optional(),
  in_target: z.boolean().optional(),
  has_flag: z.boolean().optional(),
  action: z.enum(["create", "update"]).optional(),
  strength: z.enum(["strong", "likely", "possible", "none"]).optional(),
  has_issues: z.boolean().optional(),
  submission_id: z.number().int().optional(),
});
export type QueueFilter = z.infer<typeof QueueFilterSchema>;

export interface QueueItemSummary {
  id: number; kind: string; source_key: string; action: string; state: string; address: string | null;
  in_target: boolean; has_flag: boolean; has_blocking_issues: boolean;
  top_suggestion: { project_id: string; strength: string } | null; changed: string[]; created_at: Date;
}

export function filtered(q: Db, raw: Partial<QueueFilter>) {
  const f = QueueFilterSchema.parse(raw);
  return q.selectFrom("queue_items")
    .where("state", "=", f.state)
    .$if(f.kind !== undefined, (b) => b.where("kind", "=", f.kind!))
    .$if(f.in_target !== undefined, (b) => b.where("in_target", "=", f.in_target!))
    .$if(f.has_flag !== undefined, (b) => b.where("has_flag", "=", f.has_flag!))
    .$if(f.action !== undefined, (b) => b.where("action", "=", f.action!))
    .$if(f.has_issues !== undefined, (b) => b.where("has_blocking_issues", "=", f.has_issues!))
    .$if(f.submission_id !== undefined, (b) => b.where("submission_id", "=", f.submission_id!))
    .$if(f.strength === "none", (b) => b.where("top_strength", "is", null))
    .$if(f.strength !== undefined && f.strength !== "none", (b) => b.where("top_strength", "=", f.strength!));
}

type Row = { id: number; kind: string; source_key: string; action: string; state: string; address_display: string | null; in_target: boolean; has_flag: boolean; has_blocking_issues: boolean; diff: unknown; suggestions: unknown; created_at: Date };

export function summarize(r: Row): QueueItemSummary {
  const top = ((r.suggestions as { projects?: { project_id: string; strength: string }[] }).projects ?? [])[0];
  return {
    id: r.id, kind: r.kind, source_key: r.source_key, action: r.action, state: r.state, address: r.address_display,
    in_target: r.in_target, has_flag: r.has_flag, has_blocking_issues: r.has_blocking_issues,
    top_suggestion: top ? { project_id: top.project_id, strength: top.strength } : null,
    changed: Object.keys(r.diff as object).sort(), created_at: r.created_at,
  };
}

const SUMMARY_COLUMNS = ["id", "kind", "source_key", "action", "state", "address_display", "in_target", "has_flag", "has_blocking_issues", "diff", "suggestions", "created_at"] as const;

export async function listQueue(q: Db, filter: Partial<QueueFilter>, page: { limit?: number; offset?: number } = {}) {
  const limit = Math.min(Math.max(page.limit ?? 50, 1), 200);
  const { total } = await filtered(q, filter).select((eb) => eb.fn.countAll<number>().as("total")).executeTakeFirstOrThrow();
  const rows = await filtered(q, filter).select([...SUMMARY_COLUMNS]).orderBy("id").limit(limit).offset(page.offset ?? 0).execute();
  return { total: Number(total), items: rows.map(summarize) };
}

export async function getQueueItem(q: Db, id: number) {
  const row = await q.selectFrom("queue_items").innerJoin("submissions", "submissions.id", "queue_items.submission_id")
    .selectAll("queue_items").select(["submissions.received_at"]).where("queue_items.id", "=", id).executeTakeFirst();
  if (!row) throw new HttpError(404, `no queue item ${id}`);
  return row;
}

export async function queueSummary(q: Db) {
  const rows = await q.selectFrom("queue_items").select(["kind", "action", "top_strength", "has_blocking_issues"]).where("state", "=", "pending").execute();
  const count = (key: (r: (typeof rows)[number]) => string) =>
    rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [key(r)]: (acc[key(r)] ?? 0) + 1 }), {});
  const last = await q.selectFrom("submissions").select("received_at").orderBy("received_at", "desc").limit(1).executeTakeFirst();
  return {
    pending: rows.length,
    by_kind: count((r) => r.kind),
    by_action: count((r) => r.action),
    by_strength: count((r) => r.top_strength ?? "none"),
    with_blocking_issues: rows.filter((r) => r.has_blocking_issues).length,
    last_submission_at: last?.received_at.toISOString() ?? null,
  };
}
```

- [ ] **Step 4: Approve, reject, bulk**

`server/src/review/review.ts`:

```ts
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Status } from "../../../shared/constants";
import { formatAddressDisplay } from "../../../shared/normalize/address";
import { normalizeRecord } from "../../../shared/records/normalize-record";
import type { Issue, NormalizedRecord, WireRecord } from "../../../shared/records/types";
import { withActor } from "../db/actor";
import type { Db } from "../db/client";
import { HttpError } from "../errors";
import { validateRecord } from "../intake/submit";
import { suggestStatusChange, type StatusChange } from "../match/status";
import type { ProjectSuggestion } from "../match/suggest";
import { markChanged } from "../publish/state";
import { linkFiling } from "../store/edit";
import { loadFilingRecord, writeFiling } from "../store/filings";
import { createProjectRow, ProjectCreateInput, updateProjectRow } from "../store/projects";
import { resolveAliases } from "../store/shared-values";
import { filtered, listQueue, QueueFilterSchema, type QueueItemSummary } from "./queue";

export const ApproveOptionsSchema = z.strictObject({
  link_to: z.string().optional(),
  create_project: ProjectCreateInput.partial().required({ id: true }).optional(),
  overrides: z.record(z.string(), z.unknown()).optional(),
  accept_status_change: z.boolean().optional(),
  status_note: z.string().min(1).optional(),
  note: z.string().optional(),
});
export type ApproveOptions = z.input<typeof ApproveOptionsSchema>;
export interface ApproveResult { queue_item_id: number; filing_id: number; linked_project_id: string | null; status_change: StatusChange | null }

export async function approveItem(db: Db, reviewer: string, id: number, rawOpts: ApproveOptions = {}): Promise<ApproveResult> {
  const opts = ApproveOptionsSchema.parse(rawOpts);
  if (opts.link_to && opts.create_project) throw new HttpError(400, "use link_to or create_project, not both");
  return withActor(db, reviewer, `queue_item:${id}`, async (q) => {
    const item = await q.selectFrom("queue_items").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
    if (!item) throw new HttpError(404, `no queue item ${id}`);
    if (item.state !== "pending") throw new HttpError(409, `queue item ${id} is ${item.state}`);

    let record = item.proposed as NormalizedRecord;
    let issues = item.normalization_issues as Issue[];
    if (opts.overrides) {
      const sub = await q.selectFrom("submissions").select("body").where("id", "=", item.submission_id).executeTakeFirstOrThrow();
      const raw = (sub.body as { records: WireRecord[] }).records[item.record_index]!;
      const v = validateRecord({ ...raw, data: { ...raw.data, ...opts.overrides } });
      if (!v.ok) throw new HttpError(422, "overrides are not valid", v.errors);
      const n = normalizeRecord(v.record);
      record = await resolveAliases(q, n.record);
      issues = n.issues;
    }
    const blocking = issues.filter((i) => i.blocking);
    if (blocking.length) throw new HttpError(422, "fix these values with overrides before approving", blocking);

    const filingId = await writeFiling(q, record, { sourceHash: item.content_hash });
    let projectId: string | null = opts.link_to ?? null;
    let reason = "linked in review";

    if (opts.create_project) {
      const loaded = await loadFilingRecord(q, filingId);
      const point = loaded.point;
      const input = {
        status: "planning" as Status, program: "private" as const, confidence: "reported" as const, visibility: "draft" as const,
        status_note: `Added from ${record.kind.replace("_", " ")} ${record.source_key}`,
        address: loaded.addresses[0] ? formatAddressDisplay(loaded.addresses[0]) : undefined,
        lat: point?.lat, lng: point?.lon, sources: record.source_url ? [record.source_url] : undefined,
        ...opts.create_project,
      };
      if (input.lat === undefined || input.lng === undefined || !input.address || !input.sources) {
        throw new HttpError(422, "create_project needs address, lat, lng and sources the filing does not provide");
      }
      await createProjectRow(q, input as Parameters<typeof createProjectRow>[1]);
      projectId = input.id;
      reason = "project created from this filing";
    }

    let statusChange: StatusChange | null = null;
    if (projectId) {
      const s = ((item.suggestions as { projects?: ProjectSuggestion[] }).projects ?? []).find((p) => p.project_id === projectId);
      if (s) reason = `${s.strength}: ${s.reasons.join("; ")}`;
      await linkFiling(q, projectId, filingId, reviewer, reason);
      if (opts.accept_status_change) {
        const p = await q.selectFrom("projects").select("status").where("id", "=", projectId).executeTakeFirstOrThrow();
        statusChange = suggestStatusChange(p.status as Status, record);
        if (statusChange) await updateProjectRow(q, projectId, { status: statusChange.to, status_note: opts.status_note ?? statusChange.reason });
      }
    }

    await q.updateTable("queue_items").set({ state: "approved", reviewed_by: reviewer, reviewed_at: new Date(), review_note: opts.note ?? null }).where("id", "=", id).execute();
    await markChanged(q, { projectIds: projectId ? [projectId] : [], filingIds: [filingId] });
    return { queue_item_id: id, filing_id: filingId, linked_project_id: projectId, status_change: statusChange };
  });
}

export async function rejectItem(db: Db, reviewer: string, id: number, reason: string): Promise<void> {
  if (!reason.trim()) throw new HttpError(400, "a reason is required to reject");
  const r = await db.updateTable("queue_items").set({ state: "rejected", reviewed_by: reviewer, reviewed_at: new Date(), review_note: reason.trim() })
    .where("id", "=", id).where("state", "=", "pending").executeTakeFirst();
  if (Number(r.numUpdatedRows) !== 1) throw new HttpError(409, `queue item ${id} is not pending`);
}

export const BulkReviewSchema = z.strictObject({
  filter: QueueFilterSchema.omit({ state: true }).partial().default({}),
  action: z.enum(["approve", "reject"]),
  link_strong: z.boolean().default(false),
  reason: z.string().optional(),
  confirm: z.string().optional(),
});
export type BulkReviewRequest = z.input<typeof BulkReviewSchema>;
export type BulkPreview = { preview: true; count: number; sample: QueueItemSummary[]; confirm: string; expires_at: string };
export type BulkResult = { preview: false; approved: number; rejected: number; skipped: number; errors: { id: number; error: string }[] };

const CONFIRM_TTL_MS = 10 * 60 * 1000;

export async function bulkReview(db: Db, reviewer: string, raw: BulkReviewRequest): Promise<BulkPreview | BulkResult> {
  const req = BulkReviewSchema.parse(raw);
  if (req.action === "reject" && !req.reason?.trim()) throw new HttpError(400, "a reason is required to reject");

  if (!req.confirm) {
    const filter = { ...req.filter, state: "pending" as const, ...(req.action === "approve" ? { has_issues: false } : {}) };
    const ids = (await filtered(db, filter).select("id").orderBy("id").execute()).map((r) => r.id);
    const code = randomBytes(5).toString("hex");
    const expires = new Date(Date.now() + CONFIRM_TTL_MS);
    await db.insertInto("bulk_previews").values({
      code, action: req.action, filter: JSON.stringify(filter), item_ids: ids, link_strong: req.link_strong,
      reason: req.reason ?? null, created_by: reviewer, expires_at: expires,
    }).execute();
    const sample = (await listQueue(db, filter, { limit: 10 })).items;
    return { preview: true, count: ids.length, sample, confirm: code, expires_at: expires.toISOString() };
  }

  const preview = await db.deleteFrom("bulk_previews").where("code", "=", req.confirm).returningAll().executeTakeFirst();
  if (!preview || preview.created_by !== reviewer || preview.action !== req.action || preview.expires_at.getTime() < Date.now()) {
    throw new HttpError(400, "confirmation code is invalid or expired; run the preview again");
  }
  const result: BulkResult = { preview: false, approved: 0, rejected: 0, skipped: 0, errors: [] };
  for (const id of preview.item_ids) {
    try {
      const item = await db.selectFrom("queue_items").select(["state", "suggestions"]).where("id", "=", id).executeTakeFirstOrThrow();
      if (item.state !== "pending") { result.skipped++; continue; }
      if (preview.action === "reject") {
        await rejectItem(db, reviewer, id, preview.reason ?? "bulk reject");
        result.rejected++;
      } else {
        const strong = ((item.suggestions as { projects?: ProjectSuggestion[] }).projects ?? []).filter((s) => s.strength === "strong");
        await approveItem(db, reviewer, id, preview.link_strong && strong.length === 1 ? { link_to: strong[0]!.project_id } : {});
        result.approved++;
      }
    } catch (e) {
      result.errors.push({ id, error: (e as Error).message });
    }
  }
  return result;
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter server test tests/review.test.ts`
Expected: PASS. In `link_strong`, the ZBA record at Irving Park has no strong suggestion, so only the permit (strong via the linked zoning matter's ordinance) gets linked.

- [ ] **Step 6: Commit**

```bash
git add server/src/review server/tests/review.test.ts server/tests/helpers/app.ts
git commit -m "feat(server): review queue — approve with link/create/overrides, reject, bulk review

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Merge, history and revert

**Files:**
- Create: `server/src/store/merge.ts`, `server/src/store/history.ts`, `server/tests/merge-history.test.ts`

**Interfaces:**
- Consumes: Tasks 6, 8, 11, 12.
- Produces:
  - `mergeValues(q, type: "organization" | "address", fromId: number, intoId: number): Promise<{ affected_filings: number }>` (caller sets reason `merge:<type>:<from>-><into>`)
  - `HISTORY_TABLES`, `type HistoryTable`; `listHistory(q, table: HistoryTable, recordId: string)` → revision rows ordered by version
  - `REVERTIBLE = ["projects", "filings", "project_filings"] as const`, `type Revertible`; `revertTo(q, table: Revertible, recordId: string, version: number): Promise<void>`

- [ ] **Step 1: Write the failing tests**

`server/tests/merge-history.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { zbaRecord } from "../../shared/tests/fixtures";
import { withActor } from "../src/db/actor";
import { approveItem } from "../src/review/review";
import { linkFiling, unlinkFiling } from "../src/store/edit";
import { loadFilingRecord } from "../src/store/filings";
import { listHistory, revertTo } from "../src/store/history";
import { mergeValues } from "../src/store/merge";
import { createProjectRow, updateProjectRow } from "../src/store/projects";
import { makeApp, queueRecords } from "./helpers/app";

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => { ctx = await makeApp(); });
const approveAll = async (records: unknown[]) => {
  const ids = await queueRecords(ctx, records);
  const filings: number[] = [];
  for (const id of ids) filings.push((await approveItem(ctx.db, "drew", id!)).filing_id);
  return filings;
};
const orgId = async (key: string) => (await ctx.db.selectFrom("organizations").select("id").where("name_key", "=", key).executeTakeFirstOrThrow()).id;

describe("merge", () => {
  it("repoints filings to the surviving organization and records merge revisions", async () => {
    const [a, b] = await approveAll([zbaRecord(), zbaRecord({ case_no: "2-26-Z", applicant: "4645 N0RTH CLARK LLC" })]);
    const keep = await orgId("4645 NORTH CLARK LLC");
    const typo = await orgId("4645 N0RTH CLARK LLC");
    const r = await withActor(ctx.db, "drew", `merge:organization:${typo}->${keep}`, (q) => mergeValues(q, "organization", typo, keep));
    expect(r.affected_filings).toBe(1);
    const rec = await loadFilingRecord(ctx.db, b!);
    expect(rec.organizations.find((o) => o.role === "applicant")?.name_key).toBe("4645 NORTH CLARK LLC");
    expect((await ctx.db.selectFrom("organizations").select(["merged_into_id"]).where("id", "=", typo).executeTakeFirstOrThrow()).merged_into_id).toBe(keep);
    const ops = await ctx.db.selectFrom("revisions").select("op").where("reason", "like", "merge:%").execute();
    expect(ops.length).toBeGreaterThan(0);
    expect(new Set(ops.map((o) => o.op))).toEqual(new Set(["merge"]));
    expect(a).toBeDefined();
  });

  it("push with merged spelling is no_change", async () => {
    await approveAll([zbaRecord(), zbaRecord({ case_no: "2-26-Z", applicant: "4645 N0RTH CLARK LLC" })]);
    const keep = await orgId("4645 NORTH CLARK LLC");
    const typo = await orgId("4645 N0RTH CLARK LLC");
    await withActor(ctx.db, "drew", `merge:organization:${typo}->${keep}`, (q) => mergeValues(q, "organization", typo, keep));
    expect(await queueRecords(ctx, [zbaRecord({ case_no: "2-26-Z", applicant: "4645 N0RTH CLARK LLC" })])).toEqual([null]);
  });

  it("merges addresses and keeps resolving the old one", async () => {
    await approveAll([zbaRecord({ address: "3642 W Oakdale Ave" }), zbaRecord({ case_no: "2-26-Z", address: "3640-3650 W Oakdale Ave" })]);
    const rows = await ctx.db.selectFrom("addresses").select(["id", "number_from", "number_to"]).orderBy("id").execute();
    const from = rows.find((r) => r.number_to === 3642)!.id;
    const into = rows.find((r) => r.number_to === 3650)!.id;
    await withActor(ctx.db, "drew", `merge:address:${from}->${into}`, (q) => mergeValues(q, "address", from, into));
    expect(await queueRecords(ctx, [zbaRecord({ address: "3642 W Oakdale Ave" })])).toEqual([null]);
    const f = await ctx.db.selectFrom("filings").select("primary_address_id").where("source_key", "=", "420-24-S").executeTakeFirstOrThrow();
    expect(f.primary_address_id).toBe(into);
  });

  it("refuses to merge a row into itself", async () => {
    await approveAll([zbaRecord()]);
    const id = await orgId("4645 NORTH CLARK LLC");
    await expect(withActor(ctx.db, "drew", "merge:x", (q) => mergeValues(q, "organization", id, id))).rejects.toMatchObject({ status: 400 });
  });
});

describe("history and revert", () => {
  const project = { id: "p1", name: "First", address: "111 W Monroe St", program: "private" as const, status: "planning" as const,
    status_note: "n", lat: 41.880635, lng: -87.631098, sources: ["https://example.com/a"], visibility: "published" as const };

  it("lists versions and reverts a project field", async () => {
    await withActor(ctx.db, "drew", "admin_edit", (q) => createProjectRow(q, project));
    await withActor(ctx.db, "drew", "admin_edit", (q) => updateProjectRow(q, "p1", { name: "Second" }));
    const h = await listHistory(ctx.db, "projects", "p1");
    expect(h.map((r) => r.version)).toEqual([1, 2]);
    await withActor(ctx.db, "drew", "revert:projects:p1:1", (q) => revertTo(q, "projects", "p1", 1));
    expect((await ctx.db.selectFrom("projects").select("name").executeTakeFirstOrThrow()).name).toBe("First");
    expect((await listHistory(ctx.db, "projects", "p1")).at(-1)).toMatchObject({ version: 3, reason: "revert:projects:p1:1" });
  });

  it("revert restores a deleted link", async () => {
    const [f] = await approveAll([zbaRecord()]);
    await withActor(ctx.db, "drew", "admin_edit", async (q) => {
      await createProjectRow(q, project);
      await linkFiling(q, "p1", f!, "drew", "manual");
      await unlinkFiling(q, "p1", f!);
    });
    await withActor(ctx.db, "drew", "revert", (q) => revertTo(q, "project_filings", `p1:${f}`, 1));
    expect(await ctx.db.selectFrom("project_filings").select("reason").execute()).toEqual([{ reason: "manual" }]);
  });

  it("revert of a filing restores its columns and refreshes its hash", async () => {
    const [f] = await approveAll([zbaRecord()]);
    const before = (await ctx.db.selectFrom("filings").select("content_hash").executeTakeFirstOrThrow()).content_hash;
    await withActor(ctx.db, "drew", "admin_edit", (q) => q.updateTable("filings").set({ status: "Denied" }).where("id", "=", f!).execute());
    const v = (await listHistory(ctx.db, "filings", String(f))).find((r) => r.op === "insert")!.version;
    await withActor(ctx.db, "drew", "revert", (q) => revertTo(q, "filings", String(f), v));
    const row = await ctx.db.selectFrom("filings").select(["status", "content_hash"]).executeTakeFirstOrThrow();
    expect(row).toEqual({ status: "Approved", content_hash: before });
  });

  it("404s an unknown version", async () => {
    await expect(withActor(ctx.db, "drew", "revert", (q) => revertTo(q, "projects", "nope", 1))).rejects.toMatchObject({ status: 404 });
  });
});
```

Note on the filing revert test: `insert` is version 1 but the hash may be updated in the same transaction (version 2) — the test reverts to the `insert` version's `after`, whose `content_hash` column is ignored because `revertTo` recomputes it.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter server test tests/merge-history.test.ts`
Expected: FAIL — cannot resolve `../src/store/history`.

- [ ] **Step 3: Merge**

`server/src/store/merge.ts`:

```ts
import { sql } from "kysely";
import type { Db } from "../db/client";
import { HttpError } from "../errors";
import { refreshFilingHash } from "./filings";

export async function mergeValues(q: Db, type: "organization" | "address", fromId: number, intoId: number): Promise<{ affected_filings: number }> {
  if (fromId === intoId) throw new HttpError(400, "cannot merge a row into itself");
  const table = type === "organization" ? "organizations" : "addresses";
  const rows = await q.selectFrom(table).select(["id"]).where("id", "in", [fromId, intoId]).where("deleted_at", "is", null).execute();
  if (rows.length !== 2) throw new HttpError(404, `both ${table} rows must exist and not be deleted`);

  const affected = new Set<number>();
  if (type === "organization") {
    const links = await q.selectFrom("filing_organizations").selectAll().where("organization_id", "=", fromId).execute();
    for (const l of links) {
      affected.add(l.filing_id);
      const dup = await q.selectFrom("filing_organizations").select("filing_id")
        .where("filing_id", "=", l.filing_id).where("organization_id", "=", intoId).where("role", "=", l.role).executeTakeFirst();
      const row = q.deleteFrom("filing_organizations").where("filing_id", "=", l.filing_id).where("organization_id", "=", fromId).where("role", "=", l.role);
      if (dup) await row.execute();
      else await q.updateTable("filing_organizations").set({ organization_id: intoId })
        .where("filing_id", "=", l.filing_id).where("organization_id", "=", fromId).where("role", "=", l.role).execute();
    }
    await q.updateTable("organizations").set({ merged_into_id: intoId }).where("merged_into_id", "=", fromId).execute();
    await q.updateTable("organizations").set({ merged_into_id: intoId, deleted_at: new Date() }).where("id", "=", fromId).execute();
  } else {
    for (const l of await q.selectFrom("filing_addresses").selectAll().where("address_id", "=", fromId).execute()) {
      affected.add(l.filing_id);
      const dup = await q.selectFrom("filing_addresses").select("filing_id").where("filing_id", "=", l.filing_id).where("address_id", "=", intoId).executeTakeFirst();
      if (dup) await q.deleteFrom("filing_addresses").where("filing_id", "=", l.filing_id).where("address_id", "=", fromId).execute();
      else await q.updateTable("filing_addresses").set({ address_id: intoId }).where("filing_id", "=", l.filing_id).where("address_id", "=", fromId).execute();
    }
    for (const f of await q.selectFrom("filings").select("id").where("primary_address_id", "=", fromId).execute()) affected.add(f.id);
    await q.updateTable("filings").set({ primary_address_id: intoId }).where("primary_address_id", "=", fromId).execute();
    for (const l of await q.selectFrom("project_addresses").selectAll().where("address_id", "=", fromId).execute()) {
      const dup = await q.selectFrom("project_addresses").select("project_id").where("project_id", "=", l.project_id).where("address_id", "=", intoId).executeTakeFirst();
      if (dup) await q.deleteFrom("project_addresses").where("project_id", "=", l.project_id).where("address_id", "=", fromId).execute();
      else await q.updateTable("project_addresses").set({ address_id: intoId }).where("project_id", "=", l.project_id).where("address_id", "=", fromId).execute();
    }
    await sql`update addresses t set point = coalesce(t.point, f.point), zip = coalesce(t.zip, f.zip)
              from addresses f where t.id = ${intoId} and f.id = ${fromId}`.execute(q);
    await q.updateTable("addresses").set({ merged_into_id: intoId }).where("merged_into_id", "=", fromId).execute();
    await q.updateTable("addresses").set({ merged_into_id: intoId, deleted_at: new Date() }).where("id", "=", fromId).execute();
  }
  for (const filingId of affected) await refreshFilingHash(q, filingId);
  return { affected_filings: affected.size };
}
```

- [ ] **Step 4: History and revert**

`server/src/store/history.ts`:

```ts
import { sql } from "kysely";
import type { Db } from "../db/client";
import { HttpError } from "../errors";
import { refreshFilingHash } from "./filings";

export const HISTORY_TABLES = [
  "projects", "filings", "project_filings", "project_addresses", "organizations", "addresses", "parcels", "identifiers",
  "filing_addresses", "filing_parcels", "filing_identifiers", "filing_organizations",
] as const;
export type HistoryTable = (typeof HISTORY_TABLES)[number];
export const REVERTIBLE = ["projects", "filings", "project_filings"] as const;
export type Revertible = (typeof REVERTIBLE)[number];

const PROJECT_COLUMNS = ["dpd_map_no", "name", "developer", "units", "units_source_filing_id", "affordable_units", "tpc_usd", "program",
  "public_support", "status", "status_note", "flag", "confidence", "built_by_3f_url", "point", "sources", "notes", "visibility", "deleted_at"];
const FILING_COLUMNS = ["primary_address_id", "community_area", "ward", "units", "status", "event_date", "in_target", "flag", "notes",
  "source_url", "attributes", "field_sources", "last_source_hash", "deleted_at"];

export function listHistory(q: Db, table: HistoryTable, recordId: string) {
  return q.selectFrom("revisions").selectAll().where("table_name", "=", table).where("record_id", "=", recordId).orderBy("version").execute();
}

async function setFromJson(q: Db, table: "projects" | "filings", columns: string[], id: string, json: unknown) {
  const cols = sql.join(columns.map((c) => sql.ref(c)));
  const vals = sql.join(columns.map((c) => sql.ref(`r.${c}`)));
  const key = table === "filings" ? sql`${Number(id)}` : sql`${id}`;
  await sql`update ${sql.table(table)} set (${cols}) = (select ${vals} from jsonb_populate_record(null::${sql.table(table)}, ${JSON.stringify(json)}::jsonb) r)
            where id = ${key}`.execute(q);
}

/** Puts the record back to how it was right after `version`, as a new revision. */
export async function revertTo(q: Db, table: Revertible, recordId: string, version: number): Promise<void> {
  const rev = await q.selectFrom("revisions").select(["after"]).where("table_name", "=", table)
    .where("record_id", "=", recordId).where("version", "=", version).executeTakeFirst();
  if (!rev) throw new HttpError(404, `no version ${version} of ${table} ${recordId}`);
  const target = rev.after as Record<string, unknown> | null;
  if (table === "project_filings") {
    const [projectId, filingId] = recordId.split(":");
    if (!target) {
      await q.deleteFrom("project_filings").where("project_id", "=", projectId!).where("filing_id", "=", Number(filingId)).execute();
      return;
    }
    await q.insertInto("project_filings").values({
      project_id: projectId!, filing_id: Number(filingId), role: String(target.role), linked_by: String(target.linked_by), reason: String(target.reason),
    }).onConflict((oc) => oc.columns(["project_id", "filing_id"]).doUpdateSet({ role: String(target.role), reason: String(target.reason) })).execute();
    return;
  }
  if (!target) throw new HttpError(400, `${table} rows are never hard-deleted; pick a version with data`);
  if (table === "projects") await setFromJson(q, "projects", PROJECT_COLUMNS, recordId, target);
  else {
    await setFromJson(q, "filings", FILING_COLUMNS, recordId, target);
    await refreshFilingHash(q, Number(recordId));
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter server test tests/merge-history.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/store/merge.ts server/src/store/history.ts server/tests/merge-history.test.ts
git commit -m "feat(server): merge shared values, record history and revert

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Public read model and the site-build trigger

**Files:**
- Create: `server/src/time.ts`, `server/src/read/public.ts`, `server/src/publish/trigger.ts`, `server/tests/public.test.ts`

**Interfaces:**
- Consumes: `rowToAddress`, `formatAddressDisplay`, `toFeatureCollection` (`src/lib/geojson.ts`), `totals`, `countByStatus` (`src/lib/stats.ts`), `Project` type (`src/lib/schema.ts`).
- Produces:
  - `chicagoParts(d: Date): { date: string; minutes: number }` (America/Chicago calendar date and minutes since midnight)
  - `interface PublicFiling { kind: Kind; source_key: string; role: string; event_date: string | null; status: string | null; units: number | null; summary: string; source_url: string | null }`
  - `type PublishedProject = Project & { filings?: PublicFiling[]; visibility?: "draft" | "published" }`
  - `listProjects(q, opts?: { includeFilings?: boolean; includeDrafts?: boolean; ids?: string[] }): Promise<PublishedProject[]>`
  - `summarizeFiling(f: { kind: string; source_key: string; status: string | null; units: number | null; attributes: Record<string, unknown> }): string`
  - `getAsOf(q): Promise<string>` (`YYYY-MM-DD`, Chicago date of the last publish; `1970-01-01` before the first)
  - `projectStats(projects: Project[]): { count: number; units: number; tpcMusd: number; by_status: Record<Status, number> }`
  - `DEBOUNCE_MS = 600_000`; `triggerSiteBuild(config, fetchFn?): Promise<"sent" | "skipped">`; `runPublishTick(db, config, now?, trigger?): Promise<boolean>`; `publishNow(db, config, now?, trigger?): Promise<"sent" | "skipped">`

- [ ] **Step 1: Write the failing tests**

`server/tests/public.test.ts`:

```ts
import { sql } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toFeatureCollection } from "../../src/lib/geojson";
import { normalizeRecord } from "../../shared/records/normalize-record";
import { permitRecord, zoningRecord } from "../../shared/tests/fixtures";
import { withActor } from "../src/db/actor";
import { DEBOUNCE_MS, publishNow, runPublishTick, triggerSiteBuild } from "../src/publish/trigger";
import { getAsOf, listProjects, projectStats } from "../src/read/public";
import { linkFiling } from "../src/store/edit";
import { writeFiling } from "../src/store/filings";
import { createProjectRow } from "../src/store/projects";
import { chicagoParts } from "../src/time";
import { testConfig } from "./helpers/app";
import { getTestDb, resetDb } from "./helpers/db";

const db = getTestDb();
beforeEach(() => resetDb(db));
const base = { name: "Harris Bank building", address: "111 W. Monroe St", program: "lasalle" as const, status: "approved" as const,
  status_note: "Approved", confidence: "dpd" as const, lat: 41.880635, lng: -87.631098, sources: ["https://example.com/a"], tpc_musd: 179, units: 345 };

async function seed() {
  await withActor(db, "drew", "admin_edit", async (q) => {
    await createProjectRow(q, { ...base, id: "111-w-monroe", visibility: "published" });
    await createProjectRow(q, { ...base, id: "secret", visibility: "draft" });
    await createProjectRow(q, { ...base, id: "gone", visibility: "published" });
    await q.updateTable("projects").set({ deleted_at: new Date() }).where("id", "=", "gone").execute();
    const z = await writeFiling(q, normalizeRecord(zoningRecord()).record, { sourceHash: null });
    await writeFiling(q, normalizeRecord(permitRecord()).record, { sourceHash: null }); // not linked
    await linkFiling(q, "111-w-monroe", z, "drew", "manual");
  });
}

describe("listProjects", () => {
  it("returns only published, live projects in the site's Project shape", async () => {
    await seed();
    const projects = await listProjects(db);
    expect(projects.map((p) => p.id)).toEqual(["111-w-monroe"]);
    expect(projects[0]).toMatchObject({ address: "111 W. Monroe St", tpc_musd: 179, lat: 41.880635, lng: -87.631098, units: 345 });
    expect(projects[0]).not.toHaveProperty("filings");
  });

  it("includes drafts only when asked", async () => {
    await seed();
    expect((await listProjects(db, { includeDrafts: true })).map((p) => [p.id, p.visibility]).sort()).toEqual([["111-w-monroe", "published"], ["secret", "draft"]]);
  });

  it("attaches only linked, live filings with a summary and no private links", async () => {
    await seed();
    const [p] = await listProjects(db, { includeFilings: true });
    expect(p!.filings).toEqual([{
      kind: "zoning_matter", source_key: "O2026-0023894", role: "zoning", event_date: "2026-03-18",
      status: "In Committee - Referred", units: 345, summary: "Zoning DC-16 → PD, In Committee - Referred",
      source_url: "https://chicityclerkelms.chicago.gov/Matter/?matterId=example",
    }]);
    expect(JSON.stringify(p)).not.toContain("drive.google");
  });

  it("feeds the existing GeoJSON builder and stats", async () => {
    await seed();
    const projects = await listProjects(db);
    expect(toFeatureCollection(projects, "2026-10-02").features[0]!.properties.id).toBe("111-w-monroe");
    expect(projectStats(projects)).toMatchObject({ count: 1, units: 345, tpcMusd: 179, by_status: { approved: 1 } });
  });

  it("as_of is the Chicago date of the last publish", async () => {
    expect(await getAsOf(db)).toBe("1970-01-01");
    await sql`update site_state set last_published_at = '2026-10-02T03:00:00Z'`.execute(db);
    expect(await getAsOf(db)).toBe("2026-10-01");
  });
});

describe("publishing", () => {
  const changeAt = (iso: string) => sql`update site_state set dirty = true, last_change_at = ${iso}`.execute(db);

  it("waits 10 minutes after the last change, then triggers once", async () => {
    const trigger = vi.fn(async () => "sent" as const);
    await changeAt("2026-10-02T15:00:00Z");
    expect(await runPublishTick(db, testConfig, new Date("2026-10-02T15:05:00Z"), trigger)).toBe(false);
    expect(await runPublishTick(db, testConfig, new Date(Date.parse("2026-10-02T15:00:00Z") + DEBOUNCE_MS), trigger)).toBe(true);
    expect(await runPublishTick(db, testConfig, new Date("2026-10-02T15:30:00Z"), trigger)).toBe(false);
    expect(trigger).toHaveBeenCalledTimes(1);
    const s = await db.selectFrom("site_state").selectAll().executeTakeFirstOrThrow();
    expect(s.dirty).toBe(false);
    expect(s.last_published_at?.toISOString()).toBe("2026-10-02T15:00:00.000Z");
  });

  it("stays dirty when the trigger fails", async () => {
    await changeAt("2026-10-02T15:00:00Z");
    await expect(runPublishTick(db, testConfig, new Date("2026-10-02T16:00:00Z"), async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect((await db.selectFrom("site_state").select("dirty").executeTakeFirstOrThrow()).dirty).toBe(true);
  });

  it("publishNow triggers immediately", async () => {
    const trigger = vi.fn(async () => "sent" as const);
    expect(await publishNow(db, testConfig, new Date("2026-10-02T15:00:00Z"), trigger)).toBe("sent");
    expect(trigger).toHaveBeenCalledOnce();
  });

  it("triggerSiteBuild skips without a hook and POSTs with the token when configured", async () => {
    expect(await triggerSiteBuild(testConfig)).toBe("skipped");
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
    await triggerSiteBuild({ ...testConfig, SITE_BUILD_HOOK_URL: "https://hooks.example/build", SITE_BUILD_HOOK_TOKEN: "t" }, fetchFn as unknown as typeof fetch);
    expect(fetchFn).toHaveBeenCalledWith("https://hooks.example/build", { method: "POST", headers: { Authorization: "Bearer t" } });
  });
});

describe("chicagoParts", () => {
  it("uses Chicago local time across DST", () => {
    expect(chicagoParts(new Date("2026-10-02T14:30:00Z"))).toEqual({ date: "2026-10-02", minutes: 9 * 60 + 30 });
    expect(chicagoParts(new Date("2026-01-15T15:30:00Z"))).toEqual({ date: "2026-01-15", minutes: 9 * 60 + 30 });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter server test tests/public.test.ts`
Expected: FAIL — cannot resolve `../src/publish/trigger`.

- [ ] **Step 3: Implement**

`server/src/time.ts`:

```ts
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Calendar date (YYYY-MM-DD) and minutes since midnight in Chicago. */
export function chicagoParts(d: Date): { date: string; minutes: number } {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
```

`server/src/read/public.ts`:

```ts
import { sql } from "kysely";
import type { Status } from "../../../shared/constants";
import { formatAddressDisplay } from "../../../shared/normalize/address";
import type { Kind } from "../../../shared/records/types";
import type { Project } from "../../../src/lib/schema";
import { countByStatus, totals } from "../../../src/lib/stats";
import type { Db } from "../db/client";
import { rowToAddress } from "../store/shared-values";
import { chicagoParts } from "../time";

export interface PublicFiling {
  kind: Kind; source_key: string; role: string; event_date: string | null; status: string | null;
  units: number | null; summary: string; source_url: string | null;
}
export type PublishedProject = Project & { filings?: PublicFiling[]; visibility?: "draft" | "published" };

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function summarizeFiling(f: { kind: string; source_key: string; status: string | null; units: number | null; attributes: Record<string, unknown> }): string {
  const a = f.attributes;
  const status = f.status ? `, ${f.status}` : "";
  switch (f.kind) {
    case "permit":
      return `${a.classification === "early_signal" ? "Demolition permit (early signal)" : "Building permit"}${f.units ? `, ${f.units} units` : ""}${status}`;
    case "zoning_matter":
      return a.zoning_from || a.zoning_to
        ? `Zoning ${a.zoning_from ?? "?"} → ${a.zoning_to ?? "?"}${status}`
        : `Zoning matter ${f.source_key}${status}`;
    case "hearing_item":
      return `Plan Commission hearing${a.request ? `: ${truncate(String(a.request), 120)}` : ""}`;
    default:
      return `Zoning Board of Appeals ${a.request_type ? String(a.request_type).toLowerCase() : "case"} ${f.source_key}${f.status ? `: ${f.status}` : ""}`;
  }
}

export async function listProjects(q: Db, opts: { includeFilings?: boolean; includeDrafts?: boolean; ids?: string[] } = {}): Promise<PublishedProject[]> {
  const rows = await q.selectFrom("projects as p")
    .leftJoin("project_addresses as pa", (j) => j.onRef("pa.project_id", "=", "p.id").on("pa.is_primary", "=", true))
    .leftJoin("addresses as a", "a.id", "pa.address_id")
    .select([
      "p.id", "p.dpd_map_no", "p.name", "p.developer", "p.units", "p.affordable_units", "p.tpc_usd", "p.program", "p.public_support",
      "p.status", "p.status_note", "p.flag", "p.confidence", "p.built_by_3f_url", "p.sources", "p.notes", "p.visibility",
      sql<number>`ST_Y(p.point::geometry)`.as("lat"), sql<number>`ST_X(p.point::geometry)`.as("lng"),
      "a.number_from", "a.number_to", "a.predir", "a.street_name", "a.suffix", "a.zip",
    ])
    .where("p.deleted_at", "is", null)
    .$if(!opts.includeDrafts, (b) => b.where("p.visibility", "=", "published"))
    .$if(Boolean(opts.ids), (b) => b.where("p.id", "in", opts.ids!.length ? opts.ids! : ["-"]))
    .orderBy(sql`p.dpd_map_no nulls last`).orderBy("p.id")
    .execute();

  const projects: PublishedProject[] = rows.map((r) => ({
    id: r.id, dpd_map_no: r.dpd_map_no, name: r.name,
    address: r.street_name ? formatAddressDisplay(rowToAddress({ number_from: r.number_from!, number_to: r.number_to!, predir: r.predir, street_name: r.street_name, suffix: r.suffix, zip: r.zip })) : "",
    developer: r.developer, units: r.units, affordable_units: r.affordable_units,
    tpc_musd: r.tpc_usd == null ? null : r.tpc_usd / 1_000_000,
    program: r.program as Project["program"], public_support: r.public_support, status: r.status as Status, status_note: r.status_note,
    flag: r.flag, confidence: r.confidence as Project["confidence"], built_by_3f_url: r.built_by_3f_url,
    lat: r.lat, lng: r.lng, sources: r.sources, notes: r.notes,
    ...(opts.includeDrafts ? { visibility: r.visibility as "draft" | "published" } : {}),
  }));

  if (opts.includeFilings && projects.length) {
    const filings = await q.selectFrom("project_filings as pf").innerJoin("filings as f", "f.id", "pf.filing_id")
      .select(["pf.project_id", "pf.role", "f.kind", "f.source_key", "f.event_date", "f.status", "f.units", "f.source_url", "f.attributes"])
      .where("f.deleted_at", "is", null).where("pf.project_id", "in", projects.map((p) => p.id))
      .orderBy(sql`f.event_date desc nulls last`).orderBy("f.id", "desc").execute();
    for (const p of projects) {
      p.filings = filings.filter((f) => f.project_id === p.id).map((f) => ({
        kind: f.kind as Kind, source_key: f.source_key, role: f.role, event_date: f.event_date, status: f.status, units: f.units,
        summary: summarizeFiling({ ...f, attributes: f.attributes as Record<string, unknown> }), source_url: f.source_url,
      }));
    }
  }
  return projects;
}

export async function getAsOf(q: Db): Promise<string> {
  const s = await q.selectFrom("site_state").select("last_published_at").executeTakeFirst();
  return s?.last_published_at ? chicagoParts(s.last_published_at).date : "1970-01-01";
}

export function projectStats(projects: Project[]) {
  return { ...totals(projects), by_status: countByStatus(projects) };
}
```

`server/src/publish/trigger.ts`:

```ts
import { sql } from "kysely";
import type { Config } from "../config";
import type { Db } from "../db/client";

export const DEBOUNCE_MS = 10 * 60 * 1000;
type Trigger = (config: Config) => Promise<"sent" | "skipped">;

/** POSTs to the configured build hook (Workers Builds or a GitHub Action — chosen in stage 2). */
export async function triggerSiteBuild(config: Config, fetchFn: typeof fetch = fetch): Promise<"sent" | "skipped"> {
  if (!config.SITE_BUILD_HOOK_URL) {
    console.log(JSON.stringify({ t: new Date().toISOString(), level: "info", msg: "site build hook not configured; skipping" }));
    return "skipped";
  }
  const res = await fetchFn(config.SITE_BUILD_HOOK_URL, {
    method: "POST",
    headers: config.SITE_BUILD_HOOK_TOKEN ? { Authorization: `Bearer ${config.SITE_BUILD_HOOK_TOKEN}` } : {},
  });
  if (!res.ok) throw new Error(`site build hook returned HTTP ${res.status}`);
  return "sent";
}

/** Fires one build when the site has been dirty and quiet for DEBOUNCE_MS. Returns whether it fired. */
export async function runPublishTick(db: Db, config: Config, now = new Date(), trigger: Trigger = triggerSiteBuild): Promise<boolean> {
  const claimed = await db.updateTable("site_state")
    .set({ dirty: false, last_build_requested_at: now, last_published_at: sql`last_change_at` })
    .where("dirty", "=", true).where("last_change_at", "<=", new Date(now.getTime() - DEBOUNCE_MS))
    .returning("id").executeTakeFirst();
  if (!claimed) return false;
  try {
    await trigger(config);
  } catch (e) {
    await db.updateTable("site_state").set({ dirty: true }).execute();
    throw e;
  }
  return true;
}

export async function publishNow(db: Db, config: Config, now = new Date(), trigger: Trigger = triggerSiteBuild): Promise<"sent" | "skipped"> {
  await db.updateTable("site_state").set({ dirty: false, last_build_requested_at: now, last_published_at: now }).execute();
  return trigger(config);
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter server test tests/public.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/time.ts server/src/read server/src/publish/trigger.ts server/tests/public.test.ts
git commit -m "feat(server): public read model with filing timelines, debounced site-build trigger

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Ops facade, REST routes, filing search, request logging

**Files:**
- Create: `server/src/store/search.ts`, `server/src/ops.ts`, `server/src/http/logging.ts`, `server/src/http/routes/public.ts`, `server/src/http/routes/editor.ts`, `server/tests/http.test.ts`
- Modify: `server/src/http/app.ts` (logger, ops, route registration)

**Interfaces:**
- Consumes: everything from Tasks 7–14.
- Produces:
  - `FilingSearchSchema`, `searchFilings(q, s): Promise<FilingSummary[]>`, `getFiling(q, id)`; `FilingSummary = { id: number; kind: string; source_key: string; address: string | null; status: string | null; event_date: string | null; in_target: boolean; linked_projects: string[]; deleted: boolean }`
  - `createOps(deps: AppDeps): Ops` with the methods listed in Step 4 (used by REST and MCP)
  - `requestLogger(log?: (line: string) => void)`
  - `createApp(deps: AppDeps & { log?: (line: string) => void })`

- [ ] **Step 1: Write the failing tests**

`server/tests/http.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { permitRecord, zbaRecord } from "../../shared/tests/fixtures";
import { createApp } from "../src/http/app";
import { withActor } from "../src/db/actor";
import { createProjectRow } from "../src/store/projects";
import { makeApp, postJson, queueRecords, testConfig } from "./helpers/app";

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => { ctx = await makeApp(); });
const req = (method: string, path: string, token?: string, body?: unknown) =>
  ctx.app.request(path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const project = (id: string, visibility: "draft" | "published") => withActor(ctx.db, "drew", "admin_edit", (q) => createProjectRow(q, {
  id, name: id, address: "111 W Monroe St", program: "private", status: "planning", status_note: "n",
  lat: 41.880635, lng: -87.631098, sources: ["https://example.com/a"], visibility,
}));

const EDITOR_ROUTES: [string, string][] = [
  ["GET", "/v1/queue/summary"], ["GET", "/v1/queue"], ["GET", "/v1/queue/1"], ["POST", "/v1/queue/1/approve"],
  ["POST", "/v1/queue/1/reject"], ["POST", "/v1/queue/bulk"], ["GET", "/v1/filings"], ["GET", "/v1/filings/1"],
  ["GET", "/v1/filings/1/candidates"], ["PATCH", "/v1/filings/1"], ["DELETE", "/v1/filings/1"], ["POST", "/v1/filings/1/restore"],
  ["POST", "/v1/links"], ["DELETE", "/v1/links"], ["POST", "/v1/projects"], ["PATCH", "/v1/projects/x"], ["DELETE", "/v1/projects/x"],
  ["POST", "/v1/projects/x/restore"], ["POST", "/v1/merge"], ["GET", "/v1/history/projects/x"], ["POST", "/v1/history/projects/x/revert"],
  ["POST", "/v1/publish"],
];

describe("roles", () => {
  it.each(EDITOR_ROUTES)("%s %s: anonymous 401, submitter 403", async (method, path) => {
    expect((await req(method, path, undefined, {})).status).toBe(401);
    expect((await req(method, path, ctx.grok, {})).status).toBe(403);
  });
});

describe("public routes", () => {
  it("serve published projects with caching and CORS headers", async () => {
    await project("pub", "published");
    await project("draft", "draft");
    const r = await req("GET", "/v1/projects");
    expect(r.headers.get("cache-control")).toBe("public, max-age=300");
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    const body = (await r.json()) as { as_of: string; projects: { id: string }[] };
    expect(body.projects.map((p) => p.id)).toEqual(["pub"]);
  });

  it("include_drafts works only for editors and is never cached", async () => {
    await project("draft", "draft");
    expect(((await (await req("GET", "/v1/projects?include_drafts=true")).json()) as any).projects).toEqual([]);
    const r = await req("GET", "/v1/projects?include_drafts=true", ctx.drew);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(((await r.json()) as any).projects.map((p: any) => p.id)).toEqual(["draft"]);
    expect((await req("GET", "/v1/projects/draft")).status).toBe(404);
  });

  it("serves GeoJSON, stats and health", async () => {
    await project("pub", "published");
    const geo = (await (await req("GET", "/v1/projects.geojson")).json()) as any;
    expect(geo.type).toBe("FeatureCollection");
    expect(((await (await req("GET", "/v1/stats")).json()) as any).count).toBe(1);
    expect(await (await req("GET", "/healthz")).json()).toEqual({ ok: true });
  });
});

describe("editor flow over REST", () => {
  it("queue → approve with link → public project shows the filing", async () => {
    await project("pub", "published");
    const [id] = await queueRecords(ctx, [permitRecord()]);
    const list = (await (await req("GET", "/v1/queue?kind=permit", ctx.drew)).json()) as any;
    expect(list.total).toBe(1);
    expect((await req("POST", `/v1/queue/${id}/approve`, ctx.drew, { link_to: "pub" })).status).toBe(200);
    const p = (await (await req("GET", "/v1/projects/pub")).json()) as any;
    expect(p.filings.map((f: any) => f.source_key)).toEqual(["100912345"]);
  });

  it("validates bodies (400) and reports missing records (404)", async () => {
    expect((await req("PATCH", "/v1/projects/pub", ctx.drew, { units: "many" })).status).toBe(400);
    expect((await req("GET", "/v1/queue/999", ctx.drew)).status).toBe(404);
  });

  it("searches filings by address and identifier", async () => {
    const [id] = await queueRecords(ctx, [zbaRecord()]);
    await req("POST", `/v1/queue/${id}/approve`, ctx.drew, {});
    const byStreet = (await (await req("GET", "/v1/filings?q=3642%20W%20Oakdale", ctx.drew)).json()) as any[];
    expect(byStreet.map((f) => f.source_key)).toEqual(["420-24-S"]);
    const byKey = (await (await req("GET", "/v1/filings?q=420-24", ctx.drew)).json()) as any[];
    expect(byKey.map((f) => f.source_key)).toEqual(["420-24-S"]);
  });
});

describe("logging", () => {
  it("logs one line per request without tokens or bodies", async () => {
    const lines: string[] = [];
    const app = createApp({ db: ctx.db, config: testConfig, log: (l) => lines.push(l) });
    await postJson(app, "/v1/submissions", { secret: "body" }, ctx.grok, { "Idempotency-Key": "x" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(ctx.grok);
    expect(lines[0]).not.toContain("secret");
    expect(JSON.parse(lines[0]!)).toMatchObject({ method: "POST", path: "/v1/submissions", status: 400, sub: "grok" });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter server test tests/http.test.ts`
Expected: FAIL — routes return 404 / `log` option unknown.

- [ ] **Step 3: Filing search**

`server/src/store/search.ts`:

```ts
import { sql } from "kysely";
import { z } from "zod";
import { formatAddressDisplay, normalizeAddress } from "../../../shared/normalize/address";
import { orgNameKey } from "../../../shared/normalize/primitives";
import { KINDS } from "../../../shared/records/types";
import type { Db } from "../db/client";
import { HttpError } from "../errors";
import { loadFilingRecord } from "./filings";
import { rowToAddress } from "./shared-values";

export const FilingSearchSchema = z.strictObject({
  q: z.string().optional(),
  kind: z.enum(KINDS).optional(),
  in_target: z.boolean().optional(),
  linked: z.boolean().optional(),
  include_deleted: z.boolean().default(false),
  limit: z.number().int().min(1).max(200).default(50),
});
export type FilingSearch = z.input<typeof FilingSearchSchema>;
export interface FilingSummary {
  id: number; kind: string; source_key: string; address: string | null; status: string | null;
  event_date: string | null; in_target: boolean; linked_projects: string[]; deleted: boolean;
}

export async function searchFilings(q: Db, raw: FilingSearch): Promise<FilingSummary[]> {
  const s = FilingSearchSchema.parse(raw);
  const text = s.q?.trim();
  const asAddress = text ? normalizeAddress(text) : null;
  const rows = await q.selectFrom("filings as f").leftJoin("addresses as a", "a.id", "f.primary_address_id")
    .select(["f.id", "f.kind", "f.source_key", "f.status", "f.event_date", "f.in_target", "f.deleted_at",
      "a.number_from", "a.number_to", "a.predir", "a.street_name", "a.suffix", "a.zip",
      sql<string[]>`coalesce((select array_agg(pf.project_id order by pf.project_id) from project_filings pf where pf.filing_id = f.id), '{}')`.as("linked_projects")])
    .$if(!s.include_deleted, (b) => b.where("f.deleted_at", "is", null))
    .$if(s.kind !== undefined, (b) => b.where("f.kind", "=", s.kind!))
    .$if(s.in_target !== undefined, (b) => b.where("f.in_target", "=", s.in_target!))
    .$if(s.linked !== undefined, (b) => b.where(sql<boolean>`exists (select 1 from project_filings pf where pf.filing_id = f.id) = ${s.linked!}`))
    .$if(Boolean(text), (b) => b.where((eb) => {
      const like = `%${text!.toUpperCase()}%`;
      const ors = [
        eb(sql`upper(f.source_key)`, "like", like),
        eb.exists(eb.selectFrom("filing_identifiers as fi").innerJoin("identifiers as i", "i.id", "fi.identifier_id")
          .select("fi.filing_id").whereRef("fi.filing_id", "=", "f.id").where(sql`upper(i.value)`, "like", like)),
        eb.exists(eb.selectFrom("filing_organizations as fo").innerJoin("organizations as o", "o.id", "fo.organization_id")
          .select("fo.filing_id").whereRef("fo.filing_id", "=", "f.id").where("o.name_key", "like", `%${orgNameKey(text!) ?? text!.toUpperCase()}%`)),
      ];
      if (asAddress?.ok) {
        const a = asAddress.value;
        ors.push(eb.exists(eb.selectFrom("filing_addresses as fa").innerJoin("addresses as x", "x.id", "fa.address_id")
          .select("fa.filing_id").whereRef("fa.filing_id", "=", "f.id").where("x.street_name", "=", a.street_name)
          .where(sql<boolean>`x.predir is not distinct from ${a.predir}`)
          .where("x.number_from", "<=", a.number_to).where("x.number_to", ">=", a.number_from)));
      }
      return eb.or(ors);
    }))
    .orderBy(sql`f.event_date desc nulls last`).orderBy("f.id", "desc").limit(s.limit).execute();
  return rows.map((r) => ({
    id: r.id, kind: r.kind, source_key: r.source_key, status: r.status, event_date: r.event_date, in_target: r.in_target,
    address: r.street_name ? formatAddressDisplay(rowToAddress({ number_from: r.number_from!, number_to: r.number_to!, predir: r.predir, street_name: r.street_name, suffix: r.suffix, zip: r.zip })) : null,
    linked_projects: r.linked_projects, deleted: r.deleted_at !== null,
  }));
}

export async function getFiling(q: Db, id: number) {
  const row = await q.selectFrom("filings").select(["id", "deleted_at", "content_hash", "created_at", "updated_at"]).where("id", "=", id).executeTakeFirst();
  if (!row) throw new HttpError(404, `no filing ${id}`);
  const record = await loadFilingRecord(q, id);
  const projects = await q.selectFrom("project_filings").select(["project_id", "role", "reason", "linked_by", "linked_at"]).where("filing_id", "=", id).execute();
  return { ...row, addresses: record.addresses.map(formatAddressDisplay), record, projects };
}
```

- [ ] **Step 4: Ops facade**

`server/src/ops.ts`:

```ts
import type { Principal } from "./auth/tokens";
import { withActor } from "./db/actor";
import type { Db } from "./db/client";
import { HttpError } from "./errors";
import type { AppDeps } from "./http/app";
import { suggestProjects } from "./match/suggest";
import { markChanged, markDirty, trackPublic } from "./publish/state";
import { publishNow } from "./publish/trigger";
import { getAsOf, listProjects, projectStats } from "./read/public";
import { getQueueItem, listQueue, queueSummary, type QueueFilter } from "./review/queue";
import { approveItem, bulkReview, rejectItem, type ApproveOptions, type BulkReviewRequest } from "./review/review";
import { linkFiling, setFilingDeleted, unlinkFiling, updateFilingRecord } from "./store/edit";
import { loadFilingRecord } from "./store/filings";
import { listHistory, revertTo, type HistoryTable, type Revertible } from "./store/history";
import { mergeValues } from "./store/merge";
import { createProjectRow, setProjectDeleted, updateProjectRow, type ProjectCreate, type ProjectPatchInput } from "./store/projects";
import { getFiling, searchFilings, type FilingSearch } from "./store/search";
import { toFeatureCollection } from "../../src/lib/geojson";

export function createOps({ db, config }: AppDeps) {
  const edit = <T>(p: Principal, fn: (q: Db) => Promise<T>) => withActor(db, p.sub, "admin_edit", fn);
  return {
    // public
    listProjects: (opts: { includeFilings?: boolean; includeDrafts?: boolean } = {}) => listProjects(db, opts),
    getProject: async (id: string, includeDrafts = false) => {
      const [p] = await listProjects(db, { ids: [id], includeFilings: true, includeDrafts });
      if (!p) throw new HttpError(404, `no project ${id}`);
      return p;
    },
    stats: async () => projectStats(await listProjects(db)),
    geojson: async () => toFeatureCollection(await listProjects(db), await getAsOf(db)),
    asOf: () => getAsOf(db),
    // queue
    queueSummary: () => queueSummary(db),
    listQueue: (filter: Partial<QueueFilter>, page?: { limit?: number; offset?: number }) => listQueue(db, filter, page),
    getQueueItem: (id: number) => getQueueItem(db, id),
    approve: (p: Principal, id: number, opts?: ApproveOptions) => approveItem(db, p.sub, id, opts),
    reject: (p: Principal, id: number, reason: string) => rejectItem(db, p.sub, id, reason),
    bulkReview: (p: Principal, req: BulkReviewRequest) => bulkReview(db, p.sub, req),
    // records
    searchFilings: (s: FilingSearch) => searchFilings(db, s),
    getFiling: (id: number) => getFiling(db, id),
    matchCandidates: async (id: number) => suggestProjects(db, await loadFilingRecord(db, (await getFiling(db, id)).id)),
    link: (p: Principal, projectId: string, filingId: number) => edit(p, async (q) => {
      await linkFiling(q, projectId, filingId, p.sub, "linked by editor");
      await markChanged(q, { projectIds: [projectId] });
    }),
    unlink: (p: Principal, projectId: string, filingId: number) => edit(p, (q) =>
      trackPublic(q, { projectIds: [projectId] }, () => unlinkFiling(q, projectId, filingId))),
    createProject: (p: Principal, input: ProjectCreate) => edit(p, async (q) => {
      await createProjectRow(q, input);
      await markChanged(q, { projectIds: [input.id] });
      return { id: input.id };
    }),
    updateProject: (p: Principal, id: string, patch: ProjectPatchInput) => edit(p, (q) => trackPublic(q, { projectIds: [id] }, () => updateProjectRow(q, id, patch))),
    deleteProject: (p: Principal, id: string) => edit(p, (q) => trackPublic(q, { projectIds: [id] }, () => setProjectDeleted(q, id, true))),
    restoreProject: (p: Principal, id: string) => edit(p, (q) => trackPublic(q, { projectIds: [id] }, () => setProjectDeleted(q, id, false))),
    updateFiling: (p: Principal, id: number, patch: Record<string, unknown>) => edit(p, (q) => trackPublic(q, { filingIds: [id] }, () => updateFilingRecord(q, id, patch))),
    deleteFiling: (p: Principal, id: number) => edit(p, (q) => trackPublic(q, { filingIds: [id] }, () => setFilingDeleted(q, id, true))),
    restoreFiling: (p: Principal, id: number) => edit(p, (q) => trackPublic(q, { filingIds: [id] }, () => setFilingDeleted(q, id, false))),
    merge: (p: Principal, type: "organization" | "address", fromId: number, intoId: number) =>
      withActor(db, p.sub, `merge:${type}:${fromId}->${intoId}`, async (q) => {
        const r = await mergeValues(q, type, fromId, intoId);
        await markDirty(q);
        return r;
      }),
    history: (table: HistoryTable, recordId: string) => listHistory(db, table, recordId),
    revert: (p: Principal, table: Revertible, recordId: string, version: number) =>
      withActor(db, p.sub, `revert:${table}:${recordId}:${version}`, async (q) => {
        await revertTo(q, table, recordId, version);
        await markDirty(q);
      }),
    publishSite: () => publishNow(db, config),
  };
}
export type Ops = ReturnType<typeof createOps>;
```

- [ ] **Step 5: Logging and routes**

`server/src/http/logging.ts`:

```ts
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../auth/middleware";

/** One JSON line per request. Never logs headers, tokens, query strings or bodies. */
export function requestLogger(log: (line: string) => void = (l) => console.log(l)): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const start = performance.now();
    await next();
    log(JSON.stringify({
      t: new Date().toISOString(), method: c.req.method, path: c.req.path, status: c.res.status,
      ms: Math.round(performance.now() - start), sub: c.get("principal")?.sub ?? null,
    }));
  };
}
```

`server/src/http/routes/public.ts`:

```ts
import type { Context, Hono } from "hono";
import { cors } from "hono/cors";
import { sql } from "kysely";
import type { AppEnv } from "../../auth/middleware";
import type { Ops } from "../../ops";
import type { AppDeps } from "../app";

export function registerPublicRoutes(app: Hono<AppEnv>, deps: AppDeps, ops: Ops): void {
  const editorDrafts = (c: Context<AppEnv>) => c.get("principal")?.role === "editor" && c.req.query("include_drafts") === "true";
  const cache = (c: Context<AppEnv>, isPrivate: boolean) => c.header("Cache-Control", isPrivate ? "private, no-store" : "public, max-age=300");

  app.get("/healthz", async (c) => {
    await sql`select 1`.execute(deps.db);
    return c.json({ ok: true });
  });
  for (const path of ["/v1/projects", "/v1/projects/*", "/v1/projects.geojson", "/v1/stats", "/v1/schema/*"]) app.use(path, cors({ origin: "*" }));

  app.get("/v1/projects", async (c) => {
    const drafts = editorDrafts(c);
    const projects = await ops.listProjects({ includeFilings: c.req.query("include") === "filings", includeDrafts: drafts });
    cache(c, drafts);
    return c.json({ as_of: await ops.asOf(), projects });
  });
  app.get("/v1/projects.geojson", async (c) => {
    cache(c, false);
    return c.json(await ops.geojson());
  });
  app.get("/v1/projects/:id", async (c) => {
    const drafts = editorDrafts(c);
    const project = await ops.getProject(c.req.param("id"), drafts);
    cache(c, drafts);
    return c.json(project);
  });
  app.get("/v1/stats", async (c) => {
    cache(c, false);
    return c.json(await ops.stats());
  });
}
```

`server/src/http/routes/editor.ts`:

```ts
import type { Context, Hono } from "hono";
import { z } from "zod";
import { requireRole, type AppEnv } from "../../auth/middleware";
import { HttpError } from "../../errors";
import type { Ops } from "../../ops";
import { QueueFilterSchema } from "../../review/queue";
import { ApproveOptionsSchema, BulkReviewSchema } from "../../review/review";
import { HISTORY_TABLES, REVERTIBLE } from "../../store/history";
import { ProjectCreateInput, ProjectPatch } from "../../store/projects";
import { FilingSearchSchema } from "../../store/search";

async function body<S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try { raw = await c.req.json(); } catch { throw new HttpError(400, "request body must be JSON"); }
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(400, "invalid request body", r.error.issues);
  return r.data;
}

/** Query strings → typed values for a schema ("true"/"false" → boolean, digits → number). */
function query<S extends z.ZodType>(c: Context<AppEnv>, schema: S): z.infer<S> {
  const raw = Object.fromEntries(Object.entries(c.req.query()).map(([k, v]) =>
    [k, v === "true" ? true : v === "false" ? false : /^\d+$/.test(v) && k !== "q" ? Number(v) : v]));
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(400, "invalid query", r.error.issues);
  return r.data;
}

const id = (c: Context<AppEnv>) => {
  const n = Number(c.req.param("id"));
  if (!Number.isInteger(n)) throw new HttpError(400, "id must be a number");
  return n;
};
const LinkBody = z.strictObject({ project_id: z.string(), filing_id: z.number().int() });
const MergeBody = z.strictObject({ type: z.enum(["organization", "address"]), from_id: z.number().int(), into_id: z.number().int() });
const Page = z.object({ limit: z.number().int().optional(), offset: z.number().int().optional() });

export function registerEditorRoutes(app: Hono<AppEnv>, ops: Ops): void {
  const editor = requireRole("editor");
  const me = (c: Context<AppEnv>) => c.get("principal")!;

  app.get("/v1/queue/summary", editor, async (c) => c.json(await ops.queueSummary()));
  app.get("/v1/queue", editor, async (c) => {
    const q = query(c, QueueFilterSchema.partial().extend(Page.shape));
    const { limit, offset, ...filter } = q;
    return c.json(await ops.listQueue(filter, { limit, offset }));
  });
  app.post("/v1/queue/bulk", editor, async (c) => c.json(await ops.bulkReview(me(c), await body(c, BulkReviewSchema))));
  app.get("/v1/queue/:id", editor, async (c) => c.json(await ops.getQueueItem(id(c))));
  app.post("/v1/queue/:id/approve", editor, async (c) => c.json(await ops.approve(me(c), id(c), await body(c, ApproveOptionsSchema))));
  app.post("/v1/queue/:id/reject", editor, async (c) => {
    const { reason } = await body(c, z.strictObject({ reason: z.string() }));
    await ops.reject(me(c), id(c), reason);
    return c.json({ ok: true });
  });

  app.get("/v1/filings", editor, async (c) => c.json(await ops.searchFilings(query(c, FilingSearchSchema))));
  app.get("/v1/filings/:id", editor, async (c) => c.json(await ops.getFiling(id(c))));
  app.get("/v1/filings/:id/candidates", editor, async (c) => c.json(await ops.matchCandidates(id(c))));
  app.patch("/v1/filings/:id", editor, async (c) => {
    await ops.updateFiling(me(c), id(c), await body(c, z.record(z.string(), z.unknown())));
    return c.json(await ops.getFiling(id(c)));
  });
  app.delete("/v1/filings/:id", editor, async (c) => { await ops.deleteFiling(me(c), id(c)); return c.json({ ok: true }); });
  app.post("/v1/filings/:id/restore", editor, async (c) => { await ops.restoreFiling(me(c), id(c)); return c.json({ ok: true }); });

  app.post("/v1/links", editor, async (c) => { const b = await body(c, LinkBody); await ops.link(me(c), b.project_id, b.filing_id); return c.json({ ok: true }); });
  app.delete("/v1/links", editor, async (c) => { const b = await body(c, LinkBody); await ops.unlink(me(c), b.project_id, b.filing_id); return c.json({ ok: true }); });

  app.post("/v1/projects", editor, async (c) => c.json(await ops.createProject(me(c), await body(c, ProjectCreateInput)), 201));
  app.patch("/v1/projects/:id", editor, async (c) => {
    await ops.updateProject(me(c), c.req.param("id"), await body(c, ProjectPatch));
    return c.json(await ops.getProject(c.req.param("id"), true));
  });
  app.delete("/v1/projects/:id", editor, async (c) => { await ops.deleteProject(me(c), c.req.param("id")); return c.json({ ok: true }); });
  app.post("/v1/projects/:id/restore", editor, async (c) => { await ops.restoreProject(me(c), c.req.param("id")); return c.json({ ok: true }); });

  app.post("/v1/merge", editor, async (c) => { const b = await body(c, MergeBody); return c.json(await ops.merge(me(c), b.type, b.from_id, b.into_id)); });
  app.get("/v1/history/:table/:id", editor, async (c) => {
    const table = z.enum(HISTORY_TABLES).safeParse(c.req.param("table"));
    if (!table.success) throw new HttpError(400, `table must be one of ${HISTORY_TABLES.join(", ")}`);
    return c.json(await ops.history(table.data, c.req.param("id")));
  });
  app.post("/v1/history/:table/:id/revert", editor, async (c) => {
    const table = z.enum(REVERTIBLE).safeParse(c.req.param("table"));
    if (!table.success) throw new HttpError(400, `only ${REVERTIBLE.join(", ")} can be reverted`);
    const { version } = await body(c, z.strictObject({ version: z.number().int().min(1) }));
    await ops.revert(me(c), table.data, c.req.param("id"), version);
    return c.json({ ok: true });
  });
  app.post("/v1/publish", editor, async (c) => c.json({ result: await ops.publishSite() }));
}
```

Update `server/src/http/app.ts` — full file:

```ts
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { authenticate, type AppEnv } from "../auth/middleware";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { HttpError } from "../errors";
import { createOps } from "../ops";
import { requestLogger } from "./logging";
import { registerEditorRoutes } from "./routes/editor";
import { registerPublicRoutes } from "./routes/public";
import { registerSubmissionRoutes } from "./routes/submissions";

export interface AppDeps { db: Db; config: Config }

export function createApp(deps: AppDeps & { log?: (line: string) => void }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const ops = createOps(deps);
  app.use("*", requestLogger(deps.log));
  app.use("*", authenticate(deps));
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: err.message, ...(err.details === undefined ? {} : { details: err.details }) }, err.status as ContentfulStatusCode);
    }
    console.error(JSON.stringify({ t: new Date().toISOString(), level: "error", path: c.req.path, message: (err as Error).message }));
    return c.json({ error: "internal error" }, 500);
  });
  app.notFound((c) => c.json({ error: "not found" }, 404));
  registerPublicRoutes(app, deps, ops);
  registerSubmissionRoutes(app, deps);
  registerEditorRoutes(app, ops);
  return app;
}
```

In tests that construct the app through `makeApp`, keep logs quiet: change `makeApp` to `createApp({ db, config: testConfig, log: () => {} })`.

- [ ] **Step 6: Run the whole server suite**

Run: `pnpm --filter server test && pnpm --filter server typecheck`
Expected: all PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add server/src server/tests
git commit -m "feat(server): REST API — public reads, editor routes, filing search, request logging

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 16: MCP server

**Files:**
- Create: `server/src/mcp/tools.ts`, `server/src/mcp/server.ts`, `server/tests/mcp.test.ts`
- Modify: `server/src/http/app.ts` (route `/mcp`)

**Interfaces:**
- Consumes: `Ops` (Task 15) and the Zod schemas it uses; `Principal`.
- Produces:
  - `interface ToolDef { name: string; description: string; tier: "public" | "editor"; input: z.ZodObject; run: (ops: Ops, p: Principal | null, args: any) => Promise<unknown> }`, `TOOLS: ToolDef[]`
  - `buildMcpServer(ops: Ops, principal: Principal | null): McpServer`
  - `handleMcpRequest(req: Request, ops: Ops, principal: Principal | null): Promise<Response>`

- [ ] **Step 1: Write the failing tests**

`server/tests/mcp.test.ts`:

```ts
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { permitRecord } from "../../shared/tests/fixtures";
import { TOOLS } from "../src/mcp/tools";
import { withActor } from "../src/db/actor";
import { createProjectRow } from "../src/store/projects";
import { makeApp, queueRecords } from "./helpers/app";

let ctx: Awaited<ReturnType<typeof makeApp>>;
let server: ServerType;
let base: string;

beforeEach(async () => {
  ctx = await makeApp();
  server = serve({ fetch: ctx.app.fetch, port: 0, hostname: "127.0.0.1" });
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise<void>((r) => server.close(() => r())));

async function client(token?: string) {
  const c = new Client({ name: "test", version: "1.0.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  }));
  return c;
}
const text = (r: Awaited<ReturnType<Client["callTool"]>>) => JSON.parse((r.content as { text: string }[])[0]!.text);

describe("MCP", () => {
  it("anonymous and submitter clients see only the public tools", async () => {
    for (const token of [undefined, ctx.grok]) {
      const names = (await (await client(token)).listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(["get_project", "pipeline_stats", "search_projects"]);
    }
  });

  it("editors see every tool", async () => {
    const names = (await (await client(ctx.drew)).listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(TOOLS.map((t) => t.name).sort());
  });

  it("reviews a queue item end to end", async () => {
    await withActor(ctx.db, "drew", "admin_edit", (q) => createProjectRow(q, {
      id: "pub", name: "Pub", address: "111 W Monroe St", program: "private", status: "approved", status_note: "n",
      lat: 41.880635, lng: -87.631098, sources: ["https://example.com/a"], visibility: "published",
    }));
    await queueRecords(ctx, [permitRecord()]);
    const editor = await client(ctx.drew);
    const queue = text(await editor.callTool({ name: "list_queue", arguments: { kind: "permit" } }));
    expect(queue.total).toBe(1);
    const approved = text(await editor.callTool({ name: "approve", arguments: { id: queue.items[0].id, link_to: "pub", accept_status_change: true } }));
    expect(approved).toMatchObject({ linked_project_id: "pub", status_change: { to: "permitted" } });
    const pub = await client();
    const project = text(await pub.callTool({ name: "get_project", arguments: { id: "pub" } }));
    expect(project.status).toBe("permitted");
    expect(project.filings[0].source_key).toBe("100912345");
  });

  it("returns tool errors as isError results", async () => {
    const r = await (await client(ctx.drew)).callTool({ name: "approve", arguments: { id: 999 } });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0]!.text).toContain("no queue item 999");
  });

  it("rejects invalid tokens and non-POST requests", async () => {
    await expect(client("not-a-token")).rejects.toThrow();
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter server test tests/mcp.test.ts`
Expected: FAIL — cannot resolve `../src/mcp/tools`.

- [ ] **Step 3: Tools**

`server/src/mcp/tools.ts`:

```ts
import { z } from "zod";
import { STATUSES } from "../../../shared/constants";
import type { Principal } from "../auth/tokens";
import type { Ops } from "../ops";
import { QueueFilterSchema } from "../review/queue";
import { ApproveOptionsSchema, BulkReviewSchema } from "../review/review";
import { HISTORY_TABLES, REVERTIBLE } from "../store/history";
import { ProjectCreateInput, ProjectPatch } from "../store/projects";
import { FilingSearchSchema } from "../store/search";

export interface ToolDef {
  name: string;
  description: string;
  tier: "public" | "editor";
  input: z.ZodObject;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (ops: Ops, p: Principal | null, args: any) => Promise<unknown>;
}

const isEditor = (p: Principal | null) => p?.role === "editor";
const me = (p: Principal | null) => p!; // editor tools are only registered for editors
const Id = z.object({ id: z.number().int().describe("numeric id") });
const ProjectId = z.object({ id: z.string().describe("project slug, e.g. 111-w-monroe") });
const Link = z.object({ project_id: z.string(), filing_id: z.number().int() });

export const TOOLS: ToolDef[] = [
  {
    name: "search_projects", tier: "public",
    description: "List Chicago office-to-residential conversion projects on chicagopipeline.com. Optional text matches id, name, address or developer; optional status filter.",
    input: z.object({ query: z.string().optional(), status: z.enum(STATUSES).optional(), include_drafts: z.boolean().optional().describe("editors only") }),
    run: async (ops, p, a) => {
      const q = a.query?.toLowerCase();
      return (await ops.listProjects({ includeDrafts: isEditor(p) && a.include_drafts === true }))
        .filter((x) => (!a.status || x.status === a.status) && (!q || [x.id, x.name, x.address, x.developer].some((v) => v?.toLowerCase().includes(q))))
        .map((x) => ({ id: x.id, name: x.name, address: x.address, status: x.status, units: x.units, developer: x.developer, tpc_musd: x.tpc_musd }));
    },
  },
  {
    name: "get_project", tier: "public",
    description: "One project with every field and its linked permits, rezonings and hearings (newest first) with official source links.",
    input: ProjectId, run: (ops, p, a) => ops.getProject(a.id, isEditor(p)),
  },
  {
    name: "pipeline_stats", tier: "public", description: "Totals for the published pipeline: project count, units, total project cost ($M) and counts by stage.",
    input: z.object({}), run: (ops) => ops.stats(),
  },
  { name: "queue_summary", tier: "editor", description: "Pending review queue counts by kind, action, match strength and blocking issues; time of Grok's last submission.", input: z.object({}), run: (ops) => ops.queueSummary() },
  {
    name: "list_queue", tier: "editor",
    description: "List queue items (default: pending) with filters. strength = top project suggestion (strong/likely/possible/none); has_issues = values that must be fixed before approval.",
    input: QueueFilterSchema.partial().extend({ limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).optional() }),
    run: (ops, _p, { limit, offset, ...filter }) => ops.listQueue(filter, { limit, offset }),
  },
  { name: "get_queue_item", tier: "editor", description: "Full queue item: normalized proposal, field-by-field diff, normalization issues, project suggestions with reasons, possible duplicate names/addresses.", input: Id, run: (ops, _p, a) => ops.getQueueItem(a.id) },
  {
    name: "approve", tier: "editor",
    description: "Approve a pending item. Optional: link_to a project id, or create_project (draft) from it; overrides = corrected values in Grok's field names; accept_status_change applies the suggested stage move.",
    input: ApproveOptionsSchema.extend({ id: z.number().int() }),
    run: (ops, p, { id, ...opts }) => ops.approve(me(p), id, opts),
  },
  { name: "reject", tier: "editor", description: "Reject a pending item with a reason. Identical data from Grok will not come back.", input: Id.extend({ reason: z.string() }), run: async (ops, p, a) => { await ops.reject(me(p), a.id, a.reason); return { ok: true }; } },
  {
    name: "bulk_review", tier: "editor",
    description: "Approve or reject many pending items. First call without confirm returns a count, a sample and a confirm code (valid 10 minutes); call again with the same arguments plus confirm to execute. link_strong links items that have exactly one strong project match.",
    input: BulkReviewSchema, run: (ops, p, a) => ops.bulkReview(me(p), a),
  },
  { name: "search_filings", tier: "editor", description: "Search accepted filings by text (address, case/record/permit number, organization name), kind, target area, linked or not.", input: FilingSearchSchema, run: (ops, _p, a) => ops.searchFilings(a) },
  { name: "get_filing", tier: "editor", description: "One accepted filing with all canonical values and its project links.", input: Id, run: (ops, _p, a) => ops.getFiling(a.id) },
  { name: "match_candidates", tier: "editor", description: "Projects this filing may belong to, with strength and reasons.", input: z.object({ filing_id: z.number().int() }), run: (ops, _p, a) => ops.matchCandidates(a.filing_id) },
  { name: "link", tier: "editor", description: "Link a filing to a project.", input: Link, run: async (ops, p, a) => { await ops.link(me(p), a.project_id, a.filing_id); return { ok: true }; } },
  { name: "unlink", tier: "editor", description: "Remove a filing's link to a project.", input: Link, run: async (ops, p, a) => { await ops.unlink(me(p), a.project_id, a.filing_id); return { ok: true }; } },
  { name: "create_project", tier: "editor", description: "Create a project (draft unless visibility is published). Same fields as the public project, address validated against the city street list.", input: ProjectCreateInput, run: (ops, p, a) => ops.createProject(me(p), a) },
  { name: "update_project", tier: "editor", description: "Change project fields; only the fields given change.", input: ProjectId.extend({ patch: ProjectPatch }), run: async (ops, p, a) => { await ops.updateProject(me(p), a.id, a.patch); return ops.getProject(a.id, true); } },
  { name: "update_filing", tier: "editor", description: "Correct an accepted filing using Grok's field names (re-validated and normalized).", input: Id.extend({ patch: z.record(z.string(), z.unknown()) }), run: async (ops, p, a) => { await ops.updateFiling(me(p), a.id, a.patch); return ops.getFiling(a.id); } },
  { name: "delete_project", tier: "editor", description: "Soft-delete a project (hidden everywhere, restorable).", input: ProjectId, run: async (ops, p, a) => { await ops.deleteProject(me(p), a.id); return { ok: true }; } },
  { name: "restore_project", tier: "editor", description: "Restore a soft-deleted project.", input: ProjectId, run: async (ops, p, a) => { await ops.restoreProject(me(p), a.id); return { ok: true }; } },
  { name: "delete_filing", tier: "editor", description: "Soft-delete a filing (restorable).", input: Id, run: async (ops, p, a) => { await ops.deleteFiling(me(p), a.id); return { ok: true }; } },
  { name: "restore_filing", tier: "editor", description: "Restore a soft-deleted filing.", input: Id, run: async (ops, p, a) => { await ops.restoreFiling(me(p), a.id); return { ok: true }; } },
  {
    name: "merge", tier: "editor", description: "Merge two spellings of the same organization or address: every reference moves to into_id; future data in the old spelling resolves to it.",
    input: z.object({ type: z.enum(["organization", "address"]), from_id: z.number().int(), into_id: z.number().int() }),
    run: (ops, p, a) => ops.merge(me(p), a.type, a.from_id, a.into_id),
  },
  { name: "history", tier: "editor", description: "Every version of a record with who changed it and why. record_id: project slug, filing id, or 'project_id:filing_id' for links.", input: z.object({ table: z.enum(HISTORY_TABLES), record_id: z.string() }), run: (ops, _p, a) => ops.history(a.table, a.record_id) },
  { name: "revert", tier: "editor", description: "Put a project, filing or link back to how it was right after a version (recorded as a new version).", input: z.object({ table: z.enum(REVERTIBLE), record_id: z.string(), version: z.number().int().min(1) }), run: async (ops, p, a) => { await ops.revert(me(p), a.table, a.record_id, a.version); return { ok: true }; } },
  { name: "publish_site", tier: "editor", description: "Rebuild chicagopipeline.com now instead of waiting for the 10-minute quiet period.", input: z.object({}), run: async (ops) => ({ result: await ops.publishSite() }) },
];
```

- [ ] **Step 4: Server and route**

`server/src/mcp/server.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Principal } from "../auth/tokens";
import { HttpError } from "../errors";
import type { Ops } from "../ops";
import { TOOLS } from "./tools";

export function buildMcpServer(ops: Ops, principal: Principal | null): McpServer {
  const server = new McpServer({ name: "chicago-pipeline", version: "1.0.0" });
  for (const tool of TOOLS) {
    if (tool.tier === "editor" && principal?.role !== "editor") continue;
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.input }, async (args: unknown) => {
      try {
        const result = await tool.run(ops, principal, args);
        return { content: [{ type: "text" as const, text: JSON.stringify(result ?? { ok: true }, null, 2) }] };
      } catch (e) {
        const message = e instanceof HttpError
          ? `${e.message}${e.details === undefined ? "" : `\n${JSON.stringify(e.details, null, 2)}`}`
          : "internal error";
        if (!(e instanceof HttpError)) console.error(JSON.stringify({ level: "error", tool: tool.name, message: (e as Error).message }));
        return { isError: true, content: [{ type: "text" as const, text: message }] };
      }
    });
  }
  return server;
}

/** Stateless streamable HTTP: a fresh server per POST, JSON responses. */
export async function handleMcpRequest(req: Request, ops: Ops, principal: Principal | null): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }, { status: 405 });
  }
  const server = buildMcpServer(ops, principal);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}
```

If `registerTool`'s generic typing rejects `tool.input` (a heterogeneous `z.ZodObject`), cast only the callback: `(async (args: unknown) => { … }) as Parameters<McpServer["registerTool"]>[2]` and ledger a `Ruling:` — do not loosen the tool schemas.

In `server/src/http/app.ts`, after `registerEditorRoutes(app, ops);` add:

```ts
  app.all("/mcp", (c) => handleMcpRequest(c.req.raw, ops, c.get("principal")));
```

with `import { handleMcpRequest } from "../mcp/server";`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter server test tests/mcp.test.ts && pnpm --filter server typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add server/src/mcp server/src/http/app.ts server/tests/mcp.test.ts
git commit -m "feat(server): MCP server with public and editor tools over streamable HTTP

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: Import `data/projects.csv`

**Files:**
- Create: `server/src/importers/projects-csv.ts`, `server/src/cli/import-csv.ts`, `server/tests/import.test.ts`

**Interfaces:**
- Consumes: `parseProjectsCsv` (`src/lib/parse-projects.ts`), `createProjectRow` (Task 11), `normalizeAddress`, `formatAddressDisplay` (Task 4), `listProjects`, `projectStats` (Task 14), `DATA_AS_OF` (`src/lib/data-meta.ts`).
- Produces: `importProjectsCsv(db: Db, csvText: string, asOf: string): Promise<{ imported: number; addressChanges: { id: string; from: string; to: string }[] }>`

- [ ] **Step 1: Write the failing test**

`server/tests/import.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { DATA_AS_OF } from "../../src/lib/data-meta";
import { parseProjectsCsv } from "../../src/lib/parse-projects";
import { importProjectsCsv } from "../src/importers/projects-csv";
import { getAsOf, listProjects, projectStats } from "../src/read/public";
import { getTestDb, resetDb } from "./helpers/db";

const db = getTestDb();
beforeEach(() => resetDb(db));
const csv = readFileSync(new URL("../../data/projects.csv", import.meta.url), "utf8");

describe("importProjectsCsv", () => {
  it("round-trips every project and field (address via the canonical form)", async () => {
    const result = await importProjectsCsv(db, csv, DATA_AS_OF);
    expect(result.imported).toBe(29);
    expect(result.addressChanges).toEqual([{ id: "620-n-lasalle", from: "620 N. LaSalle St", to: "620 N. LaSalle Dr" }]);

    const expected = parseProjectsCsv(csv).projects;
    const actual = new Map((await listProjects(db)).map((p) => [p.id, p]));
    expect(actual.size).toBe(29);
    for (const p of expected) {
      const change = result.addressChanges.find((c) => c.id === p.id);
      expect(actual.get(p.id)).toEqual({ ...p, address: change ? change.to : p.address });
    }
  });

  it("reproduces today's totals and as-of date", async () => {
    await importProjectsCsv(db, csv, DATA_AS_OF);
    const projects = await listProjects(db);
    expect(projectStats(projects)).toMatchObject({ count: 29, units: 4321, tpcMusd: 1839.8 });
    expect(projectStats(projects.filter((p) => p.confidence === "dpd"))).toMatchObject({ count: 25, units: 3935, tpcMusd: 1799.8 });
    expect(await getAsOf(db)).toBe(DATA_AS_OF);
  });

  it("refuses to import twice and imports nothing when any row fails", async () => {
    await importProjectsCsv(db, csv, DATA_AS_OF);
    await expect(importProjectsCsv(db, csv, DATA_AS_OF)).rejects.toThrow(/already/);
    await resetDb(db);
    const bad = csv.replace("111 W. Monroe St", "111 Gotham Blvd");
    await expect(importProjectsCsv(db, bad, DATA_AS_OF)).rejects.toThrow(/111-w-monroe/);
    expect((await db.selectFrom("projects").select("id").execute()).length).toBe(0);
  });

  it("records the import in history", async () => {
    await importProjectsCsv(db, csv, DATA_AS_OF);
    const r = await db.selectFrom("revisions").select(["actor", "reason"]).where("table_name", "=", "projects").distinct().execute();
    expect(r).toEqual([{ actor: "import", reason: "import:data/projects.csv" }]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter server test tests/import.test.ts`
Expected: FAIL — cannot resolve `../src/importers/projects-csv`.

- [ ] **Step 3: Implement**

`server/src/importers/projects-csv.ts`:

```ts
import { sql } from "kysely";
import { formatAddressDisplay, normalizeAddress } from "../../../shared/normalize/address";
import { parseProjectsCsv } from "../../../src/lib/parse-projects";
import { withActor } from "../db/actor";
import type { Db } from "../db/client";
import { createProjectRow } from "../store/projects";

/** One-time import of the curated CSV as published projects. All-or-nothing. */
export async function importProjectsCsv(db: Db, csvText: string, asOf: string) {
  const { projects, errors } = parseProjectsCsv(csvText);
  if (errors.length) throw new Error(`data/projects.csv has errors:\n${errors.join("\n")}`);

  const addressChanges: { id: string; from: string; to: string }[] = [];
  const problems: string[] = [];
  for (const p of projects) {
    const a = normalizeAddress(p.address);
    if (!a.ok) { problems.push(`${p.id}: ${a.message}`); continue; }
    const display = formatAddressDisplay(a.value);
    if (display !== p.address) addressChanges.push({ id: p.id, from: p.address, to: display });
  }
  if (problems.length) throw new Error(`addresses that could not be normalized:\n${problems.join("\n")}`);

  await withActor(db, "import", "import:data/projects.csv", async (q) => {
    const existing = await q.selectFrom("projects").select("id").limit(1).executeTakeFirst();
    if (existing) throw new Error("projects are already imported; edit them through the API instead");
    for (const p of projects) await createProjectRow(q, { ...p, visibility: "published" });
    await sql`update site_state set last_published_at = ${`${asOf}T12:00:00-05:00`}::timestamptz`.execute(q);
  });
  return { imported: projects.length, addressChanges };
}
```

`server/src/cli/import-csv.ts`:

```ts
// Usage: import-csv <path to projects.csv>   (in the container: node dist/import-csv.js data/projects.csv)
import { readFileSync } from "node:fs";
import { DATA_AS_OF } from "../../../src/lib/data-meta";
import { loadConfig } from "../config";
import { createDb } from "../db/client";
import { importProjectsCsv } from "../importers/projects-csv";

const path = process.argv[2];
if (!path) throw new Error("usage: import-csv <path to projects.csv>");
const db = createDb(loadConfig().DATABASE_URL);
try {
  const r = await importProjectsCsv(db, readFileSync(path, "utf8"), DATA_AS_OF);
  console.log(`imported ${r.imported} projects (as of ${DATA_AS_OF})`);
  for (const c of r.addressChanges) console.log(`  address shown differently: ${c.id}: "${c.from}" → "${c.to}"`);
} finally {
  await db.destroy();
}
```

Add `"../src/lib/data-meta.ts"` to the `include` list in `server/tsconfig.json`.

- [ ] **Step 4: Run the test**

Run: `pnpm --filter server test tests/import.test.ts`
Expected: PASS. If `addressChanges` lists more than 620 N. LaSalle, stop and show Drew — those are public address changes.

- [ ] **Step 5: Commit**

```bash
git add server/src/importers server/src/cli/import-csv.ts server/tests/import.test.ts server/tsconfig.json
git commit -m "feat(server): one-time import of data/projects.csv with round-trip test

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: Jobs, entry point and the production Docker stack

**Files:**
- Create: `server/src/jobs/missed-run.ts`, `server/src/jobs/scheduler.ts`, `server/src/main.ts`, `server/build.mjs`, `server/src/cli/replay.ts` (stub, replaced in Task 19), `server/Dockerfile`, `server/compose.yaml`, `server/Caddyfile`, `server/.env.example`, `server/backup/Dockerfile`, `server/backup/backup.sh`, `server/tests/jobs.test.ts`

**Interfaces:**
- Consumes: `chicagoParts` (Task 14), `runPublishTick` (Task 14), `createApp` (Task 16), `loadConfig`, `createDb`.
- Produces:
  - `MISSED_RUN_MINUTES = 570`; `type Mailer = (subject: string, text: string) => Promise<void>`; `resendMailer(config, fetchFn?): Mailer | null`
  - `checkMissedRun(db, mailer: Mailer | null, now?: Date): Promise<"too-early" | "ok" | "no-mailer" | "already-sent" | "sent">`
  - `startScheduler(db, config, intervalMs?): () => void`
  - image `ghcr.io/monroeresidential/chicago-pipeline-api:<sha>` with `dist/{main,migrate,token,import-csv,replay}.js`, `migrations/`, `data/projects.csv`

- [ ] **Step 1: Write the failing job tests**

`server/tests/jobs.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueToken } from "../src/auth/tokens";
import { checkMissedRun, resendMailer } from "../src/jobs/missed-run";
import { testConfig } from "./helpers/app";
import { getTestDb, resetDb } from "./helpers/db";

const db = getTestDb();
beforeEach(() => resetDb(db));
const at = (iso: string) => new Date(iso); // October 2026 is CDT (UTC-5): 14:31Z = 9:31 CT

async function submissionAt(role: "submitter" | "editor", iso: string) {
  const { jti } = await issueToken(db, testConfig.JWT_SECRET, role === "submitter" ? "grok" : "drew", role);
  await db.insertInto("submissions").values({ token_jti: jti, idempotency_key: iso, body_sha256: "x", body: "{}", received_at: new Date(iso) }).execute();
}

describe("checkMissedRun", () => {
  it("does nothing before 9:30 Chicago time", async () => {
    expect(await checkMissedRun(db, vi.fn(), at("2026-10-02T14:29:00Z"))).toBe("too-early");
  });

  it("emails once when Grok has not submitted today", async () => {
    const mailer = vi.fn(async () => {});
    expect(await checkMissedRun(db, mailer, at("2026-10-02T14:31:00Z"))).toBe("sent");
    expect(await checkMissedRun(db, mailer, at("2026-10-02T15:00:00Z"))).toBe("already-sent");
    expect(mailer).toHaveBeenCalledOnce();
    expect(mailer.mock.calls[0]![0]).toContain("2026-10-02");
  });

  it("is satisfied by a Grok submission today, not by an editor's or yesterday's", async () => {
    await submissionAt("editor", "2026-10-02T13:00:00Z");
    await submissionAt("submitter", "2026-10-02T04:00:00Z"); // 23:00 CT on Oct 1
    expect(await checkMissedRun(db, vi.fn(async () => {}), at("2026-10-02T14:31:00Z"))).toBe("sent");
    await resetDb(db);
    await submissionAt("submitter", "2026-10-02T12:45:00Z");
    expect(await checkMissedRun(db, vi.fn(), at("2026-10-02T14:31:00Z"))).toBe("ok");
  });

  it("retries on the next tick when the email fails", async () => {
    await expect(checkMissedRun(db, async () => { throw new Error("smtp down"); }, at("2026-10-02T14:31:00Z"))).rejects.toThrow("smtp down");
    expect(await checkMissedRun(db, vi.fn(async () => {}), at("2026-10-02T14:32:00Z"))).toBe("sent");
  });

  it("reports when no mailer is configured", async () => {
    expect(resendMailer(testConfig)).toBeNull();
    expect(await checkMissedRun(db, null, at("2026-10-02T14:31:00Z"))).toBe("no-mailer");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter server test tests/jobs.test.ts`
Expected: FAIL — cannot resolve `../src/jobs/missed-run`.

- [ ] **Step 3: Jobs**

`server/src/jobs/missed-run.ts`:

```ts
import { sql } from "kysely";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { chicagoParts } from "../time";

export const MISSED_RUN_MINUTES = 9 * 60 + 30;
export type Mailer = (subject: string, text: string) => Promise<void>;

export function resendMailer(config: Config, fetchFn: typeof fetch = fetch): Mailer | null {
  if (!config.RESEND_API_KEY || !config.ALERT_FROM || !config.ALERT_TO) return null;
  return async (subject, text) => {
    const res = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: config.ALERT_FROM, to: [config.ALERT_TO], subject, text }),
    });
    if (!res.ok) throw new Error(`Resend returned HTTP ${res.status}`);
  };
}

/** After 9:30 CT, emails once per day if no submitter token has posted since midnight CT. */
export async function checkMissedRun(db: Db, mailer: Mailer | null, now = new Date()) {
  const { date, minutes } = chicagoParts(now);
  if (minutes < MISSED_RUN_MINUTES) return "too-early" as const;
  const got = await sql`select 1 from submissions s join tokens t on t.jti = s.token_jti
    where t.role = 'submitter' and (s.received_at at time zone 'America/Chicago')::date = ${date}::date limit 1`.execute(db);
  if (got.rows.length) return "ok" as const;
  if (!mailer) return "no-mailer" as const;
  const claimed = await db.insertInto("job_runs").values({ name: "missed-run-alert", run_date: date })
    .onConflict((oc) => oc.columns(["name", "run_date"]).doNothing()).returning("name").executeTakeFirst();
  if (!claimed) return "already-sent" as const;
  try {
    await mailer(
      `Chicago Pipeline: no Grok submission yet today (${date})`,
      `The API has not received a submission from Grok today (${date}) as of 9:30 am Chicago time.\n` +
      `Grok's daily run is at 7:39 am. Check the bot, then queue_summary in Claude for the last submission time.`,
    );
  } catch (e) {
    await db.deleteFrom("job_runs").where("name", "=", "missed-run-alert").where("run_date", "=", date).execute();
    throw e;
  }
  return "sent" as const;
}
```

`server/src/jobs/scheduler.ts`:

```ts
import type { Config } from "../config";
import type { Db } from "../db/client";
import { runPublishTick } from "../publish/trigger";
import { checkMissedRun, resendMailer } from "./missed-run";

export function startScheduler(db: Db, config: Config, intervalMs = 30_000): () => void {
  const mailer = resendMailer(config);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runPublishTick(db, config);
      const missed = await checkMissedRun(db, mailer);
      if (missed === "no-mailer") console.warn(JSON.stringify({ level: "warn", msg: "no Grok submission today and no alert email configured" }));
    } catch (e) {
      console.error(JSON.stringify({ t: new Date().toISOString(), level: "error", msg: "scheduler", message: (e as Error).message }));
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
```

`server/src/main.ts`:

```ts
import { serve } from "@hono/node-server";
import { loadConfig } from "./config";
import { createDb } from "./db/client";
import { createApp } from "./http/app";
import { startScheduler } from "./jobs/scheduler";

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const app = createApp({ db, config });
const server = serve({ fetch: app.fetch, port: config.PORT, hostname: "0.0.0.0" }, (info) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), level: "info", msg: `listening on ${info.port}` })));
const stopScheduler = startScheduler(db, config);

function shutdown() {
  stopScheduler();
  server.close(() => void db.destroy().then(() => process.exit(0)));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

- [ ] **Step 4: Run the job tests**

Run: `pnpm --filter server test tests/jobs.test.ts`
Expected: PASS.

- [ ] **Step 5: Build script and image**

`server/build.mjs`:

```js
// Bundles each entry point (and the shared/ + src/lib code it imports) into dist/*.js.
// nodePaths lets code under ../src/lib resolve zod and papaparse from server/node_modules inside Docker.
import { build } from "esbuild";
import { resolve } from "node:path";

await build({
  entryPoints: {
    main: "src/main.ts", migrate: "src/cli/migrate.ts", token: "src/cli/token.ts",
    "import-csv": "src/cli/import-csv.ts", replay: "src/cli/replay.ts",
  },
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: true,
  nodePaths: [resolve("node_modules")],
  external: ["pg-native"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "info",
});
```

`src/cli/replay.ts` is created in Task 19; until then build with a stub so this task's image builds:

```ts
// Replaced in Task 19.
console.error("replay: not implemented yet");
process.exitCode = 2;
```

`server/Dockerfile` (build context is the repo root):

```dockerfile
FROM node:24-slim AS build
WORKDIR /repo
RUN npm install -g pnpm@10.28.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
RUN pnpm install --frozen-lockfile --filter server
COPY shared shared
COPY src/lib src/lib
COPY server server
RUN pnpm --filter server build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production MIGRATIONS_DIR=/app/migrations PORT=8787
COPY --from=build /repo/server/dist ./dist
COPY server/migrations ./migrations
COPY data/projects.csv ./data/projects.csv
USER node
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.js"]
```

Run: `pnpm --filter server build && docker build -f server/Dockerfile -t chicago-pipeline-api:local .`
Expected: esbuild prints five outputs; image builds.

Smoke-test the image against the dev database:

```bash
docker run --rm -d --name api-smoke -p 8788:8787 \
  -e DATABASE_URL=postgres://pipeline:pipeline@host.docker.internal:5433/pipeline \
  -e JWT_SECRET=local-dev-secret-local-dev-secret-0000 chicago-pipeline-api:local
sleep 3; curl -s localhost:8788/healthz; docker exec api-smoke node dist/migrate.js; docker stop api-smoke
```

Expected: `{"ok":true}` and `migrations: up to date`.

- [ ] **Step 6: Compose, Caddy, backups, env template**

`server/compose.yaml`:

```yaml
# Production stack on the droplet. Secrets come from server/.env (see .env.example); never commit it.
name: chicago-pipeline
services:
  db:
    build: ./db
    image: chicago-pipeline-db:17
    restart: unless-stopped
    environment:
      POSTGRES_USER: pipeline
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in server/.env}
      POSTGRES_DB: pipeline
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pipeline -d pipeline"]
      interval: 5s
      timeout: 3s
      retries: 30

  api:
    image: ghcr.io/monroeresidential/chicago-pipeline-api:${API_TAG:-latest}
    restart: unless-stopped
    env_file:
      - path: .env
        required: false
    environment:
      DATABASE_URL: postgres://pipeline:${POSTGRES_PASSWORD}@db:5432/pipeline
      PORT: "8787"
    depends_on:
      db:
        condition: service_healthy

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "443:443" # HTTPS only; port 80 is never published
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./certs:/certs:ro
      - caddy_data:/data
    depends_on:
      - api

  backup:
    build: ./backup
    profiles: ["tools"]
    env_file:
      - path: .env
        required: false
    environment:
      PGHOST: db
      PGUSER: pipeline
      PGPASSWORD: ${POSTGRES_PASSWORD}
      PGDATABASE: pipeline
    depends_on:
      db:
        condition: service_healthy

volumes:
  pgdata: {}
  caddy_data: {}
```

`server/Caddyfile`:

```
{
	auto_https off
	admin off
}

https://api.chicagopipeline.com:443 {
	# Cloudflare Origin CA certificate (SSL/TLS → Origin Server), saved on the droplet in server/certs/.
	tls /certs/origin.pem /certs/origin-key.pem
	encode gzip
	reverse_proxy api:8787
}
```

`server/backup/Dockerfile`:

```dockerfile
FROM postgres:17-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends awscli && rm -rf /var/lib/apt/lists/*
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
ENTRYPOINT ["/usr/local/bin/backup.sh"]
```

`server/backup/backup.sh`:

```sh
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
```

`server/.env.example`:

```
# Copy to server/.env on the droplet and fill in. Never commit server/.env.
# Generate with: openssl rand -hex 24
POSTGRES_PASSWORD=
# Generate with: openssl rand -hex 32
JWT_SECRET=
# Set by the deploy script; leave as latest for manual runs.
API_TAG=latest

# Nightly backups to DigitalOcean Spaces (Spaces access key with read/write on the bucket)
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_DEFAULT_REGION=us-east-1
SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com
SPACES_BUCKET=chicago-pipeline-backups

# Missed-run alert email via Resend (sender domain must be verified in Resend)
RESEND_API_KEY=
ALERT_FROM=
ALERT_TO=

# Site rebuild hook (chosen in stage 2; leave empty until then)
SITE_BUILD_HOOK_URL=
SITE_BUILD_HOOK_TOKEN=
```

Validate the compose file:

Run: `cp server/.env.example server/.env && docker compose -f server/compose.yaml config -q; echo "exit $?"; rm server/.env`
Expected: `set POSTGRES_PASSWORD` error (the empty template is rejected — good). Then `POSTGRES_PASSWORD=x docker compose -f server/compose.yaml config -q; echo "exit $?"` → `exit 0`.

Run: `docker build -t chicago-pipeline-backup:local server/backup && sh -n server/backup/backup.sh && echo ok`
Expected: image builds; `ok`.

- [ ] **Step 7: Commit**

```bash
git add server
git commit -m "feat(server): missed-run alert, scheduler, entry point, production Docker stack and backups

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: Local development tools — `db:pull` and `server:replay`

**Files:**
- Create: `server/src/intake/replay.ts`, `server/scripts/db-pull.sh`, `server/tests/replay.test.ts`
- Modify: `server/src/cli/replay.ts` (replace the stub)

**Interfaces:**
- Consumes: `processSubmission` (Task 10).
- Produces: `replaySubmission(db, submissionId: number, opts: { write: boolean }): Promise<{ counts: Record<string, number>; changed: { index: number; source_key: string | null; was: string; now: string }[] }>`

- [ ] **Step 1: Write the failing test**

`server/tests/replay.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { permitRecord, zbaRecord } from "../../shared/tests/fixtures";
import { replaySubmission } from "../src/intake/replay";
import { makeApp, queueRecords } from "./helpers/app";

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => { ctx = await makeApp(); });

describe("replaySubmission", () => {
  it("dry-runs a stored submission and reports outcome changes without writing", async () => {
    await queueRecords(ctx, [permitRecord(), zbaRecord()]);
    const r = await replaySubmission(ctx.db, 1, { write: false });
    expect(r.counts).toEqual({ no_change: 2 });
    expect(r.changed.map((c) => [c.was, c.now])).toEqual([["queued_create", "no_change"], ["queued_create", "no_change"]]);
    expect((await ctx.db.selectFrom("submissions").select("id").execute()).length).toBe(1);
  });

  it("404s an unknown submission", async () => {
    await expect(replaySubmission(ctx.db, 42, { write: false })).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter server test tests/replay.test.ts`
Expected: FAIL — cannot resolve `../src/intake/replay`.

- [ ] **Step 3: Implement**

`server/src/intake/replay.ts`:

```ts
import type { Db } from "../db/client";
import { HttpError } from "../errors";
import { processSubmission, type SubmissionResponse } from "./submit";

const REPLAY = { sub: "replay", role: "submitter" as const, jti: "replay-local" };

/** Re-runs a stored Grok submission through today's code. Dry run unless write is true. */
export async function replaySubmission(db: Db, submissionId: number, opts: { write: boolean }) {
  const sub = await db.selectFrom("submissions").select(["body", "response"]).where("id", "=", submissionId).executeTakeFirst();
  if (!sub) throw new HttpError(404, `no submission ${submissionId}`);
  await db.insertInto("tokens").values({ jti: REPLAY.jti, sub: REPLAY.sub, role: REPLAY.role }).onConflict((oc) => oc.column("jti").doNothing()).execute();
  const res = await processSubmission(db, REPLAY, {
    body: sub.body, rawBody: JSON.stringify(sub.body), idempotencyKey: `replay-${submissionId}-${Date.now()}`, dryRun: !opts.write,
  });
  const original = (sub.response as SubmissionResponse | null)?.results ?? [];
  const counts: Record<string, number> = {};
  for (const r of res.results) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  const changed = res.results
    .filter((r) => original[r.index] && original[r.index]!.outcome !== r.outcome)
    .map((r) => ({ index: r.index, source_key: r.source_key, was: original[r.index]!.outcome, now: r.outcome }));
  return { counts, changed };
}
```

`server/src/cli/replay.ts`:

```ts
// Usage: replay <submission_id> [--write]   Dry run by default: shows how today's code would treat a past Grok push.
import { loadConfig } from "../config";
import { createDb } from "../db/client";
import { replaySubmission } from "../intake/replay";

const id = Number(process.argv[2]);
if (!Number.isInteger(id)) throw new Error("usage: replay <submission_id> [--write]");
const db = createDb(loadConfig().DATABASE_URL);
try {
  const r = await replaySubmission(db, id, { write: process.argv.includes("--write") });
  console.log("outcomes:", r.counts);
  if (r.changed.length) console.table(r.changed);
  else console.log("no record changed outcome compared with the original response");
} finally {
  await db.destroy();
}
```

`server/scripts/db-pull.sh`:

```bash
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
pnpm token issue drew-local --role editor
```

`chmod +x server/scripts/db-pull.sh`

- [ ] **Step 4: Run the tests and check the script**

Run: `pnpm --filter server test tests/replay.test.ts && bash -n server/scripts/db-pull.sh && echo syntax-ok`
Expected: PASS; `syntax-ok`. (`db:pull` itself is exercised against real backups in Task 21.)

- [ ] **Step 5: Commit**

```bash
git add server/src/intake/replay.ts server/src/cli/replay.ts server/scripts/db-pull.sh server/tests/replay.test.ts
git commit -m "feat(server): restore production data locally and replay past Grok submissions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 20: CI, deploy workflow, runbook, CLAUDE.md

**Files:**
- Create: `.github/workflows/server-tests.yml`, `.github/workflows/deploy-server.yml`, `server/deploy/deploy.sh`, `server/README.md`
- Modify: `.github/workflows/ci.yml`, `CLAUDE.md`, `README.md` (one paragraph pointing at `server/README.md`)

**Interfaces:**
- Consumes: the image and compose stack from Task 18.
- Produces: GitHub secrets contract — `DO_API_TOKEN`, `DO_FIREWALL_ID`, `DEPLOY_HOST`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` (environment `production`).

- [ ] **Step 1: Reusable server test workflow and CI hook-up**

`.github/workflows/server-tests.yml`:

```yaml
name: Server tests
on:
  workflow_call: {}

jobs:
  server:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Start Postgres 17 + PostGIS + pgvector
        run: |
          docker build -t chicago-pipeline-db:test server/db
          docker run -d --name db -p 5433:5432 -e POSTGRES_USER=pipeline -e POSTGRES_PASSWORD=pipeline \
            -e POSTGRES_DB=pipeline_test chicago-pipeline-db:test
          for i in $(seq 1 60); do docker exec db pg_isready -U pipeline -d pipeline_test && break; sleep 2; done
      - run: pnpm --filter server typecheck
      - run: pnpm --filter server test
      - run: docker build -f server/Dockerfile -t chicago-pipeline-api:test .
```

In `.github/workflows/ci.yml` add a second job:

```yaml
  server:
    uses: ./.github/workflows/server-tests.yml
```

- [ ] **Step 2: Deploy script (runs on the droplet)**

`server/deploy/deploy.sh`:

```bash
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
```

`chmod +x server/deploy/deploy.sh`

- [ ] **Step 3: Deploy workflow**

`.github/workflows/deploy-server.yml`:

```yaml
name: Deploy server
on:
  push:
    branches: [main]
    paths: ["server/**", "shared/**", "src/lib/**", "data/projects.csv", ".github/workflows/deploy-server.yml", ".github/workflows/server-tests.yml"]
  workflow_dispatch: {}

concurrency:
  group: deploy-server
  cancel-in-progress: false

permissions:
  contents: read
  packages: write

jobs:
  test:
    uses: ./.github/workflows/server-tests.yml

  image:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: server/Dockerfile
          push: true
          tags: ghcr.io/monroeresidential/chicago-pipeline-api:${{ github.sha }}

  deploy:
    needs: image
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: digitalocean/action-doctl@v2
        with:
          token: ${{ secrets.DO_API_TOKEN }}
      - name: Allow SSH from this runner only
        run: |
          ip=$(curl -fsS https://api.ipify.org)
          echo "RUNNER_IP=$ip" >> "$GITHUB_ENV"
          doctl compute firewall add-rules "${{ secrets.DO_FIREWALL_ID }}" --inbound-rules "protocol:tcp,ports:22,address:$ip/32"
      - name: Deploy
        env:
          SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
          KNOWN_HOSTS: ${{ secrets.DEPLOY_KNOWN_HOSTS }}
        run: |
          mkdir -p ~/.ssh && chmod 700 ~/.ssh
          printf '%s\n' "$SSH_KEY" > ~/.ssh/id_ed25519 && chmod 600 ~/.ssh/id_ed25519
          printf '%s\n' "$KNOWN_HOSTS" > ~/.ssh/known_hosts
          ssh deploy@${{ secrets.DEPLOY_HOST }} \
            "cd /opt/chicago-pipeline && git fetch --quiet origin && git checkout --quiet --detach ${{ github.sha }} && server/deploy/deploy.sh ${{ github.sha }}"
      - name: Close SSH again
        if: always()
        run: |
          [ -n "${RUNNER_IP:-}" ] && doctl compute firewall remove-rules "${{ secrets.DO_FIREWALL_ID }}" --inbound-rules "protocol:tcp,ports:22,address:$RUNNER_IP/32" || true
```

- [ ] **Step 4: Runbook**

`server/README.md` — the operator's guide. Write these sections with exactly this content (fill no secrets into the file):

1. **What runs where** — the Compose services (`db`, `api`, `caddy`, `backup` on demand), the droplet path `/opt/chicago-pipeline`, `server/.env`, `server/certs/`, `server/.api_tag`.
2. **One-time droplet setup** (Drew in the DigitalOcean dashboard, Claude on the shell):
   1. Create a droplet: Ubuntu 24.04, Basic, 2 GB RAM, region NYC3, enable weekly backups, add Drew's SSH key. Note its IP.
   2. Create a Cloud Firewall attached to the droplet: inbound TCP 443 from every Cloudflare range at https://www.cloudflare.com/ips/ (IPv4 and IPv6), inbound TCP 22 from Drew's current IP only; outbound all. Note the firewall id (`doctl compute firewall list`).
   3. On the droplet as root: `curl -fsSL https://get.docker.com | sh`; `adduser --disabled-password deploy`; `usermod -aG docker deploy`; install the CI deploy key in `/home/deploy/.ssh/authorized_keys`; `git clone https://github.com/monroeresidential/chicago-residential-pipeline /opt/chicago-pipeline && chown -R deploy /opt/chicago-pipeline`.
   4. As `deploy`: `docker login ghcr.io -u <github user>` with a GitHub token that has only `read:packages`.
   5. Create `server/.env` from `.env.example` (`openssl rand -hex 24` / `-hex 32` for the two secrets; Spaces key; Resend key, `ALERT_FROM`, `ALERT_TO`), `chmod 600 server/.env`.
   6. Cloudflare dashboard → chicagopipeline.com: DNS `A api → <droplet IP>`, **Proxied**. SSL/TLS → Origin Server → Create certificate for `api.chicagopipeline.com` (15 years); save as `server/certs/origin.pem` and `server/certs/origin-key.pem` (`chmod 600`). Rules → Configuration Rules: hostname equals `api.chicagopipeline.com` → SSL **Full (strict)**. Security → WAF → Rate limiting rule: hostname `api.chicagopipeline.com` and path does not start with `/v1/submissions`, 100 requests per minute per IP, block for 1 minute.
   7. DigitalOcean Spaces: bucket `chicago-pipeline-backups` (private) + an access key limited to it.
   8. Nightly backup cron for `deploy` (`crontab -e`): `15 8 * * * cd /opt/chicago-pipeline/server && docker compose --profile tools run --rm backup >> /home/deploy/backup.log 2>&1` (08:15 UTC = 3:15 am CT).
   9. DigitalOcean Monitoring → Uptime: HTTPS check on `https://api.chicagopipeline.com/healthz`, alert email to Drew.
   10. GitHub → Settings → Environments → `production` with secrets `DO_API_TOKEN` (write access to firewalls), `DO_FIREWALL_ID`, `DEPLOY_HOST` (droplet IP), `DEPLOY_SSH_KEY` (private half of the deploy key), `DEPLOY_KNOWN_HOSTS` (`ssh-keyscan <ip>` output).
   11. Cloudflare → Workers & Pages → chicago-pipeline → Settings → Build → **Build watch paths**: include `*`, exclude `server/*` so server-only changes don't rebuild the site.
3. **Deploys** — automatic on merge to `main` touching `server/`, `shared/`, `src/lib/` or `data/projects.csv`; manual via Actions → Deploy server → Run workflow. What `deploy.sh` does; how rollback works (previous tag in `.api_tag`; migrations are forward-only, so a migration that must be undone needs a new migration).
4. **Everyday commands** (run in `/opt/chicago-pipeline/server` as `deploy`):
   - logs: `docker compose logs -f api`
   - tokens: `docker compose exec api node dist/token.js issue grok --role submitter` · `… issue drew --role editor` · `… list` · `… revoke <jti>`
   - backup now: `docker compose --profile tools run --rm backup`
   - restore a backup: `aws s3 cp` the dump, then `docker compose exec -T db pg_restore -U pipeline -d pipeline --clean --if-exists --no-owner < file.dump`
5. **Local development** — `pnpm db:up`, `server/.env.local` (DATABASE_URL, JWT_SECRET, Spaces read key), `pnpm db:pull`, `pnpm server:dev`, `pnpm server:replay <id>`, `pnpm server:test`; connecting Claude Code locally with `claude mcp add --transport http chicago-pipeline-local http://localhost:8787/mcp --header "Authorization: Bearer <local token>"`.
6. **Connecting Claude Code to production** — `claude mcp add --transport http chicago-pipeline https://api.chicagopipeline.com/mcp --header "Authorization: Bearer <editor token>"`.

- [ ] **Step 5: CLAUDE.md and README**

In `CLAUDE.md`:
- Under **Commands**, add:

```bash
pnpm db:up               # local Postgres 17 + PostGIS + pgvector on :5433 (server/compose.dev.yaml)
pnpm server:test         # server integration tests (needs db:up); pnpm --filter server test tests/review.test.ts for one file
pnpm server:dev          # API + MCP on localhost:8787 against the local database (server/.env.local)
pnpm db:pull             # restore last night's production backup locally, issue a local editor token
pnpm server:replay <id>  # dry-run a past Grok submission through today's code
pnpm streets:fetch       # refresh shared/data/streets.json from the Chicago Data Portal
```

- Add an **Architecture → Data platform (server/)** paragraph: Grok POSTs to `/v1/submissions` (submitter JWT) → records validated by `shared/records/schemas.ts`, normalized by `shared/records/normalize-record.ts` (canonical PINs, addresses checked against the city street list, identifiers, organization keys) → hashed and diffed → `queue_items` with project suggestions (`server/src/match/`). Nothing reaches `filings` except through `approveItem` (review) or editor edits; every write runs in `withActor()` and the `record_revision()` trigger writes `revisions`. REST (`server/src/http/routes/`) and MCP (`server/src/mcp/tools.ts`) both call `server/src/ops.ts`. Public reads (`/v1/projects`, `.geojson`, `/v1/stats`) return only published projects and their linked filings. Deploys: `.github/workflows/deploy-server.yml` → GHCR image → `server/deploy/deploy.sh` on the droplet; runbook in `server/README.md`.
- Under **Data rules**, add: until stage 2 switches the site over, `data/projects.csv` still drives the site; after the one-time import, project edits made through the API are not written back to the CSV.

In `README.md` add a short "Data platform" paragraph linking `server/README.md` and the two specs.

- [ ] **Step 6: Verify CI locally where possible**

Run: `pnpm test && pnpm check && pnpm --filter server typecheck && pnpm --filter server test && bash -n server/deploy/deploy.sh && echo ok`
Expected: everything passes; `ok`.

- [ ] **Step 7: Commit and open the PR**

```bash
git add .github server/deploy server/README.md CLAUDE.md README.md
git commit -m "ci: server tests, GHCR image and droplet deploy; operator runbook

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git push -u origin data-platform-stage1
gh pr create --title "Data platform stage 1: API, review queue, MCP" --body "<summary of the branch, link to spec and plan, list of deviations, test results>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: PR CI runs both the site job and the new `server` job; both green. (The deploy workflow only runs after merge.)

---

### Task 21: Production setup and first deploy (with Drew)

This task changes shared infrastructure, so every step is done with Drew present; Drew performs the dashboard steps and Claude runs the shell steps. Do not start it until the PR from Task 20 is merged.

**Files:** none (configuration only). Record outcomes in the ledger and update memory `reference-infra.md` with the droplet, firewall, bucket and hostnames (no secrets).

- [ ] **Step 1: Infrastructure** — walk Drew through `server/README.md` §2 steps 1–11. Expected: droplet reachable over SSH from Drew's IP; `dig api.chicagopipeline.com` returns Cloudflare addresses; GitHub `production` environment has all five secrets.

- [ ] **Step 2: First deploy** — Actions → Deploy server → Run workflow on `main`. Expected: `test`, `image`, `deploy` green; log ends `deployed <sha>`; the firewall has no leftover runner rule (`doctl compute firewall get <id>`).

- [ ] **Step 3: HTTPS and exposure checks**

```bash
curl -s https://api.chicagopipeline.com/healthz                  # → {"ok":true}
curl -s -o /dev/null -w "%{http_code}\n" --max-time 10 http://api.chicagopipeline.com/healthz   # → 301 (Cloudflare → HTTPS) or no answer; never 200 over plain HTTP
curl -sk --max-time 10 https://<droplet-ip>/healthz; echo "exit $?"   # → timeout (firewall blocks non-Cloudflare traffic)
```

- [ ] **Step 4: Import the curated projects** — on the droplet: `docker compose exec api node dist/import-csv.js data/projects.csv`. Expected: `imported 29 projects (as of 2026-09-28)` and the one address line for 620 N. LaSalle. Then `curl -s https://api.chicagopipeline.com/v1/stats` → `count 29, units 4321, tpcMusd 1839.8`.

- [ ] **Step 5: Tokens and Claude** — issue `grok` (submitter) and `drew` (editor) tokens; Drew stores both in a password manager. Drew runs `claude mcp add --transport http chicago-pipeline https://api.chicagopipeline.com/mcp --header "Authorization: Bearer <drew token>"`; in a new Claude Code session, `queue_summary` returns `pending: 0` and `pipeline_stats` returns the totals above.

- [ ] **Step 6: Grok** — give Grok its token and `docs/superpowers/specs/2026-10-02-grok-submission-api.md` (marked live). First a `?dry_run=true` POST of one real day; check the outcomes together; then the first live run and the history backfill in 500-record chunks. Expected: `queue_summary` shows the backfill with suggestions; nothing appears on the public API until approved.

- [ ] **Step 7: Backups and local copy** — `docker compose --profile tools run --rm backup` → `backup ok: …`; the object is visible in Spaces. On Drew's Mac, `pnpm db:pull` restores it and prints a local editor token; `pnpm server:dev` then `curl -s localhost:8787/v1/stats` shows the same totals.

- [ ] **Step 8: Close out** — ledger every result; update `reference-infra.md` (droplet IP/region, firewall id, bucket, API hostname, runbook pointer) and `project-chicago-pipeline.md` (stage 1 live, stage 2 next). The site keeps reading `data/projects.csv` until stage 2.
