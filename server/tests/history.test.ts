import { sql } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";
import { withActor } from "../src/db/actor";
import { getTestDb, resetDb } from "./helpers/db";

const db = getTestDb();
beforeEach(() => resetDb(db));

const revisions = () => db.selectFrom("revisions").selectAll().orderBy("id").execute();

describe("history trigger", () => {
  it("refuses writes without an actor", async () => {
    await expect(db.insertInto("parcels").values({ pin: "17161230040000" }).execute()).rejects.toThrow(/app\.actor/);
  });

  it("records inserts, updates, soft deletes and restores with actor and reason", async () => {
    await withActor(db, "drew", "admin_edit", (q) =>
      q.insertInto("organizations").values({ name_key: "ACME LLC", display_name: "Acme LLC" }).execute());
    await withActor(db, "drew", "admin_edit", (q) =>
      q.updateTable("organizations").set({ display_name: "Acme, LLC" }).where("name_key", "=", "ACME LLC").execute());
    await withActor(db, "drew", "admin_edit", (q) =>
      q.updateTable("organizations").set({ deleted_at: new Date() }).where("name_key", "=", "ACME LLC").execute());
    await withActor(db, "grok", "queue_item:9", (q) =>
      q.updateTable("organizations").set({ deleted_at: null }).where("name_key", "=", "ACME LLC").execute());

    const rows = await revisions();
    expect(rows.map((r) => [r.table_name, r.version, r.op, r.actor, r.reason])).toEqual([
      ["organizations", 1, "insert", "drew", "admin_edit"],
      ["organizations", 2, "update", "drew", "admin_edit"],
      ["organizations", 3, "delete", "drew", "admin_edit"],
      ["organizations", 4, "restore", "grok", "queue_item:9"],
    ]);
    expect((rows[1]!.before as { display_name: string }).display_name).toBe("Acme LLC");
    expect((rows[1]!.after as { display_name: string }).display_name).toBe("Acme, LLC");
  });

  it("ignores updates that change nothing but updated_at", async () => {
    await withActor(db, "drew", "admin_edit", async (q) => {
      await q.insertInto("parcels").values({ pin: "17161230040000" }).execute();
      await q.updateTable("parcels").set({ pin: "17161230040000" }).execute();
    });
    expect((await revisions()).length).toBe(1);
  });

  it("marks merges and keys composite rows by all key columns", async () => {
    await withActor(db, "drew", "merge:organization:2->1", async (q) => {
      await q.insertInto("parcels").values({ pin: "17161230040000" }).execute();
    });
    const [rev] = await revisions();
    expect(rev!.op).toBe("merge");
    expect(rev!.record_id).toBe("17161230040000");
  });

  it("rejects an empty-string address suffix (null means none)", async () => {
    await expect(withActor(db, "drew", "admin_edit", (q) =>
      q.insertInto("addresses").values({ number_from: 1, number_to: 1, predir: "N", street_name: "BROADWAY", suffix: "" }).execute())).rejects.toThrow(/check/);
  });

  it("allows only one site_state row", async () => {
    await expect(sql`insert into site_state (id) values (2)`.execute(db)).rejects.toThrow();
  });
});
