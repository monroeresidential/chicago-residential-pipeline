import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import type { Status } from "../../../shared/constants";
import { formatAddressDisplay } from "../../../shared/normalize/address";
import { contentHash } from "../../../shared/records/hash";
import { normalizeRecord } from "../../../shared/records/normalize-record";
import type { Issue, NormalizedRecord, WireRecord } from "../../../shared/records/types";
import { withActor } from "../db/actor";
import { INTAKE_LOCK } from "../db/locks";
import type { Db } from "../db/client";
import { HttpError } from "../errors";
import { validateRecord } from "../intake/submit";
import { suggestStatusChange, type StatusChange } from "../match/status";
import type { ProjectSuggestion } from "../match/suggest";
import { markChanged } from "../publish/state";
import { linkFiling } from "../store/edit";
import { loadFilingRecord, writeFiling } from "../store/filings";
import { createProjectRow, ProjectCreateInput, updateProjectRow } from "../store/projects";
import { resolveAliases } from "../store/shared-values";
import { filtered, listQueue, QueueFilterSchema, type QueueItemSummary } from "./queue";

export const ApproveOptionsSchema = z.strictObject({
  link_to: z.string().optional(),
  create_project: ProjectCreateInput.partial().required({ id: true }).optional(),
  overrides: z.record(z.string(), z.unknown()).optional(),
  accept_status_change: z.boolean().optional(),
  status_note: z.string().min(1).optional(),
  note: z.string().optional(),
});
export type ApproveOptions = z.input<typeof ApproveOptionsSchema>;
export interface ApproveResult { queue_item_id: number; filing_id: number; linked_project_id: string | null; status_change: StatusChange | null }

export async function approveItem(db: Db, reviewer: string, id: number, rawOpts: ApproveOptions = {}): Promise<ApproveResult> {
  const opts = ApproveOptionsSchema.parse(rawOpts);
  if (opts.link_to && opts.create_project) throw new HttpError(400, "use link_to or create_project, not both");
  const result = await withActor(db, reviewer, `queue_item:${id}`, async (q): Promise<ApproveResult | { stale: true }> => {
    await sql`select pg_advisory_xact_lock(${INTAKE_LOCK})`.execute(q); // never interleave with a submission
    const item = await q.selectFrom("queue_items").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
    if (!item) throw new HttpError(404, `no queue item ${id}`);
    if (item.state !== "pending") throw new HttpError(409, `queue item ${id} is ${item.state}`);

    let record = item.proposed as NormalizedRecord;
    let issues = item.normalization_issues as Issue[];
    if (opts.overrides) {
      const sub = await q.selectFrom("submissions").select("body").where("id", "=", item.submission_id).executeTakeFirstOrThrow();
      const raw = (sub.body as { records: WireRecord[] }).records[item.record_index]!;
      const v = validateRecord({ ...raw, data: { ...raw.data, ...opts.overrides } });
      if (!v.ok) throw new HttpError(422, "overrides are not valid", v.errors);
      const n = normalizeRecord(v.record);
      record = await resolveAliases(q, n.record);
      issues = n.issues;
    }
    const blocking = issues.filter((i) => i.blocking);
    if (blocking.length) throw new HttpError(422, "fix these values with overrides before approving", blocking);

    if (item.action === "update") {
      const f = await q.selectFrom("filings").select("deleted_at").where("kind", "=", item.kind).where("source_key", "=", item.source_key).executeTakeFirst();
      if (!f || f.deleted_at) {
        await q.updateTable("queue_items").set({ state: "superseded" }).where("id", "=", id).execute();
        return { stale: true }; // committed first, then reported (a throw here would roll the supersede back)
      }
    }
    // What Grok sent, re-resolved against today's merges (the item may have been queued before one).
    const sourceHash = contentHash(await resolveAliases(q, item.proposed as NormalizedRecord), item.normalization_issues as Issue[]);
    const filingId = await writeFiling(q, record, { sourceHash, sourceItemId: id });
    let projectId: string | null = opts.link_to ?? null;
    let reason = "linked in review";

    if (opts.create_project) {
      const loaded = await loadFilingRecord(q, filingId);
      const point = loaded.point;
      const input = {
        status: "planning" as Status, program: "private" as const, confidence: "reported" as const, visibility: "draft" as const,
        status_note: `Added from ${record.kind.replace("_", " ")} ${record.source_key}`,
        address: loaded.addresses[0] ? formatAddressDisplay(loaded.addresses[0]) : undefined,
        lat: point?.lat, lng: point?.lon, sources: record.source_url ? [record.source_url] : undefined,
        ...opts.create_project,
      };
      if (input.lat === undefined || input.lng === undefined || !input.address || !input.sources) {
        throw new HttpError(422, "create_project needs address, lat, lng and sources the filing does not provide");
      }
      await createProjectRow(q, input as Parameters<typeof createProjectRow>[1]);
      projectId = input.id;
      reason = "project created from this filing";
    }

    let statusChange: StatusChange | null = null;
    if (projectId) {
      const s = ((item.suggestions as { projects?: ProjectSuggestion[] }).projects ?? []).find((p) => p.project_id === projectId);
      if (s) reason = `${s.strength}: ${s.reasons.join("; ")}`;
      await linkFiling(q, projectId, filingId, reviewer, reason);
      if (opts.accept_status_change) {
        const p = await q.selectFrom("projects").select("status").where("id", "=", projectId).executeTakeFirstOrThrow();
        statusChange = suggestStatusChange(p.status as Status, record);
        if (statusChange) await updateProjectRow(q, projectId, { status: statusChange.to, status_note: opts.status_note ?? statusChange.reason });
      }
    }

    await q.updateTable("queue_items").set({ state: "approved", reviewed_by: reviewer, reviewed_at: new Date(), review_note: opts.note ?? null }).where("id", "=", id).execute();
    await markChanged(q, { projectIds: projectId ? [projectId] : [], filingIds: [filingId] });
    return { queue_item_id: id, filing_id: filingId, linked_project_id: projectId, status_change: statusChange };
  });
  if ("stale" in result) throw new HttpError(409, `queue item ${id} updates a filing that has since been deleted; it was superseded`);
  return result;
}

export async function rejectItem(db: Db, reviewer: string, id: number, reason: string): Promise<void> {
  if (!reason.trim()) throw new HttpError(400, "a reason is required to reject");
  const r = await db.updateTable("queue_items").set({ state: "rejected", reviewed_by: reviewer, reviewed_at: new Date(), review_note: reason.trim() })
    .where("id", "=", id).where("state", "=", "pending").executeTakeFirst();
  if (Number(r.numUpdatedRows) !== 1) throw new HttpError(409, `queue item ${id} is not pending`);
}

export const BulkReviewSchema = z.strictObject({
  filter: QueueFilterSchema.omit({ state: true }).partial().default({}),
  action: z.enum(["approve", "reject"]),
  link_strong: z.boolean().default(false),
  reason: z.string().optional(),
  confirm: z.string().optional(),
});
export type BulkReviewRequest = z.input<typeof BulkReviewSchema>;
export type BulkPreview = { preview: true; count: number; sample: QueueItemSummary[]; confirm: string; expires_at: string };
export type BulkResult = { preview: false; approved: number; rejected: number; skipped: number; errors: { id: number; error: string }[] };

const CONFIRM_TTL_MS = 10 * 60 * 1000;

export async function bulkReview(db: Db, reviewer: string, raw: BulkReviewRequest): Promise<BulkPreview | BulkResult> {
  const req = BulkReviewSchema.parse(raw);
  if (req.action === "reject" && !req.reason?.trim()) throw new HttpError(400, "a reason is required to reject");

  if (!req.confirm) {
    if (req.action === "approve" && req.filter.has_issues === true) {
      throw new HttpError(400, "items with blocking issues cannot be bulk-approved; fix them with overrides one at a time");
    }
    const filter = { ...req.filter, state: "pending" as const, ...(req.action === "approve" ? { has_issues: false } : {}) };
    const ids = (await filtered(db, filter).select("id").orderBy("id").execute()).map((r) => r.id);
    const code = randomBytes(5).toString("hex");
    const expires = new Date(Date.now() + CONFIRM_TTL_MS);
    await db.insertInto("bulk_previews").values({
      code, action: req.action, filter: JSON.stringify(filter), item_ids: ids, link_strong: req.link_strong,
      reason: req.reason ?? null, created_by: reviewer, expires_at: expires,
    }).execute();
    const sample = (await listQueue(db, filter, { limit: 10 })).items;
    return { preview: true, count: ids.length, sample, confirm: code, expires_at: expires.toISOString() };
  }

  const preview = await db.deleteFrom("bulk_previews").where("code", "=", req.confirm).returningAll().executeTakeFirst();
  if (!preview || preview.created_by !== reviewer || preview.action !== req.action || preview.expires_at.getTime() < Date.now()) {
    throw new HttpError(400, "confirmation code is invalid or expired; run the preview again");
  }
  const result: BulkResult = { preview: false, approved: 0, rejected: 0, skipped: 0, errors: [] };
  for (const id of preview.item_ids) {
    try {
      const item = await db.selectFrom("queue_items").select(["state", "suggestions"]).where("id", "=", id).executeTakeFirstOrThrow();
      if (item.state !== "pending") { result.skipped++; continue; }
      if (preview.action === "reject") {
        await rejectItem(db, reviewer, id, preview.reason ?? "bulk reject");
        result.rejected++;
      } else {
        const strong = ((item.suggestions as { projects?: ProjectSuggestion[] }).projects ?? []).filter((s) => s.strength === "strong");
        await approveItem(db, reviewer, id, preview.link_strong && strong.length === 1 ? { link_to: strong[0]!.project_id } : {});
        result.approved++;
      }
    } catch (e) {
      result.errors.push({ id, error: (e as Error).message });
    }
  }
  return result;
}
