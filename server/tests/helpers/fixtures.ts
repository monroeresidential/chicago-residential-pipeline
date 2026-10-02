import { normalizeAddress } from "../../../shared/normalize/address";
import type { Status } from "../../../shared/constants";
import { geogPoint, type Db } from "../../src/db/client";
import { upsertAddress } from "../../src/store/shared-values";

export async function insertProject(
  q: Db,
  p: { id: string; lat: number; lng: number; status?: Status; name?: string; address?: string; visibility?: "draft" | "published" },
): Promise<void> {
  await q.insertInto("projects").values({
    id: p.id, name: p.name ?? p.id, program: "private", status: p.status ?? "planning", status_note: "test",
    confidence: "reported", point: geogPoint(p.lat, p.lng), sources: ["https://example.com/source"],
    visibility: p.visibility ?? "published",
  }).execute();
  if (p.address) {
    const a = normalizeAddress(p.address);
    if (!a.ok) throw new Error(a.message);
    const addressId = await upsertAddress(q, a.value);
    await q.insertInto("project_addresses").values({ project_id: p.id, address_id: addressId }).execute();
  }
}

export async function linkForTest(q: Db, projectId: string, filingId: number): Promise<void> {
  await q.insertInto("project_filings").values({ project_id: projectId, filing_id: filingId, role: "zoning", linked_by: "test", reason: "test" }).execute();
}
