import { describe, expect, it } from "vitest";
import { projectOgContent, renderOgImage, siteOgContent } from "../../src/lib/og";
import { makeProject } from "./fixtures";

describe("OG content", () => {
  it("summarizes a project", () => {
    expect(projectOgContent(makeProject())).toEqual({
      eyebrow: "Chicago Pipeline",
      title: "Harris Bank building",
      subtitle: "345 units · $179M · Approved",
      footer: "By 3F Construction",
    });
  });

  it("skips missing numbers and labels reported projects", () => {
    const c = projectOgContent(makeProject({ name: null, address: "118 S. Clinton St", tpc_musd: null, units: 74, status: "permitted", confidence: "reported" }));
    expect(c).toEqual({ eyebrow: "Chicago Pipeline · Reported", title: "118 S. Clinton St", subtitle: "74 units · Permitted", footer: "By 3F Construction" });
  });

  it("uses the clean Chicago Pipeline design for the site image", () => {
    const c = siteOgContent([makeProject({ id: "a", units: 100, tpc_musd: 1000 }), makeProject({ id: "b", units: 50, tpc_musd: 500 })]);
    expect(c).toEqual({
      eyebrow: "",
      title: "Chicago Pipeline",
      subtitle: "Office-to-residential conversions · Downtown Chicago",
      footer: "By 3F Construction",
    });
  });

  it("credits 3F on projects 3F is building", () => {
    expect(projectOgContent(makeProject({ built_by_3f_url: "https://3fconstruction.net/project/birken-lofts/" })).footer).toBe("Built by 3F Construction");
  });
});

describe("renderOgImage", () => {
  const JPEG = [0xff, 0xd8, 0xff];

  it("renders the site image as a JPEG under WhatsApp's 500 KB limit", async () => {
    const img = new Uint8Array(await renderOgImage(siteOgContent([makeProject()])));
    expect([...img.slice(0, 3)]).toEqual(JPEG);
    expect(img.byteLength).toBeLessThan(500_000);
  }, 20_000);

  it("renders a text-only project image as a JPEG", async () => {
    const img = new Uint8Array(await renderOgImage({ eyebrow: "Chicago Pipeline", title: "Test & <Title>", subtitle: "1 unit", footer: "By 3F Construction" }));
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

describe("tracked caps text", () => {
  // Satori dropped the space in "OFFICE-TO-RESIDENTIAL CONVERSIONS" (hyphenated words + letter-spacing).
  it("keeps every word space by using non-breaking spaces", async () => {
    const { capsText } = await import("../../src/lib/og");
    expect(capsText("Office-to-residential conversions · Downtown Chicago")).toBe(
      "Office-to-residential conversions · Downtown Chicago",
    );
  });
});
