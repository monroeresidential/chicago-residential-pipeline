import { describe, expect, it } from "vitest";
import { GA_MEASUREMENT_ID } from "../../src/lib/site-config";
import { initAnalytics, shouldTrack } from "../../src/scripts/analytics";

describe("shouldTrack", () => {
  it("tracks only the production host", () => {
    expect(shouldTrack("chicagopipeline.com")).toBe(true);
    for (const host of ["localhost", "127.0.0.1", "www.chicagopipeline.com", "my-branch-chicago-pipeline.x.workers.dev", "pipeline.monroeresidential.com"]) {
      expect(shouldTrack(host), host).toBe(false);
    }
  });
});

function fakeEnv(hostname: string) {
  const appended: { tag: string; async?: boolean; src?: string }[] = [];
  const doc = {
    createElement: (tag: string) => ({ tag }) as { tag: string; async?: boolean; src?: string },
    head: { appendChild: (el: { tag: string }) => appended.push(el) },
  };
  const win = { location: { hostname } } as { location: { hostname: string }; dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void };
  return { appended, doc, win };
}

describe("initAnalytics", () => {
  it("loads gtag.js and configures the measurement id on the production host", () => {
    const { appended, doc, win } = fakeEnv("chicagopipeline.com");
    initAnalytics(GA_MEASUREMENT_ID, doc as never, win as never);
    expect(GA_MEASUREMENT_ID).toBe("G-7M568CZ9PM");
    expect(appended).toEqual([{ tag: "script", async: true, src: "https://www.googletagmanager.com/gtag/js?id=G-7M568CZ9PM" }]);
    const calls = (win.dataLayer ?? []).map((args) => Array.from(args as ArrayLike<unknown>));
    expect(calls[0]![0]).toBe("js");
    expect(calls[0]![1]).toBeInstanceOf(Date);
    expect(calls[1]).toEqual(["config", "G-7M568CZ9PM"]);
  });

  it("does nothing on other hosts", () => {
    const { appended, doc, win } = fakeEnv("localhost");
    initAnalytics(GA_MEASUREMENT_ID, doc as never, win as never);
    expect(appended).toEqual([]);
    expect(win.dataLayer).toBeUndefined();
  });
});
