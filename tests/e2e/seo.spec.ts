import { expect, test } from "@playwright/test";

for (const path of ["/og/site.png", "/og/111-w-monroe.png", "/og/118-s-clinton.png"]) {
  test(`share image ${path} is a PNG`, async ({ request }) => {
    const res = await request.get(path);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
  });
}

test("home page has share tags and a description", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://pipeline.monroeresidential.com/og/site.png");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /28 office-to-residential conversions/);
});

test("sitemap lists project pages and robots.txt points to it", async ({ request }) => {
  const sitemap = await (await request.get("/sitemap-0.xml")).text();
  expect(sitemap).toContain("https://pipeline.monroeresidential.com/projects/111-w-monroe<");
  expect(sitemap).not.toContain("/og/");
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Sitemap: https://pipeline.monroeresidential.com/sitemap-index.xml");
});
