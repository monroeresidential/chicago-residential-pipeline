import { expect, test } from "@playwright/test";

test("restores filters and selection from the URL", async ({ page }) => {
  await page.goto("/?status=completed&project=79-w-monroe");
  await expect(page.locator(".marker:not([hidden])")).toHaveCount(2);
  await expect(page.locator("#filters").getByLabel("Approved")).not.toBeChecked();
  await expect(page.locator(".maplibregl-popup")).toContainText("The Bellwether");
});

test("ignores malformed parameters", async ({ page }) => {
  await page.goto("/?status=bogus&program=x&project=deleted-id");
  await expect(page.locator(".marker:not([hidden])")).toHaveCount(27);
  await expect(page.locator(".maplibregl-popup")).toHaveCount(0);
  await expect(page).toHaveURL(/localhost:4321\/$/);
});

test("drops a selected project that the filters hide", async ({ page }) => {
  await page.goto("/?status=completed&project=111-w-monroe");
  await expect(page.locator(".marker:not([hidden])")).toHaveCount(2);
  await expect(page.locator(".maplibregl-popup")).toHaveCount(0);
  await expect(page).toHaveURL(/\?status=completed$/);
});
