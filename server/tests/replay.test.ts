import { beforeEach, describe, expect, it } from "vitest";
import { permitRecord, zbaRecord } from "../../shared/tests/fixtures";
import { replaySubmission } from "../src/intake/replay";
import { makeApp, queueRecords } from "./helpers/app";

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => { ctx = await makeApp(); });

describe("replaySubmission", () => {
  it("dry-runs a stored submission and reports outcome changes without writing", async () => {
    await queueRecords(ctx, [permitRecord(), zbaRecord()]);
    const r = await replaySubmission(ctx.db, 1, { write: false });
    expect(r.counts).toEqual({ no_change: 2 });
    expect(r.changed.map((c) => [c.was, c.now])).toEqual([["queued_create", "no_change"], ["queued_create", "no_change"]]);
    expect((await ctx.db.selectFrom("submissions").select("id").execute()).length).toBe(1);
  });

  it("404s an unknown submission", async () => {
    await expect(replaySubmission(ctx.db, 42, { write: false })).rejects.toMatchObject({ status: 404 });
  });
});
