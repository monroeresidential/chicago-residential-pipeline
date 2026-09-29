# LLM-Friendly Data + Suggestion Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish LLM-readable formats of the pipeline (`/llms.txt`, `/llms-full.txt`, per-page Markdown, CSV/JSON) and a Formspree suggestion form usable by people and agents.

**Architecture:** Pure text generators in `src/lib/` turn `loadProjects()` output into Markdown/CSV/JSON; Astro static endpoints (`src/pages/*.ts`) write them to `dist/` at build time, so every format stays in sync with `data/projects.csv`. The suggestion form is a static HTML form posting to Formspree, enhanced by a small vanilla-TS script. No server code.

**Tech Stack:** Astro 7 static endpoints, PapaParse, Vitest, Playwright (Formspree mocked with `page.route`).

**Spec:** `docs/superpowers/specs/2026-09-28-llm-friendly-design.md`

## Global Constraints

- Site URL in generated text: `https://pipeline.monroeresidential.com` (constant `SITE_URL`), never `localhost`.
- Formspree endpoint: `https://formspree.io/f/maenaqbd` (constant `FORMSPREE_ENDPOINT`).
- Missing values render as `—`; generated text never contains `null` or `undefined`.
- Markdown escaping applies to every data value placed in Markdown: backslash, backtick, `*`, `_`, `[`, `]`, `|`, `<`, `>`.
- Project lines in `llms.txt` are sorted by units descending (`sortProjects(projects, "units")`).
- Nothing submitted is published automatically; copy always says Monroe reviews every submission.
- No new runtime dependencies; no server code; tests never contact Formspree.
- Work on branch `llm-friendly`; deploy happens when it merges to `main`.

## Review Focus

1. **Projects with null fields** (118 S Clinton, 620 N LaSalle: no name/cost/public support) must show `—` in `llms.txt`, `llms-full.txt` and their `.md` — never `null`. Test: Task 2 `llm-text.test.ts`, Task 3 e2e `no null`.
2. **Markdown injection:** a name/flag/note containing `|`, `[`, `]`, `*` or `<` must not break the list line or link. Test: Task 2 escaping tests.
3. **Form submission failure** (network error or Formspree 4xx/5xx) must show the error message, re-enable the button and keep what the user typed. Test: Task 5 e2e error case asserts field values kept.
4. **Unknown `?project=` value** on the About page must leave the select on "New project". Test: Task 5 e2e.
5. **Every link in `llms.txt` must resolve** and use the production origin. Test: Task 3 e2e requests each link path.

---

## File Structure

```
src/lib/site-config.ts          SITE_URL, FORMSPREE_ENDPOINT
src/lib/methodology.ts          methodology copy shared by about.astro and about.md
src/lib/export.ts               projectsToCsv, projectsToJson
src/lib/llm-text.ts             mdEscape, projectLabel, projectLine, projectFacts,
                                projectMarkdown, suggestSection, llmsTxt, llmsFullTxt, aboutMarkdown
src/pages/llms.txt.ts           /llms.txt
src/pages/llms-full.txt.ts      /llms-full.txt
src/pages/about.md.ts           /about.md
src/pages/projects/[id].md.ts   /projects/<id>.md
src/pages/data/projects.csv.ts  /data/projects.csv
src/pages/data/projects.json.ts /data/projects.json
src/components/SuggestForm.astro  suggestion form markup
src/scripts/suggest-form.ts     progressive-enhancement submit handler
Modify: src/layouts/Base.astro (markdownPath prop + help link), src/pages/about.astro,
        src/pages/index.astro, src/pages/projects/[id].astro, src/components/Footer.astro,
        src/styles/global.css, README.md, CLAUDE.md
Tests: tests/unit/export.test.ts, tests/unit/llm-text.test.ts,
       tests/e2e/llm.spec.ts, tests/e2e/suggest.spec.ts
```

---

### Task 1: Site config, CSV/JSON exports and download endpoints

**Files:**
- Create: `src/lib/site-config.ts`, `src/lib/export.ts`, `src/pages/data/projects.csv.ts`, `src/pages/data/projects.json.ts`
- Test: `tests/unit/export.test.ts`, `tests/e2e/llm.spec.ts` (downloads part)

**Interfaces:**
- Consumes: `CSV_COLUMNS`, `parseProjectsCsv` (`src/lib/parse-projects.ts`); `loadProjects`; `DATA_AS_OF`; `Project`.
- Produces: `SITE_URL: string`, `FORMSPREE_ENDPOINT: string`; `projectsToCsv(projects: readonly Project[]): string`; `projectsToJson(projects: readonly Project[], asOf: string): string` (JSON of `{ as_of, projects }`).

- [ ] **Step 1: Write failing `tests/unit/export.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { projectsToCsv, projectsToJson } from "../../src/lib/export";
import { loadProjects } from "../../src/lib/load-projects";
import { parseProjectsCsv } from "../../src/lib/parse-projects";
import { makeProject } from "./fixtures";

describe("projectsToCsv", () => {
  it("round-trips the real dataset through the CSV parser", () => {
    const projects = loadProjects();
    const { projects: back, errors } = parseProjectsCsv(projectsToCsv(projects));
    expect(errors).toEqual([]);
    expect(back).toEqual(projects);
  });

  it("writes nulls as empty cells and joins sources with ' | '", () => {
    const csv = projectsToCsv([makeProject({ name: null, sources: ["https://a.example/", "https://b.example/"] })]);
    expect(csv).toContain("111-w-monroe,1,,111 W. Monroe St");
    expect(csv).toContain("https://a.example/ | https://b.example/");
    expect(csv).not.toContain("null");
  });
});

describe("projectsToJson", () => {
  it("wraps projects with as_of", () => {
    const parsed = JSON.parse(projectsToJson([makeProject()], "2026-09-28"));
    expect(parsed.as_of).toBe("2026-09-28");
    expect(parsed.projects).toHaveLength(1);
    expect(parsed.projects[0].id).toBe("111-w-monroe");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test tests/unit/export.test.ts`
Expected: FAIL — cannot find `src/lib/export`.

- [ ] **Step 3: Create `src/lib/site-config.ts` and `src/lib/export.ts`**

`src/lib/site-config.ts`:
```ts
export const SITE_URL = "https://pipeline.monroeresidential.com";
// "Chicago Pipeline suggestions" form in Monroe's Formspree account (same account as tetonflats.com).
export const FORMSPREE_ENDPOINT = "https://formspree.io/f/maenaqbd";
```

`src/lib/export.ts`:
```ts
import Papa from "papaparse";
import { CSV_COLUMNS } from "./parse-projects";
import type { Project } from "./schema";

export function projectsToCsv(projects: readonly Project[]): string {
  const data = projects.map((p) =>
    CSV_COLUMNS.map((column) => {
      const value = p[column];
      if (value === null) return "";
      return Array.isArray(value) ? value.join(" | ") : String(value);
    }),
  );
  return `${Papa.unparse({ fields: [...CSV_COLUMNS], data }, { newline: "\n" })}\n`;
}

export function projectsToJson(projects: readonly Project[], asOf: string): string {
  return JSON.stringify({ as_of: asOf, projects }, null, 2);
}
```

- [ ] **Step 4: Run unit tests**

Run: `pnpm test tests/unit/export.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write failing e2e `tests/e2e/llm.spec.ts` (downloads)**

```ts
import { expect, test } from "@playwright/test";
import Papa from "papaparse";

test("CSV and JSON downloads contain every project", async ({ request }) => {
  const geo = await (await request.get("/data/projects.geojson")).json();
  const csv = await request.get("/data/projects.csv");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const rows = Papa.parse<Record<string, string>>(await csv.text(), { header: true, skipEmptyLines: true }).data;
  expect(rows).toHaveLength(geo.features.length);
  const json = await request.get("/data/projects.json");
  expect(json.status()).toBe(200);
  const body = await json.json();
  expect(body.projects).toHaveLength(geo.features.length);
  expect(body.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
```

Run: `pnpm test:e2e tests/e2e/llm.spec.ts`
Expected: FAIL — 404 for `/data/projects.csv`.

- [ ] **Step 6: Create the endpoints**

`src/pages/data/projects.csv.ts`:
```ts
import type { APIRoute } from "astro";
import { projectsToCsv } from "../../lib/export";
import { loadProjects } from "../../lib/load-projects";

export const GET: APIRoute = () =>
  new Response(projectsToCsv(loadProjects()), { headers: { "Content-Type": "text/csv; charset=utf-8" } });
```

`src/pages/data/projects.json.ts`:
```ts
import type { APIRoute } from "astro";
import { DATA_AS_OF } from "../../lib/data-meta";
import { projectsToJson } from "../../lib/export";
import { loadProjects } from "../../lib/load-projects";

export const GET: APIRoute = () =>
  new Response(projectsToJson(loadProjects(), DATA_AS_OF), { headers: { "Content-Type": "application/json; charset=utf-8" } });
```

- [ ] **Step 7: Run e2e, type check, commit**

Run: `pnpm test:e2e tests/e2e/llm.spec.ts && pnpm check`
Expected: PASS; 0 errors.

```bash
git add src/lib/site-config.ts src/lib/export.ts src/pages/data tests
git commit -m "feat: CSV and JSON downloads of the project data"
```

---

### Task 2: Markdown/text generators and shared methodology copy

**Files:**
- Create: `src/lib/methodology.ts`, `src/lib/llm-text.ts`
- Modify: `src/pages/about.astro` (render methodology from `methodology.ts`)
- Test: `tests/unit/llm-text.test.ts`

**Interfaces:**
- Consumes: `Project`, `STATUSES`, `STATUS_LABELS`, `PROGRAM_LABELS`; `formatUnits`, `formatMoney`, `EMPTY`; `sortProjects`; `totals`, `countByStatus`.
- Produces (`methodology.ts`): `METHODOLOGY: { intro: string; sources: string[]; reconciliation: string; stages: { label: string; description: string }[]; riskNote: string; disclaimer: string }`
- Produces (`llm-text.ts`):
  - `mdEscape(s: string): string`
  - `projectLabel(p: Project): string` — `"<address> — <name>"` or `"<address>"`
  - `projectLine(p: Project, site: string): string`
  - `projectFacts(p: Project, site: string): string[]` — bullet lines + notes/sources blocks
  - `projectMarkdown(p: Project, asOf: string, site: string): string`
  - `suggestSection(endpoint: string): string`
  - `llmsTxt(projects: readonly Project[], asOf: string, site: string, endpoint: string): string`
  - `llmsFullTxt(projects: readonly Project[], asOf: string, site: string, endpoint: string): string`
  - `aboutMarkdown(asOf: string, site: string, endpoint: string): string`

- [ ] **Step 1: Write failing `tests/unit/llm-text.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { llmsFullTxt, llmsTxt, mdEscape, projectLine, projectMarkdown, aboutMarkdown } from "../../src/lib/llm-text";
import { loadProjects } from "../../src/lib/load-projects";
import { makeProject } from "./fixtures";

const SITE = "https://pipeline.monroeresidential.com";
const FORM = "https://formspree.io/f/maenaqbd";
const projects = loadProjects();

describe("mdEscape", () => {
  it("escapes Markdown-significant characters", () => {
    expect(mdEscape("a|b [c] *d* _e_ `f` <g> \\h")).toBe("a\\|b \\[c\\] \\*d\\* \\_e\\_ \\`f\\` \\<g\\> \\\\h");
  });
});

describe("projectLine", () => {
  it("links the project's Markdown page and lists key facts", () => {
    expect(projectLine(makeProject(), SITE)).toBe(
      "- [111 W. Monroe St — Harris Bank building](https://pipeline.monroeresidential.com/projects/111-w-monroe.md): 345 units, $179M, Approved, LaSalle Reimagined",
    );
  });

  it("shows — for missing values and adds markers", () => {
    const line = projectLine(
      makeProject({ name: null, units: null, tpc_musd: null, confidence: "reported", monroe_url: "https://monroeresidential.com/portfolio", flag: "Listed for sale" }),
      SITE,
    );
    expect(line).toContain("— units, —,");
    expect(line).toContain("Monroe project, reported — not on DPD map, ⚠ Listed for sale");
    expect(line).not.toMatch(/null|undefined/);
  });

  it("cannot be broken by Markdown in the data", () => {
    const line = projectLine(makeProject({ name: "Evil] (x) | *bold*" }), SITE);
    expect(line).toContain("[111 W. Monroe St — Evil\\] (x) \\| \\*bold\\*](");
  });
});

describe("llmsTxt", () => {
  const txt = llmsTxt(projects, "2026-09-28", SITE, FORM);

  it("starts with the llms.txt title and summary", () => {
    expect(txt.startsWith("# Chicago Residential Pipeline\n\n> ")).toBe(true);
    expect(txt).toContain(`${projects.length} projects`);
    expect(txt).toContain("Data as of 2026-09-28");
  });

  it("lists every project once, sorted by units", () => {
    const lines = txt.split("\n").filter((l) => l.startsWith("- [") && l.includes("/projects/"));
    expect(lines).toHaveLength(projects.length);
    const units = lines.map((l) => Number((l.match(/\): ([\d,]+|—) units/)?.[1] ?? "0").replace(/,/g, "") || 0));
    expect(units).toEqual([...units].sort((a, b) => b - a));
  });

  it("links the data files and documents the suggestion endpoint", () => {
    for (const path of ["/llms-full.txt", "/data/projects.csv", "/data/projects.json", "/data/projects.geojson", "/about.md"]) {
      expect(txt).toContain(`${SITE}${path}`);
    }
    expect(txt).toContain(FORM);
    expect(txt).toContain("reviews every submission");
    expect(txt).not.toMatch(/null|undefined|localhost/);
  });
});

describe("llmsFullTxt", () => {
  it("has a section per project with every published field and no nulls", () => {
    const txt = llmsFullTxt(projects, "2026-09-28", SITE, FORM);
    for (const p of projects) expect(txt).toContain(`\n## ${p.name ?? p.address}\n`);
    expect(txt).toContain("- Units: ");
    expect(txt).toContain("- Coordinates: ");
    expect(txt).toContain("| Stage | Projects | Units |");
    expect(txt).not.toMatch(/null|undefined/);
  });
});

describe("projectMarkdown", () => {
  it("renders a standalone document", () => {
    const md = projectMarkdown(makeProject({ developer: null }), "2026-09-28", SITE);
    expect(md.startsWith("# Harris Bank building\n")).toBe(true);
    expect(md).toContain("- Developer: —");
    expect(md).toContain("- Units: 345");
    expect(md).toContain("- Project page: https://pipeline.monroeresidential.com/projects/111-w-monroe");
    expect(md).toContain("Data as of 2026-09-28");
  });
});

describe("aboutMarkdown", () => {
  it("contains the methodology and the suggestion endpoint", () => {
    const md = aboutMarkdown("2026-09-28", SITE, FORM);
    expect(md).toContain("# How we track the pipeline");
    expect(md).toContain("developer");
    expect(md).toContain(FORM);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test tests/unit/llm-text.test.ts`
Expected: FAIL — cannot find `src/lib/llm-text`.

- [ ] **Step 3: Create `src/lib/methodology.ts`**

```ts
export const METHODOLOGY = {
  intro:
    "This map covers office-to-residential conversions in downtown Chicago. It starts from the City of Chicago Department of Planning and Development (DPD) map published in June 2026, which lists 25 projects totaling 3,930+ units and $1.8B in project costs. We add projects that have been publicly reported but do not yet appear on the DPD map, and label them \"Reported — not on DPD map.\"",
  sources: [
    "City of Chicago DPD, Downtown Chicago Office-to-Residential Conversions (June 2026)",
    "City of Chicago LaSalle Street Reimagined proposals and Mayor's Office press releases",
    "Reporting from Crain's Chicago Business, Chicago Sun-Times, Urbanize Chicago, Chicago YIMBY, The Real Deal, Cooperator News, Block Club Chicago and Preservation Chicago",
    "Chicago building permit records (via Chicago Cityscape)",
  ],
  reconciliation:
    "Where the DPD map and another source report different figures, the DPD value is shown and the alternate figure is listed in the project's notes. Where DPD has no figure, we use the best available public source. The one exception is a figure confirmed directly by the project's developer, which we show instead (with the DPD figure in the notes).",
  stages: [
    { label: "Planning", description: "Acquired or proposed; entitlements or financing not yet in place." },
    { label: "Approved", description: "Zoning, Plan Commission and/or City Council approvals granted; no construction permit yet." },
    { label: "Permitted", description: "Renovation permit issued; construction not yet confirmed underway." },
    { label: "Under construction", description: "Work confirmed underway." },
    { label: "Completed", description: "Open to residents." },
  ],
  riskNote: "A ⚠ marks projects with a known risk, such as litigation or a pending sale.",
  disclaimer:
    "This map is compiled from public sources for informational purposes only. Figures are as reported and may change. It is not an offer, solicitation or investment advice.",
};
```

- [ ] **Step 4: Create `src/lib/llm-text.ts`**

```ts
import { sortProjects } from "./filters";
import { EMPTY, formatMoney, formatUnits } from "./format";
import { METHODOLOGY } from "./methodology";
import { PROGRAM_LABELS, STATUS_LABELS, STATUSES, type Project } from "./schema";
import { countByStatus, totals } from "./stats";

const TITLE = "Chicago Residential Pipeline";

export function mdEscape(s: string): string {
  return s.replace(/[\\`*_[\]|<>]/g, (c) => `\\${c}`);
}

export function projectLabel(p: Project): string {
  return p.name ? `${p.address} — ${p.name}` : p.address;
}

const e = (v: string | null) => (v === null ? EMPTY : mdEscape(v));

export function projectLine(p: Project, site: string): string {
  const facts = [
    `${formatUnits(p.units)} units`,
    formatMoney(p.tpc_musd),
    STATUS_LABELS[p.status],
    PROGRAM_LABELS[p.program],
    p.monroe_url ? "Monroe project" : null,
    p.confidence === "reported" ? "reported — not on DPD map" : null,
    p.flag ? `⚠ ${p.flag}` : null,
  ].filter((f): f is string => f !== null);
  return `- [${mdEscape(projectLabel(p))}](${site}/projects/${p.id}.md): ${facts.map(mdEscape).join(", ")}`;
}

export function projectFacts(p: Project, site: string): string[] {
  const lines = [
    `- Address: ${e(p.address)}, Chicago, IL`,
    `- Developer: ${e(p.developer)}`,
    `- Units: ${formatUnits(p.units)}`,
    `- Affordable units: ${formatUnits(p.affordable_units)}`,
    `- Total project cost: ${formatMoney(p.tpc_musd)}`,
    `- Program: ${PROGRAM_LABELS[p.program]}`,
    `- Public support: ${e(p.public_support)}`,
    `- Status: ${STATUS_LABELS[p.status]} — ${mdEscape(p.status_note)}`,
    ...(p.flag ? [`- Warning: ⚠ ${mdEscape(p.flag)}`] : []),
    `- Source: ${p.confidence === "dpd" ? `DPD map #${p.dpd_map_no}` : "Reported — not on DPD map"}`,
    ...(p.monroe_url ? [`- Monroe Residential project: ${p.monroe_url}`] : []),
    `- Coordinates: ${p.lat}, ${p.lng}`,
    `- Project page: ${site}/projects/${p.id}`,
  ];
  if (p.notes) lines.push("", `Notes: ${mdEscape(p.notes)}`);
  lines.push("", "Sources:", ...p.sources.map((s) => `- ${s}`));
  return lines;
}

export function projectMarkdown(p: Project, asOf: string, site: string): string {
  return [`# ${mdEscape(p.name ?? p.address)}`, "", ...projectFacts(p, site), "", `Data as of ${asOf}. Part of the ${TITLE}: ${site}/llms.txt`, ""].join("\n");
}

export function suggestSection(endpoint: string): string {
  return [
    "## Suggest a correction or new project",
    "",
    "Monroe Residential reviews every submission before anything is published. People can use the form at the bottom of the About page; agents can POST JSON:",
    "",
    "```",
    `POST ${endpoint}`,
    "Accept: application/json",
    "Content-Type: application/json",
    "",
    '{ "name": "...", "email": "...", "company": "...", "project": "<project id or \'new\'>", "message": "what should change and why, with a source URL" }',
    "```",
    "",
    "A machine-writable API is planned.",
  ].join("\n");
}

function header(projects: readonly Project[], asOf: string): string[] {
  const t = totals(projects);
  return [
    `# ${TITLE}`,
    "",
    `> Map of downtown Chicago office-to-residential conversions, maintained by Monroe Residential Partners. ${t.count} projects · ${formatUnits(t.units)} units · ${formatMoney(t.tpcMusd)} total project cost. Data as of ${asOf}.`,
    "",
    `Statuses: ${STATUSES.map((s) => STATUS_LABELS[s].toLowerCase()).join(", ")}. Figures follow the June 2026 City of Chicago DPD map unless the developer confirmed otherwise.`,
  ];
}

export function llmsTxt(projects: readonly Project[], asOf: string, site: string, endpoint: string): string {
  return [
    ...header(projects, asOf),
    "",
    "## Projects",
    "",
    ...sortProjects(projects, "units").map((p) => projectLine(p, site)),
    "",
    "## Data",
    "",
    `- [All projects, full detail](${site}/llms-full.txt)`,
    `- [CSV](${site}/data/projects.csv)`,
    `- [JSON](${site}/data/projects.json)`,
    `- [GeoJSON](${site}/data/projects.geojson)`,
    `- [Methodology](${site}/about.md)`,
    `- [Interactive map](${site}/)`,
    "",
    suggestSection(endpoint),
    "",
  ].join("\n");
}

export function llmsFullTxt(projects: readonly Project[], asOf: string, site: string, endpoint: string): string {
  const counts = countByStatus(projects);
  const stageRows = STATUSES.map((s) => {
    const inStage = projects.filter((p) => p.status === s);
    return `| ${STATUS_LABELS[s]} | ${counts[s]} | ${formatUnits(totals(inStage).units)} |`;
  });
  const sections = sortProjects(projects, "units").flatMap((p) => ["", `## ${mdEscape(p.name ?? p.address)}`, "", ...projectFacts(p, site)]);
  return [
    ...header(projects, asOf),
    "",
    "| Stage | Projects | Units |",
    "| --- | --- | --- |",
    ...stageRows,
    ...sections,
    "",
    "## Methodology",
    "",
    METHODOLOGY.reconciliation,
    "",
    suggestSection(endpoint),
    "",
  ].join("\n");
}

export function aboutMarkdown(asOf: string, site: string, endpoint: string): string {
  return [
    "# How we track the pipeline",
    "",
    METHODOLOGY.intro,
    "",
    "## Sources",
    "",
    ...METHODOLOGY.sources.map((s) => `- ${s}`),
    "",
    "## When sources disagree",
    "",
    METHODOLOGY.reconciliation,
    "",
    "## Status stages",
    "",
    ...METHODOLOGY.stages.map((s) => `- ${s.label}: ${s.description}`),
    "",
    METHODOLOGY.riskNote,
    "",
    "## Updates",
    "",
    `Data as of ${asOf}. Full data: ${site}/llms-full.txt`,
    "",
    "## Disclaimer",
    "",
    METHODOLOGY.disclaimer,
    "",
    suggestSection(endpoint),
    "",
  ].join("\n");
}
```

- [ ] **Step 5: Run unit tests**

Run: `pnpm test tests/unit/llm-text.test.ts`
Expected: PASS.

- [ ] **Step 6: Render `about.astro` methodology from `METHODOLOGY`**

In `src/pages/about.astro` add `import { METHODOLOGY } from "../lib/methodology";` and replace the intro paragraph, the Sources `<ul>`, the "When sources disagree" paragraph, the stages `<dl>`, the ⚠ note and the disclaimer text with values from `METHODOLOGY`:

```astro
<p>{METHODOLOGY.intro}</p>
<h2>Sources</h2>
<ul>{METHODOLOGY.sources.map((s) => <li>{s}</li>)}</ul>
<h2>When sources disagree</h2>
<p>{METHODOLOGY.reconciliation}</p>
<h2>Status stages</h2>
<dl class="stages">{METHODOLOGY.stages.map((s) => (<><dt>{s.label}</dt><dd>{s.description}</dd></>))}</dl>
<p>{METHODOLOGY.riskNote}</p>
```
and in the Disclaimer section: `<p>{METHODOLOGY.disclaimer}</p>` (the phone-number sentence is replaced by the suggestion form in Task 5).

- [ ] **Step 7: Run the existing about e2e test and commit**

Run: `pnpm test && pnpm test:e2e tests/e2e/projects.spec.ts -g about`
Expected: PASS ("DPD value is shown" still present).

```bash
git add src/lib/methodology.ts src/lib/llm-text.ts src/pages/about.astro tests/unit/llm-text.test.ts
git commit -m "feat: Markdown/text generators for LLM-readable formats"
```

---

### Task 3: LLM text endpoints

**Files:**
- Create: `src/pages/llms.txt.ts`, `src/pages/llms-full.txt.ts`, `src/pages/about.md.ts`, `src/pages/projects/[id].md.ts`
- Test: `tests/e2e/llm.spec.ts` (append)

**Interfaces:**
- Consumes: Task 2 generators, `SITE_URL`, `FORMSPREE_ENDPOINT`, `loadProjects`, `DATA_AS_OF`.
- Produces: static files `/llms.txt`, `/llms-full.txt`, `/about.md`, `/projects/<id>.md`.

- [ ] **Step 1: Append failing e2e tests to `tests/e2e/llm.spec.ts`**

```ts
test("llms.txt lists every project and every link resolves", async ({ request }) => {
  const res = await request.get("/llms.txt");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/plain");
  const txt = await res.text();
  const geo = await (await request.get("/data/projects.geojson")).json();
  const projectLines = txt.split("\n").filter((l) => l.startsWith("- [") && l.includes("/projects/"));
  expect(projectLines).toHaveLength(geo.features.length);
  const links = [...txt.matchAll(/\]\((https:\/\/pipeline\.monroeresidential\.com[^)]*)\)/g)].map((m) => m[1]!);
  expect(links.length).toBeGreaterThan(geo.features.length);
  for (const link of links) {
    const path = new URL(link).pathname;
    expect((await request.get(path)).status(), path).toBe(200);
  }
});

test("llms-full.txt and about.md are served as text", async ({ request }) => {
  const full = await request.get("/llms-full.txt");
  expect(full.status()).toBe(200);
  expect(await full.text()).not.toMatch(/\bnull\b|undefined/);
  const about = await request.get("/about.md");
  expect(about.status()).toBe(200);
  expect(await about.text()).toContain("# How we track the pipeline");
});

test("each project's Markdown matches its HTML page", async ({ page, request }) => {
  const geo = await (await request.get("/data/projects.geojson")).json();
  for (const f of geo.features) {
    const md = await request.get(`/projects/${f.id}.md`);
    expect(md.status(), f.id).toBe(200);
    expect(md.headers()["content-type"]).toMatch(/text\/(markdown|plain)/);
    const text = await md.text();
    await page.goto(`/projects/${f.id}`);
    const h1 = (await page.locator("h1").textContent())!.trim();
    expect(text.split("\n")[0]).toBe(`# ${h1.replace(/([\\`*_[\]|<>])/g, "\\$1")}`);
    const unitsHtml = (await page.locator(".facts div", { has: page.locator("dt", { hasText: /^Units$/ }) }).locator("dd").textContent())!.trim();
    expect(text).toContain(`- Units: ${unitsHtml}`);
    expect(text).not.toMatch(/\bnull\b|undefined/);
  }
});
```

Run: `pnpm test:e2e tests/e2e/llm.spec.ts`
Expected: FAIL — 404 for `/llms.txt`.

- [ ] **Step 2: Create the endpoints**

`src/pages/llms.txt.ts`:
```ts
import type { APIRoute } from "astro";
import { DATA_AS_OF } from "../lib/data-meta";
import { llmsTxt } from "../lib/llm-text";
import { loadProjects } from "../lib/load-projects";
import { FORMSPREE_ENDPOINT, SITE_URL } from "../lib/site-config";

export const GET: APIRoute = () =>
  new Response(llmsTxt(loadProjects(), DATA_AS_OF, SITE_URL, FORMSPREE_ENDPOINT), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
```

`src/pages/llms-full.txt.ts`:
```ts
import type { APIRoute } from "astro";
import { DATA_AS_OF } from "../lib/data-meta";
import { llmsFullTxt } from "../lib/llm-text";
import { loadProjects } from "../lib/load-projects";
import { FORMSPREE_ENDPOINT, SITE_URL } from "../lib/site-config";

export const GET: APIRoute = () =>
  new Response(llmsFullTxt(loadProjects(), DATA_AS_OF, SITE_URL, FORMSPREE_ENDPOINT), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
```

`src/pages/about.md.ts`:
```ts
import type { APIRoute } from "astro";
import { DATA_AS_OF } from "../lib/data-meta";
import { aboutMarkdown } from "../lib/llm-text";
import { FORMSPREE_ENDPOINT, SITE_URL } from "../lib/site-config";

export const GET: APIRoute = () =>
  new Response(aboutMarkdown(DATA_AS_OF, SITE_URL, FORMSPREE_ENDPOINT), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
```

`src/pages/projects/[id].md.ts`:
```ts
import type { APIRoute, GetStaticPaths } from "astro";
import { DATA_AS_OF } from "../../lib/data-meta";
import { projectMarkdown } from "../../lib/llm-text";
import { loadProjects } from "../../lib/load-projects";
import type { Project } from "../../lib/schema";
import { SITE_URL } from "../../lib/site-config";

export const getStaticPaths = (() =>
  loadProjects().map((project) => ({ params: { id: project.id }, props: { project } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) =>
  new Response(projectMarkdown((props as { project: Project }).project, DATA_AS_OF, SITE_URL), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
```

- [ ] **Step 3: Run e2e and check**

Run: `pnpm test:e2e tests/e2e/llm.spec.ts && pnpm check`
Expected: PASS; 0 errors. If `.md` content type from `astro preview` is neither `text/markdown` nor `text/plain`, record what it is; Cloudflare serves `.md` as `text/markdown` (verified after deploy in Task 6).

- [ ] **Step 4: Commit**

```bash
git add src/pages/llms.txt.ts src/pages/llms-full.txt.ts src/pages/about.md.ts "src/pages/projects/[id].md.ts" tests/e2e/llm.spec.ts
git commit -m "feat: /llms.txt, /llms-full.txt and Markdown twins of pages"
```

---

### Task 4: Discovery links and structured data

**Files:**
- Modify: `src/layouts/Base.astro`, `src/pages/index.astro`, `src/pages/about.astro`, `src/pages/projects/[id].astro`
- Test: `tests/e2e/llm.spec.ts` (append)

**Interfaces:**
- Consumes: `SITE_URL`.
- Produces: `Base.astro` prop `markdownPath?: string` (site-relative) → `<link rel="alternate" type="text/markdown">`; site-wide `<link rel="help" type="text/plain" href="/llms.txt" title="LLM-readable summary">`.

- [ ] **Step 1: Append failing e2e tests**

```ts
test("pages advertise their Markdown twin and llms.txt", async ({ page }) => {
  for (const [path, md] of [["/", "/llms.txt"], ["/about", "/about.md"], ["/projects/111-w-monroe", "/projects/111-w-monroe.md"]] as const) {
    await page.goto(path);
    await expect(page.locator('link[rel="alternate"][type="text/markdown"]')).toHaveAttribute("href", md);
    await expect(page.locator('link[rel="help"]')).toHaveAttribute("href", "/llms.txt");
  }
});

test("About page has a section for AI agents and developers", async ({ page }) => {
  await page.goto("/about");
  const section = page.locator("#for-agents");
  await expect(section.getByRole("heading")).toHaveText("For AI agents and developers");
  await expect(section.getByRole("link", { name: "/llms.txt" })).toHaveAttribute("href", "/llms.txt");
});

test("home Dataset JSON-LD lists CSV and JSON downloads", async ({ page }) => {
  await page.goto("/");
  const data = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
  const formats = data.distribution.map((d: { encodingFormat: string }) => d.encodingFormat);
  expect(formats).toEqual(["application/geo+json", "text/csv", "application/json"]);
});
```

Run: `pnpm test:e2e tests/e2e/llm.spec.ts -g "advertise|AI agents|Dataset"`
Expected: FAIL.

- [ ] **Step 2: `Base.astro`**

Add `markdownPath?: string;` to `Props`, destructure it, and add after the canonical link:
```astro
    {markdownPath && <link rel="alternate" type="text/markdown" href={markdownPath} />}
    <link rel="help" type="text/plain" href="/llms.txt" title="LLM-readable summary" />
```

- [ ] **Step 3: Pass `markdownPath`**

- `src/pages/index.astro`: `<Base ... markdownPath="/llms.txt" ...>`; in `jsonLd.distribution` append
  `{ "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: new URL("/data/projects.csv", Astro.site).href }` and
  `{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: new URL("/data/projects.json", Astro.site).href }`.
- `src/pages/about.astro`: `<Base ... markdownPath="/about.md">`.
- `src/pages/projects/[id].astro`: `<Base ... markdownPath={`/projects/${p.id}.md`}>`.

- [ ] **Step 4: About "For AI agents and developers" section**

In `src/pages/about.astro`, before the Disclaimer heading:
```astro
    <section id="for-agents">
      <h2>For AI agents and developers</h2>
      <p>The same data is available in machine-readable formats, rebuilt whenever the map changes:</p>
      <ul>
        <li><a href="/llms.txt">/llms.txt</a>: summary and every project in one list</li>
        <li><a href="/llms-full.txt">/llms-full.txt</a>: every field for every project</li>
        <li><a href="/data/projects.csv">CSV</a>, <a href="/data/projects.json">JSON</a> and <a href="/data/projects.geojson">GeoJSON</a> downloads</li>
        <li>Each project page has a Markdown version at the same address plus <code>.md</code></li>
      </ul>
      <p>Agents can submit suggestions to the same endpoint as the form below; see <a href="/llms.txt">/llms.txt</a> for the JSON format.</p>
    </section>
```

- [ ] **Step 5: Run and commit**

Run: `pnpm test:e2e && pnpm check`
Expected: all PASS; 0 errors.

```bash
git add src tests
git commit -m "feat: advertise Markdown twins, llms.txt and downloads to crawlers and agents"
```

---

### Task 5: Formspree suggestion form

**Files:**
- Create: `src/components/SuggestForm.astro`, `src/scripts/suggest-form.ts`
- Modify: `src/pages/about.astro`, `src/components/Footer.astro`, `src/pages/index.astro`, `src/pages/projects/[id].astro`, `src/styles/global.css`
- Test: `tests/e2e/suggest.spec.ts`

**Interfaces:**
- Consumes: `FORMSPREE_ENDPOINT`, `loadProjects`, `displayName`.
- Produces: `SuggestForm.astro` props `{ projects: Project[] }`, form `#suggest-form` inside `<section id="suggest">` on `/about`; `bindSuggestForm(): void`.

- [ ] **Step 1: Write failing `tests/e2e/suggest.spec.ts`**

```ts
import { expect, test, type Page } from "@playwright/test";

const FORMSPREE = "https://formspree.io/f/maenaqbd";

async function fill(page: Page) {
  const form = page.locator("#suggest-form");
  await form.getByLabel("Name").fill("Pat Broker");
  await form.getByLabel("Email").fill("pat@example.com");
  await form.getByLabel("Message").fill("Permit issued last week: https://example.com/permit");
  return form;
}

test("form lists New project plus every project, with a hidden honeypot", async ({ page, request }) => {
  const geo = await (await request.get("/data/projects.geojson")).json();
  await page.goto("/about");
  const options = page.locator('#suggest-form select[name="project"] option');
  await expect(options).toHaveCount(geo.features.length + 1);
  await expect(options.first()).toHaveAttribute("value", "new");
  // Playwright treats a 1px clipped element as "visible", so assert the honeypot's hiding attributes instead.
  const honeypot = page.locator('#suggest-form input[name="_gotcha"]');
  await expect(honeypot).toHaveAttribute("tabindex", "-1");
  await expect(honeypot).toHaveAttribute("aria-hidden", "true");
  await expect(honeypot).toHaveClass(/visually-hidden/);
  await expect(page.locator("#suggest-form")).toHaveAttribute("action", FORMSPREE);
});

test("?project= preselects a project; unknown values fall back to New project", async ({ page }) => {
  await page.goto("/about?project=111-w-monroe#suggest");
  await expect(page.locator('#suggest-form select[name="project"]')).toHaveValue("111-w-monroe");
  await page.goto("/about?project=bogus#suggest");
  await expect(page.locator('#suggest-form select[name="project"]')).toHaveValue("new");
});

test("successful submission posts to Formspree and thanks the user", async ({ page }) => {
  let posted = "";
  await page.route(`${FORMSPREE}`, async (route) => {
    posted = route.request().postData() ?? "";
    expect(route.request().headers()["accept"]).toContain("application/json");
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });
  await page.goto("/about?project=401-w-ontario#suggest");
  const form = await fill(page);
  await form.getByRole("button", { name: "Send suggestion" }).click();
  await expect(form.locator(".form-status")).toHaveText(/we review every suggestion/);
  expect(posted).toContain("401-w-ontario");
  expect(posted).toContain("Chicago Pipeline suggestion: Birken Lofts");
  await expect(form.getByLabel("Name")).toHaveValue("");
});

test("failed submission shows an error and keeps what was typed", async ({ page }) => {
  await page.route(`${FORMSPREE}`, (route) => route.fulfill({ status: 422, contentType: "application/json", body: '{"errors":[]}' }));
  await page.goto("/about#suggest");
  const form = await fill(page);
  await form.getByRole("button", { name: "Send suggestion" }).click();
  await expect(form.locator(".form-status")).toHaveText(/didn.t send/);
  await expect(form.getByLabel("Name")).toHaveValue("Pat Broker");
  await expect(form.getByRole("button", { name: "Send suggestion" })).toBeEnabled();
});

test("footer, map sidebar and project pages link to the form", async ({ page }) => {
  await page.goto("/projects/111-w-monroe");
  await expect(page.getByRole("link", { name: "Suggest a correction to this project" })).toHaveAttribute("href", "/about?project=111-w-monroe#suggest");
  await expect(page.locator("footer").getByRole("link", { name: "Suggest a correction" })).toHaveAttribute("href", "/about#suggest");
  await page.goto("/");
  await expect(page.locator("#sidebar").getByRole("link", { name: "Suggest a correction" })).toHaveAttribute("href", "/about#suggest");
});
```

Run: `pnpm test:e2e tests/e2e/suggest.spec.ts`
Expected: FAIL — `#suggest-form` not found.

- [ ] **Step 2: Create `src/components/SuggestForm.astro`**

```astro
---
import { displayName } from "../lib/format";
import type { Project } from "../lib/schema";
import { FORMSPREE_ENDPOINT } from "../lib/site-config";

interface Props {
  projects: Project[];
}
const options = [...Astro.props.projects].sort((a, b) => displayName(a).localeCompare(displayName(b)));
---
<form id="suggest-form" class="suggest-form" action={FORMSPREE_ENDPOINT} method="POST">
  <input type="text" name="_gotcha" class="visually-hidden" tabindex="-1" autocomplete="off" aria-hidden="true" />
  <input type="hidden" name="_subject" value="Chicago Pipeline suggestion" />
  <div class="field-row">
    <label>Name <span aria-hidden="true">*</span><input name="name" required autocomplete="name" /></label>
    <label>Email <span aria-hidden="true">*</span><input type="email" name="email" required autocomplete="email" /></label>
  </div>
  <div class="field-row">
    <label>Company<input name="company" autocomplete="organization" /></label>
    <label>Project
      <select name="project">
        <option value="new">New project</option>
        {options.map((p) => <option value={p.id}>{displayName(p)}</option>)}
      </select>
    </label>
  </div>
  <label>Message <span aria-hidden="true">*</span><textarea name="message" rows="6" required placeholder="What should change, and a source (link) if you have one."></textarea></label>
  <button type="submit" class="button">Send suggestion</button>
  <p class="form-status" role="status" aria-live="polite" hidden></p>
</form>

<script>
  import { bindSuggestForm } from "../scripts/suggest-form";
  bindSuggestForm();
</script>
```

- [ ] **Step 3: Create `src/scripts/suggest-form.ts`**

```ts
export function bindSuggestForm(): void {
  const form = document.getElementById("suggest-form") as HTMLFormElement | null;
  if (!form) return;
  const select = form.elements.namedItem("project") as HTMLSelectElement;
  const subject = form.elements.namedItem("_subject") as HTMLInputElement;
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const status = form.querySelector<HTMLElement>(".form-status")!;

  const preselect = new URLSearchParams(window.location.search).get("project");
  if (preselect && [...select.options].some((o) => o.value === preselect)) select.value = preselect;

  const show = (message: string, state: "pending" | "success" | "error") => {
    status.hidden = false;
    status.textContent = message;
    status.dataset.state = state;
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    subject.value = `Chicago Pipeline suggestion: ${select.selectedOptions[0]?.text ?? "New project"}`;
    button.disabled = true;
    show("Sending…", "pending");
    try {
      const res = await fetch(form.action, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`Formspree responded ${res.status}`);
      form.reset();
      show("Thanks — we review every suggestion before anything is published.", "success");
    } catch {
      show("Sorry, that didn't send. Please try again, or call (312) 296-4855.", "error");
    } finally {
      button.disabled = false;
    }
  });
}
```

- [ ] **Step 4: Styles in `src/styles/global.css`**

```css
.visually-hidden { position: absolute !important; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.suggest-form { display: grid; gap: 16px; padding: 24px; background: var(--surface); border: 1px solid var(--line); }
.suggest-form label { display: grid; gap: 6px; font-size: 14px; font-weight: 500; color: var(--navy); }
.suggest-form input, .suggest-form select, .suggest-form textarea { font: inherit; font-weight: 400; color: var(--ink); background: var(--bg); border: 1px solid var(--line); padding: 10px 12px; width: 100%; }
.suggest-form textarea { resize: vertical; min-height: 140px; }
.suggest-form .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.suggest-form button { justify-self: start; cursor: pointer; }
.suggest-form button:disabled { opacity: 0.6; cursor: not-allowed; }
.form-status { margin: 0; font-size: 14px; }
.form-status[data-state="success"] { color: var(--blue-dark); }
.form-status[data-state="error"] { color: var(--warn); }
@media (max-width: 600px) { .suggest-form .field-row { grid-template-columns: 1fr; } }
```

- [ ] **Step 5: Place the form and links**

- `src/pages/about.astro`: import `SuggestForm` and `loadProjects`; after the "For AI agents and developers" section add
  ```astro
  <section id="suggest">
    <h2>Suggest a project or correction</h2>
    <p>Know about a conversion we're missing, or a figure that has changed? Tell us. We review every suggestion before anything is published.</p>
    <SuggestForm projects={loadProjects()} />
  </section>
  ```
- `src/components/Footer.astro`: in `.footer-meta` first span, after the methodology link: ` · <a href="/about#suggest">Suggest a correction</a>`.
- `src/pages/index.astro`: in the sidebar `.as-of` paragraph append ` · <a href="/about#suggest">Suggest a correction</a>`.
- `src/pages/projects/[id].astro`: after the `.as-of` paragraph add
  `<p><a href={`/about?project=${p.id}#suggest`}>Suggest a correction to this project</a></p>`.

- [ ] **Step 6: Run all tests and commit**

Run: `pnpm test && pnpm test:e2e && pnpm check`
Expected: all PASS; 0 errors.

```bash
git add src tests
git commit -m "feat: Formspree suggestion form for people and agents"
```

---

### Task 6: Docs, PR, deploy verification

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: Document**

README — add under "Updating project data": "`/llms.txt`, `/llms-full.txt`, `/about.md`, `/projects/<id>.md`, `/data/projects.csv` and `/data/projects.json` are generated from `data/projects.csv` at build time. Suggestions arrive in the Formspree form (`src/lib/site-config.ts`)."

CLAUDE.md — in Architecture, after the data-flow list add a bullet: "`src/lib/llm-text.ts` + `src/lib/export.ts` generate the LLM/agent formats (`/llms.txt`, `/llms-full.txt`, `/about.md`, `/projects/<id>.md`, CSV/JSON) via static endpoints; methodology copy lives in `src/lib/methodology.ts` and feeds both `about.astro` and `about.md`. Suggestions go to Formspree (`FORMSPREE_ENDPOINT` in `src/lib/site-config.ts`); nothing is auto-published."

- [ ] **Step 2: Commit, push, open PR, wait for CI and preview**

```bash
git add README.md CLAUDE.md
git commit -m "docs: LLM formats and suggestion form"
git push
gh pr create --base main --head llm-friendly --title "LLM-friendly data formats + Formspree suggestion form" --body "<summary>"
gh pr checks --watch
```
Expected: CI green. Cloudflare builds a preview for the branch (URL on the Worker's Deployments page).

- [ ] **Step 3: After the human partner merges, verify production**

```bash
for p in /llms.txt /llms-full.txt /about.md /projects/111-w-monroe.md /data/projects.csv /data/projects.json; do
  curl -s -o /dev/null -w "$p %{http_code} %{content_type}\n" "https://pipeline.monroeresidential.com$p"
done
```
Expected: all 200; `.txt` → `text/plain`, `.md` → `text/markdown`, `.csv` → `text/csv`, `.json` → `application/json`.
Then submit one real test suggestion through the live form and confirm it appears in the Formspree dashboard.
