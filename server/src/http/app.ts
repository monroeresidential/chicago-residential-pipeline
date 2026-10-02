import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { authenticate, type AppEnv } from "../auth/middleware";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { HttpError } from "../errors";
import { registerSubmissionRoutes } from "./routes/submissions";

export interface AppDeps { db: Db; config: Config }

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", authenticate(deps));
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: err.message, ...(err.details === undefined ? {} : { details: err.details }) }, err.status as ContentfulStatusCode);
    }
    console.error(JSON.stringify({ t: new Date().toISOString(), level: "error", path: c.req.path, message: (err as Error).message }));
    return c.json({ error: "internal error" }, 500);
  });
  app.notFound((c) => c.json({ error: "not found" }, 404));
  registerSubmissionRoutes(app, deps);
  return app;
}
