import { expect, test } from "@playwright/test";

test("404 page uses the site layout", async ({ page }) => {
  const res = await page.goto("/definitely-not-a-page");
  expect(res?.status()).toBe(404);
  await expect(page.locator(".site-header .brand-wordmark")).toHaveText("Chicago Pipeline");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("We couldn't find that page.");
  await expect(page.getByRole("link", { name: "(312) 296-4855" })).toHaveAttribute("href", "tel:+13122964855");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#1B1A18");
});
