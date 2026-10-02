import { sql } from "kysely";
import type { Db } from "../db/client";
import { HttpError } from "../errors";
import { refreshFilingHash } from "./filings";

export async function mergeValues(q: Db, type: "organization" | "address", fromId: number, intoId: number): Promise<{ affected_filings: number }> {
  if (fromId === intoId) throw new HttpError(400, "cannot merge a row into itself");
  const table = type === "organization" ? "organizations" : "addresses";
  const rows = await q.selectFrom(table).select(["id"]).where("id", "in", [fromId, intoId]).where("deleted_at", "is", null).execute();
  if (rows.length !== 2) throw new HttpError(404, `both ${table} rows must exist and not be deleted`);

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
      const dup = await q.selectFrom("filing_addresses").select("filing_id").where("filing_id", "=", l.filing_id).where("address_id", "=", intoId).executeTakeFirst();
      if (dup) await q.deleteFrom("filing_addresses").where("filing_id", "=", l.filing_id).where("address_id", "=", fromId).execute();
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
  for (const filingId of affected) await refreshFilingHash(q, filingId);
  return { affected_filings: affected.size };
}
