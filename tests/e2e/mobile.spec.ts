import { expect, test } from "@playwright/test";

test("sidebar is a bottom sheet that expands on tap and collapses on selection", async ({ page }) => {
  await page.goto("/");
  const sidebar = page.locator("#sidebar");
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await expect(page.locator(".sheet-handle")).toContainText("29 projects");
  await expect(page.locator("#project-list")).toBeHidden();

  await page.locator(".sheet-handle").click();
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await expect(page.locator("#project-list")).toBeVisible();

  await page.locator('a.project-row[data-id="79-w-monroe"]').click();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await expect(page.locator(".maplibregl-popup")).toContainText("The Bellwether");
});

test("no horizontal scroll at phone width", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the map fills the screen behind the sheet", async ({ page }) => {
  await page.goto("/");
  const box = await page.locator("#map").boundingBox();
  expect(box!.height).toBeGreaterThan(500);
});

test("the sheet opens before the map code has loaded (slow phones)", async ({ page }) => {
  // Hold back every MapLibre chunk so the tap happens before the map app starts.
  await page.route(/maplibre-gl.*\.js$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.continue();
  });
  await page.goto("/");
  await page.locator(".sheet-handle").click();
  await expect(page.locator("#sidebar")).toHaveAttribute("data-state", "expanded", { timeout: 1000 });
});
