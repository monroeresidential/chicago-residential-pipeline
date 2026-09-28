import { displayName, escapeHtml as e, formatMoney, formatUnits } from "../lib/format";
import { PROGRAM_LABELS, STATUS_LABELS, type Project } from "../lib/schema";

export function popupHtml(p: Project): string {
  const meta = `${formatUnits(p.units)} units · ${formatMoney(p.tpc_musd)}`;
  const status = `${STATUS_LABELS[p.status]}${p.confidence === "reported" ? " · Reported" : ""}`;

  return [
    `<div class="popup">`,
    `<p class="popup-status">${e(status)}</p>`,
    `<h3 class="popup-title">${e(displayName(p))}</h3>`,
    p.name ? `<p class="popup-address">${e(p.address)}</p>` : "",
    `<p class="popup-meta">${e(meta)}</p>`,
    `<p class="popup-program">${e(PROGRAM_LABELS[p.program])}</p>`,
    p.flag ? `<p class="popup-flag">⚠ ${e(p.flag)}</p>` : "",
    p.monroe_url ? `<p class="popup-monroe">A Monroe Residential project</p>` : "",
    `<a class="popup-link" href="/projects/${e(p.id)}">View details →</a>`,
    `</div>`,
  ].join("");
}
