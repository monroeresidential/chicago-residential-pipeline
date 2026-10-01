import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTACT_3F_URL, SITE_3F_URL } from "../../src/lib/site-config";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const token = (name: string) => readFileSync("src/styles/global.css", "utf8").match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1] ?? "";

describe("3F brand tokens", () => {
  it("uses the logo's 3F orange and ink", () => {
    expect(token("brand").toLowerCase()).toBe("#f26430");
    expect(token("charcoal").toLowerCase()).toBe("#201f1d");
    expect(token("ground").toLowerCase()).toBe("#1b1a18");
  });

  it("buttons and links pass WCAG AA (4.5:1) — white on accent, accent on white", () => {
    expect(contrast("#ffffff", token("accent"))).toBeGreaterThanOrEqual(4.5);
  });

  it("headings in charcoal pass AA on white", () => {
    expect(contrast(token("charcoal"), "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("3F links carry campaign tags", () => {
  it.each([CONTACT_3F_URL, SITE_3F_URL])("%s has utm_source=chicagopipeline", (url) => {
    const u = new URL(url);
    expect(u.hostname).toBe("3fconstruction.net");
    expect(u.searchParams.get("utm_source")).toBe("chicagopipeline");
  });
});
