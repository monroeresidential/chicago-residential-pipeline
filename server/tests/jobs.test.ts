import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueToken } from "../src/auth/tokens";
import { checkMissedRun, resendMailer } from "../src/jobs/missed-run";
import { testConfig } from "./helpers/app";
import { getTestDb, resetDb } from "./helpers/db";

const db = getTestDb();
beforeEach(() => resetDb(db));
const at = (iso: string) => new Date(iso); // October 2026 is CDT (UTC-5): 14:31Z = 9:31 CT

async function submissionAt(role: "submitter" | "editor", iso: string) {
  const { jti } = await issueToken(db, testConfig.JWT_SECRET, role === "submitter" ? "grok" : "drew", role);
  await db.insertInto("submissions").values({ token_jti: jti, idempotency_key: iso, body_sha256: "x", body: "{}", received_at: new Date(iso) }).execute();
}

describe("checkMissedRun", () => {
  it("does nothing before 9:30 Chicago time", async () => {
    expect(await checkMissedRun(db, vi.fn(), at("2026-10-02T14:29:00Z"))).toBe("too-early");
  });

  it("emails once when Grok has not submitted today", async () => {
    const mailer = vi.fn(async (_subject: string, _text: string) => {});
    expect(await checkMissedRun(db, mailer, at("2026-10-02T14:31:00Z"))).toBe("sent");
    expect(await checkMissedRun(db, mailer, at("2026-10-02T15:00:00Z"))).toBe("already-sent");
    expect(mailer).toHaveBeenCalledOnce();
    expect(mailer.mock.calls[0]![0]).toContain("2026-10-02");
  });

  it("is satisfied by a Grok submission today, not by an editor's or yesterday's", async () => {
    await submissionAt("editor", "2026-10-02T13:00:00Z");
    await submissionAt("submitter", "2026-10-02T04:00:00Z"); // 23:00 CT on Oct 1
    expect(await checkMissedRun(db, vi.fn(async () => {}), at("2026-10-02T14:31:00Z"))).toBe("sent");
    await resetDb(db);
    await submissionAt("submitter", "2026-10-02T12:45:00Z");
    expect(await checkMissedRun(db, vi.fn(), at("2026-10-02T14:31:00Z"))).toBe("ok");
  });

  it("retries on the next tick when the email fails", async () => {
    await expect(checkMissedRun(db, async () => { throw new Error("smtp down"); }, at("2026-10-02T14:31:00Z"))).rejects.toThrow("smtp down");
    expect(await checkMissedRun(db, vi.fn(async () => {}), at("2026-10-02T14:32:00Z"))).toBe("sent");
  });

  it("reports when no mailer is configured", async () => {
    expect(resendMailer(testConfig)).toBeNull();
    expect(await checkMissedRun(db, null, at("2026-10-02T14:31:00Z"))).toBe("no-mailer");
  });
});
