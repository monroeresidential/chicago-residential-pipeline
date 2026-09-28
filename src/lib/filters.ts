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

const FILTER_PARAMS = ["status", "program", "project"];

/** Rewrites only our filter params in `currentSearch`, keeping everything else (e.g. utm_* campaign tags). */
export function mergeFilterSearch(currentSearch: string, state: FilterState): string {
  const kept = new URLSearchParams(currentSearch);
  for (const key of FILTER_PARAMS) kept.delete(key);
  const ours = serializeFilterState(state).slice(1);
  const parts = [kept.toString(), ours].filter(Boolean);
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}
