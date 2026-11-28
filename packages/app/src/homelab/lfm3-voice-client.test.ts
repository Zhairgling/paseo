import { describe, expect, it, vi } from "vitest";
import { executeLfm3PaseoTool } from "./lfm3-voice-client";
import * as appControl from "./app-control-bridge";
import * as api from "./api";

vi.mock("@/audio", () => ({
  createAudioEngine: vi.fn(),
}));

describe("lfm3-voice-client tool bridge", () => {
  it("lists sessions from homelab daemon and filters active agents", async () => {
    const spy = vi.spyOn(api, "homelabFetchJson").mockResolvedValue({
      ok: true,
      cwd: "/repo",
      agents: [
        { id: "a1", title: "Boss", status: "running", machine: "colab", model: "qwen3" },
        { id: "a2", title: "Idle", status: "idle", machine: "mac", model: "qwen3" },
      ],
    });

    const res = await executeLfm3PaseoTool(
      { baseUrl: "http://localhost:6767", headers: {} },
      "list_sessions",
      {
        status: "active",
      },
    );

    expect(spy).toHaveBeenCalled();
    expect(res.ok).toBe(true);
    expect(res.count).toBe(1);
    spy.mockRestore();
  });

  it("routes switch_session through App Control navigation", async () => {
    const spy = vi
      .spyOn(appControl, "executeAppControlCommand")
      .mockResolvedValue({ ok: true, navigatedTo: "/sessions" });

    const res = await executeLfm3PaseoTool(
      { baseUrl: "http://localhost:6767", headers: {} },
      "switch_session",
      {
        session_id: "a1",
      },
    );

    expect(spy).toHaveBeenCalledWith(
      "navigate",
      { screen: "sessions", agentId: "a1" },
      "assistant_local",
    );
    expect(res.ok).toBe(true);
    spy.mockRestore();
  });
});
