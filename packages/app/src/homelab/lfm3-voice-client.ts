import { createAudioEngine, type AudioEngine } from "@/audio";
import { homelabFetchJson, type DaemonHttpTarget, type HomelabTeamView } from "./api";
import { executeAppControlCommand, getAppUiSnapshot } from "./app-control-bridge";
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

export async function executeLfm3PaseoTool(
  target: DaemonHttpTarget,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  trackUsageEvent(`lfm3.tool.${name}`, { source: "assistant_local" });

  switch (name) {
    case "list_sessions":
      return runListSessionsTool(target, args);
    case "switch_session": {
      const sessionId = String(args.session_id ?? "").trim();
      if (!sessionId) return { ok: false, error: "session_id manquant" };
      return executeAppControlCommand(
        "navigate",
        { screen: "sessions", agentId: sessionId },
        "assistant_local",
      );
    }
    case "summarize_session":
      return runSummarizeSessionTool(target, args);
    case "send_message": {
      const message = String(args.message ?? "").trim();
      const sessionId = String(args.session_id ?? "").trim();
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
    case "read_markdown": {
      const docPath = String(args.path ?? "").trim();
      if (!docPath) return { ok: false, error: "path manquant" };
      const doc = await homelabFetchJson<{ ok: boolean; content?: string }>(
        target,
        `/api/homelab/doc?path=${encodeURIComponent(docPath)}`,
      );
      return { ok: true, content: (doc.content ?? "").slice(0, 1800) };
    }
    case "interrupt_session":
      return executeAppControlCommand("speech.stop", {}, "assistant_local");
    default:
      return { ok: false, error: `Outil inconnu: ${name}` };
  }
}

export class Lfm3VoiceClient {
  private ws: WebSocket | null = null;
  private audio: AudioEngine | null = null;
  private target: DaemonHttpTarget;
  private listeners = new Set<() => void>();
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

  connect(wsUrl?: string): void {
    const url = (wsUrl ?? this.state.wsUrl).trim() || DEFAULT_LFM3_WS_URL;
    this.disconnect();
    this.emit({ connectionState: "connecting", wsUrl: url, lastError: "" });
    const socket = new WebSocket(url);
    this.ws = socket;

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          type: "session.config",
          tools_enabled: true,
          language_hint: "fr",
        }),
      );
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
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.audio?.stop();
    this.emit({ connectionState: "disconnected", isCapturing: false, isGenerating: false });
  }

  private async playAudioDelta(msg: Record<string, unknown>): Promise<void> {
    const b64 = typeof msg.pcm_24k_base64 === "string" ? msg.pcm_24k_base64 : "";
    if (!b64) return;
    const sr = typeof msg.sample_rate === "number" ? msg.sample_rate : 24_000;
    const engine = this.ensureAudio();
    await engine.initialize();
    const buf = base64ToArrayBuffer(b64);
    void engine.play({
      arrayBuffer: async () => buf,
      size: buf.byteLength,
      type: `audio/pcm;rate=${sr};bits=16`,
    });
  }

  private async handleToolCallMessage(msg: Record<string, unknown>): Promise<void> {
    const id = String(msg.id ?? "tc-0");
    const name = String(msg.name ?? "");
    const args = (msg.arguments ?? {}) as Record<string, unknown>;
    const output = await executeLfm3PaseoTool(this.target, name, args).catch((err: unknown) => ({
      ok: false,
      error: err instanceof Error ? err.message : "Erreur exécution outil",
    }));
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
        await this.playAudioDelta(msg);
        return;
      case "response.tool_call":
        await this.handleToolCallMessage(msg);
        return;
      case "response.done":
        this.emit({
          isGenerating: false,
          metrics: {
            ttftMs: Number(msg.ttft_ms ?? 0),
            ttfaMs: Number(msg.ttfa_ms ?? 0),
            totalMs: Number(msg.total_ms ?? 0),
            cancelled: Boolean(msg.cancelled),
          },
        });
        return;
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
