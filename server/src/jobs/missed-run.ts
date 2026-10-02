import { sql } from "kysely";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { chicagoParts } from "../time";

export const MISSED_RUN_MINUTES = 9 * 60 + 30;
export type Mailer = (subject: string, text: string) => Promise<void>;

export function resendMailer(config: Config, fetchFn: typeof fetch = fetch): Mailer | null {
  if (!config.RESEND_API_KEY || !config.ALERT_FROM || !config.ALERT_TO) return null;
  return async (subject, text) => {
    const res = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, "Content-Type": "application/json" },
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
  const claimed = await db.insertInto("job_runs").values({ name: "missed-run-alert", run_date: date })
    .onConflict((oc) => oc.columns(["name", "run_date"]).doNothing()).returning("name").executeTakeFirst();
  if (!claimed) return "already-sent" as const;
  try {
    await mailer(
      `Chicago Pipeline: no Grok submission yet today (${date})`,
      `The API has not received a submission from Grok today (${date}) as of 9:30 am Chicago time.\n` +
      `Grok's daily run is at 7:39 am. Check the bot, then queue_summary in Claude for the last submission time.`,
    );
  } catch (e) {
    await db.deleteFrom("job_runs").where("name", "=", "missed-run-alert").where("run_date", "=", date).execute();
    throw e;
  }
  return "sent" as const;
}
