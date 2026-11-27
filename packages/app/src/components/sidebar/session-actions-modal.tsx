import { useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { Archive, Columns2, Copy, Link2, OctagonX, Pencil, Pin, Tag } from "lucide-react-native";
import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { buildAgentDeepLink } from "@getpaseo/protocol/agent-deep-link";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useToast } from "@/contexts/toast-context";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { buildPinnedSessionKey, usePinnedSessionsStore } from "@/stores/pinned-sessions-store";
import {
  buildSessionTagKey,
  PRESET_SESSION_TAGS,
  useSessionTagsStore,
} from "@/stores/session-tags-store";
import { useSessionStore } from "@/stores/session-store";
import { useSplitSessionStore } from "@/stores/split-session-store";
import type { Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";

const ThemedPencil = withUnistyles(Pencil, (theme: Theme) => ({
  color: theme.colors.foreground,
}));
const ThemedPin = withUnistyles(Pin, (theme: Theme) => ({
  color: theme.colors.foreground,
}));
const ThemedSplit = withUnistyles(Columns2, (theme: Theme) => ({
  color: theme.colors.foreground,
}));
const ThemedCopy = withUnistyles(Copy, (theme: Theme) => ({
  color: theme.colors.foreground,
}));
const ThemedLink = withUnistyles(Link2, (theme: Theme) => ({
  color: theme.colors.foreground,
}));
const ThemedTag = withUnistyles(Tag, (theme: Theme) => ({
  color: theme.colors.accent,
}));
const ThemedStop = withUnistyles(OctagonX, (theme: Theme) => ({
  color: theme.colors.statusWarning,
}));
const ThemedArchive = withUnistyles(Archive, (theme: Theme) => ({
  color: theme.colors.statusDanger,
}));

export interface SessionActionsController {
  openActions: (agent: AggregatedAgent) => void;
  modal: ReactElement;
}

export function useSessionActionsModal(options?: { canSplit?: boolean }): SessionActionsController {
  const canSplit = options?.canSplit ?? false;
  const queryClient = useQueryClient();
  const toast = useToast();
  const { archiveAgent } = useArchiveAgent();
  const pinnedKeys = usePinnedSessionsStore((state) => state.pinnedKeys);
  const togglePinSession = usePinnedSessionsStore((state) => state.togglePinSession);
  const tagsByKey = useSessionTagsStore((state) => state.tagsByKey);
  const setSessionTag = useSessionTagsStore((state) => state.setSessionTag);
  const secondarySplitAgentId = useSplitSessionStore(
    (state) => state.secondarySession?.agentId ?? null,
  );
  const toggleSplitSession = useSplitSessionStore((state) => state.toggleSplitSession);
  const closeSplitSession = useSplitSessionStore((state) => state.closeSplitSession);

  const [actionAgent, setActionAgent] = useState<AggregatedAgent | null>(null);
  const [renamingAgent, setRenamingAgent] = useState<AggregatedAgent | null>(null);
  const [taggingAgent, setTaggingAgent] = useState<AggregatedAgent | null>(null);

  const openActions = useCallback((agent: AggregatedAgent) => {
    setActionAgent(agent);
  }, []);

  const closeActions = useCallback(() => {
    setActionAgent(null);
  }, []);

  const handleStartRename = useCallback(() => {
    if (!actionAgent) return;
    const target = actionAgent;
    setActionAgent(null);
    setRenamingAgent(target);
  }, [actionAgent]);

  const handleCloseRename = useCallback(() => {
    setRenamingAgent(null);
  }, []);

  const handleRenameSubmit = useCallback(
    async (nextTitle: string) => {
      if (!renamingAgent) return;
      const trimmed = nextTitle.trim();
      const client = useSessionStore.getState().sessions[renamingAgent.serverId]?.client ?? null;
      if (!client) {
        throw new Error("Hôte déconnecté");
      }
      await client.updateAgent(renamingAgent.id, { name: trimmed });
      void queryClient.invalidateQueries({
        queryKey: ["sidebarAgentsList", renamingAgent.serverId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["allAgents", renamingAgent.serverId],
      });
      toast.show("Session renommée", { variant: "success" });
    },
    [queryClient, renamingAgent, toast],
  );

  const handleStartCustomTag = useCallback(() => {
    if (!actionAgent) return;
    const target = actionAgent;
    setActionAgent(null);
    setTaggingAgent(target);
  }, [actionAgent]);

  const handleCloseCustomTag = useCallback(() => {
    setTaggingAgent(null);
  }, []);

  const handleCustomTagSubmit = useCallback(
    async (nextTag: string) => {
      if (!taggingAgent) return;
      const cleaned = nextTag.trim() || null;
      setSessionTag(taggingAgent.serverId, taggingAgent.id, cleaned);
      toast.show(cleaned ? `Tag « ${cleaned} » appliqué` : "Tag retiré", { variant: "success" });
    },
    [setSessionTag, taggingAgent, toast],
  );

  const handleSelectTag = useCallback(
    (tag: string | null) => {
      if (!actionAgent) return;
      setSessionTag(actionAgent.serverId, actionAgent.id, tag);
      setActionAgent(null);
      toast.show(tag ? `Tag « ${tag} » appliqué` : "Tag retiré", { variant: "success" });
    },
    [actionAgent, setSessionTag, toast],
  );

  const handleTogglePin = useCallback(() => {
    if (!actionAgent) return;
    togglePinSession(actionAgent.serverId, actionAgent.id);
    setActionAgent(null);
  }, [actionAgent, togglePinSession]);

  const handleToggleSplit = useCallback(() => {
    if (!actionAgent || !actionAgent.workspaceId) return;
    toggleSplitSession({
      serverId: actionAgent.serverId,
      agentId: actionAgent.id,
      workspaceId: actionAgent.workspaceId,
    });
    setActionAgent(null);
  }, [actionAgent, toggleSplitSession]);

  const handleStopAgent = useCallback(() => {
    if (!actionAgent) return;
    const target = actionAgent;
    setActionAgent(null);
    const client = useSessionStore.getState().sessions[target.serverId]?.client ?? null;
    if (!client) {
      toast.error("Hôte déconnecté");
      return;
    }
    void client
      .cancelAgent(target.id)
      .then(() => {
        toast.show("Interruption envoyée", { variant: "success" });
        return undefined;
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "Impossible d'interrompre l'agent");
      });
  }, [actionAgent, toast]);

  const handleCopyShortId = useCallback(() => {
    if (!actionAgent) return;
    const shortId = actionAgent.id.slice(0, 7);
    setActionAgent(null);
    void Clipboard.setStringAsync(shortId).then(() => {
      toast.show(`ID copié : ${shortId}`, { variant: "success" });
      return undefined;
    });
  }, [actionAgent, toast]);

  const handleCopyDeepLink = useCallback(() => {
    if (!actionAgent) return;
    const link = buildAgentDeepLink({
      serverId: actionAgent.serverId,
      agentId: actionAgent.id,
    });
    setActionAgent(null);
    void Clipboard.setStringAsync(link).then(() => {
      toast.show("Lien paseo:// copié", { variant: "success" });
      return undefined;
    });
  }, [actionAgent, toast]);

  const handleArchive = useCallback(async () => {
    if (!actionAgent) return;
    const target = actionAgent;
    setActionAgent(null);

    const isRunning = target.turn.phase === "open" || target.status === "running";
    if (isRunning) {
      const confirmed = await confirmDialog({
        title: "Archiver cette session en cours ?",
        message: "L'agent est encore actif. L'archiver l'arrêtera et la retirera de la liste.",
        confirmLabel: "Archiver",
        cancelLabel: "Annuler",
        destructive: true,
      });
      if (!confirmed) return;
    }

    try {
      await archiveAgent({ serverId: target.serverId, agentId: target.id });
      const pinKey = buildPinnedSessionKey(target.serverId, target.id);
      if (pinnedKeys.includes(pinKey)) {
        togglePinSession(target.serverId, target.id);
      }
      if (secondarySplitAgentId === target.id) {
        closeSplitSession();
      }
      toast.show("Session archivée", { variant: "success" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Impossible d'archiver la session");
    }
  }, [
    actionAgent,
    archiveAgent,
    closeSplitSession,
    pinnedKeys,
    secondarySplitAgentId,
    toast,
    togglePinSession,
  ]);

  const handleArchivePress = useCallback(() => {
    void handleArchive();
  }, [handleArchive]);

  const isPinned = actionAgent
    ? pinnedKeys.includes(buildPinnedSessionKey(actionAgent.serverId, actionAgent.id))
    : false;
  const isSplitOpen = actionAgent ? secondarySplitAgentId === actionAgent.id : false;
  const isRunning = actionAgent
    ? actionAgent.turn.phase === "open" || actionAgent.status === "running"
    : false;
  const currentTag = actionAgent
    ? (tagsByKey[buildSessionTagKey(actionAgent.serverId, actionAgent.id)] ?? null)
    : null;
  const taggingInitialValue = taggingAgent
    ? (tagsByKey[buildSessionTagKey(taggingAgent.serverId, taggingAgent.id)] ?? "")
    : "";

  const modal = useMemo(
    () => (
      <SessionActionsModalView
        actionAgent={actionAgent}
        renamingAgent={renamingAgent}
        taggingAgent={taggingAgent}
        taggingInitialValue={taggingInitialValue}
        currentTag={currentTag}
        isPinned={isPinned}
        isRunning={isRunning}
        isSplitOpen={isSplitOpen}
        canSplit={canSplit && Boolean(actionAgent?.workspaceId)}
        onCloseActions={closeActions}
        onStartRename={handleStartRename}
        onSelectTag={handleSelectTag}
        onStartCustomTag={handleStartCustomTag}
        onTogglePin={handleTogglePin}
        onToggleSplit={handleToggleSplit}
        onStopAgent={handleStopAgent}
        onCopyShortId={handleCopyShortId}
        onCopyDeepLink={handleCopyDeepLink}
        onArchive={handleArchivePress}
        onCloseRename={handleCloseRename}
        onSubmitRename={handleRenameSubmit}
        onCloseCustomTag={handleCloseCustomTag}
        onSubmitCustomTag={handleCustomTagSubmit}
      />
    ),
    [
      actionAgent,
      canSplit,
      closeActions,
      currentTag,
      handleArchivePress,
      handleCloseCustomTag,
      handleCloseRename,
      handleCopyDeepLink,
      handleCopyShortId,
      handleCustomTagSubmit,
      handleRenameSubmit,
      handleSelectTag,
      handleStartCustomTag,
      handleStartRename,
      handleStopAgent,
      handleTogglePin,
      handleToggleSplit,
      isPinned,
      isRunning,
      isSplitOpen,
      renamingAgent,
      taggingAgent,
      taggingInitialValue,
    ],
  );

  return { openActions, modal };
}

const TagChipOption = memo(function TagChipOption({
  label,
  value,
  active,
  onSelect,
}: {
  label: string;
  value: string | null;
  active: boolean;
  onSelect: (tag: string | null) => void;
}) {
  const handlePress = useCallback(() => {
    onSelect(value);
  }, [onSelect, value]);

  return (
    <PressHighlight
      onPress={handlePress}
      style={[styles.tagChip, active && styles.tagChipActive]}
      accessibilityRole="button"
    >
      <Text style={[styles.tagChipText, active && styles.tagChipTextActive]}>{label}</Text>
    </PressHighlight>
  );
});

const SessionActionsModalView = memo(function SessionActionsModalView({
  actionAgent,
  renamingAgent,
  taggingAgent,
  taggingInitialValue,
  currentTag,
  isPinned,
  isRunning,
  isSplitOpen,
  canSplit,
  onCloseActions,
  onStartRename,
  onSelectTag,
  onStartCustomTag,
  onTogglePin,
  onToggleSplit,
  onStopAgent,
  onCopyShortId,
  onCopyDeepLink,
  onArchive,
  onCloseRename,
  onSubmitRename,
  onCloseCustomTag,
  onSubmitCustomTag,
}: {
  actionAgent: AggregatedAgent | null;
  renamingAgent: AggregatedAgent | null;
  taggingAgent: AggregatedAgent | null;
  taggingInitialValue: string;
  currentTag: string | null;
  isPinned: boolean;
  isRunning: boolean;
  isSplitOpen: boolean;
  canSplit: boolean;
  onCloseActions: () => void;
  onStartRename: () => void;
  onSelectTag: (tag: string | null) => void;
  onStartCustomTag: () => void;
  onTogglePin: () => void;
  onToggleSplit: () => void;
  onStopAgent: () => void;
  onCopyShortId: () => void;
  onCopyDeepLink: () => void;
  onArchive: () => void;
  onCloseRename: () => void;
  onSubmitRename: (nextTitle: string) => Promise<void>;
  onCloseCustomTag: () => void;
  onSubmitCustomTag: (nextTag: string) => Promise<void>;
}) {
  const title =
    actionAgent?.title?.trim() || (actionAgent ? `Session ${actionAgent.id.slice(0, 7)}` : "");
  const header = useMemo<SheetHeader>(() => ({ title }), [title]);
  const shortId = actionAgent ? actionAgent.id.slice(0, 7) : "";

  return (
    <>
      <AdaptiveModalSheet
        visible={actionAgent !== null}
        onClose={onCloseActions}
        header={header}
        desktopMaxWidth={360}
        testID="session-actions-sheet"
      >
        <View style={styles.menuList}>
          <PressHighlight
            onPress={onStartRename}
            style={styles.menuItem}
            accessibilityRole="button"
            testID="session-action-rename"
          >
            <ThemedPencil size={16} />
            <Text style={styles.menuLabel}>Renommer la session</Text>
          </PressHighlight>

          <PressHighlight
            onPress={onTogglePin}
            style={styles.menuItem}
            accessibilityRole="button"
            testID="session-action-pin"
          >
            <ThemedPin size={16} />
            <Text style={styles.menuLabel}>{isPinned ? "Désépingler" : "Épingler en haut"}</Text>
          </PressHighlight>

          {canSplit ? (
            <PressHighlight
              onPress={onToggleSplit}
              style={styles.menuItem}
              accessibilityRole="button"
              testID="session-action-split"
            >
              <ThemedSplit size={16} />
              <Text style={styles.menuLabel}>
                {isSplitOpen ? "Fermer le panneau Split" : "Ouvrir côte à côte (Split)"}
              </Text>
            </PressHighlight>
          ) : null}

          <View style={styles.tagSection}>
            <View style={styles.tagHeaderRow}>
              <ThemedTag size={14} />
              <Text style={styles.tagSectionLabel}>Dossier / Tag</Text>
            </View>
            <View style={styles.tagChipsWrap}>
              {PRESET_SESSION_TAGS.map((tag) => (
                <TagChipOption
                  key={tag}
                  label={tag}
                  value={currentTag === tag ? null : tag}
                  active={currentTag === tag}
                  onSelect={onSelectTag}
                />
              ))}
              {currentTag &&
              !PRESET_SESSION_TAGS.includes(currentTag as (typeof PRESET_SESSION_TAGS)[number]) ? (
                <TagChipOption label={currentTag} value={null} active onSelect={onSelectTag} />
              ) : null}
              <PressHighlight
                onPress={onStartCustomTag}
                style={styles.tagChip}
                accessibilityRole="button"
                testID="session-action-custom-tag"
              >
                <Text style={styles.tagChipText}>+ Autre…</Text>
              </PressHighlight>
              {currentTag ? (
                <TagChipOption label="Retirer" value={null} active={false} onSelect={onSelectTag} />
              ) : null}
            </View>
          </View>

          <View style={styles.separator} />

          <PressHighlight
            onPress={onCopyShortId}
            style={styles.menuItem}
            accessibilityRole="button"
            testID="session-action-copy-id"
          >
            <ThemedCopy size={16} />
            <Text style={styles.menuLabel}>{`Copier l'ID court (${shortId})`}</Text>
          </PressHighlight>

          <PressHighlight
            onPress={onCopyDeepLink}
            style={styles.menuItem}
            accessibilityRole="button"
            testID="session-action-copy-link"
          >
            <ThemedLink size={16} />
            <Text style={styles.menuLabel}>Copier le lien paseo://</Text>
          </PressHighlight>

          {isRunning ? (
            <>
              <View style={styles.separator} />
              <PressHighlight
                onPress={onStopAgent}
                style={styles.menuItem}
                accessibilityRole="button"
                testID="session-action-stop"
              >
                <ThemedStop size={16} />
                <Text style={styles.menuLabelWarn}>Stopper / Interrompre</Text>
              </PressHighlight>
            </>
          ) : null}

          <View style={styles.separator} />

          <PressHighlight
            onPress={onArchive}
            style={styles.menuItem}
            accessibilityRole="button"
            testID="session-action-archive"
          >
            <ThemedArchive size={16} />
            <Text style={styles.menuLabelDanger}>Archiver la session</Text>
          </PressHighlight>
        </View>
      </AdaptiveModalSheet>

      <AdaptiveRenameModal
        visible={renamingAgent !== null}
        title="Renommer la session"
        initialValue={renamingAgent?.title ?? ""}
        submitLabel="Enregistrer"
        maxLength={200}
        onClose={onCloseRename}
        onSubmit={onSubmitRename}
        testID="session-rename-modal"
      />

      <AdaptiveRenameModal
        visible={taggingAgent !== null}
        title="Tag / Dossier de la session"
        initialValue={taggingInitialValue}
        submitLabel="Appliquer"
        maxLength={32}
        onClose={onCloseCustomTag}
        onSubmit={onSubmitCustomTag}
        testID="session-tag-modal"
      />
    </>
  );
});

const styles = StyleSheet.create((theme) => ({
  menuList: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[1],
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 10,
    borderRadius: theme.borderRadius.md,
  },
  menuLabel: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  menuLabelWarn: {
    fontSize: theme.fontSize.base,
    color: theme.colors.statusWarning,
    fontWeight: theme.fontWeight.semibold,
  },
  menuLabelDanger: {
    fontSize: theme.fontSize.base,
    color: theme.colors.statusDanger,
    fontWeight: theme.fontWeight.medium,
  },
  tagSection: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[2],
  },
  tagHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tagSectionLabel: {
    fontSize: 11,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  tagChipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1.5],
  },
  tagChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  tagChipActive: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  tagChipText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  tagChipTextActive: {
    color: theme.colors.accentForeground,
    fontWeight: theme.fontWeight.semibold,
  },
  separator: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: theme.spacing[1],
  },
}));
