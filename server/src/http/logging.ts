import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../auth/middleware";

/** One JSON line per request. Never logs headers, tokens, query strings or bodies. */
export function requestLogger(log: (line: string) => void = (l) => console.log(l)): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const start = performance.now();
    await next();
    log(JSON.stringify({
      t: new Date().toISOString(), method: c.req.method, path: c.req.path, status: c.res.status,
      ms: Math.round(performance.now() - start), sub: c.get("principal")?.sub ?? null,
    }));
  };
}
