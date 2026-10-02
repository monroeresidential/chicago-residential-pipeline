import { sql } from "kysely";
import type { Db } from "../db/client";
import { HttpError } from "../errors";
import { contentHash } from "../../../shared/records/hash";
import type { Issue, NormalizedRecord } from "../../../shared/records/types";
import { refreshFilingHash } from "./filings";
import { resolveAliases } from "./shared-values";

/**
 * After a merge, Grok's next push of the old spelling resolves to the survivor, so the stored hash of
 * "what Grok last sent" must be recomputed the same way, or an overridden filing would re-queue.
 */
export async function refreshSourceHash(q: Db, filingId: number): Promise<void> {
  const f = await q.selectFrom("filings").select(["last_source_hash", "source_item_id"]).where("id", "=", filingId).executeTakeFirstOrThrow();
  if (!f.source_item_id) return;
  const item = await q.selectFrom("queue_items").select(["proposed", "normalization_issues"]).where("id", "=", f.source_item_id).executeTakeFirst();
  if (!item) return;
  const record = await resolveAliases(q, item.proposed as NormalizedRecord);
  const hash = contentHash(record, item.normalization_issues as Issue[]);
  if (hash !== f.last_source_hash) await q.updateTable("filings").set({ last_source_hash: hash }).where("id", "=", filingId).execute();
}

/** Renumbers a filing's address positions 0..n (keeping order) and points primary_address_id at position 0. */
async function compactAddresses(q: Db, filingId: number): Promise<void> {
  const rows = await q.selectFrom("filing_addresses").select(["address_id", "position"]).where("filing_id", "=", filingId).orderBy("position").execute();
  for (const [i, r] of rows.entries()) {
    if (r.position !== i) await q.updateTable("filing_addresses").set({ position: i }).where("filing_id", "=", filingId).where("address_id", "=", r.address_id).execute();
  }
  await q.updateTable("filings").set({ primary_address_id: rows[0]?.address_id ?? null }).where("id", "=", filingId).execute();
}

export async function mergeValues(q: Db, type: "organization" | "address", fromId: number, intoId: number): Promise<{ affected_filings: number }> {
  if (fromId === intoId) throw new HttpError(400, "cannot merge a row into itself");
  const table = type === "organization" ? "organizations" : "addresses";
  const rows = await q.selectFrom(table).select(["id"]).where("id", "in", [fromId, intoId]).where("deleted_at", "is", null).execute();
  if (rows.length !== 2) throw new HttpError(404, `both ${table} rows must exist and not be deleted`);

  // Filings whose accepted source (the approved Grok proposal) mentions the merged-away row, whether or not the
  // filing still references it after edits: their "what Grok sent" hash changes with the merge.
  const fromRow = type === "organization"
    ? await q.selectFrom("organizations").select("name_key").where("id", "=", fromId).executeTakeFirstOrThrow()
    : await q.selectFrom("addresses").select(["number_from", "number_to", "predir", "street_name", "suffix"]).where("id", "=", fromId).executeTakeFirstOrThrow();
  const pattern = type === "organization"
    ? { organizations: [{ name_key: (fromRow as { name_key: string }).name_key }] }
    : { addresses: [fromRow] };
  const sourceDependents = (await q.selectFrom("filings as f").innerJoin("queue_items as qi", "qi.id", "f.source_item_id")
    .select("f.id").where(sql<boolean>`qi.proposed @> ${JSON.stringify(pattern)}::jsonb`).execute()).map((r) => r.id);

  const affected = new Set<number>();
  if (type === "organization") {
    const links = await q.selectFrom("filing_organizations").selectAll().where("organization_id", "=", fromId).execute();
    for (const l of links) {
      affected.add(l.filing_id);
      const dup = await q.selectFrom("filing_organizations").select("filing_id")
        .where("filing_id", "=", l.filing_id).where("organization_id", "=", intoId).where("role", "=", l.role).executeTakeFirst();
      const row = q.deleteFrom("filing_organizations").where("filing_id", "=", l.filing_id).where("organization_id", "=", fromId).where("role", "=", l.role);
      if (dup) await row.execute();
      else await q.updateTable("filing_organizations").set({ organization_id: intoId })
        .where("filing_id", "=", l.filing_id).where("organization_id", "=", fromId).where("role", "=", l.role).execute();
    }
    await q.updateTable("organizations").set({ merged_into_id: intoId }).where("merged_into_id", "=", fromId).execute();
    await q.updateTable("organizations").set({ merged_into_id: intoId, deleted_at: new Date() }).where("id", "=", fromId).execute();
  } else {
    for (const l of await q.selectFrom("filing_addresses").selectAll().where("address_id", "=", fromId).execute()) {
      affected.add(l.filing_id);
      const dup = await q.selectFrom("filing_addresses").select(["filing_id", "position"]).where("filing_id", "=", l.filing_id).where("address_id", "=", intoId).executeTakeFirst();
      if (dup) {
        // Both spellings were listed: the survivor takes the earlier of the two positions.
        await q.deleteFrom("filing_addresses").where("filing_id", "=", l.filing_id).where("address_id", "=", fromId).execute();
        if (l.position < dup.position) await q.updateTable("filing_addresses").set({ position: l.position }).where("filing_id", "=", l.filing_id).where("address_id", "=", intoId).execute();
      }
      else await q.updateTable("filing_addresses").set({ address_id: intoId }).where("filing_id", "=", l.filing_id).where("address_id", "=", fromId).execute();
    }
    for (const f of await q.selectFrom("filings").select("id").where("primary_address_id", "=", fromId).execute()) affected.add(f.id);
    await q.updateTable("filings").set({ primary_address_id: intoId }).where("primary_address_id", "=", fromId).execute();
    for (const l of await q.selectFrom("project_addresses").selectAll().where("address_id", "=", fromId).execute()) {
      const dup = await q.selectFrom("project_addresses").select("project_id").where("project_id", "=", l.project_id).where("address_id", "=", intoId).executeTakeFirst();
      if (dup) await q.deleteFrom("project_addresses").where("project_id", "=", l.project_id).where("address_id", "=", fromId).execute();
      else await q.updateTable("project_addresses").set({ address_id: intoId }).where("project_id", "=", l.project_id).where("address_id", "=", fromId).execute();
    }
    await sql`update addresses t set point = coalesce(t.point, f.point), zip = coalesce(t.zip, f.zip)
              from addresses f where t.id = ${intoId} and f.id = ${fromId}`.execute(q);
    await q.updateTable("addresses").set({ merged_into_id: intoId }).where("merged_into_id", "=", fromId).execute();
    await q.updateTable("addresses").set({ merged_into_id: intoId, deleted_at: new Date() }).where("id", "=", fromId).execute();
  }
  for (const filingId of affected) {
    if (type === "address") await compactAddresses(q, filingId);
    await refreshFilingHash(q, filingId);
  }
  for (const filingId of new Set([...affected, ...sourceDependents])) await refreshSourceHash(q, filingId);
  return { affected_filings: affected.size };
}
