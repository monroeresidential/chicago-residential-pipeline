# Chicago Pipeline Map — Phase 1 Design

**Date:** 2026-09-28
**Status:** Draft for review
**Site:** https://pipeline.monroeresidential.com
**Repo:** https://github.com/monroeresidential/chicago-residential-pipeline

## 1. Purpose

A public, Monroe Residential–branded interactive map of Chicago's downtown
office-to-residential conversion pipeline. Audience: investors, brokers, and
press. Goal: position Monroe as the firm that knows the Chicago pipeline, and
drive contact with Monroe.

**Success criteria**

- All known conversion projects (25 on the June 2026 DPD map + 2 reported
  candidates) appear on a fast, branded, interactive map.
- Each project has its own indexable page with share-preview metadata.
- Visual style is recognizably monroeresidential.com.
- Data format is stable enough that future scrapers and a Postgres-backed API
  can replace the data source without frontend changes.

**Out of scope for Phase 1:** scrapers, database, API, rental data, project
types other than office-to-residential conversions, search, accounts, lead
capture forms.

## 2. Future phases (context only, not built now)

```
Scrapers (Python; GitHub Actions or small worker box)
   → Postgres + PostGIS (Neon preferred; Supabase alternative)
   → Hyperdrive → Hono API on Cloudflare Workers (api.pipeline.monroeresidential.com)
   → Astro site
```

Postgres (not D1) is chosen for later phases because rental scraping implies
time-series volume beyond D1's 10 GB per-database cap, spatial queries
(PostGIS), window-function analytics, and Python/BI tooling compatibility.
Phase 1's GeoJSON shape is the future `/api/projects` contract.

## 3. User experience

### 3.1 Home page `/` — full-screen map

- **Header (navy):** Monroe logo, "Chicago Pipeline", Contact, link back to
  monroeresidential.com.
- **Sidebar (left, desktop):**
  - Stat tiles: project count, total units, total TPC — recompute on filter.
  - Filters: status (5 stages, checkboxes) and program (LaSalle Reimagined /
    Private).
  - Project list, sortable by units, TPC, status. Hover row → highlight
    marker; click → fly to project and open popup.
- **Map:** MapLibre GL, custom brand basemap, 3D building extrusions at high
  zoom. Markers colored by status, sized by units. "Reported" (non-DPD)
  projects use a hollow marker. Warning-flagged projects show a ⚠ in popup
  and list.
- **Popup:** name/address, units · TPC, status, program, "View details →"
  link to project page.
- **Mobile:** sidebar becomes a draggable bottom sheet; map stays full screen.
- **URL state:** active filters and selected project are encoded in the query
  string so views are shareable.

### 3.2 Project pages `/projects/[slug]` — one static page per project

Name, address, developer, units, affordable units, TPC, public support,
status stage + status note, warning flag if any, static mini-map, source
links, "Data as of" date, CTA ("Have a project in mind? Talk to Monroe" +
(312) 296-4855). Unique `<title>`, meta description, generated OG image
(e.g. "111 W. Monroe St · 345 units · Approved"), schema.org structured data.

### 3.3 `/about` — methodology

Data sources (DPD June 2026 map, City of Chicago press releases/LaSalle
proposals page, Cooperator News, Crain's, The Real Deal, Chicago Cityscape),
reconciliation rule (§4.4), update cadence, disclaimer.

### 3.4 Site-wide

Sitemap, robots.txt, Cloudflare Web Analytics (cookieless — no cookie banner).

### 3.5 Brand

Matched to monroeresidential.com:

| Token | Value |
|---|---|
| Navy (header, dark surfaces, theme-color) | `#00051B` |
| Primary blue (buttons, links, accents) | `#33709B` |
| Background | `#FFFFFF` |
| Text | `#222222` |
| Heading font | Newsreader (serif) |
| Body font | Inter |
| Corner radius | 0 (square) |
| Spacing base | 8px |

Basemap styled to match: muted grays, navy-tinted water, Inter/Newsreader-like
labels. Status marker palette chosen to sit alongside the brand blue and pass
contrast against the basemap (finalized during implementation).

## 4. Data

### 4.1 Source of truth

`data/projects.csv` — cleaned, hand-editable. Derived from the original
`chicago_conversions_2026.csv` (kept locally in git-ignored `data/raw/` with the DPD map image; not published).
`scripts/build-data.ts` converts it to `public/data/projects.geojson` before
every build. Pages and map both consume the GeoJSON.

### 4.2 Project record (GeoJSON Feature properties)

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable slug, e.g. `111-w-monroe`. Future scraper join key. |
| `name` | string \| null | Building/project name |
| `address` | string | |
| `developer` | string \| null | |
| `units` | int \| null | DPD value preferred (§4.4) |
| `affordable_units` | int \| null | |
| `tpc_musd` | number \| null | Total project cost, $M |
| `program` | `"lasalle"` \| `"private"` | LaSalle Street Reimagined vs private market |
| `public_support` | string \| null | Free text (TIF amounts, tax credits) |
| `status` | enum | `completed`, `under_construction`, `permitted`, `approved`, `planning` |
| `status_note` | string | Detailed status text |
| `flag` | string \| null | Warning shown with ⚠ |
| `confidence` | `"dpd"` \| `"reported"` | On DPD map vs our own finding |
| `dpd_map_no` | int \| null | 1–25 |
| `sources` | string[] | URLs |
| `notes` | string \| null | Discrepancies, alternates |
| `as_of` | ISO date | |

Geometry: Point `[lng, lat]`. Lat/lng are stored as columns in
`projects.csv`.

### 4.3 Status assignment (initial)

| Stage | Projects |
|---|---|
| Completed | 79 W Monroe, 111 W Illinois |
| Under construction | 65 E Wacker, 500 N Michigan, 116-22 W Illinois, 223 W Erie, 444 N Wabash, 1220 W Van Buren, 230 E Ohio |
| Permitted | 19 S LaSalle, 401 W Ontario, 56 E Superior, 212 E Ohio, 118 S Clinton |
| Approved | 111 W Monroe, 208 S LaSalle, 30 N LaSalle, 135 S LaSalle, 105 W Adams, 1006 S Michigan, 309 W Washington, 55 E Washington, 1060 W Van Buren |
| Planning | 445 W Erie, 542 S Dearborn, 209 W Jackson, 70 E Lake |

Flags: 105 W Adams — "Ownership lawsuit pending"; 1006 S Michigan — "Listed
for sale; no construction".

Program: `lasalle` for DPD map #1–6 (red markers on DPD map); `private` for
all others.

### 4.4 Reconciliation rule

When DPD and another source disagree, the DPD value is displayed and the
alternate goes in `notes`. Where DPD has no value (the two candidates), the
other source is used. Rule is stated on `/about`.

### 4.5 Reported candidates

70 E Lake St and 118 S Clinton St are not on the DPD map. They are shown with
`confidence: "reported"`, a hollow marker, and the label "Reported — not on
DPD map".

### 4.6 Geocoding

One-time `scripts/geocode.ts` using the U.S. Census Geocoder; results written
into `projects.csv`. Every point is then manually verified against the DPD map
image and nudged onto the building footprint where needed. Geocoding is not
part of the regular build.

### 4.7 Expected totals

All 27: 4,210 units, $1,839.8M TPC. DPD 25 only: must be consistent with DPD's
published "3,930+ units / $1.8B".

## 5. Architecture

### 5.1 Stack

- Astro 5, static output
- MapLibre GL JS + `pmtiles` protocol, vanilla TypeScript island (map page only)
- Zod for schema validation (`src/lib/schema.ts`, shared with future API)
- pnpm; Vitest; Playwright

### 5.2 Layout

```
data/projects.csv, data/raw/
scripts/geocode.ts, scripts/build-data.ts
src/lib/schema.ts
src/styles/            brand tokens, fonts
src/map/style.json     custom MapLibre style
src/components/        Map, Sidebar, ProjectList, ProjectCard, StatTiles, Header, Footer
src/pages/index.astro, projects/[slug].astro, about.astro
public/data/projects.geojson (generated, gitignored)
```

### 5.3 Hosting (Cloudflare)

| Piece | Location |
|---|---|
| Site | Cloudflare Workers static assets, custom domain `pipeline.monroeresidential.com` |
| Basemap | Protomaps Chicago-area PMTiles extract in R2, public at `tiles.monroeresidential.com` (range requests, edge cached) |
| Map glyphs/sprites | Same R2 bucket |
| OG images | Generated at build time, static |
| Analytics | Cloudflare Web Analytics |

`monroeresidential.com` DNS is already on Cloudflare (verified).

### 5.4 CI/CD

- GitHub repo `monroeresidential/chicago-residential-pipeline` (public).
- GitHub Actions on every PR: data build + validation, Vitest, Astro build,
  Playwright smoke.
- Cloudflare Workers Builds: `main` → production; PRs → preview URLs.
- Phase 1 data update = edit `data/projects.csv`, push.

## 6. Quality

### 6.1 Data validation (build fails on)

- Missing required field; status not in enum; duplicate `id`.
- Coordinates outside a downtown-Chicago bounding box.
- Unparseable numeric values not covered by explicit parse rules (e.g.
  `~22 (20%)` → 22 via a documented rule).

Build prints totals and per-stage counts for sanity check against §4.7.

### 6.2 Tests

- **Vitest:** CSV parsing/normalization, slugging, totals, filter logic, URL
  state round-trip.
- **Playwright (against built site):** map loads with 27 markers; filtering
  changes marker count and totals; marker click opens popup; every project
  page returns 200 with title + OG tags; mobile viewport shows bottom sheet.

### 6.3 Degradation

- Tile failure: markers and sidebar still work over a plain background;
  notice "Map tiles unavailable".
- No WebGL: static preview image in map area; list remains fully usable.
- Missing values render as "—".

### 6.4 Accessibility & performance

- Project list is the keyboard/screen-reader equivalent of the map; markers
  have labels; color contrast checked (WCAG AA).
- Lighthouse ≥ 95 on project pages, ≥ 85 on map page. Map JS loaded only on
  `/`. Fonts subset and preloaded.

### 6.5 Launch checklist

- All 27 pins verified against DPD map image.
- Manual review on phone and laptop.
- Custom domains live; analytics receiving data.

## 7. Needed from Monroe at deploy time

- `wrangler login` to the Cloudflare account that owns `monroeresidential.com`.
- Permission to use the Monroe logo asset (from monroeresidential.com) and
  confirmation of the contact phone number/CTA copy.
