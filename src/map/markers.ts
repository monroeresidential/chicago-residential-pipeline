import { displayName, formatUnits } from "../lib/format";
import { STATUS_COLORS, STATUS_LABELS } from "../lib/constants";
import type { Project } from "../lib/schema";

export function markerSize(units: number | null): number {
  return Math.round(16 + Math.sqrt(units ?? 0));
}

export function markerLabel(p: Project): string {
  const parts = [displayName(p), STATUS_LABELS[p.status]];
  if (p.units !== null) parts.push(`${formatUnits(p.units)} units`);
  if (p.confidence === "reported") parts.push("reported — not on DPD map");
  return parts.join(", ");
}

export function createMarkerElement(p: Project): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "marker";
  if (p.confidence === "reported") el.classList.add("marker--reported");
  if (p.built_by_3f_url) el.classList.add("marker--3f");
  el.dataset.id = p.id;
  el.dataset.status = p.status;
  const size = `${markerSize(p.units)}px`;
  el.style.width = size;
  el.style.height = size;
  el.style.setProperty("--marker-color", STATUS_COLORS[p.status]);
  el.setAttribute("aria-label", markerLabel(p));
  el.title = displayName(p);
  return el;
}
