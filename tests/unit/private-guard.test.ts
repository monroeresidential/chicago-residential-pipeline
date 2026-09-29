import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// private/, inbox/ and data/raw/ hold confidential deal materials. The repo is public, so nothing under
// them may ever be tracked (e.g. via an accidental `git add -f`). inbox/README.md is the one exception.
describe("confidential folders stay out of git", () => {
  const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n");

  it("tracks nothing under private/, data/raw/, or inbox/ (except inbox/README.md)", () => {
    const leaks = tracked.filter(
      (f) => f.startsWith("private/") || f.startsWith("data/raw/") || (f.startsWith("inbox/") && f !== "inbox/README.md"),
    );
    expect(leaks).toEqual([]);
  });

  it("ignores private/", () => {
    expect(execSync("git check-ignore private/deals.csv || true", { encoding: "utf8" }).trim()).toBe("private/deals.csv");
  });
});
