import { beforeEach, describe, expect, it } from "vitest";
import { zbaRecord, zoningRecord } from "../../shared/tests/fixtures";
import { withActor } from "../src/db/actor";
import { approveItem } from "../src/review/review";
import { linkFiling, unlinkFiling } from "../src/store/edit";
import { loadFilingRecord } from "../src/store/filings";
import { listHistory, revertTo } from "../src/store/history";
import { mergeValues } from "../src/store/merge";
import { createProjectRow, updateProjectRow } from "../src/store/projects";
import { makeApp, queueRecords } from "./helpers/app";

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => { ctx = await makeApp(); });
const approveAll = async (records: unknown[]) => {
  const ids = await queueRecords(ctx, records);
  const filings: number[] = [];
  for (const id of ids) filings.push((await approveItem(ctx.db, "drew", id!)).filing_id);
  return filings;
};
const orgId = async (key: string) => (await ctx.db.selectFrom("organizations").select("id").where("name_key", "=", key).executeTakeFirstOrThrow()).id;

describe("merge", () => {
  it("repoints filings to the surviving organization and records merge revisions", async () => {
    const [a, b] = await approveAll([zbaRecord(), zbaRecord({ case_no: "2-26-Z", applicant: "4645 N0RTH CLARK LLC" })]);
    const keep = await orgId("4645 NORTH CLARK LLC");
    const typo = await orgId("4645 N0RTH CLARK LLC");
    const r = await withActor(ctx.db, "drew", `merge:organization:${typo}->${keep}`, (q) => mergeValues(q, "organization", typo, keep));
    expect(r.affected_filings).toBe(1);
    const rec = await loadFilingRecord(ctx.db, b!);
    expect(rec.organizations.find((o) => o.role === "applicant")?.name_key).toBe("4645 NORTH CLARK LLC");
    expect((await ctx.db.selectFrom("organizations").select(["merged_into_id"]).where("id", "=", typo).executeTakeFirstOrThrow()).merged_into_id).toBe(keep);
    const ops = await ctx.db.selectFrom("revisions").select("op").where("reason", "like", "merge:%").execute();
    expect(ops.length).toBeGreaterThan(0);
    expect(new Set(ops.map((o) => o.op))).toEqual(new Set(["merge"]));
    expect(a).toBeDefined();
  });

  it("push with merged spelling is no_change", async () => {
    await approveAll([zbaRecord(), zbaRecord({ case_no: "2-26-Z", applicant: "4645 N0RTH CLARK LLC" })]);
    const keep = await orgId("4645 NORTH CLARK LLC");
    const typo = await orgId("4645 N0RTH CLARK LLC");
    await withActor(ctx.db, "drew", `merge:organization:${typo}->${keep}`, (q) => mergeValues(q, "organization", typo, keep));
    expect(await queueRecords(ctx, [zbaRecord({ case_no: "2-26-Z", applicant: "4645 N0RTH CLARK LLC" })])).toEqual([null]);
  });

  it("merges addresses and keeps resolving the old one", async () => {
    await approveAll([zbaRecord({ address: "3642 W Oakdale Ave" }), zbaRecord({ case_no: "2-26-Z", address: "3640-3650 W Oakdale Ave" })]);
    const rows = await ctx.db.selectFrom("addresses").select(["id", "number_from", "number_to"]).orderBy("id").execute();
    const from = rows.find((r) => r.number_to === 3642)!.id;
    const into = rows.find((r) => r.number_to === 3650)!.id;
    await withActor(ctx.db, "drew", `merge:address:${from}->${into}`, (q) => mergeValues(q, "address", from, into));
    expect(await queueRecords(ctx, [zbaRecord({ address: "3642 W Oakdale Ave" })])).toEqual([null]);
    const f = await ctx.db.selectFrom("filings").select("primary_address_id").where("source_key", "=", "420-24-S").executeTakeFirstOrThrow();
    expect(f.primary_address_id).toBe(into);
  });

  it("a record listing both merged spellings is no_change after the merge", async () => {
    const rec = zoningRecord({ address: "111 W Monroe St", additional_addresses: ["111-123 W Monroe St"] });
    await approveAll([rec]);
    const rows = await ctx.db.selectFrom("addresses").select(["id", "number_to"]).orderBy("id").execute();
    const from = rows.find((r) => r.number_to === 111)!.id;
    const into = rows.find((r) => r.number_to === 123)!.id;
    await withActor(ctx.db, "drew", `merge:address:${from}->${into}`, (q) => mergeValues(q, "address", from, into));
    expect(await queueRecords(ctx, [rec])).toEqual([null]);
  });

  it("an override followed by a merge keeps Grok's original re-send at no_change", async () => {
    await approveAll([zbaRecord()]);
    const [id] = await queueRecords(ctx, [zbaRecord({ case_no: "2-26-Z", applicant: "4645 N0RTH CLARK LLC", units: 40 })]);
    await approveItem(ctx.db, "drew", id!, { overrides: { units: 4 } });
    const keep = await orgId("4645 NORTH CLARK LLC");
    const typo = await orgId("4645 N0RTH CLARK LLC");
    await withActor(ctx.db, "drew", `merge:organization:${typo}->${keep}`, (q) => mergeValues(q, "organization", typo, keep));
    expect(await queueRecords(ctx, [zbaRecord({ case_no: "2-26-Z", applicant: "4645 N0RTH CLARK LLC", units: 40 })])).toEqual([null]);
  });

  it("refuses to merge a row into itself", async () => {
    await approveAll([zbaRecord()]);
    const id = await orgId("4645 NORTH CLARK LLC");
    await expect(withActor(ctx.db, "drew", "merge:x", (q) => mergeValues(q, "organization", id, id))).rejects.toMatchObject({ status: 400 });
  });
});

describe("history and revert", () => {
  const project = { id: "p1", name: "First", address: "111 W Monroe St", program: "private" as const, status: "planning" as const,
    status_note: "n", lat: 41.880635, lng: -87.631098, sources: ["https://example.com/a"], visibility: "published" as const };

  it("lists versions and reverts a project field", async () => {
    await withActor(ctx.db, "drew", "admin_edit", (q) => createProjectRow(q, project));
    await withActor(ctx.db, "drew", "admin_edit", (q) => updateProjectRow(q, "p1", { name: "Second" }));
    const h = await listHistory(ctx.db, "projects", "p1");
    expect(h.map((r) => r.version)).toEqual([1, 2]);
    await withActor(ctx.db, "drew", "revert:projects:p1:1", (q) => revertTo(q, "projects", "p1", 1));
    expect((await ctx.db.selectFrom("projects").select("name").executeTakeFirstOrThrow()).name).toBe("First");
    expect((await listHistory(ctx.db, "projects", "p1")).at(-1)).toMatchObject({ version: 3, reason: "revert:projects:p1:1" });
  });

  it("revert restores a deleted link", async () => {
    const [f] = await approveAll([zbaRecord()]);
    await withActor(ctx.db, "drew", "admin_edit", async (q) => {
      await createProjectRow(q, project);
      await linkFiling(q, "p1", f!, "drew", "manual");
      await unlinkFiling(q, "p1", f!);
    });
    await withActor(ctx.db, "drew", "revert", (q) => revertTo(q, "project_filings", `p1:${f}`, 1));
    expect(await ctx.db.selectFrom("project_filings").select("reason").execute()).toEqual([{ reason: "manual" }]);
  });

  it("revert of a filing restores its columns and refreshes its hash", async () => {
    const [f] = await approveAll([zbaRecord()]);
    const before = (await ctx.db.selectFrom("filings").select("content_hash").executeTakeFirstOrThrow()).content_hash;
    await withActor(ctx.db, "drew", "admin_edit", (q) => q.updateTable("filings").set({ status: "Denied" }).where("id", "=", f!).execute());
    const v = (await listHistory(ctx.db, "filings", String(f))).find((r) => r.op === "insert")!.version;
    await withActor(ctx.db, "drew", "revert", (q) => revertTo(q, "filings", String(f), v));
    const row = await ctx.db.selectFrom("filings").select(["status", "content_hash"]).executeTakeFirstOrThrow();
    expect(row).toEqual({ status: "Approved", content_hash: before });
  });

  it("reverting a filing keeps its address pointers consistent", async () => {
    const [f] = await approveAll([zbaRecord()]);
    const [id] = await queueRecords(ctx, [zbaRecord({ address: "3700 W Oakdale Ave" })]);
    await approveItem(ctx.db, "drew", id!);
    const v1 = (await listHistory(ctx.db, "filings", String(f))).find((r) => r.op === "insert")!.version;
    await withActor(ctx.db, "drew", "revert", (q) => revertTo(q, "filings", String(f), v1));
    const row = await ctx.db.selectFrom("filings").select("primary_address_id").where("id", "=", f!).executeTakeFirstOrThrow();
    const first = await ctx.db.selectFrom("filing_addresses").select("address_id").where("filing_id", "=", f!).where("position", "=", 0).executeTakeFirstOrThrow();
    expect(row.primary_address_id).toBe(first.address_id);
  });

  it("404s an unknown version", async () => {
    await expect(withActor(ctx.db, "drew", "revert", (q) => revertTo(q, "projects", "nope", 1))).rejects.toMatchObject({ status: 404 });
  });
});
