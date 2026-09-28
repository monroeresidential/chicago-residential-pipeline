import { displayName, escapeHtml as e, formatMoney, formatUnits } from "../lib/format";
import { STATUS_LABELS, type Project } from "../lib/schema";

export function popupHtml(p: Project): string {
  const meta = [
    p.units === null ? null : `${formatUnits(p.units)} units`,
    p.tpc_musd === null ? null : formatMoney(p.tpc_musd),
  ].filter(Boolean).join(" · ");
  const status = `${STATUS_LABELS[p.status]}${p.confidence === "reported" ? " · Reported" : ""}`;

  return [
    `<div class="popup">`,
    `<p class="popup-status">${e(status)}</p>`,
    `<h3 class="popup-title">${e(displayName(p))}</h3>`,
    p.name ? `<p class="popup-address">${e(p.address)}</p>` : "",
    meta ? `<p class="popup-meta">${e(meta)}</p>` : "",
    p.flag ? `<p class="popup-flag">⚠ ${e(p.flag)}</p>` : "",
    p.monroe_url ? `<p class="popup-monroe">A Monroe Residential project</p>` : "",
    `<a class="popup-link" href="/projects/${e(p.id)}">View details →</a>`,
    `</div>`,
  ].join("");
}
