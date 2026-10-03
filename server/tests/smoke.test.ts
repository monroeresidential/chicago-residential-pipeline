import { describe, expect, it } from "vitest";
import { STATUSES } from "../../shared/constants";

describe("server package", () => {
  it("imports the shared enums", () => {
    expect(STATUSES).toEqual(["completed", "under_construction", "permitted", "approved", "planning"]);
  });
});
