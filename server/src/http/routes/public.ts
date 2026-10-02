import type { Context, Hono } from "hono";
import { cors } from "hono/cors";
import { sql } from "kysely";
import type { AppEnv } from "../../auth/middleware";
import type { Ops } from "../../ops";
import type { AppDeps } from "../app";

export function registerPublicRoutes(app: Hono<AppEnv>, deps: AppDeps, ops: Ops): void {
  const editorDrafts = (c: Context<AppEnv>) => c.get("principal")?.role === "editor" && c.req.query("include_drafts") === "true";
  const cache = (c: Context<AppEnv>, isPrivate: boolean) => c.header("Cache-Control", isPrivate ? "private, no-store" : "public, max-age=300");

  app.get("/healthz", async (c) => {
    await sql`select 1`.execute(deps.db);
    return c.json({ ok: true });
  });
  for (const path of ["/v1/projects", "/v1/projects/*", "/v1/projects.geojson", "/v1/stats", "/v1/schema/*"]) app.use(path, cors({ origin: "*" }));

  app.get("/v1/projects", async (c) => {
    const drafts = editorDrafts(c);
    const projects = await ops.listProjects({ includeFilings: c.req.query("include") === "filings", includeDrafts: drafts });
    cache(c, drafts);
    return c.json({ as_of: await ops.asOf(), projects });
  });
  app.get("/v1/projects.geojson", async (c) => {
    cache(c, false);
    return c.json(await ops.geojson());
  });
  app.get("/v1/projects/:id", async (c) => {
    const drafts = editorDrafts(c);
    const project = await ops.getProject(c.req.param("id"), drafts);
    cache(c, drafts);
    return c.json(project);
  });
  app.get("/v1/stats", async (c) => {
    cache(c, false);
    return c.json(await ops.stats());
  });
}
