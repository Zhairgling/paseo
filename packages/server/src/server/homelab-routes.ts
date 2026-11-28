import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Express, Request, Response } from "express";
import type { Logger } from "pino";
import {
  readHomelabUsageStatsFile,
  recordHomelabUsageEvents,
  resetHomelabUsageStats,
  summarizeHomelabUsageStats,
  type UsageEventInput,
} from "./homelab-stats-store.js";
import {
  buildEffectiveSystemPrompt,
  COLAB_GPU_TIERS,
  COLAB_MAX_SLOTS,
  evaluateColabSlotGuard,
  PROVIDER_CATALOG,
  readHomelabTemplates,
  selectCheapestCompatibleColabGpu,
  writeHomelabTemplates,
  type ColabGpuTier,
  type HomelabTemplatesStoreData,
  type McpTemplate,
  type QuantOption,
  type ScenarioTemplate,
  type SkillTemplate,
  type TemplateUniverse,
} from "./homelab-templates-store.js";
import {
  mutatePinnedSession,
  readPinnedSessions,
  writePinnedSessions,
} from "./pinned-sessions-store.js";
import { getOrCreateServerId } from "./server-id.js";
import { readSessionTags, setSessionTag } from "./session-tags-store.js";

const execFileAsync = promisify(execFile);

const ROUTER_URL = process.env.PASEO_HOMELAB_ROUTER_URL ?? "http://127.0.0.1:11435/router";
const COLAB_STATUS_URL = process.env.PASEO_HOMELAB_COLAB_URL ?? "http://127.0.0.1:11435/status";
const COLAB_WAKE_URL =
  process.env.PASEO_HOMELAB_COLAB_WAKE_URL ?? "http://127.0.0.1:11435/wake?async=1";
const COLAB_STOP_URL = process.env.PASEO_HOMELAB_COLAB_STOP_URL ?? "http://127.0.0.1:11435/stop";
const COLAB_OLLAMA_PS_URL =
  process.env.PASEO_HOMELAB_COLAB_PS_URL ?? "http://127.0.0.1:11436/api/ps";
const EVO_HEALTH_URL = process.env.PASEO_HOMELAB_EVO_HEALTH_URL ?? "http://127.0.0.1:18998/health";
const AIR_MODELS_URL =
  process.env.PASEO_HOMELAB_AIR_MODELS_URL ?? "http://100.94.219.79:8000/v1/models";
const AIR_API_KEY = process.env.PASEO_HOMELAB_AIR_API_KEY ?? "omlx-evo-local";
const IRIS_MODE_SCRIPT =
  process.env.PASEO_HOMELAB_IRIS_SCRIPT ?? "/home/julienc/homelab/paseo-colab/iris_mode.sh";
const DEFAULT_REPO_DIR =
  process.env.PASEO_HOMELAB_DEFAULT_REPO ?? path.join(os.homedir(), "Documents/GitHub/miBand8");
const PASEO_BIN = process.env.PASEO_BIN ?? path.join(os.homedir(), ".local/bin/paseo");

const MAC_MODEL = "mac/qwen3.8-27b-abliterated";
const EVO_MODEL =
  "evo-local//bakeoff/models/Gemma4-26B-A4B-qat-GGUF/gemma-4-26B-A4B-it-qat-UD-Q4_K_XL.gguf";

interface CacheEntry<T> {
  at: number;
  value: T;
}

const cache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string, ttlMs: number): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.at < ttlMs) {
    return entry.value as T;
  }
  return null;
}

function cacheSet<T>(key: string, value: T): T {
  cache.set(key, { at: Date.now(), value });
  return value;
}

function cacheInvalidate(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

interface IrisSwitchState {
  switching: boolean;
  target: "degraded" | "normal" | null;
  lastResult: string;
  lastError: string;
  updatedAt: number;
}

const irisSwitchState: IrisSwitchState = {
  switching: false,
  target: null,
  lastResult: "",
  lastError: "",
  updatedAt: 0,
};

async function fetchJson<T>(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 1800);
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...options.headers,
    };
    const init: RequestInit = {
      method: options.method ?? "GET",
      headers,
      signal: controller.signal,
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    const res = await fetch(url, init);
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function runCmd(
  bin: string,
  args: string[],
  timeoutMs = 15_000,
): Promise<{ rc: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { rc: 0, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    const err = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      rc: typeof err.code === "number" ? err.code : 1,
      stdout: (err.stdout ?? "").trim(),
      stderr: (err.stderr ?? err.message ?? "").trim(),
    };
  }
}

function expandHome(raw: string | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/")) return path.join(os.homedir(), trimmed.slice(2));
  return trimmed;
}

const MACHINE_CLASSIFIERS: ReadonlyArray<{
  match: (comb: string, title: string) => boolean;
  meta: { tag: string; machine: string; badge: string };
}> = [
  {
    match: (c, t) =>
      c.includes("evo-local") || c.includes("gemma-4") || t.includes("gemma4") || t.includes("evo"),
    meta: { tag: "EVO Gemma 4", machine: "evo", badge: "EVO" },
  },
  {
    match: (c, t) => c.includes("mac/") || c.includes("qwen3.8-27b") || t.includes("8-bit"),
    meta: { tag: "MacBook Pro 8-bit", machine: "mac", badge: "MAC" },
  },
  {
    match: (c, t) => c.includes("air/") || t.includes("air explore"),
    meta: { tag: "MacBook Air", machine: "air", badge: "AIR" },
  },
  {
    match: (c, t) => c.includes("blade/") || c.includes("blade-auto") || t.includes("blade verify"),
    meta: { tag: "Razer Blade", machine: "blade", badge: "BLADE" },
  },
  {
    match: (c) => c.includes("colab/") && c.includes("smart-auto"),
    meta: { tag: "Colab Auto", machine: "colab", badge: "AUTO" },
  },
  {
    match: (c) => c.includes("colab/") && (c.includes("qwen3-coder") || c.includes("80b")),
    meta: { tag: "Colab G4 80B", machine: "colab", badge: "COLAB 80B" },
  },
  {
    match: (c) => c.includes("colab/") && c.includes("72b"),
    meta: { tag: "Colab G4 72B", machine: "colab", badge: "COLAB 72B" },
  },
  {
    match: (c) => c.includes("colab/"),
    meta: { tag: "Colab G4", machine: "colab", badge: "COLAB" },
  },
  {
    match: (c) => c.includes("smart-auto"),
    meta: { tag: "Routeur Auto", machine: "colab", badge: "AUTO" },
  },
  {
    match: (c) => c.includes("antigravity"),
    meta: { tag: "Antigravity", machine: "antigravity", badge: "AGY" },
  },
  {
    match: (c) => c.includes("claude"),
    meta: { tag: "Claude", machine: "claude", badge: "CLAUDE" },
  },
];

function classifyMachine(provider: string, model: string, title: string) {
  const comb = `${provider} ${model}`.toLowerCase();
  const t = title.toLowerCase();
  for (const rule of MACHINE_CLASSIFIERS) {
    if (rule.match(comb, t)) {
      return rule.meta;
    }
  }
  return { tag: model.split("/").pop() || provider || "Agent", machine: "other", badge: "AGENT" };
}

async function detectOpencodePort(): Promise<number | null> {
  const cached = cacheGet<number>("oc_port", 4000);
  if (cached !== null) return cached || null;
  const { rc, stdout } = await runCmd("ps", ["-eo", "args"], 2500);
  let port = 0;
  if (rc === 0) {
    for (const line of stdout.split("\n")) {
      if (!line.includes("opencode serve")) continue;
      const m = line.match(/--port\s+(\d+)/);
      if (m?.[1]) {
        port = Number.parseInt(m[1], 10);
        break;
      }
    }
  }
  cacheSet("oc_port", port);
  return port || null;
}

interface DiskAgentRecord {
  id?: string;
  title?: string;
  provider?: string;
  cwd?: string;
  workspaceId?: string;
  lastStatus?: string;
  updatedAt?: string;
  lastActivityAt?: string;
  createdAt?: string;
  archivedAt?: string | null;
  runtimeInfo?: { model?: string; provider?: string; sessionId?: string };
  config?: { model?: string };
}

async function readAgentsFromDir(subDir: string): Promise<DiskAgentRecord[]> {
  const files = await readdir(subDir, { withFileTypes: true }).catch(() => []);
  const records: DiskAgentRecord[] = [];
  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith(".json")) continue;
    try {
      const raw = await readFile(path.join(subDir, file.name), "utf8");
      const parsed = JSON.parse(raw) as DiskAgentRecord;
      if (parsed.id) records.push(parsed);
    } catch {
      // Ignorer les fichiers malformés
    }
  }
  return records;
}

async function loadDiskAgents(paseoHome: string): Promise<DiskAgentRecord[]> {
  const agentsRoot = path.join(paseoHome, "agents");
  if (!(await pathExists(agentsRoot))) return [];
  const dirs = await readdir(agentsRoot, { withFileTypes: true }).catch(() => []);
  const subDirs = dirs.filter((e) => e.isDirectory()).map((e) => path.join(agentsRoot, e.name));
  const nested = await Promise.all(subDirs.map((d) => readAgentsFromDir(d)));
  const out = nested.flat();
  out.sort((a, b) =>
    String(b.lastActivityAt ?? b.updatedAt ?? b.createdAt ?? "").localeCompare(
      String(a.lastActivityAt ?? a.updatedAt ?? a.createdAt ?? ""),
    ),
  );
  return out;
}

async function probeEvoTempC(): Promise<number | null> {
  const hwmonRoot = "/sys/class/hwmon";
  const entries = await readdir(hwmonRoot, { withFileTypes: true }).catch(() => []);
  let fallbackTemp: number | null = null;
  for (const entry of entries) {
    const dir = path.join(hwmonRoot, entry.name);
    const name = (await readFile(path.join(dir, "name"), "utf8").catch(() => "")).trim();
    const raw = (await readFile(path.join(dir, "temp1_input"), "utf8").catch(() => "")).trim();
    const milli = Number.parseInt(raw, 10);
    if (!Number.isFinite(milli) || milli <= 0) continue;
    const tempC = Math.round(milli / 100) / 10;
    if (name === "k10temp") return tempC;
    if (name === "acpitz" && fallbackTemp === null) fallbackTemp = tempC;
  }
  return fallbackTemp;
}

async function probeGpuCluster() {
  const cached = cacheGet<Record<string, unknown>>("gpu_cluster", 3000);
  if (cached) {
    return { ...cached, irisSwitch: { ...irisSwitchState } };
  }

  const hasIrisScript = await pathExists(IRIS_MODE_SCRIPT);
  const [router, colab, colabPs, evoHealth, airModels, irisStatus, evoTempC] = await Promise.all([
    fetchJson<Record<string, unknown>>(ROUTER_URL, { timeoutMs: 1600 }),
    fetchJson<Record<string, unknown>>(COLAB_STATUS_URL, { timeoutMs: 1600 }),
    fetchJson<{ models?: Array<{ size_vram?: number }> }>(COLAB_OLLAMA_PS_URL, { timeoutMs: 800 }),
    fetchJson<{ status?: string }>(EVO_HEALTH_URL, { timeoutMs: 1200 }),
    fetchJson<{ data?: Array<{ id?: string }> }>(AIR_MODELS_URL, {
      headers: { Authorization: `Bearer ${AIR_API_KEY}` },
      timeoutMs: 1500,
    }),
    hasIrisScript
      ? runCmd(IRIS_MODE_SCRIPT, ["status"], 2500)
      : Promise.resolve({ rc: 1, stdout: "", stderr: "" }),
    probeEvoTempC(),
  ]);

  const gpuVramTotals: Record<string, number> = { G4: 96, H100: 80, A100: 80, L4: 24, T4: 15 };
  const colabObj: Record<string, unknown> = colab ? { ...colab } : {};
  if (colabPs?.models && Array.isArray(colabPs.models)) {
    const usedBytes = colabPs.models.reduce((acc, m) => acc + (m.size_vram ?? 0), 0);
    const gpuKey = String(colabObj.gpu ?? "G4").toUpperCase();
    const totalGb = gpuVramTotals[gpuKey] ?? 96;
    const usedGb = Math.round((usedBytes / 1024 ** 3) * 10) / 10;
    colabObj.vram_used_gb = usedGb;
    colabObj.vram_total_gb = totalGb;
    colabObj.vram_pct = Math.max(0, Math.min(100, Math.round((usedGb / totalGb) * 100)));
  }

  const airModelList = (airModels?.data ?? []).map((m) => m.id ?? "").filter(Boolean);
  const airReady = airModelList.some((m) => m.includes("qwen3.5-9b"));
  const evoOnline = evoHealth?.status === "ok";
  const irisDegraded = irisStatus.rc === 0 ? irisStatus.stdout === "ON" : null;
  const r = router ?? {};

  const result = {
    routerOnline: Boolean(router),
    router: r,
    colab: colabObj,
    irisDegraded: Boolean(irisDegraded),
    irisSwitch: { ...irisSwitchState },
    nodes: {
      mac: {
        name: "MacBook Pro M4 Max",
        short: "Mac 8-bit",
        model: "qwen3.8-27b-abliterated",
        endpoint: "100.109.119.56:8000",
        online: Boolean(r.mac_online),
        ready: Boolean(r.mac_model_ready),
        enabled: r.mac_enabled !== false,
        role: "Raisonnement & code principal",
      },
      evo: {
        name: "EVO Local (ROCm)",
        short: "EVO Gemma 4",
        model: "gemma-4-26B-A4B QAT",
        endpoint: "127.0.0.1:18998",
        online: evoOnline,
        ready: evoOnline,
        irisDegraded,
        irisScriptAvailable: hasIrisScript,
        tempC: evoTempC,
        role: "Dev Brain 128K / Iris vocal",
      },
      air: {
        name: "MacBook Air M2",
        short: "Air explore",
        model: "qwen3.5-9b-abliterated",
        endpoint: "100.94.219.79:8000",
        online: Boolean(airModels),
        ready: airReady,
        models: airModelList,
        role: "Sous-agent explore rapide",
      },
      blade: {
        name: "Razer Blade 15 (RTX 3070 Ti)",
        short: "Blade verify",
        model: "qwen3.5-abliterated:9b",
        endpoint: "100.67.68.24:11434",
        online: Boolean(r.blade_online),
        ready: Boolean(r.blade_model_ready),
        enabled: r.blade_enabled !== false,
        role: "Sous-agent verify & contrôles",
      },
    },
  };

  return cacheSet("gpu_cluster", result);
}

function docPriority(name: string): number {
  if (name === "OTA_TEAM_BOARD.md") return 0;
  if (name.toUpperCase() === "README.MD") return 1;
  return 2;
}

async function listMarkdownInDir(dirPath: string): Promise<string[]> {
  if (!(await pathExists(dirPath))) return [];
  const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => path.join(dirPath, e.name));
}

async function listDocs(cwd: string) {
  const root = path.resolve(cwd);
  if (!(await pathExists(root))) {
    return { files: [] as Array<{ name: string; rel: string; sizeKb: number }>, board: "" };
  }

  const [docsMd, rootMd] = await Promise.all([
    listMarkdownInDir(path.join(root, "docs")),
    listMarkdownInDir(root),
  ]);
  const candidates = [...docsMd, ...rootMd];

  const withStats = await Promise.all(
    candidates.map(async (full) => {
      const s = await stat(full).catch(() => null);
      if (!s) return null;
      return {
        name: path.basename(full),
        rel: path.relative(root, full),
        sizeKb: Math.round((s.size / 1024) * 10) / 10,
        mtime: s.mtimeMs,
      };
    }),
  );

  const valid = withStats.filter((x): x is NonNullable<typeof x> => x !== null);
  valid.sort((a, b) => {
    const dp = docPriority(a.name) - docPriority(b.name);
    return dp !== 0 ? dp : b.mtime - a.mtime;
  });

  const boardPath = path.join(root, "docs", "OTA_TEAM_BOARD.md");
  const board = (await pathExists(boardPath))
    ? (await readFile(boardPath, "utf8").catch(() => "")).slice(0, 80_000)
    : "";

  return {
    files: valid.slice(0, 40).map(({ name, rel, sizeKb }) => ({ name, rel, sizeKb })),
    board,
  };
}

interface OpencodeSession {
  id?: string;
  parentID?: string;
  title?: string;
}

interface OpencodeMessage {
  info?: { id?: string; role?: string; time?: { created?: number } };
  parts?: Array<{
    type?: string;
    text?: string;
    tool?: string;
    state?: { status?: string; input?: unknown; output?: unknown; error?: unknown };
  }>;
}

interface AgentSummary {
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

interface TimelineEntry {
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

function summarizeDiskAgent(ag: DiskAgentRecord): AgentSummary {
  const provider = String(ag.provider ?? ag.runtimeInfo?.provider ?? "");
  const model = String(ag.runtimeInfo?.model ?? ag.config?.model ?? "");
  const title = String(ag.title ?? ag.id?.slice(0, 8) ?? "");
  const meta = classifyMachine(provider, model, title);
  return {
    id: String(ag.id ?? ""),
    shortId: String(ag.id ?? "").slice(0, 7),
    title,
    status: String(ag.lastStatus ?? "unknown").toLowerCase(),
    provider,
    model,
    workspaceId: String(ag.workspaceId ?? ""),
    sessionId: String(ag.runtimeInfo?.sessionId ?? ""),
    updatedAt: String(ag.lastActivityAt ?? ag.updatedAt ?? ""),
    tag: meta.tag,
    machine: meta.machine,
    badge: meta.badge,
  };
}

function classifySubagent(title: string, parentBadge: string) {
  const lower = title.toLowerCase();
  if (lower.includes("explore")) {
    return { tag: `Air explore (${parentBadge})`, machine: "air", badge: "AIR" };
  }
  if (lower.includes("verify")) {
    return { tag: `Blade verify (${parentBadge})`, machine: "blade", badge: "BLADE" };
  }
  return { tag: `Subagent (${parentBadge})`, machine: "other", badge: "SUB" };
}

function extractMessageParts(parts: NonNullable<OpencodeMessage["parts"]>) {
  const texts: string[] = [];
  const reasonings: string[] = [];
  const tools: Array<{ name: string; status: string; input: string; output: string }> = [];

  for (const part of parts) {
    if (part.type === "text" && part.text?.trim()) {
      texts.push(part.text.trim());
    } else if (part.type === "reasoning" && part.text?.trim()) {
      reasonings.push(part.text.trim());
    } else if (part.type === "tool") {
      const st = part.state ?? {};
      tools.push({
        name: String(part.tool ?? "tool"),
        status: String(st.status ?? ""),
        input: JSON.stringify(st.input ?? {}).slice(0, 350),
        output: String(st.output ?? st.error ?? "").slice(0, 500),
      });
    }
  }
  return { texts, reasonings, tools };
}

function convertOpencodeMessage(
  msg: OpencodeMessage,
  ag: AgentSummary,
  target: { sid: string; tag: string; machine: string; badge: string; isSub: boolean },
): TimelineEntry | null {
  const info = msg.info ?? {};
  const role = String(info.role ?? "assistant");
  const ts = info.time?.created ?? 0;
  const { texts, reasonings, tools } = extractMessageParts(msg.parts ?? []);

  if (texts.length === 0 && reasonings.length === 0 && tools.length === 0) {
    return null;
  }

  const isUser = role === "user";
  return {
    id: String(info.id ?? `${target.sid}-${ts}`),
    agentId: ag.id,
    agentShort: ag.shortId,
    workspaceId: ag.workspaceId,
    role,
    ts,
    isSub: target.isSub,
    tag: isUser ? "Julien / Prompt" : target.tag,
    machine: isUser ? "user" : target.machine,
    badge: isUser ? "USER" : target.badge,
    text: texts.join("\n\n"),
    reasoning: reasonings.join("\n"),
    tools,
  };
}

async function collectAgentTimeline(
  ocPort: number,
  ag: AgentSummary,
  ocSessionsById: Map<string, OpencodeSession>,
): Promise<TimelineEntry[]> {
  if (!ag.sessionId || ag.sessionId.startsWith("plugin:")) return [];
  const targets = [
    { sid: ag.sessionId, tag: ag.tag, machine: ag.machine, badge: ag.badge, isSub: false },
  ];
  for (const [csId, cs] of ocSessionsById) {
    if (cs.parentID !== ag.sessionId) continue;
    const sub = classifySubagent(String(cs.title ?? "subagent"), ag.badge);
    targets.push({ sid: csId, tag: sub.tag, machine: sub.machine, badge: sub.badge, isSub: true });
  }

  const entries: TimelineEntry[] = [];
  for (const target of targets) {
    const msgs = await fetchJson<OpencodeMessage[]>(
      `http://127.0.0.1:${ocPort}/session/${encodeURIComponent(target.sid)}/message`,
      { timeoutMs: 2500 },
    );
    if (!Array.isArray(msgs)) continue;
    for (const msg of msgs) {
      const converted = convertOpencodeMessage(msg, ag, target);
      if (converted) entries.push(converted);
    }
  }
  return entries;
}

async function fetchOpencodeSessionMap(
  ocPort: number | null,
): Promise<Map<string, OpencodeSession>> {
  const map = new Map<string, OpencodeSession>();
  if (!ocPort) return map;
  const sessList = await fetchJson<OpencodeSession[]>(`http://127.0.0.1:${ocPort}/session`, {
    timeoutMs: 2000,
  });
  if (Array.isArray(sessList)) {
    for (const s of sessList) {
      if (s.id) map.set(s.id, s);
    }
  }
  return map;
}

async function buildTeamView(paseoHome: string, requestedCwd: string | undefined) {
  const [allDisk, hasDefaultRepo, ocPort] = await Promise.all([
    loadDiskAgents(paseoHome),
    pathExists(DEFAULT_REPO_DIR),
    detectOpencodePort(),
  ]);

  const knownCwdsSet = new Set<string>();
  if (hasDefaultRepo) knownCwdsSet.add(DEFAULT_REPO_DIR);
  for (const ag of allDisk) {
    if (ag.cwd) knownCwdsSet.add(expandHome(ag.cwd));
  }
  const knownCwds = Array.from(knownCwdsSet);
  const fallbackCwd = hasDefaultRepo ? DEFAULT_REPO_DIR : (knownCwds[0] ?? process.cwd());
  const targetCwd = expandHome(requestedCwd) || fallbackCwd;

  const wsAgents = allDisk.filter(
    (a) => expandHome(a.cwd) === targetCwd && !a.archivedAt && a.lastStatus !== "archived",
  );
  const running = wsAgents.filter((a) => (a.lastStatus ?? "").toLowerCase() === "running");
  const idle = wsAgents.filter((a) => (a.lastStatus ?? "").toLowerCase() !== "running").slice(0, 3);
  const selected = running.length > 0 ? [...running, ...idle] : wsAgents.slice(0, 4);
  const agentsSummary = selected.map(summarizeDiskAgent);

  const [ocSessionsById, docs] = await Promise.all([
    fetchOpencodeSessionMap(ocPort),
    listDocs(targetCwd),
  ]);

  const timelineGroups = ocPort
    ? await Promise.all(agentsSummary.map((ag) => collectAgentTimeline(ocPort, ag, ocSessionsById)))
    : [];
  const timeline = timelineGroups.flat().sort((a, b) => a.ts - b.ts);

  return {
    cwd: targetCwd,
    repo: path.basename(targetCwd) || targetCwd,
    knownCwds,
    opencodePort: ocPort,
    agents: agentsSummary,
    timeline: timeline.slice(-140),
    board: docs.board,
    docs: docs.files,
  };
}

export function registerHomelabRoutes(
  app: Express,
  deps: { paseoHome: string; serverId?: string; logger: Pick<Logger, "info" | "warn" | "error"> },
): void {
  const { paseoHome, logger } = deps;
  const localServerId = deps.serverId ?? getOrCreateServerId(paseoHome);

  app.get("/api/homelab/pins", (_req: Request, res: Response) => {
    void (async () => {
      try {
        const state = await readPinnedSessions(paseoHome);
        res.json({ ok: true, serverId: localServerId, ...state });
      } catch (err) {
        logger.warn({ err }, "Homelab pins read failed");
        res.status(500).json({ ok: false, error: "Impossible de lire les sessions épinglées" });
      }
    })();
  });

  app.post("/api/homelab/pins", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      pinnedKeys?: unknown;
      key?: unknown;
      serverId?: unknown;
      agentId?: unknown;
      action?: unknown;
    };
    void (async () => {
      try {
        if (Array.isArray(body.pinnedKeys)) {
          const saved = await writePinnedSessions(
            paseoHome,
            body.pinnedKeys.map((k) => String(k)),
          );
          res.json({ ok: true, serverId: localServerId, ...saved });
          return;
        }
        const actionRaw = String(body.action ?? "pin")
          .trim()
          .toLowerCase();
        let action: "pin" | "unpin" | "toggle" = "pin";
        if (actionRaw === "unpin") {
          action = "unpin";
        } else if (actionRaw === "toggle") {
          action = "toggle";
        }
        const serverId =
          typeof body.serverId === "string" && body.serverId.trim()
            ? body.serverId.trim()
            : localServerId;
        const agentId = typeof body.agentId === "string" ? body.agentId.trim() : undefined;
        const key = typeof body.key === "string" ? body.key.trim() : undefined;
        const result = await mutatePinnedSession(paseoHome, {
          key,
          serverId,
          agentId,
          action,
        });
        res.json({ ok: true, serverId: localServerId, ...result });
      } catch (err) {
        logger.warn({ err }, "Homelab pins update failed");
        res.status(400).json({
          ok: false,
          error: err instanceof Error ? err.message : "Mise à jour des épingles impossible",
        });
      }
    })();
  });

  app.post("/api/homelab/permit", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      agentId?: unknown;
      requestId?: unknown;
      decision?: unknown;
    };
    const agentId = String(body.agentId ?? "").trim();
    const requestId = String(body.requestId ?? "").trim();
    const decision = String(body.decision ?? "")
      .trim()
      .toLowerCase();
    if (!agentId || !requestId || (decision !== "allow" && decision !== "deny")) {
      res.status(400).json({
        ok: false,
        error: "Paramètres requis : agentId, requestId, decision (allow|deny)",
      });
      return;
    }
    void (async () => {
      const r = await runCmd(PASEO_BIN, ["permit", decision, agentId, requestId], 10_000);
      if (r.rc === 0) {
        res.json({ ok: true, agentId, requestId, decision });
      } else {
        res.status(500).json({
          ok: false,
          error: (r.stderr || r.stdout || `code ${r.rc}`).trim(),
        });
      }
    })();
  });

  app.post("/api/homelab/colab/stop", (_req: Request, res: Response) => {
    void (async () => {
      const result = await fetchJson<Record<string, unknown>>(COLAB_STOP_URL, {
        method: "POST",
        timeoutMs: 25_000,
      });
      if (!result) {
        res.status(502).json({ ok: false, error: "Proxy Colab :11435 injoignable" });
        return;
      }
      cacheInvalidate("gpu_cluster");
      res.json({ ok: true, result });
    })();
  });

  app.get("/api/homelab/tags", (_req: Request, res: Response) => {
    void (async () => {
      try {
        const state = await readSessionTags(paseoHome);
        res.json({ ok: true, serverId: localServerId, ...state });
      } catch (err) {
        logger.warn({ err }, "Homelab tags read failed");
        res.status(500).json({ ok: false, error: "Impossible de lire les tags" });
      }
    })();
  });

  app.post("/api/homelab/tags", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      key?: unknown;
      serverId?: unknown;
      agentId?: unknown;
      tag?: unknown;
    };
    void (async () => {
      try {
        const serverId =
          typeof body.serverId === "string" && body.serverId.trim()
            ? body.serverId.trim()
            : localServerId;
        const result = await setSessionTag(paseoHome, {
          key: typeof body.key === "string" ? body.key : undefined,
          serverId,
          agentId: typeof body.agentId === "string" ? body.agentId : undefined,
          tag: typeof body.tag === "string" ? body.tag : null,
        });
        res.json({ ok: true, serverId: localServerId, ...result });
      } catch (err) {
        logger.warn({ err }, "Homelab tags update failed");
        res.status(400).json({
          ok: false,
          error: err instanceof Error ? err.message : "Mise à jour du tag impossible",
        });
      }
    })();
  });

  app.get("/api/homelab/gpu", (_req: Request, res: Response) => {
    void (async () => {
      try {
        res.json(await probeGpuCluster());
      } catch (err) {
        logger.warn({ err }, "Homelab GPU probe failed");
        res.status(500).json({ error: "GPU probe failed" });
      }
    })();
  });

  app.post("/api/homelab/router", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const allowed: Record<string, unknown> = {};
    for (const key of ["mac_enabled", "blade_enabled", "tts_enabled", "tts_voice"] as const) {
      if (key in body) allowed[key] = body[key];
    }
    if (Object.keys(allowed).length === 0) {
      res.status(400).json({ ok: false, error: "Aucun paramètre routeur valide" });
      return;
    }
    void (async () => {
      const result = await fetchJson<Record<string, unknown>>(ROUTER_URL, {
        method: "POST",
        body: allowed,
        timeoutMs: 3000,
      });
      if (!result) {
        res.status(502).json({ ok: false, error: "Routeur :11435 injoignable" });
        return;
      }
      cacheInvalidate("gpu_cluster");
      res.json({ ok: true, router: result });
    })();
  });

  app.post("/api/homelab/iris-mode", (req: Request, res: Response) => {
    const mode = String((req.body as { mode?: unknown } | undefined)?.mode ?? "").trim();
    if (mode !== "degraded" && mode !== "normal") {
      res.status(400).json({ ok: false, error: "Mode invalide (attendu : degraded ou normal)" });
      return;
    }
    if (irisSwitchState.switching) {
      res.status(409).json({
        ok: false,
        error: `Bascule déjà en cours vers ${irisSwitchState.target ?? ""}`,
      });
      return;
    }

    void (async () => {
      if (!(await pathExists(IRIS_MODE_SCRIPT))) {
        res.status(404).json({ ok: false, error: `Script introuvable : ${IRIS_MODE_SCRIPT}` });
        return;
      }
      irisSwitchState.switching = true;
      irisSwitchState.target = mode;
      irisSwitchState.lastResult = "";
      irisSwitchState.lastError = "";
      irisSwitchState.updatedAt = Date.now();
      res.json({ ok: true, message: `Bascule ROCm-safe vers « ${mode} » lancée...` });

      const { rc, stdout, stderr } = await runCmd(IRIS_MODE_SCRIPT, [mode], 120_000);
      irisSwitchState.switching = false;
      irisSwitchState.updatedAt = Date.now();
      if (rc === 0) {
        irisSwitchState.lastResult = (stdout || `Mode ${mode} actif`).slice(-400);
      } else {
        irisSwitchState.lastError = (stderr || stdout || `code ${rc}`).slice(-400);
      }
      cacheInvalidate("gpu_cluster");
    })();
  });

  app.get("/api/homelab/team", (req: Request, res: Response) => {
    const cwd = typeof req.query.cwd === "string" ? req.query.cwd : undefined;
    void (async () => {
      try {
        res.json(await buildTeamView(paseoHome, cwd));
      } catch (err) {
        logger.warn({ err }, "Homelab team view failed");
        res.status(500).json({ error: "Impossible de charger la vue équipe" });
      }
    })();
  });

  app.get("/api/homelab/doc", (req: Request, res: Response) => {
    const cwd = expandHome(typeof req.query.cwd === "string" ? req.query.cwd : DEFAULT_REPO_DIR);
    const rel = typeof req.query.file === "string" ? req.query.file : "";
    if (!cwd || !rel) {
      res.status(400).json({ error: "Paramètres cwd et file requis" });
      return;
    }
    const root = path.resolve(cwd);
    const target = path.resolve(root, rel);
    if (!target.startsWith(`${root}${path.sep}`) && target !== root) {
      res.status(403).json({ error: "Chemin interdit" });
      return;
    }
    void (async () => {
      try {
        const content = await readFile(target, "utf8");
        res.json({ file: rel, content: content.slice(0, 120_000) });
      } catch {
        res.status(404).json({ error: "Fichier introuvable" });
      }
    })();
  });

  app.post("/api/homelab/send", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      target?: string;
      behavior?: string;
      prompt?: string;
      cwd?: string;
    };
    const target = String(body.target ?? "both").trim();
    const behavior =
      body.behavior === "steer" || body.behavior === "interrupt" ? body.behavior : "queue";
    const prompt = String(body.prompt ?? "").trim();
    const cwd = expandHome(body.cwd) || DEFAULT_REPO_DIR;

    if (!prompt) {
      res.status(400).json({ ok: false, error: "Le message est vide" });
      return;
    }

    void (async () => {
      if (target === "launch_both") {
        const repo = path.basename(cwd) || "Workspace";
        const runs = await Promise.all(
          [
            { label: "Mac 8-bit", model: MAC_MODEL },
            { label: "EVO Gemma4", model: EVO_MODEL },
          ].map(async ({ label, model }) => {
            const r = await runCmd(
              PASEO_BIN,
              [
                "run",
                "--no-wait",
                "--provider",
                "opencode",
                "--model",
                model,
                "--cwd",
                cwd,
                "--title",
                `${repo} (${label})`,
                prompt,
              ],
              20_000,
            );
            return { label, rc: r.rc, stdout: r.stdout, stderr: r.stderr };
          }),
        );
        const ok = runs.every((r) => r.rc === 0);
        res.status(ok ? 200 : 500).json({ ok, results: runs });
        return;
      }

      const allDisk = await loadDiskAgents(paseoHome);
      const running = allDisk.filter(
        (a) => !a.archivedAt && (a.lastStatus ?? "").toLowerCase() === "running",
      );
      const wsRunning = running.filter((a) => expandHome(a.cwd) === cwd);
      const pool = wsRunning.length > 0 ? wsRunning : running;

      const targetIds: string[] = [];
      for (const ag of pool) {
        const meta = classifyMachine(
          String(ag.provider ?? ""),
          String(ag.runtimeInfo?.model ?? ag.config?.model ?? ""),
          String(ag.title ?? ""),
        );
        if (
          (target === "both" && (meta.machine === "mac" || meta.machine === "evo")) ||
          target === "all_running" ||
          target === meta.machine
        ) {
          if (ag.id) targetIds.push(ag.id);
        }
      }

      if (targetIds.length === 0) {
        res.status(404).json({ ok: false, error: `Aucun agent actif pour « ${target} »` });
        return;
      }

      const results = await Promise.all(
        targetIds.map(async (aid) => {
          const r = await runCmd(
            PASEO_BIN,
            ["send", aid, "--behavior", behavior, "--no-wait", prompt],
            15_000,
          );
          return { id: aid, rc: r.rc, stdout: r.stdout, stderr: r.stderr };
        }),
      );
      const ok = results.some((r) => r.rc === 0);
      res.status(ok ? 200 : 500).json({ ok, results });
    })();
  });

  app.get("/api/homelab/catalog", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      providers: PROVIDER_CATALOG,
      gpuTiers: COLAB_GPU_TIERS,
      maxColabSlots: COLAB_MAX_SLOTS,
    });
  });

  app.get("/api/homelab/templates", (_req: Request, res: Response) => {
    void (async () => {
      try {
        const data = await readHomelabTemplates(paseoHome);
        res.json({ ok: true, ...data });
      } catch (err) {
        logger.warn({ err }, "Homelab templates read failed");
        res.status(500).json({ ok: false, error: "Impossible de lire les templates" });
      }
    })();
  });

  type TemplateKind = "scenarios" | "skills" | "mcps";
  const isValidKind = (kind: string): kind is TemplateKind =>
    kind === "scenarios" || kind === "skills" || kind === "mcps";

  app.post("/api/homelab/templates/:kind", (req: Request, res: Response) => {
    const kind = String(req.params.kind ?? "");
    if (!isValidKind(kind)) {
      res.status(400).json({ ok: false, error: "Type de template invalide" });
      return;
    }
    const payload = (req.body ?? {}) as Record<string, unknown>;
    void (async () => {
      try {
        const data = await readHomelabTemplates(paseoHome);
        const now = new Date().toISOString();
        const id =
          String(payload.id ?? "").trim() || `${kind.slice(0, 3)}-${randomUUID().slice(0, 8)}`;
        const created = { ...payload, id, builtIn: false, updatedAt: now };
        if (kind === "scenarios") data.scenarios.unshift(created as unknown as ScenarioTemplate);
        if (kind === "skills") data.skills.unshift(created as unknown as SkillTemplate);
        if (kind === "mcps") data.mcps.unshift(created as unknown as McpTemplate);
        data.updatedAt = now;
        await writeHomelabTemplates(paseoHome, data);
        res.status(201).json({ ok: true, item: created, ...data });
      } catch (err) {
        logger.warn({ err }, "Homelab template create failed");
        res.status(500).json({ ok: false, error: "Création impossible" });
      }
    })();
  });

  app.put("/api/homelab/templates/:kind/:id", (req: Request, res: Response) => {
    const kind = String(req.params.kind ?? "");
    const id = String(req.params.id ?? "").trim();
    if (!isValidKind(kind) || !id) {
      res.status(400).json({ ok: false, error: "Paramètres invalides" });
      return;
    }
    const payload = (req.body ?? {}) as Record<string, unknown>;
    void (async () => {
      try {
        const data = await readHomelabTemplates(paseoHome);
        const now = new Date().toISOString();
        const list = data[kind] as unknown as Array<Record<string, unknown>>;
        const idx = list.findIndex((item) => item.id === id);
        if (idx === -1) {
          res.status(404).json({ ok: false, error: "Template introuvable" });
          return;
        }
        const updated = { ...list[idx], ...payload, id, updatedAt: now };
        list[idx] = updated;
        data.updatedAt = now;
        await writeHomelabTemplates(paseoHome, data);
        res.json({ ok: true, item: updated, ...data });
      } catch (err) {
        logger.warn({ err }, "Homelab template update failed");
        res.status(500).json({ ok: false, error: "Mise à jour impossible" });
      }
    })();
  });

  app.post("/api/homelab/templates/:kind/:id/duplicate", (req: Request, res: Response) => {
    const kind = String(req.params.kind ?? "");
    const id = String(req.params.id ?? "").trim();
    if (!isValidKind(kind) || !id) {
      res.status(400).json({ ok: false, error: "Paramètres invalides" });
      return;
    }
    void (async () => {
      try {
        const data = await readHomelabTemplates(paseoHome);
        const now = new Date().toISOString();
        const list = data[kind] as unknown as Array<Record<string, unknown>>;
        const source = list.find((item) => item.id === id);
        if (!source) {
          res.status(404).json({ ok: false, error: "Template introuvable" });
          return;
        }
        const copyId = `${kind.slice(0, 3)}-${randomUUID().slice(0, 8)}`;
        const duplicated = {
          ...source,
          id: copyId,
          name: `${String(source.name ?? id)} (copie)`,
          builtIn: false,
          updatedAt: now,
        };
        list.unshift(duplicated);
        data.updatedAt = now;
        await writeHomelabTemplates(paseoHome, data);
        res.status(201).json({ ok: true, item: duplicated, ...data });
      } catch (err) {
        logger.warn({ err }, "Homelab template duplicate failed");
        res.status(500).json({ ok: false, error: "Duplication impossible" });
      }
    })();
  });

  app.delete("/api/homelab/templates/:kind/:id", (req: Request, res: Response) => {
    const kind = String(req.params.kind ?? "");
    const id = String(req.params.id ?? "").trim();
    if (!isValidKind(kind) || !id) {
      res.status(400).json({ ok: false, error: "Paramètres invalides" });
      return;
    }
    void (async () => {
      try {
        const data: HomelabTemplatesStoreData = await readHomelabTemplates(paseoHome);
        const before = data[kind].length;
        const filtered = (data[kind] as Array<{ id: string }>).filter((item) => item.id !== id);
        if (filtered.length === before) {
          res.status(404).json({ ok: false, error: "Template introuvable" });
          return;
        }
        (data[kind] as Array<{ id: string }>) = filtered;
        data.updatedAt = new Date().toISOString();
        await writeHomelabTemplates(paseoHome, data);
        res.json({ ok: true, ...data });
      } catch (err) {
        logger.warn({ err }, "Homelab template delete failed");
        res.status(500).json({ ok: false, error: "Suppression impossible" });
      }
    })();
  });

  app.post("/api/homelab/launch", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      universe?: TemplateUniverse;
      providerId?: string;
      modelId?: string;
      quant?: QuantOption;
      gpuTier?: ColabGpuTier;
      systemPrompt?: string;
      skillIds?: string[];
      mcpIds?: string[];
      prompt?: string;
      cwd?: string;
      title?: string;
    };

    const universe: TemplateUniverse = body.universe === "colab" ? "colab" : "local";
    const providerId = String(body.providerId ?? "opencode").trim() || "opencode";
    const modelId = String(body.modelId ?? "").trim();
    const quant: QuantOption = body.quant ?? (universe === "colab" ? "Q4_K_M" : "default");
    const prompt = String(body.prompt ?? "").trim();
    const cwd = expandHome(body.cwd) || DEFAULT_REPO_DIR;
    const title = String(body.title ?? "").trim();

    if (!prompt) {
      res.status(400).json({ ok: false, error: "Le prompt utilisateur est requis" });
      return;
    }
    if (!modelId) {
      res.status(400).json({ ok: false, error: "Le modèle est requis" });
      return;
    }

    void (async () => {
      try {
        const [allDisk, templates, gpuCluster] = await Promise.all([
          loadDiskAgents(paseoHome),
          readHomelabTemplates(paseoHome),
          universe === "colab" ? probeGpuCluster() : Promise.resolve(null),
        ]);

        let effectiveGpuTier: ColabGpuTier | undefined;
        if (universe === "colab") {
          const runningColabAgents = allDisk.filter((a) => {
            if (a.archivedAt || (a.lastStatus ?? "").toLowerCase() !== "running") return false;
            const meta = classifyMachine(
              String(a.provider ?? ""),
              String(a.runtimeInfo?.model ?? a.config?.model ?? ""),
              String(a.title ?? ""),
            );
            return meta.machine === "colab";
          }).length;
          const inFlight = Number(
            gpuCluster && "colab" in gpuCluster ? (gpuCluster.colab?.in_flight ?? 0) : 0,
          );
          const guard = evaluateColabSlotGuard(runningColabAgents, inFlight);
          if (!guard.allowed) {
            res.status(409).json({ ok: false, error: guard.reason, guard });
            return;
          }
          effectiveGpuTier = body.gpuTier ?? selectCheapestCompatibleColabGpu(modelId, quant);
          const rawModel = modelId.replace(/^colab\//, "");
          void fetchJson(COLAB_WAKE_URL, {
            method: "POST",
            body: { model: rawModel, gpu: effectiveGpuTier, quant },
            timeoutMs: 2500,
          });
        }

        const skillSet = new Set(Array.isArray(body.skillIds) ? body.skillIds : []);
        const mcpSet = new Set(Array.isArray(body.mcpIds) ? body.mcpIds : []);
        const selectedSkills = templates.skills.filter((s) => skillSet.has(s.id));
        const selectedMcps = templates.mcps.filter((m) => mcpSet.has(m.id));

        const effectiveSystem = buildEffectiveSystemPrompt({
          universe,
          basePrompt: String(body.systemPrompt ?? ""),
          selectedSkills,
        });

        const mcpHint =
          selectedMcps.length > 0
            ? `\nOutils MCP activés : ${selectedMcps.map((m) => m.serverName).join(", ")}.`
            : "";
        const combinedPrompt = effectiveSystem
          ? `<instructions_systeme>\n${effectiveSystem}${mcpHint}\n</instructions_systeme>\n\n${prompt}`
          : prompt;

        const args = [
          "run",
          "--no-wait",
          "--json",
          "--provider",
          providerId,
          "--model",
          modelId,
          "--cwd",
          cwd,
        ];
        if (title) {
          args.push("--title", title);
        }
        args.push(combinedPrompt);

        const r = await runCmd(PASEO_BIN, args, 25_000);
        if (r.rc !== 0) {
          res.status(500).json({
            ok: false,
            error: r.stderr || r.stdout || "Échec du lancement de l'agent",
          });
          return;
        }
        let launched: Record<string, unknown> = {};
        try {
          launched = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
        } catch {
          launched = { raw: r.stdout.trim() };
        }
        cacheInvalidate("gpu_cluster");
        res.json({
          ok: true,
          universe,
          gpuTier: effectiveGpuTier,
          quant,
          launched,
        });
      } catch (err) {
        logger.warn({ err }, "Homelab unified launch failed");
        res.status(500).json({ ok: false, error: "Erreur interne au lancement" });
      }
    })();
  });

  // ---------------------------------------------------------------------------
  // Usage Statistics & Unified App Control Bridge (Habilitation UI / Vocal)
  // ---------------------------------------------------------------------------

  interface AppControlCommandEntry {
    id: string;
    deviceId: string;
    command: string;
    args: Record<string, unknown>;
    source: "assistant_local" | "agent_remote";
    createdAt: number;
    resolveWaiter?: (result: Record<string, unknown>) => void;
  }

  const latestUiSnapshots = new Map<
    string,
    { deviceId: string; updatedAt: number; snapshot: unknown }
  >();
  const pendingControlCommands: AppControlCommandEntry[] = [];
  const inflightControlWaiters = new Map<string, AppControlCommandEntry>();

  app.get("/api/homelab/stats", (_req: Request, res: Response) => {
    void (async () => {
      try {
        const file = await readHomelabUsageStatsFile(paseoHome);
        res.json({ ok: true, ...summarizeHomelabUsageStats(file) });
      } catch (err) {
        logger.warn({ err }, "Homelab usage stats read failed");
        res.status(500).json({ ok: false, error: "Lecture stats impossible" });
      }
    })();
  });

  app.post("/api/homelab/stats/event", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      events?: UsageEventInput[];
      event?: UsageEventInput;
    } & UsageEventInput;
    let batch: UsageEventInput[] = [];
    if (Array.isArray(body.events)) {
      batch = body.events;
    } else if (body.event) {
      batch = [body.event];
    } else if (body.action) {
      batch = [body];
    }
    if (batch.length === 0) {
      res.status(400).json({ ok: false, error: "Aucun événement fourni" });
      return;
    }
    void (async () => {
      try {
        const updated = await recordHomelabUsageEvents(paseoHome, batch);
        res.json({ ok: true, totalEvents: updated.totalEvents });
      } catch (err) {
        logger.warn({ err }, "Homelab usage stats write failed");
        res.status(500).json({ ok: false, error: "Écriture stats impossible" });
      }
    })();
  });

  app.delete("/api/homelab/stats", (_req: Request, res: Response) => {
    void (async () => {
      try {
        const fresh = await resetHomelabUsageStats(paseoHome);
        res.json({ ok: true, ...summarizeHomelabUsageStats(fresh) });
      } catch (err) {
        logger.warn({ err }, "Homelab usage stats reset failed");
        res.status(500).json({ ok: false, error: "Réinitialisation stats impossible" });
      }
    })();
  });

  app.post("/api/homelab/app-control/snapshot", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { deviceId?: string; snapshot?: unknown };
    const deviceId = String(body.deviceId ?? "default").trim() || "default";
    latestUiSnapshots.set(deviceId, {
      deviceId,
      updatedAt: Date.now(),
      snapshot: body.snapshot ?? {},
    });
    res.json({ ok: true, deviceId });
  });

  app.get("/api/homelab/app-control/state", (req: Request, res: Response) => {
    const deviceId = typeof req.query.deviceId === "string" ? req.query.deviceId.trim() : "";
    const devices = Array.from(latestUiSnapshots.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
    const active = deviceId ? (latestUiSnapshots.get(deviceId) ?? null) : (devices[0] ?? null);
    res.json({
      ok: true,
      activeDevice: active,
      devices: devices.map((d) => ({
        deviceId: d.deviceId,
        updatedAt: d.updatedAt,
        ageMs: Date.now() - d.updatedAt,
      })),
      pendingCommands: pendingControlCommands.length,
    });
  });

  app.get("/api/homelab/app-control/commands/poll", (req: Request, res: Response) => {
    const deviceId = String(req.query.deviceId ?? "default").trim() || "default";
    const matched: AppControlCommandEntry[] = [];
    for (let i = pendingControlCommands.length - 1; i >= 0; i -= 1) {
      const cmd = pendingControlCommands[i]!;
      if (cmd.deviceId === "*" || cmd.deviceId === deviceId) {
        pendingControlCommands.splice(i, 1);
        matched.unshift(cmd);
        inflightControlWaiters.set(cmd.id, cmd);
      }
    }
    res.json({
      ok: true,
      commands: matched.map((c) => ({
        id: c.id,
        command: c.command,
        args: c.args,
        source: c.source,
        createdAt: c.createdAt,
      })),
    });
  });

  app.post("/api/homelab/app-control/commands/:id/result", (req: Request, res: Response) => {
    const id = String(req.params.id ?? "").trim();
    const entry = inflightControlWaiters.get(id);
    if (entry) {
      inflightControlWaiters.delete(id);
      entry.resolveWaiter?.((req.body ?? { ok: true }) as Record<string, unknown>);
    }
    res.json({ ok: true });
  });

  app.post("/api/homelab/app-control/execute", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      deviceId?: string;
      command?: string;
      args?: Record<string, unknown>;
      source?: "assistant_local" | "agent_remote";
      waitMs?: number;
    };
    const command = String(body.command ?? "").trim();
    if (!command) {
      res.status(400).json({ ok: false, error: "command est requis" });
      return;
    }
    const deviceId = String(body.deviceId ?? "*").trim() || "*";
    const source = body.source === "assistant_local" ? "assistant_local" : "agent_remote";
    const waitMs = Math.min(Math.max(Number(body.waitMs ?? 4500), 0), 10_000);
    const id = `cmd-${randomUUID().slice(0, 8)}`;

    void (async () => {
      try {
        await recordHomelabUsageEvents(paseoHome, [
          { action: `control.${command}`, screen: "app_control", source, detail: deviceId },
        ]);
      } catch {
        // Non-fatal
      }
    })();

    if (waitMs === 0) {
      pendingControlCommands.push({
        id,
        deviceId,
        command,
        args: body.args ?? {},
        source,
        createdAt: Date.now(),
      });
      res.json({ ok: true, queued: true, id });
      return;
    }

    let settled = false;
    const entry: AppControlCommandEntry = {
      id,
      deviceId,
      command,
      args: body.args ?? {},
      source,
      createdAt: Date.now(),
      resolveWaiter: (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        res.json({ ok: true, id, executed: true, result });
      },
    };
    pendingControlCommands.push(entry);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      inflightControlWaiters.delete(id);
      res.json({
        ok: true,
        id,
        executed: false,
        queued: true,
        note: "Commande mise en file (appareil non joignable dans le délai imparti)",
      });
    }, waitMs);
  });
}
