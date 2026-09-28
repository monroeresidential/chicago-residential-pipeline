import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import { Protocol } from "pmtiles";
// MapLibre 6 locates its worker with a runtime-built URL that bundlers cannot follow,
// so bundle the worker explicitly and hand MapLibre its URL.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { buildStyle, DEFAULT_ASSETS_PATH, DEFAULT_PMTILES_URL } from "./style";

export const CHICAGO_CENTER: [number, number] = [-87.6298, 41.8847];

export interface BaseMapOptions {
  container: HTMLElement;
  center?: [number, number];
  zoom?: number;
  interactive?: boolean;
  onTileError?: () => void;
}

let protocolRegistered = false;

export function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function createBaseMap(opts: BaseMapOptions): MapLibreMap | null {
  if (!supportsWebGL()) return null;
  if (!protocolRegistered) {
    maplibregl.setWorkerUrl(workerUrl);
    maplibregl.addProtocol("pmtiles", new Protocol().tile);
    protocolRegistered = true;
  }

  const assets = import.meta.env.PUBLIC_MAP_ASSETS_URL || DEFAULT_ASSETS_PATH;
  const style = buildStyle({
    pmtilesUrl: new URL(import.meta.env.PUBLIC_PMTILES_URL || DEFAULT_PMTILES_URL, window.location.href).href,
    assetsUrl: new URL(assets, window.location.href).href.replace(/\/$/, ""),
  });

  try {
    const map = new maplibregl.Map({
      container: opts.container,
      style,
      center: opts.center ?? CHICAGO_CENTER,
      zoom: opts.zoom ?? 13.5,
      interactive: opts.interactive ?? true,
      attributionControl: { compact: true },
    });
    // Everything this map fetches is basemap (tiles, glyphs, sprites), so any error means the basemap is degraded.
    let reported = false;
    map.on("error", (event) => {
      console.warn("Basemap error", event.error);
      if (!reported) {
        reported = true;
        opts.onTileError?.();
      }
    });
    return map;
  } catch (err) {
    console.warn("Interactive map unavailable", err);
    return null;
  }
}
