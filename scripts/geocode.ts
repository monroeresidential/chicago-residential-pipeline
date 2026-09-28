// One-time helper: fills empty lat/lng in data/projects.csv using the U.S. Census geocoder.
// Usage: pnpm geocode   (then verify every new pin by eye on the map)
import { readFileSync, writeFileSync } from "node:fs";
import Papa from "papaparse";
import { parseCensusResponse, toGeocodeQuery } from "../src/lib/geocode";

const PATH = "data/projects.csv";
const CENSUS = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

const { data, meta } = Papa.parse<Record<string, string>>(readFileSync(PATH, "utf8"), {
  header: true,
  skipEmptyLines: true,
});

let misses = 0;
for (const row of data) {
  if (row.lat && row.lng) continue;
  const url = `${CENSUS}?address=${encodeURIComponent(toGeocodeQuery(row.address!))}&benchmark=Public_AR_Current&format=json`;
  const hit = parseCensusResponse(await (await fetch(url)).json());
  if (!hit) {
    misses += 1;
    console.warn(`NO MATCH  ${row.id}  (${row.address}) — enter lat/lng by hand`);
    continue;
  }
  row.lat = hit.lat.toFixed(6);
  row.lng = hit.lng.toFixed(6);
  console.log(`ok        ${row.id}  ${row.lat}, ${row.lng}`);
}

writeFileSync(PATH, `${Papa.unparse(data, { columns: meta.fields, newline: "\n" })}\n`);
console.log(misses === 0 ? "All rows geocoded." : `${misses} row(s) need manual coordinates.`);
