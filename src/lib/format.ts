import type { Project } from "./schema";

export const EMPTY = "—";

export function formatUnits(n: number | null): string {
  return n === null ? EMPTY : n.toLocaleString("en-US");
}

export function formatMoney(musd: number | null): string {
  if (musd === null) return EMPTY;
  if (musd >= 1000) return `$${(musd / 1000).toFixed(2).replace(/\.?0+$/, "")}B`;
  return `$${Number.isInteger(musd) ? musd : musd.toFixed(1)}M`;
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC", month: "long", day: "numeric", year: "numeric",
  });
}

export function displayName(p: Pick<Project, "name" | "address">): string {
  return p.name ?? p.address;
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

export function hostname(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}
