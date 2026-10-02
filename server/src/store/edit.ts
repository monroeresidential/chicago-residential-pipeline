import { denormalizeRecord } from "../../../shared/records/denormalize-record";
import { normalizeRecord } from "../../../shared/records/normalize-record";
import type { Kind } from "../../../shared/records/types";
import type { Db } from "../db/client";
import { HttpError } from "../errors";
import { validateRecord } from "../intake/submit";
import { filingRole, loadFilingRecord, writeFiling } from "./filings";
import { resolveAliases } from "./shared-values";

async function liveFiling(q: Db, filingId: number) {
  const f = await q.selectFrom("filings").select(["id", "kind", "attributes"]).where("id", "=", filingId).where("deleted_at", "is", null).executeTakeFirst();
  if (!f) throw new HttpError(404, `no live filing ${filingId}`);
  return f;
}

export async function linkFiling(q: Db, projectId: string, filingId: number, linkedBy: string, reason: string): Promise<void> {
  const p = await q.selectFrom("projects").select("id").where("id", "=", projectId).where("deleted_at", "is", null).executeTakeFirst();
  if (!p) throw new HttpError(404, `no live project ${projectId}`);
  const f = await liveFiling(q, filingId);
  await q.insertInto("project_filings").values({
    project_id: projectId, filing_id: filingId, role: filingRole(f.kind as Kind, f.attributes as Record<string, unknown>), linked_by: linkedBy, reason,
  }).onConflict((oc) => oc.columns(["project_id", "filing_id"]).doNothing()).execute();
}

export async function unlinkFiling(q: Db, projectId: string, filingId: number): Promise<void> {
  const r = await q.deleteFrom("project_filings").where("project_id", "=", projectId).where("filing_id", "=", filingId).executeTakeFirst();
  if (Number(r.numDeletedRows) !== 1) throw new HttpError(404, `filing ${filingId} is not linked to ${projectId}`);
}

/** Applies a patch in Grok's wire field names, re-validated and re-normalized exactly like a submission. */
export async function updateFilingRecord(q: Db, filingId: number, patch: Record<string, unknown>): Promise<void> {
  await liveFiling(q, filingId);
  if ("kind" in patch || "source_key" in patch) throw new HttpError(422, "kind and source_key cannot be edited");
  const current = denormalizeRecord(await loadFilingRecord(q, filingId));
  const v = validateRecord({ ...current, observed_at: new Date().toISOString(), data: { ...current.data, ...patch } });
  if (!v.ok) throw new HttpError(422, "invalid filing edit", v.errors);
  const { record, issues } = normalizeRecord(v.record);
  const blocking = issues.filter((i) => i.blocking);
  if (blocking.length) throw new HttpError(422, "values could not be normalized", blocking);
  await writeFiling(q, await resolveAliases(q, record), { sourceHash: null });
}

export async function setFilingDeleted(q: Db, filingId: number, deleted: boolean): Promise<void> {
  const r = await q.updateTable("filings").set({ deleted_at: deleted ? new Date() : null })
    .where("id", "=", filingId).where("deleted_at", deleted ? "is" : "is not", null).executeTakeFirst();
  if (Number(r.numUpdatedRows) !== 1) throw new HttpError(404, deleted ? `no live filing ${filingId}` : `no deleted filing ${filingId}`);
}
