import { describe, expect, it } from "vitest";
import {
  collectCandidateSessionTokens,
  resolveKnownSessionTokensKey,
  resolveSessionLink,
} from "./session-link";

function fakeSessions() {
  return {
    srv_evo: {
      agents: new Map([
        [
          "1a8385c3-3fd6-4c6b-8fbd-fb52a3fd9460",
          {
            id: "1a8385c3-3fd6-4c6b-8fbd-fb52a3fd9460",
            workspaceId: "ws-miband",
          } as never,
        ],
        [
          "06fd2360-744d-4a61-90d6-5171324761f0",
          {
            id: "06fd2360-744d-4a61-90d6-5171324761f0",
            workspaceId: "ws-paseo",
          } as never,
        ],
      ]),
      agentDetails: new Map(),
    },
  };
}

describe("session-link", () => {
  it("resolves short hex prefixes and full UUIDs belonging to real sessions", () => {
    const sessions = fakeSessions();
    expect(resolveSessionLink("1a8385c", sessions)).toEqual({
      serverId: "srv_evo",
      agentId: "1a8385c3-3fd6-4c6b-8fbd-fb52a3fd9460",
      workspaceId: "ws-miband",
    });
    expect(resolveSessionLink("06fd2360-744d-4a61-90d6-5171324761f0", sessions)).toEqual({
      serverId: "srv_evo",
      agentId: "06fd2360-744d-4a61-90d6-5171324761f0",
      workspaceId: "ws-paseo",
    });
    // Non-session git hashes stay unlinked.
    expect(resolveSessionLink("deadbee", sessions)).toBeNull();
  });

  it("resolves paseo:// deep links and tailnet https agent routes", () => {
    const sessions = fakeSessions();
    expect(
      resolveSessionLink("paseo://h/srv_evo/agent/1a8385c3-3fd6-4c6b-8fbd-fb52a3fd9460", sessions),
    ).toEqual({
      serverId: "srv_evo",
      agentId: "1a8385c3-3fd6-4c6b-8fbd-fb52a3fd9460",
      workspaceId: "ws-miband",
    });
    expect(
      resolveSessionLink("paseo:///h/srv_evo/agent/1a8385c3-3fd6-4c6b-8fbd-fb52a3fd9460", sessions),
    ).toEqual({
      serverId: "srv_evo",
      agentId: "1a8385c3-3fd6-4c6b-8fbd-fb52a3fd9460",
      workspaceId: "ws-miband",
    });
    expect(
      resolveSessionLink(
        "https://evo.tail6454e1.ts.net:8449/h/srv_evo/agent/06fd2360-744d-4a61-90d6-5171324761f0",
        sessions,
      ),
    ).toEqual({
      serverId: "srv_evo",
      agentId: "06fd2360-744d-4a61-90d6-5171324761f0",
      workspaceId: "ws-paseo",
    });
  });

  it("collects only matching session tokens for markdown recognition", () => {
    const sessions = fakeSessions();
    const candidates = collectCandidateSessionTokens(
      "Voir `1a8385c`, commit deadbee et session 06fd2360.",
    );
    expect(resolveKnownSessionTokensKey(candidates, sessions)).toBe("1a8385c\u000006fd2360");
  });
});
