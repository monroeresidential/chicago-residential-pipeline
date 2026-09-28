import { describe, expect, it } from "vitest";
import { popupHtml } from "../../src/map/popup";
import { makeProject } from "./fixtures";

describe("popupHtml", () => {
  it("shows name, address, units and cost, and links to the project page", () => {
    const html = popupHtml(makeProject());
    expect(html).toContain("Harris Bank building");
    expect(html).toContain("111 W. Monroe St");
    expect(html).toContain("345 units · $179M");
    expect(html).toContain('href="/projects/111-w-monroe"');
  });

  it("falls back to the address and shows an em dash for missing numbers", () => {
    const html = popupHtml(makeProject({ name: null, address: "118 S. Clinton St", units: 74, tpc_musd: null, confidence: "reported", program: "private" }));
    expect(html).toContain("118 S. Clinton St");
    expect(html).toContain("74 units · —");
    expect(html).not.toContain("null");
    expect(html).toContain("Reported");
  });

  it("shows the program", () => {
    expect(popupHtml(makeProject({ program: "lasalle" }))).toContain("LaSalle Reimagined");
    expect(popupHtml(makeProject({ program: "private" }))).toContain("Private market");
  });

  it("escapes HTML in data", () => {
    const html = popupHtml(makeProject({ name: `<img src=x onerror=alert(1)> & Crain's` }));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; &amp; Crain&#39;s");
  });

  it("shows flags and the Monroe badge", () => {
    const html = popupHtml(makeProject({ flag: "Ownership lawsuit pending", monroe_url: "https://monroeresidential.com/portfolio/x" }));
    expect(html).toContain("⚠ Ownership lawsuit pending");
    expect(html).toContain("A Monroe Residential project");
  });
});
