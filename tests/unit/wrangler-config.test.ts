import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Workers Builds runs `npx wrangler preview` for PR/branch builds; that command refuses to run
// unless wrangler.jsonc has a `previews` block (it may be empty).
describe("wrangler.jsonc", () => {
  const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, ""));

  it("has a previews block so PR preview builds can run", () => {
    expect(config.previews).toEqual({});
  });

  it("gives each preview a workers.dev link", () => {
    expect(config.preview_urls).toBe(true);
  });

  it("serves chicagopipeline.com (+ www and the old Monroe subdomain for redirects) from dist/", () => {
    expect(config.assets.directory).toBe("./dist");
    expect(config.routes).toEqual([
      { pattern: "chicagopipeline.com", custom_domain: true },
      { pattern: "www.chicagopipeline.com", custom_domain: true },
      { pattern: "pipeline.monroeresidential.com", custom_domain: true },
    ]);
  });

  it("runs the redirect worker before static assets", () => {
    expect(config.main).toBe("src/worker.ts");
    expect(config.assets.binding).toBe("ASSETS");
    expect(config.assets.run_worker_first).toBe(true);
  });
});
