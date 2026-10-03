// Refreshes shared/data/streets.json from the Chicago Data Portal "Chicago Street Names" dataset (i6bp-fvbx).
// Each row: [direction, street, suffix, min_address, max_address]. Run: pnpm streets:fetch
import { writeFileSync } from "node:fs";

const res = await fetch("https://data.cityofchicago.org/resource/i6bp-fvbx.json?$limit=10000");
if (!res.ok) throw new Error(`street list: HTTP ${res.status}`);
const rows = (await res.json()) as { direction?: string; street: string; suffix?: string; min_address: string; max_address: string }[];
const out = rows
  .map((r) => [(r.direction ?? "").trim(), r.street.trim(), (r.suffix ?? "").trim(), Number(r.min_address), Number(r.max_address)] as const)
  .sort((a, b) => a.join("|").localeCompare(b.join("|")));
writeFileSync("shared/data/streets.json", JSON.stringify(out).replace(/\],\[/g, "],\n[") + "\n");
console.log(`wrote ${out.length} streets`);
