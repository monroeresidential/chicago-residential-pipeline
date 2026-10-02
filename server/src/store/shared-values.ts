import { sql } from "kysely";
import { addressKey, type CanonicalAddress } from "../../../shared/normalize/address";
import type { NormalizedRecord, RecordOrganization } from "../../../shared/records/types";
import { geogPoint, type Db } from "../db/client";

const notDistinct = (col: string, v: unknown) => sql<boolean>`${sql.ref(col)} is not distinct from ${v}`;

export function rowToAddress(row: { number_from: number; number_to: number; predir: string | null; street_name: string; suffix: string | null; zip: string | null }): CanonicalAddress {
  return {
    number_from: row.number_from, number_to: row.number_to, predir: row.predir as CanonicalAddress["predir"],
    street_name: row.street_name, suffix: row.suffix, zip: row.zip,
  };
}

async function followMerged(q: Db, table: "addresses" | "organizations", id: number): Promise<number> {
  let current = id;
  for (let i = 0; i < 20; i++) {
    const row = await q.selectFrom(table).select(["id", "merged_into_id"]).where("id", "=", current).executeTakeFirstOrThrow();
    if (!row.merged_into_id) return row.id;
    current = row.merged_into_id;
  }
  throw new Error(`${table} ${id}: merge chain is too long`);
}

export function findAddress(q: Db, a: CanonicalAddress) {
  return q.selectFrom("addresses").select(["id", "merged_into_id"])
    .where("number_from", "=", a.number_from).where("number_to", "=", a.number_to)
    .where(notDistinct("predir", a.predir)).where("street_name", "=", a.street_name).where(notDistinct("suffix", a.suffix))
    .executeTakeFirst();
}

export async function upsertAddress(q: Db, a: CanonicalAddress, point?: { lat: number; lon: number } | null): Promise<number> {
  const found = await findAddress(q, a);
  if (!found) {
    const row = await q.insertInto("addresses").values({
      number_from: a.number_from, number_to: a.number_to, predir: a.predir, street_name: a.street_name,
      suffix: a.suffix, zip: a.zip, point: point ? geogPoint(point.lat, point.lon) : null,
    }).returning("id").executeTakeFirstOrThrow();
    return row.id;
  }
  const id = await followMerged(q, "addresses", found.id);
  if (a.zip) await q.updateTable("addresses").set({ zip: a.zip }).where("id", "=", id).where("zip", "is", null).execute();
  if (point) await q.updateTable("addresses").set({ point: geogPoint(point.lat, point.lon) }).where("id", "=", id).where("point", "is", null).execute();
  return id;
}

export async function upsertParcel(q: Db, pin: string): Promise<void> {
  await q.insertInto("parcels").values({ pin }).onConflict((oc) => oc.column("pin").doNothing()).execute();
}

export async function upsertIdentifier(q: Db, type: string, value: string): Promise<number> {
  const inserted = await q.insertInto("identifiers").values({ type, value })
    .onConflict((oc) => oc.columns(["type", "value"]).doNothing()).returning("id").executeTakeFirst();
  if (inserted) return inserted.id;
  return (await q.selectFrom("identifiers").select("id").where("type", "=", type).where("value", "=", value).executeTakeFirstOrThrow()).id;
}

export async function upsertOrganization(q: Db, nameKey: string, displayName: string): Promise<number> {
  const found = await q.selectFrom("organizations").select("id").where("name_key", "=", nameKey).executeTakeFirst();
  if (found) return followMerged(q, "organizations", found.id);
  return (await q.insertInto("organizations").values({ name_key: nameKey, display_name: displayName }).returning("id").executeTakeFirstOrThrow()).id;
}

/** Rewrites addresses and organizations that were merged into others to the surviving canonical values. Read-only. */
export async function resolveAliases(q: Db, record: NormalizedRecord): Promise<NormalizedRecord> {
  const addresses: CanonicalAddress[] = [];
  for (const a of record.addresses) {
    const found = await findAddress(q, a);
    if (found?.merged_into_id) {
      const target = await q.selectFrom("addresses").selectAll().where("id", "=", await followMerged(q, "addresses", found.id)).executeTakeFirstOrThrow();
      addresses.push({ ...rowToAddress(target), zip: target.zip ?? a.zip });
    } else addresses.push(a);
  }
  const unique = addresses.filter((a, i) => addresses.findIndex((b) => addressKey(b) === addressKey(a)) === i);
  const orgs = new Map<string, RecordOrganization>();
  for (const o of record.organizations) {
    const found = await q.selectFrom("organizations").select(["id", "merged_into_id"]).where("name_key", "=", o.name_key).executeTakeFirst();
    let resolved = o;
    if (found?.merged_into_id) {
      const target = await q.selectFrom("organizations").select(["name_key", "display_name"]).where("id", "=", await followMerged(q, "organizations", found.id)).executeTakeFirstOrThrow();
      resolved = { role: o.role, name_key: target.name_key, display_name: target.display_name };
    }
    orgs.set(`${resolved.role}|${resolved.name_key}`, resolved);
  }
  const organizations = [...orgs.values()].sort((x, y) => `${x.role}|${x.name_key}`.localeCompare(`${y.role}|${y.name_key}`));
  return { ...record, addresses: unique, organizations };
}
