import { describe, expect, it } from "vitest";
import { loadProjects } from "../../src/lib/load-projects";
import { countByStatus, totals } from "../../src/lib/stats";

describe("data/projects.csv", () => {
  const projects = loadProjects();

  it("has all 28 projects and valid rows", () => {
    expect(projects).toHaveLength(28);
  });

  it("matches the expected totals", () => {
    expect(totals(projects)).toEqual({ count: 28, units: 4269, tpcMusd: 1839.8 });
    const dpd = projects.filter((p) => p.confidence === "dpd");
    expect(totals(dpd)).toEqual({ count: 25, units: 3935, tpcMusd: 1799.8 });
  });

  it("has DPD map numbers 1–25 exactly once", () => {
    const nums = projects.map((p) => p.dpd_map_no).filter((n) => n !== null).sort((a, b) => a! - b!);
    expect(nums).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it("matches the agreed stage assignment", () => {
    expect(countByStatus(projects)).toEqual({
      completed: 2, under_construction: 7, permitted: 5, approved: 9, planning: 5,
    });
  });

  it("marks the six LaSalle projects and three Monroe projects", () => {
    expect(projects.filter((p) => p.program === "lasalle").map((p) => p.dpd_map_no)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(projects.filter((p) => p.monroe_url).map((p) => p.id)).toEqual(["116-122-w-illinois", "401-w-ontario", "620-n-lasalle"]);
  });
});

describe("owner-confirmed figures", () => {
  it("shows Birken Lofts at 57 units (confirmed by Monroe), noting DPD's 88", () => {
    const birken = loadProjects().find((p) => p.id === "401-w-ontario")!;
    expect(birken.units).toBe(57);
    expect(birken.notes).toMatch(/88/);
  });
});

describe("620 N LaSalle", () => {
  it("is a 90-unit Monroe project in zoning review", () => {
    const p = loadProjects().find((x) => x.id === "620-n-lasalle")!;
    expect(p).toMatchObject({ units: 90, status: "planning", confidence: "reported", program: "private" });
    expect(p.developer).toBe("Monroe Residential Partners");
    expect(p.monroe_url).not.toBeNull();
  });
});
