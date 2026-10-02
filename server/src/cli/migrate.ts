import { resolve } from "node:path";
import { migrate } from "../db/migrate";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const applied = await migrate(url, resolve(process.env.MIGRATIONS_DIR ?? "migrations"));
console.log(applied.length ? `applied: ${applied.join(", ")}` : "migrations: up to date");
