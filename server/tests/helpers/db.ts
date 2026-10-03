import { sql } from "kysely";
import { fileURLToPath } from "node:url";
import { createDb, type Db } from "../../src/db/client";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://pipeline:pipeline@localhost:5433/pipeline_test";
export const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations", import.meta.url));

let shared: Db | undefined;
export function getTestDb(): Db {
  shared ??= createDb(TEST_DATABASE_URL);
  return shared;
}

const DATA_TABLES = [
  "revisions", "bulk_previews", "queue_items", "submissions", "tokens", "project_filings", "project_addresses",
  "filing_organizations", "filing_identifiers", "filing_parcels", "filing_addresses", "projects", "filings",
  "organizations", "identifiers", "addresses", "parcels", "job_runs", "site_state",
];

/** Empties every data table (statement-level, so no history rows) and re-creates the site_state row. */
export async function resetDb(db: Db): Promise<void> {
  await sql.raw(`truncate ${DATA_TABLES.join(", ")} restart identity cascade`).execute(db);
  await sql`insert into site_state default values`.execute(db);
}
