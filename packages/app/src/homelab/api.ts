import { isWeb } from "@/constants/platform";
import type { HostProfile } from "@/types/host-connection";
import { buildDaemonWebSocketUrl } from "@/utils/daemon-endpoints";

export interface HomelabGpuNode {
  name: string;
  short: string;
  model: string;
  endpoint: string;
  online: boolean;
  ready: boolean;
  enabled?: boolean;
  irisDegraded?: boolean | null;
  irisScriptAvailable?: boolean;
  tempC?: number | null;
  models?: string[];
  role: string;
}

export interface HomelabGpuStatus {
  routerOnline: boolean;
  router: {
    mac_enabled?: boolean;
    blade_enabled?: boolean;
    tts_enabled?: boolean;
    tts_voice?: string;
    pocket_tts_online?: boolean;
    active_primary_target?: string;
  };
  colab: {
    state?: string;
    phase?: string;
    session?: string;
    gpu?: string;
    default_model?: string;
    loaded_models?: string[];
    in_flight?: number;
    idle_seconds?: number;
    idle_timeout_seconds?: number;
    auto_stop_in_seconds?: number;
    compute_units_balance?: number;
    compute_units_rate_hr?: number;
    vram_used_gb?: number;
    vram_total_gb?: number;
    vram_pct?: number;
    estimated_hours_remaining?: {
      G4_96GB_hours?: number;
      A100_80GB_hours?: number;
      L4_24GB_hours?: number;
      T4_15GB_hours?: number;
    };
    last_error?: string | null;
  };
  irisDegraded: boolean;
  irisSwitch: {
    switching: boolean;
    target: "degraded" | "normal" | null;
    lastResult: string;
    lastError: string;
    updatedAt: number;
  };
  nodes: {
    mac: HomelabGpuNode;
    evo: HomelabGpuNode;
    air: HomelabGpuNode;
    blade: HomelabGpuNode;
  };
}

export interface HomelabTeamAgent {
  id: string;
  shortId: string;
  title: string;
  status: string;
  provider: string;
  model: string;
  workspaceId: string;
  sessionId: string;
  updatedAt: string;
  tag: string;
  machine: string;
  badge: string;
}

export interface HomelabTimelineItem {
  id: string;
  agentId: string;
  agentShort: string;
  workspaceId: string;
  role: string;
  ts: number;
  isSub: boolean;
  tag: string;
  machine: string;
  badge: string;
  text: string;
  reasoning: string;
  tools: Array<{ name: string; status: string; input: string; output: string }>;
}

export interface HomelabTeamView {
  cwd: string;
  repo: string;
  knownCwds: string[];
  opencodePort: number | null;
  agents: HomelabTeamAgent[];
  timeline: HomelabTimelineItem[];
  board: string;
  docs: Array<{ name: string; rel: string; sizeKb: number }>;
}

export interface DaemonHttpTarget {
  baseUrl: string;
  headers: Record<string, string>;
}

export function resolveHomelabDaemonTarget(hosts: readonly HostProfile[]): DaemonHttpTarget {
  // Sur l'application Web servie directement par le daemon, même origine = le plus fiable
  if (
    isWeb &&
    typeof window !== "undefined" &&
    (window.location.protocol === "http:" || window.location.protocol === "https:")
  ) {
    const primaryHost = hosts[0];
    const headers: Record<string, string> = {};
    if (primaryHost?.password) {
      headers.Authorization = `Bearer ${primaryHost.password}`;
    }
    return { baseUrl: window.location.origin, headers };
  }

  for (const host of hosts) {
    const direct = host.connections.find((c) => c.type === "directTcp");
    if (!direct) continue;
    try {
      const wsUrl = new URL(
        buildDaemonWebSocketUrl(direct.endpoint, { useTls: direct.useTls ?? false }),
      );
      wsUrl.protocol = wsUrl.protocol === "wss:" ? "https:" : "http:";
      const headers: Record<string, string> = {};
      if (host.password) {
        headers.Authorization = `Bearer ${host.password}`;
      }
      return { baseUrl: wsUrl.origin, headers };
    } catch {
      continue;
    }
  }

  return { baseUrl: "http://127.0.0.1:6767", headers: {} };
}

export type TemplateUniverse = "colab" | "local";
export type QuantOption = "Q4_K_M" | "Q6_K" | "Q8_0" | "default";
export type ColabGpuTier = "L4" | "A100" | "G4";

export interface ScenarioTemplate {
  id: string;
  name: string;
  description: string;
  universe: TemplateUniverse;
  providerId: string;
  modelId: string;
  quant: QuantOption;
  gpuTier?: ColabGpuTier;
  badgeGpu?: string;
  maxSlots?: number;
  allowLocalSubagents?: boolean;
  systemPrompt: string;
  taskExamples?: string[];
  skillIds: string[];
  mcpIds: string[];
  cliTools?: string[];
  builtIn?: boolean;
  updatedAt: string;
}

export interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
  scope: "both" | TemplateUniverse;
  builtIn?: boolean;
  updatedAt: string;
}

export interface McpTemplate {
  id: string;
  name: string;
  serverName: string;
  description: string;
  transport: "http" | "stdio";
  target: string;
  scope: "both" | TemplateUniverse;
  enabledByDefault: boolean;
  builtIn?: boolean;
  updatedAt: string;
}

export interface HomelabTemplatesResponse {
  ok: boolean;
  scenarios: ScenarioTemplate[];
  skills: SkillTemplate[];
  mcps: McpTemplate[];
  updatedAt: string;
}

export interface ProviderModelSpec {
  id: string;
  label: string;
  universe: TemplateUniverse;
  providerId: string;
  modelId: string;
  defaultQuant: QuantOption;
  supportedQuants: QuantOption[];
  vramGbByQuant: Partial<Record<QuantOption, number>>;
}

export interface HomelabCatalogResponse {
  ok: boolean;
  providers: ProviderModelSpec[];
  gpuTiers: Array<{ tier: ColabGpuTier; label: string; vramGb: number; relativeCostRank: number }>;
  maxColabSlots: number;
}

export interface HomelabLaunchRequest {
  universe: TemplateUniverse;
  providerId: string;
  modelId: string;
  quant: QuantOption;
  gpuTier?: ColabGpuTier;
  systemPrompt: string;
  skillIds: string[];
  mcpIds: string[];
  prompt: string;
  cwd?: string;
  title?: string;
}

export interface HomelabLaunchResponse {
  ok: boolean;
  universe: TemplateUniverse;
  gpuTier?: ColabGpuTier;
  quant: QuantOption;
  launched?: Record<string, unknown>;
}

export type UsageEventSource = "user" | "assistant_local" | "agent_remote";

export interface TopUsageEntry {
  key: string;
  count: number;
  sharePct: number;
}

export interface UsageEventRecord {
  action: string;
  screen: string;
  source: UsageEventSource;
  detail?: string;
  ts: number;
}

export interface HomelabUsageStatsResponse {
  ok: boolean;
  updatedAt: string;
  totalEvents: number;
  sourceCounts: Record<UsageEventSource, number>;
  topActions: TopUsageEntry[];
  topScreens: TopUsageEntry[];
  recentEvents: UsageEventRecord[];
}

export interface AppControlStateResponse {
  ok: boolean;
  activeDevice: {
    deviceId: string;
    updatedAt: number;
    snapshot: Record<string, unknown>;
  } | null;
  devices: Array<{ deviceId: string; updatedAt: number; ageMs: number }>;
  pendingCommands: number;
}

export async function homelabFetchJson<T>(
  target: DaemonHttpTarget,
  pathAndQuery: string,
  init: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown } = {},
): Promise<T> {
  const url = `${target.baseUrl}${pathAndQuery}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...target.headers,
  };
  const fetchInit: RequestInit = {
    method: init.method ?? "GET",
    headers,
    credentials: "include",
  };
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    fetchInit.body = JSON.stringify(init.body);
  }
  const response = await fetch(url, fetchInit);
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }
  return data;
}
