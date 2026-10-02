import type { Context, Hono } from "hono";
import { z } from "zod";
import { requireRole, type AppEnv } from "../../auth/middleware";
import { HttpError } from "../../errors";
import type { Ops } from "../../ops";
import { QueueFilterSchema } from "../../review/queue";
import { ApproveOptionsSchema, BulkReviewSchema } from "../../review/review";
import { HISTORY_TABLES, REVERTIBLE } from "../../store/history";
import { ProjectCreateInput, ProjectPatch } from "../../store/projects";
import { FilingSearchSchema } from "../../store/search";

async function body<S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try { raw = await c.req.json(); } catch { throw new HttpError(400, "request body must be JSON"); }
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(400, "invalid request body", r.error.issues);
  return r.data;
}

/** Query strings → typed values for a schema ("true"/"false" → boolean, digits → number). */
function query<S extends z.ZodType>(c: Context<AppEnv>, schema: S): z.infer<S> {
  const raw = Object.fromEntries(Object.entries(c.req.query()).map(([k, v]) =>
    [k, v === "true" ? true : v === "false" ? false : /^\d+$/.test(v) && k !== "q" ? Number(v) : v]));
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(400, "invalid query", r.error.issues);
  return r.data;
}

const id = (c: Context<AppEnv>) => {
  const n = Number(c.req.param("id"));
  if (!Number.isInteger(n)) throw new HttpError(400, "id must be a number");
  return n;
};
const LinkBody = z.strictObject({ project_id: z.string(), filing_id: z.number().int() });
const MergeBody = z.strictObject({ type: z.enum(["organization", "address"]), from_id: z.number().int(), into_id: z.number().int() });
const Page = z.object({ limit: z.number().int().optional(), offset: z.number().int().optional() });

export function registerEditorRoutes(app: Hono<AppEnv>, ops: Ops): void {
  const editor = requireRole("editor");
  const me = (c: Context<AppEnv>) => c.get("principal")!;

  app.get("/v1/queue/summary", editor, async (c) => c.json(await ops.queueSummary()));
  app.get("/v1/queue", editor, async (c) => {
    const q = query(c, QueueFilterSchema.partial().extend(Page.shape));
    const { limit, offset, ...filter } = q;
    return c.json(await ops.listQueue(filter, { limit, offset }));
  });
  app.post("/v1/queue/bulk", editor, async (c) => c.json(await ops.bulkReview(me(c), await body(c, BulkReviewSchema))));
  app.get("/v1/queue/:id", editor, async (c) => c.json(await ops.getQueueItem(id(c))));
  app.post("/v1/queue/:id/approve", editor, async (c) => c.json(await ops.approve(me(c), id(c), await body(c, ApproveOptionsSchema))));
  app.post("/v1/queue/:id/reject", editor, async (c) => {
    const { reason } = await body(c, z.strictObject({ reason: z.string() }));
    await ops.reject(me(c), id(c), reason);
    return c.json({ ok: true });
  });

  app.get("/v1/filings", editor, async (c) => c.json(await ops.searchFilings(query(c, FilingSearchSchema))));
  app.get("/v1/filings/:id", editor, async (c) => c.json(await ops.getFiling(id(c))));
  app.get("/v1/filings/:id/candidates", editor, async (c) => c.json(await ops.matchCandidates(id(c))));
  app.patch("/v1/filings/:id", editor, async (c) => {
    await ops.updateFiling(me(c), id(c), await body(c, z.record(z.string(), z.unknown())));
    return c.json(await ops.getFiling(id(c)));
  });
  app.delete("/v1/filings/:id", editor, async (c) => { await ops.deleteFiling(me(c), id(c)); return c.json({ ok: true }); });
  app.post("/v1/filings/:id/restore", editor, async (c) => { await ops.restoreFiling(me(c), id(c)); return c.json({ ok: true }); });

  app.post("/v1/links", editor, async (c) => { const b = await body(c, LinkBody); await ops.link(me(c), b.project_id, b.filing_id); return c.json({ ok: true }); });
  app.delete("/v1/links", editor, async (c) => { const b = await body(c, LinkBody); await ops.unlink(me(c), b.project_id, b.filing_id); return c.json({ ok: true }); });

  app.post("/v1/projects", editor, async (c) => c.json(await ops.createProject(me(c), await body(c, ProjectCreateInput)), 201));
  app.patch("/v1/projects/:id", editor, async (c) => {
    await ops.updateProject(me(c), c.req.param("id"), await body(c, ProjectPatch));
    return c.json(await ops.getProject(c.req.param("id"), true));
  });
  app.delete("/v1/projects/:id", editor, async (c) => { await ops.deleteProject(me(c), c.req.param("id")); return c.json({ ok: true }); });
  app.post("/v1/projects/:id/restore", editor, async (c) => { await ops.restoreProject(me(c), c.req.param("id")); return c.json({ ok: true }); });

  app.post("/v1/merge", editor, async (c) => { const b = await body(c, MergeBody); return c.json(await ops.merge(me(c), b.type, b.from_id, b.into_id)); });
  app.get("/v1/history/:table/:id", editor, async (c) => {
    const table = z.enum(HISTORY_TABLES).safeParse(c.req.param("table"));
    if (!table.success) throw new HttpError(400, `table must be one of ${HISTORY_TABLES.join(", ")}`);
    return c.json(await ops.history(table.data, c.req.param("id")));
  });
  app.post("/v1/history/:table/:id/revert", editor, async (c) => {
    const table = z.enum(REVERTIBLE).safeParse(c.req.param("table"));
    if (!table.success) throw new HttpError(400, `only ${REVERTIBLE.join(", ")} can be reverted`);
    const { version } = await body(c, z.strictObject({ version: z.number().int().min(1) }));
    await ops.revert(me(c), table.data, c.req.param("id"), version);
    return c.json({ ok: true });
  });
  app.post("/v1/publish", editor, async (c) => c.json({ result: await ops.publishSite() }));
}
