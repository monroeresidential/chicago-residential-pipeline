import { sql } from "kysely";
import { formatAddressDisplay, normalizeAddress } from "../../../shared/normalize/address";
import { parseProjectsCsv } from "../../../src/lib/parse-projects";
import { withActor } from "../db/actor";
import type { Db } from "../db/client";
import { createProjectRow } from "../store/projects";

/** One-time import of the curated CSV as published projects. All-or-nothing. */
export async function importProjectsCsv(db: Db, csvText: string, asOf: string) {
  const { projects, errors } = parseProjectsCsv(csvText);
  if (errors.length) throw new Error(`data/projects.csv has errors:\n${errors.join("\n")}`);

  const addressChanges: { id: string; from: string; to: string }[] = [];
  const problems: string[] = [];
  for (const p of projects) {
    const a = normalizeAddress(p.address);
    if (!a.ok) { problems.push(`${p.id}: ${a.message}`); continue; }
    const display = formatAddressDisplay(a.value);
    if (display !== p.address) addressChanges.push({ id: p.id, from: p.address, to: display });
  }
  if (problems.length) throw new Error(`addresses that could not be normalized:\n${problems.join("\n")}`);

  await withActor(db, "import", "import:data/projects.csv", async (q) => {
    const existing = await q.selectFrom("projects").select("id").limit(1).executeTakeFirst();
    if (existing) throw new Error("projects are already imported; edit them through the API instead");
    for (const p of projects) await createProjectRow(q, { ...p, visibility: "published" });
    await sql`update site_state set last_published_at = ${`${asOf}T12:00:00-05:00`}::timestamptz`.execute(q);
  });
  return { imported: projects.length, addressChanges };
}
