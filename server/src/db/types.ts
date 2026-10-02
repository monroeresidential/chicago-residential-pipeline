import type { ColumnType, Generated } from "kysely";

type Ts = ColumnType<Date, Date | string | undefined, Date | string>;
type TsNull = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
/** jsonb: always written as JSON.stringify(...) (pg would turn JS arrays into Postgres arrays). */
type Jsonb<T = unknown> = ColumnType<T, string | undefined, string>;
type JsonbNull<T = unknown> = ColumnType<T | null, string | null | undefined, string | null>;
/** geography: written only through geogPoint(); read through ST_X/ST_Y. */
type Geo = ColumnType<unknown, unknown, unknown>;

export interface DB {
  schema_migrations: { name: string; applied_at: Generated<Date> };
  community_areas: { number: number; name: string };
  revisions: {
    id: Generated<number>; table_name: string; record_id: string; version: number; op: string;
    before: JsonbNull; after: JsonbNull; actor: string; reason: string; at: Generated<Date>;
  };
  parcels: { pin: string; created_at: Generated<Date>; updated_at: Generated<Date>; deleted_at: TsNull };
  addresses: {
    id: Generated<number>; number_from: number; number_to: number; predir: string | null; street_name: string;
    suffix: string | null; zip: string | null; point: Geo; merged_into_id: number | null;
    created_at: Generated<Date>; updated_at: Generated<Date>; deleted_at: TsNull;
  };
  identifiers: { id: Generated<number>; type: string; value: string; created_at: Generated<Date>; updated_at: Generated<Date> };
  organizations: {
    id: Generated<number>; name_key: string; display_name: string; merged_into_id: number | null;
    created_at: Generated<Date>; updated_at: Generated<Date>; deleted_at: TsNull;
  };
  filings: {
    id: Generated<number>; kind: string; source_key: string; primary_address_id: number | null;
    community_area: number | null; ward: number | null; units: number | null; status: string | null;
    event_date: string | null; in_target: boolean; flag: string | null; notes: string | null; source_url: string | null;
    attributes: Jsonb<Record<string, unknown>>; field_sources: Jsonb<Record<string, string>>;
    content_hash: string; last_source_hash: string | null; source_item_id: number | null;
    created_at: Generated<Date>; updated_at: Generated<Date>; deleted_at: TsNull;
  };
  projects: {
    id: string; dpd_map_no: number | null; name: string | null; developer: string | null; units: number | null;
    units_source_filing_id: number | null; affordable_units: number | null; tpc_usd: number | null; program: string;
    public_support: string | null; status: string; status_note: string; flag: string | null; confidence: string;
    built_by_3f_url: string | null; point: Geo; sources: string[]; notes: string | null; visibility: Generated<string>;
    created_at: Generated<Date>; updated_at: Generated<Date>; deleted_at: TsNull;
  };
  project_addresses: { project_id: string; address_id: number; is_primary: Generated<boolean>; created_at: Generated<Date> };
  filing_addresses: { filing_id: number; address_id: number; position: number };
  filing_parcels: { filing_id: number; pin: string };
  filing_identifiers: { filing_id: number; identifier_id: number; relation: string; current: Generated<boolean> };
  filing_organizations: { filing_id: number; organization_id: number; role: string };
  project_filings: { project_id: string; filing_id: number; role: string; linked_by: string; linked_at: Generated<Date>; reason: string };
  tokens: { jti: string; sub: string; role: string; created_at: Generated<Date>; revoked_at: TsNull; last_used_at: TsNull };
  submissions: {
    id: Generated<number>; token_jti: string; idempotency_key: string; body_sha256: string;
    body: Jsonb; response: JsonbNull; received_at: Generated<Date>;
  };
  queue_items: {
    id: Generated<number>; submission_id: number; record_index: number; kind: string; source_key: string; action: string;
    proposed: Jsonb; content_hash: string; diff: Jsonb; normalization_issues: Jsonb; suggestions: Jsonb;
    in_target: boolean; has_flag: boolean; has_blocking_issues: boolean; top_strength: string | null;
    address_display: string | null; state: Generated<string>; reviewed_by: string | null; reviewed_at: TsNull;
    review_note: string | null; created_at: Generated<Date>;
  };
  bulk_previews: {
    code: string; action: string; filter: Jsonb; item_ids: number[]; link_strong: boolean; reason: string | null;
    created_by: string; expires_at: Ts;
  };
  site_state: {
    id: Generated<number>; dirty: Generated<boolean>; change_seq: Generated<number>; last_change_at: TsNull; last_build_requested_at: TsNull; last_published_at: TsNull;
  };
  job_runs: { name: string; run_date: string; at: Generated<Date> };
}
