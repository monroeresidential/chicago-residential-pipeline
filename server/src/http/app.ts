import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { authenticate, type AppEnv } from "../auth/middleware";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { HttpError } from "../errors";
import { createOps } from "../ops";
import { requestLogger } from "./logging";
import { registerEditorRoutes } from "./routes/editor";
import { registerPublicRoutes } from "./routes/public";
import { registerSubmissionRoutes } from "./routes/submissions";

export interface AppDeps { db: Db; config: Config }

export function createApp(deps: AppDeps & { log?: (line: string) => void }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const ops = createOps(deps);
  app.use("*", requestLogger(deps.log));
  app.use("*", authenticate(deps));
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: err.message, ...(err.details === undefined ? {} : { details: err.details }) }, err.status as ContentfulStatusCode);
    }
    console.error(JSON.stringify({ t: new Date().toISOString(), level: "error", path: c.req.path, message: (err as Error).message }));
    return c.json({ error: "internal error" }, 500);
  });
  app.notFound((c) => c.json({ error: "not found" }, 404));
  registerPublicRoutes(app, deps, ops);
  registerSubmissionRoutes(app, deps);
  registerEditorRoutes(app, ops);
  return app;
}
