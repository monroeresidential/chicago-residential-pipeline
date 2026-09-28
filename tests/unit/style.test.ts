import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRAND_FLAVOR } from "../../src/map/brand-flavor";
import { BASEMAP_SOURCE, buildStyle } from "../../src/map/style";

const style = buildStyle({
  pmtilesUrl: "https://tiles.example/chicago.pmtiles",
  assetsUrl: "https://site.example/map-assets",
});

function collectFontNames(value: unknown, out: Set<string>): void {
  if (typeof value === "string" && value.startsWith("Noto Sans")) out.add(value);
  else if (Array.isArray(value)) value.forEach((v) => collectFontNames(v, out));
}

describe("buildStyle", () => {
  it("points the vector source at the PMTiles archive", () => {
    expect(style.sources[BASEMAP_SOURCE]).toMatchObject({ type: "vector", url: "pmtiles://https://tiles.example/chicago.pmtiles" });
  });

  it("serves glyphs and sprites from the site", () => {
    expect(style.glyphs).toBe("https://site.example/map-assets/fonts/{fontstack}/{range}.pbf");
    expect(style.sprite).toBe("https://site.example/map-assets/sprites/light");
  });

  it("uses the brand background", () => {
    const bg = style.layers.find((l) => l.id === "background");
    expect(bg?.paint).toEqual({ "background-color": BRAND_FLAVOR.background });
  });

  it("adds 3D buildings directly above the flat building layer", () => {
    const ids = style.layers.map((l) => l.id);
    expect(ids).toContain("buildings");
    expect(ids.indexOf("buildings-3d")).toBe(ids.indexOf("buildings") + 1);
  });

  it("only references font stacks that exist in public/map-assets", () => {
    const fonts = new Set<string>();
    for (const layer of style.layers) {
      collectFontNames((layer.layout as Record<string, unknown> | undefined)?.["text-font"], fonts);
    }
    expect(fonts.size).toBeGreaterThan(0);
    for (const font of fonts) expect(existsSync(`public/map-assets/fonts/${font}/0-255.pbf`), font).toBe(true);
  });
});
