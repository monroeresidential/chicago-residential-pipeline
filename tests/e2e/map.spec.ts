import { expect, test, type Page } from "@playwright/test";

const visibleMarkers = (page: Page) => page.locator(".marker:not([hidden])");
const stat = (page: Page, key: string) => page.locator(`.stats [data-stat="${key}"]`);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(visibleMarkers(page)).toHaveCount(28);
});

test("shows all 28 projects with totals", async ({ page }) => {
  await expect(stat(page, "count")).toHaveText("28");
  await expect(stat(page, "units")).toHaveText("4,269");
  await expect(stat(page, "tpc")).toHaveText("$1.84B");
  await expect(page.locator("#project-list li:not([hidden])")).toHaveCount(28);
  await expect(page.locator(".marker--reported")).toHaveCount(3);
  await expect(page.locator(".marker--monroe")).toHaveCount(3);
});

test("filtering by status updates markers, list, totals and URL", async ({ page }) => {
  await page.locator("#filters").getByLabel("Completed").uncheck();
  await expect(visibleMarkers(page)).toHaveCount(26);
  await expect(page.locator("#project-list li:not([hidden])")).toHaveCount(26);
  await expect(stat(page, "units")).toHaveText("3,999");
  await expect(page).toHaveURL(/\?status=under_construction,permitted,approved,planning$/);
});

test("filtering by program", async ({ page }) => {
  await page.locator("#filters").getByLabel("Private market").uncheck();
  await expect(visibleMarkers(page)).toHaveCount(6);
  await expect(page).toHaveURL(/\?program=lasalle$/);
});

test("unchecking every status shows the empty state", async ({ page }) => {
  for (const label of ["Completed", "Under construction", "Permitted", "Approved", "Planning"]) {
    await page.locator("#filters").getByLabel(label).uncheck();
  }
  await expect(visibleMarkers(page)).toHaveCount(0);
  await expect(page.getByText("No projects match these filters.")).toBeVisible();
  await expect(stat(page, "count")).toHaveText("0");
  await expect(stat(page, "tpc")).toHaveText("$0M");
  await expect(page).toHaveURL(/\?status=none$/);
});

test("sorting reorders the list", async ({ page }) => {
  await page.locator("#sort").selectOption("tpc");
  await expect(page.locator("#project-list li").first()).toHaveAttribute("data-id", "135-s-lasalle");
});

test("clicking a marker opens its popup and records it in the URL", async ({ page }) => {
  // Markers overlap in the Loop at the overview zoom, so dispatch the click directly.
  await page.locator('.marker[data-id="79-w-monroe"]').dispatchEvent("click");
  const popup = page.locator(".maplibregl-popup");
  await expect(popup).toContainText("The Bellwether");
  await expect(popup.getByRole("link", { name: "View details →" })).toHaveAttribute("href", "/projects/79-w-monroe");
  await expect(page).toHaveURL(/project=79-w-monroe/);
  await expect(page.locator('#project-list li[data-id="79-w-monroe"]')).toHaveClass(/is-selected/);
});

test("clicking a list row selects the project instead of navigating", async ({ page }) => {
  await page.locator('a.project-row[data-id="401-w-ontario"]').click();
  await expect(page.locator(".maplibregl-popup")).toContainText("A Monroe Residential project");
  await expect(page).toHaveURL(/\/\?project=401-w-ontario$/);
});

test("filtering out the selected project closes its popup", async ({ page }) => {
  await page.locator('.marker[data-id="79-w-monroe"]').dispatchEvent("click");
  await expect(page.locator(".maplibregl-popup")).toHaveCount(1);
  await page.locator("#filters").getByLabel("Completed").uncheck();
  await expect(page.locator(".maplibregl-popup")).toHaveCount(0);
  await expect(page).not.toHaveURL(/project=/);
});

test("the map fills its panel", async ({ page }) => {
  const box = await page.locator("#map").boundingBox();
  const wrap = await page.locator(".map-wrap").boundingBox();
  expect(box!.height).toBeGreaterThan(400);
  expect(box!.height).toBe(wrap!.height);
});

test("pressing Enter on a list row opens the project page (keyboard path)", async ({ page }) => {
  await page.locator('a.project-row[data-id="401-w-ontario"]').focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/projects\/401-w-ontario$/);
});

test("campaign parameters survive filtering", async ({ page }) => {
  await page.goto("/?utm_source=linkedin#top");
  await expect(page.locator(".marker:not([hidden])")).toHaveCount(28);
  await page.locator("#filters").getByLabel("Completed").uncheck();
  await expect(page).toHaveURL(/\?utm_source=linkedin&status=under_construction,permitted,approved,planning#top$/);
});

test("the popup shows program and an em dash for unknown cost", async ({ page }) => {
  await page.locator('.marker[data-id="118-s-clinton"]').dispatchEvent("click");
  const popup = page.locator(".maplibregl-popup");
  await expect(popup).toContainText("74 units · —");
  await expect(popup).toContainText("Private market");
});
