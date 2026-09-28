# Chicago Pipeline Map (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public, Monroe-branded interactive map of Chicago's 27 known office-to-residential conversions at `pipeline.monroeresidential.com`, with one SEO page per project.

**Architecture:** Astro 7 static site. `data/projects.csv` is parsed and validated at build time (Zod) into typed `Project` objects that feed static project pages and a static `/data/projects.geojson` endpoint (the future API contract). The home page is a vanilla-TypeScript MapLibre island that fetches that GeoJSON and renders DOM markers over a brand-styled Protomaps basemap (PMTiles in Cloudflare R2). Site deploys to Cloudflare Workers static assets.

**Tech Stack:** Astro 7, MapLibre GL JS 6, pmtiles 4, @protomaps/basemaps 5, Zod 4, PapaParse 5, satori + @resvg/resvg-js (OG images), @fontsource Inter/Newsreader, Vitest 5, Playwright 1.6x, TypeScript 6 (NOT 7 — `@astrojs/check` peer-requires `^5 || ^6`), pnpm 10, Wrangler 4, Node 24 in CI.

**Spec:** `docs/superpowers/specs/2026-09-28-chicago-pipeline-map-design.md`

## Global Constraints

- Site URL: `https://pipeline.monroeresidential.com`; tiles URL: `https://tiles.monroeresidential.com/chicago.pmtiles`.
- Brand: navy `#00051B`, blue `#33709B`, background `#FFFFFF`, text `#222222`; headings Newsreader, body Inter; border-radius `0` everywhere; 8px spacing base.
- Status enum (exact, in this order): `completed`, `under_construction`, `permitted`, `approved`, `planning`. Labels: Completed, Under construction, Permitted, Approved, Planning.
- Status colors: completed `#00051B`, under_construction `#33709B`, permitted `#2E8B7A`, approved `#C28A2C`, planning `#8C96A3`.
- Program enum: `lasalle` ("LaSalle Reimagined"), `private` ("Private market").
- Confidence enum: `dpd`, `reported`. Reported projects render as hollow markers labeled "Reported — not on DPD map".
- Missing values render as `—` (em dash), never blank/`NaN`/`null`.
- Reconciliation: DPD value displayed; alternates live in `notes`.
- Expected totals: all 27 → 4,210 units / $1,839.8M; DPD 25 only → 3,966 units / $1,799.8M.
- Map JS must not be in the initial bundle of project pages (mini-map is lazy-loaded on scroll).
- Lighthouse targets: ≥95 project pages, ≥85 map page.
- Contact CTA: "Have a project in mind?" + `(312) 296-4855` (`tel:+13122964855`).
- No cookies; analytics = Cloudflare Web Analytics beacon, only when `PUBLIC_CF_BEACON_TOKEN` is set.

## Spec deviations (flagged for reviewer)

1. **Header is white, not navy.** The only Monroe logo asset (`Monroe-Residential-Logo-Color.png`) is blue/gray and unreadable on navy. Navy is used for the footer CTA band, OG images, and "completed" markers.
2. **Map glyphs/sprites are served from the site** (`public/map-assets/`, ~11 MB, 770 files) instead of R2: same-origin, no CORS, no 770-file upload script. Only the PMTiles file goes to R2.
3. **No separate `build-data.ts`.** The GeoJSON is an Astro static endpoint (`src/pages/data/projects.geojson.ts`) built from the same parser; `pnpm data:check` prints the totals summary.
4. **Added `monroe_url` field.** Two projects are Monroe's own (Boylston Building Lofts, Birken Lofts); they get a "A Monroe Residential project" badge linking to the portfolio page.
5. **Mobile bottom sheet is tap-to-toggle**, not drag. Dragging can be added later.
6. **`as_of` is a single constant** (`src/lib/data-meta.ts`), copied into every feature's properties.
7. **No-WebGL fallback is a message, not a static preview image.** The project list stays fully usable and every row links to its project page.
8. **Map module split:** `src/map/style.ts` (pure, unit-testable, no `maplibre-gl` runtime import) and `src/map/basemap.ts` (DOM/WebGL).

## Review Focus

1. **Projects with missing fields** (118 S Clinton has no name, developer, TPC, public support) must render address-as-title and `—` in popup, list, project page, and OG image — not `null`/blank. Test: Task 3 `format.test.ts`, Task 8 `popup.test.ts`, Task 6 e2e `118-s-clinton`.
2. **All filters unchecked** must show an empty-state message and totals of 0, not a blank sidebar or crash. Test: Task 3 `filters.test.ts`, Task 8 e2e.
3. **Malformed/stale URLs** (`?status=bogus&project=deleted-id`) must fall back to the default view with no popup. Test: Task 3 `filters.test.ts`, Task 8 e2e.
4. **Special characters in data** (`&` in developer names, `'` in "Crain's", `<` hypothetically) must be escaped in popup HTML and JSON-LD. Test: Task 8 `popup.test.ts`, Task 6 JSON-LD `<` escaping.
5. **Deep link to a project hidden by filters** (`?status=completed&project=111-w-monroe`) must drop the selection rather than open a popup for an invisible marker. Test: Task 3 `reconcileSelection`, Task 8 e2e.

---

## File Structure

```
chicago-pipeline/
├─ .github/workflows/ci.yml          CI: data check, astro check, vitest, playwright
├─ astro.config.mjs                  site URL, sitemap
├─ package.json / pnpm-lock.yaml
├─ playwright.config.ts
├─ tsconfig.json
├─ vitest.config.ts
├─ wrangler.jsonc                    Workers static assets + custom domain
├─ README.md                         how to run, how to update data
├─ data/
│  ├─ projects.csv                   SOURCE OF TRUTH (hand-edited)
│  └─ raw/chicago_conversions_2026.csv, raw/dpd-map-2026-06.jpg
├─ .env.development                dev-only demo tiles URL (deleted in Task 12)
├─ scripts/
│  ├─ geocode.ts                     one-time: fill empty lat/lng via Census geocoder
│  ├─ check-data.ts                  validate CSV + print totals (CI)
│  ├─ fetch-map-assets.sh            one-time: copy Protomaps glyphs/sprites into public/map-assets
│  └─ r2-cors.json                   CORS rules for the tiles bucket
├─ public/
│  ├─ brand/monroe-logo.png, favicon.svg, robots.txt
│  └─ map-assets/fonts/…, map-assets/sprites/light*.{json,png}
├─ src/
│  ├─ env.d.ts                       PUBLIC_* env var types
│  ├─ lib/                           pure, unit-tested logic (no DOM)
│  │  ├─ schema.ts                   Zod Project schema, enums, labels, colors, GeoJSON types
│  │  ├─ parse-projects.ts           CSV text → { projects, errors }
│  │  ├─ load-projects.ts            build-time loader (throws on errors)
│  │  ├─ data-meta.ts                DATA_AS_OF
│  │  ├─ geojson.ts                  Project[] ↔ FeatureCollection
│  │  ├─ format.ts                   units/money/date/name/escapeHtml
│  │  ├─ stats.ts                    totals, countByStatus
│  │  ├─ filters.ts                  FilterState, applyFilters, sort, URL parse/serialize
│  │  ├─ geocode.ts                  Census query building/parsing
│  │  └─ og.ts                       satori → PNG
│  ├─ map/
│  │  ├─ brand-flavor.ts             Protomaps flavor in brand colors
│  │  ├─ style.ts                    buildStyle (pure, unit-tested)
│  │  ├─ basemap.ts                  createBaseMap (DOM/WebGL)
│  │  ├─ markers.ts                  markerSize, markerLabel, createMarkerElement
│  │  └─ popup.ts                    popupHtml
│  ├─ scripts/
│  │  ├─ sidebar.ts                  DOM read/write for filters, stats, list, sheet
│  │  └─ map-app.ts                  home page orchestration
│  ├─ styles/global.css              tokens + all site CSS
│  ├─ layouts/Base.astro             <head>, meta, fonts, header/footer
│  ├─ styles/map.css                 map page, markers, popup, bottom sheet
│  ├─ components/Header.astro, Footer.astro, StatTiles.astro, Filters.astro,
│  │             ProjectList.astro, MapView.astro, MiniMap.astro, StatusChip.astro
│  └─ pages/
│     ├─ index.astro                 map page
│     ├─ about.astro                 methodology
│     ├─ 404.astro
│     ├─ projects/[id].astro         27 static project pages
│     ├─ data/projects.geojson.ts    static GeoJSON endpoint
│     └─ og/[id].png.ts              OG images (27 projects + "site")
└─ tests/
   ├─ unit/*.test.ts, unit/fixtures.ts
   └─ e2e/*.spec.ts
```

---

### Task 1: Scaffold the Astro project

**Files:**
- Create: `package.json`, `astro.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `src/env.d.ts`, `src/pages/index.astro` (temporary), `README.md`
- Modify: `.gitignore`
- Move: `chicago_conversions_2026.csv` → `data/raw/chicago_conversions_2026.csv`, `image.jpg` → `data/raw/dpd-map-2026-06.jpg`

**Interfaces:**
- Produces: `pnpm dev|build|preview|check|test|test:e2e|data:check|geocode` scripts used by all later tasks.

- [ ] **Step 1: Move raw files**

```bash
mkdir -p data/raw
git mv chicago_conversions_2026.csv data/raw/chicago_conversions_2026.csv
git mv image.jpg data/raw/dpd-map-2026-06.jpg
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "chicago-pipeline",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "check": "astro check",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "data:check": "tsx scripts/check-data.ts",
    "geocode": "tsx scripts/geocode.ts"
  },
  "pnpm": {
    "onlyBuiltDependencies": ["esbuild", "sharp", "@resvg/resvg-js"]
  }
}
```

- [ ] **Step 3: Install dependencies**

```bash
pnpm add astro @astrojs/sitemap maplibre-gl pmtiles @protomaps/basemaps zod papaparse \
  @fontsource/inter @fontsource/newsreader satori @resvg/resvg-js
pnpm add -D typescript@^6 @astrojs/check vitest @playwright/test tsx @types/papaparse @types/node wrangler
npm pkg set packageManager="pnpm@$(pnpm -v)"
```

Expected majors: astro 7, maplibre-gl 6, pmtiles 4, @protomaps/basemaps 5, zod 4, vitest 5, typescript 6.

- [ ] **Step 4: Create `astro.config.mjs`**

```js
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://pipeline.monroeresidential.com",
  // `file` format + no trailing slash: /projects/x is served from projects/x.html on
  // Cloudflare Workers assets without a redirect, so canonical URLs match links.
  trailingSlash: "never",
  build: { format: "file" },
  integrations: [sitemap()],
});
```

- [ ] **Step 5: Create `tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist", "tiles"]
}
```

- [ ] **Step 6: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
  },
});
```

- [ ] **Step 7: Create `src/env.d.ts`**

```ts
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_PMTILES_URL?: string;
  readonly PUBLIC_MAP_ASSETS_URL?: string;
  readonly PUBLIC_CF_BEACON_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 8: Create temporary `src/pages/index.astro`**

```astro
---
---
<html lang="en"><body><h1>Chicago Pipeline</h1></body></html>
```

- [ ] **Step 9: Replace `.gitignore`**

```
node_modules/
dist/
.astro/
.wrangler/
.env
.env.production
.DS_Store
tiles/
test-results/
playwright-report/
```

- [ ] **Step 10: Create `README.md`**

````markdown
# Chicago Pipeline

Interactive map of Chicago's office-to-residential conversion pipeline.
Live at https://pipeline.monroeresidential.com.

## Develop

```bash
pnpm install
pnpm dev            # http://localhost:4321
pnpm test           # unit tests
pnpm test:e2e       # builds + Playwright
pnpm data:check     # validate data/projects.csv and print totals
```

## Updating project data

1. Edit `data/projects.csv` (one row per project; see column rules below).
2. Update `DATA_AS_OF` in `src/lib/data-meta.ts`.
3. New address? Leave `lat`/`lng` empty and run `pnpm geocode`, then check the pin on the map.
4. `pnpm data:check` must pass. Push to `main` to deploy.

Column rules: `status` ∈ completed | under_construction | permitted | approved | planning;
`program` ∈ lasalle | private; `confidence` ∈ dpd | reported; `sources` are URLs separated by ` | `;
numbers are plain digits (no `$`, `~`, commas); empty cells mean unknown.
````

- [ ] **Step 11: Verify the build**

Run: `pnpm build`
Expected: completes, `dist/index.html` exists.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: scaffold Astro project"
```

---

### Task 2: Project schema and CSV parser

**Files:**
- Create: `src/lib/schema.ts`, `src/lib/parse-projects.ts`, `tests/unit/fixtures.ts`
- Test: `tests/unit/parse-projects.test.ts`

**Interfaces:**
- Produces (from `src/lib/schema.ts`):
  - `STATUSES: readonly ["completed","under_construction","permitted","approved","planning"]`, `type Status`
  - `PROGRAMS: readonly ["lasalle","private"]`, `type Program`
  - `STATUS_LABELS: Record<Status,string>`, `STATUS_COLORS: Record<Status,string>`, `PROGRAM_LABELS: Record<Program,string>`
  - `DOWNTOWN_BBOX: { minLng, minLat, maxLng, maxLat }`
  - `ProjectSchema` (Zod), `type Project`
  - `type ProjectProperties = Omit<Project,"lat"|"lng"> & { as_of: string }`
  - `interface ProjectFeature`, `interface ProjectCollection`
- Produces (from `src/lib/parse-projects.ts`):
  - `CSV_COLUMNS: readonly string[]`
  - `parseProjectsCsv(text: string): { projects: Project[]; errors: string[] }`

- [ ] **Step 1: Create `tests/unit/fixtures.ts`**

```ts
import type { Project } from "../../src/lib/schema";

export function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: "111-w-monroe",
    dpd_map_no: 1,
    name: "Harris Bank building",
    address: "111 W. Monroe St",
    developer: "Prime/Capri Interests",
    units: 345,
    affordable_units: 104,
    tpc_musd: 179,
    program: "lasalle",
    public_support: "TIF",
    status: "approved",
    status_note: "Approved; in development",
    flag: null,
    confidence: "dpd",
    monroe_url: null,
    lat: 41.8805,
    lng: -87.6311,
    sources: ["https://www.chicago.gov/"],
    notes: null,
    ...over,
  };
}

export const CSV_HEADER =
  "id,dpd_map_no,name,address,developer,units,affordable_units,tpc_musd,program,public_support,status,status_note,flag,confidence,monroe_url,lat,lng,sources,notes";

export const GOOD_ROW =
  '111-w-monroe,1,Harris Bank building,111 W. Monroe St,Prime/Capri Interests,345,104,179,lasalle,"TIF + LaSalle ($40M)",approved,Approved; in development,,dpd,,41.8805,-87.6311,https://a.example/one | https://b.example/two,';
```

- [ ] **Step 2: Write the failing tests `tests/unit/parse-projects.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { parseProjectsCsv } from "../../src/lib/parse-projects";
import { CSV_HEADER, GOOD_ROW } from "./fixtures";

const csv = (...rows: string[]) => [CSV_HEADER, ...rows].join("\n");

describe("parseProjectsCsv", () => {
  it("parses a valid row into a typed Project", () => {
    const { projects, errors } = parseProjectsCsv(csv(GOOD_ROW));
    expect(errors).toEqual([]);
    expect(projects).toHaveLength(1);
    const p = projects[0]!;
    expect(p.id).toBe("111-w-monroe");
    expect(p.dpd_map_no).toBe(1);
    expect(p.units).toBe(345);
    expect(p.tpc_musd).toBe(179);
    expect(p.public_support).toBe("TIF + LaSalle ($40M)");
    expect(p.flag).toBeNull();
    expect(p.monroe_url).toBeNull();
    expect(p.notes).toBeNull();
    expect(p.sources).toEqual(["https://a.example/one", "https://b.example/two"]);
  });

  it("turns empty optional cells into null", () => {
    const row = GOOD_ROW.replace("Harris Bank building", "").replace(",345,104,179,", ",,,,");
    const { projects, errors } = parseProjectsCsv(csv(row));
    expect(errors).toEqual([]);
    expect(projects[0]!.name).toBeNull();
    expect(projects[0]!.units).toBeNull();
    expect(projects[0]!.tpc_musd).toBeNull();
  });

  it("rejects non-numeric numbers with row and column", () => {
    const row = GOOD_ROW.replace(",345,", ",~345,");
    const { projects, errors } = parseProjectsCsv(csv(row));
    expect(projects).toEqual([]);
    expect(errors).toEqual([expect.stringMatching(/Row 2 \(111-w-monroe\).*units "~345" is not a number/)]);
  });

  it("rejects an unknown status", () => {
    const row = GOOD_ROW.replace(",approved,", ",stalled,");
    const { errors } = parseProjectsCsv(csv(row));
    expect(errors).toEqual([expect.stringMatching(/Row 2 \(111-w-monroe\): status/)]);
  });

  it("rejects missing coordinates", () => {
    const row = GOOD_ROW.replace(",41.8805,-87.6311,", ",,,");
    const { errors } = parseProjectsCsv(csv(row));
    expect(errors.join("\n")).toMatch(/lat/);
    expect(errors.join("\n")).toMatch(/lng/);
  });

  it("rejects coordinates outside downtown Chicago", () => {
    const row = GOOD_ROW.replace(",41.8805,-87.6311,", ",40.7128,-74.0060,");
    const { errors } = parseProjectsCsv(csv(row));
    expect(errors.join("\n")).toMatch(/lat/);
  });

  it("rejects duplicate ids", () => {
    const { projects, errors } = parseProjectsCsv(csv(GOOD_ROW, GOOD_ROW));
    expect(projects).toHaveLength(1);
    expect(errors).toEqual([expect.stringMatching(/Row 3 \(111-w-monroe\): duplicate id/)]);
  });

  it("reports missing columns", () => {
    const { errors } = parseProjectsCsv("id,address\nfoo,1 Main St");
    expect(errors[0]).toMatch(/Missing columns: dpd_map_no/);
  });

  it("rejects non-URL sources", () => {
    const row = GOOD_ROW.replace("https://a.example/one | https://b.example/two", "Crain's");
    const { errors } = parseProjectsCsv(csv(row));
    expect(errors.join("\n")).toMatch(/sources/);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test tests/unit/parse-projects.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/parse-projects`.

- [ ] **Step 4: Create `src/lib/schema.ts`**

```ts
import { z } from "zod";

export const STATUSES = ["completed", "under_construction", "permitted", "approved", "planning"] as const;
export const StatusSchema = z.enum(STATUSES);
export type Status = z.infer<typeof StatusSchema>;

export const STATUS_LABELS: Record<Status, string> = {
  completed: "Completed",
  under_construction: "Under construction",
  permitted: "Permitted",
  approved: "Approved",
  planning: "Planning",
};

export const STATUS_COLORS: Record<Status, string> = {
  completed: "#00051B",
  under_construction: "#33709B",
  permitted: "#2E8B7A",
  approved: "#C28A2C",
  planning: "#8C96A3",
};

export const PROGRAMS = ["lasalle", "private"] as const;
export const ProgramSchema = z.enum(PROGRAMS);
export type Program = z.infer<typeof ProgramSchema>;

export const PROGRAM_LABELS: Record<Program, string> = {
  lasalle: "LaSalle Reimagined",
  private: "Private market",
};

// Loose box around downtown Chicago; catches geocoder mistakes (wrong city, swapped lat/lng).
export const DOWNTOWN_BBOX = { minLng: -87.72, minLat: 41.84, maxLng: -87.58, maxLat: 41.93 } as const;

export const ProjectSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be a lowercase slug"),
  dpd_map_no: z.number().int().min(1).max(25).nullable(),
  name: z.string().min(1).nullable(),
  address: z.string().min(1),
  developer: z.string().min(1).nullable(),
  units: z.number().int().positive().nullable(),
  affordable_units: z.number().int().nonnegative().nullable(),
  tpc_musd: z.number().positive().nullable(),
  program: ProgramSchema,
  public_support: z.string().min(1).nullable(),
  status: StatusSchema,
  status_note: z.string().min(1),
  flag: z.string().min(1).nullable(),
  confidence: z.enum(["dpd", "reported"]),
  monroe_url: z.url().nullable(),
  lat: z.number().min(DOWNTOWN_BBOX.minLat).max(DOWNTOWN_BBOX.maxLat),
  lng: z.number().min(DOWNTOWN_BBOX.minLng).max(DOWNTOWN_BBOX.maxLng),
  sources: z.array(z.url()).min(1),
  notes: z.string().min(1).nullable(),
});
export type Project = z.infer<typeof ProjectSchema>;

export type ProjectProperties = Omit<Project, "lat" | "lng"> & { as_of: string };

export interface ProjectFeature {
  type: "Feature";
  id: string;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: ProjectProperties;
}

export interface ProjectCollection {
  type: "FeatureCollection";
  as_of: string;
  features: ProjectFeature[];
}
```

- [ ] **Step 5: Create `src/lib/parse-projects.ts`**

```ts
import Papa from "papaparse";
import { ProjectSchema, type Project } from "./schema";

export const CSV_COLUMNS = [
  "id", "dpd_map_no", "name", "address", "developer", "units", "affordable_units", "tpc_musd",
  "program", "public_support", "status", "status_note", "flag", "confidence", "monroe_url",
  "lat", "lng", "sources", "notes",
] as const;

const NUMERIC_COLUMNS = new Set<string>(["dpd_map_no", "units", "affordable_units", "tpc_musd", "lat", "lng"]);

export interface ParseResult {
  projects: Project[];
  errors: string[];
}

function toNumber(raw: string): number | null | "invalid" {
  if (raw === "") return null;
  return /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : "invalid";
}

export function parseProjectsCsv(text: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const errors = parsed.errors.map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`);

  const fields = parsed.meta.fields ?? [];
  const missing = CSV_COLUMNS.filter((c) => !fields.includes(c));
  if (missing.length > 0) return { projects: [], errors: [...errors, `Missing columns: ${missing.join(", ")}`] };

  const projects: Project[] = [];
  const seen = new Set<string>();

  parsed.data.forEach((row, index) => {
    const label = `Row ${index + 2} (${row.id?.trim() || "no id"})`; // +2: header is row 1
    const rowErrors: string[] = [];
    const candidate: Record<string, unknown> = {};

    for (const column of CSV_COLUMNS) {
      const raw = (row[column] ?? "").trim();
      if (NUMERIC_COLUMNS.has(column)) {
        const n = toNumber(raw);
        if (n === "invalid") rowErrors.push(`${column} "${raw}" is not a number`);
        else candidate[column] = n;
      } else if (column === "sources") {
        candidate[column] = raw.split("|").map((s) => s.trim()).filter(Boolean);
      } else {
        candidate[column] = raw === "" ? null : raw;
      }
    }

    if (rowErrors.length === 0) {
      const result = ProjectSchema.safeParse(candidate);
      if (!result.success) {
        for (const issue of result.error.issues) rowErrors.push(`${issue.path.join(".")}: ${issue.message}`);
      } else if (seen.has(result.data.id)) {
        rowErrors.push(`duplicate id "${result.data.id}"`);
      } else {
        seen.add(result.data.id);
        projects.push(result.data);
      }
    }

    errors.push(...rowErrors.map((e) => `${label}: ${e}`));
  });

  return { projects, errors };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test tests/unit/parse-projects.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/schema.ts src/lib/parse-projects.ts tests/unit
git commit -m "feat: project schema and validated CSV parser"
```

---

### Task 3: Formatting, totals, filters and URL state

**Files:**
- Create: `src/lib/format.ts`, `src/lib/stats.ts`, `src/lib/filters.ts`
- Test: `tests/unit/format.test.ts`, `tests/unit/stats.test.ts`, `tests/unit/filters.test.ts`

**Interfaces:**
- Consumes: `Project`, `Status`, `Program`, `STATUSES`, `PROGRAMS` from `src/lib/schema.ts`; `makeProject` from `tests/unit/fixtures.ts`.
- Produces (`format.ts`): `EMPTY = "—"`, `formatUnits(n: number|null): string`, `formatMoney(musd: number|null): string`, `formatDate(iso: string): string`, `displayName(p: Pick<Project,"name"|"address">): string`, `escapeHtml(s: string): string`, `hostname(url: string): string`
- Produces (`stats.ts`): `interface Totals { count: number; units: number; tpcMusd: number }`, `totals(projects: readonly Project[]): Totals`, `countByStatus(projects: readonly Project[]): Record<Status, number>`
- Produces (`filters.ts`): `interface FilterState { statuses: Status[]; programs: Program[]; selected: string|null }`, `DEFAULT_FILTERS`, `type SortKey = "units"|"tpc"|"status"`, `applyFilters(projects, state): Project[]`, `sortProjects(projects, key): Project[]`, `reconcileSelection(state, visibleIds: readonly string[]): FilterState`, `parseFilterState(search: string, knownIds: readonly string[]): FilterState`, `serializeFilterState(state): string`

- [ ] **Step 1: Write failing `tests/unit/format.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { displayName, escapeHtml, formatDate, formatMoney, formatUnits, hostname } from "../../src/lib/format";

describe("format", () => {
  it("formats units with separators and em dash for null", () => {
    expect(formatUnits(4210)).toBe("4,210");
    expect(formatUnits(null)).toBe("—");
  });

  it("formats millions and billions", () => {
    expect(formatMoney(179)).toBe("$179M");
    expect(formatMoney(6.5)).toBe("$6.5M");
    expect(formatMoney(1839.8)).toBe("$1.84B");
    expect(formatMoney(1000)).toBe("$1B");
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(0)).toBe("$0M");
  });

  it("formats ISO dates without timezone drift", () => {
    expect(formatDate("2026-09-28")).toBe("September 28, 2026");
  });

  it("falls back to the address when there is no name", () => {
    expect(displayName({ name: null, address: "118 S. Clinton St" })).toBe("118 S. Clinton St");
    expect(displayName({ name: "The Smith", address: "223 W. Erie St" })).toBe("The Smith");
  });

  it("escapes HTML-significant characters", () => {
    expect(escapeHtml(`Riverside & "AmTrust" <DL3> Crain's`)).toBe(
      "Riverside &amp; &quot;AmTrust&quot; &lt;DL3&gt; Crain&#39;s",
    );
  });

  it("extracts a readable hostname", () => {
    expect(hostname("https://www.chicago.gov/city/en.html")).toBe("chicago.gov");
    expect(hostname("https://chicago.urbanize.city/post/x")).toBe("chicago.urbanize.city");
  });
});
```

- [ ] **Step 2: Write failing `tests/unit/stats.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { countByStatus, totals } from "../../src/lib/stats";
import { makeProject } from "./fixtures";

describe("stats", () => {
  it("sums units and TPC, treating null as zero", () => {
    const t = totals([
      makeProject({ id: "a", units: 100, tpc_musd: 10.5 }),
      makeProject({ id: "b", units: null, tpc_musd: null }),
      makeProject({ id: "c", units: 50, tpc_musd: 20 }),
    ]);
    expect(t).toEqual({ count: 3, units: 150, tpcMusd: 30.5 });
  });

  it("returns zeros for an empty list", () => {
    expect(totals([])).toEqual({ count: 0, units: 0, tpcMusd: 0 });
  });

  it("counts every status, including zero", () => {
    const c = countByStatus([makeProject({ status: "approved" }), makeProject({ id: "b", status: "approved" })]);
    expect(c).toEqual({ completed: 0, under_construction: 0, permitted: 0, approved: 2, planning: 0 });
  });
});
```

- [ ] **Step 3: Write failing `tests/unit/filters.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  applyFilters, DEFAULT_FILTERS, parseFilterState, reconcileSelection, serializeFilterState, sortProjects,
} from "../../src/lib/filters";
import { makeProject } from "./fixtures";

const A = makeProject({ id: "a", status: "completed", program: "lasalle", units: 100, tpc_musd: 50 });
const B = makeProject({ id: "b", status: "approved", program: "private", units: 300, tpc_musd: null });
const C = makeProject({ id: "c", status: "planning", program: "private", units: null, tpc_musd: 90 });
const ALL = [A, B, C];
const IDS = ALL.map((p) => p.id);

describe("applyFilters", () => {
  it("keeps everything by default", () => {
    expect(applyFilters(ALL, DEFAULT_FILTERS)).toEqual(ALL);
  });
  it("filters by status and program together", () => {
    expect(applyFilters(ALL, { ...DEFAULT_FILTERS, statuses: ["approved", "planning"], programs: ["private"] })).toEqual([B, C]);
  });
  it("returns nothing when all statuses are unchecked", () => {
    expect(applyFilters(ALL, { ...DEFAULT_FILTERS, statuses: [] })).toEqual([]);
  });
});

describe("sortProjects", () => {
  it("sorts by units descending with nulls last", () => {
    expect(sortProjects(ALL, "units").map((p) => p.id)).toEqual(["b", "a", "c"]);
  });
  it("sorts by TPC descending with nulls last", () => {
    expect(sortProjects(ALL, "tpc").map((p) => p.id)).toEqual(["c", "a", "b"]);
  });
  it("sorts by status pipeline order", () => {
    expect(sortProjects([C, B, A], "status").map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
  it("does not mutate its input", () => {
    const input = [C, B, A];
    sortProjects(input, "units");
    expect(input.map((p) => p.id)).toEqual(["c", "b", "a"]);
  });
});

describe("reconcileSelection", () => {
  it("drops a selection that is filtered out", () => {
    expect(reconcileSelection({ ...DEFAULT_FILTERS, selected: "b" }, ["a"]).selected).toBeNull();
  });
  it("keeps a visible selection", () => {
    expect(reconcileSelection({ ...DEFAULT_FILTERS, selected: "a" }, ["a"]).selected).toBe("a");
  });
});

describe("URL state", () => {
  it("serializes the default state to an empty string", () => {
    expect(serializeFilterState(DEFAULT_FILTERS)).toBe("");
  });
  it("round-trips a filtered, selected state", () => {
    const q = serializeFilterState({ statuses: ["planning", "completed"], programs: ["private"], selected: "a" });
    expect(q).toBe("?status=completed,planning&program=private&project=a");
    expect(parseFilterState(q, IDS)).toEqual({ statuses: ["completed", "planning"], programs: ["private"], selected: "a" });
  });
  it("encodes all-unchecked as none", () => {
    const q = serializeFilterState({ ...DEFAULT_FILTERS, statuses: [] });
    expect(q).toBe("?status=none");
    expect(parseFilterState(q, IDS).statuses).toEqual([]);
  });
  it("ignores unknown values and unknown project ids", () => {
    expect(parseFilterState("?status=bogus&program=x&project=deleted-id", IDS)).toEqual(DEFAULT_FILTERS);
  });
  it("keeps valid values alongside invalid ones", () => {
    expect(parseFilterState("?status=bogus,approved", IDS).statuses).toEqual(["approved"]);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — cannot resolve `format`, `stats`, `filters`.

- [ ] **Step 5: Create `src/lib/format.ts`**

```ts
import type { Project } from "./schema";

export const EMPTY = "—";

export function formatUnits(n: number | null): string {
  return n === null ? EMPTY : n.toLocaleString("en-US");
}

export function formatMoney(musd: number | null): string {
  if (musd === null) return EMPTY;
  if (musd >= 1000) return `$${(musd / 1000).toFixed(2).replace(/\.?0+$/, "")}B`;
  return `$${Number.isInteger(musd) ? musd : musd.toFixed(1)}M`;
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC", month: "long", day: "numeric", year: "numeric",
  });
}

export function displayName(p: Pick<Project, "name" | "address">): string {
  return p.name ?? p.address;
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

export function hostname(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}
```

- [ ] **Step 6: Create `src/lib/stats.ts`**

```ts
import { STATUSES, type Project, type Status } from "./schema";

export interface Totals {
  count: number;
  units: number;
  tpcMusd: number;
}

export function totals(projects: readonly Project[]): Totals {
  const t = { count: projects.length, units: 0, tpcMusd: 0 };
  for (const p of projects) {
    t.units += p.units ?? 0;
    t.tpcMusd += p.tpc_musd ?? 0;
  }
  t.tpcMusd = Math.round(t.tpcMusd * 10) / 10; // avoid 1839.7999999
  return t;
}

export function countByStatus(projects: readonly Project[]): Record<Status, number> {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
  for (const p of projects) counts[p.status] += 1;
  return counts;
}
```

- [ ] **Step 7: Create `src/lib/filters.ts`**

```ts
import { PROGRAMS, STATUSES, type Program, type Project, type Status } from "./schema";

export interface FilterState {
  statuses: Status[];
  programs: Program[];
  selected: string | null;
}

export const DEFAULT_FILTERS: FilterState = { statuses: [...STATUSES], programs: [...PROGRAMS], selected: null };

export type SortKey = "units" | "tpc" | "status";

export function applyFilters(projects: readonly Project[], state: FilterState): Project[] {
  return projects.filter((p) => state.statuses.includes(p.status) && state.programs.includes(p.program));
}

function desc(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

export function sortProjects(projects: readonly Project[], key: SortKey): Project[] {
  const rank = (s: Status) => STATUSES.indexOf(s);
  return [...projects].sort((a, b) => {
    const primary =
      key === "units" ? desc(a.units, b.units)
      : key === "tpc" ? desc(a.tpc_musd, b.tpc_musd)
      : rank(a.status) - rank(b.status);
    return primary || desc(a.units, b.units) || a.id.localeCompare(b.id);
  });
}

export function reconcileSelection(state: FilterState, visibleIds: readonly string[]): FilterState {
  return state.selected && !visibleIds.includes(state.selected) ? { ...state, selected: null } : state;
}

function parseList<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  if (raw === null) return [...allowed];
  if (raw === "none") return [];
  const wanted = raw.split(",");
  const valid = allowed.filter((v) => wanted.includes(v));
  return valid.length > 0 ? valid : [...allowed];
}

export function parseFilterState(search: string, knownIds: readonly string[]): FilterState {
  const params = new URLSearchParams(search);
  const project = params.get("project");
  return {
    statuses: parseList(params.get("status"), STATUSES),
    programs: parseList(params.get("program"), PROGRAMS),
    selected: project && knownIds.includes(project) ? project : null,
  };
}

export function serializeFilterState(state: FilterState): string {
  const parts: string[] = [];
  const list = <T extends string>(key: string, values: readonly T[], allowed: readonly T[]) => {
    if (values.length === allowed.length) return;
    parts.push(`${key}=${values.length === 0 ? "none" : allowed.filter((v) => values.includes(v)).join(",")}`);
  };
  list("status", state.statuses, STATUSES);
  list("program", state.programs, PROGRAMS);
  if (state.selected) parts.push(`project=${encodeURIComponent(state.selected)}`);
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS (all suites).

- [ ] **Step 9: Commit**

```bash
git add src/lib tests/unit
git commit -m "feat: formatting, totals, filter and URL-state logic"
```

---

### Task 4: Project data, geocoding and data check

**Files:**
- Create: `data/projects.csv`, `src/lib/geocode.ts`, `src/lib/data-meta.ts`, `src/lib/load-projects.ts`, `src/lib/geojson.ts`, `scripts/geocode.ts`, `scripts/check-data.ts`
- Test: `tests/unit/geocode.test.ts`, `tests/unit/geojson.test.ts`, `tests/unit/data.test.ts`

**Interfaces:**
- Consumes: `parseProjectsCsv`, `CSV_COLUMNS` (Task 2); `totals`, `countByStatus` (Task 3).
- Produces:
  - `toGeocodeQuery(address: string): string`, `parseCensusResponse(json: unknown): { lat: number; lng: number } | null`
  - `DATA_AS_OF: string` (`"2026-09-28"`)
  - `loadProjects(): Project[]` — build-time only, throws listing every CSV error
  - `toFeatureCollection(projects: readonly Project[], asOf: string): ProjectCollection`, `featureToProject(f: ProjectFeature): Project`

- [ ] **Step 1: Create `data/projects.csv`** (cleaned from `data/raw/chicago_conversions_2026.csv`; DPD values preferred; internal remarks removed; `lat`/`lng` empty until Step 7)

```csv
id,dpd_map_no,name,address,developer,units,affordable_units,tpc_musd,program,public_support,status,status_note,flag,confidence,monroe_url,lat,lng,sources,notes
111-w-monroe,1,Harris Bank building,111 W. Monroe St,Prime/Capri Interests,345,104,179,lasalle,TIF + LaSalle Street Reimagined (~$40M TIF),approved,Approved (CDC + City Council); in development,,dpd,,,,https://www.chicago.gov/content/city/en/sites/lasalle-street/proposals.html | https://chicago.cooperatornews.com/article/chicagolands-office--to-residential-boom,
208-s-lasalle,2,Continental & Commercial Natl Bank bldg (floors 13-16),208 S. LaSalle St,UST Prime III Office Owner (Prime Group affiliate),168,51,100,lasalle,TIF + LaSalle Street Reimagined ($26M TIF),approved,Approved (CDC + City Council); in development,,dpd,,,,https://www.chicago.gov/content/city/en/sites/lasalle-street/proposals.html | https://chicago.cooperatornews.com/article/chicagolands-office--to-residential-boom,
30-n-lasalle,3,,30 N. LaSalle St,Golub & Co. with American General Life Insurance,349,105,132,lasalle,TIF + LaSalle Street Reimagined (up to $57M TIF),approved,Approved; in development,,dpd,,,,https://www.chicago.gov/content/city/en/sites/lasalle-street/proposals.html | https://chicago.cooperatornews.com/article/chicagolands-office--to-residential-boom,TPC: DPD map $132M; City proposals page $130M.
79-w-monroe,4,The Bellwether,79 W. Monroe St,R2 Development,117,41,64,lasalle,TIF + LaSalle Street Reimagined ($28M TIF),completed,"Completed; opened Sep 9, 2026 (was under construction mid-2026)",,dpd,,,,https://www.chicago.gov/content/city/en/sites/lasalle-street/proposals.html | https://www.chicago.gov/city/en/depts/mayor/press_room/press_releases/2026/september/bellwhether-ribbon-cutting.html,First LaSalle Street Reimagined project delivered.
135-s-lasalle,5,Field Building,135 S. LaSalle St,"Riverside Investment & Development, AmTrust RE, DL3 Realty",386,116,242,lasalle,TIF + LaSalle Street Reimagined ($98M TIF),approved,"Approved (CDC, Landmarks, City Council); in development",,dpd,,,,https://www.chicago.gov/content/city/en/sites/lasalle-street/proposals.html | https://chicago.cooperatornews.com/article/chicagolands-office--to-residential-boom,TPC: DPD map $242M; City page $241M; Cooperator $241.5M.
105-w-adams,6,Clark Adams Building (Bankers Building),105 W. Adams St,Primera Group Inc. (per City),400,121,184,lasalle,TIF + LaSalle Street Reimagined ($67.5M TIF),approved,"Approved (TIF $67.5M passed Council Dec 4, 2025); ownership lawsuit pending (Crain's Jul 2, 2026); no construction start confirmed",Ownership lawsuit pending,dpd,,,,https://www.chicago.gov/content/city/en/sites/lasalle-street/proposals.html | https://chicago.urbanize.city/project/clark-adams-renewal,"Urbanize (Feb 2026) reports 247 apartments and lists Celadon Partners/Blackwood Group; City and DPD map show 400 units. Crain's (Jul 2, 2026) reports a lawsuit threatening the project."
65-e-wacker,7,Wacker Place (Millinery Mart),65 E. Wacker Pl,Mavrek Development + Cross Street; capital partner ACRES,252,51,100,private,Private (ARO affordable; ~$17M historic tax credits),under_construction,Under construction since Sep 2025 (permit 9/11/2025); pre-leasing; first move-ins Aug 2026,,dpd,,,,https://chicago.suntimes.com/real-estate/2026/06/15/loop-building-residential-wave-office-conversions | https://chicago.cooperatornews.com/article/chicagolands-office--to-residential-boom,TPC: DPD map $100M; Sun-Times $106M.
500-n-michigan,8,,500 N. Michigan Ave,Commonwealth Development Partners (GC Skender),320,64,162,private,Private (ARO affordable),under_construction,"Under construction (work began ~May 2026; groundbreaking Jul 29, 2026); $113M financing",,dpd,,,,https://www.chicago.gov/city/en/depts/mayor/press_room/press_releases/2026/july/residential-conversion-groundbreaking.html | https://www.multihousingnews.com/commonwealth-lands-113m-in-financing-for-chicagos-largest-conversion-project/,
1006-s-michigan,9,Lightner / Graphic Arts Building,1006 S. Michigan Ave,"JK Equities, Oak Capitals, Time Equities",49,,30,private,Private,approved,Approved by City Council Apr 2025; Listed for sale May 2026 as 'fully entitled' - not under construction,Listed for sale; no construction,dpd,,,,https://chicago.urbanize.city/post/residential-conversion-1006-s-michigan-approved-city-council | https://therealdeal.com/chicago/2026/05/14/time-equities-lists-historic-south-loop-lofts-for-conversion/,TPC: DPD map $30M; Urbanize $14.5M.
111-w-illinois,10,111 Point (former Salesforce office),111 W. Illinois St,Path Construction + WindWave Real Estate,153,,64,private,Private,completed,Completed; opened May 2026,,dpd,,,,https://chicago.urbanize.city/post/111-point-celebrates-ribbon-cutting | https://chicago.suntimes.com/real-estate/2026/04/10/former-salesforce-office-residents-river-north-building-apartments,"Permit (Jul 11, 2025): 103 dwelling units + 50 efficiency units."
116-122-w-illinois,11,Boylston Building Lofts,116-122 W. Illinois St,Mo2 Properties with Monroe Residential; GC 3F Construction,36,0,6.5,private,Private (market rate),under_construction,Under construction (permit 7/21/2025),,dpd,https://monroeresidential.com/portfolio/boylston,,,https://chicago.suntimes.com/real-estate/2024/10/24/river-north-more-apartments-two-office-residential-projects | https://3fconstruction.net/project/boylston-building-lofts/,
309-w-washington,12,Telephone Square Building,309 W. Washington St,Creative Designs Chicago,84,,10,private,Private,approved,ZBA approved Aug 2025; permits in process; no construction timeline announced,,dpd,,,,https://chicago.urbanize.city/post/zba-approves-variations-residential-conversion-309-w-washington,
223-w-erie,13,The Smith,223 W. Erie St,Concord Capital; GC 3F Construction,66,,18.4,private,Private,under_construction,Under construction (City Council approved Oct 2025; reno permit 4/3/2026); delivery spring 2027,,dpd,,,,https://chicago.urbanize.city/post/reno-permit-issued-residential-conversion-223-w-erie | https://3fconstruction.net/project/the-smith-at-223-w-erie-street/,
444-n-wabash,14,,444 N. Wabash Ave,KJF Properties,34,,6,private,Private,under_construction,Permitted (reno permit issued; under construction),,dpd,,,,https://chicago.urbanize.city/post/reno-permit-issued-residential-conversion-444-n-wabash,
55-e-washington,15,Pittsfield Building,55 E. Washington St,PO 55 LLC (Tom Liravongsa),214,43,195,private,Private (ARO ~20% affordable),approved,Approved by Plan Commission + City Council Sep 2025; in development,,dpd,,,,https://blockclubchicago.org/2025/09/25/plan-to-convert-pittsfield-building-offices-into-apartments-gets-city-council-ok/ | https://chicago.urbanize.city/post/city-council-approves-pittsfield-building-redevelopment,DPD map counts 214 additional units (added to 228 existing apartments).
1060-w-van-buren,16,Universal Overall Co. loft,1060 W. Van Buren St,F and F Realty Partners / West VB LLC,111,,36,private,Private,approved,Approved by City Council Feb 2026; construction targeted 2H 2026,,dpd,,,,https://chicago.urbanize.city/post/city-council-approves-development-1060-w-van-buren | https://www.linkedin.com/posts/chicagodpd_plan-commission-approved-west-vb-llvs-126-activity-7417655517122326528-EYGr,DPD map counts only the 111-unit loft conversion; a 214-unit new tower on the site is excluded. Whole development TPC reported at $126M.
19-s-lasalle,17,Former Central YMCA,19 S. LaSalle St,Envoi Partners,207,,64,private,Private,permitted,ZBA approved Jul 2026; permits issued; completion 2027,,dpd,,,,https://chicagoyimby.com/2026/07/conversion-fully-approved-for-19-south-lasalle-street-in-the-loop.html | https://chicago.urbanize.city/post/adaptive-reuse-advances-permits-and-variations-19-s-lasalle,DPD map 207 units = 175 apartments + 32 hotel rooms (YIMBY/Urbanize).
401-w-ontario,18,Birken Lofts,401 W. Ontario St,Monroe Residential Partners with Belgravia Group; GC 3F Construction; Westfield Architects,88,,20,private,Private (zero parking),permitted,ZBA approved; reno permit issued ~Sep 2026; construction starting ~fall 2026,,dpd,https://monroeresidential.com/portfolio/birken-lofts,,,https://chicago.urbanize.city/post/reno-permit-issued-residential-conversion-401-w-ontario | https://www.optionpremier.com/blogs/401-w-ontario-river-north-apartments-zero-parking,DPD map shows 88 units; project materials show 57 units.
56-e-superior,19,,56 E. Superior St,Honore Properties + Peerless Development,88,,30,private,Private,permitted,Zoning approved Dec 2025; permit issued; delivery spring 2027,,dpd,,,,https://chicago.urbanize.city/post/permit-issued-office-resi-conversion-56-e-superior | https://chicago.suntimes.com/real-estate/2025/12/11/vacant-river-north-office-building-residential-honore-peerless-development,
212-e-ohio,20,,212 E. Ohio St,Cubed Real Estate (Eric Weber); GC Aspen Developers Group,28,,3.9,private,Private,permitted,City Council approved Jun 2026; reno permit issued Sep 2026,,dpd,,,,https://chicagoyimby.com/2026/06/streeterville-residential-conversion-approved-by-city-council.html | https://chicago.urbanize.city/post/reno-permit-issued-residential-conversion-212-e-ohio,
445-w-erie,21,Loft building,445 W. Erie St,Concord Capital,33,,6,private,Private,planning,"Acquired 2026 (with Pontiac Bldg, $8.5M total); no rezoning needed; construction planned fall 2026",,dpd,,,,https://www.preservationchicago.org/win-adaptive-reuse-planned-for-pontiac-building-at-542-s-dearborn-street-and-loft-building-at-445-w-erie-street/,
542-s-dearborn,22,Pontiac Building,542 S. Dearborn St,Concord Capital (NORR design),74,,11,private,Private,planning,Acquired Apr 2026; planning stage,,dpd,,,,https://www.preservationchicago.org/win-adaptive-reuse-planned-for-pontiac-building-at-542-s-dearborn-street-and-loft-building-at-445-w-erie-street/,
1220-w-van-buren,23,Oxxford Lofts,1220 W. Van Buren St,Base 3 + The Missner Group,112,22,16,private,Private,under_construction,Under construction (permit 4/10/2026); delivery spring/summer 2027,,dpd,,,,https://chicago.urbanize.city/post/construction-begins-oxxford-lofts-1220-w-van-buren | https://multifamilyaffordablehousing.com/missner-group-base-3-begin-construction-on-42m-industrial-to-residential-project-in-chicago/,Affordable units: ~20% (about 22) reported. TPC: DPD map $16M; MFAHB $42M. Former clothing factory (industrial).
230-e-ohio,24,,230 E. Ohio St,Wildwood Investments + Concord Capital (NORR),72,,30,private,Private,under_construction,Under construction (reno permit 9/26/2025); completion ~Dec 2026; $21.1M Associated Bank loan,,dpd,,,,https://newsroom.associatedbank.com/releases/associated-bank-finalizes-21-1m-financing-for-chicago-mixed-use-building-conversion-to-multifamily-units | https://chicago.urbanize.city/post/zba-approves-variance-resi-conversion-230-e-ohio,
209-w-jackson,25,McKinlock Building,209 W. Jackson St,ACRES Capital + Mavrek,180,,90,private,Private,planning,Securing financing; completion targeted early 2029,,dpd,,,,https://chicagoyimby.com/2026/06/details-revealed-for-209-west-jackson-street-in-the-loop.html,Unit count approximate.
70-e-lake,,Former DePaul office tower,70 E. Lake St,Honore Properties,170,,40,private,Private (per reports),planning,Bought Jul 2026 ($9.2M); construction expected 2027,,reported,,,,https://therealdeal.com/chicago/2026/07/16/shenoudas-honore-snags-70-east-lake-for-9m/ | https://www.preservationchicago.org/win-old-depaul-university-loop-office-tower-at-70-e-lake-street-sold-for-residential-adaptive-reuse/,Not on the June 2026 DPD map. Purchased Jul 2026 for $9.2M.
118-s-clinton,,,118 S. Clinton St,,74,,,private,,permitted,Reno permit issued 5/20/2025 to convert office bldg to 74 DUs (Chicago Cityscape permit list),,reported,,,,https://www.chicagocityscape.com/tag/convertcommercialtoresidential,Not on the June 2026 DPD map. Developer and current status not verified.
```

- [ ] **Step 2: Write failing `tests/unit/geocode.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { parseCensusResponse, toGeocodeQuery } from "../../src/lib/geocode";

describe("toGeocodeQuery", () => {
  it("uses the first number of a range, strips periods, adds city", () => {
    expect(toGeocodeQuery("116-122 W. Illinois St")).toBe("116 W Illinois St, Chicago, IL");
    expect(toGeocodeQuery("111 W. Monroe St")).toBe("111 W Monroe St, Chicago, IL");
  });
});

describe("parseCensusResponse", () => {
  it("returns the first match's coordinates", () => {
    const json = { result: { addressMatches: [{ coordinates: { x: -87.6311, y: 41.8805 } }] } };
    expect(parseCensusResponse(json)).toEqual({ lat: 41.8805, lng: -87.6311 });
  });
  it("returns null when there is no match or the shape is wrong", () => {
    expect(parseCensusResponse({ result: { addressMatches: [] } })).toBeNull();
    expect(parseCensusResponse({ nope: true })).toBeNull();
    expect(parseCensusResponse(null)).toBeNull();
  });
});
```

- [ ] **Step 3: Write failing `tests/unit/geojson.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { featureToProject, toFeatureCollection } from "../../src/lib/geojson";
import { makeProject } from "./fixtures";

describe("geojson", () => {
  it("builds [lng, lat] point features with as_of and round-trips", () => {
    const p = makeProject();
    const fc = toFeatureCollection([p], "2026-09-28");
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.as_of).toBe("2026-09-28");
    const f = fc.features[0]!;
    expect(f.id).toBe(p.id);
    expect(f.geometry.coordinates).toEqual([p.lng, p.lat]);
    expect(f.properties.as_of).toBe("2026-09-28");
    expect(f.properties).not.toHaveProperty("lat");
    expect(featureToProject(f)).toEqual(p);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm test tests/unit/geocode.test.ts tests/unit/geojson.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 5: Create `src/lib/geocode.ts`, `src/lib/geojson.ts`, `src/lib/data-meta.ts`**

`src/lib/geocode.ts`:
```ts
export function toGeocodeQuery(address: string): string {
  const cleaned = address.replace(/^(\d+)-\d+/, "$1").replace(/\./g, "");
  return `${cleaned}, Chicago, IL`;
}

interface CensusResponse {
  result?: { addressMatches?: { coordinates?: { x?: unknown; y?: unknown } }[] };
}

export function parseCensusResponse(json: unknown): { lat: number; lng: number } | null {
  const c = (json as CensusResponse | null)?.result?.addressMatches?.[0]?.coordinates;
  if (typeof c?.x !== "number" || typeof c?.y !== "number") return null;
  return { lat: c.y, lng: c.x };
}
```

`src/lib/geojson.ts`:
```ts
import type { Project, ProjectCollection, ProjectFeature } from "./schema";

export function toFeatureCollection(projects: readonly Project[], asOf: string): ProjectCollection {
  return {
    type: "FeatureCollection",
    as_of: asOf,
    features: projects.map(({ lat, lng, ...rest }) => ({
      type: "Feature",
      id: rest.id,
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: { ...rest, as_of: asOf },
    })),
  };
}

export function featureToProject(f: ProjectFeature): Project {
  const { as_of: _asOf, ...rest } = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  return { ...rest, lat, lng };
}
```

`src/lib/data-meta.ts`:
```ts
// Bump whenever data/projects.csv is updated.
export const DATA_AS_OF = "2026-09-28";
```

- [ ] **Step 6: Create `scripts/geocode.ts`**

```ts
// One-time helper: fills empty lat/lng in data/projects.csv using the U.S. Census geocoder.
// Usage: pnpm geocode   (then verify every new pin by eye on the map)
import { readFileSync, writeFileSync } from "node:fs";
import Papa from "papaparse";
import { parseCensusResponse, toGeocodeQuery } from "../src/lib/geocode";

const PATH = "data/projects.csv";
const CENSUS = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

const { data, meta } = Papa.parse<Record<string, string>>(readFileSync(PATH, "utf8"), {
  header: true,
  skipEmptyLines: true,
});

let misses = 0;
for (const row of data) {
  if (row.lat && row.lng) continue;
  const url = `${CENSUS}?address=${encodeURIComponent(toGeocodeQuery(row.address!))}&benchmark=Public_AR_Current&format=json`;
  const hit = parseCensusResponse(await (await fetch(url)).json());
  if (!hit) {
    misses += 1;
    console.warn(`NO MATCH  ${row.id}  (${row.address}) — enter lat/lng by hand`);
    continue;
  }
  row.lat = hit.lat.toFixed(6);
  row.lng = hit.lng.toFixed(6);
  console.log(`ok        ${row.id}  ${row.lat}, ${row.lng}`);
}

writeFileSync(PATH, `${Papa.unparse(data, { columns: meta.fields, newline: "\n" })}\n`);
console.log(misses === 0 ? "All rows geocoded." : `${misses} row(s) need manual coordinates.`);
```

- [ ] **Step 7: Run the geocoder**

Run: `pnpm geocode`
Expected: 27 `ok` lines (or `NO MATCH` lines). For any `NO MATCH`, find the building on https://www.openstreetmap.org, right-click → "Show address", and paste lat/lng (6 decimals) into the CSV by hand. Then `git diff data/projects.csv` — only the `lat`/`lng` columns should change.

- [ ] **Step 8: Create `src/lib/load-projects.ts` and `scripts/check-data.ts`**

`src/lib/load-projects.ts`:
```ts
import csvText from "../../data/projects.csv?raw";
import { parseProjectsCsv } from "./parse-projects";
import type { Project } from "./schema";

let cache: Project[] | undefined;

/** Build-time only. Throws with every validation error so a bad row fails the build. */
export function loadProjects(): Project[] {
  if (cache) return cache;
  const { projects, errors } = parseProjectsCsv(csvText);
  if (errors.length > 0) {
    throw new Error(`data/projects.csv has ${errors.length} error(s):\n${errors.join("\n")}`);
  }
  cache = projects;
  return cache;
}
```

`scripts/check-data.ts`:
```ts
import { readFileSync } from "node:fs";
import { formatMoney, formatUnits } from "../src/lib/format";
import { parseProjectsCsv } from "../src/lib/parse-projects";
import { STATUS_LABELS, STATUSES } from "../src/lib/schema";
import { countByStatus, totals } from "../src/lib/stats";

const { projects, errors } = parseProjectsCsv(readFileSync("data/projects.csv", "utf8"));
if (errors.length > 0) {
  console.error(`data/projects.csv has ${errors.length} error(s):`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

const all = totals(projects);
const dpd = totals(projects.filter((p) => p.confidence === "dpd"));
console.log(`All projects:  ${all.count}  ·  ${formatUnits(all.units)} units  ·  ${formatMoney(all.tpcMusd)} TPC`);
console.log(`DPD map only:  ${dpd.count}  ·  ${formatUnits(dpd.units)} units  ·  ${formatMoney(dpd.tpcMusd)} TPC  (DPD publishes 3,930+ / $1.8B)`);
const counts = countByStatus(projects);
for (const s of STATUSES) console.log(`  ${STATUS_LABELS[s].padEnd(20)} ${counts[s]}`);
```

- [ ] **Step 9: Write `tests/unit/data.test.ts`** (guards the real dataset)

```ts
import { describe, expect, it } from "vitest";
import { loadProjects } from "../../src/lib/load-projects";
import { countByStatus, totals } from "../../src/lib/stats";

describe("data/projects.csv", () => {
  const projects = loadProjects();

  it("has all 27 projects and valid rows", () => {
    expect(projects).toHaveLength(27);
  });

  it("matches the expected totals", () => {
    expect(totals(projects)).toEqual({ count: 27, units: 4210, tpcMusd: 1839.8 });
    const dpd = projects.filter((p) => p.confidence === "dpd");
    expect(totals(dpd)).toEqual({ count: 25, units: 3966, tpcMusd: 1799.8 });
  });

  it("has DPD map numbers 1–25 exactly once", () => {
    const nums = projects.map((p) => p.dpd_map_no).filter((n) => n !== null).sort((a, b) => a! - b!);
    expect(nums).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it("matches the agreed stage assignment", () => {
    expect(countByStatus(projects)).toEqual({
      completed: 2, under_construction: 7, permitted: 5, approved: 9, planning: 4,
    });
  });

  it("marks the six LaSalle projects and two Monroe projects", () => {
    expect(projects.filter((p) => p.program === "lasalle").map((p) => p.dpd_map_no)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(projects.filter((p) => p.monroe_url).map((p) => p.id)).toEqual(["116-122-w-illinois", "401-w-ontario"]);
  });
});
```

- [ ] **Step 10: Run all checks**

Run: `pnpm test && pnpm data:check`
Expected: all tests PASS; `data:check` prints `All projects: 27 · 4,210 units · $1.84B TPC`, `DPD map only: 25 · 3,966 units · $1.8B TPC`, and stage counts 2/7/5/9/4.

- [ ] **Step 11: Commit**

```bash
git add data/projects.csv src/lib scripts tests/unit
git commit -m "feat: cleaned, geocoded project data with validation"
```

---

### Task 5: Brand foundation — layout, header, footer, Playwright

**Files:**
- Create: `public/brand/monroe-logo.png`, `public/favicon.svg`, `public/robots.txt`, `src/styles/global.css`, `src/layouts/Base.astro`, `src/components/Header.astro`, `src/components/Footer.astro`, `src/components/StatusChip.astro`, `src/pages/404.astro`, `playwright.config.ts`
- Modify: `src/pages/index.astro` (temporary page now uses `Base`)
- Test: `tests/e2e/layout.spec.ts`

**Interfaces:**
- Consumes: `DATA_AS_OF`, `formatDate`, `STATUS_COLORS`, `STATUS_LABELS`, `Status`.
- Produces:
  - `Base.astro` props: `{ title: string; description: string; ogImage?: string /* site-relative, default "/og/site.png" */; jsonLd?: Record<string, unknown>; fullscreen?: boolean /* no footer, body fills viewport */ }`
  - `StatusChip.astro` props: `{ status: Status; reported?: boolean }`
  - Global CSS classes: `.container`, `.page-section`, `.eyebrow`, `.button`, `.chip`, `.chip--hollow`, `.callout`, `.callout--flag`, `.callout--monroe`
  - CSS custom properties: `--navy --blue --blue-dark --ink --muted --line --surface --bg --font-serif --font-sans --header-h --space`

- [ ] **Step 1: Download brand assets**

```bash
mkdir -p public/brand
curl -fsSL -o public/brand/monroe-logo.png https://monroeresidential.com/assets/logo/Monroe-Residential-Logo-Color.png
curl -fsSL -o public/favicon.svg https://monroeresidential.com/favicon.svg
file public/brand/monroe-logo.png   # expect: PNG image data, 1042 x 308
```

- [ ] **Step 2: Create `public/robots.txt`**

```
User-agent: *
Allow: /
Sitemap: https://pipeline.monroeresidential.com/sitemap-index.xml
```

- [ ] **Step 3: Create `playwright.config.ts`**

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:4321",
    // Headless Chromium needs SwiftShader for MapLibre's WebGL context.
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  },
  webServer: {
    command: "pnpm build && pnpm preview --port 4321",
    url: "http://localhost:4321",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
});
```

Then: `pnpm exec playwright install chromium`

- [ ] **Step 4: Write the failing e2e test `tests/e2e/layout.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

test("404 page uses the site layout", async ({ page }) => {
  const res = await page.goto("/definitely-not-a-page");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("img", { name: "Monroe Residential Partners" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("We couldn't find that page.");
  await expect(page.getByRole("link", { name: "(312) 296-4855" })).toHaveAttribute("href", "tel:+13122964855");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#00051B");
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `pnpm test:e2e tests/e2e/layout.spec.ts`
Expected: FAIL — no logo / heading on the 404 page.

- [ ] **Step 6: Create `src/styles/global.css`**

```css
:root {
  --navy: #00051b;
  --blue: #33709b;
  --blue-dark: #285a7d;
  --ink: #222222;
  --muted: #5b6570;
  --line: #e1e4e8;
  --surface: #f6f7f8;
  --bg: #ffffff;
  --warn: #b4531f;
  --font-serif: "Newsreader", Georgia, "Times New Roman", serif;
  --font-sans: "Inter", system-ui, -apple-system, sans-serif;
  --header-h: 64px;
  --space: 8px;
}

*, *::before, *::after { box-sizing: border-box; border-radius: 0; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 400 15px/1.6 var(--font-sans); }
body.fullscreen { height: 100dvh; overflow: hidden; display: flex; flex-direction: column; }
body.fullscreen main { flex: 1; min-height: 0; }

h1, h2, h3 { font-family: var(--font-serif); font-weight: 500; line-height: 1.15; color: var(--navy); margin: 0 0 calc(var(--space) * 2); }
h1 { font-size: clamp(2rem, 4vw, 3.25rem); }
h2 { font-size: clamp(1.4rem, 2.4vw, 2rem); margin-top: calc(var(--space) * 5); }
h3 { font-size: 1.25rem; }
a { color: var(--blue); }
a:hover { color: var(--blue-dark); }
:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
img { max-width: 100%; height: auto; }
[hidden] { display: none !important; }

.container { width: min(1120px, 100% - 32px); margin-inline: auto; }
.page-section { padding: 64px 0; }
.eyebrow { font: 600 12px/1.4 var(--font-sans); letter-spacing: 0.14em; text-transform: uppercase; color: var(--blue); margin: 0 0 var(--space); }
.button { display: inline-block; padding: 12px 24px; background: var(--blue); color: #fff; border: 1px solid var(--blue); text-decoration: none; font-weight: 600; font-size: 14px; letter-spacing: 0.02em; }
.button:hover { background: var(--blue-dark); border-color: var(--blue-dark); color: #fff; }

.chip { display: inline-flex; align-items: center; gap: 6px; font: 600 11px/1 var(--font-sans); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink); }
.chip::before { content: ""; width: 10px; height: 10px; background: var(--chip-color); }
.chip--hollow::before { background: transparent; border: 2px solid var(--chip-color); }

.callout { margin: 0 0 16px; padding: 12px 16px; border-left: 3px solid var(--blue); background: var(--surface); }
.callout--flag { border-left-color: var(--warn); }
.callout--monroe { border-left-color: var(--navy); }

.site-header { height: var(--header-h); flex: none; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0 24px; background: var(--bg); border-bottom: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 16px; color: var(--navy); text-decoration: none; }
.brand img { height: 32px; width: auto; }
.brand-divider { width: 1px; height: 28px; background: var(--line); }
.brand-product { font: 500 20px/1 var(--font-serif); white-space: nowrap; }
.site-nav { display: flex; align-items: center; gap: 24px; font-size: 14px; }
.site-nav a:not(.button) { color: var(--ink); text-decoration: none; }
.site-nav a:not(.button):hover { color: var(--blue); }
.site-nav .button { padding: 8px 16px; }

.site-footer { background: var(--navy); color: #c9d2dc; margin-top: 80px; }
.site-footer .eyebrow { color: #8fb3cf; }
.footer-cta { padding: 64px 0; display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-end; justify-content: space-between; }
.footer-cta h2 { color: #fff; margin: 0 0 8px; }
.footer-cta p { margin: 0; }
.footer-meta { border-top: 1px solid rgb(255 255 255 / 0.12); padding: 20px 0; font-size: 13px; display: flex; flex-wrap: wrap; gap: 8px 24px; justify-content: space-between; }
.footer-meta a { color: #c9d2dc; }

@media (max-width: 767px) {
  .site-header { padding: 0 16px; }
  .brand { gap: 10px; }
  .brand img { height: 24px; }
  .brand-product { font-size: 17px; }
  .brand-divider, .nav-secondary { display: none; }
  .site-nav { gap: 12px; }
  .page-section { padding: 40px 0; }
}
```

- [ ] **Step 7: Create `src/components/StatusChip.astro`**

```astro
---
import { STATUS_COLORS, STATUS_LABELS, type Status } from "../lib/schema";

interface Props {
  status: Status;
  reported?: boolean;
}
const { status, reported = false } = Astro.props;
---
<span class:list={["chip", { "chip--hollow": reported }]} style={`--chip-color: ${STATUS_COLORS[status]}`}>
  {STATUS_LABELS[status]}{reported && " · Reported"}
</span>
```

- [ ] **Step 8: Create `src/components/Header.astro`**

```astro
<header class="site-header">
  <a class="brand" href="/">
    <img src="/brand/monroe-logo.png" alt="Monroe Residential Partners" width="108" height="32" />
    <span class="brand-divider" aria-hidden="true"></span>
    <span class="brand-product">Chicago Pipeline</span>
  </a>
  <nav class="site-nav" aria-label="Primary">
    <a class="nav-secondary" href="/about">About the data</a>
    <a class="nav-secondary" href="https://monroeresidential.com">monroeresidential.com</a>
    <a class="button" href="tel:+13122964855">Contact</a>
  </nav>
</header>
```

- [ ] **Step 9: Create `src/components/Footer.astro`**

```astro
---
import { DATA_AS_OF } from "../lib/data-meta";
import { formatDate } from "../lib/format";
---
<footer class="site-footer">
  <div class="container footer-cta">
    <div>
      <p class="eyebrow">Monroe Residential Partners</p>
      <h2>Have a project in mind?</h2>
      <p>We live to talk about the next great project. Let's build something extraordinary together.</p>
    </div>
    <a class="button" href="tel:+13122964855">(312) 296-4855</a>
  </div>
  <div class="container footer-meta">
    <span>Data as of {formatDate(DATA_AS_OF)} · <a href="/about">Sources &amp; methodology</a></span>
    <span>© {new Date().getFullYear()} <a href="https://monroeresidential.com">Monroe Residential Partners</a></span>
  </div>
</footer>
```

- [ ] **Step 10: Create `src/layouts/Base.astro`**

```astro
---
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/500.css";
import interUrl from "@fontsource/inter/files/inter-latin-400-normal.woff2?url";
import newsreaderUrl from "@fontsource/newsreader/files/newsreader-latin-500-normal.woff2?url";
import "../styles/global.css";
import Footer from "../components/Footer.astro";
import Header from "../components/Header.astro";

interface Props {
  title: string;
  description: string;
  ogImage?: string;
  jsonLd?: Record<string, unknown>;
  fullscreen?: boolean;
}
const { title, description, ogImage = "/og/site.png", jsonLd, fullscreen = false } = Astro.props;
// With build.format "file", strip any .html / trailing /index so canonical URLs match the links we publish.
const canonicalPath = Astro.url.pathname.replace(/\.html$/, "").replace(/\/index$/, "/");
const canonical = new URL(canonicalPath, Astro.site).href;
const ogUrl = new URL(ogImage, Astro.site).href;
const beaconToken = import.meta.env.PUBLIC_CF_BEACON_TOKEN;
// Escape "<" so data can never close the <script> element.
const jsonLdText = jsonLd ? JSON.stringify(jsonLd).replace(/</g, "\\u003c") : null;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <meta name="description" content={description} />
    <link rel="canonical" href={canonical} />
    <meta name="theme-color" content="#00051B" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="preload" as="font" type="font/woff2" href={interUrl} crossorigin />
    <link rel="preload" as="font" type="font/woff2" href={newsreaderUrl} crossorigin />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Monroe Residential Partners" />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta property="og:url" content={canonical} />
    <meta property="og:image" content={ogUrl} />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    {jsonLdText && <script is:inline type="application/ld+json" set:html={jsonLdText} />}
    {beaconToken && (
      <script is:inline defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon={JSON.stringify({ token: beaconToken })}></script>
    )}
  </head>
  <body class:list={{ fullscreen }}>
    <Header />
    <main id="main"><slot /></main>
    {!fullscreen && <Footer />}
  </body>
</html>
```

- [ ] **Step 11: Create `src/pages/404.astro` and update the temporary `src/pages/index.astro`**

`src/pages/404.astro`:
```astro
---
import Base from "../layouts/Base.astro";
---
<Base title="Page not found · Chicago Pipeline" description="This page does not exist.">
  <section class="container page-section">
    <p class="eyebrow">404</p>
    <h1>We couldn't find that page.</h1>
    <p><a href="/">Back to the pipeline map →</a></p>
  </section>
</Base>
```

`src/pages/index.astro` (replaced in Task 8):
```astro
---
import Base from "../layouts/Base.astro";
---
<Base title="Chicago Pipeline" description="Downtown Chicago office-to-residential conversions.">
  <section class="container page-section"><h1>Chicago Pipeline</h1></section>
</Base>
```

- [ ] **Step 12: Run the e2e test to verify it passes**

Run: `pnpm test:e2e tests/e2e/layout.spec.ts`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add public src playwright.config.ts tests/e2e
git commit -m "feat: Monroe-branded base layout, header, footer"
```

---

### Task 6: Project pages, About page, GeoJSON endpoint

**Files:**
- Create: `src/pages/projects/[id].astro`, `src/pages/about.astro`, `src/pages/data/projects.geojson.ts`
- Test: `tests/e2e/projects.spec.ts`

**Interfaces:**
- Consumes: `loadProjects`, `toFeatureCollection`, `DATA_AS_OF`, `displayName`, `formatUnits`, `formatMoney`, `formatDate`, `hostname`, `EMPTY`, `PROGRAM_LABELS`, `STATUS_LABELS`, `Base`, `StatusChip`.
- Produces:
  - `GET /data/projects.geojson` → `ProjectCollection` (the future `/api/projects` contract)
  - `GET /projects/{id}` for all 27 ids; page contains `<aside class="project-aside">` (Task 10 inserts the mini-map there)
  - `GET /about`

- [ ] **Step 1: Write the failing e2e tests `tests/e2e/projects.spec.ts`**

```ts
import { expect, test } from "@playwright/test";
import type { ProjectCollection } from "../../src/lib/schema";

test("GeoJSON endpoint lists all 27 projects as points", async ({ request }) => {
  const res = await request.get("/data/projects.geojson");
  expect(res.ok()).toBe(true);
  const fc = (await res.json()) as ProjectCollection;
  expect(fc.type).toBe("FeatureCollection");
  expect(fc.features).toHaveLength(27);
  expect(fc.features[0]!.geometry.type).toBe("Point");
});

test("every project page renders with its own title and share tags", async ({ page, request }) => {
  const fc = (await (await request.get("/data/projects.geojson")).json()) as ProjectCollection;
  for (const f of fc.features) {
    const res = await page.goto(`/projects/${f.id}`);
    expect(res?.status(), f.id).toBe(200);
    await expect(page.locator("h1")).toHaveText(f.properties.name ?? f.properties.address);
    await expect(page).toHaveTitle(/ · Chicago Pipeline$/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content", `https://pipeline.monroeresidential.com/og/${f.id}.png`,
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href", `https://pipeline.monroeresidential.com/projects/${f.id}`,
    );
  }
});

test("a project with missing fields shows em dashes, never null", async ({ page }) => {
  await page.goto("/projects/118-s-clinton");
  await expect(page.locator("h1")).toHaveText("118 S. Clinton St");
  const fact = (label: string) => page.locator(".facts div", { has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd");
  await expect(fact("Developer")).toHaveText("—");
  await expect(fact("Total project cost")).toHaveText("—");
  await expect(fact("Units")).toHaveText("74");
  await expect(fact("Source")).toHaveText("Reported — not on DPD map");
  await expect(page.locator("main")).not.toContainText("null");
});

test("flags and Monroe projects are called out", async ({ page }) => {
  await page.goto("/projects/105-w-adams");
  await expect(page.locator(".callout--flag")).toContainText("Ownership lawsuit pending");
  await page.goto("/projects/401-w-ontario");
  await expect(page.locator(".callout--monroe a")).toHaveAttribute("href", "https://monroeresidential.com/portfolio/birken-lofts");
});

test("JSON-LD is valid and escaped", async ({ page }) => {
  await page.goto("/projects/135-s-lasalle");
  const raw = await page.locator('script[type="application/ld+json"]').textContent();
  expect(raw).not.toContain("<");
  const data = JSON.parse(raw!);
  expect(data["@type"]).toBe("ApartmentComplex");
  expect(data.name).toBe("Field Building");
  expect(data.numberOfAccommodationUnits).toBe(386);
});

test("about page explains the methodology", async ({ page }) => {
  await page.goto("/about");
  await expect(page.locator("h1")).toHaveText("How we track the pipeline");
  await expect(page.getByText("DPD value is shown")).toBeVisible();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:e2e tests/e2e/projects.spec.ts`
Expected: FAIL — 404 for `/data/projects.geojson` and project pages.

- [ ] **Step 3: Create `src/pages/data/projects.geojson.ts`**

```ts
import type { APIRoute } from "astro";
import { DATA_AS_OF } from "../../lib/data-meta";
import { toFeatureCollection } from "../../lib/geojson";
import { loadProjects } from "../../lib/load-projects";

export const GET: APIRoute = () =>
  new Response(JSON.stringify(toFeatureCollection(loadProjects(), DATA_AS_OF)), {
    headers: { "Content-Type": "application/geo+json; charset=utf-8" },
  });
```

- [ ] **Step 4: Create `src/pages/projects/[id].astro`**

```astro
---
import StatusChip from "../../components/StatusChip.astro";
import Base from "../../layouts/Base.astro";
import { DATA_AS_OF } from "../../lib/data-meta";
import { displayName, EMPTY, formatDate, formatMoney, formatUnits, hostname } from "../../lib/format";
import { loadProjects } from "../../lib/load-projects";
import { PROGRAM_LABELS, STATUS_LABELS, type Project } from "../../lib/schema";

export function getStaticPaths() {
  return loadProjects().map((project) => ({ params: { id: project.id }, props: { project } }));
}

interface Props {
  project: Project;
}
const { project: p } = Astro.props;
const name = displayName(p);
const description = [
  `${name}${p.name ? ` (${p.address})` : ""}: office-to-residential conversion in downtown Chicago.`,
  p.units !== null ? `${formatUnits(p.units)} units.` : "",
  `Status: ${STATUS_LABELS[p.status]}.`,
].filter(Boolean).join(" ");

const facts: [string, string][] = [
  ["Developer", p.developer ?? EMPTY],
  ["Units", formatUnits(p.units)],
  ["Affordable units", formatUnits(p.affordable_units)],
  ["Total project cost", formatMoney(p.tpc_musd)],
  ["Program", PROGRAM_LABELS[p.program]],
  ["Public support", p.public_support ?? EMPTY],
  ["Source", p.confidence === "dpd" ? `DPD map #${p.dpd_map_no}` : "Reported — not on DPD map"],
];

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "ApartmentComplex",
  name,
  url: new URL(`/projects/${p.id}`, Astro.site).href,
  address: { "@type": "PostalAddress", streetAddress: p.address, addressLocality: "Chicago", addressRegion: "IL", addressCountry: "US" },
  geo: { "@type": "GeoCoordinates", latitude: p.lat, longitude: p.lng },
  ...(p.units !== null && { numberOfAccommodationUnits: p.units }),
};
---
<Base title={`${name} · Chicago Pipeline`} description={description} ogImage={`/og/${p.id}.png`} jsonLd={jsonLd}>
  <article class="container project">
    <a class="back" href={`/?project=${p.id}`}>← Back to the map</a>
    <header class="project-head">
      <StatusChip status={p.status} reported={p.confidence === "reported"} />
      <h1>{name}</h1>
      {p.name && <p class="project-address">{p.address}</p>}
    </header>

    {p.flag && <p class="callout callout--flag" role="note">⚠ {p.flag}</p>}
    {p.monroe_url && (
      <p class="callout callout--monroe">A Monroe Residential project. <a href={p.monroe_url}>View it in our portfolio →</a></p>
    )}

    <div class="project-grid">
      <section>
        <dl class="facts">
          {facts.map(([label, value]) => (
            <div><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>

        <h2>Status</h2>
        <p>{p.status_note}</p>

        {p.notes && (
          <>
            <h2>Notes</h2>
            <p>{p.notes}</p>
          </>
        )}

        <h2>Sources</h2>
        <ul class="sources">
          {p.sources.map((url) => (
            <li><a href={url} target="_blank" rel="noopener">{hostname(url)}</a></li>
          ))}
        </ul>
        <p class="as-of">Data as of {formatDate(DATA_AS_OF)}. <a href="/about">How we compile this data</a>.</p>
      </section>

      <aside class="project-aside" aria-label="Location">
        <p class="eyebrow">Location</p>
        <p class="project-location">{p.address}<br />Chicago, IL</p>
      </aside>
    </div>
  </article>
</Base>

<style>
  .project { padding: 32px 0 0; }
  .back { display: inline-block; margin-bottom: 32px; font-size: 14px; text-decoration: none; }
  .project-head h1 { margin: 12px 0 4px; }
  .project-address { margin: 0 0 24px; color: var(--muted); font-size: 17px; }
  .project-grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 48px; align-items: start; }
  .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); margin: 8px 0 0; }
  .facts div { background: var(--bg); padding: 16px; }
  .facts dt { font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
  .facts dd { margin: 6px 0 0; font: 500 20px/1.3 var(--font-serif); color: var(--navy); }
  .sources { padding-left: 18px; }
  .as-of { font-size: 13px; color: var(--muted); margin-top: 32px; }
  .project-aside { position: sticky; top: 24px; }
  .project-location { margin: 0 0 16px; }
  @media (max-width: 900px) {
    .project-grid { grid-template-columns: 1fr; gap: 32px; }
    .project-aside { position: static; }
  }
  @media (max-width: 520px) {
    .facts { grid-template-columns: 1fr; }
  }
</style>
```

- [ ] **Step 5: Create `src/pages/about.astro`**

```astro
---
import Base from "../layouts/Base.astro";
import { DATA_AS_OF } from "../lib/data-meta";
import { formatDate } from "../lib/format";
---
<Base
  title="About the data · Chicago Pipeline"
  description="How Monroe Residential compiles and verifies Chicago's office-to-residential conversion pipeline."
>
  <article class="container page-section prose">
    <p class="eyebrow">Methodology</p>
    <h1>How we track the pipeline</h1>
    <p>
      This map covers office-to-residential conversions in downtown Chicago. It starts from the City of
      Chicago Department of Planning and Development (DPD) map published in June 2026, which lists 25 projects
      totaling 3,930+ units and $1.8B in project costs. We add projects that have been publicly reported but do
      not yet appear on the DPD map, and label them "Reported — not on DPD map."
    </p>

    <h2>Sources</h2>
    <ul>
      <li>City of Chicago DPD, <em>Downtown Chicago Office-to-Residential Conversions</em> (June 2026)</li>
      <li>City of Chicago LaSalle Street Reimagined proposals and Mayor's Office press releases</li>
      <li>Reporting from Crain's Chicago Business, Chicago Sun-Times, Urbanize Chicago, Chicago YIMBY, The Real Deal, Cooperator News, Block Club Chicago and Preservation Chicago</li>
      <li>Chicago building permit records (via Chicago Cityscape)</li>
    </ul>

    <h2>When sources disagree</h2>
    <p>
      Where the DPD map and another source report different figures, the DPD value is shown and the alternate
      figure is listed in the project's notes. Where DPD has no figure, we use the best available public source.
    </p>

    <h2>Status stages</h2>
    <dl class="stages">
      <dt>Planning</dt><dd>Acquired or proposed; entitlements or financing not yet in place.</dd>
      <dt>Approved</dt><dd>Zoning, Plan Commission and/or City Council approvals granted; no construction permit yet.</dd>
      <dt>Permitted</dt><dd>Renovation permit issued; construction not yet confirmed underway.</dd>
      <dt>Under construction</dt><dd>Work confirmed underway.</dd>
      <dt>Completed</dt><dd>Open to residents.</dd>
    </dl>
    <p>A ⚠ marks projects with a known risk, such as litigation or a pending sale.</p>

    <h2>Updates</h2>
    <p>Data as of {formatDate(DATA_AS_OF)}. We update the map as projects move through approvals and construction.</p>

    <h2>Disclaimer</h2>
    <p>
      This map is compiled from public sources for informational purposes only. Figures are as reported and may
      change. It is not an offer, solicitation or investment advice. Corrections are welcome at (312) 296-4855.
    </p>
  </article>
</Base>

<style>
  .prose { max-width: 760px; }
  .stages { display: grid; grid-template-columns: max-content 1fr; gap: 8px 24px; }
  .stages dt { font-weight: 600; color: var(--navy); }
  .stages dd { margin: 0; }
  @media (max-width: 520px) { .stages { grid-template-columns: 1fr; } .stages dd { margin-bottom: 8px; } }
</style>
```

- [ ] **Step 6: Run the e2e tests to verify they pass**

Run: `pnpm test:e2e tests/e2e/projects.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Run type checks**

Run: `pnpm check`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/pages tests/e2e
git commit -m "feat: static project pages, about page and GeoJSON endpoint"
```

---

### Task 7: Brand basemap style

**Files:**
- Create: `scripts/fetch-map-assets.sh`, `public/map-assets/**` (generated, committed), `src/map/brand-flavor.ts`, `src/map/style.ts`, `src/map/basemap.ts`, `.env.development`
- Test: `tests/unit/style.test.ts`

**Interfaces:**
- Produces (`style.ts`, pure): `BASEMAP_SOURCE = "basemap"`, `DEFAULT_PMTILES_URL = "https://tiles.monroeresidential.com/chicago.pmtiles"`, `DEFAULT_ASSETS_PATH = "/map-assets"`, `interface StyleUrls { pmtilesUrl: string; assetsUrl: string }` (both absolute, no trailing slash), `buildStyle(urls: StyleUrls): StyleSpecification`
- Produces (`basemap.ts`, browser): `CHICAGO_CENTER: [number, number]`, `supportsWebGL(): boolean`, `interface BaseMapOptions { container: HTMLElement; center?: [number, number]; zoom?: number; interactive?: boolean; onTileError?: () => void }`, `createBaseMap(opts: BaseMapOptions): maplibregl.Map | null` (null = no WebGL / construction failed; `onTileError` called at most once)
- Produces (`brand-flavor.ts`): `BRAND_FLAVOR`

- [ ] **Step 1: Create and run `scripts/fetch-map-assets.sh`**

```bash
#!/usr/bin/env bash
# One-time: copy Protomaps glyphs + "light" sprites into public/map-assets (committed, ~11 MB).
set -euo pipefail
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git clone --quiet --depth 1 https://github.com/protomaps/basemaps-assets "$tmp/assets"
rm -rf public/map-assets
mkdir -p public/map-assets/fonts public/map-assets/sprites
cp -R "$tmp/assets/fonts/." public/map-assets/fonts/
cp "$tmp/assets/sprites/v4/light"* public/map-assets/sprites/
echo "Copied $(find public/map-assets -type f | wc -l | tr -d ' ') files."
```

Run: `chmod +x scripts/fetch-map-assets.sh && ./scripts/fetch-map-assets.sh`
Expected: `Copied 1029 files.` (4 font stacks × 256 ranges + OFL.txt + 4 sprite files; exact count may differ slightly). `ls public/map-assets/fonts` shows `Noto Sans Regular`, `Noto Sans Medium`, `Noto Sans Italic`, `Noto Sans Devanagari Regular v1`.

- [ ] **Step 2: Write failing `tests/unit/style.test.ts`**

```ts
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRAND_FLAVOR } from "../../src/map/brand-flavor";
import { BASEMAP_SOURCE, buildStyle } from "../../src/map/style";

const style = buildStyle({
  pmtilesUrl: "https://tiles.example/chicago.pmtiles",
  assetsUrl: "https://site.example/map-assets",
});

function collectFontNames(value: unknown, out: Set<string>): void {
  if (typeof value === "string" && value.startsWith("Noto Sans")) out.add(value);
  else if (Array.isArray(value)) value.forEach((v) => collectFontNames(v, out));
}

describe("buildStyle", () => {
  it("points the vector source at the PMTiles archive", () => {
    expect(style.sources[BASEMAP_SOURCE]).toMatchObject({ type: "vector", url: "pmtiles://https://tiles.example/chicago.pmtiles" });
  });

  it("serves glyphs and sprites from the site", () => {
    expect(style.glyphs).toBe("https://site.example/map-assets/fonts/{fontstack}/{range}.pbf");
    expect(style.sprite).toBe("https://site.example/map-assets/sprites/light");
  });

  it("uses the brand background", () => {
    const bg = style.layers.find((l) => l.id === "background");
    expect(bg?.paint).toEqual({ "background-color": BRAND_FLAVOR.background });
  });

  it("adds 3D buildings directly above the flat building layer", () => {
    const ids = style.layers.map((l) => l.id);
    expect(ids).toContain("buildings");
    expect(ids.indexOf("buildings-3d")).toBe(ids.indexOf("buildings") + 1);
  });

  it("only references font stacks that exist in public/map-assets", () => {
    const fonts = new Set<string>();
    for (const layer of style.layers) {
      collectFontNames((layer.layout as Record<string, unknown> | undefined)?.["text-font"], fonts);
    }
    expect(fonts.size).toBeGreaterThan(0);
    for (const font of fonts) expect(existsSync(`public/map-assets/fonts/${font}/0-255.pbf`), font).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm test tests/unit/style.test.ts`
Expected: FAIL — cannot resolve `src/map/style`.

- [ ] **Step 4: Create `src/map/brand-flavor.ts`**

```ts
import { namedFlavor } from "@protomaps/basemaps";

type Flavor = ReturnType<typeof namedFlavor>;

// Protomaps "light", minus POI icons (they compete with our markers), tinted to the Monroe palette.
const { pois: _pois, ...light } = namedFlavor("light");

export const BRAND_FLAVOR: Flavor = {
  ...light,
  background: "#eef0f2",
  earth: "#f3f4f6",
  water: "#bfd0dd",
  buildings: "#e1e4e8",
  park_a: "#e2e9e2",
  park_b: "#dae3da",
  wood_a: "#e2e9e2",
  wood_b: "#dae3da",
  pedestrian: "#eef0f2",
  railway: "#c9ced4",
  other: "#f7f8f9",
  minor_a: "#ffffff",
  minor_b: "#ffffff",
  link: "#ffffff",
  major: "#ffffff",
  highway: "#ffffff",
  roads_label_minor: "#7a838d",
  roads_label_major: "#5b6570",
  subplace_label: "#33709b",
  city_label: "#00051b",
  ocean_label: "#6f8fa8",
};
```

- [ ] **Step 5: Create `src/map/style.ts`**

```ts
import { layers } from "@protomaps/basemaps";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { BRAND_FLAVOR } from "./brand-flavor";

export const BASEMAP_SOURCE = "basemap";
export const DEFAULT_PMTILES_URL = "https://tiles.monroeresidential.com/chicago.pmtiles";
export const DEFAULT_ASSETS_PATH = "/map-assets";

export interface StyleUrls {
  pmtilesUrl: string;
  assetsUrl: string;
}

const BUILDINGS_3D: LayerSpecification = {
  id: "buildings-3d",
  type: "fill-extrusion",
  source: BASEMAP_SOURCE,
  "source-layer": "buildings",
  minzoom: 15,
  paint: {
    "fill-extrusion-color": BRAND_FLAVOR.buildings,
    "fill-extrusion-height": ["coalesce", ["get", "height"], 12],
    "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0],
    "fill-extrusion-opacity": 0.85,
  },
};

export function buildStyle({ pmtilesUrl, assetsUrl }: StyleUrls): StyleSpecification {
  const base = layers(BASEMAP_SOURCE, BRAND_FLAVOR, { lang: "en" }) as LayerSpecification[];
  const flat = base.findIndex((l) => l.id === "buildings");
  base.splice(flat === -1 ? base.length : flat + 1, 0, BUILDINGS_3D);
  return {
    version: 8,
    glyphs: `${assetsUrl}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${assetsUrl}/sprites/light`,
    sources: {
      [BASEMAP_SOURCE]: {
        type: "vector",
        url: `pmtiles://${pmtilesUrl}`,
        attribution:
          '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: base,
  };
}
```

- [ ] **Step 6: Run the unit tests to verify they pass**

Run: `pnpm test tests/unit/style.test.ts`
Expected: PASS (5 tests). If "buildings" is not a layer id in this @protomaps/basemaps version, run `node -e "import('@protomaps/basemaps').then(b=>console.log(b.layers('s',b.namedFlavor('light')).map(l=>l.id).filter(i=>i.includes('build'))))"` and use the id it prints in both `style.ts` and the test.

- [ ] **Step 7: Create `src/map/basemap.ts`**

```ts
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { buildStyle, DEFAULT_ASSETS_PATH, DEFAULT_PMTILES_URL } from "./style";

export const CHICAGO_CENTER: [number, number] = [-87.6298, 41.8847];

export interface BaseMapOptions {
  container: HTMLElement;
  center?: [number, number];
  zoom?: number;
  interactive?: boolean;
  onTileError?: () => void;
}

let protocolRegistered = false;

export function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function createBaseMap(opts: BaseMapOptions): MapLibreMap | null {
  if (!supportsWebGL()) return null;
  if (!protocolRegistered) {
    maplibregl.addProtocol("pmtiles", new Protocol().tile);
    protocolRegistered = true;
  }

  const assets = import.meta.env.PUBLIC_MAP_ASSETS_URL || DEFAULT_ASSETS_PATH;
  const style = buildStyle({
    pmtilesUrl: import.meta.env.PUBLIC_PMTILES_URL || DEFAULT_PMTILES_URL,
    assetsUrl: new URL(assets, window.location.href).href.replace(/\/$/, ""),
  });

  try {
    const map = new maplibregl.Map({
      container: opts.container,
      style,
      center: opts.center ?? CHICAGO_CENTER,
      zoom: opts.zoom ?? 13.5,
      interactive: opts.interactive ?? true,
      attributionControl: { compact: true },
    });
    // Everything this map fetches is basemap (tiles, glyphs, sprites), so any error means the basemap is degraded.
    let reported = false;
    map.on("error", (event) => {
      console.warn("Basemap error", event.error);
      if (!reported) {
        reported = true;
        opts.onTileError?.();
      }
    });
    return map;
  } catch (err) {
    console.warn("Interactive map unavailable", err);
    return null;
  }
}
```

- [ ] **Step 8: Create `.env.development`** (dev only, until Task 12 publishes our tiles)

```
# Dev only: Protomaps demo tiles until tiles.monroeresidential.com exists (Task 12 deletes this file).
PUBLIC_PMTILES_URL=https://demo-bucket.protomaps.com/v4.pmtiles
```

- [ ] **Step 9: Type-check**

Run: `pnpm check`
Expected: 0 errors.

- [ ] **Step 10: Commit**

```bash
git add scripts/fetch-map-assets.sh public/map-assets src/map .env.development tests/unit/style.test.ts
git commit -m "feat: Monroe-branded Protomaps basemap style"
```

---

### Task 8: Interactive map page

**Files:**
- Create: `src/map/markers.ts`, `src/map/popup.ts`, `src/scripts/sidebar.ts`, `src/scripts/map-app.ts`, `src/components/StatTiles.astro`, `src/components/Filters.astro`, `src/components/ProjectList.astro`, `src/components/MapView.astro`, `src/styles/map.css`
- Modify: `src/pages/index.astro` (replace temporary page)
- Test: `tests/unit/markers.test.ts`, `tests/unit/popup.test.ts`, `tests/e2e/map.spec.ts`, `tests/e2e/deeplinks.spec.ts`, `tests/e2e/degradation.spec.ts`, `tests/e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: everything in `src/lib/*`; `createBaseMap` (Task 7); `StatusChip`, `Base`.
- Produces:
  - `markerSize(units: number|null): number` (16–~36 px), `markerLabel(p: Project): string`, `createMarkerElement(p: Project): HTMLButtonElement` (class `marker`, `data-id`, `data-status`; `marker--reported`, `marker--monroe` modifiers)
  - `popupHtml(p: Project): string` (all data HTML-escaped)
  - Sidebar DOM contract (ids/attrs used by e2e tests): `#sidebar[data-state=collapsed|expanded]`, `.sheet-handle`, `#filters` with `input[name=status|program]`, `#sort`, `.stats [data-stat=count|units|tpc]`, `#project-list > li[data-id]` containing `a.project-row[data-id]`, `#empty-state`, `#map`, `#map-notice`, `#map-fallback`
  - `sidebar.ts`: `readFilters(root)`, `writeFilters(root, state)`, `readSort(root): SortKey`, `renderStats(root, totals)`, `renderList(root, visibleIds: ReadonlySet<string>, selected: string|null)`, `applyOrder(root, order: readonly string[])`, `scrollRowIntoView(root, id)`, `bindSheet(sidebar): { collapse(): void }`
  - `map-app.ts`: `PROJECTS_URL = "/data/projects.geojson"`, `startMapApp(): Promise<void>`

- [ ] **Step 1: Write failing `tests/unit/markers.test.ts` and `tests/unit/popup.test.ts`**

`tests/unit/markers.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { markerLabel, markerSize } from "../../src/map/markers";
import { makeProject } from "./fixtures";

describe("markerSize", () => {
  it("scales with the square root of units, with a 16px floor", () => {
    expect(markerSize(null)).toBe(16);
    expect(markerSize(28)).toBe(21);
    expect(markerSize(400)).toBe(36);
    expect(markerSize(386)).toBeLessThan(markerSize(400));
  });
});

describe("markerLabel", () => {
  it("describes the project for screen readers", () => {
    expect(markerLabel(makeProject())).toBe("Harris Bank building, Approved, 345 units");
    expect(markerLabel(makeProject({ name: null, units: null, confidence: "reported" }))).toBe(
      "111 W. Monroe St, Approved, reported — not on DPD map",
    );
  });
});
```

`tests/unit/popup.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { popupHtml } from "../../src/map/popup";
import { makeProject } from "./fixtures";

describe("popupHtml", () => {
  it("shows name, address, units and cost, and links to the project page", () => {
    const html = popupHtml(makeProject());
    expect(html).toContain("Harris Bank building");
    expect(html).toContain("111 W. Monroe St");
    expect(html).toContain("345 units · $179M");
    expect(html).toContain('href="/projects/111-w-monroe"');
  });

  it("falls back to the address and omits missing numbers", () => {
    const html = popupHtml(makeProject({ name: null, address: "118 S. Clinton St", units: 74, tpc_musd: null, confidence: "reported" }));
    expect(html).toContain("118 S. Clinton St");
    expect(html).toContain("74 units");
    expect(html).not.toContain("·  ");
    expect(html).not.toContain("null");
    expect(html).toContain("Reported");
  });

  it("escapes HTML in data", () => {
    const html = popupHtml(makeProject({ name: `<img src=x onerror=alert(1)> & Crain's` }));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; &amp; Crain&#39;s");
  });

  it("shows flags and the Monroe badge", () => {
    const html = popupHtml(makeProject({ flag: "Ownership lawsuit pending", monroe_url: "https://monroeresidential.com/portfolio/x" }));
    expect(html).toContain("⚠ Ownership lawsuit pending");
    expect(html).toContain("A Monroe Residential project");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test tests/unit/markers.test.ts tests/unit/popup.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `src/map/markers.ts` and `src/map/popup.ts`**

`src/map/markers.ts`:
```ts
import { displayName, formatUnits } from "../lib/format";
import { STATUS_COLORS, STATUS_LABELS, type Project } from "../lib/schema";

export function markerSize(units: number | null): number {
  return Math.round(16 + Math.sqrt(units ?? 0));
}

export function markerLabel(p: Project): string {
  const parts = [displayName(p), STATUS_LABELS[p.status]];
  if (p.units !== null) parts.push(`${formatUnits(p.units)} units`);
  if (p.confidence === "reported") parts.push("reported — not on DPD map");
  return parts.join(", ");
}

export function createMarkerElement(p: Project): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "marker";
  if (p.confidence === "reported") el.classList.add("marker--reported");
  if (p.monroe_url) el.classList.add("marker--monroe");
  el.dataset.id = p.id;
  el.dataset.status = p.status;
  const size = `${markerSize(p.units)}px`;
  el.style.width = size;
  el.style.height = size;
  el.style.setProperty("--marker-color", STATUS_COLORS[p.status]);
  el.setAttribute("aria-label", markerLabel(p));
  el.title = displayName(p);
  return el;
}
```

`src/map/popup.ts`:
```ts
import { displayName, escapeHtml as e, formatMoney, formatUnits } from "../lib/format";
import { STATUS_LABELS, type Project } from "../lib/schema";

export function popupHtml(p: Project): string {
  const meta = [
    p.units === null ? null : `${formatUnits(p.units)} units`,
    p.tpc_musd === null ? null : formatMoney(p.tpc_musd),
  ].filter(Boolean).join(" · ");
  const status = `${STATUS_LABELS[p.status]}${p.confidence === "reported" ? " · Reported" : ""}`;

  return [
    `<div class="popup">`,
    `<p class="popup-status">${e(status)}</p>`,
    `<h3 class="popup-title">${e(displayName(p))}</h3>`,
    p.name ? `<p class="popup-address">${e(p.address)}</p>` : "",
    meta ? `<p class="popup-meta">${e(meta)}</p>` : "",
    p.flag ? `<p class="popup-flag">⚠ ${e(p.flag)}</p>` : "",
    p.monroe_url ? `<p class="popup-monroe">A Monroe Residential project</p>` : "",
    `<a class="popup-link" href="/projects/${e(p.id)}">View details →</a>`,
    `</div>`,
  ].join("");
}
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `pnpm test tests/unit/markers.test.ts tests/unit/popup.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing e2e tests**

`tests/e2e/map.spec.ts`:
```ts
import { expect, test, type Page } from "@playwright/test";

const visibleMarkers = (page: Page) => page.locator(".marker:not([hidden])");
const stat = (page: Page, key: string) => page.locator(`.stats [data-stat="${key}"]`);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(visibleMarkers(page)).toHaveCount(27);
});

test("shows all 27 projects with totals", async ({ page }) => {
  await expect(stat(page, "count")).toHaveText("27");
  await expect(stat(page, "units")).toHaveText("4,210");
  await expect(stat(page, "tpc")).toHaveText("$1.84B");
  await expect(page.locator("#project-list li:not([hidden])")).toHaveCount(27);
  await expect(page.locator(".marker--reported")).toHaveCount(2);
  await expect(page.locator(".marker--monroe")).toHaveCount(2);
});

test("filtering by status updates markers, list, totals and URL", async ({ page }) => {
  await page.locator("#filters").getByLabel("Completed").uncheck();
  await expect(visibleMarkers(page)).toHaveCount(25);
  await expect(page.locator("#project-list li:not([hidden])")).toHaveCount(25);
  await expect(stat(page, "units")).toHaveText("3,940");
  await expect(page).toHaveURL(/\?status=under_construction,permitted,approved,planning$/);
});

test("filtering by program", async ({ page }) => {
  await page.locator("#filters").getByLabel("Private market").uncheck();
  await expect(visibleMarkers(page)).toHaveCount(6);
  await expect(page).toHaveURL(/\?program=lasalle$/);
});

test("unchecking every status shows the empty state", async ({ page }) => {
  for (const label of ["Completed", "Under construction", "Permitted", "Approved", "Planning"]) {
    await page.locator("#filters").getByLabel(label).uncheck();
  }
  await expect(visibleMarkers(page)).toHaveCount(0);
  await expect(page.getByText("No projects match these filters.")).toBeVisible();
  await expect(stat(page, "count")).toHaveText("0");
  await expect(stat(page, "tpc")).toHaveText("$0M");
  await expect(page).toHaveURL(/\?status=none$/);
});

test("sorting reorders the list", async ({ page }) => {
  await page.locator("#sort").selectOption("tpc");
  await expect(page.locator("#project-list li").first()).toHaveAttribute("data-id", "135-s-lasalle");
});

test("clicking a marker opens its popup and records it in the URL", async ({ page }) => {
  // Markers overlap in the Loop at the overview zoom, so dispatch the click directly.
  await page.locator('.marker[data-id="79-w-monroe"]').dispatchEvent("click");
  const popup = page.locator(".maplibregl-popup");
  await expect(popup).toContainText("The Bellwether");
  await expect(popup.getByRole("link", { name: "View details →" })).toHaveAttribute("href", "/projects/79-w-monroe");
  await expect(page).toHaveURL(/project=79-w-monroe/);
  await expect(page.locator('#project-list li[data-id="79-w-monroe"]')).toHaveClass(/is-selected/);
});

test("clicking a list row selects the project instead of navigating", async ({ page }) => {
  await page.locator('a.project-row[data-id="401-w-ontario"]').click();
  await expect(page.locator(".maplibregl-popup")).toContainText("A Monroe Residential project");
  await expect(page).toHaveURL(/\/\?project=401-w-ontario$/);
});

test("filtering out the selected project closes its popup", async ({ page }) => {
  await page.locator('.marker[data-id="79-w-monroe"]').dispatchEvent("click");
  await expect(page.locator(".maplibregl-popup")).toHaveCount(1);
  await page.locator("#filters").getByLabel("Completed").uncheck();
  await expect(page.locator(".maplibregl-popup")).toHaveCount(0);
  await expect(page).not.toHaveURL(/project=/);
});
```

`tests/e2e/deeplinks.spec.ts`:
```ts
import { expect, test } from "@playwright/test";

test("restores filters and selection from the URL", async ({ page }) => {
  await page.goto("/?status=completed&project=79-w-monroe");
  await expect(page.locator(".marker:not([hidden])")).toHaveCount(2);
  await expect(page.locator("#filters").getByLabel("Approved")).not.toBeChecked();
  await expect(page.locator(".maplibregl-popup")).toContainText("The Bellwether");
});

test("ignores malformed parameters", async ({ page }) => {
  await page.goto("/?status=bogus&program=x&project=deleted-id");
  await expect(page.locator(".marker:not([hidden])")).toHaveCount(27);
  await expect(page.locator(".maplibregl-popup")).toHaveCount(0);
  await expect(page).toHaveURL(/localhost:4321\/$/);
});

test("drops a selected project that the filters hide", async ({ page }) => {
  await page.goto("/?status=completed&project=111-w-monroe");
  await expect(page.locator(".marker:not([hidden])")).toHaveCount(2);
  await expect(page.locator(".maplibregl-popup")).toHaveCount(0);
  await expect(page).toHaveURL(/\?status=completed$/);
});
```

`tests/e2e/degradation.spec.ts`:
```ts
import { expect, test } from "@playwright/test";

test("when tiles fail, markers still render and a notice appears", async ({ page }) => {
  await page.route("**/*.pmtiles", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator("#map-notice")).toBeVisible();
  await expect(page.locator(".marker:not([hidden])")).toHaveCount(27);
});

test("without WebGL the list still filters and links to project pages", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type.startsWith("webgl")) return null;
      return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });
  await page.goto("/");
  await expect(page.locator("#map-fallback")).toBeVisible();
  await expect(page.locator("#project-list li:not([hidden])")).toHaveCount(27);
  await page.locator("#filters").getByLabel("Completed").uncheck();
  await expect(page.locator('.stats [data-stat="count"]')).toHaveText("25");
  await page.locator('a.project-row[data-id="111-w-monroe"]').click();
  await expect(page).toHaveURL(/\/projects\/111-w-monroe$/);
});
```

`tests/e2e/mobile.spec.ts`:
```ts
import { expect, test } from "@playwright/test";

test("sidebar is a bottom sheet that expands on tap and collapses on selection", async ({ page }) => {
  await page.goto("/");
  const sidebar = page.locator("#sidebar");
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await expect(page.locator(".sheet-handle")).toContainText("27 projects");
  await expect(page.locator("#project-list")).toBeHidden();

  await page.locator(".sheet-handle").click();
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await expect(page.locator("#project-list")).toBeVisible();

  await page.locator('a.project-row[data-id="79-w-monroe"]').click();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await expect(page.locator(".maplibregl-popup")).toContainText("The Bellwether");
});

test("no horizontal scroll at phone width", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
```

- [ ] **Step 6: Run to verify failure**

Run: `pnpm test:e2e tests/e2e/map.spec.ts`
Expected: FAIL — no `.marker` elements on the temporary home page.

- [ ] **Step 7: Create the sidebar components**

`src/components/StatTiles.astro`:
```astro
---
import { formatMoney, formatUnits } from "../lib/format";
import type { Totals } from "../lib/stats";

interface Props {
  totals: Totals;
}
const { totals } = Astro.props;
---
<dl class="stats" aria-live="polite">
  <div><dt>Projects</dt><dd data-stat="count">{totals.count}</dd></div>
  <div><dt>Units</dt><dd data-stat="units">{formatUnits(totals.units)}</dd></div>
  <div><dt>Project cost</dt><dd data-stat="tpc">{formatMoney(totals.tpcMusd)}</dd></div>
</dl>
```

`src/components/Filters.astro`:
```astro
---
import { PROGRAM_LABELS, PROGRAMS, STATUS_COLORS, STATUS_LABELS, STATUSES, type Status } from "../lib/schema";

interface Props {
  counts: Record<Status, number>;
}
const { counts } = Astro.props;
---
<form class="filters" id="filters">
  <fieldset>
    <legend>Status</legend>
    {STATUSES.map((s) => (
      <label class="filter-option">
        <input type="checkbox" name="status" value={s} checked />
        <span class="swatch" style={`--swatch: ${STATUS_COLORS[s]}`} aria-hidden="true"></span>
        <span class="filter-label">{STATUS_LABELS[s]}</span>
        <span class="filter-count">{counts[s]}</span>
      </label>
    ))}
  </fieldset>
  <fieldset>
    <legend>Program</legend>
    {PROGRAMS.map((p) => (
      <label class="filter-option">
        <input type="checkbox" name="program" value={p} checked />
        <span class="filter-label">{PROGRAM_LABELS[p]}</span>
      </label>
    ))}
  </fieldset>
  <label class="sort">
    Sort by
    <select id="sort" name="sort">
      <option value="units">Units</option>
      <option value="tpc">Project cost</option>
      <option value="status">Status</option>
    </select>
  </label>
</form>
<p class="legend-note">
  <span class="swatch swatch--hollow" aria-hidden="true"></span> Reported, not on DPD map
  <span class="swatch swatch--monroe" aria-hidden="true"></span> Monroe project
</p>
```

`src/components/ProjectList.astro`:
```astro
---
import StatusChip from "./StatusChip.astro";
import { displayName, formatMoney, formatUnits } from "../lib/format";
import type { Project } from "../lib/schema";

interface Props {
  projects: Project[];
}
const { projects } = Astro.props;
---
<ol class="project-list" id="project-list">
  {projects.map((p) => (
    <li data-id={p.id}>
      <a class="project-row" href={`/projects/${p.id}`} data-id={p.id}>
        <span class="row-name">
          {displayName(p)}
          {p.flag && <span class="row-flag" role="img" aria-label={`Warning: ${p.flag}`}> ⚠</span>}
        </span>
        {p.name && <span class="row-address">{p.address}</span>}
        <span class="row-meta">
          <StatusChip status={p.status} reported={p.confidence === "reported"} />
          <span>{formatUnits(p.units)} units · {formatMoney(p.tpc_musd)}</span>
        </span>
        {p.monroe_url && <span class="row-monroe">Monroe project</span>}
      </a>
    </li>
  ))}
</ol>
<p id="empty-state" class="empty-state" hidden>No projects match these filters.</p>
```

`src/components/MapView.astro`:
```astro
<div class="map-wrap">
  <div id="map" class="map" role="region" aria-label="Map of conversion projects. The project list contains the same information."></div>
  <p id="map-notice" class="map-notice" role="status" hidden>Map tiles unavailable — projects are still shown.</p>
  <div id="map-fallback" class="map-fallback" hidden>
    <p class="eyebrow">Interactive map unavailable</p>
    <p>Your browser can't display the interactive map. Every project is listed in the panel, and each has its own page.</p>
  </div>
</div>
```

- [ ] **Step 8: Create `src/styles/map.css`**

```css
.app-shell { display: grid; grid-template-columns: 400px minmax(0, 1fr); height: 100%; }
.sidebar { border-right: 1px solid var(--line); overflow-y: auto; background: var(--bg); }
.sheet-handle { display: none; }
.sidebar-body { padding: 24px; }
.sidebar-title { font-size: 28px; }

.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; margin: 0 0 24px; background: var(--line); border: 1px solid var(--line); }
.stats div { background: var(--bg); padding: 12px; }
.stats dt { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.stats dd { margin: 4px 0 0; font: 500 26px/1.1 var(--font-serif); color: var(--navy); font-variant-numeric: tabular-nums; }

.filters fieldset { border: 0; padding: 0; margin: 0 0 16px; }
.filters legend { font: 600 11px/1 var(--font-sans); letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
.filter-option { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 14px; cursor: pointer; }
.filter-option input { margin: 0; accent-color: var(--blue); }
.filter-label { flex: 1; }
.filter-count { color: var(--muted); font-variant-numeric: tabular-nums; }
.swatch { display: inline-block; width: 12px; height: 12px; background: var(--swatch); vertical-align: middle; }
.swatch--hollow { background: transparent; border: 2px solid var(--muted); border-radius: 50%; }
.swatch--monroe { background: var(--bg); border-radius: 50%; box-shadow: 0 0 0 2px var(--blue); margin-left: 12px; }
.sort { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 13px; color: var(--muted); }
.sort select { font: inherit; color: var(--ink); background: var(--bg); border: 1px solid var(--line); padding: 4px 8px; }
.legend-note { margin: 0 0 16px; font-size: 12px; color: var(--muted); }

.project-list { list-style: none; margin: 0 -24px; padding: 0; border-top: 1px solid var(--line); }
.project-list li { border-bottom: 1px solid var(--line); }
.project-row { display: grid; gap: 2px; padding: 12px 24px; color: var(--ink); text-decoration: none; }
.project-row:hover, .is-selected .project-row { background: var(--surface); color: var(--ink); }
.is-selected .project-row { box-shadow: inset 3px 0 0 var(--blue); }
.row-name { font: 500 17px/1.3 var(--font-serif); color: var(--navy); }
.row-address { font-size: 13px; color: var(--muted); }
.row-meta { display: flex; align-items: center; gap: 12px; margin-top: 4px; font-size: 13px; color: var(--muted); }
.row-flag { color: var(--warn); }
.row-monroe { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--blue); }
.empty-state { padding: 24px 0; color: var(--muted); }

.sidebar-cta { margin: 24px 0 16px; padding: 20px; background: var(--navy); color: #c9d2dc; font-size: 14px; }
.sidebar-cta p { margin: 0; }
.sidebar-cta strong { display: block; margin-bottom: 4px; color: #fff; font: 500 18px/1.3 var(--font-serif); }
.sidebar-cta .button { margin-top: 12px; }
.as-of { font-size: 12px; color: var(--muted); }

.map-wrap { position: relative; min-height: 0; }
.map { position: absolute; inset: 0; }
.map-notice { position: absolute; top: 12px; left: 12px; z-index: 2; margin: 0; padding: 8px 12px; background: var(--navy); color: #fff; font-size: 13px; }
.map-fallback { position: absolute; inset: 0; display: grid; place-content: center; padding: 32px; text-align: center; background: var(--surface); }
.map-fallback p:last-child { max-width: 420px; margin: 0 auto; }

/* Markers: MapLibre positions them with `transform`, so never set transform here. */
.marker { display: block; padding: 0; cursor: pointer; background: var(--marker-color); border: 2px solid #fff; border-radius: 50%; box-shadow: 0 1px 3px rgb(0 5 27 / 0.35); }
.marker--reported { background: #fff; border: 3px solid var(--marker-color); }
.marker--monroe { box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--blue); }
.marker.is-hover, .marker.is-selected, .marker:focus-visible { outline: 3px solid var(--navy); outline-offset: 2px; z-index: 3; }

.maplibregl-popup-content { border-radius: 0; padding: 16px 18px; font-family: var(--font-sans); box-shadow: 0 8px 24px rgb(0 5 27 / 0.18); }
.popup-status { margin: 0 0 6px; font: 600 11px/1 var(--font-sans); letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.popup-title { margin: 0; font-size: 20px; }
.popup-address { margin: 2px 0 0; font-size: 13px; color: var(--muted); }
.popup-meta { margin: 8px 0 0; font-size: 14px; }
.popup-flag { margin: 8px 0 0; font-size: 13px; color: var(--warn); }
.popup-monroe { margin: 8px 0 0; font-size: 12px; font-weight: 600; color: var(--blue); }
.popup-link { display: inline-block; margin-top: 12px; font-size: 14px; font-weight: 600; }

@media (max-width: 767px) {
  .app-shell { display: block; position: relative; }
  .map-wrap { position: absolute; inset: 0; }
  .sidebar { position: absolute; left: 0; right: 0; bottom: 0; z-index: 5; display: flex; flex-direction: column; max-height: 80%; overflow: hidden; border-right: 0; border-top: 1px solid var(--line); box-shadow: 0 -8px 24px rgb(0 5 27 / 0.12); }
  .sheet-handle { display: grid; justify-items: center; gap: 6px; width: 100%; padding: 10px 16px 12px; border: 0; background: var(--bg); color: var(--navy); font: 600 14px/1 var(--font-sans); cursor: pointer; }
  .sheet-grip { width: 40px; height: 4px; background: var(--line); }
  .sidebar-body { overflow-y: auto; padding: 0 16px 16px; }
  .sidebar[data-state="collapsed"] .sidebar-body { display: none; }
  .project-list { margin: 0 -16px; }
  .project-row { padding: 12px 16px; }
}
```

- [ ] **Step 9: Create `src/scripts/sidebar.ts`**

```ts
import type { FilterState, SortKey } from "../lib/filters";
import { formatMoney, formatUnits } from "../lib/format";
import { PROGRAMS, STATUSES } from "../lib/schema";
import type { Totals } from "../lib/stats";

function checkedValues(root: ParentNode, name: string): string[] {
  return [...root.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map((i) => i.value);
}

export function readFilters(root: ParentNode): Pick<FilterState, "statuses" | "programs"> {
  const statuses = checkedValues(root, "status");
  const programs = checkedValues(root, "program");
  return {
    statuses: STATUSES.filter((s) => statuses.includes(s)),
    programs: PROGRAMS.filter((p) => programs.includes(p)),
  };
}

export function writeFilters(root: ParentNode, state: FilterState): void {
  for (const input of root.querySelectorAll<HTMLInputElement>('input[name="status"], input[name="program"]')) {
    const values: readonly string[] = input.name === "status" ? state.statuses : state.programs;
    input.checked = values.includes(input.value);
  }
}

export function readSort(root: ParentNode): SortKey {
  const value = root.querySelector<HTMLSelectElement>("#sort")?.value;
  return value === "tpc" || value === "status" ? value : "units";
}

export function renderStats(root: ParentNode, t: Totals): void {
  const text: Record<string, string> = { count: String(t.count), units: formatUnits(t.units), tpc: formatMoney(t.tpcMusd) };
  for (const el of root.querySelectorAll<HTMLElement>("[data-stat]")) el.textContent = text[el.dataset.stat!] ?? "";
}

export function renderList(root: ParentNode, visibleIds: ReadonlySet<string>, selected: string | null): void {
  for (const item of root.querySelectorAll<HTMLLIElement>("#project-list > li[data-id]")) {
    const id = item.dataset.id!;
    item.hidden = !visibleIds.has(id);
    item.classList.toggle("is-selected", id === selected);
  }
  root.querySelector<HTMLElement>("#empty-state")!.hidden = visibleIds.size > 0;
}

export function applyOrder(root: ParentNode, order: readonly string[]): void {
  const list = root.querySelector<HTMLOListElement>("#project-list")!;
  for (const id of order) {
    const item = list.querySelector(`:scope > li[data-id="${id}"]`);
    if (item) list.append(item);
  }
}

export function scrollRowIntoView(root: ParentNode, id: string): void {
  root.querySelector(`#project-list > li[data-id="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

export function bindSheet(sidebar: HTMLElement): { collapse(): void } {
  const handle = sidebar.querySelector<HTMLButtonElement>(".sheet-handle")!;
  const set = (expanded: boolean) => {
    sidebar.dataset.state = expanded ? "expanded" : "collapsed";
    handle.setAttribute("aria-expanded", String(expanded));
  };
  handle.addEventListener("click", () => set(sidebar.dataset.state !== "expanded"));
  return { collapse: () => set(false) };
}
```

- [ ] **Step 10: Create `src/scripts/map-app.ts`**

```ts
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  applyFilters, parseFilterState, reconcileSelection, serializeFilterState, sortProjects, type FilterState,
} from "../lib/filters";
import { featureToProject } from "../lib/geojson";
import type { Project, ProjectCollection } from "../lib/schema";
import { totals } from "../lib/stats";
import { createBaseMap } from "../map/basemap";
import { createMarkerElement } from "../map/markers";
import { popupHtml } from "../map/popup";
import {
  applyOrder, bindSheet, readFilters, readSort, renderList, renderStats, scrollRowIntoView, writeFilters,
} from "./sidebar";

export const PROJECTS_URL = "/data/projects.geojson";
const MOBILE = window.matchMedia("(max-width: 767px)");

export async function startMapApp(): Promise<void> {
  const collection = (await (await fetch(PROJECTS_URL)).json()) as ProjectCollection;
  const projects = collection.features.map(featureToProject);
  const byId = new Map(projects.map((p) => [p.id, p]));

  const sidebar = document.getElementById("sidebar")!;
  const form = document.getElementById("filters") as HTMLFormElement;
  const list = document.getElementById("project-list")!;
  const container = document.getElementById("map")!;
  const sheet = bindSheet(sidebar);

  let state: FilterState = parseFilterState(window.location.search, [...byId.keys()]);
  writeFilters(sidebar, state);

  const map = createBaseMap({
    container,
    onTileError: () => { document.getElementById("map-notice")!.hidden = false; },
  });
  if (!map) {
    container.hidden = true;
    document.getElementById("map-fallback")!.hidden = false;
  }

  const markers = new Map<string, HTMLButtonElement>();
  let popup: maplibregl.Popup | null = null;
  let popupId: string | null = null;

  if (map) {
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    for (const p of projects) {
      const el = createMarkerElement(p);
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        select(p.id, { fly: false });
      });
      new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
      markers.set(p.id, el);
    }
    fitToProjects(map, applyFilters(projects, state));
  }

  function closePopup(): void {
    const current = popup;
    popup = null; // cleared first so the popup's own "close" handler below is a no-op
    popupId = null;
    current?.remove();
  }

  function openPopup(p: Project): void {
    if (!map) return;
    closePopup();
    const opened = new maplibregl.Popup({ offset: 18, maxWidth: "300px", focusAfterOpen: false })
      .setLngLat([p.lng, p.lat])
      .setHTML(popupHtml(p))
      .addTo(map);
    opened.on("close", () => {
      if (popup !== opened) return; // closed programmatically
      popup = null;
      popupId = null;
      state = { ...state, selected: null };
      render();
    });
    popup = opened;
    popupId = p.id;
  }

  function render(): void {
    const visible = applyFilters(projects, state);
    const visibleIds = new Set(visible.map((p) => p.id));
    state = reconcileSelection(state, [...visibleIds]);
    for (const [id, el] of markers) {
      el.hidden = !visibleIds.has(id);
      el.classList.toggle("is-selected", id === state.selected);
    }
    renderStats(sidebar, totals(visible));
    renderList(sidebar, visibleIds, state.selected);
    if (!state.selected) closePopup();
    else if (popupId !== state.selected) openPopup(byId.get(state.selected)!);
    window.history.replaceState(null, "", `${window.location.pathname}${serializeFilterState(state)}`);
  }

  function select(id: string, { fly }: { fly: boolean }): void {
    state = { ...state, selected: id };
    render();
    scrollRowIntoView(sidebar, id);
    const p = byId.get(id);
    if (fly && map && p) {
      map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 16), pitch: 50, essential: true });
    }
  }

  function hover(event: MouseEvent, on: boolean): void {
    const id = (event.target as Element).closest<HTMLElement>("li[data-id]")?.dataset.id;
    if (id) markers.get(id)?.classList.toggle("is-hover", on);
  }

  form.addEventListener("submit", (event) => event.preventDefault());
  form.addEventListener("change", (event) => {
    if ((event.target as HTMLElement).id === "sort") {
      applyOrder(sidebar, sortProjects(projects, readSort(sidebar)).map((p) => p.id));
      return;
    }
    state = { ...state, ...readFilters(sidebar) };
    render();
  });

  list.addEventListener("click", (event) => {
    const row = (event.target as Element).closest<HTMLAnchorElement>("a.project-row");
    // Without a map, rows are plain links to project pages. Modified clicks open the page too.
    if (!row || !map || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    if (MOBILE.matches) sheet.collapse();
    select(row.dataset.id!, { fly: true });
  });
  list.addEventListener("mouseover", (event) => hover(event, true));
  list.addEventListener("mouseout", (event) => hover(event, false));

  render();
  if (state.selected) select(state.selected, { fly: true });
}

function fitToProjects(map: MapLibreMap, projects: readonly Project[]): void {
  if (projects.length === 0) return;
  const bounds = new maplibregl.LngLatBounds();
  for (const p of projects) bounds.extend([p.lng, p.lat]);
  const padding = MOBILE.matches
    ? { top: 48, bottom: Math.round(window.innerHeight * 0.35), left: 32, right: 32 }
    : 64;
  map.fitBounds(bounds, { padding, maxZoom: 15, animate: false });
}
```

- [ ] **Step 11: Replace `src/pages/index.astro`**

```astro
---
import Filters from "../components/Filters.astro";
import MapView from "../components/MapView.astro";
import ProjectList from "../components/ProjectList.astro";
import StatTiles from "../components/StatTiles.astro";
import Base from "../layouts/Base.astro";
import { DATA_AS_OF } from "../lib/data-meta";
import { sortProjects } from "../lib/filters";
import { formatDate, formatMoney, formatUnits } from "../lib/format";
import { loadProjects } from "../lib/load-projects";
import { countByStatus, totals } from "../lib/stats";
import "../styles/map.css";

const projects = loadProjects();
const t = totals(projects);
const description = `${t.count} office-to-residential conversions in downtown Chicago: ${formatUnits(t.units)} units and ${formatMoney(t.tpcMusd)} in project costs, mapped by status.`;
---
<Base title="Chicago Pipeline · Downtown Office-to-Residential Conversions" description={description} fullscreen>
  <div class="app-shell">
    <aside id="sidebar" class="sidebar" data-state="collapsed" aria-label="Projects">
      <button type="button" class="sheet-handle" aria-expanded="false" aria-controls="sidebar-body">
        <span class="sheet-grip" aria-hidden="true"></span>
        <span><span data-stat="count">{t.count}</span> projects · <span data-stat="units">{formatUnits(t.units)}</span> units</span>
      </button>
      <div class="sidebar-body" id="sidebar-body">
        <p class="eyebrow">Downtown Chicago</p>
        <h1 class="sidebar-title">Office-to-Residential Conversions</h1>
        <StatTiles totals={t} />
        <Filters counts={countByStatus(projects)} />
        <ProjectList projects={sortProjects(projects, "units")} />
        <div class="sidebar-cta">
          <p><strong>Have a project in mind?</strong>We live to talk about the next great project.</p>
          <a class="button" href="tel:+13122964855">(312) 296-4855</a>
        </div>
        <p class="as-of">Data as of {formatDate(DATA_AS_OF)} · <a href="/about">Sources &amp; methodology</a></p>
      </div>
    </aside>
    <MapView />
  </div>
  <script>
    import { startMapApp } from "../scripts/map-app";
    startMapApp();
  </script>
</Base>
```

- [ ] **Step 12: Run all e2e tests**

Run: `pnpm test:e2e`
Expected: PASS (layout, projects, map, deeplinks, degradation, mobile).

- [ ] **Step 13: Visual check in the browser**

Run: `pnpm dev`, open http://localhost:4321. Confirm:
- Basemap is muted gray with blue-gray water (demo tiles); no POI icons.
- 27 markers, colored by stage; 2 hollow (70 E Lake, 118 S Clinton); 2 with a blue ring (Boylston, Birken).
- Clicking a list row flies in with a tilt, and 3D buildings appear at zoom ≥ 15. If buildings are flat, the tiles lack `height`; leave the 12 m fallback.
- Compare every pin with `data/raw/dpd-map-2026-06.jpg`. Any pin not on its building: fix `lat`/`lng` in `data/projects.csv` (OpenStreetMap → right-click → "Show address") and re-run `pnpm test`.

- [ ] **Step 14: Commit**

```bash
git add src tests data/projects.csv
git commit -m "feat: interactive pipeline map with filters, list and deep links"
```

---

### Task 9: Share images (OG) and SEO checks

**Files:**
- Create: `src/lib/og.ts`, `src/pages/og/[id].png.ts`
- Test: `tests/unit/og.test.ts`, `tests/e2e/seo.spec.ts`

**Interfaces:**
- Consumes: `Project`, `STATUS_LABELS`, `displayName`, `formatUnits`, `formatMoney`, `loadProjects`, `totals`.
- Produces: `interface OgContent { eyebrow: string; title: string; subtitle: string }`, `projectOgContent(p: Project): OgContent`, `siteOgContent(projects: readonly Project[]): OgContent`, `renderOgPng(c: OgContent): Promise<ArrayBuffer>`; static files `/og/site.png` and `/og/{id}.png` (1200×630).

- [ ] **Step 1: Write failing `tests/unit/og.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { projectOgContent, renderOgPng, siteOgContent } from "../../src/lib/og";
import { makeProject } from "./fixtures";

describe("OG content", () => {
  it("summarizes a project", () => {
    expect(projectOgContent(makeProject())).toEqual({
      eyebrow: "Chicago Pipeline",
      title: "Harris Bank building",
      subtitle: "345 units · $179M · Approved",
    });
  });

  it("skips missing numbers and labels reported projects", () => {
    const c = projectOgContent(makeProject({ name: null, address: "118 S. Clinton St", tpc_musd: null, units: 74, status: "permitted", confidence: "reported" }));
    expect(c).toEqual({ eyebrow: "Chicago Pipeline · Reported", title: "118 S. Clinton St", subtitle: "74 units · Permitted" });
  });

  it("summarizes the whole pipeline", () => {
    const c = siteOgContent([makeProject({ id: "a", units: 100, tpc_musd: 1000 }), makeProject({ id: "b", units: 50, tpc_musd: 500 })]);
    expect(c.subtitle).toBe("2 projects · 150 units · $1.5B");
  });
});

describe("renderOgPng", () => {
  it("renders a PNG", async () => {
    const png = new Uint8Array(await renderOgPng({ eyebrow: "Chicago Pipeline", title: "Test & <Title>", subtitle: "1 unit" }));
    expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }, 20_000);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test tests/unit/og.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/lib/og.ts`**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import satori, { type SatoriOptions } from "satori";
import { displayName, formatMoney, formatUnits } from "./format";
import { STATUS_LABELS, type Project } from "./schema";
import { totals } from "./stats";

export interface OgContent {
  eyebrow: string;
  title: string;
  subtitle: string;
}

export function projectOgContent(p: Project): OgContent {
  return {
    eyebrow: p.confidence === "reported" ? "Chicago Pipeline · Reported" : "Chicago Pipeline",
    title: displayName(p),
    subtitle: [
      p.units === null ? null : `${formatUnits(p.units)} units`,
      p.tpc_musd === null ? null : formatMoney(p.tpc_musd),
      STATUS_LABELS[p.status],
    ].filter(Boolean).join(" · "),
  };
}

export function siteOgContent(projects: readonly Project[]): OgContent {
  const t = totals(projects);
  return {
    eyebrow: "Chicago Pipeline",
    title: "Downtown Office-to-Residential Conversions",
    subtitle: `${t.count} projects · ${formatUnits(t.units)} units · ${formatMoney(t.tpcMusd)}`,
  };
}

// Satori reads woff/ttf (not woff2); @fontsource ships .woff alongside .woff2.
const fontFile = (path: string) => readFileSync(resolve(process.cwd(), "node_modules/@fontsource", path));
let fonts: SatoriOptions["fonts"] | undefined;
function loadFonts(): SatoriOptions["fonts"] {
  fonts ??= [
    { name: "Newsreader", data: fontFile("newsreader/files/newsreader-latin-500-normal.woff"), weight: 500, style: "normal" },
    { name: "Inter", data: fontFile("inter/files/inter-latin-400-normal.woff"), weight: 400, style: "normal" },
    { name: "Inter", data: fontFile("inter/files/inter-latin-600-normal.woff"), weight: 600, style: "normal" },
  ];
  return fonts;
}

type Child = OgNode | string;
interface OgNode { type: string; props: { style: Record<string, unknown>; children?: Child | Child[] } }
const div = (style: Record<string, unknown>, children?: Child | Child[]): OgNode => ({ type: "div", props: { style, children } });

export async function renderOgPng({ eyebrow, title, subtitle }: OgContent): Promise<ArrayBuffer> {
  const tree = div(
    { width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px 80px", background: "#00051B", color: "#FFFFFF", fontFamily: "Inter" },
    [
      div({ display: "flex", flexDirection: "column" }, [
        div({ fontSize: 22, fontWeight: 600, letterSpacing: 4, textTransform: "uppercase", color: "#8FB3CF" }, eyebrow),
        div({ width: 96, height: 4, background: "#33709B", marginTop: 28, marginBottom: 36 }),
        div({ fontFamily: "Newsreader", fontWeight: 500, fontSize: title.length > 40 ? 60 : 76, lineHeight: 1.08 }, title),
        div({ fontSize: 32, color: "#C9D2DC", marginTop: 24 }, subtitle),
      ]),
      div({ display: "flex", justifyContent: "space-between", fontSize: 22, color: "#8FB3CF" }, [
        div({}, "Monroe Residential Partners"),
        div({}, "pipeline.monroeresidential.com"),
      ]),
    ],
  );
  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], { width: 1200, height: 630, fonts: loadFonts() });
  const png = new Resvg(svg).render().asPng();
  return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
}
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `pnpm test tests/unit/og.test.ts`
Expected: PASS.

- [ ] **Step 5: Create `src/pages/og/[id].png.ts`**

```ts
import type { APIRoute, GetStaticPaths } from "astro";
import { loadProjects } from "../../lib/load-projects";
import { projectOgContent, renderOgPng, siteOgContent, type OgContent } from "../../lib/og";

export const getStaticPaths = (() => {
  const projects = loadProjects();
  return [
    { params: { id: "site" }, props: { content: siteOgContent(projects) } },
    ...projects.map((p) => ({ params: { id: p.id }, props: { content: projectOgContent(p) } })),
  ];
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) =>
  new Response(await renderOgPng((props as { content: OgContent }).content), {
    headers: { "Content-Type": "image/png" },
  });
```

- [ ] **Step 6: Write `tests/e2e/seo.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

for (const path of ["/og/site.png", "/og/111-w-monroe.png", "/og/118-s-clinton.png"]) {
  test(`share image ${path} is a PNG`, async ({ request }) => {
    const res = await request.get(path);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
  });
}

test("home page has share tags and a description", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://pipeline.monroeresidential.com/og/site.png");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /27 office-to-residential conversions/);
});

test("sitemap lists project pages and robots.txt points to it", async ({ request }) => {
  const sitemap = await (await request.get("/sitemap-0.xml")).text();
  expect(sitemap).toContain("https://pipeline.monroeresidential.com/projects/111-w-monroe<");
  expect(sitemap).not.toContain("/og/");
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Sitemap: https://pipeline.monroeresidential.com/sitemap-index.xml");
});
```

- [ ] **Step 7: Run e2e and look at one image**

Run: `pnpm test:e2e tests/e2e/seo.spec.ts && open dist/og/111-w-monroe.png`
Expected: tests PASS; the image is navy with a blue rule, "Harris Bank building" in Newsreader and "345 units · $179M · Approved" beneath. If the sitemap assertion fails because the URL has a trailing slash or `/og/` entries appear, set `sitemap({ filter: (page) => !page.includes("/og/") })` in `astro.config.mjs` and confirm `trailingSlash: "never"` is set.

- [ ] **Step 8: Commit**

```bash
git add src/lib/og.ts src/pages/og tests astro.config.mjs
git commit -m "feat: generated share images and SEO checks"
```

---

### Task 10: Lazy mini-map on project pages

**Files:**
- Create: `src/components/MiniMap.astro`
- Modify: `src/pages/projects/[id].astro` (insert `<MiniMap>` inside `<aside class="project-aside">`, after `.project-location`)
- Test: `tests/e2e/minimap.spec.ts`

**Interfaces:**
- Consumes: `createBaseMap` (Task 7), `STATUS_COLORS`, `Status`.
- Produces: `MiniMap.astro` props `{ lng: number; lat: number; status: Status; label: string }`. MapLibre is fetched via dynamic `import()` only when the element nears the viewport.

- [ ] **Step 1: Write failing `tests/e2e/minimap.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

test("project page shows a mini-map once it is near the viewport", async ({ page }) => {
  await page.goto("/projects/65-e-wacker");
  const mini = page.locator(".mini-map");
  await mini.scrollIntoViewIfNeeded();
  await expect(mini.locator("canvas")).toHaveCount(1);
  await expect(mini).toHaveAttribute("aria-label", "Map showing Wacker Place (Millinery Mart)");
});

test("mini-map without WebGL shows a quiet fallback", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type.startsWith("webgl")) return null;
      return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });
  await page.goto("/projects/65-e-wacker");
  await page.locator(".mini-map").scrollIntoViewIfNeeded();
  await expect(page.locator(".mini-map")).toHaveClass(/is-unavailable/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:e2e tests/e2e/minimap.spec.ts`
Expected: FAIL — `.mini-map` not found.

- [ ] **Step 3: Create `src/components/MiniMap.astro`**

```astro
---
import { STATUS_COLORS, type Status } from "../lib/schema";

interface Props {
  lng: number;
  lat: number;
  status: Status;
  label: string;
}
const { lng, lat, status, label } = Astro.props;
---
<div class="mini-map" role="img" aria-label={`Map showing ${label}`} data-lng={lng} data-lat={lat} data-color={STATUS_COLORS[status]}></div>

<script>
  // MapLibre stays out of the initial bundle: it's imported only when the mini-map nears the viewport.
  for (const el of document.querySelectorAll<HTMLElement>(".mini-map")) {
    const observer = new IntersectionObserver(async (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      const [{ createBaseMap }, { default: maplibregl }] = await Promise.all([
        import("../map/basemap"),
        import("maplibre-gl"),
        import("maplibre-gl/dist/maplibre-gl.css"),
      ]);
      const center: [number, number] = [Number(el.dataset.lng), Number(el.dataset.lat)];
      const map = createBaseMap({
        container: el,
        center,
        zoom: 15.5,
        interactive: false,
        onTileError: () => el.classList.add("is-unavailable"),
      });
      if (!map) {
        el.classList.add("is-unavailable");
        return;
      }
      const pin = document.createElement("div");
      pin.className = "mini-map-pin";
      pin.style.background = el.dataset.color!;
      new maplibregl.Marker({ element: pin }).setLngLat(center).addTo(map);
    }, { rootMargin: "200px" });
    observer.observe(el);
  }
</script>

<style>
  .mini-map { position: relative; aspect-ratio: 4 / 3; background: var(--surface); border: 1px solid var(--line); }
  .mini-map.is-unavailable::after { content: "Map unavailable"; position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); font-size: 13px; }
  :global(.mini-map-pin) { width: 20px; height: 20px; border: 3px solid #fff; border-radius: 50%; box-shadow: 0 1px 4px rgb(0 5 27 / 0.4); }
</style>
```

- [ ] **Step 4: Insert the mini-map into `src/pages/projects/[id].astro`**

Add to the frontmatter imports:
```ts
import MiniMap from "../../components/MiniMap.astro";
```

Replace the `<aside>` block with:
```astro
      <aside class="project-aside" aria-label="Location">
        <p class="eyebrow">Location</p>
        <p class="project-location">{p.address}<br />Chicago, IL</p>
        <MiniMap lng={p.lng} lat={p.lat} status={p.status} label={name} />
        <p><a href={`/?project=${p.id}`}>View on the pipeline map →</a></p>
      </aside>
```

- [ ] **Step 5: Run the e2e tests**

Run: `pnpm test:e2e tests/e2e/minimap.spec.ts tests/e2e/projects.spec.ts`
Expected: PASS.

- [ ] **Step 6: Confirm MapLibre is not in the project page's initial scripts**

Run:
```bash
pnpm build
grep -o '<script[^>]*src="[^"]*"' dist/projects/65-e-wacker.html
```
Expected: one small module script. Then `grep -l "maplibregl\|addProtocol" dist/_astro/*.js` lists only chunks that are *not* referenced directly by that `<script src>` (they are loaded by dynamic import).

- [ ] **Step 7: Commit**

```bash
git add src/components/MiniMap.astro src/pages/projects tests/e2e/minimap.spec.ts
git commit -m "feat: lazy-loaded location mini-map on project pages"
```

---

### Task 11: Continuous integration

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: scripts `data:check`, `check`, `test`, `test:e2e`.

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm data:check
      - run: pnpm check
      - run: pnpm test
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

- [ ] **Step 2: Push the branch and confirm CI is green**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: data check, type check, unit and e2e tests"
git push -u origin HEAD
gh run watch --exit-status
```
Expected: the `CI` run passes. If Playwright can't create a WebGL context on the runner (map tests fail with `#map-fallback` visible), confirm the `--use-angle=swiftshader --enable-unsafe-swiftshader` launch args in `playwright.config.ts` are in effect.

---

### Task 12: Basemap tiles on Cloudflare R2

> Needs the Cloudflare account that owns `monroeresidential.com`. The human partner runs `! pnpm exec wrangler login` in the session first.

**Files:**
- Create: `scripts/r2-cors.json`
- Delete: `.env.development`

**Interfaces:**
- Produces: `https://tiles.monroeresidential.com/chicago.pmtiles` (HTTP range requests, CORS open for GET/HEAD), which is `DEFAULT_PMTILES_URL` in `src/map/style.ts`.

- [ ] **Step 1: Install the `pmtiles` CLI**

```bash
mkdir -p tiles
gh release download --repo protomaps/go-pmtiles --pattern '*Darwin_arm64.zip' --dir tiles --clobber
unzip -o tiles/*Darwin_arm64.zip -d tiles/bin
tiles/bin/pmtiles version
```

- [ ] **Step 2: Extract downtown Chicago from the latest daily build**

```bash
BUILD=$(curl -s https://build-metadata.protomaps.dev/builds.json | python3 -c 'import sys,json;print(json.load(sys.stdin)[-1]["key"])')
echo "$BUILD"   # e.g. 20260928.pmtiles
tiles/bin/pmtiles extract "https://build.protomaps.com/$BUILD" tiles/chicago.pmtiles \
  --bbox=-87.78,41.80,-87.56,41.97 --maxzoom=15
tiles/bin/pmtiles show tiles/chicago.pmtiles | head -20
ls -lh tiles/chicago.pmtiles
```
Expected: a file of roughly 20–80 MB; `show` reports max zoom 15 and bounds matching the bbox.

- [ ] **Step 3: Create the bucket, upload, set CORS**

`scripts/r2-cors.json`:
```json
{
  "rules": [
    {
      "allowed": { "origins": ["*"], "methods": ["GET", "HEAD"], "headers": ["range", "if-match"] },
      "exposeHeaders": ["etag"],
      "maxAgeSeconds": 86400
    }
  ]
}
```

```bash
pnpm exec wrangler r2 bucket create chicago-pipeline-tiles
pnpm exec wrangler r2 object put chicago-pipeline-tiles/chicago.pmtiles --file tiles/chicago.pmtiles --remote --content-type application/octet-stream
pnpm exec wrangler r2 bucket cors set chicago-pipeline-tiles --file scripts/r2-cors.json
```
If `cors set` rejects the file, run `pnpm exec wrangler r2 bucket cors set --help` and match the rules format it documents.

- [ ] **Step 4: Attach the custom domain**

In the Cloudflare dashboard: R2 → `chicago-pipeline-tiles` → Settings → Custom Domains → Connect Domain → `tiles.monroeresidential.com`. (CLI alternative: `pnpm exec wrangler r2 bucket domain add chicago-pipeline-tiles --domain tiles.monroeresidential.com --zone-id <the monroeresidential.com zone ID from the dashboard Overview page>`.)

- [ ] **Step 5: Verify range requests and CORS**

```bash
curl -sI -H "Range: bytes=0-126" -H "Origin: https://pipeline.monroeresidential.com" https://tiles.monroeresidential.com/chicago.pmtiles
```
Expected: `HTTP/2 206`, `content-range: bytes 0-126/…`, `access-control-allow-origin: *`.

- [ ] **Step 6: Switch local dev to the real tiles and re-test**

```bash
git rm .env.development
pnpm dev   # open http://localhost:4321 — basemap loads from tiles.monroeresidential.com, no notice
pnpm test:e2e
```

- [ ] **Step 7: Commit**

```bash
git add scripts/r2-cors.json
git commit -m "chore: serve basemap tiles from R2 at tiles.monroeresidential.com"
```

---

### Task 13: Deploy the site to Cloudflare Workers

**Files:**
- Create: `wrangler.jsonc`
- Modify: `package.json` (add `deploy` script), `README.md` (add Deploy section)

**Interfaces:**
- Produces: `https://pipeline.monroeresidential.com` served from `dist/` via Workers static assets; pushes to `main` auto-deploy.

- [ ] **Step 1: Create `wrangler.jsonc`**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "chicago-pipeline",
  "compatibility_date": "2026-09-28",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "404-page"
  },
  "routes": [{ "pattern": "pipeline.monroeresidential.com", "custom_domain": true }]
}
```

- [ ] **Step 2: Add the deploy script and README section**

```bash
npm pkg set scripts.deploy="astro build && wrangler deploy"
```

Append to `README.md`:
````markdown
## Deploy

Pushes to `main` deploy automatically (Cloudflare Workers Builds). Manual deploy:

```bash
pnpm exec wrangler login   # once
pnpm deploy
```

Basemap tiles live in R2 bucket `chicago-pipeline-tiles` at https://tiles.monroeresidential.com/chicago.pmtiles
(regenerate with `pmtiles extract`, see docs/superpowers/plans/2026-09-28-chicago-pipeline-map.md Task 12).
````

- [ ] **Step 3: First deploy**

Run: `pnpm deploy`
Expected: Wrangler uploads the assets and prints `https://pipeline.monroeresidential.com` as a custom-domain route.

- [ ] **Step 4: Verify production**

```bash
curl -sI https://pipeline.monroeresidential.com/ | head -1                        # HTTP/2 200
curl -sI https://pipeline.monroeresidential.com/projects/111-w-monroe | head -1   # HTTP/2 200, no redirect
curl -sI https://pipeline.monroeresidential.com/nope | head -1                    # HTTP/2 404
curl -sI "https://pipeline.monroeresidential.com/map-assets/fonts/Noto%20Sans%20Regular/0-255.pbf" | head -1   # HTTP/2 200
curl -s https://pipeline.monroeresidential.com/data/projects.geojson | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["features"]))'   # 27
```
If `/projects/111-w-monroe` returns 307 to a trailing-slash URL, confirm `build.format: "file"` in `astro.config.mjs` and redeploy.

- [ ] **Step 5: Connect Workers Builds for auto-deploy**

Cloudflare dashboard → Workers & Pages → `chicago-pipeline` → Settings → Builds → Connect → GitHub → `monroeresidential/chicago-residential-pipeline`, branch `main`.
- Build command: `pnpm install --frozen-lockfile && pnpm build`
- Deploy command: `npx wrangler deploy`
- Non-production branch deploy command: `npx wrangler versions upload` (PR preview URLs)

- [ ] **Step 6: Enable Web Analytics**

Dashboard → Analytics & Logs → Web Analytics → Add a site → `pipeline.monroeresidential.com` → choose the JS snippet and copy the token. Add it as a **build** variable `PUBLIC_CF_BEACON_TOKEN` in the Workers Builds settings, then trigger a rebuild. Verify: `curl -s https://pipeline.monroeresidential.com/ | grep -c cloudflareinsights` → `1`.

- [ ] **Step 7: Commit and push (triggers the first automatic build)**

```bash
git add wrangler.jsonc package.json README.md
git commit -m "chore: deploy to Cloudflare Workers at pipeline.monroeresidential.com"
git push
```
Expected: Workers Builds runs and deploys; the dashboard shows a successful build for the pushed commit.

---

### Task 14: Launch checks

**Files:**
- Modify: `data/projects.csv` (only if pins need correcting), `docs/superpowers/specs/2026-09-28-chicago-pipeline-map-design.md` (record deviations)

- [ ] **Step 1: Pin-by-pin check on production**

Open https://pipeline.monroeresidential.com, zoom to each of the 27 projects via the list, and confirm the marker sits on the building (compare with `data/raw/dpd-map-2026-06.jpg` and the street address). Fix any stray `lat`/`lng`, then `pnpm test && git commit -am "fix: correct pin locations" && git push`.

- [ ] **Step 2: Lighthouse**

```bash
for url in https://pipeline.monroeresidential.com/ https://pipeline.monroeresidential.com/projects/111-w-monroe; do
  pnpm dlx lighthouse "$url" --quiet --chrome-flags="--headless=new" \
    --only-categories=performance,accessibility,seo,best-practices --output=json --output-path=tiles/lh.json
  python3 -c 'import json;d=json.load(open("tiles/lh.json"));print(d["finalDisplayedUrl"],{k:round(v["score"]*100) for k,v in d["categories"].items()})'
done
```
Expected: project page performance ≥ 95, map page performance ≥ 85, accessibility ≥ 95 on both. If a target is missed, report the top three Lighthouse opportunities to the human partner before changing anything.

- [ ] **Step 3: Share previews and devices**

- Paste a project URL into https://www.opengraph.xyz and confirm the navy share image with the right title shows up.
- On a phone: the bottom sheet opens and closes, a list tap flies to the marker, the project page is readable, and the phone button dials.
- On a laptop: the filters, sort, popup, and back link from a project page (`/?project=…`) all work.

- [ ] **Step 4: Record deviations in the spec**

Add a "## 8. Implementation notes" section to the spec listing the eight deviations from this plan's "Spec deviations" section, then:

```bash
git add docs/superpowers/specs/2026-09-28-chicago-pipeline-map-design.md
git commit -m "docs: record Phase 1 implementation deviations in spec"
git push
```
