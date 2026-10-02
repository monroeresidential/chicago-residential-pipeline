import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { permitRecord } from "../../shared/tests/fixtures";
import { TOOLS } from "../src/mcp/tools";
import { withActor } from "../src/db/actor";
import { createProjectRow } from "../src/store/projects";
import { makeApp, queueRecords } from "./helpers/app";

let ctx: Awaited<ReturnType<typeof makeApp>>;
let server: ServerType;
let base: string;

beforeEach(async () => {
  ctx = await makeApp();
  server = serve({ fetch: ctx.app.fetch, port: 0, hostname: "127.0.0.1" });
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise<void>((r) => server.close(() => r())));

async function client(token?: string) {
  const c = new Client({ name: "test", version: "1.0.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  }));
  return c;
}
const text = (r: Awaited<ReturnType<Client["callTool"]>>) => JSON.parse((r.content as { text: string }[])[0]!.text);

describe("MCP", () => {
  it("anonymous and submitter clients see only the public tools", async () => {
    for (const token of [undefined, ctx.grok]) {
      const names = (await (await client(token)).listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(["get_project", "pipeline_stats", "search_projects"]);
    }
  });

  it("editors see every tool", async () => {
    const names = (await (await client(ctx.drew)).listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(TOOLS.map((t) => t.name).sort());
  });

  it("reviews a queue item end to end", async () => {
    await withActor(ctx.db, "drew", "admin_edit", (q) => createProjectRow(q, {
      id: "pub", name: "Pub", address: "111 W Monroe St", program: "private", status: "approved", status_note: "n",
      lat: 41.880635, lng: -87.631098, sources: ["https://example.com/a"], visibility: "published",
    }));
    await queueRecords(ctx, [permitRecord()]);
    const editor = await client(ctx.drew);
    const queue = text(await editor.callTool({ name: "list_queue", arguments: { kind: "permit" } }));
    expect(queue.total).toBe(1);
    const approved = text(await editor.callTool({ name: "approve", arguments: { id: queue.items[0].id, link_to: "pub", accept_status_change: true } }));
    expect(approved).toMatchObject({ linked_project_id: "pub", status_change: { to: "permitted" } });
    const pub = await client();
    const project = text(await pub.callTool({ name: "get_project", arguments: { id: "pub" } }));
    expect(project.status).toBe("permitted");
    expect(project.filings[0].source_key).toBe("100912345");
  });

  it("returns tool errors as isError results", async () => {
    const r = await (await client(ctx.drew)).callTool({ name: "approve", arguments: { id: 999 } });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0]!.text).toContain("no queue item 999");
  });

  it("rejects invalid tokens and non-POST requests", async () => {
    await expect(client("not-a-token")).rejects.toThrow();
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
  });
});
