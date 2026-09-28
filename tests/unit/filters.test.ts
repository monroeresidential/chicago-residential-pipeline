import { describe, expect, it } from "vitest";
import {
  applyFilters, DEFAULT_FILTERS, mergeFilterSearch, parseFilterState, reconcileSelection, serializeFilterState, sortProjects,
} from "../../src/lib/filters";
import { makeProject } from "./fixtures";

const A = makeProject({ id: "a", status: "completed", program: "lasalle", units: 100, tpc_musd: 50 });
const B = makeProject({ id: "b", status: "approved", program: "private", units: 300, tpc_musd: null });
const C = makeProject({ id: "c", status: "planning", program: "private", units: null, tpc_musd: 90 });
const ALL = [A, B, C];
const IDS = ALL.map((p) => p.id);

describe("applyFilters", () => {
  it("keeps everything by default", () => {
    expect(applyFilters(ALL, DEFAULT_FILTERS)).toEqual(ALL);
  });
  it("filters by status and program together", () => {
    expect(applyFilters(ALL, { ...DEFAULT_FILTERS, statuses: ["approved", "planning"], programs: ["private"] })).toEqual([B, C]);
  });
  it("returns nothing when all statuses are unchecked", () => {
    expect(applyFilters(ALL, { ...DEFAULT_FILTERS, statuses: [] })).toEqual([]);
  });
});

describe("sortProjects", () => {
  it("sorts by units descending with nulls last", () => {
    expect(sortProjects(ALL, "units").map((p) => p.id)).toEqual(["b", "a", "c"]);
  });
  it("sorts by TPC descending with nulls last", () => {
    expect(sortProjects(ALL, "tpc").map((p) => p.id)).toEqual(["c", "a", "b"]);
  });
  it("sorts by status pipeline order", () => {
    expect(sortProjects([C, B, A], "status").map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
  it("does not mutate its input", () => {
    const input = [C, B, A];
    sortProjects(input, "units");
    expect(input.map((p) => p.id)).toEqual(["c", "b", "a"]);
  });
});

describe("reconcileSelection", () => {
  it("drops a selection that is filtered out", () => {
    expect(reconcileSelection({ ...DEFAULT_FILTERS, selected: "b" }, ["a"]).selected).toBeNull();
  });
  it("keeps a visible selection", () => {
    expect(reconcileSelection({ ...DEFAULT_FILTERS, selected: "a" }, ["a"]).selected).toBe("a");
  });
});

describe("URL state", () => {
  it("serializes the default state to an empty string", () => {
    expect(serializeFilterState(DEFAULT_FILTERS)).toBe("");
  });
  it("round-trips a filtered, selected state", () => {
    const q = serializeFilterState({ statuses: ["planning", "completed"], programs: ["private"], selected: "a" });
    expect(q).toBe("?status=completed,planning&program=private&project=a");
    expect(parseFilterState(q, IDS)).toEqual({ statuses: ["completed", "planning"], programs: ["private"], selected: "a" });
  });
  it("encodes all-unchecked as none", () => {
    const q = serializeFilterState({ ...DEFAULT_FILTERS, statuses: [] });
    expect(q).toBe("?status=none");
    expect(parseFilterState(q, IDS).statuses).toEqual([]);
  });
  it("ignores unknown values and unknown project ids", () => {
    expect(parseFilterState("?status=bogus&program=x&project=deleted-id", IDS)).toEqual(DEFAULT_FILTERS);
  });
  it("keeps valid values alongside invalid ones", () => {
    expect(parseFilterState("?status=bogus,approved", IDS).statuses).toEqual(["approved"]);
  });
});

describe("mergeFilterSearch", () => {
  it("keeps unrelated params (utm_*) while replacing filter params", () => {
    const next = mergeFilterSearch("?utm_source=linkedin&status=approved&project=a", { ...DEFAULT_FILTERS, statuses: ["completed"], selected: null });
    expect(next).toBe("?utm_source=linkedin&status=completed");
  });
  it("returns an empty string when nothing remains", () => {
    expect(mergeFilterSearch("?status=approved", DEFAULT_FILTERS)).toBe("");
  });
});
