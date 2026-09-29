import { describe, expect, it } from "vitest";
import worker, { CANONICAL_ORIGIN, redirectFor } from "../../src/worker";

const assets = { fetch: async (req: Request) => new Response(`asset:${new URL(req.url).pathname}`) };

describe("redirectFor", () => {
  it("sends the old Monroe subdomain to the same path on chicagopipeline.com", () => {
    expect(redirectFor(new URL("https://pipeline.monroeresidential.com/projects/111-w-monroe?status=approved#map"))).toBe(
      "https://chicagopipeline.com/projects/111-w-monroe?status=approved#map",
    );
  });

  it("sends www to the apex", () => {
    expect(redirectFor(new URL("https://www.chicagopipeline.com/llms.txt"))).toBe("https://chicagopipeline.com/llms.txt");
  });

  it("does not redirect the canonical host or unknown hosts (previews, workers.dev)", () => {
    expect(redirectFor(new URL("https://chicagopipeline.com/about"))).toBeNull();
    expect(redirectFor(new URL("https://my-branch-chicago-pipeline.example.workers.dev/"))).toBeNull();
  });
});

describe("worker.fetch", () => {
  it("301-redirects old hosts", async () => {
    const res = await worker.fetch(new Request("https://pipeline.monroeresidential.com/about"), { ASSETS: assets });
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe(`${CANONICAL_ORIGIN}/about`);
  });

  it("serves static assets on the canonical host", async () => {
    const res = await worker.fetch(new Request("https://chicagopipeline.com/about"), { ASSETS: assets });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("asset:/about");
  });
});
