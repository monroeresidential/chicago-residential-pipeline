import { readFileSync } from "node:fs";
import { formatMoney, formatUnits } from "../src/lib/format";
import { parseProjectsCsv } from "../src/lib/parse-projects";
import { STATUS_LABELS, STATUSES } from "../src/lib/schema";
import { countByStatus, totals } from "../src/lib/stats";

const { projects, errors } = parseProjectsCsv(readFileSync("data/projects.csv", "utf8"));
if (errors.length > 0) {
  console.error(`data/projects.csv has ${errors.length} error(s):`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

const all = totals(projects);
const dpd = totals(projects.filter((p) => p.confidence === "dpd"));
console.log(`All projects:  ${all.count}  ·  ${formatUnits(all.units)} units  ·  ${formatMoney(all.tpcMusd)} TPC`);
console.log(`DPD map only:  ${dpd.count}  ·  ${formatUnits(dpd.units)} units  ·  ${formatMoney(dpd.tpcMusd)} TPC  (DPD publishes 3,930+ / $1.8B)`);
const counts = countByStatus(projects);
for (const s of STATUSES) console.log(`  ${STATUS_LABELS[s].padEnd(20)} ${counts[s]}`);
