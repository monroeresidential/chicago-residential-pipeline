import { sql } from "kysely";
import { z } from "zod";
import { formatAddressDisplay, normalizeAddress } from "../../../shared/normalize/address";
import { orgNameKey } from "../../../shared/normalize/primitives";
import { KINDS } from "../../../shared/records/types";
import type { Db } from "../db/client";
import { HttpError } from "../errors";
import { loadFilingRecord } from "./filings";
import { rowToAddress } from "./shared-values";

export const FilingSearchSchema = z.strictObject({
  q: z.string().optional(),
  kind: z.enum(KINDS).optional(),
  in_target: z.boolean().optional(),
  linked: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export type FilingSearch = z.input<typeof FilingSearchSchema>;
export interface FilingSummary {
  id: number; kind: string; source_key: string; address: string | null; status: string | null;
  event_date: string | null; in_target: boolean; linked_projects: string[]; deleted: boolean;
}

export async function searchFilings(q: Db, raw: FilingSearch): Promise<FilingSummary[]> {
  const s = FilingSearchSchema.parse(raw);
  const text = s.q?.trim();
  const asAddress = text ? normalizeAddress(text) : null;
  const rows = await q.selectFrom("filings as f").leftJoin("addresses as a", "a.id", "f.primary_address_id")
    .select(["f.id", "f.kind", "f.source_key", "f.status", "f.event_date", "f.in_target", "f.deleted_at",
      "a.number_from", "a.number_to", "a.predir", "a.street_name", "a.suffix", "a.zip",
      sql<string[]>`coalesce((select array_agg(pf.project_id order by pf.project_id) from project_filings pf where pf.filing_id = f.id), '{}')`.as("linked_projects")])
    .where("f.deleted_at", "is", null) // deleted filings are reachable only through history and restore
    .$if(s.kind !== undefined, (b) => b.where("f.kind", "=", s.kind!))
    .$if(s.in_target !== undefined, (b) => b.where("f.in_target", "=", s.in_target!))
    .$if(s.linked !== undefined, (b) => b.where(sql<boolean>`exists (select 1 from project_filings pf where pf.filing_id = f.id) = ${s.linked!}`))
    .$if(Boolean(text), (b) => b.where((eb) => {
      const like = `%${text!.toUpperCase()}%`;
      const ors = [
        eb(sql`upper(f.source_key)`, "like", like),
        eb.exists(eb.selectFrom("filing_identifiers as fi").innerJoin("identifiers as i", "i.id", "fi.identifier_id")
          .select("fi.filing_id").whereRef("fi.filing_id", "=", "f.id").where(sql`upper(i.value)`, "like", like)),
        eb.exists(eb.selectFrom("filing_organizations as fo").innerJoin("organizations as o", "o.id", "fo.organization_id")
          .select("fo.filing_id").whereRef("fo.filing_id", "=", "f.id").where("o.name_key", "like", `%${orgNameKey(text!) ?? text!.toUpperCase()}%`)),
      ];
      if (asAddress?.ok) {
        const a = asAddress.value;
        ors.push(eb.exists(eb.selectFrom("filing_addresses as fa").innerJoin("addresses as x", "x.id", "fa.address_id")
          .select("fa.filing_id").whereRef("fa.filing_id", "=", "f.id").where("x.street_name", "=", a.street_name)
          .where(sql<boolean>`x.predir is not distinct from ${a.predir}`)
          .where("x.number_from", "<=", a.number_to).where("x.number_to", ">=", a.number_from)));
      }
      return eb.or(ors);
    }))
    .orderBy(sql`f.event_date desc nulls last`).orderBy("f.id", "desc").limit(s.limit).execute();
  return rows.map((r) => ({
    id: r.id, kind: r.kind, source_key: r.source_key, status: r.status, event_date: r.event_date, in_target: r.in_target,
    address: r.street_name ? formatAddressDisplay(rowToAddress({ number_from: r.number_from!, number_to: r.number_to!, predir: r.predir, street_name: r.street_name, suffix: r.suffix, zip: r.zip })) : null,
    linked_projects: r.linked_projects, deleted: r.deleted_at !== null,
  }));
}

export async function getFiling(q: Db, id: number) {
  const row = await q.selectFrom("filings").select(["id", "content_hash", "created_at", "updated_at"])
    .where("id", "=", id).where("deleted_at", "is", null).executeTakeFirst();
  if (!row) throw new HttpError(404, `no live filing ${id}`);
  const record = await loadFilingRecord(q, id);
  const projects = await q.selectFrom("project_filings").select(["project_id", "role", "reason", "linked_by", "linked_at"]).where("filing_id", "=", id).execute();
  return { ...row, addresses: record.addresses.map(formatAddressDisplay), record, projects };
}
