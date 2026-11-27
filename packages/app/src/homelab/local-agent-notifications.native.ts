import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";
import { useActiveSessionAgentId } from "@/hooks/use-active-session-agent-id";
import { homelabFetchJson, resolveHomelabDaemonTarget } from "@/homelab/api";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { useSessionStore, type Agent, type SessionState } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";
import type { AgentPermissionRequest } from "@getpaseo/protocol/agent-types";

const PERMISSION_CATEGORY_ID = "paseo_permission";
const ACTION_ALLOW = "paseo_permit_allow";
const ACTION_DENY = "paseo_permit_deny";
const ANDROID_CHANNEL_ID = "ajucode_agents";
const MAX_BODY_LEN = 180;

interface PermissionNotifData {
  serverId?: unknown;
  agentId?: unknown;
  requestId?: unknown;
}

async function setupInteractiveCategories(): Promise<void> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: "Agents AjuCode",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 100, 180],
    });
  }
  await Notifications.setNotificationCategoryAsync(PERMISSION_CATEGORY_ID, [
    {
      identifier: ACTION_ALLOW,
      buttonTitle: "Autoriser",
      options: { opensAppToForeground: false },
    },
    {
      identifier: ACTION_DENY,
      buttonTitle: "Refuser",
      options: { opensAppToForeground: false, isDestructive: true },
    },
  ]);
}

async function sendPermissionDecision(
  serverId: string,
  agentId: string,
  requestId: string,
  decision: "allow" | "deny",
): Promise<void> {
  const client = getHostRuntimeStore().getClient(serverId);
  if (client) {
    try {
      await client.respondToPermission(agentId, requestId, { behavior: decision });
      return;
    } catch {
      // Fallback to Homelab HTTP endpoint below.
    }
  }
  const hosts = getHostRuntimeStore().getHosts();
  const target = resolveHomelabDaemonTarget(hosts);
  await homelabFetchJson(target, "/api/homelab/permit", {
    method: "POST",
    body: { agentId, requestId, decision },
  });
}

function truncateText(raw: string, maxLen = MAX_BODY_LEN): string {
  const clean = raw.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1).trimEnd()}…`;
}

function stripMarkdownPreview(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>+|\*|-|\d+\.)\s+/gm, "")
    .replace(/[`*_~]+/g, "");
}

function isQuestionPermission(perm: AgentPermissionRequest): boolean {
  return perm.kind === "question" || /ask_?user_?question/i.test(perm.name ?? "");
}

function extractQuestionBody(perm: AgentPermissionRequest): string {
  const input = perm.input as
    | {
        questions?: Array<{ question?: unknown; options?: Array<{ label?: unknown }> }>;
        question?: unknown;
      }
    | undefined;
  if (input && Array.isArray(input.questions) && input.questions.length > 0) {
    const first = input.questions[0];
    const qText = typeof first?.question === "string" ? first.question.trim() : "";
    if (qText) {
      const prefix = input.questions.length > 1 ? `[1/${input.questions.length}] ` : "";
      const opts = Array.isArray(first?.options)
        ? first.options
            .map((o) => (typeof o?.label === "string" ? o.label.trim() : ""))
            .filter(Boolean)
            .slice(0, 3)
        : [];
      const optSuffix = opts.length > 0 ? ` · ${opts.join(" / ")}` : "";
      return truncateText(`${prefix}${qText}${optSuffix}`);
    }
  }
  if (input && typeof input.question === "string" && input.question.trim()) {
    return truncateText(input.question);
  }
  const fallback = perm.description?.trim() || perm.title?.trim() || "L'agent attend ta réponse.";
  return truncateText(stripMarkdownPreview(fallback));
}

function extractToolPermissionBody(perm: AgentPermissionRequest): string {
  const input = perm.input as
    | { command?: unknown; file_path?: unknown; path?: unknown }
    | undefined;
  if (typeof input?.command === "string" && input.command.trim()) {
    return truncateText(`$ ${input.command.trim()}`);
  }
  const desc = perm.description?.trim();
  if (desc) {
    return truncateText(stripMarkdownPreview(desc));
  }
  const targetPath =
    (typeof input?.file_path === "string" && input.file_path.trim()) ||
    (typeof input?.path === "string" && input.path.trim()) ||
    "";
  if (targetPath) {
    return truncateText(targetPath);
  }
  return truncateText(perm.title?.trim() || perm.name || "Autorisation requise");
}

function findLatestAssistantText(items: readonly StreamItem[] | undefined): string | null {
  if (!items || items.length === 0) return null;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item?.kind === "assistant_message" && item.text.trim()) {
      return item.text;
    }
  }
  return null;
}

function extractFinishedPreview(session: SessionState, agentId: string): string {
  const raw =
    findLatestAssistantText(session.agentStreamTail.get(agentId)) ??
    findLatestAssistantText(session.agentStreamHead.get(agentId));
  if (!raw) {
    return "Nouvelle réponse prête.";
  }
  const clean = truncateText(stripMarkdownPreview(raw));
  return clean || "Nouvelle réponse prête.";
}

function scheduleAgentNotification(input: {
  identifier: string;
  title: string;
  body: string;
  data: Record<string, string>;
  categoryIdentifier?: string;
}): void {
  void Notifications.scheduleNotificationAsync({
    identifier: input.identifier,
    content: {
      title: input.title,
      body: input.body,
      categoryIdentifier: input.categoryIdentifier,
      sound: "default",
      data: input.data,
    },
    trigger: null,
  }).catch(() => {});
}

function notifyPermissionRequest(
  perm: AgentPermissionRequest,
  meta: { serverId: string; workspaceId: string; agentId: string; label: string },
): void {
  const isQuestion = isQuestionPermission(perm);
  scheduleAgentNotification({
    identifier: `${isQuestion ? "question" : "perm"}:${perm.id}:${Date.now()}`,
    title: `${isQuestion ? "Question" : "Permission"} · ${meta.label}`,
    body: isQuestion ? extractQuestionBody(perm) : extractToolPermissionBody(perm),
    categoryIdentifier: isQuestion ? undefined : PERMISSION_CATEGORY_ID,
    data: {
      kind: "agent",
      serverId: meta.serverId,
      workspaceId: meta.workspaceId,
      agentId: meta.agentId,
      requestId: perm.id,
    },
  });
}

function inspectAgentTransitions(
  serverId: string,
  session: SessionState,
  agent: Agent,
  ctx: {
    seeded: boolean;
    seenPerms: ReadonlySet<string>;
    wasRunning: boolean;
    viewingSameForeground: boolean;
    nextRunning: Set<string>;
    nextPerms: Set<string>;
  },
): void {
  const agentKey = `${serverId}:${agent.id}`;
  const isRunning = agent.status === "running" || agent.turn?.phase === "open";
  if (isRunning) ctx.nextRunning.add(agentKey);

  const label = agent.title?.trim() || agent.id.slice(0, 8);
  const workspaceId = agent.workspaceId ?? "";

  for (const perm of agent.pendingPermissions ?? []) {
    const permKey = `${agentKey}:${perm.id}`;
    ctx.nextPerms.add(permKey);
    if (!ctx.seeded || ctx.seenPerms.has(permKey) || ctx.viewingSameForeground) continue;
    notifyPermissionRequest(perm, { serverId, workspaceId, agentId: agent.id, label });
  }

  if (
    !ctx.seeded ||
    !ctx.wasRunning ||
    isRunning ||
    !agent.requiresAttention ||
    ctx.viewingSameForeground
  ) {
    return;
  }

  const body =
    agent.attentionReason === "error"
      ? truncateText(agent.lastError?.trim() || "L'agent s'est arrêté avec une erreur.")
      : extractFinishedPreview(session, agent.id);
  scheduleAgentNotification({
    identifier: `done:${agent.id}:${agent.updatedAt.getTime()}`,
    title: `AjuCode · ${label}`,
    body,
    data: {
      kind: "agent",
      serverId,
      workspaceId,
      agentId: agent.id,
    },
  });
}

function collectTransitions(
  sessions: Record<string, SessionState | undefined>,
  refs: {
    seeded: boolean;
    seenPerms: ReadonlySet<string>;
    runningKeys: ReadonlySet<string>;
    isAppActive: boolean;
    activeAgentId: string | null;
  },
): { nextRunning: Set<string>; nextPerms: Set<string> } {
  const nextRunning = new Set<string>();
  const nextPerms = new Set<string>();

  for (const [serverId, session] of Object.entries(sessions)) {
    if (!session) continue;
    for (const agent of session.agents.values()) {
      const agentKey = `${serverId}:${agent.id}`;
      inspectAgentTransitions(serverId, session, agent, {
        seeded: refs.seeded,
        seenPerms: refs.seenPerms,
        wasRunning: refs.runningKeys.has(agentKey),
        viewingSameForeground: refs.isAppActive && refs.activeAgentId === agent.id,
        nextRunning,
        nextPerms,
      });
    }
  }
  return { nextRunning, nextPerms };
}

/**
 * Interactive local Android notifications backed by live WebSocket state:
 * - displays the actual question for AskUserQuestion prompts (tap opens the session)
 * - provides Approve/Deny buttons for tool permissions
 * - previews the actual last assistant message when an agent finishes
 */
export function useLocalAgentNotifications(): void {
  const activeAgentId = useActiveSessionAgentId();
  const hosts = useHosts();
  const activeAgentIdRef = useRef<string | null>(activeAgentId);
  activeAgentIdRef.current = activeAgentId;
  const appStateRef = useRef(AppState.currentState);
  const seenPermIdsRef = useRef<Set<string>>(new Set());
  const runningKeysRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);

  useEffect(() => {
    void setupInteractiveCategories().catch(() => {});

    const appSub = AppState.addEventListener("change", (next) => {
      appStateRef.current = next;
    });

    const respSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const action = response.actionIdentifier;
      if (action !== ACTION_ALLOW && action !== ACTION_DENY) return;
      const data = response.notification.request.content.data as PermissionNotifData | undefined;
      const serverId = typeof data?.serverId === "string" ? data.serverId.trim() : "";
      const agentId = typeof data?.agentId === "string" ? data.agentId.trim() : "";
      const requestId = typeof data?.requestId === "string" ? data.requestId.trim() : "";
      if (!serverId || !agentId || !requestId) return;

      const decision = action === ACTION_ALLOW ? "allow" : "deny";
      void sendPermissionDecision(serverId, agentId, requestId, decision).catch(() => {});
      void Notifications.dismissNotificationAsync(response.notification.request.identifier).catch(
        () => {},
      );
    });

    const unsubStore = useSessionStore.subscribe((state) => {
      const { nextRunning, nextPerms } = collectTransitions(state.sessions, {
        seeded: seededRef.current,
        seenPerms: seenPermIdsRef.current,
        runningKeys: runningKeysRef.current,
        isAppActive: appStateRef.current === "active",
        activeAgentId: activeAgentIdRef.current,
      });
      runningKeysRef.current = nextRunning;
      seenPermIdsRef.current = nextPerms;
      if (!seededRef.current && Object.keys(state.sessions).length > 0) {
        seededRef.current = true;
      }
    });

    return () => {
      appSub.remove();
      respSub.remove();
      unsubStore();
    };
  }, [hosts.length]);
}
