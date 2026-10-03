import { z } from "zod";
import { FIELD_SOURCES, KINDS } from "./types";

export const MAX_RECORDS = 500;

const isRealDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD").refine(isRealDate, "not a real date");
const req = z.string().trim().min(1);
const str = z.string().nullish(); // "" is accepted and treated as null by the normalizer
const int = z.number().int();
const count = int.min(0).nullish();
const bool = z.boolean().nullish();
const url = z.url().nullish();
const lat = z.number().min(41.6).max(42.1).nullish();
const lon = z.number().min(-87.95).max(-87.5).nullish();

const location = {
  zip: str,
  community_area: z.union([z.string(), int]).nullish(),
  ward: int.min(1).max(50).nullish(),
  lat,
  lon,
  notes: str,
};

export const PermitData = z.strictObject({
  permit_number: req,
  classification: z.enum(["qualifying_20plus", "early_signal"]),
  issue_date: date,
  permit_type: str,
  address: req,
  ...location,
  units: z.strictObject({ total: count, dwelling: count, efficiency: count, affordable: count }).nullish(),
  unit_flag: str,
  reported_cost: count,
  contacts: z.array(z.strictObject({ role: req, name: req })).nullish(),
  short_description: str,
  work_description: str,
  permit_status: str,
  permit_condition: str,
  pin_list: z.array(z.string()).nullish(),
  portal_url: url,
  scope: str,
  in_target: z.boolean(),
});

export const ZoningMatterData = z.strictObject({
  record_number: req,
  matter_id: str,
  dpd_app_no: str,
  title: str,
  filed_date: date.nullish(),
  introduced_date: date.nullish(),
  hearing_date: date.nullish(),
  address: str,
  additional_addresses: z.array(z.string()).nullish(),
  ...location,
  applicant: str,
  owner: str,
  attorney: str,
  zoning_from: str,
  zoning_to: str,
  lot_size_sqft: count,
  units: count,
  height_ft: z.number().min(0).nullish(),
  parking: count,
  aro: bool,
  pd: bool,
  aldermanic: bool,
  status: req,
  flag: str,
  source_url: z.url(),
  drive_pdf_url: url,
  in_target: z.boolean(),
});

export const HearingItemData = z.strictObject({
  body: z.literal("cpc"),
  hearing_date: date,
  dpd_app_no: str,
  matter_key: str,
  address: req,
  ...location,
  applicant: str,
  request: str,
  zoning_from: str,
  zoning_to: str,
  units: count,
  height_ft: z.number().min(0).nullish(),
  parking: count,
  pd: bool,
  source_url: z.url(),
  in_target: z.boolean(),
});

export const ZbaCaseData = z.strictObject({
  case_no: req,
  request_type: str,
  first_hearing: date.nullish(),
  hearing_date: date.nullish(),
  address: req,
  ...location,
  applicant: str,
  owner: str,
  attorney: str,
  zoning_district: str,
  request: str,
  units: count,
  residential: bool,
  outcome: str,
  vote: str,
  decision_date: date.nullish(),
  hearings: z
    .array(z.strictObject({ date, outcome: str, vote: str, continued_to: date.nullish(), source_url: url }))
    .nullish(),
  source_pdf_url: url,
  resolution_pdf_url: url,
  flag: str,
  in_target: z.boolean(),
});

export const DATA_SCHEMAS = {
  permit: PermitData,
  zoning_matter: ZoningMatterData,
  hearing_item: HearingItemData,
  zba_case: ZbaCaseData,
} as const;

export const RecordEnvelope = z.strictObject({
  kind: z.enum(KINDS),
  source_key: req,
  observed_at: z.iso.datetime({ offset: true }),
  data: z.record(z.string(), z.unknown()),
  field_sources: z.record(z.string(), z.enum(FIELD_SOURCES)).optional(),
});

export const SubmissionEnvelope = z.strictObject({
  run: z.strictObject({
    program: z.enum(["permits", "zoning", "permits-backfill", "zoning-backfill"]),
    run_id: req,
    started_at: z.iso.datetime({ offset: true }),
    bot_version: str,
  }),
  records: z.array(z.unknown()),
});

/** JSON Schema of a whole submission, records typed by kind — served at /v1/schema/submission.json. */
export function submissionJsonSchema(): object {
  const typed = (kind: (typeof KINDS)[number], data: z.ZodType) =>
    RecordEnvelope.extend({ kind: z.literal(kind), data });
  const schema = SubmissionEnvelope.extend({
    records: z
      .array(z.discriminatedUnion("kind", [
        typed("permit", PermitData), typed("zoning_matter", ZoningMatterData),
        typed("hearing_item", HearingItemData), typed("zba_case", ZbaCaseData),
      ]))
      .max(MAX_RECORDS),
  });
  return z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
}
