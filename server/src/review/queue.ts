import { z } from "zod";
import { KINDS } from "../../../shared/records/types";
import type { Db } from "../db/client";
import { HttpError } from "../errors";

export const QueueFilterSchema = z.strictObject({
  state: z.enum(["pending", "approved", "rejected", "superseded"]).default("pending"),
  kind: z.enum(KINDS).optional(),
  in_target: z.boolean().optional(),
  has_flag: z.boolean().optional(),
  action: z.enum(["create", "update"]).optional(),
  strength: z.enum(["strong", "likely", "possible", "none"]).optional(),
  has_issues: z.boolean().optional(),
  submission_id: z.number().int().optional(),
});
export type QueueFilter = z.infer<typeof QueueFilterSchema>;

export interface QueueItemSummary {
  id: number; kind: string; source_key: string; action: string; state: string; address: string | null;
  in_target: boolean; has_flag: boolean; has_blocking_issues: boolean;
  top_suggestion: { project_id: string; strength: string } | null; changed: string[]; created_at: Date;
}

export function filtered(q: Db, raw: Partial<QueueFilter>) {
  const f = QueueFilterSchema.parse(raw);
  return q.selectFrom("queue_items")
    .where("state", "=", f.state)
    .$if(f.kind !== undefined, (b) => b.where("kind", "=", f.kind!))
    .$if(f.in_target !== undefined, (b) => b.where("in_target", "=", f.in_target!))
    .$if(f.has_flag !== undefined, (b) => b.where("has_flag", "=", f.has_flag!))
    .$if(f.action !== undefined, (b) => b.where("action", "=", f.action!))
    .$if(f.has_issues !== undefined, (b) => b.where("has_blocking_issues", "=", f.has_issues!))
    .$if(f.submission_id !== undefined, (b) => b.where("submission_id", "=", f.submission_id!))
    .$if(f.strength === "none", (b) => b.where("top_strength", "is", null))
    .$if(f.strength !== undefined && f.strength !== "none", (b) => b.where("top_strength", "=", f.strength!));
}

type Row = { id: number; kind: string; source_key: string; action: string; state: string; address_display: string | null; in_target: boolean; has_flag: boolean; has_blocking_issues: boolean; diff: unknown; suggestions: unknown; created_at: Date };

export function summarize(r: Row): QueueItemSummary {
  const top = ((r.suggestions as { projects?: { project_id: string; strength: string }[] }).projects ?? [])[0];
  return {
    id: r.id, kind: r.kind, source_key: r.source_key, action: r.action, state: r.state, address: r.address_display,
    in_target: r.in_target, has_flag: r.has_flag, has_blocking_issues: r.has_blocking_issues,
    top_suggestion: top ? { project_id: top.project_id, strength: top.strength } : null,
    changed: Object.keys(r.diff as object).sort(), created_at: r.created_at,
  };
}

const SUMMARY_COLUMNS = ["id", "kind", "source_key", "action", "state", "address_display", "in_target", "has_flag", "has_blocking_issues", "diff", "suggestions", "created_at"] as const;

export async function listQueue(q: Db, filter: Partial<QueueFilter>, page: { limit?: number; offset?: number } = {}) {
  const limit = Math.min(Math.max(page.limit ?? 50, 1), 200);
  const { total } = await filtered(q, filter).select((eb) => eb.fn.countAll<number>().as("total")).executeTakeFirstOrThrow();
  const rows = await filtered(q, filter).select([...SUMMARY_COLUMNS]).orderBy("id").limit(limit).offset(page.offset ?? 0).execute();
  return { total: Number(total), items: rows.map(summarize) };
}

export async function getQueueItem(q: Db, id: number) {
  const row = await q.selectFrom("queue_items").innerJoin("submissions", "submissions.id", "queue_items.submission_id")
    .selectAll("queue_items").select(["submissions.received_at"]).where("queue_items.id", "=", id).executeTakeFirst();
  if (!row) throw new HttpError(404, `no queue item ${id}`);
  return row;
}

export async function queueSummary(q: Db) {
  const rows = await q.selectFrom("queue_items").select(["kind", "action", "top_strength", "has_blocking_issues"]).where("state", "=", "pending").execute();
  const count = (key: (r: (typeof rows)[number]) => string) =>
    rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [key(r)]: (acc[key(r)] ?? 0) + 1 }), {});
  const last = await q.selectFrom("submissions").select("received_at").orderBy("received_at", "desc").limit(1).executeTakeFirst();
  return {
    pending: rows.length,
    by_kind: count((r) => r.kind),
    by_action: count((r) => r.action),
    by_strength: count((r) => r.top_strength ?? "none"),
    with_blocking_issues: rows.filter((r) => r.has_blocking_issues).length,
    last_submission_at: last?.received_at.toISOString() ?? null,
  };
}
