import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";
import { useActiveSessionAgentId } from "@/hooks/use-active-session-agent-id";
import { homelabFetchJson, resolveHomelabDaemonTarget } from "@/homelab/api";
import {
  formatFinishedAgentNotification,
  formatPermissionAgentNotification,
} from "@/homelab/agent-notification-format";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { buildPinnedSessionKey, usePinnedSessionsStore } from "@/stores/pinned-sessions-store";
import { useSessionStore, type Agent, type SessionState } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";
import type { AgentPermissionRequest } from "@getpaseo/protocol/agent-types";

const PERMISSION_CATEGORY_ID = "paseo_permission";
const REPLY_CATEGORY_ID = "paseo_reply";
const ACTION_ALLOW = "paseo_permit_allow";
const ACTION_DENY = "paseo_permit_deny";
const ACTION_REPLY = "paseo_quick_reply";
const ANDROID_CHANNEL_ID = "ajucode_agents";

interface AgentNotifData {
  serverId?: unknown;
  agentId?: unknown;
  requestId?: unknown;
}

async function setupInteractiveCategories(): Promise<void> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: "Activité des agents",
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
  await Notifications.setNotificationCategoryAsync(REPLY_CATEGORY_ID, [
    {
      identifier: ACTION_REPLY,
      buttonTitle: "Répondre",
      textInput: {
        submitButtonTitle: "Envoyer",
        placeholder: "Réponse rapide…",
      },
      options: { opensAppToForeground: false },
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

async function sendQuickReply(serverId: string, agentId: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const client = getHostRuntimeStore().getClient(serverId);
  if (!client) return;
  await client.sendMessage(agentId, trimmed);
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

function scheduleAgentNotification(input: {
  identifier: string;
  title: string;
  subtitle: string;
  body: string;
  color: string;
  data: Record<string, string>;
  categoryIdentifier?: string;
}): void {
  void Notifications.scheduleNotificationAsync({
    identifier: input.identifier,
    content: {
      title: input.title,
      subtitle: input.subtitle,
      body: input.body,
      color: input.color,
      categoryIdentifier: input.categoryIdentifier,
      sound: "default",
      data: input.data,
    },
    trigger: Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : null,
  }).catch(() => {});
}

function shouldNotifyFinishedTurn(serverId: string, agent: Agent): boolean {
  if (agent.attentionReason === "error") {
    return true;
  }
  const key = buildPinnedSessionKey(serverId, agent.id);
  if (usePinnedSessionsStore.getState().pinnedKeys.includes(key)) {
    return true;
  }
  const isWorker = Boolean(
    agent.parentAgentId || agent.labels?.["paseo.parent-agent-id"] || agent.background,
  );
  return !isWorker;
}

function notifyPermissionRequest(
  session: SessionState,
  agent: Agent,
  perm: AgentPermissionRequest,
  meta: { serverId: string; workspaceId: string },
): void {
  const formatted = formatPermissionAgentNotification({
    agent,
    workspaces: session.workspaces,
    permission: perm,
  });
  scheduleAgentNotification({
    identifier: `${formatted.tone}:${meta.serverId}:${agent.id}:${perm.id}`,
    title: formatted.title,
    subtitle: formatted.subtitle,
    body: formatted.body,
    color: formatted.color,
    categoryIdentifier: formatted.tone === "question" ? undefined : PERMISSION_CATEGORY_ID,
    data: {
      kind: "agent",
      serverId: meta.serverId,
      workspaceId: meta.workspaceId,
      agentId: agent.id,
      requestId: perm.id,
    },
  });
}

function notifyFinishedTurn(
  serverId: string,
  session: SessionState,
  agent: Agent,
  workspaceId: string,
): void {
  const rawAssistant =
    findLatestAssistantText(session.agentStreamTail.get(agent.id)) ??
    findLatestAssistantText(session.agentStreamHead.get(agent.id));
  const formatted = formatFinishedAgentNotification({
    agent,
    workspaces: session.workspaces,
    assistantMessage: rawAssistant,
  });
  scheduleAgentNotification({
    identifier: `done:${serverId}:${agent.id}`,
    title: formatted.title,
    subtitle: formatted.subtitle,
    body: formatted.body,
    color: formatted.color,
    categoryIdentifier: REPLY_CATEGORY_ID,
    data: {
      kind: "agent",
      serverId,
      workspaceId,
      agentId: agent.id,
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

  const workspaceId = agent.workspaceId ?? "";
  const canNotify = ctx.seeded && !ctx.viewingSameForeground;

  for (const perm of agent.pendingPermissions ?? []) {
    const permKey = `${agentKey}:${perm.id}`;
    ctx.nextPerms.add(permKey);
    if (canNotify && !ctx.seenPerms.has(permKey)) {
      notifyPermissionRequest(session, agent, perm, { serverId, workspaceId });
    }
  }

  const finishedNow =
    canNotify &&
    ctx.wasRunning &&
    !isRunning &&
    Boolean(agent.requiresAttention) &&
    shouldNotifyFinishedTurn(serverId, agent);
  if (finishedNow) {
    notifyFinishedTurn(serverId, session, agent, workspaceId);
  }
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
 * - displays workspace + state in subtitle and avoids repeating the app name
 * - provides Approve/Deny buttons for tool permissions and inline Reply on finished turns
 * - previews the essential takeaway of the assistant reply or concrete error
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
      const data = response.notification.request.content.data as AgentNotifData | undefined;
      const serverId = typeof data?.serverId === "string" ? data.serverId.trim() : "";
      const agentId = typeof data?.agentId === "string" ? data.agentId.trim() : "";
      if (!serverId || !agentId) return;

      if (action === ACTION_REPLY) {
        const replyText = typeof response.userText === "string" ? response.userText.trim() : "";
        if (replyText) {
          void sendQuickReply(serverId, agentId, replyText).catch(() => {});
        }
        void Notifications.dismissNotificationAsync(response.notification.request.identifier).catch(
          () => {},
        );
        return;
      }

      if (action !== ACTION_ALLOW && action !== ACTION_DENY) return;
      const requestId = typeof data?.requestId === "string" ? data.requestId.trim() : "";
      if (!requestId) return;

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
