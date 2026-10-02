import { beforeEach, describe, expect, it } from "vitest";
import { permitRecord, zbaRecord, zoningRecord } from "../../shared/tests/fixtures";
import { sql } from "kysely";
import { withActor } from "../src/db/actor";
import { INTAKE_LOCK } from "../src/db/locks";
import { bulkReview, approveItem, rejectItem } from "../src/review/review";
import { getQueueItem, listQueue, queueSummary } from "../src/review/queue";
import { loadFilingRecord } from "../src/store/filings";
import { makeApp, queueRecords } from "./helpers/app";
import { insertProject } from "./helpers/fixtures";

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => { ctx = await makeApp(); });
const one = async (rec: unknown) => (await queueRecords(ctx, [rec]))[0]!;
const project = (id: string, status: "approved" | "planning" = "approved", visibility: "draft" | "published" = "published") =>
  withActor(ctx.db, "test", "test", (q) => insertProject(q, { id, lat: 41.880635, lng: -87.631098, status, visibility, address: "111-123 W Monroe St" }));
const dirty = async () => (await ctx.db.selectFrom("site_state").select("dirty").executeTakeFirstOrThrow()).dirty;

describe("approve", () => {
  it("writes the filing under the reviewer and the queue item id", async () => {
    const id = await one(permitRecord());
    const r = await approveItem(ctx.db, "drew", id);
    expect(r).toMatchObject({ queue_item_id: id, linked_project_id: null, status_change: null });
    const revs = await ctx.db.selectFrom("revisions").select(["actor", "reason"]).where("table_name", "=", "filings").execute();
    expect(revs).toEqual([{ actor: "drew", reason: `queue_item:${id}` }]);
    expect((await getQueueItem(ctx.db, id)).state).toBe("approved");
  });

  it("links to a project with the matcher's reasons and marks the site dirty", async () => {
    await project("111-w-monroe");
    const id = await one(permitRecord());
    await approveItem(ctx.db, "drew", id, { link_to: "111-w-monroe" });
    const link = await ctx.db.selectFrom("project_filings").select(["role", "reason", "linked_by"]).executeTakeFirstOrThrow();
    expect(link).toMatchObject({ role: "permit", linked_by: "drew" });
    expect(link.reason).toMatch(/^(likely|possible|strong):/);
    expect(await dirty()).toBe(true);
  });

  it("creates a draft project from the filing", async () => {
    // A point inside the site's DOWNTOWN_BBOX (project pins must be downtown).
    const id = await one(zbaRecord({ lat: 41.905, lon: -87.65 }));
    const r = await approveItem(ctx.db, "drew", id, { create_project: { id: "3642-w-oakdale", name: "Oakdale" } });
    expect(r.linked_project_id).toBe("3642-w-oakdale");
    const p = await ctx.db.selectFrom("projects").select(["visibility", "sources", "status"]).executeTakeFirstOrThrow();
    expect(p).toEqual({ visibility: "draft", sources: [zbaRecord().data.source_pdf_url], status: "planning" });
    expect(await dirty()).toBe(false);
  });

  it("blocks approval while values are unnormalized; overrides fix them", async () => {
    const id = await one(zbaRecord({ address: "12 Gotham Blvd" }));
    await expect(approveItem(ctx.db, "drew", id)).rejects.toMatchObject({ status: 422 });
    await approveItem(ctx.db, "drew", id, { overrides: { address: "3642 W. Oakdale Avenue" } });
    const filing = await ctx.db.selectFrom("filings").select("id").executeTakeFirstOrThrow();
    expect((await loadFilingRecord(ctx.db, filing.id)).addresses[0]?.street_name).toBe("OAKDALE");
  });

  it("override then original resend is no_change", async () => {
    const id = await one(zbaRecord({ attorney: "Ximena Castr0" }));
    await approveItem(ctx.db, "drew", id, { overrides: { attorney: "Ximena Castro" } });
    expect(await queueRecords(ctx, [zbaRecord({ attorney: "Ximena Castr0" })])).toEqual([null]);
    expect((await listQueue(ctx.db, {})).total).toBe(0);
  });

  it("accepting the status change moves the project forward", async () => {
    await project("111-w-monroe", "approved");
    const id = await one(permitRecord());
    const r = await approveItem(ctx.db, "drew", id, { link_to: "111-w-monroe", accept_status_change: true });
    expect(r.status_change).toMatchObject({ from: "approved", to: "permitted" });
    const p = await ctx.db.selectFrom("projects").select(["status", "status_note"]).executeTakeFirstOrThrow();
    expect(p.status).toBe("permitted");
    expect(p.status_note).toMatch(/permit 100912345/);
  });

  it("409s on items that are not pending", async () => {
    const id = await one(permitRecord());
    await approveItem(ctx.db, "drew", id);
    await expect(approveItem(ctx.db, "drew", id)).rejects.toMatchObject({ status: 409 });
  });
});

describe("coordination with intake", () => {
  it("an approval waits while a submission holds the intake lock", async () => {
    const id = await one(permitRecord());
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const holder = ctx.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(${INTAKE_LOCK})`.execute(trx);
      await held;
    });
    let done = false;
    const approval = approveItem(ctx.db, "drew", id).then(() => { done = true; });
    try {
      await new Promise((r) => setTimeout(r, 300));
      expect(done).toBe(false);
    } finally {
      release();
      await holder;
      await approval;
    }
    expect(done).toBe(true);
  });
});

describe("reject", () => {
  it("needs a reason, sticks for identical data, reopens for changed data", async () => {
    const id = await one(zoningRecord());
    await expect(rejectItem(ctx.db, "drew", id, " ")).rejects.toMatchObject({ status: 400 });
    await rejectItem(ctx.db, "drew", id, "not residential");
    expect(await queueRecords(ctx, [zoningRecord()])).toEqual([null]);
    expect((await queueRecords(ctx, [zoningRecord({ units: 400 })]))[0]).not.toBeNull();
  });
});

describe("queue listing", () => {
  it("filters and summarizes", async () => {
    await project("111-w-monroe");
    await queueRecords(ctx, [permitRecord(), zbaRecord({ in_target: false }), zbaRecord({ case_no: "1-26-Z", address: "12 Gotham Blvd" })]);
    expect((await listQueue(ctx.db, { in_target: false })).total).toBe(1);
    expect((await listQueue(ctx.db, { has_issues: true })).items.map((i) => i.source_key)).toEqual(["1-26-Z"]);
    expect((await listQueue(ctx.db, { kind: "permit" })).items[0]!.top_suggestion?.project_id).toBe("111-w-monroe");
    const s = await queueSummary(ctx.db);
    expect(s).toMatchObject({ pending: 3, with_blocking_issues: 1, by_kind: { permit: 1, zba_case: 2 } });
  });
});

describe("bulk review", () => {
  it("previews, then executes with a confirm code that works once", async () => {
    await queueRecords(ctx, [zbaRecord(), zbaRecord({ case_no: "2-26-Z" }), zbaRecord({ case_no: "3-26-Z", address: "12 Gotham Blvd" })]);
    const preview = await bulkReview(ctx.db, "drew", { filter: { kind: "zba_case" }, action: "approve" });
    if (!preview.preview) throw new Error("expected a preview");
    expect(preview.count).toBe(2); // the item with blocking issues is excluded
    const result = await bulkReview(ctx.db, "drew", { filter: { kind: "zba_case" }, action: "approve", confirm: preview.confirm });
    expect(result).toMatchObject({ preview: false, approved: 2, skipped: 0, errors: [] });
    await expect(bulkReview(ctx.db, "drew", { filter: { kind: "zba_case" }, action: "approve", confirm: preview.confirm })).rejects.toMatchObject({ status: 400 });
  });

  it("link_strong links only items with exactly one strong suggestion", async () => {
    await project("111-w-monroe");
    const [z] = await queueRecords(ctx, [zoningRecord()]);
    await approveItem(ctx.db, "drew", z!, { link_to: "111-w-monroe" });
    await queueRecords(ctx, [permitRecord(), zbaRecord({ address: "4000 W Irving Park Rd", lat: null, lon: null, applicant: null, owner: null, attorney: null })]);
    const preview = await bulkReview(ctx.db, "drew", { filter: {}, action: "approve", link_strong: true });
    if (!preview.preview) throw new Error("expected a preview");
    await bulkReview(ctx.db, "drew", { filter: {}, action: "approve", link_strong: true, confirm: preview.confirm });
    const links = await ctx.db.selectFrom("project_filings").innerJoin("filings", "filings.id", "project_filings.filing_id").select("filings.kind").execute();
    expect(links.map((l) => l.kind).sort()).toEqual(["permit", "zoning_matter"]);
  });

  it("bulk reject requires a reason", async () => {
    await expect(bulkReview(ctx.db, "drew", { filter: {}, action: "reject" })).rejects.toMatchObject({ status: 400 });
  });
});
