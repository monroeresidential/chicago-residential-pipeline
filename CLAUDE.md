# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Public, Monroe Residential–branded map of Chicago's downtown office-to-residential conversion pipeline, live at https://pipeline.monroeresidential.com. Astro 7 static site, MapLibre GL 6 map, deployed to Cloudflare Workers static assets. Design spec and implementation plan (including accepted deviations) live in `docs/superpowers/`.

## Commands

```bash
pnpm dev                 # astro dev (Astro 7 runs dev/preview as a lock-file daemon: `pnpm exec astro dev stop`, `--background`)
pnpm build               # static build to dist/ (fails on any invalid CSV row)
pnpm check               # astro check (type-check .astro + .ts)
pnpm test                # vitest, tests/unit/**
pnpm test tests/unit/filters.test.ts        # one unit file;  add -t "name" for one test
pnpm test:e2e            # Playwright: builds, then `astro preview --port 4321 --ignore-lock`
pnpm test:e2e tests/e2e/map.spec.ts -g "Enter"   # one e2e test
pnpm data:check          # validate data/projects.csv, print totals + per-stage counts
pnpm geocode             # fill empty lat/lng in data/projects.csv (Census geocoder); verify pins by eye
pnpm run deploy          # manual deploy (normally unnecessary, see Deploy)
```

CI (`.github/workflows/ci.yml`, PRs and pushes to main) runs data:check → check → test → test:e2e. Playwright has a `desktop` project and a `mobile` project (Pixel 7) that runs only `mobile.spec.ts`.

On this machine, TLS goes through Cloudflare Gateway: Node/pnpm network calls need `NODE_EXTRA_CA_CERTS` / `npm_config_cafile` pointing at a bundle that includes the Gateway CA (exportable from the System keychain). CI doesn't need this.

## Architecture

**Data flow (single source of truth).** `data/projects.csv` → `parseProjectsCsv` (`src/lib/parse-projects.ts`, validated by the Zod `ProjectSchema` in `src/lib/schema.ts`) → `loadProjects()` (`src/lib/load-projects.ts`, imports the CSV via `?raw`, throws with every row error so a bad row fails the build). Everything at build time consumes `loadProjects()`:
- `src/pages/index.astro` renders the sidebar server-side and **embeds** the GeoJSON FeatureCollection in `<script type="application/json" id="projects-data">`; the client map reads it (no second request).
- `src/pages/projects/[id].astro` — one static page per project (JSON-LD, mini-map).
- `src/pages/data/projects.geojson.ts` — same FeatureCollection as a static file; it is the contract a future Postgres-backed `/api/projects` must keep.
- `src/pages/og/[id].png.ts` — satori + resvg share images (`src/lib/og.ts`); `site.png` is the home image over `src/assets/og/birken-lofts.jpg`.

Enums (status order, labels, colors; programs) live in `schema.ts` and drive CSS swatches, filters, markers and sorting. `DATA_AS_OF` in `src/lib/data-meta.ts` is a single constant copied into every feature.

**Client map (home page only).** `src/scripts/map-app.ts` orchestrates: URL ↔ `FilterState` (`src/lib/filters.ts`: `parseFilterState`, `mergeFilterSearch` keeps utm_* params and the hash), DOM markers (`src/map/markers.ts`), popups (`src/map/popup.ts`, all data escaped), and sidebar DOM sync (`src/scripts/sidebar.ts`). `render()` is the single place state is applied; `reconcileSelection` drops a selected project hidden by filters. Popup close handling relies on `closePopup()` clearing `popup` before `remove()` so programmatic closes don't re-enter `render()`. List rows are real links: keyboard activation (`event.detail === 0`) and the no-WebGL path navigate to the project page instead of flying the map.

**Map module split.** `src/map/style.ts` is pure (Protomaps `layers()` + `brand-flavor.ts` + a `buildings-3d` extrusion layer) and unit-tested; `src/map/basemap.ts` is DOM/WebGL. MapLibre 6 quirks handled there: no default export (`import * as maplibregl`), and its worker URL is built at runtime so it's bundled explicitly via `maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url` + `setWorkerUrl()` — removing that breaks tiles in production (guarded by an e2e test). `createBaseMap` returns `null` without WebGL; any map `error` event shows the "tiles unavailable" notice.

**Assets.** Basemap tiles: `https://tiles.monroeresidential.com/chicago.pmtiles` (R2 bucket `chicago-pipeline-tiles`, CORS `*`; also used in local dev; refresh steps in README). Glyphs/sprites are served same-origin from `public/map-assets/` (copied once by `scripts/fetch-map-assets.sh`). `.map-wrap > .map` specificity is deliberate: it must beat `maplibre-gl.css`'s `.maplibregl-map { position: relative }` regardless of stylesheet order.

**URLs.** `build.format: "file"` + `trailingSlash: "never"` so `/projects/x` is served from `projects/x.html` on Workers with no redirect; `Base.astro` strips `.html`/`/index` when building canonical URLs.

## Data rules

- `status` ∈ completed | under_construction | permitted | approved | planning; `program` ∈ lasalle | private; `confidence` ∈ dpd | reported ("Reported — not on DPD map", hollow marker); `sources` are URLs separated by ` | ` (at least one); numbers are plain digits; empty cell = unknown, rendered as "—".
- Reconciliation: the June 2026 DPD map value is shown and alternates go in `notes`, except figures confirmed directly by the developer (e.g. Birken Lofts 57 units). Projects with `monroe_url` get the Monroe badge.
- `tests/unit/data.test.ts` pins the real dataset (count, totals, per-stage counts, Monroe ids) and `tests/e2e/*` assert marker counts and totals — update them when rows change.
- The GitHub repo is **public**. `data/raw/` (original research CSV, DPD map image) and `inbox/` (project PDFs to process; see `inbox/README.md`) are git-ignored and must stay local. Only approved facts go into `data/projects.csv`.

## Deploy

Cloudflare Workers Builds (account `9441a00a44eb2bc68c2befd68119f256`, Worker `chicago-pipeline`, `wrangler.jsonc`) deploys every push to `main` and builds previews for other branches. It does not post GitHub checks; see the Worker's Deployments → Recent builds. Build variables: `NODE_VERSION=24`, optional `PUBLIC_CF_BEACON_TOKEN` (Cloudflare Web Analytics, rendered only when set).
