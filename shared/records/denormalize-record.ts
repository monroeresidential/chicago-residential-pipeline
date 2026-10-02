import { formatAddressDisplay } from "../normalize/address";
import type { NormalizedRecord, OrgRole, WireRecord } from "./types";

const ids = (r: NormalizedRecord, type: string, relation: "self" | "cited") =>
  r.identifiers.filter((i) => i.type === type && i.relation === relation).map((i) => i.value);
const org = (r: NormalizedRecord, role: OrgRole) => r.organizations.find((o) => o.role === role)?.display_name ?? null;
const ROLE_LABEL: Record<OrgRole, string> = { applicant: "Applicant", owner: "Owner", attorney: "Attorney", contractor: "Contractor", architect: "Architect", other: "Other" };

/** Canonical record → wire format, so an edit can be re-validated and re-normalized like a Grok push. */
export function denormalizeRecord(r: NormalizedRecord): WireRecord {
  const a = r.attributes as Record<string, unknown>;
  const primary = r.addresses[0];
  const common = {
    address: primary ? formatAddressDisplay(primary) : null,
    zip: primary?.zip ?? null,
    community_area: r.community_area,
    ward: r.ward,
    lat: r.point?.lat ?? null,
    lon: r.point?.lon ?? null,
    notes: r.notes,
    in_target: r.in_target,
  };
  let data: Record<string, unknown>;
  switch (r.kind) {
    case "permit":
      data = {
        ...common, permit_number: r.source_key, classification: a.classification, issue_date: a.issue_date,
        permit_type: a.permit_type, units: a.units_detail, unit_flag: a.unit_flag, reported_cost: a.reported_cost,
        contacts: r.organizations.map((o) => ({ role: ROLE_LABEL[o.role], name: o.display_name })),
        short_description: a.short_description, work_description: a.work_description, permit_status: r.status,
        permit_condition: a.permit_condition, pin_list: r.parcels, portal_url: r.source_url, scope: a.scope,
      };
      break;
    case "zoning_matter":
      data = {
        ...common, record_number: ids(r, "record_number", "self")[0] ?? r.source_key,
        matter_id: ids(r, "elms_matter_id", "self")[0] ?? null, dpd_app_no: ids(r, "dpd_app_no", "self")[0] ?? null,
        title: a.title, filed_date: a.filed_date, introduced_date: a.introduced_date, hearing_date: a.hearing_date,
        additional_addresses: r.addresses.slice(1).map(formatAddressDisplay),
        applicant: org(r, "applicant"), owner: org(r, "owner"), attorney: org(r, "attorney"),
        zoning_from: a.zoning_from, zoning_to: a.zoning_to, lot_size_sqft: a.lot_size_sqft, units: r.units,
        height_ft: a.height_ft, parking: a.parking, aro: a.aro, pd: a.pd, aldermanic: a.aldermanic,
        status: r.status, flag: r.flag, source_url: r.source_url, drive_pdf_url: a.drive_pdf_url,
      };
      break;
    case "hearing_item":
      data = {
        ...common, body: a.body, hearing_date: a.hearing_date, dpd_app_no: ids(r, "dpd_app_no", "self")[0] ?? null,
        matter_key: ids(r, "record_number", "cited")[0] ?? null, applicant: org(r, "applicant"), request: a.request,
        zoning_from: a.zoning_from, zoning_to: a.zoning_to, units: r.units, height_ft: a.height_ft, parking: a.parking,
        pd: a.pd, source_url: r.source_url,
      };
      break;
    case "zba_case":
      data = {
        ...common, case_no: r.source_key, request_type: a.request_type, first_hearing: a.first_hearing,
        hearing_date: a.hearing_date, applicant: org(r, "applicant"), owner: org(r, "owner"), attorney: org(r, "attorney"),
        zoning_district: a.zoning_district, request: a.request, units: r.units, residential: a.residential,
        outcome: r.status, vote: a.vote, decision_date: a.decision_date, hearings: a.hearings,
        source_pdf_url: r.source_url, resolution_pdf_url: a.resolution_pdf_url, flag: r.flag,
      };
      break;
  }
  return { kind: r.kind, source_key: r.source_key, data, field_sources: r.field_sources };
}
