import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Principal } from "../auth/tokens";
import { HttpError } from "../errors";
import type { Ops } from "../ops";
import { TOOLS } from "./tools";

export function buildMcpServer(ops: Ops, principal: Principal | null): McpServer {
  const server = new McpServer({ name: "chicago-pipeline", version: "1.0.0" });
  for (const tool of TOOLS) {
    if (tool.tier === "editor" && principal?.role !== "editor") continue;
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.input }, async (args: unknown) => {
      try {
        const result = await tool.run(ops, principal, args);
        return { content: [{ type: "text" as const, text: JSON.stringify(result ?? { ok: true }, null, 2) }] };
      } catch (e) {
        const message = e instanceof HttpError
          ? `${e.message}${e.details === undefined ? "" : `\n${JSON.stringify(e.details, null, 2)}`}`
          : "internal error";
        if (!(e instanceof HttpError)) console.error(JSON.stringify({ level: "error", tool: tool.name, message: (e as Error).message }));
        return { isError: true, content: [{ type: "text" as const, text: message }] };
      }
    });
  }
  return server;
}

/** Stateless streamable HTTP: a fresh server per POST, JSON responses. */
export async function handleMcpRequest(req: Request, ops: Ops, principal: Principal | null): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }, { status: 405 });
  }
  const server = buildMcpServer(ops, principal);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}
