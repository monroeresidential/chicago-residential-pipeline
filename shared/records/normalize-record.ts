import { normalizeAddress, type CanonicalAddress } from "../normalize/address";
import {
  blankToNull, extractCitedKeys, matterKeyOf, normalizeCommunityArea, normalizeDpdAppNo, normalizePin,
  normalizeRecordNumber, normalizeZoning, orgNameKey,
} from "../normalize/primitives";
import type { Issue, NormalizeResult, NormalizedRecord, OrgRole, RecordIdentifier, RecordOrganization, WireRecord } from "./types";

type Data = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? blankToNull(v) : null);
const n = (v: unknown) => (typeof v === "number" ? v : null);
const b = (v: unknown) => (typeof v === "boolean" ? v : null);

class Collector {
  issues: Issue[] = [];
  identifiers = new Map<string, RecordIdentifier>();
  orgs = new Map<string, RecordOrganization>();
  parcels = new Set<string>();
  addresses: CanonicalAddress[] = [];

  address(field: string, raw: string | null, zip: string | null, primary: boolean) {
    if (!raw) return;
    const r = normalizeAddress(raw, zip);
    if (!r.ok) { this.issues.push({ field, raw, message: r.message, blocking: primary }); return; }
    if (r.warning) this.issues.push({ field, raw, message: r.warning, blocking: false });
    this.addresses.push(r.value);
  }
  id(type: RecordIdentifier["type"], value: string, relation: RecordIdentifier["relation"]) {
    this.identifiers.set(`${type}|${value}|${relation}`, { type, value, relation });
  }
  dpd(raw: string | null, relation: RecordIdentifier["relation"], field = "dpd_app_no") {
    if (!raw) return;
    const r = normalizeDpdAppNo(raw);
    if (r.ok) this.id("dpd_app_no", r.value, relation);
    else this.issues.push({ field, raw, message: r.message, blocking: true });
  }
  recordNumber(raw: string | null, relation: RecordIdentifier["relation"], field = "record_number") {
    if (!raw) return;
    const r = normalizeRecordNumber(raw);
    if (!r.ok) { this.issues.push({ field, raw, message: r.message, blocking: true }); return; }
    this.id("record_number", r.value, relation);
    this.id("matter_key", matterKeyOf(r.value), relation);
  }
  org(role: OrgRole, raw: string | null) {
    if (!raw) return;
    const key = orgNameKey(raw);
    if (key) this.orgs.set(`${role}|${key}`, { role, name_key: key, display_name: raw });
  }
  pin(raw: string) {
    const r = normalizePin(raw);
    if (r.ok) this.parcels.add(r.value);
    else this.issues.push({ field: "pin_list", raw, message: r.message, blocking: true });
  }
  communityArea(raw: unknown): number | null {
    if (raw === null || raw === undefined || raw === "") return null;
    const r = normalizeCommunityArea(raw as string | number);
    if (r.ok) return r.value;
    this.issues.push({ field: "community_area", raw, message: r.message, blocking: true });
    return null;
  }
}

const zoning = (v: unknown) => { const t = s(v); return t ? normalizeZoning(t) : null; };

function contactRole(role: string): OrgRole {
  const r = role.toUpperCase();
  if (r.includes("OWNER")) return "owner";
  if (r.includes("ARCHITECT")) return "architect";
  if (r.includes("CONTRACTOR")) return "contractor";
  if (r.includes("ATTORNEY")) return "attorney";
  if (r.includes("APPLICANT")) return "applicant";
  return "other";
}

function sorted<T>(xs: Iterable<T>, key: (x: T) => string): T[] {
  return [...xs].sort((x, y) => key(x).localeCompare(key(y)));
}

/** Wire record (already validated by DATA_SCHEMAS[kind]) → canonical record + issues. Pure. */
export function normalizeRecord(rec: WireRecord): NormalizeResult {
  const d: Data = rec.data;
  const c = new Collector();
  const zip = s(d.zip);
  let sourceKey = rec.source_key.trim();
  let units: number | null = n(d.units);
  let status: string | null = null;
  let eventDate: string | null = null;
  let sourceUrl: string | null = s(d.source_url);
  let flag: string | null = s(d.flag);
  let attributes: Data = {};

  switch (rec.kind) {
    case "permit": {
      sourceKey = (s(d.permit_number) ?? sourceKey).toUpperCase();
      c.id("permit_number", sourceKey, "self");
      c.address("address", s(d.address), zip, true);
      const cited = extractCitedKeys(s(d.permit_condition) ?? "");
      for (const app of cited.dpd_app_no) c.id("dpd_app_no", app, "cited");
      for (const rn of cited.record_number) c.recordNumber(rn, "cited", "permit_condition");
      for (const contact of (d.contacts as { role: string; name: string }[] | null) ?? []) c.org(contactRole(contact.role), s(contact.name));
      for (const pin of (d.pin_list as string[] | null) ?? []) if (blankToNull(pin)) c.pin(pin);
      const u = (d.units as Record<string, number | null> | null) ?? null;
      units = u ? (u.total ?? u.dwelling ?? null) : null;
      status = s(d.permit_status);
      eventDate = s(d.issue_date);
      sourceUrl = s(d.portal_url);
      flag = null;
      attributes = {
        classification: d.classification, permit_type: s(d.permit_type), issue_date: s(d.issue_date),
        units_detail: u, unit_flag: s(d.unit_flag), reported_cost: n(d.reported_cost),
        short_description: s(d.short_description), work_description: s(d.work_description),
        permit_condition: s(d.permit_condition), scope: s(d.scope),
      };
      break;
    }
    case "zoning_matter": {
      c.recordNumber(s(d.record_number), "self");
      const rn = normalizeRecordNumber(s(d.record_number) ?? "");
      sourceKey = rn.ok ? matterKeyOf(rn.value) : matterKeyOf(sourceKey.toUpperCase());
      c.id("matter_key", sourceKey, "self");
      const guid = s(d.matter_id);
      if (guid) c.id("elms_matter_id", guid.toLowerCase(), "self");
      c.dpd(s(d.dpd_app_no), "self");
      c.address("address", s(d.address), zip, true);
      for (const extra of (d.additional_addresses as string[] | null) ?? []) c.address("additional_addresses", blankToNull(extra), zip, false);
      c.org("applicant", s(d.applicant)); c.org("owner", s(d.owner)); c.org("attorney", s(d.attorney));
      status = s(d.status);
      eventDate = s(d.introduced_date) ?? s(d.filed_date);
      attributes = {
        title: s(d.title), filed_date: s(d.filed_date), introduced_date: s(d.introduced_date), hearing_date: s(d.hearing_date),
        zoning_from: zoning(d.zoning_from), zoning_to: zoning(d.zoning_to), lot_size_sqft: n(d.lot_size_sqft),
        height_ft: n(d.height_ft), parking: n(d.parking), aro: b(d.aro), pd: b(d.pd), aldermanic: b(d.aldermanic),
        drive_pdf_url: s(d.drive_pdf_url),
      };
      break;
    }
    case "hearing_item": {
      const [datePart, ref] = sourceKey.split("|");
      const app = normalizeDpdAppNo(s(d.dpd_app_no) ?? ref ?? "");
      sourceKey = `${s(d.hearing_date) ?? datePart}|${app.ok ? app.value : (ref ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      c.dpd(s(d.dpd_app_no), "self");
      const mk = s(d.matter_key);
      if (mk) c.recordNumber(mk, "cited", "matter_key");
      c.address("address", s(d.address), zip, true);
      c.org("applicant", s(d.applicant));
      eventDate = s(d.hearing_date);
      attributes = {
        body: d.body, hearing_date: s(d.hearing_date), request: s(d.request), zoning_from: zoning(d.zoning_from),
        zoning_to: zoning(d.zoning_to), height_ft: n(d.height_ft), parking: n(d.parking), pd: b(d.pd),
      };
      flag = null;
      break;
    }
    case "zba_case": {
      sourceKey = (s(d.case_no) ?? sourceKey).toUpperCase();
      c.id("zba_case_no", sourceKey, "self");
      c.address("address", s(d.address), zip, true);
      c.org("applicant", s(d.applicant)); c.org("owner", s(d.owner)); c.org("attorney", s(d.attorney));
      status = s(d.outcome);
      eventDate = s(d.decision_date) ?? s(d.hearing_date) ?? s(d.first_hearing);
      sourceUrl = s(d.source_pdf_url);
      attributes = {
        request_type: s(d.request_type), first_hearing: s(d.first_hearing), hearing_date: s(d.hearing_date),
        zoning_district: zoning(d.zoning_district), request: s(d.request), residential: b(d.residential),
        vote: s(d.vote), decision_date: s(d.decision_date), hearings: d.hearings ?? [], resolution_pdf_url: s(d.resolution_pdf_url),
      };
      break;
    }
  }

  const lat = n(d.lat);
  const lon = n(d.lon);
  const record: NormalizedRecord = {
    kind: rec.kind,
    source_key: sourceKey,
    addresses: c.addresses,
    point: lat !== null && lon !== null ? { lat, lon } : null,
    community_area: c.communityArea(d.community_area),
    ward: n(d.ward),
    units,
    status,
    event_date: eventDate,
    in_target: d.in_target === true,
    flag,
    notes: s(d.notes),
    source_url: sourceUrl,
    parcels: [...c.parcels].sort(),
    identifiers: sorted(c.identifiers.values(), (i) => `${i.type}|${i.value}|${i.relation}`),
    organizations: sorted(c.orgs.values(), (o) => `${o.role}|${o.name_key}`),
    attributes,
    field_sources: rec.field_sources ?? {},
  };
  return { record, issues: c.issues };
}
