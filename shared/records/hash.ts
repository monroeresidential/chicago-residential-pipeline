import { createHash } from "node:crypto";
import { addressKey } from "../normalize/address";
import type { Issue, NormalizedRecord } from "./types";

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}

/**
 * What makes two records "the same": canonical values only — no display names, geocode, ZIP (it lives on the
 * shared address row, first value wins) or provenance. Lists are sorted by code point so storage order never matters.
 */
export function hashable(r: NormalizedRecord): unknown {
  const { point: _p, field_sources: _f, organizations, identifiers, parcels, addresses, ...rest } = r;
  return {
    ...rest,
    // [0] is the primary address; the order of the others carries no meaning
    addresses: [...addresses.slice(0, 1).map(addressKey), ...addresses.slice(1).map(addressKey).sort()],
    parcels: [...parcels].sort(),
    identifiers: identifiers.map((i) => `${i.type}:${i.value}:${i.relation}`).sort(),
    organizations: organizations.map((o) => `${o.role}:${o.name_key}`).sort(),
  };
}

export function contentHash(record: NormalizedRecord, issues: Issue[] = []): string {
  const blocking = issues.filter((i) => i.blocking).map((i) => [i.field, i.raw]);
  return createHash("sha256").update(stableStringify({ r: hashable(record), i: blocking })).digest("hex");
}
