import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = new URL("../backup/backup.sh", import.meta.url).pathname;

function stubs(awsLsFails: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "backup-stubs-"));
  writeFileSync(join(dir, "pg_dump"), "#!/bin/sh\nwhile [ $# -gt 0 ]; do [ \"$1\" = -f ] && : > \"$2\"; shift; done\n");
  writeFileSync(join(dir, "aws"), `#!/bin/sh\ncase "$*" in *" ls "*) ${awsLsFails ? "exit 1" : "echo '2026-01-01 00:00:00 1 pipeline-2026-01-01T000000Z.dump'"} ;; esac\nexit 0\n`);
  for (const f of ["pg_dump", "aws"]) chmodSync(join(dir, f), 0o755);
  return dir;
}

function run(awsLsFails: boolean) {
  const dir = stubs(awsLsFails);
  return () => execFileSync("sh", [script], {
    env: { PATH: `${dir}:/usr/bin:/bin`, SPACES_ENDPOINT: "https://x", SPACES_BUCKET: "b" }, encoding: "utf8",
  });
}

describe("backup.sh", () => {
  it("succeeds when upload and retention succeed", () => {
    expect(run(false)()).toMatch(/backup ok/);
  });

  it("fails when the retention listing fails", () => {
    expect(run(true)).toThrow();
  });
});
