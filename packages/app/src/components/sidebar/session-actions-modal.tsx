import { useQueryClient } from "@tanstack/react-query";
import { Archive, Columns2, Pencil, Pin } from "lucide-react-native";
import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useToast } from "@/contexts/toast-context";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { buildPinnedSessionKey, usePinnedSessionsStore } from "@/stores/pinned-sessions-store";
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
  const secondarySplitAgentId = useSplitSessionStore(
    (state) => state.secondarySession?.agentId ?? null,
  );
  const toggleSplitSession = useSplitSessionStore((state) => state.toggleSplitSession);
  const closeSplitSession = useSplitSessionStore((state) => state.closeSplitSession);

  const [actionAgent, setActionAgent] = useState<AggregatedAgent | null>(null);
  const [renamingAgent, setRenamingAgent] = useState<AggregatedAgent | null>(null);

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

  const modal = useMemo(
    () => (
      <SessionActionsModalView
        actionAgent={actionAgent}
        renamingAgent={renamingAgent}
        isPinned={isPinned}
        isSplitOpen={isSplitOpen}
        canSplit={canSplit && Boolean(actionAgent?.workspaceId)}
        onCloseActions={closeActions}
        onStartRename={handleStartRename}
        onTogglePin={handleTogglePin}
        onToggleSplit={handleToggleSplit}
        onArchive={handleArchivePress}
        onCloseRename={handleCloseRename}
        onSubmitRename={handleRenameSubmit}
      />
    ),
    [
      actionAgent,
      canSplit,
      closeActions,
      handleArchivePress,
      handleCloseRename,
      handleRenameSubmit,
      handleStartRename,
      handleTogglePin,
      handleToggleSplit,
      isPinned,
      isSplitOpen,
      renamingAgent,
    ],
  );

  return { openActions, modal };
}

const SessionActionsModalView = memo(function SessionActionsModalView({
  actionAgent,
  renamingAgent,
  isPinned,
  isSplitOpen,
  canSplit,
  onCloseActions,
  onStartRename,
  onTogglePin,
  onToggleSplit,
  onArchive,
  onCloseRename,
  onSubmitRename,
}: {
  actionAgent: AggregatedAgent | null;
  renamingAgent: AggregatedAgent | null;
  isPinned: boolean;
  isSplitOpen: boolean;
  canSplit: boolean;
  onCloseActions: () => void;
  onStartRename: () => void;
  onTogglePin: () => void;
  onToggleSplit: () => void;
  onArchive: () => void;
  onCloseRename: () => void;
  onSubmitRename: (nextTitle: string) => Promise<void>;
}) {
  const title =
    actionAgent?.title?.trim() || (actionAgent ? `Session ${actionAgent.id.slice(0, 7)}` : "");
  const header = useMemo<SheetHeader>(() => ({ title }), [title]);

  return (
    <>
      <AdaptiveModalSheet
        visible={actionAgent !== null}
        onClose={onCloseActions}
        header={header}
        desktopMaxWidth={340}
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
  menuLabelDanger: {
    fontSize: theme.fontSize.base,
    color: theme.colors.statusDanger,
    fontWeight: theme.fontWeight.medium,
  },
  separator: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: theme.spacing[1],
  },
}));
