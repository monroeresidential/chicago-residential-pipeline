// Usage: token issue <sub> --role submitter|editor   |   token revoke <jti>   |   token list
import { issueToken, revokeToken, type Role } from "../auth/tokens";
import { loadConfig } from "../config";
import { createDb } from "../db/client";

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const [cmd, arg, flag, roleArg] = process.argv.slice(2);

try {
  if (cmd === "issue" && arg && flag === "--role" && (roleArg === "submitter" || roleArg === "editor")) {
    const { token, jti } = await issueToken(db, config.JWT_SECRET, arg, roleArg as Role);
    console.error(`issued ${roleArg} token for ${arg} (jti ${jti}) — shown once, store it now:`);
    console.log(token);
  } else if (cmd === "revoke" && arg) {
    console.log((await revokeToken(db, arg)) ? `revoked ${arg}` : `no active token ${arg}`);
  } else if (cmd === "list") {
    const rows = await db.selectFrom("tokens").select(["jti", "sub", "role", "created_at", "revoked_at", "last_used_at"]).orderBy("created_at").execute();
    console.table(rows);
  } else {
    console.error("usage: token issue <sub> --role submitter|editor | token revoke <jti> | token list");
    process.exitCode = 2;
  }
} finally {
  await db.destroy();
}
