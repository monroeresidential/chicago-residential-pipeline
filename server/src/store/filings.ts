import { sql } from "kysely";
import { contentHash } from "../../../shared/records/hash";
import type { IdentifierType, Kind, NormalizedRecord, OrgRole, RecordIdentifier } from "../../../shared/records/types";
import type { Db } from "../db/client";
import { rowToAddress, upsertAddress, upsertIdentifier, upsertOrganization, upsertParcel } from "./shared-values";

/** Identifier types kept (not current) when a filing stops carrying them, so renumbered matters still match. */
const KEEP_HISTORY = new Set(["record_number", "matter_key"]);

export function filingRole(kind: Kind, attributes: Record<string, unknown>): "zoning" | "hearing" | "permit" | "early_signal" {
  if (kind === "permit") return attributes.classification === "early_signal" ? "early_signal" : "permit";
  return kind === "zoning_matter" ? "zoning" : "hearing";
}

export async function writeFiling(q: Db, record: NormalizedRecord, opts: { sourceHash: string | null; sourceItemId?: number }): Promise<number> {
  const addressIds: number[] = [];
  for (const [i, a] of record.addresses.entries()) {
    const id = await upsertAddress(q, a, i === 0 ? record.point : null);
    if (!addressIds.includes(id)) addressIds.push(id);
  }
  const values = {
    kind: record.kind, source_key: record.source_key, primary_address_id: addressIds[0] ?? null,
    community_area: record.community_area, ward: record.ward, units: record.units, status: record.status,
    event_date: record.event_date, in_target: record.in_target, flag: record.flag, notes: record.notes,
    source_url: record.source_url, attributes: JSON.stringify(record.attributes),
    field_sources: JSON.stringify(record.field_sources), content_hash: contentHash(record), deleted_at: null,
  };
  const existing = await q.selectFrom("filings").select(["id", "last_source_hash"])
    .where("kind", "=", record.kind).where("source_key", "=", record.source_key).executeTakeFirst();
  let filingId: number;
  if (existing) {
    filingId = existing.id;
    await q.updateTable("filings").set({
      ...values,
      last_source_hash: opts.sourceHash ?? existing.last_source_hash,
      ...(opts.sourceItemId ? { source_item_id: opts.sourceItemId } : {}),
    }).where("id", "=", filingId).execute();
  } else {
    filingId = (await q.insertInto("filings").values({ ...values, last_source_hash: opts.sourceHash, source_item_id: opts.sourceItemId ?? null }).returning("id").executeTakeFirstOrThrow()).id;
  }

  // addresses (position 0 = primary)
  await q.deleteFrom("filing_addresses").where("filing_id", "=", filingId)
    .where("address_id", "not in", addressIds.length ? addressIds : [-1]).execute();
  for (const [position, addressId] of addressIds.entries()) {
    await q.insertInto("filing_addresses").values({ filing_id: filingId, address_id: addressId, position })
      .onConflict((oc) => oc.columns(["filing_id", "address_id"]).doUpdateSet({ position })).execute();
  }

  // parcels
  for (const pin of record.parcels) await upsertParcel(q, pin);
  await q.deleteFrom("filing_parcels").where("filing_id", "=", filingId)
    .where("pin", "not in", record.parcels.length ? record.parcels : ["-"]).execute();
  for (const pin of record.parcels) {
    await q.insertInto("filing_parcels").values({ filing_id: filingId, pin }).onConflict((oc) => oc.columns(["filing_id", "pin"]).doNothing()).execute();
  }

  // identifiers
  const wanted: { id: number; relation: string }[] = [];
  for (const i of record.identifiers) wanted.push({ id: await upsertIdentifier(q, i.type, i.value), relation: i.relation });
  const current = await q.selectFrom("filing_identifiers").innerJoin("identifiers", "identifiers.id", "filing_identifiers.identifier_id")
    .select(["filing_identifiers.identifier_id", "filing_identifiers.relation", "identifiers.type"])
    .where("filing_identifiers.filing_id", "=", filingId).execute();
  for (const row of current) {
    if (wanted.some((w) => w.id === row.identifier_id && w.relation === row.relation)) continue;
    const match = q.updateTable("filing_identifiers").where("filing_id", "=", filingId).where("identifier_id", "=", row.identifier_id).where("relation", "=", row.relation);
    // Only a filing's own past numbers are kept (renumbered matters); a removed citation is simply gone.
    if (row.relation === "self" && KEEP_HISTORY.has(row.type)) await match.set({ current: false }).execute();
    else await q.deleteFrom("filing_identifiers").where("filing_id", "=", filingId).where("identifier_id", "=", row.identifier_id).where("relation", "=", row.relation).execute();
  }
  for (const w of wanted) {
    await q.insertInto("filing_identifiers").values({ filing_id: filingId, identifier_id: w.id, relation: w.relation, current: true })
      .onConflict((oc) => oc.columns(["filing_id", "identifier_id", "relation"]).doUpdateSet({ current: true })).execute();
  }

  // organizations
  const orgRows: { id: number; role: string }[] = [];
  for (const o of record.organizations) orgRows.push({ id: await upsertOrganization(q, o.name_key, o.display_name), role: o.role });
  const existingOrgs = await q.selectFrom("filing_organizations").selectAll().where("filing_id", "=", filingId).execute();
  for (const row of existingOrgs) {
    if (!orgRows.some((o) => o.id === row.organization_id && o.role === row.role)) {
      await q.deleteFrom("filing_organizations").where("filing_id", "=", filingId).where("organization_id", "=", row.organization_id).where("role", "=", row.role).execute();
    }
  }
  for (const o of orgRows) {
    await q.insertInto("filing_organizations").values({ filing_id: filingId, organization_id: o.id, role: o.role })
      .onConflict((oc) => oc.columns(["filing_id", "organization_id", "role"]).doNothing()).execute();
  }

  await syncLinkRoles(q, filingId);

  await refreshFilingHash(q, filingId);
  return filingId;
}

export async function loadFilingRecord(q: Db, filingId: number): Promise<NormalizedRecord> {
  const f = await q.selectFrom("filings").selectAll().where("id", "=", filingId).executeTakeFirstOrThrow();
  const addressRows = await q.selectFrom("filing_addresses").innerJoin("addresses", "addresses.id", "filing_addresses.address_id")
    .select(["addresses.id", "number_from", "number_to", "predir", "street_name", "suffix", "zip",
      sql<number | null>`ST_Y(addresses.point::geometry)`.as("lat"), sql<number | null>`ST_X(addresses.point::geometry)`.as("lon")])
    .where("filing_addresses.filing_id", "=", filingId).orderBy("filing_addresses.position").execute();
  const parcels = (await q.selectFrom("filing_parcels").select("pin").where("filing_id", "=", filingId).execute()).map((r) => r.pin).sort();
  const identifiers: RecordIdentifier[] = (await q.selectFrom("filing_identifiers").innerJoin("identifiers", "identifiers.id", "filing_identifiers.identifier_id")
    .select(["identifiers.type", "identifiers.value", "filing_identifiers.relation"])
    .where("filing_identifiers.filing_id", "=", filingId).where("filing_identifiers.current", "=", true).execute())
    .map((r) => ({ type: r.type as IdentifierType, value: r.value, relation: r.relation as "self" | "cited" }))
    .sort((a, b) => `${a.type}|${a.value}|${a.relation}`.localeCompare(`${b.type}|${b.value}|${b.relation}`));
  const organizations = (await q.selectFrom("filing_organizations").innerJoin("organizations", "organizations.id", "filing_organizations.organization_id")
    .select(["filing_organizations.role", "organizations.name_key", "organizations.display_name"])
    .where("filing_organizations.filing_id", "=", filingId).execute())
    .map((r) => ({ role: r.role as OrgRole, name_key: r.name_key, display_name: r.display_name }))
    .sort((a, b) => `${a.role}|${a.name_key}`.localeCompare(`${b.role}|${b.name_key}`));
  const primary = addressRows[0];
  return {
    kind: f.kind as Kind,
    source_key: f.source_key,
    addresses: addressRows.map(rowToAddress),
    point: primary && primary.lat !== null && primary.lon !== null ? { lat: primary.lat, lon: primary.lon } : null,
    community_area: f.community_area, ward: f.ward, units: f.units, status: f.status, event_date: f.event_date,
    in_target: f.in_target, flag: f.flag, notes: f.notes, source_url: f.source_url,
    parcels, identifiers, organizations,
    attributes: f.attributes as Record<string, unknown>,
    field_sources: f.field_sources as Record<string, string>,
  };
}

/** A reclassified filing (e.g. early signal → qualifying permit) keeps its project links' roles in step. */
export async function syncLinkRoles(q: Db, filingId: number): Promise<void> {
  const f = await q.selectFrom("filings").select(["kind", "attributes"]).where("id", "=", filingId).executeTakeFirstOrThrow();
  const role = filingRole(f.kind as Kind, f.attributes as Record<string, unknown>);
  await q.updateTable("project_filings").set({ role }).where("filing_id", "=", filingId).where("role", "<>", role).execute();
}

export async function refreshFilingHash(q: Db, filingId: number): Promise<void> {
  const hash = contentHash(await loadFilingRecord(q, filingId));
  await q.updateTable("filings").set({ content_hash: hash }).where("id", "=", filingId).where("content_hash", "<>", hash).execute();
}
