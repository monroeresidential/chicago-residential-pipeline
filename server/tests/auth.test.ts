import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { authenticate, requireRole, type AppEnv } from "../src/auth/middleware";
import { issueToken, revokeToken, verifyToken } from "../src/auth/tokens";
import { loadConfig } from "../src/config";
import { testConfig } from "./helpers/app";
import { getTestDb, resetDb } from "./helpers/db";

const db = getTestDb();
beforeEach(() => resetDb(db));

function app() {
  const a = new Hono<AppEnv>();
  a.use("*", authenticate({ db, config: testConfig }));
  a.get("/who", (c) => c.json({ principal: c.get("principal") }));
  a.get("/editor", requireRole("editor"), (c) => c.text("ok"));
  a.get("/submit", requireRole("submitter"), (c) => c.text("ok"));
  return a;
}
const get = (path: string, token?: string) =>
  app().request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

describe("tokens", () => {
  it("issues, verifies and revokes", async () => {
    const { token, jti } = await issueToken(db, testConfig.JWT_SECRET, "grok", "submitter");
    expect(await verifyToken(db, testConfig.JWT_SECRET, token)).toEqual({ sub: "grok", role: "submitter", jti });
    expect(await revokeToken(db, jti)).toBe(true);
    expect(await verifyToken(db, testConfig.JWT_SECRET, token)).toBeNull();
  });

  it("rejects tokens signed with another secret or not in the table", async () => {
    const { token, jti } = await issueToken(db, testConfig.JWT_SECRET, "drew", "editor");
    expect(await verifyToken(db, "another-secret-another-secret-another", token)).toBeNull();
    await db.deleteFrom("tokens").where("jti", "=", jti).execute();
    expect(await verifyToken(db, testConfig.JWT_SECRET, token)).toBeNull();
  });

  it("never stores the token itself", async () => {
    const { token } = await issueToken(db, testConfig.JWT_SECRET, "grok", "submitter");
    const row = await db.selectFrom("tokens").selectAll().executeTakeFirstOrThrow();
    expect(JSON.stringify(row)).not.toContain(token);
  });
});

describe("middleware", () => {
  it("treats a missing header as anonymous", async () => {
    expect(await (await get("/who")).json()).toEqual({ principal: null });
  });

  it("401s an invalid token even on public routes", async () => {
    expect((await get("/who", "garbage")).status).toBe(401);
  });

  it("enforces roles: anonymous 401, submitter 403 on editor routes, editor allowed everywhere", async () => {
    const grok = (await issueToken(db, testConfig.JWT_SECRET, "grok", "submitter")).token;
    const drew = (await issueToken(db, testConfig.JWT_SECRET, "drew", "editor")).token;
    expect((await get("/editor")).status).toBe(401);
    expect((await get("/editor", grok)).status).toBe(403);
    expect((await get("/editor", drew)).status).toBe(200);
    expect((await get("/submit", grok)).status).toBe(200);
    expect((await get("/submit", drew)).status).toBe(200);
  });
});

describe("config", () => {
  it("requires a long JWT secret", () => {
    expect(() => loadConfig({ DATABASE_URL: "postgres://x@y/z", JWT_SECRET: "short" })).toThrow(/JWT_SECRET/);
  });
});
