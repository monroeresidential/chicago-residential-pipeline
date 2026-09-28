import { expect, test } from "@playwright/test";

test("when tiles fail, markers still render and a notice appears", async ({ page }) => {
  await page.route("**/*.pmtiles", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator("#map-notice")).toBeVisible();
  await expect(page.locator(".marker:not([hidden])")).toHaveCount(29);
});

test("without WebGL the list still filters and links to project pages", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type.startsWith("webgl")) return null;
      return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });
  await page.goto("/");
  await expect(page.locator("#map-fallback")).toBeVisible();
  await expect(page.locator("#project-list li:not([hidden])")).toHaveCount(29);
  await page.locator("#filters").getByLabel("Completed").uncheck();
  await expect(page.locator('.stats [data-stat="count"]')).toHaveText("27");
  await page.locator('a.project-row[data-id="111-w-monroe"]').click();
  await expect(page).toHaveURL(/\/projects\/111-w-monroe$/);
});

test("the MapLibre web worker loads in the production build", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => { if (/worker/i.test(msg.text())) errors.push(msg.text()); });
  page.on("pageerror", (err) => { if (/worker/i.test(err.message)) errors.push(err.message); });
  await page.route("**/*.pmtiles", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator(".marker:not([hidden])")).toHaveCount(29);
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});

test("the map does not depend on fetching project data (it is embedded in the page)", async ({ page }) => {
  await page.route("**/data/projects.geojson", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator(".marker:not([hidden])")).toHaveCount(29);
  await page.locator("#filters").getByLabel("Completed").uncheck();
  await expect(page.locator('#project-list li[data-id="79-w-monroe"]')).toBeHidden();
});
