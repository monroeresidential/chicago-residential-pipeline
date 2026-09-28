import { describe, expect, it } from "vitest";
import { featureToProject, toFeatureCollection } from "../../src/lib/geojson";
import { makeProject } from "./fixtures";

describe("geojson", () => {
  it("builds [lng, lat] point features with as_of and round-trips", () => {
    const p = makeProject();
    const fc = toFeatureCollection([p], "2026-09-28");
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.as_of).toBe("2026-09-28");
    const f = fc.features[0]!;
    expect(f.id).toBe(p.id);
    expect(f.geometry.coordinates).toEqual([p.lng, p.lat]);
    expect(f.properties.as_of).toBe("2026-09-28");
    expect(f.properties).not.toHaveProperty("lat");
    expect(featureToProject(f)).toEqual(p);
  });
});
