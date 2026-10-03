import { sql } from "kysely";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { chicagoParts } from "../time";

export const MISSED_RUN_MINUTES = 9 * 60 + 30;
const CLAIM_STALE_MS = 10 * 60 * 1000;
export type Mailer = (subject: string, text: string, idempotencyKey: string) => Promise<void>;

export function resendMailer(config: Config, fetchFn: typeof fetch = fetch): Mailer | null {
  if (!config.RESEND_API_KEY || !config.ALERT_FROM || !config.ALERT_TO) return null;
  return async (subject, text, idempotencyKey) => {
    const res = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      // Resend drops a repeat with the same key (24 h), so a retry after a lost response never sends twice
      headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ from: config.ALERT_FROM, to: [config.ALERT_TO], subject, text }),
    });
    if (!res.ok) throw new Error(`Resend returned HTTP ${res.status}`);
  };
}

/** After 9:30 CT, emails once per day if no submitter token has posted since midnight CT. */
export async function checkMissedRun(db: Db, mailer: Mailer | null, now = new Date()) {
  const { date, minutes } = chicagoParts(now);
  if (minutes < MISSED_RUN_MINUTES) return "too-early" as const;
  const got = await sql`select 1 from submissions s join tokens t on t.jti = s.token_jti
    where t.role = 'submitter' and (s.received_at at time zone 'America/Chicago')::date = ${date}::date limit 1`.execute(db);
  if (got.rows.length) return "ok" as const;
  if (!mailer) return "no-mailer" as const;
  const name = "missed-run-alert";
  // Claim the day: insert, or take over a 'sending' claim older than CLAIM_STALE_MS (the sender crashed mid-send).
  const claimed = await sql<{ name: string }>`
    insert into job_runs (name, run_date, status, at) values (${name}, ${date}::date, 'sending', ${now})
    on conflict (name, run_date) do update set status = 'sending', at = excluded.at
      where job_runs.status = 'sending' and job_runs.at < ${new Date(now.getTime() - CLAIM_STALE_MS)}
    returning name`.execute(db);
  if (!claimed.rows.length) return "already-sent" as const;
  try {
    await mailer(
      `Chicago Pipeline: no Grok submission yet today (${date})`,
      `The API has not received a submission from Grok today (${date}) as of 9:30 am Chicago time.\n` +
      `Grok's daily run is at 7:39 am. Check the bot, then queue_summary in Claude for the last submission time.`,
      `${name}-${date}`,
    );
  } catch (e) {
    await db.deleteFrom("job_runs").where("name", "=", name).where("run_date", "=", date).execute();
    throw e;
  }
  await db.updateTable("job_runs").set({ status: "sent" }).where("name", "=", name).where("run_date", "=", date).execute();
  return "sent" as const;
}
