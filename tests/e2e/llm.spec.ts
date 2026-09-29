import { expect, test } from "@playwright/test";
import Papa from "papaparse";

test("CSV and JSON downloads contain every project", async ({ request }) => {
  const geo = await (await request.get("/data/projects.geojson")).json();
  const csv = await request.get("/data/projects.csv");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const rows = Papa.parse<Record<string, string>>(await csv.text(), { header: true, skipEmptyLines: true }).data;
  expect(rows).toHaveLength(geo.features.length);
  const json = await request.get("/data/projects.json");
  expect(json.status()).toBe(200);
  const body = await json.json();
  expect(body.projects).toHaveLength(geo.features.length);
  expect(body.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test("llms.txt lists every project and every link resolves", async ({ request }) => {
  const res = await request.get("/llms.txt");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/plain");
  const txt = await res.text();
  const geo = await (await request.get("/data/projects.geojson")).json();
  const projectLines = txt.split("\n").filter((l) => l.startsWith("- [") && l.includes("/projects/"));
  expect(projectLines).toHaveLength(geo.features.length);
  const links = [...txt.matchAll(/\]\((https:\/\/pipeline\.monroeresidential\.com[^)]*)\)/g)].map((m) => m[1]!);
  expect(links.length).toBeGreaterThan(geo.features.length);
  for (const link of links) {
    const path = new URL(link).pathname;
    expect((await request.get(path)).status(), path).toBe(200);
  }
});

test("llms-full.txt and about.md are served as text", async ({ request }) => {
  const full = await request.get("/llms-full.txt");
  expect(full.status()).toBe(200);
  expect(await full.text()).not.toMatch(/\bnull\b|undefined/);
  const about = await request.get("/about.md");
  expect(about.status()).toBe(200);
  expect(await about.text()).toContain("# How we track the pipeline");
});

test("each project's Markdown matches its HTML page", async ({ page, request }) => {
  const geo = await (await request.get("/data/projects.geojson")).json();
  for (const f of geo.features) {
    const md = await request.get(`/projects/${f.id}.md`);
    expect(md.status(), f.id).toBe(200);
    expect(md.headers()["content-type"]).toMatch(/text\/(markdown|plain)/);
    const text = await md.text();
    await page.goto(`/projects/${f.id}`);
    const h1 = (await page.locator("h1").textContent())!.trim();
    expect(text.split("\n")[0]).toBe(`# ${h1.replace(/([\\`*_[\]|<>])/g, "\\$1")}`);
    const unitsHtml = (await page.locator(".facts div", { has: page.locator("dt", { hasText: /^Units$/ }) }).locator("dd").textContent())!.trim();
    expect(text).toContain(`- Units: ${unitsHtml}`);
    expect(text).not.toMatch(/\bnull\b|undefined/);
  }
});

test("pages advertise their Markdown twin and llms.txt", async ({ page }) => {
  for (const [path, md] of [["/", "/llms.txt"], ["/about", "/about.md"], ["/projects/111-w-monroe", "/projects/111-w-monroe.md"]] as const) {
    await page.goto(path);
    await expect(page.locator('link[rel="alternate"][type="text/markdown"]')).toHaveAttribute("href", md);
    await expect(page.locator('link[rel="help"]')).toHaveAttribute("href", "/llms.txt");
  }
});

test("About page has a section for AI agents and developers", async ({ page }) => {
  await page.goto("/about");
  const section = page.locator("#for-agents");
  await expect(section.getByRole("heading")).toHaveText("For AI agents and developers");
  await expect(section.getByRole("link", { name: "/llms.txt" }).first()).toHaveAttribute("href", "/llms.txt");
});

test("home Dataset JSON-LD lists CSV and JSON downloads", async ({ page }) => {
  await page.goto("/");
  const data = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
  const formats = data.distribution.map((d: { encodingFormat: string }) => d.encodingFormat);
  expect(formats).toEqual(["application/geo+json", "text/csv", "application/json"]);
});
