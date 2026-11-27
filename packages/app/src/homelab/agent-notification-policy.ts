import type { Agent, SessionState } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";

export type NotificationAgentMeta = Pick<
  Agent,
  "id" | "parentAgentId" | "labels" | "background" | "attentionReason" | "attentionTimestamp"
>;

/**
 * Delegated child agents and background workers report back to their creator agent,
 * never directly to the user's devices — even if pinned or errored.
 */
export function isDelegatedOrBackgroundAgent(
  agent: Pick<Agent, "parentAgentId" | "labels" | "background">,
): boolean {
  return Boolean(
    agent.parentAgentId || agent.labels?.["paseo.parent-agent-id"] || agent.background,
  );
}

/** Combines `tail` + `head` in chronological order (oldest first, newest last). */
export function getCombinedAgentStreamItems(
  session: Pick<SessionState, "agentStreamTail" | "agentStreamHead"> | undefined,
  agentId: string,
): StreamItem[] {
  if (!session) return [];
  const tail = session.agentStreamTail.get(agentId) ?? [];
  const head = session.agentStreamHead.get(agentId) ?? [];
  if (tail.length === 0) return head;
  if (head.length === 0) return tail;
  return [...tail, ...head];
}

function isInterAgentToolCallName(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    normalized === "send_agent_prompt" ||
    normalized.endsWith("send_agent_prompt") ||
    normalized === "create_agent" ||
    normalized.endsWith("create_agent")
  );
}

/**
 * Inspects the most recent turn in chronological stream order to determine whether it was
 * triggered by inter-agent communication (`send_agent_prompt` / intermediate child message)
 * or heartbeat rather than a human prompt.
 */
export function isLatestTurnFromInterAgentExchange(items: readonly StreamItem[]): boolean {
  let sentAgentMessageInTurn = false;

  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (!item) continue;

    if (item.kind === "user_message") {
      return false;
    }

    if (item.kind === "tool_call" && item.payload.source === "agent") {
      const { agentMessage, name } = item.payload.data;
      if (agentMessage) {
        if (agentMessage.event === "message" || agentMessage.event === "permission-required") {
          return true;
        }
        // Final child completion/error notification (`finished` / `errored` / `closed`) suppresses
        // device ping only if the parent immediately turned around to message/spawn another agent.
        return sentAgentMessageInTurn;
      }

      if (name === "heartbeat") {
        return true;
      }

      if (isInterAgentToolCallName(name)) {
        sentAgentMessageInTurn = true;
      }
    }
  }

  return false;
}

export function buildAttentionDedupeKey(
  agent: Pick<Agent, "attentionReason" | "attentionTimestamp">,
): string | null {
  const ts = agent.attentionTimestamp?.getTime();
  if (typeof ts !== "number" || !Number.isFinite(ts)) {
    return null;
  }
  return `${agent.attentionReason ?? "finished"}:${ts}`;
}

export function shouldDeliverLocalTurnNotification(input: {
  agent: NotificationAgentMeta;
  timelineItems: readonly StreamItem[];
  lastSeenAttentionKey?: string;
}): boolean {
  const { agent, timelineItems, lastSeenAttentionKey } = input;

  if (isDelegatedOrBackgroundAgent(agent)) {
    return false;
  }

  const dedupeKey = buildAttentionDedupeKey(agent);
  if (dedupeKey && lastSeenAttentionKey === dedupeKey) {
    return false;
  }

  if (agent.attentionReason !== "error" && isLatestTurnFromInterAgentExchange(timelineItems)) {
    return false;
  }

  return true;
}
