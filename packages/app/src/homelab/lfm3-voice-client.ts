import { createAudioEngine, type AudioEngine } from "@/audio";
import { homelabFetchJson, type DaemonHttpTarget, type HomelabTeamView } from "./api";
import {
  executeAppControlCommand,
  formatActivePaseoContext,
  getAppUiSnapshot,
  subscribeAppUiSnapshot,
} from "./app-control-bridge";
import { trackUsageEvent } from "./usage-stats";

export const DEFAULT_LFM3_WS_URL = "ws://100.67.68.24:18765";

export type Lfm3ConnectionState = "disconnected" | "connecting" | "ready" | "error";

export interface Lfm3ToolLogEntry {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  output: Record<string, unknown>;
  ts: number;
}

export interface Lfm3TurnMetrics {
  ttftMs: number;
  ttfaMs: number;
  totalMs: number;
  cancelled: boolean;
}

export interface Lfm3VoiceState {
  connectionState: Lfm3ConnectionState;
  wsUrl: string;
  modelLabel: string;
  isCapturing: boolean;
  isGenerating: boolean;
  streamingText: string;
  lastError: string;
  metrics: Lfm3TurnMetrics | null;
  toolLogs: Lfm3ToolLogEntry[];
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function runListSessionsTool(
  target: DaemonHttpTarget,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const team = await homelabFetchJson<HomelabTeamView>(target, "/api/homelab/team");
  const statusFilter = typeof args.status === "string" ? args.status.toLowerCase() : "all";
  const agents = (team.agents ?? []).filter((a) => {
    const running = a.status.toLowerCase() === "running";
    if (statusFilter === "active" || statusFilter === "running") return running;
    if (statusFilter === "idle") return !running;
    return true;
  });
  return {
    ok: true,
    count: agents.length,
    sessions: agents.slice(0, 8).map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      machine: a.machine,
      model: a.model,
    })),
  };
}

async function runSummarizeSessionTool(
  target: DaemonHttpTarget,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const sessionId = String(args.session_id ?? "").trim();
  const uiSnap = getAppUiSnapshot();
  if (!sessionId || sessionId === uiSnap.activeAgentId) {
    return {
      ok: true,
      screen: uiSnap.screen,
      lastMessage: uiSnap.lastAssistantMessage?.textPreview ?? "Aucun message visible",
    };
  }
  const team = await homelabFetchJson<HomelabTeamView>(target, "/api/homelab/team");
  const found = (team.agents ?? []).find((a) => a.id === sessionId);
  return found
    ? { ok: true, id: found.id, title: found.title, status: found.status, machine: found.machine }
    : { ok: false, error: `Session ${sessionId} introuvable` };
}

async function runSwitchSessionTool(
  target: DaemonHttpTarget,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const query = String(args.session ?? args.session_id ?? "").trim();
  if (!query) return { ok: false, error: "session manquant" };
  let resolvedId = query;
  try {
    const team = await homelabFetchJson<HomelabTeamView>(target, "/api/homelab/team");
    const lower = query.toLowerCase();
    const match = (team.agents ?? []).find(
      (a) => a.id === query || a.id.startsWith(query) || a.title.toLowerCase().includes(lower),
    );
    if (match) resolvedId = match.id;
  } catch {
    // Fallback to direct ID navigation
  }
  return executeAppControlCommand(
    "navigate",
    { screen: "sessions", agentId: resolvedId },
    "assistant_local",
  );
}

async function runSendTool(
  target: DaemonHttpTarget,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const message = String(args.text ?? args.message ?? "").trim();
  const sessionId = String(args.session ?? args.session_id ?? "").trim();
  if (!message) return { ok: false, error: "message vide" };
  if (!sessionId) {
    await executeAppControlCommand(
      "composer.set_text",
      { text: message, mode: "replace" },
      "assistant_local",
    );
    return executeAppControlCommand("composer.submit", {}, "assistant_local");
  }
  const res = await homelabFetchJson<Record<string, unknown>>(target, "/api/homelab/send", {
    method: "POST",
    body: { agentId: sessionId, prompt: message },
  });
  return { ok: true, delivered: true, res };
}

const KNOWN_LFM3_TOOLS = new Set([
  "list_sessions",
  "switch_session",
  "summarize_session",
  "scroll",
  "show_image",
  "draft",
  "send",
  "send_message",
  "read_aloud",
  "stop_speech",
  "read_markdown",
  "interrupt_session",
  "brainstorm_or_reply",
]);

async function runReadMarkdownTool(
  target: DaemonHttpTarget,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const docPath = String(args.path ?? "").trim();
  if (!docPath) return { ok: false, error: "path manquant" };
  const doc = await homelabFetchJson<{ ok: boolean; content?: string }>(
    target,
    `/api/homelab/doc?path=${encodeURIComponent(docPath)}`,
  );
  return { ok: true, content: (doc.content ?? "").slice(0, 1800) };
}

export async function executeLfm3PaseoTool(
  target: DaemonHttpTarget,
  name: string,
  args: Record<string, unknown>,
  utterance = "",
): Promise<Record<string, unknown>> {
  if (!KNOWN_LFM3_TOOLS.has(name)) {
    trackUsageEvent("lfm3.tool_parse_fail", {
      source: "assistant_local",
      meta: { rawName: name, utterance },
    });
    return { ok: false, error: `Outil inconnu: ${name}` };
  }
  trackUsageEvent("lfm3.tool_parse_ok", {
    source: "assistant_local",
    meta: { tool: name, utterance },
  });

  switch (name) {
    case "list_sessions":
      return runListSessionsTool(target, args);
    case "switch_session":
      return runSwitchSessionTool(target, args);
    case "summarize_session":
      return runSummarizeSessionTool(target, args);
    case "scroll":
      return executeAppControlCommand(
        "scroll",
        { direction: String(args.direction ?? "down") },
        "assistant_local",
      );
    case "show_image":
      return executeAppControlCommand("show_image", {}, "assistant_local");
    case "draft":
      return executeAppControlCommand(
        "composer.set_text",
        { text: String(args.text ?? ""), mode: "replace" },
        "assistant_local",
      );
    case "send":
    case "send_message":
      return runSendTool(target, args);
    case "read_aloud":
      return executeAppControlCommand("speech.read_aloud", {}, "assistant_local");
    case "stop_speech":
    case "interrupt_session":
      return executeAppControlCommand("speech.stop", {}, "assistant_local");
    case "brainstorm_or_reply":
      return {
        ok: true,
        mode: "pure_s2s",
        topic: String(args.topic ?? "").trim(),
      };
    case "read_markdown":
      return runReadMarkdownTool(target, args);
    default:
      return { ok: false, error: `Outil inconnu: ${name}` };
  }
}

export class Lfm3VoiceClient {
  private ws: WebSocket | null = null;
  private audio: AudioEngine | null = null;
  private target: DaemonHttpTarget;
  private listeners = new Set<() => void>();
  private unsubContext: (() => void) | null = null;
  private lastAgentKey = "";
  private lastUtterance = "";
  private turnStartMs = 0;
  private playbackQueue: Promise<void> = Promise.resolve();
  private state: Lfm3VoiceState = {
    connectionState: "disconnected",
    wsUrl: DEFAULT_LFM3_WS_URL,
    modelLabel: "",
    isCapturing: false,
    isGenerating: false,
    streamingText: "",
    lastError: "",
    metrics: null,
    toolLogs: [],
  };

  constructor(target: DaemonHttpTarget, wsUrl = DEFAULT_LFM3_WS_URL) {
    this.target = target;
    this.state.wsUrl = wsUrl;
  }

  setTarget(target: DaemonHttpTarget): void {
    this.target = target;
  }

  getState(): Lfm3VoiceState {
    return this.state;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit(patch: Partial<Lfm3VoiceState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }

  private ensureAudio(): AudioEngine {
    if (this.audio) return this.audio;
    this.audio = createAudioEngine(
      {
        onCaptureData: (pcm) => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN && this.state.isCapturing) {
            this.ws.send(
              JSON.stringify({
                type: "input.audio.chunk",
                pcm_16k_base64: uint8ToBase64(pcm),
              }),
            );
          }
        },
        onVolumeLevel: () => undefined,
        onInterruption: () => {
          this.cancelResponse();
        },
      },
      { traceLabel: "lfm3-voice", captureMode: "conversation" },
    );
    return this.audio;
  }

  private pushSessionConfig(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const snap = getAppUiSnapshot();
    this.lastAgentKey = `${snap.screen}:${snap.activeAgentId ?? ""}`;
    this.ws.send(
      JSON.stringify({
        type: "session.config",
        system_prompt: formatActivePaseoContext(snap),
        tools_enabled: true,
        language_hint: "fr",
      }),
    );
  }

  connect(wsUrl?: string): void {
    const url = (wsUrl ?? this.state.wsUrl).trim() || DEFAULT_LFM3_WS_URL;
    this.disconnect();
    this.emit({ connectionState: "connecting", wsUrl: url, lastError: "" });
    const socket = new WebSocket(url);
    this.ws = socket;

    socket.addEventListener("open", () => {
      this.pushSessionConfig();
      this.unsubContext = subscribeAppUiSnapshot(() => {
        const snap = getAppUiSnapshot();
        const key = `${snap.screen}:${snap.activeAgentId ?? ""}`;
        if (key !== this.lastAgentKey) {
          this.pushSessionConfig();
        }
      });
    });

    socket.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
        void this.handleServerMessage(msg);
      } catch {
        // Ignore non-JSON frames
      }
    });

    socket.addEventListener("error", () => {
      this.emit({
        connectionState: "error",
        lastError: `Connexion WebSocket échouée (${url})`,
      });
    });

    socket.addEventListener("close", () => {
      if (this.ws === socket) {
        this.ws = null;
        this.emit({ connectionState: "disconnected", isCapturing: false, isGenerating: false });
      }
    });
  }

  disconnect(): void {
    this.unsubContext?.();
    this.unsubContext = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.audio?.stop();
    this.emit({ connectionState: "disconnected", isCapturing: false, isGenerating: false });
  }

  private playAudioDelta(msg: Record<string, unknown>): void {
    const b64 = typeof msg.pcm_24k_base64 === "string" ? msg.pcm_24k_base64 : "";
    if (!b64) return;
    const sr = typeof msg.sample_rate === "number" ? msg.sample_rate : 24_000;
    const buf = base64ToArrayBuffer(b64);
    this.playbackQueue = this.playbackQueue
      .then(async () => {
        const engine = this.ensureAudio();
        await engine.initialize();
        await engine.play({
          arrayBuffer: async () => buf,
          size: buf.byteLength,
          type: `audio/pcm;rate=${sr};bits=16`,
        });
        return;
      })
      .catch(() => undefined);
  }

  private async handleToolCallMessage(msg: Record<string, unknown>): Promise<void> {
    const id = String(msg.id ?? "tc-0");
    const name = String(msg.name ?? "");
    const args = (msg.arguments ?? {}) as Record<string, unknown>;
    const output = await executeLfm3PaseoTool(this.target, name, args, this.lastUtterance).catch(
      (err: unknown) => ({
        ok: false,
        error: err instanceof Error ? err.message : "Erreur exécution outil",
      }),
    );
    this.emit({
      toolLogs: [
        { id, name, arguments: args, output, ts: Date.now() },
        ...this.state.toolLogs,
      ].slice(0, 12),
    });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "tool.result", name, output }));
    }
  }

  private async handleServerMessage(msg: Record<string, unknown>): Promise<void> {
    const type = String(msg.type ?? "");
    switch (type) {
      case "session.ready":
        this.emit({
          connectionState: "ready",
          modelLabel: `${String(msg.model ?? "LFM3-Audio-2B")} (${String(msg.backend ?? "cuda")})`,
          lastError: "",
        });
        return;
      case "response.text.delta":
        this.emit({
          isGenerating: true,
          streamingText: `${this.state.streamingText}${String(msg.text ?? "")}`,
        });
        return;
      case "response.audio.delta":
        this.playAudioDelta(msg);
        return;
      case "response.tool_call":
        await this.handleToolCallMessage(msg);
        return;
      case "response.done": {
        const wsRttMs = this.turnStartMs > 0 ? Date.now() - this.turnStartMs : 0;
        const ttftMs = Number(msg.ttft_ms ?? 0);
        const ttfaMs = Number(msg.ttfa_ms ?? 0);
        trackUsageEvent("lfm3.latency", {
          source: "assistant_local",
          meta: { wsRttMs, ttftMs, ttfaMs },
        });
        this.emit({
          isGenerating: false,
          metrics: {
            ttftMs,
            ttfaMs,
            totalMs: Number(msg.total_ms ?? 0),
            cancelled: Boolean(msg.cancelled),
          },
        });
        return;
      }
      case "error":
        this.emit({ isGenerating: false, lastError: String(msg.message ?? "Erreur LFM3") });
    }
  }

  async startPushToTalk(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connect();
    }
    this.cancelResponse();
    const engine = this.ensureAudio();
    await engine.initialize();
    await engine.startCapture();
    trackUsageEvent("lfm3.ptt_start", { source: "assistant_local" });
    this.emit({ isCapturing: true, streamingText: "", lastError: "" });
  }

  async commitPushToTalk(): Promise<void> {
    if (this.audio) {
      await this.audio.stopCapture();
    }
    this.turnStartMs = Date.now();
    this.lastUtterance = "(audio_ptt)";
    this.emit({ isCapturing: false, isGenerating: true, streamingText: "" });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "input.audio.commit" }));
    }
  }

  sendTextPrompt(text: string): void {
    const clean = text.trim();
    if (!clean) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.emit({ lastError: "Connecte d'abord le WebSocket LFM3." });
      return;
    }
    this.turnStartMs = Date.now();
    this.lastUtterance = clean;
    trackUsageEvent("lfm3.text_prompt", { source: "assistant_local" });
    this.emit({ isGenerating: true, streamingText: "", lastError: "" });
    this.ws.send(JSON.stringify({ type: "input.text", text: clean }));
  }

  cancelResponse(): void {
    this.audio?.clearQueue();
    this.audio?.stop();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "response.cancel" }));
    }
    this.emit({ isGenerating: false });
  }
}
