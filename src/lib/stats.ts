import { STATUSES, type Status } from "./constants";
import type { Project } from "./schema";

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
