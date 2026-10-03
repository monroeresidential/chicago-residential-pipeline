import { beforeEach, describe, expect, it } from "vitest";
import { diffRecords } from "../../shared/records/diff";
import { contentHash } from "../../shared/records/hash";
import { normalizeRecord } from "../../shared/records/normalize-record";
import { ALL_FIXTURES, permitRecord, zbaRecord, zoningRecord } from "../../shared/tests/fixtures";
import { withActor } from "../src/db/actor";
import { loadFilingRecord, writeFiling } from "../src/store/filings";
import { resolveAliases, upsertOrganization } from "../src/store/shared-values";
import { getTestDb, resetDb } from "./helpers/db";

const db = getTestDb();
beforeEach(() => resetDb(db));
const write = (rec: ReturnType<typeof permitRecord>) =>
  withActor(db, "test", "test", (q) => writeFiling(q, normalizeRecord(rec).record, { sourceHash: "h" }));

describe("writeFiling / loadFilingRecord", () => {
  it.each(ALL_FIXTURES.map((f) => [f().kind, f]))("%s round-trips with the same hash and no diff", async (_k, f) => {
    const record = normalizeRecord(f()).record;
    const id = await withActor(db, "test", "test", (q) => writeFiling(q, record, { sourceHash: "h" }));
    const loaded = await loadFilingRecord(db, id);
    expect(contentHash(loaded)).toBe(contentHash(record));
    expect(diffRecords(record, loaded)).toEqual({});
    const row = await db.selectFrom("filings").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
    expect(row.content_hash).toBe(contentHash(record));
    expect(row.last_source_hash).toBe("h");
  });

  it("same address in two spellings is one row", async () => {
    await write(permitRecord({ address: "111 W. Monroe Street" }));
    await write(zbaRecord({ address: "111 WEST MONROE ST", zip: "60603" }));
    const rows = await db.selectFrom("addresses").selectAll().where("street_name", "=", "MONROE").execute();
    expect(rows).toHaveLength(1);
  });

  it("keeps the first ZIP and point for an address", async () => {
    await write(permitRecord({ zip: "60603", lat: 41.8806, lon: -87.6311 }));
    await write(permitRecord({ permit_number: "100999999", zip: "60602", lat: 41.9, lon: -87.7 }));
    const row = await db.selectFrom("addresses").select(["zip"]).executeTakeFirstOrThrow();
    expect(row.zip).toBe("60603");
    const loaded = await loadFilingRecord(db, 2);
    expect(loaded.point).toEqual({ lat: 41.8806, lon: -87.6311 });
  });

  it("keeps an old record number as a non-current identifier after renumbering", async () => {
    const id = await write(zoningRecord({ record_number: "SO2026-0023894" }));
    await write(zoningRecord({ record_number: "O2026-0023894" }));
    const loaded = await loadFilingRecord(db, id);
    expect(loaded.identifiers.filter((i) => i.type === "record_number").map((i) => i.value)).toEqual(["O2026-0023894"]);
    const all = await db.selectFrom("filing_identifiers").innerJoin("identifiers", "identifiers.id", "filing_identifiers.identifier_id")
      .select(["identifiers.value", "filing_identifiers.current"]).where("identifiers.type", "=", "record_number").orderBy("identifiers.value").execute();
    expect(all).toEqual([{ value: "O2026-0023894", current: true }, { value: "SO2026-0023894", current: false }]);
  });

  it("restores a soft-deleted filing when it is written again", async () => {
    const id = await write(permitRecord());
    await withActor(db, "test", "test", (q) => q.updateTable("filings").set({ deleted_at: new Date() }).where("id", "=", id).execute());
    await write(permitRecord());
    const row = await db.selectFrom("filings").select("deleted_at").where("id", "=", id).executeTakeFirstOrThrow();
    expect(row.deleted_at).toBeNull();
  });

  it("writes history for the filing and its join rows", async () => {
    await write(permitRecord());
    const tables = await db.selectFrom("revisions").select("table_name").distinct().execute();
    expect(tables.map((t) => t.table_name).sort()).toEqual(expect.arrayContaining(["filing_addresses", "filing_identifiers", "filings", "parcels"]));
  });
});

describe("resolveAliases", () => {
  it("replaces a merged organization spelling with the survivor", async () => {
    await withActor(db, "test", "test", async (q) => {
      const keep = await upsertOrganization(q, "4645 NORTH CLARK LLC", "4645 North Clark, LLC");
      const typo = await upsertOrganization(q, "4645 N0RTH CLARK LLC", "4645 N0RTH CLARK LLC");
      await q.updateTable("organizations").set({ merged_into_id: keep, deleted_at: new Date() }).where("id", "=", typo).execute();
    });
    const record = normalizeRecord(zbaRecord({ applicant: "4645 N0RTH CLARK LLC" })).record;
    const resolved = await resolveAliases(db, record);
    expect(resolved.organizations.find((o) => o.role === "applicant")?.name_key).toBe("4645 NORTH CLARK LLC");
  });
});
