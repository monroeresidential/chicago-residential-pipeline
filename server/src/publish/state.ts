import { sql } from "kysely";
import type { Db } from "../db/client";

export interface PublicScope { projectIds?: string[]; filingIds?: number[] }

/** True when any published, non-deleted project in scope (directly or through a linked filing) exists. */
export async function affectsPublic(q: Db, scope: PublicScope): Promise<boolean> {
  const projectIds = scope.projectIds ?? [];
  const filingIds = scope.filingIds ?? [];
  if (!projectIds.length && !filingIds.length) return false;
  const row = await q.selectFrom("projects").select("id")
    .where("visibility", "=", "published").where("deleted_at", "is", null)
    .where((eb) => eb.or([
      ...(projectIds.length ? [eb("id", "in", projectIds)] : []),
      ...(filingIds.length ? [eb("id", "in", eb.selectFrom("project_filings").select("project_id").where("filing_id", "in", filingIds))] : []),
    ]))
    .limit(1).executeTakeFirst();
  return Boolean(row);
}

export async function markDirty(q: Db): Promise<void> {
  await sql`update site_state set dirty = true, last_change_at = now()`.execute(q);
}

export async function markChanged(q: Db, scope: PublicScope): Promise<void> {
  if (await affectsPublic(q, scope)) await markDirty(q);
}

/** Runs fn and marks the site dirty if the scope touched public data before or after (covers publish, unpublish, delete). */
export async function trackPublic<T>(q: Db, scope: PublicScope, fn: () => Promise<T>): Promise<T> {
  const before = await affectsPublic(q, scope);
  const result = await fn();
  if (before || (await affectsPublic(q, scope))) await markDirty(q);
  return result;
}
