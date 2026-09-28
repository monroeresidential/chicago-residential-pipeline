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
    `- ID: ${p.id}`,
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

export function suggestSection(endpoint: string, site: string): string {
  return [
    "## Suggest a correction or new project",
    "",
    `Monroe Residential reviews every submission before anything is published. People can use the form at ${site}/about#suggest; agents can POST JSON to the same Formspree endpoint. For "project", use the project's ID (the slug in the project's URL, e.g. 111-w-monroe) or "new".`,
    "",
    "```",
    `curl -X POST ${endpoint} -H 'Accept: application/json' -H 'Content-Type: application/json' \\`,
    `  -d '{"name": "...", "email": "...", "company": "...", "project": "111-w-monroe", "message": "what should change and why, with a source URL"}'`,
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
    `Statuses: ${METHODOLOGY.stages.map((st) => `${st.label.toLowerCase()} (${st.description.charAt(0).toLowerCase()}${st.description.slice(1).replace(/\.$/, "")})`).join("; ")}. Figures follow the June 2026 City of Chicago DPD map unless the developer confirmed otherwise.`,
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
    suggestSection(endpoint, site),
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
    suggestSection(endpoint, site),
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
    suggestSection(endpoint, site),
    "",
  ].join("\n");
}
