import { buildAgentDeepLink } from "@getpaseo/protocol/agent-deep-link";
import { formatAssistantNotificationPreview } from "@/homelab/agent-notification-format";
import { buildPinnedSessionKey } from "@/stores/pinned-sessions-store";
import type { Agent, SessionState } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";

export type WidgetItemStatus = "permission" | "running" | "attention" | "idle";

export interface WidgetSessionItem {
  title: string;
  subtitle: string;
  status: WidgetItemStatus;
  age: string;
  deepLink: string;
}

export interface AjuCodeWidgetSnapshot {
  runningCount: number;
  waitingCount: number;
  pinnedCount: number;
  updatedAtLabel: string;
  items: WidgetSessionItem[];
}

const MAX_WIDGET_ITEMS = 4;

function findLatestAssistantMessage(items: readonly StreamItem[] | undefined): string | null {
  if (!items || items.length === 0) return null;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item?.kind === "assistant_message" && item.text.trim()) {
      return item.text;
    }
  }
  return null;
}

function classifyAgentStatus(agent: Agent): WidgetItemStatus {
  if ((agent.pendingPermissions?.length ?? 0) > 0 || agent.attentionReason === "error") {
    return "permission";
  }
  if (agent.turn?.phase === "open" || agent.status === "running") {
    return "running";
  }
  if (agent.requiresAttention) {
    return "attention";
  }
  return "idle";
}

function formatAgeLabel(date: Date, nowMs: number): string {
  const diffSec = Math.max(0, Math.floor((nowMs - date.getTime()) / 1000));
  if (diffSec < 60) return "now";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}j`;
}

function formatClockLabel(nowMs: number): string {
  const d = new Date(nowMs);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function buildRowSubtitle(session: SessionState, agent: Agent, status: WidgetItemStatus): string {
  if ((agent.pendingPermissions?.length ?? 0) > 0) {
    const perm = agent.pendingPermissions[agent.pendingPermissions.length - 1];
    const hint = perm?.title?.trim() || perm?.name?.trim();
    return hint ? `Permission · ${hint}` : "Permission requise";
  }
  if (agent.attentionReason === "error") {
    return agent.lastError?.trim() || "Erreur agent";
  }
  const latestText =
    findLatestAssistantMessage(session.agentStreamTail.get(agent.id)) ??
    findLatestAssistantMessage(session.agentStreamHead.get(agent.id));
  if (latestText) {
    return formatAssistantNotificationPreview(latestText);
  }
  if (status === "running") return "En cours…";
  if (status === "attention") return "Nouvelle réponse en attente";
  return "En veille";
}

function priorityScore(status: WidgetItemStatus, isPinned: boolean): number {
  if (status === "permission") return isPinned ? 60 : 50;
  if (status === "attention") return isPinned ? 45 : 35;
  if (status === "running") return isPinned ? 30 : 20;
  return isPinned ? 10 : 0;
}

export function buildWidgetSnapshot(input: {
  sessions: Record<string, SessionState | undefined>;
  pinnedKeys: readonly string[];
  nowMs?: number;
}): AjuCodeWidgetSnapshot {
  const nowMs = input.nowMs ?? Date.now();
  const pinnedSet = new Set(input.pinnedKeys);
  let runningCount = 0;
  let waitingCount = 0;
  let pinnedCount = 0;

  const candidates: Array<{
    score: number;
    activityMs: number;
    item: WidgetSessionItem;
  }> = [];

  for (const [serverId, session] of Object.entries(input.sessions)) {
    if (!session) continue;
    for (const agent of session.agents.values()) {
      if (agent.archivedAt) continue;
      const isPinned = pinnedSet.has(buildPinnedSessionKey(serverId, agent.id));
      const status = classifyAgentStatus(agent);
      if (status === "running") runningCount += 1;
      if (status === "permission" || status === "attention") waitingCount += 1;
      if (isPinned) pinnedCount += 1;

      if (!isPinned && agent.background && status !== "permission") continue;
      if (!isPinned && agent.status === "closed" && status === "idle") continue;

      const title = agent.title?.trim() || `Session ${agent.id.slice(0, 7)}`;
      candidates.push({
        score: priorityScore(status, isPinned),
        activityMs: agent.lastActivityAt.getTime(),
        item: {
          title,
          subtitle: buildRowSubtitle(session, agent, status),
          status,
          age: formatAgeLabel(agent.lastActivityAt, nowMs),
          deepLink: buildAgentDeepLink({ serverId, agentId: agent.id }),
        },
      });
    }
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.activityMs - a.activityMs;
  });

  return {
    runningCount,
    waitingCount,
    pinnedCount,
    updatedAtLabel: formatClockLabel(nowMs),
    items: candidates.slice(0, MAX_WIDGET_ITEMS).map((entry) => entry.item),
  };
}
