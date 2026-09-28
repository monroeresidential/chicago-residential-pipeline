import { expect, test } from "@playwright/test";
import type { ProjectCollection } from "../../src/lib/schema";

test("GeoJSON endpoint lists all 28 projects as points", async ({ request }) => {
  const res = await request.get("/data/projects.geojson");
  expect(res.ok()).toBe(true);
  const fc = (await res.json()) as ProjectCollection;
  expect(fc.type).toBe("FeatureCollection");
  expect(fc.features).toHaveLength(28);
  expect(fc.features[0]!.geometry.type).toBe("Point");
});

test("every project page renders with its own title and share tags", async ({ page, request }) => {
  const fc = (await (await request.get("/data/projects.geojson")).json()) as ProjectCollection;
  for (const f of fc.features) {
    const res = await page.goto(`/projects/${f.id}`);
    expect(res?.status(), f.id).toBe(200);
    await expect(page.locator("h1")).toHaveText(f.properties.name ?? f.properties.address);
    await expect(page).toHaveTitle(/ · Chicago Residential Pipeline$/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content", `https://pipeline.monroeresidential.com/og/${f.id}.jpg`,
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href", `https://pipeline.monroeresidential.com/projects/${f.id}`,
    );
  }
});

test("a project with missing fields shows em dashes, never null", async ({ page }) => {
  await page.goto("/projects/118-s-clinton");
  await expect(page.locator("h1")).toHaveText("118 S. Clinton St");
  const fact = (label: string) => page.locator(".facts div", { has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd");
  await expect(fact("Developer")).toHaveText("—");
  await expect(fact("Total project cost")).toHaveText("—");
  await expect(fact("Units")).toHaveText("74");
  await expect(fact("Source")).toHaveText("Reported — not on DPD map");
  await expect(page.locator("main")).not.toContainText("null");
});

test("flags and Monroe projects are called out", async ({ page }) => {
  await page.goto("/projects/105-w-adams");
  await expect(page.locator(".callout--flag")).toContainText("Ownership lawsuit pending");
  await page.goto("/projects/401-w-ontario");
  await expect(page.locator(".callout--monroe a")).toHaveAttribute("href", "https://monroeresidential.com/portfolio/birken-lofts");
});

test("JSON-LD is valid and escaped", async ({ page }) => {
  await page.goto("/projects/135-s-lasalle");
  const raw = await page.locator('script[type="application/ld+json"]').textContent();
  expect(raw).not.toContain("<");
  const data = JSON.parse(raw!);
  expect(data["@type"]).toBe("ApartmentComplex");
  expect(data.name).toBe("Field Building");
  expect(data.numberOfAccommodationUnits).toBe(386);
});

test("about page explains the methodology", async ({ page }) => {
  await page.goto("/about");
  await expect(page.locator("h1")).toHaveText("How we track the pipeline");
  await expect(page.getByText("DPD value is shown")).toBeVisible();
});
