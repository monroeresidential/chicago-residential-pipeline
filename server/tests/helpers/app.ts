import type { Config } from "../../src/config";
import { MIGRATIONS_DIR, TEST_DATABASE_URL } from "./db";
import { issueToken } from "../../src/auth/tokens";
import { createApp } from "../../src/http/app";
import { getTestDb, resetDb } from "./db";

export const testConfig: Config = {
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: "test-secret-that-is-at-least-32-characters",
  PORT: 0,
  MIGRATIONS_DIR,
};

export async function makeApp() {
  const db = getTestDb();
  await resetDb(db);
  const app = createApp({ db, config: testConfig });
  const grok = (await issueToken(db, testConfig.JWT_SECRET, "grok", "submitter")).token;
  const drew = (await issueToken(db, testConfig.JWT_SECRET, "drew", "editor")).token;
  return { app, db, grok, drew };
}

export function postJson(app: ReturnType<typeof createApp>, path: string, body: unknown, token?: string, headers: Record<string, string> = {}, method = "POST") {
  return app.request(path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
