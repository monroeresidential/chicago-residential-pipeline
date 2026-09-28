import { describe, expect, it } from "vitest";
import { projectOgContent, renderOgPng, siteOgContent } from "../../src/lib/og";
import { makeProject } from "./fixtures";

describe("OG content", () => {
  it("summarizes a project", () => {
    expect(projectOgContent(makeProject())).toEqual({
      eyebrow: "Chicago Residential Pipeline",
      title: "Harris Bank building",
      subtitle: "345 units · $179M · Approved",
    });
  });

  it("skips missing numbers and labels reported projects", () => {
    const c = projectOgContent(makeProject({ name: null, address: "118 S. Clinton St", tpc_musd: null, units: 74, status: "permitted", confidence: "reported" }));
    expect(c).toEqual({ eyebrow: "Chicago Residential Pipeline · Reported", title: "118 S. Clinton St", subtitle: "74 units · Permitted" });
  });

  it("brands the site image as Chicago Residential Pipeline over the Birken Lofts photo", () => {
    const c = siteOgContent([makeProject({ id: "a", units: 100, tpc_musd: 1000 }), makeProject({ id: "b", units: 50, tpc_musd: 500 })]);
    expect(c.title).toBe("Chicago Residential Pipeline");
    expect(c.subtitle).toBe("2 downtown office-to-residential conversions · 150 units · $1.5B");
    expect(c.background).toMatch(/birken-lofts\.jpg$/);
    expect(c.caption).toBe("Birken Lofts · 401 W. Ontario · A Monroe Residential project");
  });
});

describe("renderOgPng", () => {
  it("renders a PNG with a photo background", async () => {
    const c = siteOgContent([makeProject()]);
    const png = new Uint8Array(await renderOgPng(c));
    expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(png.byteLength).toBeGreaterThan(100_000); // a photo, not a flat navy card
  }, 20_000);

  it("renders a PNG", async () => {
    const png = new Uint8Array(await renderOgPng({ eyebrow: "Chicago Residential Pipeline", title: "Test & <Title>", subtitle: "1 unit" }));
    expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }, 20_000);
});
