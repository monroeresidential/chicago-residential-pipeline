import { describe, expect, it } from "vitest";
import {
  blankToNull, extractCitedKeys, formatPin, looseOrgKey, matterKeyOf, normalizeCommunityArea, normalizeDpdAppNo,
  normalizeElmsMatterId, normalizePin, normalizeRecordNumber, normalizeZbaCaseNo, normalizeZip, normalizeZoning, orgNameKey,
} from "../normalize/primitives";

describe("normalizePin", () => {
  it.each([
    ["17-09-123-004-0000", "17091230040000"],
    ["17091230040000", "17091230040000"],
    ["17-09-123-004", "17091230040000"],
    [" 17 09 123 004 0000 ", "17091230040000"],
  ])("%s → %s", (raw, pin) => expect(normalizePin(raw)).toEqual({ ok: true, value: pin }));

  it("rejects other lengths", () => expect(normalizePin("17-09-123").ok).toBe(false));
  it("formats for display", () => expect(formatPin("17091230040000")).toBe("17-09-123-004-0000"));
});

describe("identifiers", () => {
  it.each([["APP23020T1", "23020"], ["23020", "23020"], ["app #23020", "23020"], ["23020T1", "23020"]])(
    "DPD app # %s → %s", (raw, v) => expect(normalizeDpdAppNo(raw)).toEqual({ ok: true, value: v }),
  );
  it("rejects a DPD app # without digits", () => expect(normalizeDpdAppNo("pending").ok).toBe(false));
  it.each(["23020 / 23021", "23020 23021", "23020\n23021"])("rejects a DPD app # with extra content: %j", (raw) =>
    expect(normalizeDpdAppNo(raw).ok).toBe(false));

  it.each([["o2026-0025202", "O2026-0025202"], ["SO2026-0023894", "SO2026-0023894"], [" O2026 -0025202", "O2026-0025202"]])(
    "record number %s → %s", (raw, v) => expect(normalizeRecordNumber(raw)).toEqual({ ok: true, value: v }),
  );
  it("rejects a malformed record number", () => expect(normalizeRecordNumber("2026-25202").ok).toBe(false));
  it("matter key strips one leading S", () => {
    expect(matterKeyOf("SO2026-0023894")).toBe("O2026-0023894");
    expect(matterKeyOf("O2026-0025202")).toBe("O2026-0025202");
  });

  it("finds ordinance and APP numbers cited in permit conditions", () => {
    expect(extractCitedKeys("PER SO2026-0023894 ... APP23020T1; also app 23021")).toEqual({
      dpd_app_no: ["23020", "23021"], record_number: ["SO2026-0023894"],
    });
    expect(extractCitedKeys("NO CONDITIONS")).toEqual({ dpd_app_no: [], record_number: [] });
    expect(extractCitedKeys("PER O2020-1234")).toEqual({ dpd_app_no: [], record_number: ["O2020-1234"] });
  });
});

describe("organization keys", () => {
  it.each([
    ["4645 North Clark, LLC", "4645 NORTH CLARK LLC"],
    ["4645 NORTH CLARK L.L.C.", "4645 NORTH CLARK LLC"],
    ["4645 North Clark L L C", "4645 NORTH CLARK LLC"],
    ["Golub & Co.", "GOLUB AND CO"],
    ["Acme, Inc.", "ACME INC"],
    ["Example L  L  C", "EXAMPLE LLC"],
    ["Café LLC", "CAFE LLC"],
    ["Cafe\u0301 LLC", "CAFE LLC"],
    ["Caf LLC", "CAF LLC"],
    ["Acme,Inc.", "ACME INC"],
  ])("%s → %s", (raw, key) => expect(orgNameKey(raw)).toBe(key));

  it("returns null for punctuation-only names", () => expect(orgNameKey(" ., ")).toBeNull());
  it("loose key drops entity suffixes", () => {
    expect(looseOrgKey("XIMENA CASTRO ESQ")).toBe("XIMENA CASTRO");
    expect(looseOrgKey("4645 NORTH CLARK LLC")).toBe("4645 NORTH CLARK");
  });
});

describe("eLMS matter ids", () => {
  const id = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
  it.each([[id, id], [id.toUpperCase(), id], [`{${id}}`, id], [id.replace(/-/g, ""), id]])(
    "%s → canonical", (raw, v) => expect(normalizeElmsMatterId(raw)).toEqual({ ok: true, value: v }),
  );
  it("rejects values that are not GUIDs", () => expect(normalizeElmsMatterId("not-a-guid").ok).toBe(false));
});

describe("ZBA case numbers", () => {
  it.each([["420-24-S", "420-24-S"], ["420 - 24 - s", "420-24-S"], [" 420-24-S ", "420-24-S"]])(
    "%s → %s", (raw, v) => expect(normalizeZbaCaseNo(raw)).toBe(v),
  );
});

describe("community area, ZIP, zoning, blanks", () => {
  it.each([["21", 21], [21, 21], ["21 Avondale", 21], ["Avondale", 21], ["lake view", 6], ["Lakeview", 6], ["O'Hare", 76]])(
    "community area %s → %s", (raw, n) => expect(normalizeCommunityArea(raw)).toEqual({ ok: true, value: n }),
  );
  it.each(["32.5", "32 Loop, 33 Near South Side", "32 Avondale"])("rejects conflicting community area %j", (raw) =>
    expect(normalizeCommunityArea(raw).ok).toBe(false));

  it("rejects unknown areas and out-of-range numbers", () => {
    expect(normalizeCommunityArea("Gotham").ok).toBe(false);
    expect(normalizeCommunityArea("78").ok).toBe(false);
  });
  it("ZIP keeps five digits", () => {
    expect(normalizeZip("60603-1234")).toEqual({ ok: true, value: "60603" });
    expect(normalizeZip("6060").ok).toBe(false);
  });
  it.each([["b3-2", "B3-2"], ["DX - 12", "DX-12"], ["PD1234", "PD 1234"], ["PD #1234", "PD 1234"], ["pd", "PD"], ["PMD 4a", "PMD 4A"]])(
    "zoning %s → %s", (raw, v) => expect(normalizeZoning(raw)).toBe(v),
  );
  it("blankToNull", () => {
    expect(blankToNull("  ")).toBeNull();
    expect(blankToNull(" x ")).toBe("x");
    expect(blankToNull(undefined)).toBeNull();
  });
});
