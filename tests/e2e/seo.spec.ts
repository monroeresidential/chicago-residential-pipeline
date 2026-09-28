import { expect, test } from "@playwright/test";

for (const path of ["/og/site.jpg", "/og/111-w-monroe.jpg", "/og/118-s-clinton.jpg"]) {
  test(`share image ${path} is a small JPEG`, async ({ request }) => {
    const res = await request.get(path);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/jpeg");
    expect((await res.body()).byteLength).toBeLessThan(500_000);
  });
}

test("icons and manifest exist and are linked", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/apple-touch-icon.png");
  await expect(page.locator('link[rel="icon"][href="/favicon.ico"]')).toHaveCount(1);
  await expect(page.locator('link[rel="icon"][type="image/png"]')).toHaveAttribute("href", "/favicon-32x32.png");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/site.webmanifest");
  for (const path of ["/favicon.ico", "/favicon-32x32.png", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png"]) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
  const manifest = await (await request.get("/site.webmanifest")).json();
  expect(manifest.name).toBe("Chicago Residential Pipeline");
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(["192x192", "512x512"]);
});

test("home page is branded and search-friendly", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/^Chicago Residential Pipeline \| /);
  expect((await page.title()).length).toBeLessThanOrEqual(60);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://pipeline.monroeresidential.com/og/site.jpg");
  await expect(page.locator('meta[property="og:image:type"]')).toHaveAttribute("content", "image/jpeg");
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", "en_US");
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
