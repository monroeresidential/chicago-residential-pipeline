import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { DATA_AS_OF } from "../../src/lib/data-meta";
import { parseProjectsCsv } from "../../src/lib/parse-projects";
import { importProjectsCsv } from "../src/importers/projects-csv";
import { getAsOf, listProjects, projectStats } from "../src/read/public";
import { getTestDb, resetDb } from "./helpers/db";

const db = getTestDb();
beforeEach(() => resetDb(db));
const csv = readFileSync(new URL("../../data/projects.csv", import.meta.url), "utf8");

describe("importProjectsCsv", () => {
  it("round-trips every project and field (address via the canonical form)", async () => {
    const result = await importProjectsCsv(db, csv, DATA_AS_OF);
    expect(result.imported).toBe(29);
    expect(result.addressChanges).toEqual([
      { id: "209-w-jackson", from: "209 W. Jackson St", to: "209 W. Jackson Blvd" },
      { id: "620-n-lasalle", from: "620 N. LaSalle St", to: "620 N. LaSalle Dr" },
    ]);

    const expected = parseProjectsCsv(csv).projects;
    const actual = new Map((await listProjects(db)).map((p) => [p.id, p]));
    expect(actual.size).toBe(29);
    for (const p of expected) {
      const change = result.addressChanges.find((c) => c.id === p.id);
      expect(actual.get(p.id)).toEqual({ ...p, address: change ? change.to : p.address });
    }
  });

  it("reproduces today's totals and as-of date", async () => {
    await importProjectsCsv(db, csv, DATA_AS_OF);
    const projects = await listProjects(db);
    expect(projectStats(projects)).toMatchObject({ count: 29, units: 4321, tpcMusd: 1839.8 });
    expect(projectStats(projects.filter((p) => p.confidence === "dpd"))).toMatchObject({ count: 25, units: 3935, tpcMusd: 1799.8 });
    expect(await getAsOf(db)).toBe(DATA_AS_OF);
  });

  it("refuses to import twice and imports nothing when any row fails", async () => {
    await importProjectsCsv(db, csv, DATA_AS_OF);
    await expect(importProjectsCsv(db, csv, DATA_AS_OF)).rejects.toThrow(/already/);
    await resetDb(db);
    const bad = csv.replace("111 W. Monroe St", "111 Gotham Blvd");
    await expect(importProjectsCsv(db, bad, DATA_AS_OF)).rejects.toThrow(/111-w-monroe/);
    expect((await db.selectFrom("projects").select("id").execute()).length).toBe(0);
  });

  it("records the import in history", async () => {
    await importProjectsCsv(db, csv, DATA_AS_OF);
    const r = await db.selectFrom("revisions").select(["actor", "reason"]).where("table_name", "=", "projects").distinct().execute();
    expect(r).toEqual([{ actor: "import", reason: "import:data/projects.csv" }]);
  });
});
