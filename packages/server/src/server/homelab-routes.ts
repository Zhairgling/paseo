import { execFile } from "node:child_process";
import { access, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Express, Request, Response } from "express";
import type { Logger } from "pino";

const execFileAsync = promisify(execFile);

const ROUTER_URL = process.env.PASEO_HOMELAB_ROUTER_URL ?? "http://127.0.0.1:11435/router";
const COLAB_STATUS_URL = process.env.PASEO_HOMELAB_COLAB_URL ?? "http://127.0.0.1:11435/status";
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

async function probeGpuCluster() {
  const cached = cacheGet<Record<string, unknown>>("gpu_cluster", 3000);
  if (cached) {
    return { ...cached, irisSwitch: { ...irisSwitchState } };
  }

  const hasIrisScript = await pathExists(IRIS_MODE_SCRIPT);
  const [router, colab, colabPs, evoHealth, airModels, irisStatus] = await Promise.all([
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
  deps: { paseoHome: string; logger: Pick<Logger, "info" | "warn" | "error"> },
): void {
  const { paseoHome, logger } = deps;

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
}
