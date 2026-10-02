import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import type { z } from "zod";
import { formatAddressDisplay } from "../../../shared/normalize/address";
import { matterKeyOf, normalizeRecordNumber } from "../../../shared/normalize/primitives";
import { diffRecords } from "../../../shared/records/diff";
import { contentHash } from "../../../shared/records/hash";
import { normalizeRecord } from "../../../shared/records/normalize-record";
import { DATA_SCHEMAS, MAX_RECORDS, RecordEnvelope, SubmissionEnvelope } from "../../../shared/records/schemas";
import type { WireRecord } from "../../../shared/records/types";
import type { Principal } from "../auth/tokens";
import type { Db } from "../db/client";
import { HttpError } from "../errors";
import { suggestDuplicates } from "../match/duplicates";
import { suggestProjects } from "../match/suggest";
import { loadFilingRecord } from "../store/filings";
import { resolveAliases } from "../store/shared-values";

export interface RecordResult {
  index: number;
  source_key: string | null;
  outcome: "queued_create" | "queued_update" | "no_change" | "invalid";
  queue_item_id?: number;
  changed?: string[];
  errors?: { path: string; message: string }[];
}
export interface SubmissionResponse { submission_id: number | null; dry_run?: true; results: RecordResult[] }

const issuesOf = (e: z.ZodError, prefix = "") =>
  e.issues.map((i) => ({ path: [prefix, ...i.path.map(String)].filter(Boolean).join("."), message: i.message }));

export function validateRecord(raw: unknown):
  | { ok: true; record: WireRecord }
  | { ok: false; source_key: string | null; errors: { path: string; message: string }[] } {
  if (JSON.stringify(raw).includes("\\u0000")) {
    const sk = typeof (raw as { source_key?: unknown })?.source_key === "string" ? (raw as { source_key: string }).source_key : null;
    return { ok: false, source_key: sk, errors: [{ path: "", message: "record contains a NUL (\\u0000) character; remove it and resend" }] };
  }
  const env = RecordEnvelope.safeParse(raw);
  const sk = typeof (raw as { source_key?: unknown })?.source_key === "string" ? ((raw as { source_key: string }).source_key) : null;
  if (!env.success) return { ok: false, source_key: sk, errors: issuesOf(env.error) };
  const data = DATA_SCHEMAS[env.data.kind].safeParse(env.data.data);
  if (!data.success) return { ok: false, source_key: sk, errors: issuesOf(data.error, "data") };
  const d = data.data as Record<string, unknown>;
  const key = env.data.source_key.trim().toUpperCase();
  const mismatch =
    (env.data.kind === "permit" && String(d.permit_number).trim().toUpperCase() !== key) ? "must equal data.permit_number"
    : (env.data.kind === "zba_case" && String(d.case_no).trim().toUpperCase() !== key) ? "must equal data.case_no"
    : (env.data.kind === "zoning_matter" && (() => {
        const rn = normalizeRecordNumber(String(d.record_number));
        return rn.ok && matterKeyOf(rn.value) !== matterKeyOf(key);
      })()) ? "must be data.record_number without the leading S"
    : null;
  if (mismatch) return { ok: false, source_key: sk, errors: [{ path: "source_key", message: mismatch }] };
  return { ok: true, record: { ...env.data, data: d } };
}

const SUBMISSION_LOCK = 727275;

/** jsonb rejects NUL characters; such records are reported invalid, and the stored copy drops the character. */
function storableBody(body: unknown): string {
  return JSON.stringify(body, (_k, v) => (typeof v === "string" ? v.replace(/\u0000/g, "") : v));
}

class DryRunRollback extends Error {
  constructor(public results: RecordResult[]) { super("dry run"); }
}

async function processRecord(q: Db, submissionId: number, index: number, raw: unknown): Promise<RecordResult> {
  const v = validateRecord(raw);
  if (!v.ok) return { index, source_key: v.source_key, outcome: "invalid", errors: v.errors };

  const normalized = normalizeRecord(v.record);
  const record = await resolveAliases(q, normalized.record);
  const issues = normalized.issues;
  const hash = contentHash(record, issues);
  const base = { index, source_key: record.source_key };

  const filing = await q.selectFrom("filings").select(["id", "content_hash", "last_source_hash", "deleted_at"])
    .where("kind", "=", record.kind).where("source_key", "=", record.source_key).executeTakeFirst();
  if (filing && (hash === filing.content_hash || hash === filing.last_source_hash)) return { ...base, outcome: "no_change" };

  const prior = await q.selectFrom("queue_items").select(["id", "content_hash"])
    .where("kind", "=", record.kind).where("source_key", "=", record.source_key).where("state", "in", ["pending", "rejected"]).execute();
  if (prior.some((p) => p.content_hash === hash)) return { ...base, outcome: "no_change" };

  await q.updateTable("queue_items").set({ state: "superseded" })
    .where("kind", "=", record.kind).where("source_key", "=", record.source_key).where("state", "=", "pending").execute();

  const live = filing && !filing.deleted_at ? filing : null;
  const diff = diffRecords(live ? await loadFilingRecord(q, live.id) : null, record);
  const projects = await suggestProjects(q, record);
  const duplicates = await suggestDuplicates(q, record);
  const item = await q.insertInto("queue_items").values({
    submission_id: submissionId, record_index: index, kind: record.kind, source_key: record.source_key,
    action: live ? "update" : "create", proposed: JSON.stringify(record), content_hash: hash,
    diff: JSON.stringify(diff), normalization_issues: JSON.stringify(issues),
    suggestions: JSON.stringify({ projects, duplicates }), in_target: record.in_target,
    has_flag: Boolean(record.flag || record.attributes.unit_flag), has_blocking_issues: issues.some((i) => i.blocking),
    top_strength: projects[0]?.strength ?? null,
    address_display: record.addresses[0] ? formatAddressDisplay(record.addresses[0]) : null,
  }).returning("id").executeTakeFirstOrThrow();

  return live
    ? { ...base, outcome: "queued_update", queue_item_id: item.id, changed: Object.keys(diff).sort() }
    : { ...base, outcome: "queued_create", queue_item_id: item.id };
}

async function stored(db: Db, jti: string, key: string, sha: string): Promise<SubmissionResponse> {
  const row = await db.selectFrom("submissions").select(["body_sha256", "response"]).where("token_jti", "=", jti).where("idempotency_key", "=", key).executeTakeFirstOrThrow();
  if (row.body_sha256 !== sha) throw new HttpError(409, "this Idempotency-Key was already used with a different body");
  if (!row.response) throw new HttpError(409, "a request with this Idempotency-Key is still being processed");
  return row.response as SubmissionResponse;
}

export async function processSubmission(
  db: Db,
  principal: Principal,
  input: { body: unknown; rawBody: string; idempotencyKey: string | undefined; dryRun: boolean },
): Promise<SubmissionResponse> {
  const key = input.idempotencyKey?.trim();
  if (!key) throw new HttpError(400, "the Idempotency-Key header is required");
  const env = SubmissionEnvelope.safeParse(input.body);
  if (!env.success) throw new HttpError(400, "malformed submission", issuesOf(env.error));
  if (env.data.records.length > MAX_RECORDS) throw new HttpError(413, `at most ${MAX_RECORDS} records per request; split the run into chunks`);
  const sha = createHash("sha256").update(input.rawBody).digest("hex");

  if (!input.dryRun) {
    const existing = await db.selectFrom("submissions").select("id").where("token_jti", "=", principal.jti).where("idempotency_key", "=", key).executeTakeFirst();
    if (existing) return stored(db, principal.jti, key, sha);
  }

  try {
    return await db.transaction().execute(async (trx) => {
      // One submission at a time: chunks sent in parallel would otherwise not see each other's pending items.
      await sql`select pg_advisory_xact_lock(${SUBMISSION_LOCK})`.execute(trx);
      const inserted = await trx.insertInto("submissions").values({
        token_jti: principal.jti, idempotency_key: input.dryRun ? `dry-run:${randomUUID()}` : key, body_sha256: sha, body: storableBody(input.body),
      }).onConflict((oc) => oc.columns(["token_jti", "idempotency_key"]).doNothing()).returning("id").executeTakeFirst();
      if (!inserted) return null; // a concurrent identical request won the race; answered below
      const results: RecordResult[] = [];
      for (const [index, raw] of env.data.records.entries()) results.push(await processRecord(trx, inserted.id, index, raw));
      if (input.dryRun) throw new DryRunRollback(results);
      const response: SubmissionResponse = { submission_id: inserted.id, results };
      await trx.updateTable("submissions").set({ response: JSON.stringify(response) }).where("id", "=", inserted.id).execute();
      return response;
    }) ?? (await stored(db, principal.jti, key, sha));
  } catch (e) {
    if (e instanceof DryRunRollback) return { submission_id: null, dry_run: true, results: e.results };
    throw e;
  }
}
