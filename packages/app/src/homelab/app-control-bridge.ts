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

export type ScrollPositionTag = "top" | "middle" | "bottom";
export type ScrollDirection = "up" | "down" | "top" | "bottom";

export interface ScrollControlHandle {
  scroll: (direction: ScrollDirection) => void;
  getPosition: () => ScrollPositionTag;
}

export interface MediaControlHandle {
  hasImage: () => boolean;
  getImageLabel: () => string | null;
  showImage: () => boolean;
}

export interface Lfm3ControlHandle {
  connect: () => void;
  disconnect: () => void;
  sendText: (text: string) => void;
  cancel: () => void;
}

export interface RecentContextMessage {
  role: "user" | "assistant";
  text: string;
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
  activeSessionTitle: string | null;
  activeWorkspaceId: string | null;
  recentMessages: RecentContextMessage[];
  scrollPosition: ScrollPositionTag;
  visibleMedia: {
    hasImage: boolean;
    imageLabel: string | null;
  };
  composerDraft: string;
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
let activeScroll: ScrollControlHandle | null = null;
let activeMedia: MediaControlHandle | null = null;
let activeLfm3: Lfm3ControlHandle | null = null;
let lastAssistantMsg: AssistantMessageSummary | null = null;
let recentContextMessages: RecentContextMessage[] = [];

const uiMeta = {
  pathname: "/",
  screen: "home",
  activeServerId: null as string | null,
  activeAgentId: null as string | null,
  activeSessionTitle: null as string | null,
  activeWorkspaceId: null as string | null,
};

const snapshotListeners = new Set<() => void>();
let cachedSnapshot: AppUiSnapshot | null = null;

function notifySnapshotListeners(): void {
  cachedSnapshot = null;
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
  activeSessionTitle?: string | null;
  activeWorkspaceId?: string | null;
}): void {
  const prevAgent = uiMeta.activeAgentId;
  uiMeta.pathname = next.pathname;
  uiMeta.screen = next.screen;
  if (next.activeServerId !== undefined) uiMeta.activeServerId = next.activeServerId;
  if (next.activeAgentId !== undefined) uiMeta.activeAgentId = next.activeAgentId;
  if (next.activeSessionTitle !== undefined) uiMeta.activeSessionTitle = next.activeSessionTitle;
  if (next.activeWorkspaceId !== undefined) uiMeta.activeWorkspaceId = next.activeWorkspaceId;
  if (next.activeAgentId && next.activeAgentId !== prevAgent) {
    trackUsageEvent("session.switch", {
      screen: next.screen,
      source: "user",
      meta: { from: prevAgent ?? "none", to: next.activeAgentId },
    });
  }
  notifySnapshotListeners();
}

export function updateRecentContextMessages(messages: RecentContextMessage[]): void {
  recentContextMessages = messages.slice(-3).map((m) => ({
    role: m.role,
    text: m.text.slice(0, 350),
  }));
  notifySnapshotListeners();
}

export function registerScrollController(handle: ScrollControlHandle | null): () => void {
  activeScroll = handle;
  notifySnapshotListeners();
  return () => {
    if (activeScroll === handle) {
      activeScroll = null;
      notifySnapshotListeners();
    }
  };
}

export function registerMediaController(handle: MediaControlHandle | null): () => void {
  activeMedia = handle;
  notifySnapshotListeners();
  return () => {
    if (activeMedia === handle) {
      activeMedia = null;
      notifySnapshotListeners();
    }
  };
}

export function registerLfm3Controller(handle: Lfm3ControlHandle | null): () => void {
  activeLfm3 = handle;
  return () => {
    if (activeLfm3 === handle) activeLfm3 = null;
  };
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
  if (cachedSnapshot) {
    return cachedSnapshot;
  }
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
  if (activeScroll) {
    availableActions.push("scroll");
  }
  if (activeMedia?.hasImage()) {
    availableActions.push("show_image");
  }

  cachedSnapshot = {
    pathname: uiMeta.pathname,
    screen: uiMeta.screen,
    activeServerId: uiMeta.activeServerId,
    activeAgentId: uiMeta.activeAgentId,
    activeSessionTitle: uiMeta.activeSessionTitle,
    activeWorkspaceId: uiMeta.activeWorkspaceId,
    recentMessages: recentContextMessages,
    scrollPosition: activeScroll ? activeScroll.getPosition() : "bottom",
    visibleMedia: {
      hasImage: activeMedia ? activeMedia.hasImage() : false,
      imageLabel: activeMedia ? activeMedia.getImageLabel() : null,
    },
    composerDraft: composerText,
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
  return cachedSnapshot;
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

export function formatActivePaseoContext(snap: AppUiSnapshot = getAppUiSnapshot()): string {
  const header = `[CONTEXTE ACTIF PASEO]\nscreen=${snap.screen} | agentId=${snap.activeAgentId ?? "none"} | title=${snap.activeSessionTitle ?? "none"} | workspace=${snap.activeWorkspaceId ?? "none"} | scroll=${snap.scrollPosition} | hasImage=${snap.visibleMedia.hasImage} (${snap.visibleMedia.imageLabel ?? "none"})`;
  let msgs = "(aucun message récent)";
  if (snap.recentMessages.length > 0) {
    msgs = snap.recentMessages.map((m) => `${m.role}: ${m.text}`).join("\n");
  } else if (snap.lastAssistantMessage) {
    msgs = `assistant: ${snap.lastAssistantMessage.textPreview.slice(0, 350)}`;
  }
  const draftLine = snap.composerDraft ? `composerDraft: ${snap.composerDraft.slice(0, 240)}` : "";
  return [header, msgs, draftLine].filter(Boolean).join("\n").slice(0, 1600);
}

function runUiViewCommand(command: string, args: Record<string, unknown>): Record<string, unknown> {
  if (command === "scroll") {
    const dir = String(args.direction ?? "down") as ScrollDirection;
    if (!activeScroll) {
      return { ok: false, error: "Aucun scroll actif sur cet écran" };
    }
    activeScroll.scroll(dir);
    notifySnapshotListeners();
    return { ok: true, direction: dir };
  }
  if (command === "show_image") {
    if (!activeMedia || !activeMedia.hasImage()) {
      return { ok: false, error: "Aucune image visible dans la session" };
    }
    const opened = activeMedia.showImage();
    return { ok: opened, imageLabel: activeMedia.getImageLabel() };
  }
  return { ok: false, error: `Commande vue inconnue: ${command}` };
}

function runLfm3ControlCommand(
  command: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (!activeLfm3) return { ok: false, error: "Panneau LFM3 non monté" };
  switch (command) {
    case "lfm3.connect":
      activeLfm3.connect();
      return { ok: true };
    case "lfm3.disconnect":
      activeLfm3.disconnect();
      return { ok: true };
    case "lfm3.cancel":
      activeLfm3.cancel();
      return { ok: true };
    case "lfm3.send_text": {
      const text = String(args.text ?? "").trim();
      if (!text) return { ok: false, error: "text requis" };
      activeLfm3.sendText(text);
      return { ok: true, sent: text };
    }
    default:
      return { ok: false, error: `Commande LFM3 inconnue: ${command}` };
  }
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

  if (command === "scroll" || command === "show_image") {
    return runUiViewCommand(command, args);
  }

  if (command.startsWith("lfm3.")) {
    return runLfm3ControlCommand(command, args);
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
