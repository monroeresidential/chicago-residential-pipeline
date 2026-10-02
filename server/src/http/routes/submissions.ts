import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { submissionJsonSchema } from "../../../../shared/records/schemas";
import { requireRole, type AppEnv } from "../../auth/middleware";
import { HttpError } from "../../errors";
import { processSubmission } from "../../intake/submit";
import type { AppDeps } from "../app";

export function registerSubmissionRoutes(app: Hono<AppEnv>, deps: AppDeps): void {
  app.post(
    "/v1/submissions",
    requireRole("submitter"),
    bodyLimit({ maxSize: 10 * 1024 * 1024, onError: (c) => c.json({ error: "request body is larger than 10 MB" }, 413) }),
    async (c) => {
      const rawBody = await c.req.text();
      let body: unknown;
      try { body = JSON.parse(rawBody); } catch { throw new HttpError(400, "request body is not valid JSON"); }
      const res = await processSubmission(deps.db, c.get("principal")!, {
        body, rawBody, idempotencyKey: c.req.header("Idempotency-Key"), dryRun: c.req.query("dry_run") === "true",
      });
      return c.json(res, 202);
    },
  );
  const schema = submissionJsonSchema();
  app.get("/v1/schema/submission.json", (c) => c.json(schema));
}
