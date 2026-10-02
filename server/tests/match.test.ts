import { beforeEach, describe, expect, it } from "vitest";
import { normalizeRecord } from "../../shared/records/normalize-record";
import { permitRecord, zbaRecord, zoningRecord } from "../../shared/tests/fixtures";
import { withActor } from "../src/db/actor";
import { suggestDuplicates } from "../src/match/duplicates";
import { suggestStatusChange } from "../src/match/status";
import { suggestProjects } from "../src/match/suggest";
import { writeFiling } from "../src/store/filings";
import { getTestDb, resetDb } from "./helpers/db";
import { insertProject, linkForTest } from "./helpers/fixtures";

const db = getTestDb();
beforeEach(() => resetDb(db));
const tx = <T>(fn: (q: typeof db) => Promise<T>) => withActor(db, "test", "test", fn);
const norm = (r: ReturnType<typeof permitRecord>) => normalizeRecord(r).record;

// 111 W Monroe is at 41.880635, -87.631098; 0.0003° of latitude ≈ 33 m.
describe("suggestProjects", () => {
  it("strong: a permit citing the ordinance of a linked zoning matter", async () => {
    await tx(async (q) => {
      await insertProject(q, { id: "111-w-monroe", lat: 41.880635, lng: -87.631098 });
      const z = await writeFiling(q, norm(zoningRecord({ address: "200 W Adams St" })), { sourceHash: null });
      await linkForTest(q, "111-w-monroe", z);
    });
    const s = await suggestProjects(db, norm(permitRecord({ address: "300 W Adams St", lat: null, lon: null, pin_list: [] })));
    expect(s).toEqual([expect.objectContaining({ project_id: "111-w-monroe", strength: "strong" })]);
    expect(s[0]!.reasons.join(" ")).toMatch(/O2026-0023894|23020/);
  });

  it("strong: a shared PIN", async () => {
    await tx(async (q) => {
      await insertProject(q, { id: "p", lat: 41.95, lng: -87.7 });
      const f = await writeFiling(q, norm(permitRecord({ address: "200 W Adams St", permit_condition: null })), { sourceHash: null });
      await linkForTest(q, "p", f);
    });
    const s = await suggestProjects(db, norm(permitRecord({ permit_number: "100999999", address: "300 W Adams St", permit_condition: null, lat: null, lon: null })));
    expect(s[0]).toMatchObject({ project_id: "p", strength: "strong" });
    expect(s[0]!.reasons.join(" ")).toContain("17-16-123-004-0000");
  });

  it("likely: an address inside the project's range", async () => {
    await tx((q) => insertProject(q, { id: "111-w-monroe", lat: 41.95, lng: -87.7, address: "111-123 W. Monroe St" }));
    const s = await suggestProjects(db, norm(zbaRecord({ address: "115 W Monroe St", zip: null })));
    expect(s).toEqual([expect.objectContaining({ project_id: "111-w-monroe", strength: "likely" })]);
  });

  it("possible: within 40 m; nothing at 60 m", async () => {
    await tx((q) => insertProject(q, { id: "near", lat: 41.880635, lng: -87.631098 }));
    const at = (lat: number) => norm(permitRecord({ address: "1 N State St", lat, lon: -87.631098, permit_condition: null, pin_list: [] }));
    expect((await suggestProjects(db, at(41.880935)))[0]).toMatchObject({ project_id: "near", strength: "possible" });
    expect(await suggestProjects(db, at(41.881175))).toEqual([]);
  });

  it("an organization alone suggests nothing; with distance it is likely", async () => {
    await tx(async (q) => {
      await insertProject(q, { id: "org", lat: 41.880635, lng: -87.631098 });
      const f = await writeFiling(q, norm(zbaRecord({ address: "4000 W Irving Park Rd", applicant: "Shared Owner LLC" })), { sourceHash: null });
      await linkForTest(q, "org", f);
    });
    const far = norm(zbaRecord({ case_no: "1-26-Z", address: "3642 W Oakdale Ave", applicant: "Shared Owner LLC" }));
    expect(await suggestProjects(db, { ...far, source_key: "1-26-Z" })).toEqual([]);
    const near = { ...far, source_key: "1-26-Z", point: { lat: 41.880735, lon: -87.631098 } };
    expect((await suggestProjects(db, near))[0]).toMatchObject({ project_id: "org", strength: "likely" });
  });

  it("ignores deleted projects", async () => {
    await tx(async (q) => {
      await insertProject(q, { id: "gone", lat: 41.880635, lng: -87.631098 });
      await q.updateTable("projects").set({ deleted_at: new Date() }).execute();
    });
    expect(await suggestProjects(db, norm(permitRecord({ permit_condition: null, pin_list: [] })))).toEqual([]);
  });
});

describe("citations and renumbering", () => {
  it("a removed citation stops matching; a renumbered matter's old number still matches", async () => {
    await tx(async (q) => {
      await insertProject(q, { id: "p", lat: 41.95, lng: -87.7 });
      const f = await writeFiling(q, norm(permitRecord({ address: "200 W Adams St", pin_list: [], lat: null, lon: null })), { sourceHash: null });
      await linkForTest(q, "p", f);
      await writeFiling(q, norm(permitRecord({ address: "200 W Adams St", pin_list: [], lat: null, lon: null, permit_condition: null })), { sourceHash: null });
    });
    const z = norm(zoningRecord({ address: "300 W Adams St", applicant: null, owner: null, attorney: null }));
    expect(await suggestProjects(db, z)).toEqual([]);

    await tx(async (q) => {
      await insertProject(q, { id: "z", lat: 41.96, lng: -87.71 });
      const m = await writeFiling(q, norm(zoningRecord({ record_number: "SO2026-0023894", address: "400 W Adams St", dpd_app_no: null })), { sourceHash: null });
      await linkForTest(q, "z", m);
      await writeFiling(q, norm(zoningRecord({ record_number: "O2026-0023894", address: "400 W Adams St", dpd_app_no: null })), { sourceHash: null });
    });
    const cites = norm(permitRecord({ permit_number: "100777777", address: "500 W Adams St", pin_list: [], lat: null, lon: null, permit_condition: "PER SO2026-0023894", contacts: [] }));
    expect((await suggestProjects(db, cites)).map((x) => [x.project_id, x.strength])).toEqual([["z", "strong"]]);
  });
});

describe("suggestStatusChange", () => {
  it("permit issued moves approved → permitted, never backwards", () => {
    const permit = norm(permitRecord());
    expect(suggestStatusChange("approved", permit)).toMatchObject({ from: "approved", to: "permitted" });
    expect(suggestStatusChange("under_construction", permit)).toBeNull();
  });
  it("passed rezoning moves planning → approved", () => {
    expect(suggestStatusChange("planning", norm(zoningRecord({ status: "Final - Passed (2026-06-17)" })))).toMatchObject({ to: "approved" });
    expect(suggestStatusChange("planning", norm(zoningRecord()))).toBeNull();
  });
  it.each(["Disapproved", "Not Approved", "Final - Failed to Pass", "Denied"])("never treats %j as approval", (status) => {
    expect(suggestStatusChange("planning", norm(zoningRecord({ status })))).toBeNull();
    expect(suggestStatusChange("planning", norm(zbaRecord({ outcome: status })))).toBeNull();
  });

  it("early-signal permits never change status", () => {
    expect(suggestStatusChange("planning", norm(permitRecord({ classification: "early_signal" })))).toBeNull();
  });
});

describe("suggestDuplicates", () => {
  it("flags a near-identical organization name and an overlapping address", async () => {
    await tx((q) => writeFiling(q, norm(zbaRecord({ applicant: "4645 North Clark, LLC", address: "3640-3650 W Oakdale Ave" })), { sourceHash: null }));
    const d = await suggestDuplicates(db, norm(zbaRecord({ case_no: "9-26-Z", applicant: "4645 N0RTH CLARK LLC", address: "3642 W Oakdale Ave" })));
    expect(d).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "organization", value: "4645 N0RTH CLARK LLC", candidates: [expect.objectContaining({ display: "4645 North Clark, LLC" })] }),
      expect.objectContaining({ type: "address", value: "3642 W OAKDALE AVE" }),
    ]));
  });

  it("does not flag exact matches", async () => {
    await tx((q) => writeFiling(q, norm(zbaRecord()), { sourceHash: null }));
    expect(await suggestDuplicates(db, norm(zbaRecord()))).toEqual([]);
  });
});
