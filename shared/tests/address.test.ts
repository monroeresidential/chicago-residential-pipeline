import { readFileSync } from "node:fs";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import streets from "../data/streets.json";
import { addressKey, formatAddressDisplay, normalizeAddress, SUFFIXES } from "../normalize/address";

const value = (raw: string, zip?: string) => {
  const r = normalizeAddress(raw, zip);
  if (!r.ok) throw new Error(r.message);
  return r;
};

describe("normalizeAddress", () => {
  it("canonicalizes a simple address", () => {
    expect(value("111 W. Monroe Street").value).toEqual({
      number_from: 111, number_to: 111, predir: "W", street_name: "MONROE", suffix: "ST", zip: null,
    });
  });

  it.each([
    ["111-123 W. Monroe Street", "111-123 W MONROE ST"],
    ["111 - 123 W MONROE ST", "111-123 W MONROE ST"],
    ["111 TO 123 West Monroe St.", "111-123 W MONROE ST"],
    ["1601-15 N. Clark St", "1601-1615 N CLARK ST"],
    ["208 S. LaSalle St", "208 S LA SALLE ST"],
    ["208 South La Salle Street", "208 S LA SALLE ST"],
    ["55 E. Washington St, Suite 300", "55 E WASHINGTON ST"],
    ["55 E Washington St #300", "55 E WASHINGTON ST"],
    ["3642 W. Oakdale Avenue", "3642 W OAKDALE AVE"],
  ])("%s → %s", (raw, key) => expect(addressKey(value(raw).value)).toBe(key));

  it("does not mistake street names for unit designators", () => {
    expect(addressKey(value("225 N Stetson Ave").value)).toBe("225 N STETSON AVE");
    expect(addressKey(value("3000 W Flournoy St").value)).toBe("3000 W FLOURNOY ST");
  });

  it("drops floor designators", () => {
    expect(addressKey(value("55 E Washington St, 2nd Floor").value)).toBe("55 E WASHINGTON ST");
    expect(addressKey(value("55 E Washington St # 300").value)).toBe("55 E WASHINGTON ST");
  });

  it("uses null, never an empty string, for streets without a suffix", () => {
    const corrected = value("3000 N Broadway St").value;
    expect(corrected.suffix).toBeNull();
    expect(corrected).toEqual(value("3000 N Broadway").value);
  });

  it("fills a missing suffix when the block has only one", () => {
    expect(addressKey(value("3642 W Oakdale").value)).toBe("3642 W OAKDALE AVE");
  });

  it("corrects the suffix to the one valid for that block, with a warning", () => {
    const r = value("620 N. LaSalle St");
    expect(addressKey(r.value)).toBe("620 N LA SALLE DR");
    expect(r.warning).toMatch(/suffix/i);
  });

  it("keeps a valid ZIP and rejects nothing because of a missing one", () => {
    expect(value("111 W Monroe St", "60603-1234").value.zip).toBe("60603");
  });

  it("rejects unknown streets and addresses without a number", () => {
    expect(normalizeAddress("12 Gotham Blvd").ok).toBe(false);
    expect(normalizeAddress("W Monroe St").ok).toBe(false);
  });

  it("knows every suffix the city list uses", () => {
    const used = new Set((streets as [string, string, string, number, number][]).map((r) => r[2]).filter(Boolean));
    const canonical = new Set(Object.values(SUFFIXES));
    expect([...used].filter((s) => !canonical.has(s))).toEqual([]);
  });
});

describe("formatAddressDisplay", () => {
  it.each([
    ["111 W MONROE ST", "111 W. Monroe St"],
    ["116-122 W. Illinois St", "116-122 W. Illinois St"],
    ["208 S LA SALLE ST", "208 S. LaSalle St"],
    ["1060 W VAN BUREN ST", "1060 W. Van Buren St"],
  ])("%s → %s", (raw, display) => expect(formatAddressDisplay(value(raw).value)).toBe(display));

  it("reproduces today's project addresses (except the two whose suffix the city list corrects)", () => {
    const rows = Papa.parse<{ address: string }>(readFileSync("data/projects.csv", "utf8"), { header: true, skipEmptyLines: true }).data;
    const changed = rows
      .map((r) => ({ from: r.address, to: formatAddressDisplay(value(r.address).value) }))
      .filter((c) => c.from !== c.to);
    expect(changed).toEqual([
      { from: "209 W. Jackson St", to: "209 W. Jackson Blvd" },
      { from: "620 N. LaSalle St", to: "620 N. LaSalle Dr" },
    ]);
  });
});
