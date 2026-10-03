import { sql } from "kysely";
import type { Db } from "./client";

/** Runs fn in a transaction whose writes are attributed to `actor` with `reason` (read by the history trigger). */
export function withActor<T>(db: Db, actor: string, reason: string, fn: (q: Db) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.actor', ${actor}, true), set_config('app.reason', ${reason}, true)`.execute(trx);
    return fn(trx);
  });
}
