import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeAppControlCommand,
  getAppUiSnapshot,
  registerActiveComposerController,
  registerNavigationController,
  updateAppUiLocation,
  updateLastAssistantMessage,
} from "./app-control-bridge";

vi.mock("@/utils/read-aloud", () => ({
  startReadAloud: vi.fn(),
  stopReadAloud: vi.fn(),
}));

describe("app-control-bridge", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
    updateLastAssistantMessage(null);
  });

  it("exposes live UI snapshot and controls the active composer", async () => {
    let draft = "bonjour";
    let submitted = false;

    updateAppUiLocation({ pathname: "/h/srv/agent/a1", screen: "agent", activeAgentId: "a1" });
    updateLastAssistantMessage({ id: "m1", text: "Voici la réponse finale." });
    cleanups.push(
      registerActiveComposerController({
        getText: () => draft,
        setText: (next, mode) => {
          draft = mode === "append" ? `${draft} ${next}` : next;
        },
        clear: () => {
          draft = "";
        },
        submit: () => {
          submitted = true;
        },
        canSubmit: () => true,
      }),
    );

    const snap = getAppUiSnapshot();
    expect(snap.screen).toBe("agent");
    expect(snap.composer.text).toBe("bonjour");
    expect(snap.lastAssistantMessage?.id).toBe("m1");
    expect(snap.availableActions).toContain("composer.set_text");
    expect(snap.availableActions).toContain("speech.read_aloud");

    await executeAppControlCommand("composer.set_text", { text: "stp", mode: "append" });
    expect(draft).toBe("bonjour stp");

    await executeAppControlCommand("composer.submit", {}, "agent_remote");
    expect(submitted).toBe(true);
  });

  it("navigates via registered navigation handle", async () => {
    const navigateToPath = vi.fn();
    cleanups.push(registerNavigationController({ navigateToPath }));

    const res = await executeAppControlCommand("navigate", { screen: "team" });
    expect(res.ok).toBe(true);
    expect(navigateToPath).toHaveBeenCalledWith("/team");
  });
});
