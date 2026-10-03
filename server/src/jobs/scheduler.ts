import type { Config } from "../config";
import type { Db } from "../db/client";
import { runPublishTick } from "../publish/trigger";
import { checkMissedRun, resendMailer } from "./missed-run";

export interface SchedulerJobs {
  publishTick: () => Promise<unknown>;
  missedRun: () => Promise<string>;
}

/** Runs each job on its own loop, so a failing or slow job (e.g. a dead build hook) never blocks the others. */
export function startScheduler(db: Db, config: Config, intervalMs = 30_000, jobs?: SchedulerJobs): () => void {
  const mailer = resendMailer(config);
  const j: SchedulerJobs = jobs ?? {
    publishTick: () => runPublishTick(db, config),
    missedRun: () => checkMissedRun(db, mailer),
  };
  const loops = [
    every("publish", intervalMs, j.publishTick),
    every("missed-run", intervalMs, async () => {
      if ((await j.missedRun()) === "no-mailer") {
        console.warn(JSON.stringify({ level: "warn", msg: "no Grok submission today and no alert email configured" }));
      }
    }),
  ];
  return () => loops.forEach((stop) => stop());
}

function every(job: string, intervalMs: number, run: () => Promise<unknown>): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    run()
      .catch((e) => console.error(JSON.stringify({ t: new Date().toISOString(), level: "error", msg: "scheduler", job, error: (e as Error).name })))
      .finally(() => { running = false; });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
