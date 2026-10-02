import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { denormalizeRecord } from "../records/denormalize-record";
import { diffRecords } from "../records/diff";
import { contentHash, stableStringify } from "../records/hash";
import { normalizeRecord } from "../records/normalize-record";
import { DATA_SCHEMAS, RecordEnvelope, SubmissionEnvelope, submissionJsonSchema } from "../records/schemas";
import { ALL_FIXTURES, hearingRecord, permitRecord, zbaRecord, zoningRecord } from "./fixtures";

describe("wire schemas", () => {
  it.each(ALL_FIXTURES.map((f) => [f().kind, f]))("%s fixture is valid", (_k, f) => {
    const rec = f();
    expect(RecordEnvelope.safeParse(rec).success).toBe(true);
    expect(DATA_SCHEMAS[rec.kind].safeParse(rec.data).success).toBe(true);
  });

  it("rejects unknown fields, string numbers and bad dates", () => {
    expect(DATA_SCHEMAS.permit.safeParse({ ...permitRecord().data, extra: 1 }).success).toBe(false);
    expect(DATA_SCHEMAS.permit.safeParse({ ...permitRecord().data, ward: "42" }).success).toBe(false);
    expect(DATA_SCHEMAS.permit.safeParse({ ...permitRecord().data, issue_date: "2026-02-30" }).success).toBe(false);
  });

  it("accepts the example request in the Grok instructions document", () => {
    const doc = readFileSync("docs/superpowers/specs/2026-10-02-grok-submission-api.md", "utf8");
    const section = doc.slice(doc.indexOf("## 5."));
    const example = JSON.parse(section.slice(section.indexOf("```json") + 7, section.indexOf("```", section.indexOf("```json") + 7)));
    expect(SubmissionEnvelope.safeParse(example).success).toBe(true);
    for (const rec of example.records) {
      expect(RecordEnvelope.safeParse(rec).success).toBe(true);
      expect(DATA_SCHEMAS[rec.kind as keyof typeof DATA_SCHEMAS].safeParse(rec.data).error).toBeUndefined();
    }
  });

  it("publishes a JSON Schema with all four kinds", () => {
    const text = JSON.stringify(submissionJsonSchema());
    for (const k of ["permit", "zoning_matter", "hearing_item", "zba_case", "permit_condition", "hearings"]) expect(text).toContain(k);
  });
});

describe("normalizeRecord", () => {
  it("normalizes a permit into canonical values", () => {
    const { record, issues } = normalizeRecord(permitRecord());
    expect(issues).toEqual([]);
    expect(record.source_key).toBe("100912345");
    expect(record.addresses.map((a) => [a.street_name, a.suffix, a.zip])).toEqual([["MONROE", "ST", "60603"]]);
    expect(record.community_area).toBe(32);
    expect(record.units).toBe(345);
    expect(record.parcels).toEqual(["17161230040000"]);
    expect(record.identifiers).toEqual([
      { type: "dpd_app_no", value: "23020", relation: "cited" },
      { type: "matter_key", value: "O2026-0023894", relation: "cited" },
      { type: "permit_number", value: "100912345", relation: "self" },
      { type: "record_number", value: "SO2026-0023894", relation: "cited" },
    ]);
    expect(record.organizations).toEqual([{ role: "owner", name_key: "EXAMPLE OWNER LLC", display_name: "Example Owner, L.L.C." }]);
    expect(record.attributes).toMatchObject({ classification: "qualifying_20plus", reported_cost: 120000000 });
    expect(record.attributes).not.toHaveProperty("address");
    expect(record.attributes).not.toHaveProperty("contacts");
    expect(record.source_url).toBe("https://webapps1.chicago.gov/buildingrecords/");
  });

  it("normalizes a zoning matter: matter key, all identifiers, organizations, zoning codes", () => {
    const { record } = normalizeRecord(zoningRecord());
    expect(record.source_key).toBe("O2026-0023894");
    expect(record.identifiers.filter((i) => i.relation === "self").map((i) => `${i.type}:${i.value}`)).toEqual([
      "dpd_app_no:23020", "matter_key:O2026-0023894", "record_number:SO2026-0023894",
    ]);
    expect(record.organizations.map((o) => `${o.role}:${o.name_key}`)).toEqual([
      "applicant:EXAMPLE OWNER LLC", "attorney:XIMENA CASTRO", "owner:EXAMPLE OWNER LLC",
    ]);
    expect(record.attributes).toMatchObject({ zoning_from: "DC-16", zoning_to: "PD", drive_pdf_url: "https://drive.google.com/file/d/example" });
    expect(record.event_date).toBe("2026-03-18");
    expect(record.field_sources).toEqual({ units: "ocr" });
  });

  it("reports blocking issues instead of storing raw values", () => {
    const { record, issues } = normalizeRecord(zbaRecord({ address: "12 Gotham Blvd", community_area: "Gotham" }));
    expect(record.addresses).toEqual([]);
    expect(record.community_area).toBeNull();
    expect(issues.map((i) => [i.field, i.blocking])).toEqual([["address", true], ["community_area", true]]);
    expect(issues[0]!.raw).toBe("12 Gotham Blvd");
  });

  it("records non-blocking warnings (corrected suffix)", () => {
    const { issues } = normalizeRecord(permitRecord({ address: "620 N. LaSalle St" }));
    expect(issues).toEqual([expect.objectContaining({ field: "address", blocking: false })]);
  });

  it("keeps one copy of an address listed twice", () => {
    const { record } = normalizeRecord(zoningRecord({ address: "111 W Monroe St", additional_addresses: ["111 West Monroe Street", "79 W Monroe St"] }));
    expect(record.addresses.map((a) => a.number_from)).toEqual([111, 79]);
  });

  it("keeps distinct hearings that have address slugs instead of app numbers", () => {
    const a = normalizeRecord({ ...hearingRecord({ dpd_app_no: null, matter_key: null }), source_key: "2026-06-11|3642-w-oakdale-ave" }).record;
    const b = normalizeRecord({ ...hearingRecord({ dpd_app_no: null, matter_key: null }), source_key: "2026-06-11|3642-n-clark-st" }).record;
    expect(a.source_key).toBe("2026-06-11|3642-w-oakdale-ave");
    expect(b.source_key).not.toBe(a.source_key);
    expect(normalizeRecord({ ...hearingRecord({ dpd_app_no: null }), source_key: "2026-06-11|APP23020T1" }).record.source_key).toBe("2026-06-11|23020");
  });

  it("blocks on any address that cannot be normalized, not only the primary", () => {
    const { issues } = normalizeRecord(zoningRecord({ additional_addresses: ["12 Gotham Blvd"] }));
    expect(issues).toEqual([expect.objectContaining({ field: "additional_addresses", raw: "12 Gotham Blvd", blocking: true })]);
  });

  it("keeps a removed unit designator in notes", () => {
    const { record } = normalizeRecord(zbaRecord({ address: "3642 W. Oakdale Avenue, Suite 300", notes: "OCR checked" }));
    expect(record.notes).toBe("OCR checked; address unit: SUITE 300");
    const again = normalizeRecord(denormalizeRecord(record)).record;
    expect(again.notes).toBe(record.notes);
  });

  it("ignores the order of secondary addresses", () => {
    const a = normalizeRecord(zoningRecord({ additional_addresses: ["79 W Monroe St", "105 W Adams St"] })).record;
    const b = normalizeRecord(zoningRecord({ additional_addresses: ["105 W Adams St", "79 W Monroe St"] })).record;
    expect(contentHash(b)).toBe(contentHash(a));
    expect(diffRecords(a, b)).toEqual({});
  });

  it("canonicalizes nested units and hearings", () => {
    const omitted = normalizeRecord(permitRecord({ units: { total: 345 } })).record;
    const nulls = normalizeRecord(permitRecord({ units: { total: 345, dwelling: null, efficiency: null, affordable: null } })).record;
    expect(contentHash(omitted)).toBe(contentHash(nulls));
    const h = (outcome: string, vote: string | null) => normalizeRecord(zbaRecord({ hearings: [{ date: "2024-10-18", outcome, vote, source_url: null }] })).record;
    expect(contentHash(h(" Approved ", ""))).toBe(contentHash(h("Approved", null)));
  });

  it("treats empty strings as null", () => {
    const { record } = normalizeRecord(zbaRecord({ attorney: "", vote: "" }));
    expect(record.organizations.some((o) => o.role === "attorney")).toBe(false);
    expect(record.attributes.vote).toBeNull();
  });
});

describe("hash and diff", () => {
  it("is insensitive to formatting differences", () => {
    const a = normalizeRecord(permitRecord()).record;
    const b = normalizeRecord(permitRecord({ address: "111 WEST MONROE ST", pin_list: ["17161230040000"],
      contacts: [{ role: "Owner", name: "EXAMPLE OWNER LLC" }] })).record;
    expect(contentHash(b)).toBe(contentHash(a));
    expect(diffRecords(a, b)).toEqual({});
  });

  it("reports changed fields by name", () => {
    const a = normalizeRecord(zoningRecord()).record;
    const b = normalizeRecord(zoningRecord({ status: "Final - Passed (2026-06-17)", zoning_to: "PD 1550" })).record;
    expect(Object.keys(diffRecords(a, b)).sort()).toEqual(["status", "zoning_to"]);
    expect(diffRecords(a, b).status).toEqual({ before: "In Committee - Referred", after: "Final - Passed (2026-06-17)" });
  });

  it("diff against nothing lists every non-empty field", () => {
    // A ZBA outcome is stored as the record's status.
    expect(Object.keys(diffRecords(null, normalizeRecord(zbaRecord()).record))).toEqual(expect.arrayContaining(["status", "request_type", "address"]));
  });

  it("stableStringify sorts keys", () => {
    expect(stableStringify({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
  });

  it.each(ALL_FIXTURES.map((f) => [f().kind, f]))("%s survives denormalize → normalize unchanged", (_k, f) => {
    const first = normalizeRecord(f()).record;
    const again = normalizeRecord(denormalizeRecord(first)).record;
    expect(contentHash(again)).toBe(contentHash(first));
  });
});
