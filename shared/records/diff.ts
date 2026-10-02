import { addressKey } from "../normalize/address";
import { stableStringify } from "./hash";
import type { NormalizedRecord } from "./types";

type Flat = Record<string, unknown>;

function flatten(r: NormalizedRecord): Flat {
  const { kind: _k, source_key: _s, point: _p, field_sources: _f, attributes, addresses, organizations, identifiers, ...scalars } = r;
  return {
    ...scalars,
    ...attributes,
    address: addresses[0] ? addressKey(addresses[0]) : null,
    additional_addresses: addresses.slice(1).map(addressKey),
    organizations: organizations.map((o) => `${o.role}: ${o.display_name}`).sort(),
    organization_keys: organizations.map((o) => `${o.role}:${o.name_key}`).sort(),
    identifiers: identifiers.map((i) => `${i.type}:${i.value}${i.relation === "cited" ? " (cited)" : ""}`).sort(),
  };
}

const empty = (v: unknown) => v === null || v === undefined || (Array.isArray(v) && v.length === 0);

/** Field-by-field changes. Organization display names are shown, but only name-key changes count. */
export function diffRecords(before: NormalizedRecord | null, after: NormalizedRecord): Record<string, { before: unknown; after: unknown }> {
  const a = before ? flatten(before) : {};
  const b = flatten(after);
  const out: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === "organizations") continue;
    const x = a[key] ?? null;
    const y = b[key] ?? null;
    if (!before && empty(y)) continue;
    if (stableStringify(x) !== stableStringify(y)) {
      out[key === "organization_keys" ? "organizations" : key] =
        key === "organization_keys" ? { before: a.organizations ?? [], after: b.organizations } : { before: x, after: y };
    }
  }
  return out;
}
