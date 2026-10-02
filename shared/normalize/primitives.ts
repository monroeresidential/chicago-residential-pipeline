import { COMMUNITY_AREAS } from "../data/community-areas";

export type Result<T> = { ok: true; value: T; warning?: string } | { ok: false; message: string };
const ok = <T>(value: T, warning?: string): Result<T> => (warning ? { ok: true, value, warning } : { ok: true, value });
const fail = <T>(message: string): Result<T> => ({ ok: false, message });

export function blankToNull(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/** Cook County PIN → 14 digits. 10-digit PINs get the 0000 unit suffix. */
export function normalizePin(raw: string): Result<string> {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 14) return ok(digits);
  if (digits.length === 10) return ok(`${digits}0000`);
  return fail(`PIN "${raw.trim()}" must have 10 or 14 digits, found ${digits.length}`);
}

export function formatPin(pin: string): string {
  return `${pin.slice(0, 2)}-${pin.slice(2, 4)}-${pin.slice(4, 7)}-${pin.slice(7, 10)}-${pin.slice(10)}`;
}

/** DPD application number → its digits (APP23020T1, 23020T1, "app #23020" → 23020). */
export function normalizeDpdAppNo(raw: string): Result<string> {
  // The whole value must be one application number: APP23020T1, 23020T1, "app #23020". Anything else is flagged.
  // Spaces are allowed around the APP prefix and "#", never between digit groups ("23020 23021" is two numbers).
  const m = raw.toUpperCase().match(/^\s*(?:APP\s*)?#?\s*(\d{4,})(?:T\d+)?\s*$/);
  return m ? ok(m[1]!) : fail(`DPD app # "${raw.trim()}" has no number`);
}

/** City Clerk record number → uppercase, no spaces (O2026-0025202, SO2026-0023894). */
export function normalizeRecordNumber(raw: string): Result<string> {
  const v = raw.toUpperCase().replace(/\s+/g, "");
  return /^[A-Z]{1,4}\d{4}-\d{1,8}$/.test(v) ? ok(v) : fail(`record number "${raw.trim()}" is not like O2026-0025202`);
}

/** Grok's dedupe key for eLMS matters: the record number without one leading S. */
export function matterKeyOf(recordNumber: string): string {
  return recordNumber.replace(/^S(?=[A-Z])/, "");
}

/** Ordinance and DPD application numbers cited in free text (permit_condition). */
export function extractCitedKeys(text: string): { dpd_app_no: string[]; record_number: string[] } {
  const upper = text.toUpperCase();
  const apps = [...upper.matchAll(/\bAPP\s*#?\s*(\d{4,})/g)].map((m) => m[1]!);
  const records = [...upper.matchAll(/\b(S?O\d{4}-\d{1,8})\b/g)].map((m) => m[1]!);
  return { dpd_app_no: [...new Set(apps)], record_number: [...new Set(records)] };
}

/** Comparison key for organization and person names. */
export function orgNameKey(raw: string): string | null {
  // Accents fold to their base letter (Café = Cafe\u0301 = CAFE); other letters and digits are kept.
  let s = raw.normalize("NFKD").replace(/\p{M}/gu, "").toUpperCase().replace(/&/g, " AND ").replace(/,/g, " ").replace(/[.'"`’]/g, "");
  s = s.replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ");
  s = s.replace(/\bL L C\b/g, "LLC").replace(/\bI N C\b/g, "INC").replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

const ENTITY_SUFFIXES = new Set(["LLC", "INC", "ESQ", "CORP", "CO", "LTD", "LP", "LLP", "PC", "JR"]);

/** Name key without trailing entity/person suffixes — used only to suggest possible duplicates. */
export function looseOrgKey(nameKey: string): string {
  const words = nameKey.split(" ");
  while (words.length > 1 && ENTITY_SUFFIXES.has(words[words.length - 1]!)) words.pop();
  return words.join(" ");
}

const compactName = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, "");
const AREA_BY_NAME = new Map(COMMUNITY_AREAS.map((a) => [compactName(a.name), a.number]));

/** "21", 21, "21 Avondale", "Avondale" → 21. */
export function normalizeCommunityArea(raw: string | number): Result<number> {
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,3})\b/);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= 77 ? ok(n) : fail(`community area ${n} is not between 1 and 77`);
  }
  const hit = AREA_BY_NAME.get(compactName(s));
  return hit ? ok(hit) : fail(`unknown community area "${s}"`);
}

/** ZBA case number in one spelling: "420 - 24 - s" → "420-24-S". */
export function normalizeZbaCaseNo(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, "").replace(/[\u2010-\u2015\u2212]/g, "-");
}

export function normalizeZip(raw: string): Result<string> {
  const m = raw.trim().match(/^(\d{5})(?:-\d{4})?$/);
  return m ? ok(m[1]!) : fail(`ZIP "${raw.trim()}" is not 5 digits`);
}

/** Chicago zoning district code in canonical spacing: B3-2, DX-12, PD 1234, PMD 4A. */
export function normalizeZoning(raw: string): string {
  let s = raw.toUpperCase().trim().replace(/\s*-\s*/g, "-").replace(/\s+/g, " ");
  s = s.replace(/^(PD|PMD)\s*#?\s*(\w+)$/, "$1 $2");
  return s;
}
