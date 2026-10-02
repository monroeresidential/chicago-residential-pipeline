import { beforeEach, describe, expect, it } from "vitest";
import { normalizeRecord } from "../../shared/records/normalize-record";
import { permitRecord, zbaRecord, zoningRecord } from "../../shared/tests/fixtures";
import type { WireRecord } from "../../shared/records/types";
import { withActor } from "../src/db/actor";
import { writeFiling } from "../src/store/filings";
import { makeApp, postJson } from "./helpers/app";

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => { ctx = await makeApp(); });

const envelope = (records: unknown[], runId = "zoning-2026-10-02") => ({
  run: { program: "zoning", run_id: runId, started_at: "2026-10-02T12:39:00Z", bot_version: "test" },
  records,
});
let keyN = 0;
const submit = (records: unknown[], opts: { token?: string; key?: string; query?: string } = {}) =>
  postJson(ctx.app, `/v1/submissions${opts.query ?? ""}`, envelope(records), opts.token ?? ctx.grok, { "Idempotency-Key": opts.key ?? `k-${++keyN}` });
const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as any });
const pending = () => ctx.db.selectFrom("queue_items").selectAll().where("state", "=", "pending").execute();

describe("POST /v1/submissions", () => {
  it("queues new records and reports per-record outcomes", async () => {
    const { status, body } = await json(await submit([permitRecord(), zbaRecord()]));
    expect(status).toBe(202);
    expect(body.results.map((r: any) => r.outcome)).toEqual(["queued_create", "queued_create"]);
    expect((await pending()).length).toBe(2);
  });

  it("returns no_change for an identical re-send under a new key", async () => {
    await submit([permitRecord()]);
    const { body } = await json(await submit([permitRecord({ address: "111 WEST MONROE ST" })]));
    expect(body.results[0].outcome).toBe("no_change");
    expect((await pending()).length).toBe(1);
  });

  it("supersedes the pending item when a changed version arrives", async () => {
    await submit([zoningRecord()]);
    const { body } = await json(await submit([zoningRecord({ status: "Final - Passed (2026-06-17)" })]));
    expect(body.results[0]).toMatchObject({ outcome: "queued_create" });
    const states = await ctx.db.selectFrom("queue_items").select("state").orderBy("id").execute();
    expect(states.map((s) => s.state)).toEqual(["superseded", "pending"]);
  });

  it("queues an update with the changed field names for an accepted filing", async () => {
    await withActor(ctx.db, "test", "test", (q) => writeFiling(q, normalizeRecord(zoningRecord()).record, { sourceHash: null }));
    const { body } = await json(await submit([zoningRecord({ status: "Final - Passed (2026-06-17)" })]));
    expect(body.results[0]).toMatchObject({ outcome: "queued_update", changed: ["status"] });
  });

  it("same key twice in one submission: only the last stays pending", async () => {
    const { body } = await json(await submit([zoningRecord(), zoningRecord({ units: 400 })]));
    expect(body.results.map((r: any) => r.outcome)).toEqual(["queued_create", "queued_create"]);
    const rows = await ctx.db.selectFrom("queue_items").select(["state", "record_index"]).orderBy("id").execute();
    expect(rows).toEqual([{ state: "superseded", record_index: 0 }, { state: "pending", record_index: 1 }]);
  });

  it("deleted filing resent unchanged is no_change", async () => {
    const rec = normalizeRecord(permitRecord()).record;
    await withActor(ctx.db, "test", "test", async (q) => {
      const id = await writeFiling(q, rec, { sourceHash: null });
      await q.updateTable("filings").set({ deleted_at: new Date() }).where("id", "=", id).execute();
    });
    expect((await json(await submit([permitRecord()]))).body.results[0].outcome).toBe("no_change");
  });

  it("deleted filing resent changed is queued_create", async () => {
    await withActor(ctx.db, "test", "test", async (q) => {
      const id = await writeFiling(q, normalizeRecord(permitRecord()).record, { sourceHash: null });
      await q.updateTable("filings").set({ deleted_at: new Date() }).where("id", "=", id).execute();
    });
    expect((await json(await submit([permitRecord({ permit_status: "COMPLETE" })]))).body.results[0].outcome).toBe("queued_create");
  });

  it("reports invalid records and still queues the valid ones", async () => {
    const bad = permitRecord({ issue_date: "10/01/2026", ward: "42" });
    const { status, body } = await json(await submit([bad, zbaRecord()]));
    expect(status).toBe(202);
    expect(body.results[0].outcome).toBe("invalid");
    expect([...new Set(body.results[0].errors.map((e: any) => e.path))].sort()).toEqual(["data.issue_date", "data.ward"]);
    expect(body.results[1].outcome).toBe("queued_create");
  });

  it("rejects a source_key that disagrees with the record", async () => {
    const r: WireRecord = { ...zbaRecord(), source_key: "999-99-Z" };
    const { body } = await json(await submit([r]));
    expect(body.results[0]).toMatchObject({ outcome: "invalid", errors: [expect.objectContaining({ path: "source_key" })] });
  });

  it("queues records with blocking normalization issues and flags them", async () => {
    await submit([zbaRecord({ address: "12 Gotham Blvd" })]);
    const [item] = await pending();
    expect(item!.has_blocking_issues).toBe(true);
    expect((item!.normalization_issues as any[])[0]).toMatchObject({ field: "address", raw: "12 Gotham Blvd" });
  });

  it("is idempotent: same key and body returns the stored response; different body is 409", async () => {
    const first = await json(await submit([permitRecord()], { key: "same" }));
    const again = await json(await submit([permitRecord()], { key: "same" }));
    expect(again).toEqual(first);
    expect((await ctx.db.selectFrom("submissions").select("id").execute()).length).toBe(1);
    expect((await submit([zbaRecord()], { key: "same" })).status).toBe(409);
  });

  it("dry run reports outcomes and writes nothing", async () => {
    const { status, body } = await json(await submit([permitRecord()], { query: "?dry_run=true" }));
    expect(status).toBe(202);
    expect(body).toMatchObject({ submission_id: null, dry_run: true, results: [{ outcome: "queued_create" }] });
    expect((await ctx.db.selectFrom("submissions").select("id").execute()).length).toBe(0);
    expect((await pending()).length).toBe(0);
  });

  it("enforces envelope, size, header and auth rules", async () => {
    expect((await postJson(ctx.app, "/v1/submissions", "{nope", ctx.grok, { "Idempotency-Key": "a" })).status).toBe(400);
    expect((await postJson(ctx.app, "/v1/submissions", { records: [] }, ctx.grok, { "Idempotency-Key": "b" })).status).toBe(400);
    expect((await postJson(ctx.app, "/v1/submissions", envelope([]), ctx.grok)).status).toBe(400);
    expect((await submit(Array.from({ length: 501 }, () => permitRecord()))).status).toBe(413);
    expect((await postJson(ctx.app, "/v1/submissions", envelope([]), undefined, { "Idempotency-Key": "c" })).status).toBe(401);
    expect((await submit([permitRecord()], { token: ctx.drew })).status).toBe(202);
  });

  it("stores suggestions and the display address on the queue item", async () => {
    await submit([permitRecord()]);
    const [item] = await pending();
    expect(item!.address_display).toBe("111 W. Monroe St");
    expect(item!.suggestions).toEqual({ projects: [], duplicates: [] });
  });
});

describe("GET /v1/schema/submission.json", () => {
  it("serves the JSON Schema publicly", async () => {
    const r = await ctx.app.request("/v1/schema/submission.json");
    expect(r.status).toBe(200);
    expect(JSON.stringify(await r.json())).toContain("zba_case");
  });
});
