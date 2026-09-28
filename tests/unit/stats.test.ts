import { describe, expect, it } from "vitest";
import { countByStatus, totals } from "../../src/lib/stats";
import { makeProject } from "./fixtures";

describe("stats", () => {
  it("sums units and TPC, treating null as zero", () => {
    const t = totals([
      makeProject({ id: "a", units: 100, tpc_musd: 10.5 }),
      makeProject({ id: "b", units: null, tpc_musd: null }),
      makeProject({ id: "c", units: 50, tpc_musd: 20 }),
    ]);
    expect(t).toEqual({ count: 3, units: 150, tpcMusd: 30.5 });
  });

  it("returns zeros for an empty list", () => {
    expect(totals([])).toEqual({ count: 0, units: 0, tpcMusd: 0 });
  });

  it("counts every status, including zero", () => {
    const c = countByStatus([makeProject({ status: "approved" }), makeProject({ id: "b", status: "approved" })]);
    expect(c).toEqual({ completed: 0, under_construction: 0, permitted: 0, approved: 2, planning: 0 });
  });
});
