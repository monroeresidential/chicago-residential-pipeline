import { sql } from "kysely";
import { z } from "zod";
import { normalizeAddress } from "../../../shared/normalize/address";
import { ProjectSchema } from "../../../src/lib/schema";
import { geogPoint, type Db } from "../db/client";
import { HttpError } from "../errors";
import { upsertAddress } from "./shared-values";

const Visibility = z.enum(["draft", "published"]);

const UnitsSource = z.number().int().positive().nullable();

export const ProjectCreateInput = ProjectSchema.extend({
  units_source_filing_id: UnitsSource.optional(),
  visibility: Visibility.default("draft"),
  confidence: z.enum(["dpd", "reported"]).default("reported"),
}).partial({
  dpd_map_no: true, name: true, developer: true, units: true, affordable_units: true, tpc_musd: true,
  public_support: true, flag: true, built_by_3f_url: true, notes: true,
});
export type ProjectCreate = z.input<typeof ProjectCreateInput>;

export const ProjectPatch = ProjectSchema.omit({ id: true }).extend({ visibility: Visibility, units_source_filing_id: UnitsSource }).partial().strict();

/** The filing a curated unit count came from must exist and be live. */
async function checkUnitsSource(q: Db, filingId: number | null | undefined): Promise<void> {
  if (filingId == null) return;
  const f = await q.selectFrom("filings").select("id").where("id", "=", filingId).where("deleted_at", "is", null).executeTakeFirst();
  if (!f) throw new HttpError(422, `units_source_filing_id ${filingId} is not a live filing`);
}
export type ProjectPatchInput = z.infer<typeof ProjectPatch>;

const toUsd = (musd: number | null | undefined) => (musd == null ? null : Math.round(musd * 1_000_000));

async function canonicalAddressId(q: Db, raw: string, point: { lat: number; lon: number }): Promise<number> {
  const a = normalizeAddress(raw);
  if (!a.ok) throw new HttpError(422, `address: ${a.message}`);
  return upsertAddress(q, a.value, point);
}

export async function createProjectRow(q: Db, raw: ProjectCreate): Promise<void> {
  const parsed = ProjectCreateInput.safeParse(raw);
  if (!parsed.success) throw new HttpError(422, "invalid project", parsed.error.issues);
  const p = parsed.data;
  if (await q.selectFrom("projects").select("id").where("id", "=", p.id).executeTakeFirst()) {
    throw new HttpError(409, `project ${p.id} already exists`);
  }
  await checkUnitsSource(q, p.units_source_filing_id);
  const addressId = await canonicalAddressId(q, p.address, { lat: p.lat, lon: p.lng });
  await q.insertInto("projects").values({
    id: p.id, dpd_map_no: p.dpd_map_no ?? null, name: p.name ?? null, developer: p.developer ?? null,
    units: p.units ?? null, affordable_units: p.affordable_units ?? null, tpc_usd: toUsd(p.tpc_musd),
    program: p.program, public_support: p.public_support ?? null, status: p.status, status_note: p.status_note,
    flag: p.flag ?? null, confidence: p.confidence, built_by_3f_url: p.built_by_3f_url ?? null,
    units_source_filing_id: p.units_source_filing_id ?? null,
    point: geogPoint(p.lat, p.lng), sources: p.sources, notes: p.notes ?? null, visibility: p.visibility,
  }).execute();
  await q.insertInto("project_addresses").values({ project_id: p.id, address_id: addressId }).execute();
}

async function liveProject(q: Db, id: string) {
  const row = await q.selectFrom("projects")
    .select(["id", sql<number>`ST_Y(point::geometry)`.as("lat"), sql<number>`ST_X(point::geometry)`.as("lng")])
    .where("id", "=", id).where("deleted_at", "is", null).executeTakeFirst();
  if (!row) throw new HttpError(404, `no project ${id}`);
  return row;
}

export async function updateProjectRow(q: Db, id: string, raw: ProjectPatchInput): Promise<void> {
  const parsed = ProjectPatch.safeParse(raw);
  if (!parsed.success) throw new HttpError(422, "invalid project patch", parsed.error.issues);
  const { address, lat, lng, tpc_musd, ...rest } = parsed.data;
  await checkUnitsSource(q, rest.units_source_filing_id);
  const current = await liveProject(q, id);
  const nextLat = lat ?? current.lat;
  const nextLng = lng ?? current.lng;
  const set: Record<string, unknown> = { ...rest };
  if (tpc_musd !== undefined) set.tpc_usd = toUsd(tpc_musd);
  if (lat !== undefined || lng !== undefined) set.point = geogPoint(nextLat, nextLng);
  if (Object.keys(set).length) await q.updateTable("projects").set(set).where("id", "=", id).execute();
  if (address !== undefined) {
    const addressId = await canonicalAddressId(q, address, { lat: nextLat, lon: nextLng });
    const primary = await q.selectFrom("project_addresses").select("address_id").where("project_id", "=", id).where("is_primary", "=", true).executeTakeFirst();
    if (primary?.address_id !== addressId) {
      await q.deleteFrom("project_addresses").where("project_id", "=", id).where("is_primary", "=", true).execute();
      await q.insertInto("project_addresses").values({ project_id: id, address_id: addressId }).execute();
    }
  }
}

export async function setProjectDeleted(q: Db, id: string, deleted: boolean): Promise<void> {
  const r = await q.updateTable("projects").set({ deleted_at: deleted ? new Date() : null })
    .where("id", "=", id).where("deleted_at", deleted ? "is" : "is not", null).executeTakeFirst();
  if (Number(r.numUpdatedRows) !== 1) throw new HttpError(404, deleted ? `no live project ${id}` : `no deleted project ${id}`);
}
