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

/** Fires one build when the site has been dirty and quiet for DEBOUNCE_MS. Returns whether it fired. */
export async function runPublishTick(db: Db, config: Config, now = new Date(), trigger: Trigger = triggerSiteBuild): Promise<boolean> {
  const claimed = await db.updateTable("site_state")
    .set({ dirty: false, last_build_requested_at: now, last_published_at: sql`last_change_at` })
    .where("dirty", "=", true).where("last_change_at", "<=", new Date(now.getTime() - DEBOUNCE_MS))
    .returning("id").executeTakeFirst();
  if (!claimed) return false;
  try {
    await trigger(config);
  } catch (e) {
    await db.updateTable("site_state").set({ dirty: true }).execute();
    throw e;
  }
  return true;
}

export async function publishNow(db: Db, config: Config, now = new Date(), trigger: Trigger = triggerSiteBuild): Promise<"sent" | "skipped"> {
  const { change_seq: seqBefore } = await db.selectFrom("site_state").select("change_seq").executeTakeFirstOrThrow();
  const result = await trigger(config); // on failure nothing changes: the site stays dirty and the scheduler retries
  await db.updateTable("site_state").set({
    last_build_requested_at: now, last_published_at: now,
    // only clear "dirty" if no change was recorded while the hook ran (timestamps can't tell: they are transaction starts)
    dirty: sql`case when change_seq = ${seqBefore} then false else dirty end`,
  }).execute();
  return result;
}
