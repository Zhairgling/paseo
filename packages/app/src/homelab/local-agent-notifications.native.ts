import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";
import { useActiveSessionAgentId } from "@/hooks/use-active-session-agent-id";
import { homelabFetchJson, resolveHomelabDaemonTarget } from "@/homelab/api";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { useSessionStore, type Agent, type SessionState } from "@/stores/session-store";

const PERMISSION_CATEGORY_ID = "paseo_permission";
const ACTION_ALLOW = "paseo_permit_allow";
const ACTION_DENY = "paseo_permit_deny";
const ANDROID_CHANNEL_ID = "ajucode_agents";

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

function summarizePermission(description?: string | null, toolName?: string | null): string {
  const text = (description || toolName || "Validation requise").trim();
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
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

function inspectAgentTransitions(
  serverId: string,
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
  for (const perm of agent.pendingPermissions ?? []) {
    const permKey = `${agentKey}:${perm.id}`;
    ctx.nextPerms.add(permKey);
    if (!ctx.seeded || ctx.seenPerms.has(permKey) || ctx.viewingSameForeground) continue;

    scheduleAgentNotification({
      identifier: `perm:${perm.id}`,
      title: `Validation · ${label}`,
      body: summarizePermission(perm.description, perm.name),
      categoryIdentifier: PERMISSION_CATEGORY_ID,
      data: {
        kind: "agent",
        serverId,
        agentId: agent.id,
        requestId: perm.id,
      },
    });
  }

  if (
    ctx.seeded &&
    ctx.wasRunning &&
    !isRunning &&
    agent.requiresAttention &&
    !ctx.viewingSameForeground
  ) {
    scheduleAgentNotification({
      identifier: `done:${agent.id}`,
      title: `AjuCode · ${label}`,
      body:
        agent.attentionReason === "error"
          ? "L'agent s'est arrêté avec une erreur."
          : "Session prête — nouvelle réponse disponible.",
      data: { kind: "agent", serverId, agentId: agent.id },
    });
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
      inspectAgentTransitions(serverId, agent, {
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
 * provides actionable Approve/Deny buttons on permissions without requiring Firebase.
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
