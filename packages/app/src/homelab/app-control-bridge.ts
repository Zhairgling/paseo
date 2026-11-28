import { startReadAloud, stopReadAloud } from "@/utils/read-aloud";
import type { UsageEventSource } from "./api";
import { trackUsageEvent } from "./usage-stats";

export interface ComposerControlHandle {
  getText: () => string;
  setText: (text: string, mode?: "replace" | "append") => void;
  clear: () => void;
  submit: () => Promise<void> | void;
  canSubmit: () => boolean;
}

export interface NavigationControlHandle {
  navigateToPath: (path: string) => void;
}

export interface TeamTabControlHandle {
  switchTab: (tab: string) => void;
}

export interface AssistantMessageSummary {
  id: string;
  text: string;
  agentId?: string;
}

export interface AppUiSnapshot {
  pathname: string;
  screen: string;
  activeServerId: string | null;
  activeAgentId: string | null;
  activeWorkspaceId: string | null;
  composer: {
    attached: boolean;
    text: string;
    canSubmit: boolean;
  };
  lastAssistantMessage: {
    id: string;
    textPreview: string;
    fullLength: number;
  } | null;
  availableActions: string[];
  updatedAt: number;
}

let activeComposer: ComposerControlHandle | null = null;
let activeNavigation: NavigationControlHandle | null = null;
let activeTeamTab: TeamTabControlHandle | null = null;
let lastAssistantMsg: AssistantMessageSummary | null = null;

const uiMeta = {
  pathname: "/",
  screen: "home",
  activeServerId: null as string | null,
  activeAgentId: null as string | null,
  activeWorkspaceId: null as string | null,
};

const snapshotListeners = new Set<() => void>();

function notifySnapshotListeners(): void {
  for (const listener of snapshotListeners) {
    listener();
  }
}

export function subscribeAppUiSnapshot(listener: () => void): () => void {
  snapshotListeners.add(listener);
  return () => {
    snapshotListeners.delete(listener);
  };
}

export function updateAppUiLocation(next: {
  pathname: string;
  screen: string;
  activeServerId?: string | null;
  activeAgentId?: string | null;
  activeWorkspaceId?: string | null;
}): void {
  uiMeta.pathname = next.pathname;
  uiMeta.screen = next.screen;
  if (next.activeServerId !== undefined) uiMeta.activeServerId = next.activeServerId;
  if (next.activeAgentId !== undefined) uiMeta.activeAgentId = next.activeAgentId;
  if (next.activeWorkspaceId !== undefined) uiMeta.activeWorkspaceId = next.activeWorkspaceId;
  notifySnapshotListeners();
}

export function updateLastAssistantMessage(msg: AssistantMessageSummary | null): void {
  lastAssistantMsg = msg;
  notifySnapshotListeners();
}

export function registerActiveComposerController(handle: ComposerControlHandle | null): () => void {
  activeComposer = handle;
  notifySnapshotListeners();
  return () => {
    if (activeComposer === handle) {
      activeComposer = null;
      notifySnapshotListeners();
    }
  };
}

export function registerNavigationController(handle: NavigationControlHandle | null): () => void {
  activeNavigation = handle;
  return () => {
    if (activeNavigation === handle) activeNavigation = null;
  };
}

export function registerTeamTabController(handle: TeamTabControlHandle | null): () => void {
  activeTeamTab = handle;
  return () => {
    if (activeTeamTab === handle) activeTeamTab = null;
  };
}

export function getAppUiSnapshot(): AppUiSnapshot {
  const composerText = activeComposer ? activeComposer.getText() : "";
  const canSubmit = activeComposer ? activeComposer.canSubmit() : false;
  const availableActions: string[] = ["ui.snapshot", "navigate"];
  if (activeComposer) {
    availableActions.push("composer.get", "composer.set_text", "composer.clear", "composer.submit");
  }
  if (lastAssistantMsg) {
    availableActions.push("speech.read_aloud", "speech.stop");
  }
  if (activeTeamTab) {
    availableActions.push("team.switch_tab");
  }

  return {
    pathname: uiMeta.pathname,
    screen: uiMeta.screen,
    activeServerId: uiMeta.activeServerId,
    activeAgentId: uiMeta.activeAgentId,
    activeWorkspaceId: uiMeta.activeWorkspaceId,
    composer: {
      attached: Boolean(activeComposer),
      text: composerText,
      canSubmit,
    },
    lastAssistantMessage: lastAssistantMsg
      ? {
          id: lastAssistantMsg.id,
          textPreview: lastAssistantMsg.text.slice(0, 400),
          fullLength: lastAssistantMsg.text.length,
        }
      : null,
    availableActions,
    updatedAt: Date.now(),
  };
}

function resolveRoutePath(args: Record<string, unknown>): string | null {
  if (typeof args.route === "string" && args.route.trim()) return args.route.trim();
  const screen = typeof args.screen === "string" ? args.screen.trim() : "";
  switch (screen) {
    case "home":
    case "sessions":
      return "/sessions";
    case "team":
      return "/team";
    case "new":
      return "/new";
    case "settings":
      return "/settings";
    case "inbox":
      return "/inbox";
    case "schedules":
      return "/schedules";
    default:
      return null;
  }
}

async function runComposerCommand(
  command: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!activeComposer) {
    return { ok: false, error: "Aucun champ de saisie actif sur cet écran" };
  }
  if (command === "composer.get") {
    return { ok: true, text: activeComposer.getText(), canSubmit: activeComposer.canSubmit() };
  }
  if (command === "composer.set_text") {
    const text = typeof args.text === "string" ? args.text : "";
    const mode = args.mode === "append" ? "append" : "replace";
    activeComposer.setText(text, mode);
    notifySnapshotListeners();
    return { ok: true, text: activeComposer.getText() };
  }
  if (command === "composer.clear") {
    activeComposer.clear();
    notifySnapshotListeners();
    return { ok: true, text: "" };
  }
  if (command === "composer.submit") {
    if (!activeComposer.canSubmit()) {
      return { ok: false, error: "Envoi impossible pour le moment" };
    }
    await activeComposer.submit();
    notifySnapshotListeners();
    return { ok: true, submitted: true };
  }
  return { ok: false, error: `Commande composer inconnue: ${command}` };
}

function runSpeechCommand(command: string, args: Record<string, unknown>): Record<string, unknown> {
  if (command === "speech.stop") {
    stopReadAloud();
    return { ok: true, stopped: true };
  }
  const rawArgText = typeof args.text === "string" ? args.text.trim() : "";
  const text = rawArgText || lastAssistantMsg?.text || "";
  if (!text) {
    return { ok: false, error: "Aucun texte à lire à voix haute" };
  }
  const id = typeof args.id === "string" ? args.id : (lastAssistantMsg?.id ?? "app-control-tts");
  startReadAloud(id, text);
  return { ok: true, speakingId: id, length: text.length };
}

export async function executeAppControlCommand(
  command: string,
  args: Record<string, unknown> = {},
  source: UsageEventSource = "assistant_local",
): Promise<Record<string, unknown>> {
  trackUsageEvent(`control.${command}`, { screen: uiMeta.screen, source });

  if (command === "ui.snapshot") {
    return { ok: true, snapshot: getAppUiSnapshot() };
  }

  if (command === "navigate") {
    const path = resolveRoutePath(args);
    if (!path || !activeNavigation) {
      return { ok: false, error: "Route invalide ou navigation indisponible" };
    }
    activeNavigation.navigateToPath(path);
    return { ok: true, navigatedTo: path };
  }

  if (command.startsWith("composer.")) {
    return runComposerCommand(command, args);
  }

  if (command === "speech.read_aloud" || command === "speech.stop") {
    return runSpeechCommand(command, args);
  }

  if (command === "team.switch_tab") {
    const tab = typeof args.tab === "string" ? args.tab.trim() : "";
    if (!tab || !activeTeamTab) {
      return { ok: false, error: "Onglet ou écran Équipe inactif" };
    }
    activeTeamTab.switchTab(tab);
    return { ok: true, tab };
  }

  return { ok: false, error: `Commande inconnue: ${command}` };
}
