import { sql } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";
import { normalizeRecord } from "../../shared/records/normalize-record";
import { permitRecord, zoningRecord } from "../../shared/tests/fixtures";
import { withActor } from "../src/db/actor";
import { markChanged, trackPublic } from "../src/publish/state";
import { linkFiling, setFilingDeleted, unlinkFiling, updateFilingRecord } from "../src/store/edit";
import { loadFilingRecord, writeFiling } from "../src/store/filings";
import { createProjectRow, setProjectDeleted, updateProjectRow, type ProjectCreate } from "../src/store/projects";
import { getTestDb, resetDb } from "./helpers/db";

const db = getTestDb();
beforeEach(() => resetDb(db));
const drew = <T>(fn: (q: typeof db) => Promise<T>) => withActor(db, "drew", "admin_edit", fn);

const project = (over: Partial<ProjectCreate> = {}): ProjectCreate => ({
  id: "111-w-monroe", name: "Harris Bank building", address: "111 W. Monroe St", program: "lasalle", status: "approved",
  status_note: "Approved", confidence: "dpd", lat: 41.880635, lng: -87.631098,
  sources: ["https://www.chicago.gov/content/city/en/sites/lasalle-street/proposals.html"], visibility: "published",
  ...over,
});
const dirty = async () => (await db.selectFrom("site_state").select("dirty").executeTakeFirstOrThrow()).dirty;
const point = (id: string) => sql<{ lat: number; lng: number }>`select ST_Y(point::geometry) as lat, ST_X(point::geometry) as lng from projects where id = ${id}`.execute(db).then((r) => r.rows[0]);

describe("projects", () => {
  it("creates a project with its canonical address and history", async () => {
    await drew((q) => createProjectRow(q, project()));
    const row = await db.selectFrom("projects").selectAll().executeTakeFirstOrThrow();
    expect(row).toMatchObject({ id: "111-w-monroe", tpc_usd: null, visibility: "published" });
    const addr = await db.selectFrom("project_addresses").innerJoin("addresses", "addresses.id", "project_addresses.address_id").select(["street_name", "suffix"]).executeTakeFirstOrThrow();
    expect(addr).toEqual({ street_name: "MONROE", suffix: "ST" });
    const rev = await db.selectFrom("revisions").select(["actor", "reason"]).where("table_name", "=", "projects").executeTakeFirstOrThrow();
    expect(rev).toEqual({ actor: "drew", reason: "admin_edit" });
  });

  it("stores TPC in dollars", async () => {
    await drew((q) => createProjectRow(q, project({ tpc_musd: 6.5 })));
    expect((await db.selectFrom("projects").select("tpc_usd").executeTakeFirstOrThrow()).tpc_usd).toBe(6_500_000);
  });

  it("rejects an unknown street (422) and a duplicate id (409)", async () => {
    await expect(drew((q) => createProjectRow(q, project({ address: "12 Gotham Blvd" })))).rejects.toMatchObject({ status: 422 });
    await drew((q) => createProjectRow(q, project()));
    await expect(drew((q) => createProjectRow(q, project()))).rejects.toMatchObject({ status: 409 });
  });

  it("updates fields, the primary address, and one coordinate at a time", async () => {
    await drew((q) => createProjectRow(q, project()));
    await drew((q) => updateProjectRow(q, "111-w-monroe", { name: "Renamed", address: "79 W Monroe St", lat: 41.8807 }));
    const row = await db.selectFrom("projects").select(["name"]).executeTakeFirstOrThrow();
    expect(row.name).toBe("Renamed");
    expect(await point("111-w-monroe")).toEqual({ lat: 41.8807, lng: -87.631098 });
    const addrs = await db.selectFrom("project_addresses").innerJoin("addresses", "addresses.id", "project_addresses.address_id").select(["number_from"]).execute();
    expect(addrs).toEqual([{ number_from: 79 }]);
  });

  it("404s edits to missing or deleted projects, and restores", async () => {
    await expect(drew((q) => updateProjectRow(q, "nope", { name: "x" }))).rejects.toMatchObject({ status: 404 });
    await drew((q) => createProjectRow(q, project()));
    await drew((q) => setProjectDeleted(q, "111-w-monroe", true));
    await expect(drew((q) => updateProjectRow(q, "111-w-monroe", { name: "x" }))).rejects.toMatchObject({ status: 404 });
    await drew((q) => setProjectDeleted(q, "111-w-monroe", false));
    await drew((q) => updateProjectRow(q, "111-w-monroe", { name: "back" }));
  });
});

describe("links and filing edits", () => {
  async function setup() {
    return drew(async (q) => {
      await createProjectRow(q, project());
      return writeFiling(q, normalizeRecord(zoningRecord()).record, { sourceHash: "grok-hash" });
    });
  }

  it("links and unlinks with history", async () => {
    const f = await setup();
    await drew((q) => linkFiling(q, "111-w-monroe", f, "drew", "manual"));
    expect(await db.selectFrom("project_filings").select(["role", "reason"]).execute()).toEqual([{ role: "zoning", reason: "manual" }]);
    await drew((q) => unlinkFiling(q, "111-w-monroe", f));
    const ops = await db.selectFrom("revisions").select("op").where("table_name", "=", "project_filings").orderBy("id").execute();
    expect(ops.map((o) => o.op)).toEqual(["insert", "delete"]);
  });

  it("refuses links to deleted projects or filings", async () => {
    const f = await setup();
    await drew((q) => setFilingDeleted(q, f, true));
    await expect(drew((q) => linkFiling(q, "111-w-monroe", f, "drew", "x"))).rejects.toMatchObject({ status: 404 });
  });

  it("edits a filing through the normalizers and keeps Grok's source hash", async () => {
    const f = await setup();
    await drew((q) => updateFilingRecord(q, f, { status: "Final - Passed (2026-06-17)", applicant: "Example Owner, LLC" }));
    const rec = await loadFilingRecord(db, f);
    expect(rec.status).toBe("Final - Passed (2026-06-17)");
    expect((await db.selectFrom("filings").select("last_source_hash").executeTakeFirstOrThrow()).last_source_hash).toBe("grok-hash");
  });

  it("rejects filing edits that fail validation or normalization", async () => {
    const f = await setup();
    await expect(drew((q) => updateFilingRecord(q, f, { ward: "42" }))).rejects.toMatchObject({ status: 422 });
    await expect(drew((q) => updateFilingRecord(q, f, { address: "12 Gotham Blvd" }))).rejects.toMatchObject({ status: 422 });
    await expect(drew((q) => updateFilingRecord(q, f, { kind: "permit" }))).rejects.toMatchObject({ status: 422 });
  });
});

describe("link roles and unit sources", () => {
  it("a permit reclassified from early signal to qualifying updates its link role", async () => {
    const f = await drew(async (q) => {
      await createProjectRow(q, project());
      const id = await writeFiling(q, normalizeRecord(permitRecord({ classification: "early_signal" })).record, { sourceHash: null });
      await linkFiling(q, "111-w-monroe", id, "drew", "manual");
      return id;
    });
    await drew((q) => updateFilingRecord(q, f, { classification: "qualifying_20plus" }));
    expect((await db.selectFrom("project_filings").select("role").executeTakeFirstOrThrow()).role).toBe("permit");
  });

  it("records which filing a project's unit count came from, and rejects unknown filings", async () => {
    const f = await drew(async (q) => {
      await createProjectRow(q, project());
      return writeFiling(q, normalizeRecord(zoningRecord()).record, { sourceHash: null });
    });
    await drew((q) => updateProjectRow(q, "111-w-monroe", { units: 345, units_source_filing_id: f }));
    expect((await db.selectFrom("projects").select("units_source_filing_id").executeTakeFirstOrThrow()).units_source_filing_id).toBe(f);
    await expect(drew((q) => updateProjectRow(q, "111-w-monroe", { units_source_filing_id: 9999 }))).rejects.toMatchObject({ status: 422 });
    await drew((q) => updateProjectRow(q, "111-w-monroe", { units_source_filing_id: null }));
    expect((await db.selectFrom("projects").select("units_source_filing_id").executeTakeFirstOrThrow()).units_source_filing_id).toBeNull();
  });
});

describe("publish-affecting changes", () => {
  it("marks the site dirty only for published projects", async () => {
    await drew(async (q) => {
      await createProjectRow(q, project({ id: "draft-one", visibility: "draft" }));
      await markChanged(q, { projectIds: ["draft-one"] });
    });
    expect(await dirty()).toBe(false);
    await drew((q) => trackPublic(q, { projectIds: ["draft-one"] }, () => updateProjectRow(q, "draft-one", { visibility: "published" })));
    expect(await dirty()).toBe(true);
  });

  it("counts unpublishing and deleting as public changes", async () => {
    await drew((q) => createProjectRow(q, project()));
    await sql`update site_state set dirty = false`.execute(db);
    await drew((q) => trackPublic(q, { projectIds: ["111-w-monroe"] }, () => setProjectDeleted(q, "111-w-monroe", true)));
    expect(await dirty()).toBe(true);
  });
});
