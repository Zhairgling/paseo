import { homelabFetchJson, type DaemonHttpTarget, type UsageEventSource } from "./api";

export interface QueuedUsageEvent {
  action: string;
  screen?: string;
  source?: UsageEventSource;
  detail?: string;
  ts: number;
}

export interface LocalUsageCounters {
  totalEvents: number;
  actionCounts: Record<string, number>;
  screenCounts: Record<string, number>;
  sourceCounts: Record<UsageEventSource, number>;
  recentEvents: QueuedUsageEvent[];
}

const MAX_RECENT = 80;
const FLUSH_DELAY_MS = 3500;

let activeTarget: DaemonHttpTarget | null = null;
let currentScreen = "unknown";
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const pendingQueue: QueuedUsageEvent[] = [];

const localCounters: LocalUsageCounters = {
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

export function setUsageStatsTarget(target: DaemonHttpTarget | null): void {
  activeTarget = target;
  if (target && pendingQueue.length > 0) {
    void flushUsageEvents();
  }
}

export function setUsageStatsScreen(screen: string): void {
  const next = screen.trim() || "unknown";
  if (next === currentScreen) return;
  currentScreen = next;
  trackUsageEvent("screen.view", { screen: next, source: "user" });
}

export function getCurrentUsageScreen(): string {
  return currentScreen;
}

export function getLocalUsageCounters(): LocalUsageCounters {
  return {
    totalEvents: localCounters.totalEvents,
    actionCounts: { ...localCounters.actionCounts },
    screenCounts: { ...localCounters.screenCounts },
    sourceCounts: { ...localCounters.sourceCounts },
    recentEvents: [...localCounters.recentEvents],
  };
}

export function trackUsageEvent(
  action: string,
  options: {
    screen?: string;
    source?: UsageEventSource;
    detail?: string;
  } = {},
): void {
  const cleanAction = action.trim();
  if (!cleanAction) return;
  const screen = options.screen?.trim() || currentScreen;
  const source: UsageEventSource = options.source ?? "user";
  const evt: QueuedUsageEvent = {
    action: cleanAction,
    screen,
    source,
    ...(options.detail ? { detail: options.detail.slice(0, 200) } : {}),
    ts: Date.now(),
  };

  localCounters.totalEvents += 1;
  localCounters.actionCounts[cleanAction] = (localCounters.actionCounts[cleanAction] ?? 0) + 1;
  localCounters.screenCounts[screen] = (localCounters.screenCounts[screen] ?? 0) + 1;
  localCounters.sourceCounts[source] += 1;
  localCounters.recentEvents.unshift(evt);
  if (localCounters.recentEvents.length > MAX_RECENT) {
    localCounters.recentEvents.length = MAX_RECENT;
  }

  pendingQueue.push(evt);
  if (pendingQueue.length >= 10) {
    void flushUsageEvents();
    return;
  }
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushUsageEvents();
    }, FLUSH_DELAY_MS);
  }
}

export async function flushUsageEvents(): Promise<void> {
  if (!activeTarget || pendingQueue.length === 0) return;
  const batch = pendingQueue.splice(0, pendingQueue.length);
  try {
    await homelabFetchJson(activeTarget, "/api/homelab/stats/event", {
      method: "POST",
      body: { events: batch },
    });
  } catch {
    // Re-queue up to 100 events silently if daemon is temporarily unreachable or not restarted yet
    if (pendingQueue.length < 100) {
      pendingQueue.unshift(...batch.slice(0, 100 - pendingQueue.length));
    }
  }
}
