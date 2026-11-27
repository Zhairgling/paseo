import http from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { spawnProcess } from "../process.js";
import { toAcpMcpServers } from "./connection.js";

function closeServer(srv: http.Server): Promise<void> {
  return new Promise((resolve) => {
    srv.close(() => resolve());
  });
}

async function readRequestBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function createMockMcpServer(
  receivedHeaders: Array<{ auth?: string; sessionId?: string }>,
): http.Server {
  return http.createServer(async (req, res) => {
    const body = await readRequestBody(req);
    receivedHeaders.push({
      auth: req.headers.authorization,
      sessionId: req.headers["mcp-session-id"] as string | undefined,
    });
    if (req.method === "DELETE") {
      res.statusCode = 204;
      res.end();
      return;
    }
    const msg = JSON.parse(body) as { id?: number; method?: string };
    if (msg.method === "initialize") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("mcp-session-id", "sess_1");
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { protocolVersion: "2025-03-26", capabilities: {} },
        }),
      );
      return;
    }
    if (msg.method === "tools/list") {
      res.setHeader("Content-Type", "text/event-stream");
      res.end(
        `event: message\ndata: ${JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { tools: [{ name: "create_agent" }] },
        })}\n\n`,
      );
      return;
    }
    res.statusCode = 202;
    res.end();
  });
}

describe("toAcpMcpServers and HTTP-to-stdio bridge", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(closeServer));
  });

  it("bridges HTTP MCP servers over stdio when agent mcpCapabilities.http is absent", () => {
    const result = toAcpMcpServers(
      {
        cwd: process.cwd(),
        env: {},
        mcpServers: {
          paseo: {
            type: "http",
            url: "http://127.0.0.1:6767/mcp/agents?callerAgentId=a1",
            headers: { Authorization: "Bearer secret" },
          },
          native: {
            type: "stdio",
            command: "echo",
            args: ["ok"],
            env: { FOO: "bar" },
          },
        },
        settings: {},
        persist: false,
      },
      {},
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      name: "paseo",
      command: process.execPath,
    });
    expect("type" in result[0]!).toBe(false);
    expect((result[0] as { env: Array<{ name: string; value: string }> }).env).toEqual([
      { name: "PASEO_MCP_BRIDGE_URL", value: "http://127.0.0.1:6767/mcp/agents?callerAgentId=a1" },
      {
        name: "PASEO_MCP_BRIDGE_HEADERS",
        value: JSON.stringify([{ name: "Authorization", value: "Bearer secret" }]),
      },
    ]);
    expect(result[1]).toEqual({
      name: "native",
      command: "echo",
      args: ["ok"],
      env: [{ name: "FOO", value: "bar" }],
    });
  });

  it("passes native HTTP transport when agent advertises mcpCapabilities.http = true", () => {
    const result = toAcpMcpServers(
      {
        cwd: process.cwd(),
        env: {},
        mcpServers: {
          paseo: {
            type: "http",
            url: "http://127.0.0.1:6767/mcp/agents",
            headers: { Authorization: "Bearer tok" },
          },
        },
        settings: {},
        persist: false,
      },
      { http: true, sse: false },
    );

    expect(result).toEqual([
      {
        type: "http",
        name: "paseo",
        url: "http://127.0.0.1:6767/mcp/agents",
        headers: [{ name: "Authorization", value: "Bearer tok" }],
      },
    ]);
  });

  it("forwards JSON and SSE MCP responses between stdio and Streamable HTTP", async () => {
    const receivedHeaders: Array<{ auth?: string; sessionId?: string }> = [];
    const srv = createMockMcpServer(receivedHeaders);
    servers.push(srv);
    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
    const addr = srv.address() as { port: number };

    const compiledBridge = fileURLToPath(
      new URL("../../../dist/server/acp-internal/mcp-http-stdio-bridge.js", import.meta.url),
    );
    const sourceBridge = fileURLToPath(new URL("./mcp-http-stdio-bridge.ts", import.meta.url));
    const bridgeArgs = existsSync(compiledBridge)
      ? [compiledBridge]
      : ["--experimental-strip-types", sourceBridge];

    const child = spawnProcess(process.execPath, bridgeArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PASEO_MCP_BRIDGE_URL: `http://127.0.0.1:${addr.port}/mcp/agents`,
        PASEO_MCP_BRIDGE_HEADERS: JSON.stringify([{ name: "Authorization", value: "Bearer tok" }]),
      },
    });

    const lines: string[] = [];
    child.stdout?.on("data", (chunk) => {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim()) lines.push(line.trim());
      }
    });

    child.stdin?.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`,
    );
    child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (lines.length >= 2) {
          clearInterval(check);
          resolve();
        }
      }, 15);
    });
    child.stdin?.end();
    await new Promise<void>((resolve) => child.once("close", () => resolve()));

    expect(JSON.parse(lines[0]!)).toMatchObject({
      id: 1,
      result: { protocolVersion: "2025-03-26" },
    });
    expect(JSON.parse(lines[1]!)).toMatchObject({
      id: 2,
      result: { tools: [{ name: "create_agent" }] },
    });
    expect(receivedHeaders[0]).toEqual({ auth: "Bearer tok", sessionId: undefined });
    expect(receivedHeaders[1]).toEqual({ auth: "Bearer tok", sessionId: "sess_1" });
  });
});
