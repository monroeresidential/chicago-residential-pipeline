import { describe, expect, it } from "vitest";
import { projectOgContent, renderOgImage, siteOgContent } from "../../src/lib/og";
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
    expect(c.caption).toBe("Birken Lofts · 401 W. Ontario · Built by 3F Construction");
    expect(c.eyebrow).toBe("3F Construction");
  });
});

describe("renderOgImage", () => {
  const JPEG = [0xff, 0xd8, 0xff];

  it("renders the photo-backed site image as a JPEG under WhatsApp's 500 KB limit", async () => {
    const img = new Uint8Array(await renderOgImage(siteOgContent([makeProject()])));
    expect([...img.slice(0, 3)]).toEqual(JPEG);
    expect(img.byteLength).toBeGreaterThan(50_000); // a photo, not a flat card
    expect(img.byteLength).toBeLessThan(500_000);
  }, 20_000);

  it("renders a text-only project image as a JPEG", async () => {
    const img = new Uint8Array(await renderOgImage({ eyebrow: "Chicago Residential Pipeline", title: "Test & <Title>", subtitle: "1 unit" }));
    expect([...img.slice(0, 3)]).toEqual(JPEG);
  }, 20_000);
});

describe("share image encoding", () => {
  // Some link-preview renderers (Signal, WhatsApp) fail on progressive JPEGs; emit baseline (SOF0).
  it("renders a baseline, not progressive, JPEG", async () => {
    const img = new Uint8Array(await renderOgImage(siteOgContent([makeProject()])));
    const markers: number[] = [];
    for (let i = 2; i < img.length - 1; i++) if (img[i] === 0xff && img[i + 1]! >= 0xc0 && img[i + 1]! <= 0xc2) { markers.push(img[i + 1]!); break; }
    expect(markers).toEqual([0xc0]);
  }, 20_000);
});
