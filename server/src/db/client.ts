import { Kysely, PostgresDialect, sql, type RawBuilder } from "kysely";
import pg from "pg";
import type { DB } from "./types";

pg.types.setTypeParser(20, (v) => Number(v)); // int8 ids and dollar amounts fit in a double
pg.types.setTypeParser(1082, (v) => v); // date stays "YYYY-MM-DD"

export type Db = Kysely<DB>;

export function createDb(url: string): Db {
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 10 }) }) });
}

export function geogPoint(lat: number, lon: number): RawBuilder<unknown> {
  return sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography`;
}
