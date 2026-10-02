import type { CanonicalAddress } from "../normalize/address";
export type { CanonicalAddress } from "../normalize/address";

export const KINDS = ["permit", "zoning_matter", "hearing_item", "zba_case"] as const;
export type Kind = (typeof KINDS)[number];

export const IDENTIFIER_TYPES = ["permit_number", "matter_key", "record_number", "elms_matter_id", "dpd_app_no", "zba_case_no"] as const;
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];

export const ORG_ROLES = ["applicant", "owner", "attorney", "contractor", "architect", "other"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const FIELD_SOURCES = ["ocr", "ward_map", "cpc_description", "permit_text", "socrata", "elms", "minutes", "decisions", "resolution"] as const;

export interface RecordIdentifier { type: IdentifierType; value: string; relation: "self" | "cited" }
export interface RecordOrganization { role: OrgRole; name_key: string; display_name: string }

export interface NormalizedRecord {
  kind: Kind;
  source_key: string;
  addresses: CanonicalAddress[]; // [0] is the primary address
  point: { lat: number; lon: number } | null; // trusted geocode from the source; stored on the address row
  community_area: number | null;
  ward: number | null;
  units: number | null;
  status: string | null;
  event_date: string | null;
  in_target: boolean;
  flag: string | null;
  notes: string | null;
  source_url: string | null;
  parcels: string[];
  identifiers: RecordIdentifier[];
  organizations: RecordOrganization[];
  attributes: Record<string, unknown>; // kind-specific fields, wire names, never a value held by a shared table
  field_sources: Record<string, string>;
}

export interface Issue { field: string; raw: unknown; message: string; blocking: boolean }
export interface NormalizeResult { record: NormalizedRecord; issues: Issue[] }

export interface WireRecord {
  kind: Kind;
  source_key: string;
  observed_at?: string;
  data: Record<string, unknown>;
  field_sources?: Record<string, string>;
}
