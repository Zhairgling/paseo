import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  buildAttentionDedupeKey,
  isDelegatedOrBackgroundAgent,
  isLatestTurnFromInterAgentExchange,
  shouldDeliverLocalTurnNotification,
  type NotificationAgentMeta,
} from "./agent-notification-policy";

function makeAgent(overrides: Partial<NotificationAgentMeta> = {}): NotificationAgentMeta {
  return {
    id: "agt-1",
    parentAgentId: null,
    labels: {},
    background: false,
    attentionReason: "finished",
    attentionTimestamp: new Date("2026-11-27T21:30:00.000Z"),
    ...overrides,
  };
}

function makeUserMessage(text = "Bonjour"): StreamItem {
  return {
    kind: "user_message",
    id: `user-${Math.random()}`,
    text,
    timestamp: new Date("2026-11-27T21:29:00.000Z"),
  };
}

function makeAssistantMessage(text = "Réponse"): StreamItem {
  return {
    kind: "assistant_message",
    id: `asst-${Math.random()}`,
    text,
    timestamp: new Date("2026-11-27T21:29:30.000Z"),
  };
}

function makeIncomingAgentMessage(
  event: "message" | "finished" | "errored" | "permission-required" | "closed",
): StreamItem {
  return {
    kind: "tool_call",
    id: `msg-${Math.random()}`,
    timestamp: new Date("2026-11-27T21:29:10.000Z"),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: `paseo-agent-message:${Math.random()}`,
        name: "agent_message",
        status: "completed",
        error: null,
        detail: { type: "plain_text", text: "ping", icon: "bot" },
        agentMessage: {
          event,
          sender: { id: "agt-peer", title: "Peer" },
          text: "ping",
        },
      },
    },
  };
}

function makeToolCall(name: string): StreamItem {
  return {
    kind: "tool_call",
    id: `tool-${Math.random()}`,
    timestamp: new Date("2026-11-27T21:29:20.000Z"),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: `call-${Math.random()}`,
        name,
        status: "completed",
        error: null,
        detail: { type: "unknown", input: null, output: null },
      },
    },
  };
}

describe("agent-notification-policy", () => {
  it("identifies delegated child and background agents reliably", () => {
    expect(isDelegatedOrBackgroundAgent(makeAgent())).toBe(false);
    expect(isDelegatedOrBackgroundAgent(makeAgent({ parentAgentId: "parent-1" }))).toBe(true);
    expect(
      isDelegatedOrBackgroundAgent(makeAgent({ labels: { "paseo.parent-agent-id": "parent-1" } })),
    ).toBe(true);
    expect(isDelegatedOrBackgroundAgent(makeAgent({ background: true }))).toBe(true);
  });

  it("never notifies for finished or errored delegated/background agents", () => {
    const child = makeAgent({
      parentAgentId: "parent-1",
      attentionReason: "error",
    });
    expect(
      shouldDeliverLocalTurnNotification({
        agent: child,
        timelineItems: [makeUserMessage(), makeAssistantMessage()],
      }),
    ).toBe(false);
  });

  it("suppresses notifications when the latest turn came from another agent message", () => {
    const items = [
      makeUserMessage("Initial prompt"),
      makeAssistantMessage("OK"),
      makeIncomingAgentMessage("message"),
      makeAssistantMessage("Réponse à mon pair"),
    ];
    expect(isLatestTurnFromInterAgentExchange(items)).toBe(true);
    expect(
      shouldDeliverLocalTurnNotification({
        agent: makeAgent(),
        timelineItems: items,
      }),
    ).toBe(false);
  });

  it("suppresses parent wake-ups when child completion immediately triggers send_agent_prompt", () => {
    const items = [
      makeIncomingAgentMessage("finished"),
      makeToolCall("mcp__paseo__send_agent_prompt"),
      makeAssistantMessage("Relancé le sous-agent"),
    ];
    expect(isLatestTurnFromInterAgentExchange(items)).toBe(true);
  });

  it("allows notification when a root agent wraps up a child finish to the user", () => {
    const items = [
      makeUserMessage("Fais le boulot"),
      makeAssistantMessage("C'est lancé"),
      makeIncomingAgentMessage("finished"),
      makeAssistantMessage("Voici le résultat final."),
    ];
    expect(isLatestTurnFromInterAgentExchange(items)).toBe(false);
    expect(
      shouldDeliverLocalTurnNotification({
        agent: makeAgent(),
        timelineItems: items,
      }),
    ).toBe(true);
  });

  it("deduplicates repeated wake-ups sharing the same unread attentionTimestamp", () => {
    const agent = makeAgent();
    const key = buildAttentionDedupeKey(agent)!;
    expect(
      shouldDeliverLocalTurnNotification({
        agent,
        timelineItems: [makeUserMessage(), makeAssistantMessage()],
        lastSeenAttentionKey: key,
      }),
    ).toBe(false);
  });
});
