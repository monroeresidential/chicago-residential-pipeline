import type { Config } from "../config";
import type { Db } from "../db/client";
import { runPublishTick } from "../publish/trigger";
import { checkMissedRun, resendMailer } from "./missed-run";

export function startScheduler(db: Db, config: Config, intervalMs = 30_000): () => void {
  const mailer = resendMailer(config);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runPublishTick(db, config);
      const missed = await checkMissedRun(db, mailer);
      if (missed === "no-mailer") console.warn(JSON.stringify({ level: "warn", msg: "no Grok submission today and no alert email configured" }));
    } catch (e) {
      console.error(JSON.stringify({ t: new Date().toISOString(), level: "error", msg: "scheduler", message: (e as Error).message }));
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
