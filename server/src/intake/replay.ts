import type { Db } from "../db/client";
import { HttpError } from "../errors";
import { processSubmission, type SubmissionResponse } from "./submit";

const REPLAY = { sub: "replay", role: "submitter" as const, jti: "replay-local" };

/** Re-runs a stored Grok submission through today's code. Dry run unless write is true. */
export async function replaySubmission(db: Db, submissionId: number, opts: { write: boolean }) {
  const sub = await db.selectFrom("submissions").select(["body", "response"]).where("id", "=", submissionId).executeTakeFirst();
  if (!sub) throw new HttpError(404, `no submission ${submissionId}`);
  await db.insertInto("tokens").values({ jti: REPLAY.jti, sub: REPLAY.sub, role: REPLAY.role }).onConflict((oc) => oc.column("jti").doNothing()).execute();
  const res = await processSubmission(db, REPLAY, {
    body: sub.body, rawBody: JSON.stringify(sub.body), idempotencyKey: `replay-${submissionId}-${Date.now()}`, dryRun: !opts.write,
  });
  const original = (sub.response as SubmissionResponse | null)?.results ?? [];
  const counts: Record<string, number> = {};
  for (const r of res.results) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  const changed = res.results
    .filter((r) => original[r.index] && original[r.index]!.outcome !== r.outcome)
    .map((r) => ({ index: r.index, source_key: r.source_key, was: original[r.index]!.outcome, now: r.outcome }));
  return { counts, changed };
}
