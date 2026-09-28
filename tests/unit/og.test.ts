import { describe, expect, it } from "vitest";
import { projectOgContent, renderOgPng, siteOgContent } from "../../src/lib/og";
import { makeProject } from "./fixtures";

describe("OG content", () => {
  it("summarizes a project", () => {
    expect(projectOgContent(makeProject())).toEqual({
      eyebrow: "Chicago Pipeline",
      title: "Harris Bank building",
      subtitle: "345 units · $179M · Approved",
    });
  });

  it("skips missing numbers and labels reported projects", () => {
    const c = projectOgContent(makeProject({ name: null, address: "118 S. Clinton St", tpc_musd: null, units: 74, status: "permitted", confidence: "reported" }));
    expect(c).toEqual({ eyebrow: "Chicago Pipeline · Reported", title: "118 S. Clinton St", subtitle: "74 units · Permitted" });
  });

  it("summarizes the whole pipeline", () => {
    const c = siteOgContent([makeProject({ id: "a", units: 100, tpc_musd: 1000 }), makeProject({ id: "b", units: 50, tpc_musd: 500 })]);
    expect(c.subtitle).toBe("2 projects · 150 units · $1.5B");
  });
});

describe("renderOgPng", () => {
  it("renders a PNG", async () => {
    const png = new Uint8Array(await renderOgPng({ eyebrow: "Chicago Pipeline", title: "Test & <Title>", subtitle: "1 unit" }));
    expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }, 20_000);
});
