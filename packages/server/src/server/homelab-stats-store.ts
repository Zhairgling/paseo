import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type UsageEventSource = "user" | "assistant_local" | "agent_remote";

export interface UsageEventInput {
  action: string;
  screen?: string;
  source?: UsageEventSource;
  detail?: string;
  ts?: number;
}

export interface UsageEventRecord {
  action: string;
  screen: string;
  source: UsageEventSource;
  detail?: string;
  ts: number;
}

export interface HomelabUsageStatsFile {
  version: 1;
  updatedAt: string;
  totalEvents: number;
  actionCounts: Record<string, number>;
  screenCounts: Record<string, number>;
  sourceCounts: Record<UsageEventSource, number>;
  recentEvents: UsageEventRecord[];
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
}

const STATS_FILENAME = "homelab-usage-stats.json";
const MAX_RECENT_EVENTS = 200;

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
  };
}

function getStatsPath(paseoHome: string): string {
  return path.join(paseoHome, STATS_FILENAME);
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
      actionCounts:
        parsed.actionCounts && typeof parsed.actionCounts === "object" ? parsed.actionCounts : {},
      screenCounts:
        parsed.screenCounts && typeof parsed.screenCounts === "object" ? parsed.screenCounts : {},
      sourceCounts: {
        user: parsed.sourceCounts?.user ?? 0,
        assistant_local: parsed.sourceCounts?.assistant_local ?? 0,
        agent_remote: parsed.sourceCounts?.agent_remote ?? 0,
      },
      recentEvents: Array.isArray(parsed.recentEvents) ? parsed.recentEvents : [],
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

export function summarizeHomelabUsageStats(file: HomelabUsageStatsFile): HomelabUsageStatsSummary {
  const totalScreens = Object.values(file.screenCounts).reduce((acc, n) => acc + n, 0);
  return {
    updatedAt: file.updatedAt,
    totalEvents: file.totalEvents,
    sourceCounts: file.sourceCounts,
    topActions: buildTopEntries(file.actionCounts, file.totalEvents, 15),
    topScreens: buildTopEntries(file.screenCounts, totalScreens, 10),
    recentEvents: file.recentEvents.slice(0, 30),
  };
}
