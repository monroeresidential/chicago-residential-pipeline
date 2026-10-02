import { sql } from "kysely";
import type { Config } from "../config";
import type { Db } from "../db/client";

export const DEBOUNCE_MS = 10 * 60 * 1000;
type Trigger = (config: Config) => Promise<"sent" | "skipped">;

/** POSTs to the configured build hook (Workers Builds or a GitHub Action — chosen in stage 2). */
export async function triggerSiteBuild(config: Config, fetchFn: typeof fetch = fetch): Promise<"sent" | "skipped"> {
  if (!config.SITE_BUILD_HOOK_URL) {
    console.log(JSON.stringify({ t: new Date().toISOString(), level: "info", msg: "site build hook not configured; skipping" }));
    return "skipped";
  }
  const res = await fetchFn(config.SITE_BUILD_HOOK_URL, {
    method: "POST",
    headers: config.SITE_BUILD_HOOK_TOKEN ? { Authorization: `Bearer ${config.SITE_BUILD_HOOK_TOKEN}` } : {},
  });
  if (!res.ok) throw new Error(`site build hook returned HTTP ${res.status}`);
  return "sent";
}

const PUBLISH_LOCK = 727276;

/**
 * Fires one build when the site has been dirty and quiet for DEBOUNCE_MS. Returns whether it fired.
 * Nothing is acknowledged until the hook succeeds: the check, the hook call and the acknowledgement run in one
 * transaction, so a failed hook or a crash mid-way leaves the site dirty and the next tick retries.
 */
export async function runPublishTick(db: Db, config: Config, now = new Date(), trigger: Trigger = triggerSiteBuild): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const got = await sql<{ ok: boolean }>`select pg_try_advisory_xact_lock(${PUBLISH_LOCK}) as ok`.execute(trx);
    if (!got.rows[0]?.ok) return false; // another tick or publishNow is dispatching
    const st = await trx.selectFrom("site_state").select(["dirty", "change_seq", "last_change_at"]).executeTakeFirstOrThrow();
    if (!st.dirty || !st.last_change_at || st.last_change_at.getTime() > now.getTime() - DEBOUNCE_MS) return false;
    await trigger(config);
    await trx.updateTable("site_state").set({
      last_build_requested_at: now, last_published_at: st.last_change_at,
      dirty: sql`case when change_seq = ${st.change_seq} then false else dirty end`, // keep changes made during the hook
    }).execute();
    return true;
  });
}

export async function publishNow(db: Db, config: Config, now = new Date(), trigger: Trigger = triggerSiteBuild): Promise<"sent" | "skipped"> {
  return db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(${PUBLISH_LOCK})`.execute(trx); // wait for a running tick
    const { change_seq: seqBefore } = await trx.selectFrom("site_state").select("change_seq").executeTakeFirstOrThrow();
    const result = await trigger(config); // on failure the transaction rolls back: still dirty, nothing marked published
    await trx.updateTable("site_state").set({
      last_build_requested_at: now, last_published_at: now,
      // only clear "dirty" if no change was recorded while the hook ran (timestamps can't tell: they are transaction starts)
      dirty: sql`case when change_seq = ${seqBefore} then false else dirty end`,
    }).execute();
    return result;
  });
}
