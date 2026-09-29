import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  applyFilters, mergeFilterSearch, parseFilterState, reconcileSelection, sortProjects, type FilterState,
} from "../lib/filters";
import { featureToProject } from "../lib/geojson";
import type { Project, ProjectCollection } from "../lib/schema";
import { totals } from "../lib/stats";
import { createBaseMap } from "../map/basemap";
import { createMarkerElement } from "../map/markers";
import { popupHtml } from "../map/popup";
import {
  applyOrder, readFilters, readSort, renderList, renderStats, scrollRowIntoView, writeFilters,
} from "./sidebar";

const MOBILE = window.matchMedia("(max-width: 767px)");

/** Reads the FeatureCollection that index.astro embeds (same shape as /data/projects.geojson). */
function readEmbeddedProjects(): ProjectCollection {
  return JSON.parse(document.getElementById("projects-data")!.textContent!) as ProjectCollection;
}

/** `sheet` is the already-bound phone bottom sheet (bound eagerly in index.astro). */
export function startMapApp(sheet: { collapse(): void }): void {
  const collection = readEmbeddedProjects();
  const projects = collection.features.map(featureToProject);
  const byId = new Map(projects.map((p) => [p.id, p]));

  const sidebar = document.getElementById("sidebar")!;
  const form = document.getElementById("filters") as HTMLFormElement;
  const list = document.getElementById("project-list")!;
  const container = document.getElementById("map")!;

  let state: FilterState = parseFilterState(window.location.search, [...byId.keys()]);
  writeFilters(sidebar, state);

  const map = createBaseMap({
    container,
    onTileError: () => { document.getElementById("map-notice")!.hidden = false; },
  });
  if (!map) {
    container.hidden = true;
    document.getElementById("map-fallback")!.hidden = false;
  }

  const markers = new Map<string, HTMLButtonElement>();
  let popup: maplibregl.Popup | null = null;
  let popupId: string | null = null;

  if (map) {
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    for (const p of projects) {
      const el = createMarkerElement(p);
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        select(p.id, { fly: false });
      });
      new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
      markers.set(p.id, el);
    }
    fitToProjects(map, applyFilters(projects, state));
  }

  function closePopup(): void {
    const current = popup;
    popup = null; // cleared first so the popup's own "close" handler below is a no-op
    popupId = null;
    current?.remove();
  }

  function openPopup(p: Project): void {
    if (!map) return;
    closePopup();
    const opened = new maplibregl.Popup({ offset: 18, maxWidth: "300px", focusAfterOpen: false })
      .setLngLat([p.lng, p.lat])
      .setHTML(popupHtml(p))
      .addTo(map);
    opened.on("close", () => {
      if (popup !== opened) return; // closed programmatically
      popup = null;
      popupId = null;
      state = { ...state, selected: null };
      render();
    });
    popup = opened;
    popupId = p.id;
  }

  function render(): void {
    const visible = applyFilters(projects, state);
    const visibleIds = new Set(visible.map((p) => p.id));
    state = reconcileSelection(state, [...visibleIds]);
    for (const [id, el] of markers) {
      el.hidden = !visibleIds.has(id);
      el.classList.toggle("is-selected", id === state.selected);
    }
    renderStats(sidebar, totals(visible));
    renderList(sidebar, visibleIds, state.selected);
    if (!state.selected) closePopup();
    else if (popupId !== state.selected) openPopup(byId.get(state.selected)!);
    const { pathname, search, hash } = window.location;
    window.history.replaceState(null, "", `${pathname}${mergeFilterSearch(search, state)}${hash}`);
  }

  function select(id: string, { fly }: { fly: boolean }): void {
    state = { ...state, selected: id };
    render();
    scrollRowIntoView(sidebar, id);
    const p = byId.get(id);
    if (fly && map && p) {
      map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 16), pitch: 50, essential: true });
    }
  }

  function hover(event: MouseEvent, on: boolean): void {
    const id = (event.target as Element).closest<HTMLElement>("li[data-id]")?.dataset.id;
    if (id) markers.get(id)?.classList.toggle("is-hover", on);
  }

  form.addEventListener("submit", (event) => event.preventDefault());
  form.addEventListener("change", (event) => {
    if ((event.target as HTMLElement).id === "sort") {
      applyOrder(sidebar, sortProjects(projects, readSort(sidebar)).map((p) => p.id));
      return;
    }
    state = { ...state, ...readFilters(sidebar) };
    render();
  });

  list.addEventListener("click", (event) => {
    const row = (event.target as Element).closest<HTMLAnchorElement>("a.project-row");
    // Without a map, rows are plain links to project pages. Modified clicks open the page too.
    // detail === 0 means keyboard activation: let Enter follow the link so keyboard and
    // screen-reader users reach the project page.
    if (!row || !map || event.detail === 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    if (MOBILE.matches) sheet.collapse();
    select(row.dataset.id!, { fly: true });
  });
  list.addEventListener("mouseover", (event) => hover(event, true));
  list.addEventListener("mouseout", (event) => hover(event, false));

  render();
  if (state.selected) select(state.selected, { fly: true });
}

function fitToProjects(map: MapLibreMap, projects: readonly Project[]): void {
  if (projects.length === 0) return;
  const bounds = new maplibregl.LngLatBounds();
  for (const p of projects) bounds.extend([p.lng, p.lat]);
  const padding = MOBILE.matches
    ? { top: 48, bottom: 88, left: 32, right: 32 } // collapsed sheet is ~60px
    : 64;
  map.fitBounds(bounds, { padding, maxZoom: 15, animate: false });
}
