import { sql } from "kysely";
import type { Db } from "../db/client";
import { HttpError } from "../errors";
import { refreshFilingHash } from "./filings";

export const HISTORY_TABLES = [
  "projects", "filings", "project_filings", "project_addresses", "organizations", "addresses", "parcels", "identifiers",
  "filing_addresses", "filing_parcels", "filing_identifiers", "filing_organizations",
] as const;
export type HistoryTable = (typeof HISTORY_TABLES)[number];
export const REVERTIBLE = ["projects", "filings", "project_filings"] as const;
export type Revertible = (typeof REVERTIBLE)[number];

const PROJECT_COLUMNS = ["dpd_map_no", "name", "developer", "units", "units_source_filing_id", "affordable_units", "tpc_usd", "program",
  "public_support", "status", "status_note", "flag", "confidence", "built_by_3f_url", "point", "sources", "notes", "visibility", "deleted_at"];
// Revert covers a record's own scalar columns. Linked rows (addresses, parcels, identifiers, organizations,
// a project's primary address) have their own history and are not rewound, so primary_address_id is left alone
// to stay consistent with filing_addresses.
const FILING_COLUMNS = ["community_area", "ward", "units", "status", "event_date", "in_target", "flag", "notes",
  "source_url", "attributes", "field_sources", "last_source_hash", "deleted_at"];

export function listHistory(q: Db, table: HistoryTable, recordId: string) {
  return q.selectFrom("revisions").selectAll().where("table_name", "=", table).where("record_id", "=", recordId).orderBy("version").execute();
}

async function setFromJson(q: Db, table: "projects" | "filings", columns: string[], id: string, json: unknown) {
  const cols = sql.join(columns.map((c) => sql.ref(c)));
  const vals = sql.join(columns.map((c) => sql.ref(`r.${c}`)));
  const key = table === "filings" ? sql`${Number(id)}` : sql`${id}`;
  await sql`update ${sql.table(table)} set (${cols}) = (select ${vals} from jsonb_populate_record(null::${sql.table(table)}, ${JSON.stringify(json)}::jsonb) r)
            where id = ${key}`.execute(q);
}

/** Puts the record back to how it was right after `version`, as a new revision. */
export async function revertTo(q: Db, table: Revertible, recordId: string, version: number): Promise<void> {
  const rev = await q.selectFrom("revisions").select(["after"]).where("table_name", "=", table)
    .where("record_id", "=", recordId).where("version", "=", version).executeTakeFirst();
  if (!rev) throw new HttpError(404, `no version ${version} of ${table} ${recordId}`);
  const target = rev.after as Record<string, unknown> | null;
  if (table === "project_filings") {
    const [projectId, filingId] = recordId.split(":");
    if (!target) {
      await q.deleteFrom("project_filings").where("project_id", "=", projectId!).where("filing_id", "=", Number(filingId)).execute();
      return;
    }
    await q.insertInto("project_filings").values({
      project_id: projectId!, filing_id: Number(filingId), role: String(target.role), linked_by: String(target.linked_by), reason: String(target.reason),
    }).onConflict((oc) => oc.columns(["project_id", "filing_id"]).doUpdateSet({ role: String(target.role), reason: String(target.reason) })).execute();
    return;
  }
  if (!target) throw new HttpError(400, `${table} rows are never hard-deleted; pick a version with data`);
  if (table === "projects") await setFromJson(q, "projects", PROJECT_COLUMNS, recordId, target);
  else {
    await setFromJson(q, "filings", FILING_COLUMNS, recordId, target);
    await refreshFilingHash(q, Number(recordId));
  }
}
