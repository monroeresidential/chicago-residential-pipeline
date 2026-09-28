import { describe, expect, it } from "vitest";
import { parseCensusResponse, toGeocodeQuery } from "../../src/lib/geocode";

describe("toGeocodeQuery", () => {
  it("uses the first number of a range, strips periods, adds city", () => {
    expect(toGeocodeQuery("116-122 W. Illinois St")).toBe("116 W Illinois St, Chicago, IL");
    expect(toGeocodeQuery("111 W. Monroe St")).toBe("111 W Monroe St, Chicago, IL");
  });
});

describe("parseCensusResponse", () => {
  it("returns the first match's coordinates", () => {
    const json = { result: { addressMatches: [{ coordinates: { x: -87.6311, y: 41.8805 } }] } };
    expect(parseCensusResponse(json)).toEqual({ lat: 41.8805, lng: -87.6311 });
  });
  it("returns null when there is no match or the shape is wrong", () => {
    expect(parseCensusResponse({ result: { addressMatches: [] } })).toBeNull();
    expect(parseCensusResponse({ nope: true })).toBeNull();
    expect(parseCensusResponse(null)).toBeNull();
  });
});
