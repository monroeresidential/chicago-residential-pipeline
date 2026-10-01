import { expect, test } from "@playwright/test";

test("header carries the Chicago Pipeline lockup and 3F links", async ({ page }) => {
  await page.goto("/about");
  const header = page.locator(".site-header");
  // One link for the whole lockup (stacked separate links were too close to tap: WCAG 2.5.8).
  const lockup = header.locator("a.brand");
  await expect(lockup).toHaveAttribute("href", "/");
  await expect(lockup.locator(".brand-mark svg")).toHaveCount(1);
  await expect(lockup.locator(".brand-wordmark")).toHaveText("Chicago Pipeline");
  await expect(lockup.locator(".brand-by")).toHaveText("by 3F Construction");
  await expect(header.getByRole("link", { name: "3fconstruction.net" })).toHaveAttribute("href", /utm_source=chicagopipeline/);
  await expect(header.getByRole("link", { name: "Contact 3F" })).toHaveAttribute("href", /3fconstruction\.net\/contact-chicago-commercial-general-contractor\/\?utm_source=chicagopipeline/);
});

test("footer carries the 3F and Monroe logos", async ({ page }) => {
  await page.goto("/about");
  const footer = page.locator("footer");
  await expect(footer.getByRole("link", { name: "3F Construction" }).locator("img")).toHaveAttribute("src", "/brand/3f-logo.png");
  await expect(footer.getByRole("link", { name: "Monroe Residential Partners" })).toHaveAttribute("href", "https://monroeresidential.com");
});
test("Monroe Residential appears only as a footer logo link", async ({ page }) => {
  for (const path of ["/", "/about", "/projects/401-w-ontario"]) {
    await page.goto(path);
    const monroeLinks = page.locator('a[href^="https://monroeresidential.com"]');
    const inFooter = page.locator('footer a[href^="https://monroeresidential.com"], .sidebar a[href^="https://monroeresidential.com"]');
    expect(await monroeLinks.count(), path).toBe(await inFooter.count());
    await expect(page.locator(".marker--monroe, .row-monroe, .callout--monroe, .popup-monroe")).toHaveCount(0);
  }
  await page.goto("/about");
  await expect(page.locator("footer").getByRole("link", { name: "Monroe Residential Partners" })).toHaveAttribute("href", "https://monroeresidential.com");
});

test("CTA band offers 3F phone and contact, with campaign tags", async ({ page }) => {
  await page.goto("/projects/223-w-erie");
  const cta = page.locator(".cta-band").first();
  await expect(cta).toContainText("3F Construction");
  await expect(cta.getByRole("link", { name: "(312) 296-4855" })).toHaveAttribute("href", "tel:+13122964855");
  await expect(cta.getByRole("link", { name: "Contact 3F" })).toHaveAttribute("href", /utm_source=chicagopipeline/);
});

test("Built by 3F projects are badged on the map, list and project pages", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".marker--3f")).toHaveCount(3);
  await expect(page.locator(".row-3f")).toHaveCount(3);
  await page.goto("/projects/401-w-ontario");
  await expect(page.locator(".callout--3f a")).toHaveAttribute("href", "https://3fconstruction.net/project/birken-lofts/");
  await page.goto("/projects/620-n-lasalle");
  await expect(page.locator(".callout--3f")).toHaveCount(0);
});

test("site name and structured data credit 3F Construction", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute("content", "Chicago Pipeline by 3F Construction");
  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
  expect(ld.creator).toMatchObject({ name: "3F Construction", url: "https://3fconstruction.net" });
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /By 3F Construction\.$/);
});
