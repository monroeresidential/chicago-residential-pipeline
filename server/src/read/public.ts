import { sql } from "kysely";
import type { Status } from "../../../shared/constants";
import { formatAddressDisplay } from "../../../shared/normalize/address";
import type { Kind } from "../../../shared/records/types";
import type { Project } from "../../../src/lib/schema";
import { countByStatus, totals } from "../../../src/lib/stats";
import type { Db } from "../db/client";
import { rowToAddress } from "../store/shared-values";
import { chicagoParts } from "../time";

export interface PublicFiling {
  kind: Kind; source_key: string; role: string; event_date: string | null; status: string | null;
  units: number | null; summary: string; source_url: string | null;
}
export type PublishedProject = Project & { filings?: PublicFiling[]; visibility?: "draft" | "published" };

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function summarizeFiling(f: { kind: string; source_key: string; status: string | null; units: number | null; attributes: Record<string, unknown> }): string {
  const a = f.attributes;
  const status = f.status ? `, ${f.status}` : "";
  switch (f.kind) {
    case "permit":
      return `${a.classification === "early_signal" ? "Demolition permit (early signal)" : "Building permit"}${f.units ? `, ${f.units} units` : ""}${status}`;
    case "zoning_matter":
      return a.zoning_from || a.zoning_to
        ? `Zoning ${a.zoning_from ?? "?"} → ${a.zoning_to ?? "?"}${status}`
        : `Zoning matter ${f.source_key}${status}`;
    case "hearing_item":
      return `Plan Commission hearing${a.request ? `: ${truncate(String(a.request), 120)}` : ""}`;
    default:
      return `Zoning Board of Appeals ${a.request_type ? String(a.request_type).toLowerCase() : "case"} ${f.source_key}${f.status ? `: ${f.status}` : ""}`;
  }
}

/** Projects and their filings, read from one snapshot so a visibility change between the two reads can't leak. */
export async function listProjects(q: Db, opts: { includeFilings?: boolean; includeDrafts?: boolean; ids?: string[] } = {}): Promise<PublishedProject[]> {
  if (q.isTransaction) return readProjects(q, opts);
  return q.transaction().setIsolationLevel("repeatable read").execute((t) => readProjects(t, opts));
}

/** Linked, live filings of the given projects — the query itself enforces live and (unless drafts) published projects. */
export async function publicFilings(q: Db, projectIds: string[], includeDrafts: boolean): Promise<(PublicFiling & { project_id: string })[]> {
  if (!projectIds.length) return [];
  const rows = await q.selectFrom("project_filings as pf").innerJoin("filings as f", "f.id", "pf.filing_id")
    .innerJoin("projects as p", "p.id", "pf.project_id")
    .select(["pf.project_id", "pf.role", "f.kind", "f.source_key", "f.event_date", "f.status", "f.units", "f.source_url", "f.attributes"])
    .where("f.deleted_at", "is", null).where("p.deleted_at", "is", null).where("pf.project_id", "in", projectIds)
    .$if(!includeDrafts, (b) => b.where("p.visibility", "=", "published"))
    .orderBy(sql`f.event_date desc nulls last`).orderBy("f.id", "desc").execute();
  return rows.map((f) => ({
    project_id: f.project_id, kind: f.kind as Kind, source_key: f.source_key, role: f.role, event_date: f.event_date, status: f.status,
    units: f.units, summary: summarizeFiling({ ...f, attributes: f.attributes as Record<string, unknown> }), source_url: f.source_url,
  }));
}

async function readProjects(q: Db, opts: { includeFilings?: boolean; includeDrafts?: boolean; ids?: string[] }): Promise<PublishedProject[]> {
  const rows = await q.selectFrom("projects as p")
    .leftJoin("project_addresses as pa", (j) => j.onRef("pa.project_id", "=", "p.id").on("pa.is_primary", "=", true))
    .leftJoin("addresses as a", "a.id", "pa.address_id")
    .select([
      "p.id", "p.dpd_map_no", "p.name", "p.developer", "p.units", "p.affordable_units", "p.tpc_usd", "p.program", "p.public_support",
      "p.status", "p.status_note", "p.flag", "p.confidence", "p.built_by_3f_url", "p.sources", "p.notes", "p.visibility",
      sql<number>`ST_Y(p.point::geometry)`.as("lat"), sql<number>`ST_X(p.point::geometry)`.as("lng"),
      "a.number_from", "a.number_to", "a.predir", "a.street_name", "a.suffix", "a.zip",
    ])
    .where("p.deleted_at", "is", null)
    .$if(!opts.includeDrafts, (b) => b.where("p.visibility", "=", "published"))
    .$if(Boolean(opts.ids), (b) => b.where("p.id", "in", opts.ids!.length ? opts.ids! : ["-"]))
    .orderBy(sql`p.dpd_map_no nulls last`).orderBy("p.id")
    .execute();

  const projects: PublishedProject[] = rows.map((r) => ({
    id: r.id, dpd_map_no: r.dpd_map_no, name: r.name,
    address: r.street_name ? formatAddressDisplay(rowToAddress({ number_from: r.number_from!, number_to: r.number_to!, predir: r.predir, street_name: r.street_name, suffix: r.suffix, zip: r.zip })) : "",
    developer: r.developer, units: r.units, affordable_units: r.affordable_units,
    tpc_musd: r.tpc_usd == null ? null : r.tpc_usd / 1_000_000,
    program: r.program as Project["program"], public_support: r.public_support, status: r.status as Status, status_note: r.status_note,
    flag: r.flag, confidence: r.confidence as Project["confidence"], built_by_3f_url: r.built_by_3f_url,
    lat: r.lat, lng: r.lng, sources: r.sources, notes: r.notes,
    ...(opts.includeDrafts ? { visibility: r.visibility as "draft" | "published" } : {}),
  }));

  if (opts.includeFilings && projects.length) {
    const filings = await publicFilings(q, projects.map((p) => p.id), Boolean(opts.includeDrafts));
    for (const p of projects) p.filings = filings.filter((f) => f.project_id === p.id).map(({ project_id: _p, ...f }) => f);
  }
  return projects;
}

export async function getAsOf(q: Db): Promise<string> {
  const s = await q.selectFrom("site_state").select("last_published_at").executeTakeFirst();
  return s?.last_published_at ? chicagoParts(s.last_published_at).date : "1970-01-01";
}

export function projectStats(projects: Project[]) {
  return { ...totals(projects), by_status: countByStatus(projects) };
}
