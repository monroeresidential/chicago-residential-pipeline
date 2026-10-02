import type { MiddlewareHandler } from "hono";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { verifyToken, type Principal, type Role } from "./tokens";

export type AppEnv = { Variables: { principal: Principal | null } };

export function authenticate(deps: { db: Db; config: Config }): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header("Authorization");
    if (!header) {
      c.set("principal", null);
      return next();
    }
    const m = header.match(/^Bearer\s+(\S+)$/i);
    const principal = m ? await verifyToken(deps.db, deps.config.JWT_SECRET, m[1]!) : null;
    if (!principal) return c.json({ error: "invalid or revoked token" }, 401);
    c.set("principal", principal);
    return next();
  };
}

/** submitter routes accept submitter and editor tokens; editor routes accept editor tokens only. */
export function requireRole(role: Role): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const p = c.get("principal");
    if (!p) return c.json({ error: "authentication required" }, 401);
    if (role === "editor" && p.role !== "editor") return c.json({ error: "this token is not allowed to do that" }, 403);
    return next();
  };
}
