import { describe, expect, it } from "vitest";
import { connectWithRetry } from "./helpers/connect";

describe("connectWithRetry", () => {
  it("uses a fresh client per attempt and succeeds once the database is up", async () => {
    let made = 0;
    const factory = () => {
      const n = ++made;
      return {
        connect: async () => { if (n < 3) throw new Error("ECONNREFUSED"); },
        end: async () => {},
      };
    };
    const client = await connectWithRetry(factory, { attempts: 5, delayMs: 1 });
    expect(made).toBe(3);
    expect(client).toBeDefined();
  });

  it("gives up after the last attempt", async () => {
    await expect(connectWithRetry(() => ({ connect: async () => { throw new Error("down"); }, end: async () => {} }), { attempts: 2, delayMs: 1 }))
      .rejects.toThrow("down");
  });
});
