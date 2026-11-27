import { describe, expect, it } from "vitest";
import type { Agent, SessionState } from "@/stores/session-store";
import { TURN_LIVENESS_IDLE } from "@/timeline/turn-liveness";
import { buildWidgetSnapshot } from "./widget-snapshot";

function makeAgent(overrides: Partial<Agent>): Agent {
  const now = new Date(1_700_000_000_000);
  return {
    serverId: "srv_1",
    id: "agt_1",
    provider: "antigravity",
    status: "idle",
    turn: TURN_LIVENESS_IDLE,
    createdAt: now,
    updatedAt: now,
    lastUserMessageAt: now,
    lastActivityAt: now,
    capabilities: {} as Agent["capabilities"],
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: "Session test",
    cwd: "/repo",
    model: null,
    parentAgentId: null,
    labels: {},
    ...overrides,
  };
}

function makeSession(agents: Agent[]): SessionState {
  return {
    agents: new Map(agents.map((a) => [a.id, a])),
    agentStreamTail: new Map([
      [
        "agt_wait",
        [
          {
            kind: "assistant_message",
            id: "m1",
            text: "## Bilan\nC'est fait — Le firmware écoute sur le bon port.",
            timestamp: new Date(1_700_000_000_000),
          } as never,
        ],
      ],
    ]),
    agentStreamHead: new Map(),
  } as unknown as SessionState;
}

describe("buildWidgetSnapshot", () => {
  it("counts running/waiting sessions and prioritizes permissions, pinned waiting messages, then running", () => {
    const baseMs = 1_700_000_000_000;
    const permAgent = makeAgent({
      id: "agt_perm",
      title: "écho firmware",
      status: "running",
      turn: {
        phase: "open",
        turnId: "t1",
        startedAt: new Date(baseMs),
        cancellationRequestId: null,
      },
      pendingPermissions: [
        {
          id: "p1",
          provider: "claude",
          name: "Bash",
          kind: "tool",
          title: "Run cargo test",
        },
      ],
      lastActivityAt: new Date(baseMs - 30_000),
    });
    const waitingPinned = makeAgent({
      id: "agt_wait",
      title: "montre",
      status: "idle",
      requiresAttention: true,
      lastActivityAt: new Date(baseMs - 120_000),
    });
    const runningWorker = makeAgent({
      id: "agt_run",
      title: "echo ui",
      status: "running",
      turn: {
        phase: "open",
        turnId: "t2",
        startedAt: new Date(baseMs),
        cancellationRequestId: null,
      },
      lastActivityAt: new Date(baseMs - 15_000),
    });
    const archived = makeAgent({
      id: "agt_arch",
      title: "old",
      status: "running",
      archivedAt: new Date(baseMs - 5000),
    });

    const snapshot = buildWidgetSnapshot({
      sessions: { srv_1: makeSession([permAgent, waitingPinned, runningWorker, archived]) },
      pinnedKeys: ["srv_1:agt_wait"],
      nowMs: baseMs,
    });

    expect(snapshot.runningCount).toBe(1);
    expect(snapshot.waitingCount).toBe(2);
    expect(snapshot.pinnedCount).toBe(1);
    expect(snapshot.items.map((item) => item.title)).toEqual([
      "écho firmware",
      "montre",
      "echo ui",
    ]);
    expect(snapshot.items[0]?.subtitle).toBe("Permission · Run cargo test");
    expect(snapshot.items[1]?.subtitle).toBe("Le firmware écoute sur le bon port.");
    expect(snapshot.items[1]?.deepLink).toBe("paseo://h/srv_1/agent/agt_wait");
    expect(snapshot.items[2]?.age).toBe("now");
  });
});
