// Usage: replay <submission_id> [--write]   Dry run by default: shows how today's code would treat a past Grok push.
import { loadConfig } from "../config";
import { createDb } from "../db/client";
import { replaySubmission } from "../intake/replay";

const id = Number(process.argv[2]);
if (!Number.isInteger(id)) throw new Error("usage: replay <submission_id> [--write]");
const db = createDb(loadConfig().DATABASE_URL);
try {
  const r = await replaySubmission(db, id, { write: process.argv.includes("--write") });
  console.log("outcomes:", r.counts);
  if (r.changed.length) console.table(r.changed);
  else console.log("no record changed outcome compared with the original response");
} finally {
  await db.destroy();
}
