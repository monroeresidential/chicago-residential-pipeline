# LLM-Friendly Data + Suggestion Form — Design

**Date:** 2026-09-28
**Status:** Draft for review
**Builds on:** `2026-09-28-chicago-pipeline-map-design.md` (Phase 1, live)

## 1. Purpose

Make the Chicago Residential Pipeline easy for AI models, AI agents and search engines to
read accurately, and give humans and agents one reviewed path to suggest corrections or new
projects, without adding email to anyone's inbox.

**Success criteria**

- An LLM given only `https://pipeline.monroeresidential.com/llms.txt` can list every project
  with its units, cost and status, and knows where the full detail and downloads are.
- Every format is generated from `data/projects.csv` at build time; adding a CSV row updates
  all of them with no extra step.
- A person or an agent can submit a suggestion (browser form or JSON `POST`) that lands in a
  Formspree form reviewed by Monroe. Nothing submitted is published automatically.

## 2. Scope

**In:** static LLM-readable formats (§3), discovery links (§4), Formspree suggestion form (§5).

**Out (later phase):** remote MCP server; write API with Monroe API keys; D1 review queue;
approve-to-commit flow. The design keeps room for them: `llms.txt` states a machine-writable
API is planned, and the suggestion fields in §5 are the fields a future
`suggest_change` tool will take.

## 3. Read formats (static, built from `loadProjects()`)

All figures come from the same parsed projects the map uses. Missing values render as "—".
Markdown-significant characters in data (backslash, backtick, `*`, `_`, `[`, `]`, `|`, `<`, `>`)
are escaped so no field can break list or table structure.

### 3.1 `/llms.txt` (llmstxt.org convention, `text/plain; charset=utf-8`)

1. `# Chicago Residential Pipeline`
2. Blockquote summary: what it is, maintained by Monroe Residential Partners, totals
   (projects · units · total project cost), `Data as of <DATA_AS_OF>`.
3. One paragraph: status values and meanings in one line; reconciliation rule (DPD June 2026
   map unless the developer confirmed otherwise).
4. `## Projects`: one line per project, sorted by units descending:
   `- [<name or address>](<site>/projects/<id>.md): <units> units, <cost>, <status label>, <program label>[, Monroe project][, reported — not on DPD map][, ⚠ <flag>]`
5. `## Data`: links to `/llms-full.txt`, `/data/projects.csv`, `/data/projects.json`,
   `/data/projects.geojson`, `/about.md`.
6. `## Suggest a correction or new project`: Formspree endpoint, JSON fields (§5.3), one
   example `curl`, "Monroe Residential reviews every submission before anything is
   published," and "A machine-writable API is planned."

### 3.2 `/llms-full.txt` (`text/plain; charset=utf-8`)

Header as §3.1 items 1–3, then a totals-by-stage table, then one section per project
(`## <name or address>`) with every published field:
address, developer, units, affordable units, total project cost, program, public support,
status + status note, flag, source type (`DPD map #N` or `Reported — not on DPD map`),
Monroe project (with portfolio link), notes, sources (URLs), coordinates, project page URL.
Ends with the methodology text and the §3.1 item 6 section.

### 3.3 `/projects/<id>.md` (`text/markdown; charset=utf-8`)

The same facts as the project's HTML page (the §3.2 per-project section plus
`Data as of`), as a standalone document with an H1.

### 3.4 `/about.md`

Methodology page content as Markdown (sources, reconciliation rule incl. developer-confirmed
exception, status stage definitions, disclaimer).

### 3.5 Downloads

- `/data/projects.csv` — published columns, same header as `data/projects.csv`, re-serialized
  from parsed projects (sources joined with ` | `).
- `/data/projects.json` — `{ "as_of": "...", "projects": [Project, ...] }` (flat objects, the
  `Project` type from `src/lib/schema.ts`).
- `/data/projects.geojson` — unchanged.

## 4. Discovery

- Every HTML page `<head>`: `<link rel="alternate" type="text/markdown" href="...">` to its
  Markdown twin where one exists (home → `/llms.txt`, about → `/about.md`, project →
  `/projects/<id>.md`), plus `<link rel="help" type="text/plain" href="/llms.txt" title="LLM-readable summary">` site-wide.
- `robots.txt` stays fully open (all crawlers, incl. AI crawlers, allowed).
- About page gains a "For AI agents and developers" section listing §3 URLs and the §5 endpoint.
- Home Dataset JSON-LD gains `distribution` entries for CSV and JSON.

## 5. Suggestion form (Formspree)

### 5.1 Service

Formspree, as used on tetonflats.com. A **new, separate form** in Monroe's Formspree account
("Chicago Pipeline suggestions") so submissions are separate and email notifications can be
turned off for this form only. The endpoint URL is one constant in
`src/lib/site-config.ts` (`FORMSPREE_ENDPOINT`). No server code is added; the site stays static.

### 5.2 Browser form

- Location: About page section "Suggest a project or correction"; footer link "Suggest a
  correction" on every non-fullscreen page; sidebar link on the map page next to the
  methodology link.
- Fields: name (required), email (required), company, project (select: "New project" +
  every project by name/address; project pages link to the form with that project
  preselected via `?project=<id>`), message (required), `_gotcha` honeypot (hidden),
  `_subject` (hidden, `Chicago Pipeline suggestion: <project>`).
- Submission: small vanilla-TS script, `fetch` `POST` to `FORMSPREE_ENDPOINT` with
  `Accept: application/json`; inline success ("Thanks — we review every suggestion.") and
  error states; button disabled while sending. Without JavaScript the form still posts
  normally to Formspree (Formspree's hosted thank-you page).
- Styled with existing site tokens (square corners, Inter labels, blue button).

### 5.3 Agent submissions

Documented in `llms.txt`/`llms-full.txt`:

```
POST <FORMSPREE_ENDPOINT>
Accept: application/json
Content-Type: application/json

{ "name": "...", "email": "...", "company": "...",
  "project": "<project id or 'new'>", "message": "what should change and why, with a source URL" }
```

## 6. Quality

### 6.1 Unit tests
- Markdown/text generators: every project present once; totals match `totals()`;
  missing values render "—" (no `null`/`undefined`); escaping of Markdown-significant
  characters; project lines sorted by units.
- CSV serializer round-trips through `parseProjectsCsv` to equal projects.

### 6.2 E2E tests
- `/llms.txt`, `/llms-full.txt`, `/about.md`, every `/projects/<id>.md`, `/data/projects.csv`,
  `/data/projects.json` return 200 with the §3 content types.
- `llms.txt` has one line per project, and every link in it resolves (200).
- Each `/projects/<id>.md` H1 and units match the HTML page.
- CSV and JSON parse to the same number of projects as the GeoJSON.
- HTML `<head>` has the `alternate` and `llms.txt` links.
- Form: renders with all projects in the select; `?project=<id>` preselects; submit with
  Formspree mocked via `page.route` shows success, and a mocked 4xx/5xx shows the error
  state; no test contacts Formspree.

## 7. Needed from Monroe

- Create the Formspree form (done: `https://formspree.io/f/maenaqbd`), turn email notifications
  on/off as preferred. **Leave "Restrict to domain" off** for this form: it filters on the `Referer`
  header, which agent POSTs (and some privacy browsers) do not send, so restricted submissions
  silently go to Formspree's spam folder.
