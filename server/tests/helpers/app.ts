import type { Config } from "../../src/config";
import { MIGRATIONS_DIR, TEST_DATABASE_URL } from "./db";

export const testConfig: Config = {
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: "test-secret-that-is-at-least-32-characters",
  PORT: 0,
  MIGRATIONS_DIR,
};
