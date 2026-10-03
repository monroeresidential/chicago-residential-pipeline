import { sql } from "kysely";
import type { Status } from "../../../shared/constants";
import { formatAddressDisplay } from "../../../shared/normalize/address";
import { formatPin } from "../../../shared/normalize/primitives";
import type { NormalizedRecord } from "../../../shared/records/types";
import { geogPoint, type Db } from "../db/client";
import { findAddress } from "../store/shared-values";
import { suggestStatusChange, type StatusChange } from "./status";

export type Strength = "strong" | "likely" | "possible";
export interface ProjectSuggestion { project_id: string; project_name: string | null; strength: Strength; reasons: string[]; status_change: StatusChange | null }

export const MATCH_RADIUS_M = 40;
const RANK: Record<Strength, number> = { strong: 0, likely: 1, possible: 2 };
type Signal = "identifier" | "parcel" | "address" | "distance" | "organization";

const ID_LABEL: Record<string, string> = {
  dpd_app_no: "DPD app #", record_number: "record #", matter_key: "matter", elms_matter_id: "eLMS id",
  permit_number: "permit #", zba_case_no: "ZBA case",
};

export async function suggestProjects(q: Db, record: NormalizedRecord): Promise<ProjectSuggestion[]> {
  const evidence = new Map<string, { signals: Set<Signal>; reasons: string[] }>();
  const add = (projectId: string, signal: Signal, reason: string) => {
    const e = evidence.get(projectId) ?? { signals: new Set<Signal>(), reasons: [] };
    e.signals.add(signal);
    if (!e.reasons.includes(reason)) e.reasons.push(reason);
    evidence.set(projectId, e);
  };

  // 1. shared official identifiers with any filing already linked to a project
  if (record.identifiers.length) {
    const rows = await q.selectFrom("identifiers as i")
      .innerJoin("filing_identifiers as fi", "fi.identifier_id", "i.id")
      .innerJoin("filings as f", "f.id", "fi.filing_id")
      .innerJoin("project_filings as pf", "pf.filing_id", "f.id")
      .innerJoin("projects as p", "p.id", "pf.project_id")
      .select(["pf.project_id", "i.type", "i.value", "f.kind", "f.source_key"])
      .where("f.deleted_at", "is", null).where("p.deleted_at", "is", null)
      .where((eb) => eb.or(record.identifiers.map((x) => eb.and([eb("i.type", "=", x.type), eb("i.value", "=", x.value)]))))
      .execute();
    for (const r of rows) add(r.project_id, "identifier", `${ID_LABEL[r.type] ?? r.type} ${r.value} also on ${r.kind.replace("_", " ")} ${r.source_key}`);
  }

  // 2. shared parcels
  if (record.parcels.length) {
    const rows = await q.selectFrom("filing_parcels as fp")
      .innerJoin("filings as f", "f.id", "fp.filing_id")
      .innerJoin("project_filings as pf", "pf.filing_id", "f.id")
      .innerJoin("projects as p", "p.id", "pf.project_id")
      .select(["pf.project_id", "fp.pin"])
      .where("fp.pin", "in", record.parcels).where("f.deleted_at", "is", null).where("p.deleted_at", "is", null)
      .execute();
    for (const r of rows) add(r.project_id, "parcel", `PIN ${formatPin(r.pin)}`);
  }

  // 3. overlapping address ranges on the same street (project address or a linked filing's address)
  for (const a of record.addresses) {
    const overlapping = q.selectFrom("addresses as a").select(["a.id", "a.number_from", "a.number_to", "a.predir", "a.street_name", "a.suffix", "a.zip"])
      .where("a.street_name", "=", a.street_name)
      .where(sql<boolean>`a.predir is not distinct from ${a.predir}`)
      .where(sql<boolean>`(a.suffix is null or ${a.suffix}::text is null or a.suffix = ${a.suffix})`)
      .where("a.number_from", "<=", a.number_to).where("a.number_to", ">=", a.number_from)
      .where("a.deleted_at", "is", null);
    const viaProject = await q.selectFrom("project_addresses as pa").innerJoin("projects as p", "p.id", "pa.project_id")
      .innerJoin(overlapping.as("o"), "o.id", "pa.address_id")
      .select(["p.id as project_id", "o.number_from", "o.number_to", "o.predir", "o.street_name", "o.suffix", "o.zip"])
      .where("p.deleted_at", "is", null).execute();
    const viaFilings = await q.selectFrom("filing_addresses as fa").innerJoin("filings as f", "f.id", "fa.filing_id")
      .innerJoin("project_filings as pf", "pf.filing_id", "f.id").innerJoin("projects as p", "p.id", "pf.project_id")
      .innerJoin(overlapping.as("o"), "o.id", "fa.address_id")
      .select(["p.id as project_id", "o.number_from", "o.number_to", "o.predir", "o.street_name", "o.suffix", "o.zip"])
      .where("f.deleted_at", "is", null).where("p.deleted_at", "is", null).execute();
    for (const r of [...viaProject, ...viaFilings]) {
      add(r.project_id, "address", `address ${formatAddressDisplay(a)} overlaps ${formatAddressDisplay({ ...r, predir: r.predir as "N" | "S" | "E" | "W" | null })}`);
    }
  }

  // 4. distance from the project pin or from a linked filing's address
  let point = record.point;
  if (!point && record.addresses[0]) {
    const found = await findAddress(q, record.addresses[0]);
    if (found) {
      const row = await q.selectFrom("addresses").select([sql<number | null>`ST_Y(point::geometry)`.as("lat"), sql<number | null>`ST_X(point::geometry)`.as("lon")])
        .where("id", "=", found.merged_into_id ?? found.id).executeTakeFirst();
      if (row?.lat != null && row.lon != null) point = { lat: row.lat, lon: row.lon };
    }
  }
  if (point) {
    const pt = geogPoint(point.lat, point.lon);
    const rows = await sql<{ project_id: string; d: number }>`
      select p.id as project_id, ST_Distance(p.point, ${pt}) as d from projects p
       where p.deleted_at is null and ST_DWithin(p.point, ${pt}, ${MATCH_RADIUS_M})
      union all
      select pf.project_id, ST_Distance(a.point, ${pt}) from project_filings pf
        join filings f on f.id = pf.filing_id and f.deleted_at is null
        join projects p on p.id = pf.project_id and p.deleted_at is null
        join addresses a on a.id = f.primary_address_id
       where a.point is not null and ST_DWithin(a.point, ${pt}, ${MATCH_RADIUS_M})`.execute(q);
    const nearest = new Map<string, number>();
    for (const r of rows.rows) nearest.set(r.project_id, Math.min(nearest.get(r.project_id) ?? Infinity, Number(r.d)));
    for (const [projectId, d] of nearest) add(projectId, "distance", `${Math.round(d)} m away`);
  }

  // 5. shared organizations (tie-breaker only)
  if (record.organizations.length) {
    const rows = await q.selectFrom("organizations as o")
      .innerJoin("filing_organizations as fo", "fo.organization_id", "o.id")
      .innerJoin("filings as f", "f.id", "fo.filing_id")
      .innerJoin("project_filings as pf", "pf.filing_id", "f.id")
      .innerJoin("projects as p", "p.id", "pf.project_id")
      .select(["pf.project_id", "o.display_name", "fo.role"])
      .where("o.name_key", "in", record.organizations.map((o) => o.name_key))
      .where("f.deleted_at", "is", null).where("p.deleted_at", "is", null).execute();
    for (const r of rows) add(r.project_id, "organization", `same ${r.role} ${r.display_name}`);
  }

  const out: ProjectSuggestion[] = [];
  for (const [projectId, e] of evidence) {
    const s = e.signals;
    const strength: Strength | null =
      s.has("identifier") || s.has("parcel") ? "strong"
      : s.has("address") || (s.has("distance") && s.has("organization")) ? "likely"
      : s.has("distance") ? "possible" : null;
    if (!strength) continue;
    const p = await q.selectFrom("projects").select(["name", "status"]).where("id", "=", projectId).executeTakeFirstOrThrow();
    out.push({ project_id: projectId, project_name: p.name, strength, reasons: e.reasons, status_change: suggestStatusChange(p.status as Status, record) });
  }
  return out.sort((a, b) => RANK[a.strength] - RANK[b.strength] || a.project_id.localeCompare(b.project_id));
}
