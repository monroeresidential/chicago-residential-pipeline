import { sql } from "kysely";
import { addressKey, formatAddressDisplay } from "../../../shared/normalize/address";
import { looseOrgKey } from "../../../shared/normalize/primitives";
import type { NormalizedRecord } from "../../../shared/records/types";
import type { Db } from "../db/client";
import { findAddress } from "../store/shared-values";

export interface DuplicateSuggestion { type: "organization" | "address"; value: string; candidates: { id: number; display: string }[] }

/** Shared values in this record that look like an existing row spelled differently. Never merges anything. */
export async function suggestDuplicates(q: Db, record: NormalizedRecord): Promise<DuplicateSuggestion[]> {
  const out: DuplicateSuggestion[] = [];
  for (const key of new Set(record.organizations.map((o) => o.name_key))) {
    const exact = await q.selectFrom("organizations").select("id").where("name_key", "=", key).executeTakeFirst();
    if (exact) continue;
    const loose = looseOrgKey(key);
    const rows = await q.selectFrom("organizations").select(["id", "name_key", "display_name"])
      .where("deleted_at", "is", null)
      .where((eb) => eb.or([
        eb(sql<number>`levenshtein(left(name_key, 250), left(${key}, 250))`, "<=", 2),
        eb("name_key", "like", `${loose}%`),
      ]))
      .limit(5).execute();
    const candidates = rows.filter((r) => r.name_key !== key).map((r) => ({ id: r.id, display: r.display_name }));
    if (candidates.length) out.push({ type: "organization", value: key, candidates });
  }
  for (const a of record.addresses) {
    if (await findAddress(q, a)) continue;
    const rows = await q.selectFrom("addresses").select(["id", "number_from", "number_to", "predir", "street_name", "suffix", "zip"])
      .where("street_name", "=", a.street_name).where(sql<boolean>`predir is not distinct from ${a.predir}`)
      .where("number_from", "<=", a.number_to).where("number_to", ">=", a.number_from)
      .where("deleted_at", "is", null).limit(5).execute();
    const candidates = rows.map((r) => ({ id: r.id, display: formatAddressDisplay({ ...r, predir: r.predir as "N" | "S" | "E" | "W" | null }) }));
    if (candidates.length) out.push({ type: "address", value: addressKey(a), candidates });
  }
  return out;
}
