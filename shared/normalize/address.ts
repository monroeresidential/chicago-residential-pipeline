import streetsJson from "../data/streets.json";
import { normalizeZip, type Result } from "./primitives";

export interface CanonicalAddress {
  number_from: number;
  number_to: number;
  predir: "N" | "S" | "E" | "W" | null;
  street_name: string;
  suffix: string | null;
  zip: string | null;
}

type StreetRow = readonly [dir: string, street: string, suffix: string, min: number, max: number];
const ROWS = streetsJson as unknown as StreetRow[];
const RAMP_SUFFIXES = new Set(["ER", "XR"]); // expressway ramps in the city list, never a building address

const compact = (s: string) => s.replace(/[^A-Z0-9]/g, "");
const BY_NAME = new Map<string, StreetRow[]>();
for (const row of ROWS) {
  const key = `${row[0]}|${compact(row[1])}`;
  BY_NAME.set(key, [...(BY_NAME.get(key) ?? []), row]);
}

const DIRS: Record<string, CanonicalAddress["predir"]> = {
  N: "N", NORTH: "N", S: "S", SOUTH: "S", E: "E", EAST: "E", W: "W", WEST: "W",
};

/** Spelling → the abbreviation the city list uses. Every suffix in streets.json must be a value here (tested). */
export const SUFFIXES: Record<string, string> = {
  ST: "ST", STREET: "ST", AVE: "AVE", AV: "AVE", AVENUE: "AVE", BLVD: "BLVD", BOULEVARD: "BLVD",
  DR: "DR", DRIVE: "DR", PL: "PL", PLACE: "PL", RD: "RD", ROAD: "RD", CT: "CT", COURT: "CT",
  PKWY: "PKWY", PARKWAY: "PKWY", TER: "TER", TERRACE: "TER", WAY: "WAY", LN: "LN", LANE: "LN",
  HWY: "HWY", HIGHWAY: "HWY", SQ: "SQ", SQUARE: "SQ", PLZ: "PLZ", PLAZA: "PLZ", ROW: "ROW",
  CIR: "CIR", CIRCLE: "CIR", EXPY: "EXPY", EXPRESSWAY: "EXPY", ER: "ER", XR: "XR",
  CRES: "CRES", CRESCENT: "CRES", SR: "SR", RL: "RL", TOLL: "TOLL",
};

const inRange = (row: StreetRow, n: number) => n >= row[3] && n <= row[4];
const distinct = <T>(xs: T[]) => [...new Set(xs)];

function expandRange(a: string, b: string): number {
  return Number(b.length < a.length ? a.slice(0, a.length - b.length) + b : b);
}

export type AddressResult = Result<CanonicalAddress> & { unit?: string };

export function normalizeAddress(raw: string, zipRaw?: string | null): AddressResult {
  let s = raw.toUpperCase().replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  // Unit/suite/floor tails are not part of the canonical address; they are returned so the caller can keep them in notes.
  const units: string[] = [];
  const cut = (re: RegExp) => {
    s = s.replace(re, (tail) => { units.push(tail.trim()); return ""; }).trim();
  };
  cut(/\s\d+(?:ST|ND|RD|TH)\s+(?:FL|FLOOR)\b.*$/);
  cut(/\s(?:#|(?:UNIT|STE|SUITE|APT|FL|FLOOR|RM|ROOM)\b)\s*\S*.*$/);
  cut(/#\S*$/);
  const unit = units.length ? units.reverse().join(" ") : undefined;

  const m = s.match(/^(\d+)(?:\s*(?:-|TO|THRU|THROUGH)\s*(\d+))?\s+(.+)$/);
  if (!m) return { ok: false, message: `address "${raw.trim()}" has no house number` };
  const from = Number(m[1]);
  const to = m[2] ? expandRange(m[1]!, m[2]) : from;
  if (to < from) return { ok: false, message: `address range "${raw.trim()}" runs backwards` };

  const tokens = m[3]!.split(" ");
  let predir: CanonicalAddress["predir"] = null;
  if (tokens.length > 1 && DIRS[tokens[0]!]) predir = DIRS[tokens.shift()!]!;
  let suffix: string | null = null;
  if (tokens.length > 1 && SUFFIXES[tokens[tokens.length - 1]!]) suffix = SUFFIXES[tokens.pop()!]!;
  const name = tokens.join(" ");

  const warnings: string[] = [];
  let candidates: StreetRow[];
  if (predir) {
    candidates = BY_NAME.get(`${predir}|${compact(name)}`) ?? [];
  } else {
    const dirs = distinct(["N", "S", "E", "W"].filter((d) => (BY_NAME.get(`${d}|${compact(name)}`) ?? []).some((r) => inRange(r, from))));
    if (dirs.length !== 1) return { ok: false, message: `address "${raw.trim()}" needs a direction (N/S/E/W)` };
    predir = dirs[0] as CanonicalAddress["predir"];
    candidates = BY_NAME.get(`${predir}|${compact(name)}`) ?? [];
    warnings.push(`direction ${predir} added`);
  }
  if (!suffix || !RAMP_SUFFIXES.has(suffix)) candidates = candidates.filter((r) => !RAMP_SUFFIXES.has(r[2]));
  if (candidates.length === 0) return { ok: false, message: `unknown street "${predir} ${name}" (not in the city street list)` };

  const streetName = candidates[0]![1];
  const blockSuffixes = distinct(candidates.filter((r) => inRange(r, from)).map((r) => r[2]));
  const allSuffixes = distinct(candidates.map((r) => r[2]));

  if (suffix) {
    const fits = candidates.some((r) => r[2] === suffix && inRange(r, from));
    if (!fits) {
      if (blockSuffixes.length === 1) {
        warnings.push(`suffix ${suffix} corrected to ${blockSuffixes[0] || "none"} for the ${from} block`);
        suffix = blockSuffixes[0] || null;
      } else if (!allSuffixes.includes(suffix)) {
        return { ok: false, message: `"${predir} ${streetName} ${suffix}" is not in the city street list` };
      }
    }
  } else {
    const options = blockSuffixes.length > 0 ? blockSuffixes : allSuffixes;
    if (options.length !== 1) return { ok: false, message: `address "${raw.trim()}" needs a street type (ST, AVE…)` };
    suffix = options[0] || null;
  }

  let zip: string | null = null;
  if (zipRaw && zipRaw.trim()) {
    const z = normalizeZip(zipRaw);
    if (!z.ok) return { ok: false, message: z.message };
    zip = z.value;
  }

  const value: CanonicalAddress = { number_from: from, number_to: to, predir, street_name: streetName, suffix, zip };
  return { ok: true, value, ...(warnings.length ? { warning: warnings.join("; ") } : {}), ...(unit ? { unit } : {}) };
}

const range = (a: CanonicalAddress) => (a.number_from === a.number_to ? `${a.number_from}` : `${a.number_from}-${a.number_to}`);

export function addressKey(a: CanonicalAddress): string {
  return [range(a), a.predir, a.street_name, a.suffix].filter(Boolean).join(" ");
}

const STREET_DISPLAY: Record<string, string> = {
  "LA SALLE": "LaSalle", "MC CLURG": "McClurg", "MC FETRIDGE": "McFetridge", "DE KOVEN": "DeKoven", "MC CORMICK": "McCormick",
};
const title = (w: string) => (/^\d/.test(w) ? w.toLowerCase() : w.charAt(0) + w.slice(1).toLowerCase());

export function formatAddressDisplay(a: CanonicalAddress): string {
  const street = STREET_DISPLAY[a.street_name] ?? a.street_name.split(" ").map(title).join(" ");
  return [range(a), a.predir ? `${a.predir}.` : null, street, a.suffix ? title(a.suffix) : null].filter(Boolean).join(" ");
}
