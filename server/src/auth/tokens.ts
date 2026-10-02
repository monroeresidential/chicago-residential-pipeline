import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import type { Db } from "../db/client";

export type Role = "submitter" | "editor";
export interface Principal { sub: string; role: Role; jti: string }

const ALG = "HS256";
const key = (secret: string) => new TextEncoder().encode(secret);

export async function issueToken(db: Db, secret: string, sub: string, role: Role): Promise<{ token: string; jti: string }> {
  const jti = randomUUID();
  await db.insertInto("tokens").values({ jti, sub, role }).execute();
  const token = await new SignJWT({ role }).setProtectedHeader({ alg: ALG }).setSubject(sub).setJti(jti).setIssuedAt().sign(key(secret));
  return { token, jti };
}

export async function revokeToken(db: Db, jti: string): Promise<boolean> {
  const r = await db.updateTable("tokens").set({ revoked_at: new Date() }).where("jti", "=", jti).where("revoked_at", "is", null).executeTakeFirst();
  return Number(r.numUpdatedRows) === 1;
}

export async function verifyToken(db: Db, secret: string, token: string): Promise<Principal | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: [ALG] });
    if (!payload.jti || !payload.sub) return null;
    const row = await db.selectFrom("tokens").selectAll().where("jti", "=", payload.jti).executeTakeFirst();
    if (!row || row.revoked_at || row.sub !== payload.sub || row.role !== payload.role) return null;
    await db.updateTable("tokens").set({ last_used_at: new Date() }).where("jti", "=", row.jti).execute();
    return { sub: row.sub, role: row.role as Role, jti: row.jti };
  } catch {
    return null;
  }
}
