import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Cloudflare Workers static assets pick Content-Type from the file extension (no charset) and ignore
// the headers our endpoints set at build time. public/_headers must add charset=utf-8, or "—" and "⚠"
// arrive garbled for agents that default to Latin-1.
describe("public/_headers", () => {
  const rules = readFileSync("public/_headers", "utf8");
  const block = (path: string) => rules.split(/\n(?=\/)/).find((b) => b.startsWith(`${path}\n`)) ?? "";

  it.each([
    ["/llms.txt", "text/plain; charset=utf-8"],
    ["/llms-full.txt", "text/plain; charset=utf-8"],
    ["/about.md", "text/markdown; charset=utf-8"],
    ["/projects/*.md", "text/markdown; charset=utf-8"],
    ["/data/projects.csv", "text/csv; charset=utf-8"],
  ])("%s is served as %s", (path, type) => {
    expect(block(path)).toContain(`Content-Type: ${type}`);
  });
});

describe("public/_headers performance rules", () => {
  const rules = readFileSync("public/_headers", "utf8");
  const block = (path: string) => rules.split(/\n(?=\/)/).find((b) => b.startsWith(`${path}\n`)) ?? "";

  it("labels map glyphs as protobuf so Cloudflare compresses them", () => {
    expect(block("/map-assets/fonts/*")).toContain("Content-Type: application/x-protobuf");
  });

  it("caches fingerprinted build assets for a year", () => {
    expect(block("/_astro/*")).toContain("Cache-Control: public, max-age=31536000, immutable");
  });
});
