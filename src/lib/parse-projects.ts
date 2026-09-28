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
