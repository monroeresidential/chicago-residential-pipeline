import { expect, test } from "@playwright/test";
import Papa from "papaparse";

test("CSV and JSON downloads contain every project", async ({ request }) => {
  const geo = await (await request.get("/data/projects.geojson")).json();
  const csv = await request.get("/data/projects.csv");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const rows = Papa.parse<Record<string, string>>(await csv.text(), { header: true, skipEmptyLines: true }).data;
  expect(rows).toHaveLength(geo.features.length);
  const json = await request.get("/data/projects.json");
  expect(json.status()).toBe(200);
  const body = await json.json();
  expect(body.projects).toHaveLength(geo.features.length);
  expect(body.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
