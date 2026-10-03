import pg from "pg";
import { migrate } from "../src/db/migrate";
import { connectWithRetry } from "./helpers/connect";
import { MIGRATIONS_DIR, TEST_DATABASE_URL } from "./helpers/db";

// Recreate the test schema once per run, then apply every migration.
export default async function setup() {
  const client = await connectWithRetry(() => new pg.Client({ connectionString: TEST_DATABASE_URL }), { attempts: 30, delayMs: 1000 });
  await client.query("drop schema if exists public cascade; create schema public;");
  await client.end();
  await migrate(TEST_DATABASE_URL, MIGRATIONS_DIR);
}
