import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { COMMUNITY_AREAS } from "../../shared/data/community-areas";
import { migrate } from "../src/db/migrate";
import { MIGRATIONS_DIR, TEST_DATABASE_URL } from "./helpers/db";

const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
await client.connect();
afterAll(() => client.end());

describe("migrations", () => {
  it("installs postgis, vector and fuzzystrmatch", async () => {
    const { rows } = await client.query("select extname from pg_extension order by extname");
    expect(rows.map((r) => r.extname)).toEqual(expect.arrayContaining(["fuzzystrmatch", "postgis", "vector"]));
  });

  it("seeds the 77 community areas exactly as shared/data lists them", async () => {
    const { rows } = await client.query("select number, name from community_areas order by number");
    expect(rows).toEqual(COMMUNITY_AREAS.map((a) => ({ number: a.number, name: a.name })));
  });

  it("is idempotent", async () => {
    expect(await migrate(TEST_DATABASE_URL, MIGRATIONS_DIR)).toEqual([]);
  });
});
