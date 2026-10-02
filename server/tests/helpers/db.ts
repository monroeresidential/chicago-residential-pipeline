import { fileURLToPath } from "node:url";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://pipeline:pipeline@localhost:5433/pipeline_test";
export const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations", import.meta.url));
