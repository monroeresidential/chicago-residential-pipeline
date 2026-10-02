// Usage: import-csv <path to projects.csv>   (in the container: node dist/import-csv.js data/projects.csv)
import { readFileSync } from "node:fs";
import { DATA_AS_OF } from "../../../src/lib/data-meta";
import { loadConfig } from "../config";
import { createDb } from "../db/client";
import { importProjectsCsv } from "../importers/projects-csv";

const path = process.argv[2];
if (!path) throw new Error("usage: import-csv <path to projects.csv>");
const db = createDb(loadConfig().DATABASE_URL);
try {
  const r = await importProjectsCsv(db, readFileSync(path, "utf8"), DATA_AS_OF);
  console.log(`imported ${r.imported} projects (as of ${DATA_AS_OF})`);
  for (const c of r.addressChanges) console.log(`  address shown differently: ${c.id}: "${c.from}" → "${c.to}"`);
} finally {
  await db.destroy();
}
