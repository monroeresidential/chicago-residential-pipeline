import { expect, test } from "@playwright/test";

for (const path of ["/og/site.png", "/og/111-w-monroe.png", "/og/118-s-clinton.png"]) {
  test(`share image ${path} is a PNG`, async ({ request }) => {
    const res = await request.get(path);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
  });
}

test("home page is branded and search-friendly", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/^Chicago Residential Pipeline \| /);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://pipeline.monroeresidential.com/og/site.png");
  await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute("content", /Chicago Residential Pipeline/);
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute("content", "Chicago Residential Pipeline by Monroe Residential Partners");
  const description = await page.locator('meta[name="description"]').getAttribute("content");
  expect(description).toMatch(/28 downtown Chicago office-to-residential conversions/);
  expect(description!.length).toBeLessThanOrEqual(160);
  const jsonLd = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
  expect(jsonLd["@type"]).toBe("Dataset");
});

test("project pages carry the site name in their titles", async ({ page }) => {
  await page.goto("/projects/401-w-ontario");
  await expect(page).toHaveTitle("Birken Lofts · Chicago Residential Pipeline");
});

test("sitemap lists project pages and robots.txt points to it", async ({ request }) => {
  const sitemap = await (await request.get("/sitemap-0.xml")).text();
  expect(sitemap).toContain("https://pipeline.monroeresidential.com/projects/111-w-monroe<");
  expect(sitemap).not.toContain("/og/");
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Sitemap: https://pipeline.monroeresidential.com/sitemap-index.xml");
});
