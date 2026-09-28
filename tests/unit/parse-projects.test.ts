import { describe, expect, it } from "vitest";
import { parseProjectsCsv } from "../../src/lib/parse-projects";
import { CSV_HEADER, GOOD_ROW } from "./fixtures";

const csv = (...rows: string[]) => [CSV_HEADER, ...rows].join("\n");

describe("parseProjectsCsv", () => {
  it("parses a valid row into a typed Project", () => {
    const { projects, errors } = parseProjectsCsv(csv(GOOD_ROW));
    expect(errors).toEqual([]);
    expect(projects).toHaveLength(1);
    const p = projects[0]!;
    expect(p.id).toBe("111-w-monroe");
    expect(p.dpd_map_no).toBe(1);
    expect(p.units).toBe(345);
    expect(p.tpc_musd).toBe(179);
    expect(p.public_support).toBe("TIF + LaSalle ($40M)");
    expect(p.flag).toBeNull();
    expect(p.monroe_url).toBeNull();
    expect(p.notes).toBeNull();
    expect(p.sources).toEqual(["https://a.example/one", "https://b.example/two"]);
  });

  it("turns empty optional cells into null", () => {
    const row = GOOD_ROW.replace("Harris Bank building", "").replace(",345,104,179,", ",,,,");
    const { projects, errors } = parseProjectsCsv(csv(row));
    expect(errors).toEqual([]);
    expect(projects[0]!.name).toBeNull();
    expect(projects[0]!.units).toBeNull();
    expect(projects[0]!.tpc_musd).toBeNull();
  });

  it("rejects non-numeric numbers with row and column", () => {
    const row = GOOD_ROW.replace(",345,", ",~345,");
    const { projects, errors } = parseProjectsCsv(csv(row));
    expect(projects).toEqual([]);
    expect(errors).toEqual([expect.stringMatching(/Row 2 \(111-w-monroe\).*units "~345" is not a number/)]);
  });

  it("rejects an unknown status", () => {
    const row = GOOD_ROW.replace(",approved,", ",stalled,");
    const { errors } = parseProjectsCsv(csv(row));
    expect(errors).toEqual([expect.stringMatching(/Row 2 \(111-w-monroe\): status/)]);
  });

  it("rejects missing coordinates", () => {
    const row = GOOD_ROW.replace(",41.8805,-87.6311,", ",,,");
    const { errors } = parseProjectsCsv(csv(row));
    expect(errors.join("\n")).toMatch(/lat/);
    expect(errors.join("\n")).toMatch(/lng/);
  });

  it("rejects coordinates outside downtown Chicago", () => {
    const row = GOOD_ROW.replace(",41.8805,-87.6311,", ",40.7128,-74.0060,");
    const { errors } = parseProjectsCsv(csv(row));
    expect(errors.join("\n")).toMatch(/lat/);
  });

  it("rejects duplicate ids", () => {
    const { projects, errors } = parseProjectsCsv(csv(GOOD_ROW, GOOD_ROW));
    expect(projects).toHaveLength(1);
    expect(errors).toEqual([expect.stringMatching(/Row 3 \(111-w-monroe\): duplicate id/)]);
  });

  it("reports missing columns", () => {
    const { errors } = parseProjectsCsv("id,address\nfoo,1 Main St");
    expect(errors[0]).toMatch(/Missing columns: dpd_map_no/);
  });

  it("rejects non-URL sources", () => {
    const row = GOOD_ROW.replace("https://a.example/one | https://b.example/two", "Crain's");
    const { errors } = parseProjectsCsv(csv(row));
    expect(errors.join("\n")).toMatch(/sources/);
  });
});
