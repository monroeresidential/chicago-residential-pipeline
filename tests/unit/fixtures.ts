import type { Project } from "../../src/lib/schema";

export function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: "111-w-monroe",
    dpd_map_no: 1,
    name: "Harris Bank building",
    address: "111 W. Monroe St",
    developer: "Prime/Capri Interests",
    units: 345,
    affordable_units: 104,
    tpc_musd: 179,
    program: "lasalle",
    public_support: "TIF",
    status: "approved",
    status_note: "Approved; in development",
    flag: null,
    confidence: "dpd",
    monroe_url: null,
    lat: 41.8805,
    lng: -87.6311,
    sources: ["https://www.chicago.gov/"],
    notes: null,
    ...over,
  };
}

export const CSV_HEADER =
  "id,dpd_map_no,name,address,developer,units,affordable_units,tpc_musd,program,public_support,status,status_note,flag,confidence,monroe_url,lat,lng,sources,notes";

export const GOOD_ROW =
  '111-w-monroe,1,Harris Bank building,111 W. Monroe St,Prime/Capri Interests,345,104,179,lasalle,"TIF + LaSalle ($40M)",approved,Approved; in development,,dpd,,41.8805,-87.6311,https://a.example/one | https://b.example/two,';
