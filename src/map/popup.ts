import { displayName, escapeHtml as e, formatMoney, formatUnits } from "../lib/format";
import { PROGRAM_LABELS, STATUS_LABELS } from "../lib/constants";
import type { Project } from "../lib/schema";

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
    p.built_by_3f_url ? `<a class="popup-3f" href="${e(p.built_by_3f_url)}" target="_blank" rel="noopener">Built by 3F Construction →</a>` : "",
    `<a class="popup-link" href="/projects/${e(p.id)}">View details →</a>`,
    `</div>`,
  ].join("");
}
