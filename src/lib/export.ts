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
