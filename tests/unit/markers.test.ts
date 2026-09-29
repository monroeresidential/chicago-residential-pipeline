import { describe, expect, it } from "vitest";
import { markerLabel, markerSize } from "../../src/map/markers";
import { makeProject } from "./fixtures";

describe("markerSize", () => {
  it("scales with the square root of units, with a 16px floor", () => {
    expect(markerSize(null)).toBe(16);
    expect(markerSize(28)).toBe(21);
    expect(markerSize(400)).toBe(36);
    expect(markerSize(100)).toBeLessThan(markerSize(400));
  });
});

describe("markerLabel", () => {
  it("describes the project for screen readers", () => {
    expect(markerLabel(makeProject())).toBe("Harris Bank building, Approved, 345 units");
    expect(markerLabel(makeProject({ name: null, units: null, confidence: "reported" }))).toBe(
      "111 W. Monroe St, Approved, reported — not on DPD map",
    );
  });
});
