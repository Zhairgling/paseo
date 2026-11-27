import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import {
  formatAssistantNotificationPreview,
  formatFinishedAgentNotification,
  formatPermissionAgentNotification,
  type WorkspaceNotificationMeta,
} from "./agent-notification-format";

const baseAgent: Pick<
  Agent,
  "id" | "title" | "cwd" | "workspaceId" | "attentionReason" | "lastError"
> = {
  id: "4830d03c-8285-4ce5-94a6-f779b88fb5b4",
  title: "écho firmware",
  cwd: "/home/julienc/Documents/GitHub/echo-libre",
  workspaceId: "wks_echo",
  attentionReason: "finished",
  lastError: null,
};

const workspaces = new Map<string, WorkspaceNotificationMeta>([
  [
    "wks_echo",
    {
      projectDisplayName: "echo-libre",
      projectCustomName: "Echo Libre",
    },
  ],
]);

describe("agent-notification-format", () => {
  it("never repeats AjuCode in title or subtitle and surfaces workspace context", () => {
    const formatted = formatFinishedAgentNotification({
      agent: {
        ...baseAgent,
        title: "ajucode",
        cwd: "/home/julienc/Documents/GitHub/miBand8",
        workspaceId: "wks_missing",
      },
      workspaces,
      assistantMessage:
        "### Résumé\nC'est fait — le bridge ACP MCP est compilé et poussé sur `main`.\n- 335 tests passent.",
    });

    expect(formatted.title).toBe("Session miBand8");
    expect(formatted.title).not.toMatch(/ajucode/i);
    expect(formatted.subtitle).toBe("miBand8 · Terminé");
    expect(formatted.body).toContain("le bridge ACP MCP est compilé");
    expect(formatted.body).toContain("335 tests passent.");
    expect(formatted.color).toBe("#5EC269");
  });

  it("formats finished notifications cleanly using custom workspace name", () => {
    const formatted = formatFinishedAgentNotification({
      agent: baseAgent,
      workspaces,
      assistantMessage: "## Tests\n1. Suite Rust OK.\n2. Clippy sans warning.",
    });

    expect(formatted.title).toBe("écho firmware");
    expect(formatted.subtitle).toBe("Echo Libre · Terminé");
    expect(formatted.body).toBe("Suite Rust OK. · Clippy sans warning.");
  });

  it("surfaces concrete lastError when an agent fails", () => {
    const formatted = formatFinishedAgentNotification({
      agent: {
        ...baseAgent,
        attentionReason: "error",
        lastError: "cargo build failed: missing target thumbv7em",
      },
      workspaces,
      assistantMessage: "Ignoré",
    });

    expect(formatted.tone).toBe("error");
    expect(formatted.subtitle).toBe("Echo Libre · Erreur");
    expect(formatted.body).toBe("cargo build failed: missing target thumbv7em");
    expect(formatted.color).toBe("#EF4444");
  });

  it("formats question and command permission notifications cleanly", () => {
    const questionNotif = formatPermissionAgentNotification({
      agent: baseAgent,
      workspaces,
      permission: {
        id: "perm-q",
        provider: "claude",
        name: "AskUserQuestion",
        kind: "question",
        input: {
          questions: [
            {
              question: "Flasher le firmware maintenant ?",
              options: [{ label: "Oui" }, { label: "Plus tard" }],
            },
          ],
        },
      },
    });
    expect(questionNotif).toMatchObject({
      title: "écho firmware",
      subtitle: "Echo Libre · Question",
      body: "Flasher le firmware maintenant ? · Oui / Plus tard",
      tone: "question",
    });

    const cmdNotif = formatPermissionAgentNotification({
      agent: baseAgent,
      workspaces,
      permission: {
        id: "perm-c",
        provider: "claude",
        name: "Bash",
        kind: "tool",
        input: { command: "git push origin main" },
      },
    });
    expect(cmdNotif).toMatchObject({
      title: "écho firmware",
      subtitle: "Echo Libre · Permission",
      body: "$ git push origin main",
      tone: "permission",
    });
  });

  it("strips code fences and filler headings cleanly", () => {
    expect(
      formatAssistantNotificationPreview(
        "# Résumé\n\nParfait, j'ai corrigé `mcp-server.ts`.\n\n```ts\nconst ok = true;\n```",
      ),
    ).toBe("j'ai corrigé mcp-server.ts. · const ok = true;");
  });
});
