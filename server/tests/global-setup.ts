import pg from "pg";
import { migrate } from "../src/db/migrate";
import { MIGRATIONS_DIR, TEST_DATABASE_URL } from "./helpers/db";

// Recreate the test schema once per run, then apply every migration.
export default async function setup() {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  for (let attempt = 0; ; attempt++) {
    try { await client.connect(); break; } catch (e) {
      if (attempt >= 30) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await client.query("drop schema if exists public cascade; create schema public;");
  await client.end();
  await migrate(TEST_DATABASE_URL, MIGRATIONS_DIR);
}
