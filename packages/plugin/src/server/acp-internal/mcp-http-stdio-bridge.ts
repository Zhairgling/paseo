import readline from "node:readline";
import { pathToFileURL } from "node:url";

export interface McpBridgeHeader {
  name: string;
  value: string;
}

export interface McpBridgeConfig {
  url: string;
  headers: McpBridgeHeader[];
}

function parseBridgeHeaders(raw: string | undefined): McpBridgeHeader[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (entry): entry is McpBridgeHeader =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as McpBridgeHeader).name === "string" &&
          typeof (entry as McpBridgeHeader).value === "string",
      );
    }
    if (typeof parsed === "object" && parsed !== null) {
      return Object.entries(parsed).flatMap(([name, value]) =>
        typeof value === "string" ? [{ name, value }] : [],
      );
    }
    return [];
  } catch {
    return [];
  }
}

function writeJsonLine(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function writeJsonRpcError(id: unknown, message: string): void {
  if (id === undefined || id === null) return;
  writeJsonLine({
    jsonrpc: "2.0",
    id,
    error: { code: -32603, message },
  });
}

function emitSsePayloads(body: string): void {
  const blocks = body.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) continue;
    const payload = dataLines.join("\n").trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const parsed: unknown = JSON.parse(payload);
      if (Array.isArray(parsed)) {
        for (const item of parsed) writeJsonLine(item);
      } else {
        writeJsonLine(parsed);
      }
    } catch {
      process.stderr.write(`MCP stdio-http bridge ignored malformed SSE frame\n`);
    }
  }
}

function buildRequestHeaders(
  config: McpBridgeConfig,
  state: { sessionId: string | null; protocolVersion: string | null },
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  for (const header of config.headers) {
    headers[header.name] = header.value;
  }
  if (state.sessionId) headers["mcp-session-id"] = state.sessionId;
  if (state.protocolVersion) headers["mcp-protocol-version"] = state.protocolVersion;
  return headers;
}

function readNegotiatedProtocolVersion(msg: unknown): string | null {
  if (typeof msg !== "object" || msg === null) return null;
  const result = (msg as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) return null;
  const version = (result as { protocolVersion?: unknown }).protocolVersion;
  return typeof version === "string" ? version : null;
}

function emitJsonPayloads(
  bodyText: string,
  method: unknown,
  id: unknown,
  state: { protocolVersion: string | null },
): void {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    for (const msg of messages) {
      if (method === "initialize") {
        const version = readNegotiatedProtocolVersion(msg);
        if (version) state.protocolVersion = version;
      }
      writeJsonLine(msg);
    }
  } catch {
    writeJsonRpcError(id, `MCP HTTP returned invalid JSON response`);
  }
}

async function forwardRpcMessage(
  rawLine: string,
  config: McpBridgeConfig,
  state: { sessionId: string | null; protocolVersion: string | null },
): Promise<void> {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawLine) as Record<string, unknown>;
  } catch {
    return;
  }

  let response: Response;
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers: buildRequestHeaders(config, state),
      body: JSON.stringify(payload),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeJsonRpcError(payload.id, `MCP HTTP request failed: ${message}`);
    return;
  }

  const nextSessionId = response.headers.get("mcp-session-id");
  if (nextSessionId) state.sessionId = nextSessionId;
  if (response.status === 202 || response.status === 204) return;

  const bodyText = await response.text();
  if (!response.ok) {
    writeJsonRpcError(
      payload.id,
      `MCP HTTP ${response.status}: ${bodyText || response.statusText}`,
    );
    return;
  }
  if (!bodyText.trim()) return;

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/event-stream")) {
    emitSsePayloads(bodyText);
    return;
  }
  emitJsonPayloads(bodyText, payload.method, payload.id, state);
}

export async function runMcpHttpStdioBridge(config: McpBridgeConfig): Promise<void> {
  const state: { sessionId: string | null; protocolVersion: string | null } = {
    sessionId: null,
    protocolVersion: null,
  };
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  let lane = Promise.resolve();
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    lane = lane.then(() => forwardRpcMessage(trimmed, config, state));
    await lane;
  }

  if (state.sessionId) {
    const deleteHeaders: Record<string, string> = { "mcp-session-id": state.sessionId };
    for (const header of config.headers) {
      deleteHeaders[header.name] = header.value;
    }
    await fetch(config.url, { method: "DELETE", headers: deleteHeaders }).catch(() => undefined);
  }
}

const isEntrypoint =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  const url = process.env.PASEO_MCP_BRIDGE_URL?.trim();
  if (!url) {
    process.stderr.write("Missing PASEO_MCP_BRIDGE_URL environment variable\n");
    process.exit(1);
  }
  const headers = parseBridgeHeaders(process.env.PASEO_MCP_BRIDGE_HEADERS);
  runMcpHttpStdioBridge({ url, headers }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
