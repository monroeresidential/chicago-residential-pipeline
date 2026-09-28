import { expect, test } from "@playwright/test";

test("project page shows a mini-map once it is near the viewport", async ({ page }) => {
  await page.goto("/projects/65-e-wacker");
  const mini = page.locator(".mini-map");
  await mini.scrollIntoViewIfNeeded();
  await expect(mini.locator("canvas")).toHaveCount(1);
  await expect(mini).toHaveAttribute("aria-label", "Map showing Wacker Place (Millinery Mart)");
});

test("mini-map without WebGL shows a quiet fallback", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type.startsWith("webgl")) return null;
      return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });
  await page.goto("/projects/65-e-wacker");
  await page.locator(".mini-map").scrollIntoViewIfNeeded();
  await expect(page.locator(".mini-map")).toHaveClass(/is-unavailable/);
});
