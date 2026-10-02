import type { WireRecord } from "../records/types";

export const permitRecord = (over: Record<string, unknown> = {}): WireRecord => ({
  kind: "permit",
  source_key: "100912345",
  observed_at: "2026-10-02T12:40:00Z",
  data: {
    permit_number: "100912345", classification: "qualifying_20plus", issue_date: "2026-09-30",
    permit_type: "PERMIT - RENOVATION/ALTERATION", address: "111 W. Monroe Street", zip: "60603",
    community_area: "32 Loop", ward: 42, lat: 41.880635, lon: -87.631098,
    units: { total: 345, dwelling: 345, efficiency: null, affordable: 104 }, unit_flag: null,
    reported_cost: 120000000, contacts: [{ role: "OWNER", name: "Example Owner, L.L.C." }],
    short_description: "Convert office to 345 dwelling units", work_description: "Interior conversion",
    permit_status: "ISSUED", permit_condition: "PER SO2026-0023894 AND APP23020T1",
    pin_list: ["17-16-123-004-0000"], portal_url: "https://webapps1.chicago.gov/buildingrecords/", scope: "North of I-290",
    in_target: true, notes: null,
    ...over,
  },
});

export const zoningRecord = (over: Record<string, unknown> = {}): WireRecord => ({
  kind: "zoning_matter",
  source_key: "O2026-0023894",
  observed_at: "2026-10-02T12:44:10Z",
  data: {
    record_number: "SO2026-0023894", matter_id: null, dpd_app_no: "23020", title: null,
    filed_date: "2026-03-02", introduced_date: "2026-03-18", hearing_date: "2026-06-17",
    address: "111-123 W. Monroe Street", additional_addresses: [], zip: "60603", community_area: "32 Loop", ward: 42,
    lat: null, lon: null, applicant: "Example Owner LLC", owner: "Example Owner LLC", attorney: "Ximena Castro",
    zoning_from: "DC-16", zoning_to: "PD", lot_size_sqft: null, units: 345, height_ft: null, parking: null,
    aro: true, pd: true, aldermanic: false, status: "In Committee - Referred", flag: null,
    source_url: "https://chicityclerkelms.chicago.gov/Matter/?matterId=example", drive_pdf_url: "https://drive.google.com/file/d/example",
    in_target: true, notes: null,
    ...over,
  },
  field_sources: { units: "ocr" },
});

export const hearingRecord = (over: Record<string, unknown> = {}): WireRecord => ({
  kind: "hearing_item",
  source_key: "2026-06-11|23020",
  observed_at: "2026-10-02T12:42:00Z",
  data: {
    body: "cpc", hearing_date: "2026-06-11", dpd_app_no: "23020", matter_key: "O2026-0023894",
    address: "111 W Monroe St", zip: "60603", community_area: 32, ward: 42, lat: null, lon: null,
    applicant: "Example Owner LLC", request: "Planned Development for 345 units", zoning_from: "DC-16", zoning_to: "PD",
    units: 345, height_ft: null, parking: null, pd: true,
    source_url: "https://www.chicago.gov/city/en/depts/dcd/supp_info/chicago_plan_commission.html", in_target: true, notes: null,
    ...over,
  },
});

export const zbaRecord = (over: Record<string, unknown> = {}): WireRecord => ({
  kind: "zba_case",
  source_key: "420-24-S",
  observed_at: "2026-10-02T12:51:02Z",
  data: {
    case_no: "420-24-S", request_type: "Special use", first_hearing: "2024-10-18", hearing_date: "2024-10-18",
    address: "3642 W. Oakdale Avenue", zip: "60618", community_area: "21 Avondale", ward: 35, lat: null, lon: null,
    applicant: "4645 North Clark, LLC", owner: "4645 North Clark, LLC", attorney: "Ximena Castro",
    zoning_district: "B3-2", request: "Special use to establish residential use below the second floor",
    units: 4, residential: true, outcome: "Approved", vote: "4-0", decision_date: "2024-10-18",
    hearings: [{ date: "2024-10-18", outcome: "Approved", vote: "4-0", continued_to: null,
      source_url: "https://www.chicago.gov/content/dam/city/depts/zlup/Administrative_Reviews_and_Approvals/Agendas/ZBA_Oct_2024_Minutes.pdf" }],
    source_pdf_url: "https://www.chicago.gov/content/dam/city/depts/zlup/Administrative_Reviews_and_Approvals/Agendas/ZBA_Oct_2024_Minutes.pdf",
    resolution_pdf_url: null, flag: null, in_target: true, notes: null,
    ...over,
  },
});

export const ALL_FIXTURES = [permitRecord, zoningRecord, hearingRecord, zbaRecord];
