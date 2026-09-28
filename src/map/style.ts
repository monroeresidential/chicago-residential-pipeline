import { layers } from "@protomaps/basemaps";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { BRAND_FLAVOR } from "./brand-flavor";

export const BASEMAP_SOURCE = "basemap";
export const DEFAULT_PMTILES_URL = "https://tiles.monroeresidential.com/chicago.pmtiles";
export const DEFAULT_ASSETS_PATH = "/map-assets";

export interface StyleUrls {
  pmtilesUrl: string;
  assetsUrl: string;
}

const BUILDINGS_3D: LayerSpecification = {
  id: "buildings-3d",
  type: "fill-extrusion",
  source: BASEMAP_SOURCE,
  "source-layer": "buildings",
  minzoom: 15,
  paint: {
    "fill-extrusion-color": BRAND_FLAVOR.buildings,
    "fill-extrusion-height": ["coalesce", ["get", "height"], 12],
    "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0],
    "fill-extrusion-opacity": 0.85,
  },
};

export function buildStyle({ pmtilesUrl, assetsUrl }: StyleUrls): StyleSpecification {
  const base = layers(BASEMAP_SOURCE, BRAND_FLAVOR, { lang: "en" }) as LayerSpecification[];
  const flat = base.findIndex((l) => l.id === "buildings");
  base.splice(flat === -1 ? base.length : flat + 1, 0, BUILDINGS_3D);
  return {
    version: 8,
    glyphs: `${assetsUrl}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${assetsUrl}/sprites/light`,
    sources: {
      [BASEMAP_SOURCE]: {
        type: "vector",
        url: `pmtiles://${pmtilesUrl}`,
        attribution:
          '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: base,
  };
}
