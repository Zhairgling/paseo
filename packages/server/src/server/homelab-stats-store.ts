import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type UsageEventSource = "user" | "assistant_local" | "agent_remote";

export interface UsageEventInput {
  action: string;
  screen?: string;
  source?: UsageEventSource;
  detail?: string;
  meta?: Record<string, unknown>;
  ts?: number;
}

export interface UsageEventRecord {
  action: string;
  screen: string;
  source: UsageEventSource;
  detail?: string;
  ts: number;
}

export interface Lfm3LatencySample {
  wsRttMs?: number;
  ttftMs?: number;
  ttfaMs?: number;
  ts: number;
}

export interface Lfm3TrainingPair {
  utterance: string;
  tool: string;
  ts: number;
}

export interface Lfm3TelemetryBlock {
  toolParseOk: number;
  toolParseFail: number;
  failRawNames: Record<string, number>;
  sessionTransitions: Record<string, number>;
  latencySamples: Lfm3LatencySample[];
  trainingPairs: Lfm3TrainingPair[];
}

export interface HomelabUsageStatsFile {
  version: 1;
  updatedAt: string;
  totalEvents: number;
  actionCounts: Record<string, number>;
  screenCounts: Record<string, number>;
  sourceCounts: Record<UsageEventSource, number>;
  recentEvents: UsageEventRecord[];
  lfm3: Lfm3TelemetryBlock;
}

export interface TopUsageEntry {
  key: string;
  count: number;
  sharePct: number;
}

export interface HomelabUsageStatsSummary {
  updatedAt: string;
  totalEvents: number;
  sourceCounts: Record<UsageEventSource, number>;
  topActions: TopUsageEntry[];
  topScreens: TopUsageEntry[];
  recentEvents: UsageEventRecord[];
  lfm3: {
    toolParseOk: number;
    toolParseFail: number;
    toolParseSuccessRatePct: number;
    failRawNames: TopUsageEntry[];
    topSessionTransitions: TopUsageEntry[];
    avgLatencyMs: {
      wsRttMs: number;
      ttftMs: number;
      ttfaMs: number;
    };
    trainingPairsCount: number;
    recentTrainingPairs: Lfm3TrainingPair[];
  };
}

const STATS_FILENAME = "homelab-usage-stats.json";
const MAX_RECENT_EVENTS = 200;
const MAX_LATENCY_SAMPLES = 50;
const MAX_TRAINING_PAIRS = 100;

function emptyLfm3Telemetry(): Lfm3TelemetryBlock {
  return {
    toolParseOk: 0,
    toolParseFail: 0,
    failRawNames: {},
    sessionTransitions: {},
    latencySamples: [],
    trainingPairs: [],
  };
}

function emptyStatsFile(): HomelabUsageStatsFile {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    totalEvents: 0,
    actionCounts: {},
    screenCounts: {},
    sourceCounts: {
      user: 0,
      assistant_local: 0,
      agent_remote: 0,
    },
    recentEvents: [],
    lfm3: emptyLfm3Telemetry(),
  };
}

function getStatsPath(paseoHome: string): string {
  return path.join(paseoHome, STATS_FILENAME);
}

function normalizeRecord(val: unknown): Record<string, number> {
  return val && typeof val === "object" ? (val as Record<string, number>) : {};
}

function normalizeLfm3Block(rawLfm3: Partial<Lfm3TelemetryBlock> | undefined): Lfm3TelemetryBlock {
  return {
    toolParseOk: rawLfm3?.toolParseOk ?? 0,
    toolParseFail: rawLfm3?.toolParseFail ?? 0,
    failRawNames: normalizeRecord(rawLfm3?.failRawNames),
    sessionTransitions: normalizeRecord(rawLfm3?.sessionTransitions),
    latencySamples: Array.isArray(rawLfm3?.latencySamples) ? rawLfm3.latencySamples : [],
    trainingPairs: Array.isArray(rawLfm3?.trainingPairs) ? rawLfm3.trainingPairs : [],
  };
}

export async function readHomelabUsageStatsFile(paseoHome: string): Promise<HomelabUsageStatsFile> {
  const filePath = getStatsPath(paseoHome);
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<HomelabUsageStatsFile>;
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      totalEvents: typeof parsed.totalEvents === "number" ? parsed.totalEvents : 0,
      actionCounts: normalizeRecord(parsed.actionCounts),
      screenCounts: normalizeRecord(parsed.screenCounts),
      sourceCounts: {
        user: parsed.sourceCounts?.user ?? 0,
        assistant_local: parsed.sourceCounts?.assistant_local ?? 0,
        agent_remote: parsed.sourceCounts?.agent_remote ?? 0,
      },
      recentEvents: Array.isArray(parsed.recentEvents) ? parsed.recentEvents : [],
      lfm3: normalizeLfm3Block(parsed.lfm3),
    };
  } catch {
    return emptyStatsFile();
  }
}

export async function writeHomelabUsageStatsFile(
  paseoHome: string,
  data: HomelabUsageStatsFile,
): Promise<void> {
  await mkdir(paseoHome, { recursive: true });
  const filePath = getStatsPath(paseoHome);
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
  await rename(tmpPath, filePath);
}

function normalizeSource(source: unknown): UsageEventSource {
  if (source === "assistant_local" || source === "agent_remote") return source;
  return "user";
}

function recordLfm3Latency(
  data: HomelabUsageStatsFile,
  meta: Record<string, unknown>,
  ts: number,
): void {
  const sample: Lfm3LatencySample = { ts };
  if (typeof meta.wsRttMs === "number") sample.wsRttMs = meta.wsRttMs;
  if (typeof meta.ttftMs === "number") sample.ttftMs = meta.ttftMs;
  if (typeof meta.ttfaMs === "number") sample.ttfaMs = meta.ttfaMs;
  data.lfm3.latencySamples.unshift(sample);
  if (data.lfm3.latencySamples.length > MAX_LATENCY_SAMPLES) {
    data.lfm3.latencySamples.length = MAX_LATENCY_SAMPLES;
  }
}

function recordLfm3ToolParseOk(
  data: HomelabUsageStatsFile,
  meta: Record<string, unknown>,
  ts: number,
): void {
  data.lfm3.toolParseOk += 1;
  const utterance = typeof meta.utterance === "string" ? meta.utterance.trim() : "";
  const tool = typeof meta.tool === "string" ? meta.tool.trim() : "";
  if (utterance && tool) {
    data.lfm3.trainingPairs.unshift({ utterance: utterance.slice(0, 240), tool, ts });
    if (data.lfm3.trainingPairs.length > MAX_TRAINING_PAIRS) {
      data.lfm3.trainingPairs.length = MAX_TRAINING_PAIRS;
    }
  }
}

function recordLfm3Meta(
  data: HomelabUsageStatsFile,
  action: string,
  item: UsageEventInput,
  ts: number,
): void {
  const meta = item.meta ?? {};
  if (action === "lfm3.tool_parse_ok") {
    recordLfm3ToolParseOk(data, meta, ts);
    return;
  }

  if (action === "lfm3.tool_parse_fail") {
    data.lfm3.toolParseFail += 1;
    const rawName =
      String(meta.rawName ?? item.detail ?? "malformed_xml").trim() || "malformed_xml";
    data.lfm3.failRawNames[rawName] = (data.lfm3.failRawNames[rawName] ?? 0) + 1;
    return;
  }

  if (action === "session.switch") {
    const from = String(meta.from ?? "none").trim() || "none";
    const to = String(meta.to ?? item.detail ?? "unknown").trim() || "unknown";
    const key = `${from} -> ${to}`;
    data.lfm3.sessionTransitions[key] = (data.lfm3.sessionTransitions[key] ?? 0) + 1;
    return;
  }

  if (action === "lfm3.latency") {
    recordLfm3Latency(data, meta, ts);
  }
}

export async function recordHomelabUsageEvents(
  paseoHome: string,
  inputs: UsageEventInput[],
): Promise<HomelabUsageStatsFile> {
  const data = await readHomelabUsageStatsFile(paseoHome);
  const now = Date.now();
  for (const item of inputs) {
    const action = String(item.action ?? "").trim();
    if (!action) continue;
    const screen = String(item.screen ?? "unknown").trim() || "unknown";
    const source = normalizeSource(item.source);
    const ts = typeof item.ts === "number" && Number.isFinite(item.ts) ? item.ts : now;

    data.totalEvents += 1;
    data.actionCounts[action] = (data.actionCounts[action] ?? 0) + 1;
    data.screenCounts[screen] = (data.screenCounts[screen] ?? 0) + 1;
    data.sourceCounts[source] = (data.sourceCounts[source] ?? 0) + 1;
    data.recentEvents.unshift({
      action,
      screen,
      source,
      ...(item.detail ? { detail: String(item.detail).slice(0, 200) } : {}),
      ts,
    });
    recordLfm3Meta(data, action, item, ts);
  }
  if (data.recentEvents.length > MAX_RECENT_EVENTS) {
    data.recentEvents.length = MAX_RECENT_EVENTS;
  }
  data.updatedAt = new Date().toISOString();
  await writeHomelabUsageStatsFile(paseoHome, data);
  return data;
}

export async function resetHomelabUsageStats(paseoHome: string): Promise<HomelabUsageStatsFile> {
  const fresh = emptyStatsFile();
  await writeHomelabUsageStatsFile(paseoHome, fresh);
  return fresh;
}

function buildTopEntries(
  counts: Record<string, number>,
  total: number,
  limit = 15,
): TopUsageEntry[] {
  const denom = total > 0 ? total : 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({
      key,
      count,
      sharePct: Math.round((count / denom) * 1000) / 10,
    }));
}

function averageMetric(samples: Lfm3LatencySample[], key: "wsRttMs" | "ttftMs" | "ttfaMs"): number {
  const vals = samples.map((s) => s[key]).filter((v): v is number => typeof v === "number");
  if (vals.length === 0) return 0;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export function summarizeHomelabUsageStats(file: HomelabUsageStatsFile): HomelabUsageStatsSummary {
  const totalScreens = Object.values(file.screenCounts).reduce((acc, n) => acc + n, 0);
  const totalParses = file.lfm3.toolParseOk + file.lfm3.toolParseFail;
  const totalTransitions = Object.values(file.lfm3.sessionTransitions).reduce((a, b) => a + b, 0);
  return {
    updatedAt: file.updatedAt,
    totalEvents: file.totalEvents,
    sourceCounts: file.sourceCounts,
    topActions: buildTopEntries(file.actionCounts, file.totalEvents, 15),
    topScreens: buildTopEntries(file.screenCounts, totalScreens, 10),
    recentEvents: file.recentEvents.slice(0, 30),
    lfm3: {
      toolParseOk: file.lfm3.toolParseOk,
      toolParseFail: file.lfm3.toolParseFail,
      toolParseSuccessRatePct:
        totalParses > 0 ? Math.round((file.lfm3.toolParseOk / totalParses) * 1000) / 10 : 100,
      failRawNames: buildTopEntries(file.lfm3.failRawNames, file.lfm3.toolParseFail, 10),
      topSessionTransitions: buildTopEntries(file.lfm3.sessionTransitions, totalTransitions, 10),
      avgLatencyMs: {
        wsRttMs: averageMetric(file.lfm3.latencySamples, "wsRttMs"),
        ttftMs: averageMetric(file.lfm3.latencySamples, "ttftMs"),
        ttfaMs: averageMetric(file.lfm3.latencySamples, "ttfaMs"),
      },
      trainingPairsCount: file.lfm3.trainingPairs.length,
      recentTrainingPairs: file.lfm3.trainingPairs.slice(0, 15),
    },
  };
}
