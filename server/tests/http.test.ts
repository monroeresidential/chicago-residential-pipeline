import { beforeEach, describe, expect, it } from "vitest";
import { permitRecord, zbaRecord } from "../../shared/tests/fixtures";
import { createApp } from "../src/http/app";
import { withActor } from "../src/db/actor";
import { createProjectRow } from "../src/store/projects";
import { makeApp, postJson, queueRecords, testConfig } from "./helpers/app";

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => { ctx = await makeApp(); });
const req = (method: string, path: string, token?: string, body?: unknown) =>
  ctx.app.request(path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const project = (id: string, visibility: "draft" | "published") => withActor(ctx.db, "drew", "admin_edit", (q) => createProjectRow(q, {
  id, name: id, address: "111 W Monroe St", program: "private", status: "planning", status_note: "n",
  lat: 41.880635, lng: -87.631098, sources: ["https://example.com/a"], visibility,
}));

const EDITOR_ROUTES: [string, string][] = [
  ["GET", "/v1/queue/summary"], ["GET", "/v1/queue"], ["GET", "/v1/queue/1"], ["POST", "/v1/queue/1/approve"],
  ["POST", "/v1/queue/1/reject"], ["POST", "/v1/queue/bulk"], ["GET", "/v1/filings"], ["GET", "/v1/filings/1"],
  ["GET", "/v1/filings/1/candidates"], ["PATCH", "/v1/filings/1"], ["DELETE", "/v1/filings/1"], ["POST", "/v1/filings/1/restore"],
  ["POST", "/v1/links"], ["DELETE", "/v1/links"], ["POST", "/v1/projects"], ["PATCH", "/v1/projects/x"], ["DELETE", "/v1/projects/x"],
  ["POST", "/v1/projects/x/restore"], ["POST", "/v1/merge"], ["GET", "/v1/history/projects/x"], ["POST", "/v1/history/projects/x/revert"],
  ["POST", "/v1/publish"],
];

describe("roles", () => {
  it.each(EDITOR_ROUTES)("%s %s: anonymous 401, submitter 403", async (method, path) => {
    const body = method === "GET" ? undefined : {};
    expect((await req(method, path, undefined, body)).status).toBe(401);
    expect((await req(method, path, ctx.grok, body)).status).toBe(403);
  });
});

describe("public routes", () => {
  it("serve published projects with caching and CORS headers", async () => {
    await project("pub", "published");
    await project("draft", "draft");
    const r = await req("GET", "/v1/projects");
    expect(r.headers.get("cache-control")).toBe("public, max-age=300");
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    const body = (await r.json()) as { as_of: string; projects: { id: string }[] };
    expect(body.projects.map((p) => p.id)).toEqual(["pub"]);
  });

  it("include_drafts works only for editors and is never cached", async () => {
    await project("draft", "draft");
    expect(((await (await req("GET", "/v1/projects?include_drafts=true")).json()) as any).projects).toEqual([]);
    const r = await req("GET", "/v1/projects?include_drafts=true", ctx.drew);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(((await r.json()) as any).projects.map((p: any) => p.id)).toEqual(["draft"]);
    expect((await req("GET", "/v1/projects/draft")).status).toBe(404);
  });

  it("serves GeoJSON, stats and health", async () => {
    await project("pub", "published");
    const geo = (await (await req("GET", "/v1/projects.geojson")).json()) as any;
    expect(geo.type).toBe("FeatureCollection");
    expect(((await (await req("GET", "/v1/stats")).json()) as any).count).toBe(1);
    expect(await (await req("GET", "/healthz")).json()).toEqual({ ok: true });
  });
});

describe("editor flow over REST", () => {
  it("queue → approve with link → public project shows the filing", async () => {
    await project("pub", "published");
    const [id] = await queueRecords(ctx, [permitRecord()]);
    const list = (await (await req("GET", "/v1/queue?kind=permit", ctx.drew)).json()) as any;
    expect(list.total).toBe(1);
    expect((await req("POST", `/v1/queue/${id}/approve`, ctx.drew, { link_to: "pub" })).status).toBe(200);
    const p = (await (await req("GET", "/v1/projects/pub")).json()) as any;
    expect(p.filings.map((f: any) => f.source_key)).toEqual(["100912345"]);
  });

  it("editors see a project's unit source filing; the public does not", async () => {
    await project("pub", "published");
    const [id] = await queueRecords(ctx, [permitRecord()]);
    const approved = (await (await req("POST", `/v1/queue/${id}/approve`, ctx.drew, { link_to: "pub" })).json()) as any;
    const patched = (await (await req("PATCH", "/v1/projects/pub", ctx.drew, { units_source_filing_id: approved.filing_id })).json()) as any;
    expect(patched.units_source_filing_id).toBe(approved.filing_id);
    const editorRead = (await (await req("GET", "/v1/projects/pub?include_drafts=true", ctx.drew)).json()) as any;
    expect(editorRead.units_source_filing_id).toBe(approved.filing_id);
    expect((await (await req("GET", "/v1/projects/pub")).json()) as any).not.toHaveProperty("units_source_filing_id");
  });

  it("validates bodies (400) and reports missing records (404)", async () => {
    expect((await req("PATCH", "/v1/projects/pub", ctx.drew, { units: "many" })).status).toBe(400);
    expect((await req("GET", "/v1/queue/999", ctx.drew)).status).toBe(404);
  });

  it("searches filings by address and identifier", async () => {
    const [id] = await queueRecords(ctx, [zbaRecord()]);
    await req("POST", `/v1/queue/${id}/approve`, ctx.drew, {});
    const byStreet = (await (await req("GET", "/v1/filings?q=3642%20W%20Oakdale", ctx.drew)).json()) as any[];
    expect(byStreet.map((f) => f.source_key)).toEqual(["420-24-S"]);
    const byKey = (await (await req("GET", "/v1/filings?q=420-24", ctx.drew)).json()) as any[];
    expect(byKey.map((f) => f.source_key)).toEqual(["420-24-S"]);
  });
});

describe("deleted filings", () => {
  it("are hidden from ordinary editor reads and search", async () => {
    const [id] = await queueRecords(ctx, [zbaRecord()]);
    const approved = (await (await req("POST", `/v1/queue/${id}/approve`, ctx.drew, {})).json()) as any;
    await req("DELETE", `/v1/filings/${approved.filing_id}`, ctx.drew);
    expect((await req("GET", `/v1/filings/${approved.filing_id}`, ctx.drew)).status).toBe(404);
    expect((await req("GET", `/v1/filings/${approved.filing_id}/candidates`, ctx.drew)).status).toBe(404);
    expect((await (await req("GET", "/v1/filings?q=420-24", ctx.drew)).json()) as any[]).toEqual([]);
    expect((await req("GET", "/v1/filings?include_deleted=true", ctx.drew)).status).toBe(400);
    expect((await req("POST", `/v1/filings/${approved.filing_id}/restore`, ctx.drew)).status).toBe(200);
  });
});

describe("logging", () => {
  it("logs unexpected errors without their message", async () => {
    const lines: string[] = [];
    const orig = console.error;
    console.error = (l: string) => { lines.push(String(l)); };
    try {
      const app = createApp({ db: ctx.db, config: testConfig, log: () => {} });
      app.get("/boom", () => { throw new Error("value 123-secret-input"); });
      const r = await app.request("/boom");
      expect(r.status).toBe(500);
      expect(((await r.json()) as any).error_id).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      console.error = orig;
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("secret");
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: "error", path: "/boom", error: "Error" });
  });

  it("logs one line per request without tokens or bodies", async () => {
    const lines: string[] = [];
    const app = createApp({ db: ctx.db, config: testConfig, log: (l) => lines.push(l) });
    await postJson(app, "/v1/submissions", { secret: "body" }, ctx.grok, { "Idempotency-Key": "x" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(ctx.grok);
    expect(lines[0]).not.toContain("secret");
    expect(JSON.parse(lines[0]!)).toMatchObject({ method: "POST", path: "/v1/submissions", status: 400, sub: "grok" });
  });
});
