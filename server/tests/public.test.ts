import { sql } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toFeatureCollection } from "../../src/lib/geojson";
import { normalizeRecord } from "../../shared/records/normalize-record";
import { permitRecord, zoningRecord } from "../../shared/tests/fixtures";
import { withActor } from "../src/db/actor";
import { DEBOUNCE_MS, publishNow, runPublishTick, triggerSiteBuild } from "../src/publish/trigger";
import { getAsOf, listProjects, projectStats, publicFilings } from "../src/read/public";
import { linkFiling } from "../src/store/edit";
import { writeFiling } from "../src/store/filings";
import { createProjectRow } from "../src/store/projects";
import { chicagoParts } from "../src/time";
import { testConfig } from "./helpers/app";
import { getTestDb, resetDb } from "./helpers/db";

const db = getTestDb();
beforeEach(() => resetDb(db));
const base = { name: "Harris Bank building", address: "111 W. Monroe St", program: "lasalle" as const, status: "approved" as const,
  status_note: "Approved", confidence: "dpd" as const, lat: 41.880635, lng: -87.631098, sources: ["https://example.com/a"], tpc_musd: 179, units: 345 };

async function seed() {
  await withActor(db, "drew", "admin_edit", async (q) => {
    await createProjectRow(q, { ...base, id: "111-w-monroe", visibility: "published" });
    await createProjectRow(q, { ...base, id: "secret", visibility: "draft" });
    await createProjectRow(q, { ...base, id: "gone", visibility: "published" });
    await q.updateTable("projects").set({ deleted_at: new Date() }).where("id", "=", "gone").execute();
    const z = await writeFiling(q, normalizeRecord(zoningRecord()).record, { sourceHash: null });
    await writeFiling(q, normalizeRecord(permitRecord()).record, { sourceHash: null }); // not linked
    await linkFiling(q, "111-w-monroe", z, "drew", "manual");
  });
}

describe("listProjects", () => {
  it("returns only published, live projects in the site's Project shape", async () => {
    await seed();
    const projects = await listProjects(db);
    expect(projects.map((p) => p.id)).toEqual(["111-w-monroe"]);
    expect(projects[0]).toMatchObject({ address: "111 W. Monroe St", tpc_musd: 179, lat: 41.880635, lng: -87.631098, units: 345 });
    expect(projects[0]).not.toHaveProperty("filings");
  });

  it("includes drafts only when asked", async () => {
    await seed();
    expect((await listProjects(db, { includeDrafts: true })).map((p) => [p.id, p.visibility]).sort()).toEqual([["111-w-monroe", "published"], ["secret", "draft"]]);
  });

  it("attaches only linked, live filings with a summary and no private links", async () => {
    await seed();
    const [p] = await listProjects(db, { includeFilings: true });
    expect(p!.filings).toEqual([{
      kind: "zoning_matter", source_key: "O2026-0023894", role: "zoning", event_date: "2026-03-18",
      status: "In Committee - Referred", units: 345, summary: "Zoning DC-16 → PD, In Committee - Referred",
      source_url: "https://chicityclerkelms.chicago.gov/Matter/?matterId=example",
    }]);
    expect(JSON.stringify(p)).not.toContain("drive.google");
  });

  it("the filings query itself only returns filings of live, published projects", async () => {
    await seed();
    const z2 = await withActor(db, "drew", "admin_edit", async (q) => {
      const id = await writeFiling(q, normalizeRecord(zoningRecord({ record_number: "O2026-0099999" })).record, { sourceHash: null });
      await linkFiling(q, "secret", id, "drew", "manual");
      return id;
    });
    expect(z2).toBeGreaterThan(0);
    expect((await publicFilings(db, ["secret", "gone"], false)).length).toBe(0);
    expect((await publicFilings(db, ["secret"], true)).length).toBe(1);
  });

  it("feeds the existing GeoJSON builder and stats", async () => {
    await seed();
    const projects = await listProjects(db);
    expect(toFeatureCollection(projects, "2026-10-02").features[0]!.properties.id).toBe("111-w-monroe");
    expect(projectStats(projects)).toMatchObject({ count: 1, units: 345, tpcMusd: 179, by_status: { approved: 1 } });
  });

  it("as_of is the Chicago date of the last publish", async () => {
    expect(await getAsOf(db)).toBe("1970-01-01");
    await sql`update site_state set last_published_at = '2026-10-02T03:00:00Z'`.execute(db);
    expect(await getAsOf(db)).toBe("2026-10-01");
  });
});

describe("publishing", () => {
  const changeAt = (iso: string) => sql`update site_state set dirty = true, last_change_at = ${iso}`.execute(db);

  it("waits 10 minutes after the last change, then triggers once", async () => {
    const trigger = vi.fn(async () => "sent" as const);
    await changeAt("2026-10-02T15:00:00Z");
    expect(await runPublishTick(db, testConfig, new Date("2026-10-02T15:05:00Z"), trigger)).toBe(false);
    expect(await runPublishTick(db, testConfig, new Date(Date.parse("2026-10-02T15:00:00Z") + DEBOUNCE_MS), trigger)).toBe(true);
    expect(await runPublishTick(db, testConfig, new Date("2026-10-02T15:30:00Z"), trigger)).toBe(false);
    expect(trigger).toHaveBeenCalledTimes(1);
    const s = await db.selectFrom("site_state").selectAll().executeTakeFirstOrThrow();
    expect(s.dirty).toBe(false);
    expect(s.last_published_at?.toISOString()).toBe("2026-10-02T15:00:00.000Z");
  });

  it("stays dirty when the trigger fails", async () => {
    await changeAt("2026-10-02T15:00:00Z");
    await expect(runPublishTick(db, testConfig, new Date("2026-10-02T16:00:00Z"), async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect((await db.selectFrom("site_state").select("dirty").executeTakeFirstOrThrow()).dirty).toBe(true);
  });

  it("publishNow keeps the pending rebuild when the hook fails", async () => {
    await changeAt("2026-10-02T15:00:00Z");
    await expect(publishNow(db, testConfig, new Date("2026-10-02T15:01:00Z"), async () => { throw new Error("hook down"); })).rejects.toThrow("hook down");
    const st = await db.selectFrom("site_state").selectAll().executeTakeFirstOrThrow();
    expect(st.dirty).toBe(true);
    expect(st.last_published_at).toBeNull();
  });

  it("publishNow keeps a change committed while the hook ran, even from an earlier-started transaction", async () => {
    await changeAt("2026-10-02T15:00:00Z");
    await publishNow(db, testConfig, new Date("2026-10-02T15:01:00Z"), async () => {
      // an edit whose transaction began before the publish (older timestamp) commits during the hook
      await sql`update site_state set dirty = true, last_change_at = '2026-10-02T15:00:30Z', change_seq = change_seq + 1`.execute(db);
      return "sent";
    });
    expect((await db.selectFrom("site_state").select("dirty").executeTakeFirstOrThrow()).dirty).toBe(true);
  });

  it("publishNow triggers immediately", async () => {
    const trigger = vi.fn(async () => "sent" as const);
    expect(await publishNow(db, testConfig, new Date("2026-10-02T15:00:00Z"), trigger)).toBe("sent");
    expect(trigger).toHaveBeenCalledOnce();
  });

  it("triggerSiteBuild skips without a hook and POSTs with the token when configured", async () => {
    expect(await triggerSiteBuild(testConfig)).toBe("skipped");
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
    await triggerSiteBuild({ ...testConfig, SITE_BUILD_HOOK_URL: "https://hooks.example/build", SITE_BUILD_HOOK_TOKEN: "t" }, fetchFn as unknown as typeof fetch);
    expect(fetchFn).toHaveBeenCalledWith("https://hooks.example/build", { method: "POST", headers: { Authorization: "Bearer t" } });
  });
});

describe("chicagoParts", () => {
  it("uses Chicago local time across DST", () => {
    expect(chicagoParts(new Date("2026-10-02T14:30:00Z"))).toEqual({ date: "2026-10-02", minutes: 9 * 60 + 30 });
    expect(chicagoParts(new Date("2026-01-15T15:30:00Z"))).toEqual({ date: "2026-01-15", minutes: 9 * 60 + 30 });
  });
});
