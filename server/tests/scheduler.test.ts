import { describe, expect, it } from "vitest";
import { startScheduler } from "../src/jobs/scheduler";
import { testConfig } from "./helpers/app";
import { getTestDb } from "./helpers/db";

describe("startScheduler", () => {
  it("keeps checking for missed runs while publishing keeps failing", async () => {
    let publishes = 0;
    let checks = 0;
    const errors: string[] = [];
    const orig = console.error;
    console.error = (l: string) => { errors.push(l); };
    const stop = startScheduler(getTestDb(), testConfig, 10, {
      publishTick: async () => { publishes++; throw new Error("hook down"); },
      missedRun: async () => { checks++; return "ok"; },
    });
    try {
      await new Promise((r) => setTimeout(r, 80));
    } finally {
      stop();
      console.error = orig;
    }
    expect(publishes).toBeGreaterThan(1);
    expect(checks).toBeGreaterThan(1);
  });
});
