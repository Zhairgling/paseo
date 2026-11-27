import { router } from "expo-router";
import { Columns2, MoreHorizontal, Pin } from "lucide-react-native";
import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useSessionActionsModal } from "@/components/sidebar/session-actions-modal";
import { SidebarGroupToggleRow } from "@/components/sidebar/sidebar-group-toggle-row";
import { SidebarSectionHeader } from "@/components/sidebar/sidebar-section-header";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useActiveSessionAgentId } from "@/hooks/use-active-session-agent-id";
import { useAggregatedAgents, type AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { buildPinnedSessionKey, usePinnedSessionsStore } from "@/stores/pinned-sessions-store";
import { useSessionStore } from "@/stores/session-store";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { useSplitSessionStore } from "@/stores/split-session-store";
import type { Theme } from "@/styles/theme";
import { buildInboxRoute } from "@/utils/host-routes";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { extractLastSessionPreview, formatSessionModelBadge } from "@/utils/session-display";

const COMPACT_VISIBLE_COUNT = 6;
const EXPANDED_DEFAULT_VISIBLE_COUNT = 20;
const EXPANDED_MAX_VISIBLE_COUNT = 50;

type SessionDotKind = "permission" | "running" | "attention" | "idle";

const ThemedPinMuted = withUnistyles(Pin, (theme: Theme) => ({
  color: theme.colors.foregroundExtraMuted,
}));

const ThemedPinActive = withUnistyles(Pin, (theme: Theme) => ({
  color: theme.colors.accent,
}));

const ThemedSplitMuted = withUnistyles(Columns2, (theme: Theme) => ({
  color: theme.colors.foregroundExtraMuted,
}));

const ThemedSplitActive = withUnistyles(Columns2, (theme: Theme) => ({
  color: theme.colors.accent,
}));

const ThemedMoreMuted = withUnistyles(MoreHorizontal, (theme: Theme) => ({
  color: theme.colors.foregroundExtraMuted,
}));

function repoNameFromCwd(cwd: string): string {
  const cleaned = cwd.replace(/[\\/]+$/, "");
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function formatCompactAge(date: Date): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSec < 60) return "now";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}j`;
}

function classifyDotKind(agent: AggregatedAgent): SessionDotKind {
  if ((agent.pendingPermissionCount ?? 0) > 0) return "permission";
  if (agent.turn.phase === "open" || agent.status === "running") return "running";
  if (agent.requiresAttention) return "attention";
  return "idle";
}

function dotStyleFor(kind: SessionDotKind) {
  if (kind === "permission") return styles.dotDanger;
  if (kind === "running") return styles.dotOk;
  if (kind === "attention") return styles.dotAccent;
  return styles.dotWarn;
}

export const SidebarRecentSessionsSection = memo(function SidebarRecentSessionsSection({
  onSessionPress,
  showPinnedConversations = false,
  expandedDefault = false,
}: {
  onSessionPress?: () => void;
  showPinnedConversations?: boolean;
  expandedDefault?: boolean;
}): ReactElement | null {
  const { t } = useTranslation();
  const isCompactLayout = useIsCompactFormFactor();
  const canSplit = !isCompactLayout;
  const sessionActions = useSessionActionsModal({ canSplit });
  const activeAgentId = useActiveSessionAgentId();
  const secondarySplitAgentId = useSplitSessionStore(
    (state) => state.secondarySession?.agentId ?? null,
  );
  const toggleSplitSession = useSplitSessionStore((state) => state.toggleSplitSession);
  const { agents } = useAggregatedAgents({ includeArchived: false });
  const collapsed = useSidebarCollapsedSectionsStore((state) => state.collapsedRecentSessions);
  const toggleCollapsed = useSidebarCollapsedSectionsStore(
    (state) => state.toggleRecentSessionsCollapsed,
  );
  const pinnedCollapsed = useSidebarCollapsedSectionsStore((state) => state.collapsedPinned);
  const togglePinnedCollapsed = useSidebarCollapsedSectionsStore(
    (state) => state.togglePinnedCollapsed,
  );
  const pinnedKeys = usePinnedSessionsStore((state) => state.pinnedKeys);
  const togglePinSession = usePinnedSessionsStore((state) => state.togglePinSession);
  const [expanded, setExpanded] = useState(false);

  const pinnedKeySet = useMemo(() => new Set(pinnedKeys), [pinnedKeys]);

  const { pinnedAgents, unpinnedAgents } = useMemo(() => {
    const active = agents.filter((agent) => agent.status !== "closed");
    const list = active.length > 0 ? [...active] : [...agents];
    list.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());

    if (!showPinnedConversations) {
      return { pinnedAgents: [] as AggregatedAgent[], unpinnedAgents: list };
    }

    const byKey = new Map<string, AggregatedAgent>();
    for (const agent of list) {
      byKey.set(buildPinnedSessionKey(agent.serverId, agent.id), agent);
    }

    const pinned: AggregatedAgent[] = [];
    for (const key of pinnedKeys) {
      const match = byKey.get(key);
      if (match) {
        pinned.push(match);
      }
    }

    const unpinned = list.filter(
      (agent) => !pinnedKeySet.has(buildPinnedSessionKey(agent.serverId, agent.id)),
    );
    return { pinnedAgents: pinned, unpinnedAgents: unpinned };
  }, [agents, pinnedKeySet, pinnedKeys, showPinnedConversations]);

  const handleToggleExpanded = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const handleOpenInbox = useCallback(() => {
    onSessionPress?.();
    router.push(buildInboxRoute());
  }, [onSessionPress]);

  const handleOpenAgent = useCallback(
    (agent: AggregatedAgent) => {
      onSessionPress?.();
      navigateToAgent({
        serverId: agent.serverId,
        agentId: agent.id,
        workspaceId: agent.workspaceId,
        pin: true,
      });
    },
    [onSessionPress],
  );

  const handleTogglePin = useCallback(
    (agent: AggregatedAgent) => {
      togglePinSession(agent.serverId, agent.id);
    },
    [togglePinSession],
  );

  const handleToggleSplit = useCallback(
    (agent: AggregatedAgent) => {
      if (!agent.workspaceId) return;
      toggleSplitSession({
        serverId: agent.serverId,
        agentId: agent.id,
        workspaceId: agent.workspaceId,
      });
    },
    [toggleSplitSession],
  );

  if (pinnedAgents.length === 0 && unpinnedAgents.length === 0) {
    return null;
  }

  const baseLimit = expandedDefault ? EXPANDED_DEFAULT_VISIBLE_COUNT : COMPACT_VISIBLE_COUNT;
  const visibleAgents = expanded
    ? unpinnedAgents.slice(0, EXPANDED_MAX_VISIBLE_COUNT)
    : unpinnedAgents.slice(0, baseLimit);
  const canToggleMore = unpinnedAgents.length > baseLimit;

  return (
    <>
      {showPinnedConversations && pinnedAgents.length > 0 ? (
        <View style={styles.section} testID="sidebar-pinned-sessions-section">
          <SidebarSectionHeader
            title={t("sidebar.pinned.title")}
            collapsed={pinnedCollapsed}
            onToggle={togglePinnedCollapsed}
            testID="sidebar-pinned-sessions-header"
          />
          {pinnedCollapsed ? null : (
            <View style={styles.list}>
              {pinnedAgents.map((agent) => (
                <RecentSessionRow
                  key={`pinned:${agent.serverId}:${agent.id}`}
                  agent={agent}
                  isActive={activeAgentId === agent.id}
                  isPinned
                  isSplitOpen={secondarySplitAgentId === agent.id}
                  canSplit={canSplit && Boolean(agent.workspaceId)}
                  onPress={handleOpenAgent}
                  onTogglePin={handleTogglePin}
                  onToggleSplit={handleToggleSplit}
                  onOpenActions={sessionActions.openActions}
                />
              ))}
            </View>
          )}
        </View>
      ) : null}

      <View style={styles.section} testID="sidebar-recent-sessions-section">
        <SidebarSectionHeader
          title={t("sidebar.recentSessions.title")}
          collapsed={collapsed}
          onToggle={toggleCollapsed}
          testID="sidebar-recent-sessions-header"
        >
          <PressHighlight
            onPress={handleOpenInbox}
            style={styles.viewAllButton}
            testID="sidebar-recent-sessions-view-all"
          >
            <Text style={styles.viewAllText}>{t("sidebar.recentSessions.viewAll")}</Text>
          </PressHighlight>
        </SidebarSectionHeader>

        {collapsed ? null : (
          <View style={styles.list}>
            {visibleAgents.map((agent) => (
              <RecentSessionRow
                key={`${agent.serverId}:${agent.id}`}
                agent={agent}
                isActive={activeAgentId === agent.id}
                isPinned={pinnedKeySet.has(buildPinnedSessionKey(agent.serverId, agent.id))}
                isSplitOpen={secondarySplitAgentId === agent.id}
                canSplit={canSplit && Boolean(agent.workspaceId)}
                onPress={handleOpenAgent}
                onTogglePin={handleTogglePin}
                onToggleSplit={handleToggleSplit}
                onOpenActions={sessionActions.openActions}
              />
            ))}
            {canToggleMore ? (
              <SidebarGroupToggleRow
                expanded={expanded}
                onPress={handleToggleExpanded}
                testID="sidebar-recent-sessions-show-more"
              />
            ) : null}
          </View>
        )}
      </View>

      {sessionActions.modal}
    </>
  );
});

const RecentSessionRow = memo(function RecentSessionRow({
  agent,
  isActive,
  isPinned,
  isSplitOpen,
  canSplit,
  onPress,
  onTogglePin,
  onToggleSplit,
  onOpenActions,
}: {
  agent: AggregatedAgent;
  isActive: boolean;
  isPinned: boolean;
  isSplitOpen: boolean;
  canSplit: boolean;
  onPress: (agent: AggregatedAgent) => void;
  onTogglePin: (agent: AggregatedAgent) => void;
  onToggleSplit: (agent: AggregatedAgent) => void;
  onOpenActions: (agent: AggregatedAgent) => void;
}) {
  const modelId = useSessionStore((state) => {
    const live = state.sessions[agent.serverId]?.agents.get(agent.id);
    return live?.runtimeInfo?.model ?? live?.model ?? null;
  });
  const lastPreview = useSessionStore((state) => {
    const session = state.sessions[agent.serverId];
    if (!session) return null;
    return extractLastSessionPreview(
      session.agentStreamTail.get(agent.id),
      session.agentStreamHead.get(agent.id),
    );
  });

  const handlePress = useCallback(() => {
    onPress(agent);
  }, [agent, onPress]);

  const handlePinPress = useCallback(() => {
    onTogglePin(agent);
  }, [agent, onTogglePin]);

  const handleSplitPress = useCallback(() => {
    onToggleSplit(agent);
  }, [agent, onToggleSplit]);

  const handleActionsPress = useCallback(() => {
    onOpenActions(agent);
  }, [agent, onOpenActions]);

  const kind = classifyDotKind(agent);
  const title = agent.title?.trim() || `Session ${agent.id.slice(0, 7)}`;
  const modelBadge = formatSessionModelBadge(agent.provider, modelId);
  const repo = repoNameFromCwd(agent.cwd);
  const subtitleText = lastPreview || (repo && repo !== modelBadge ? repo : "");
  const age = formatCompactAge(agent.lastActivityAt);
  const perms = agent.pendingPermissionCount ?? 0;

  return (
    <View style={[styles.rowOuter, isActive && styles.rowOuterActive]}>
      <PressHighlight
        onPress={handlePress}
        onLongPress={handleActionsPress}
        style={styles.rowMainPress}
        testID={`sidebar-recent-session-${agent.id}`}
      >
        <View style={[styles.dot, dotStyleFor(kind)]} />
        <View style={styles.rowCenter}>
          <Text style={[styles.rowTitle, isActive && styles.rowTitleActive]} numberOfLines={1}>
            {title}
          </Text>
          <View style={styles.metaLine}>
            {modelBadge ? (
              <Text
                style={[styles.modelChip, isActive && styles.modelChipActive]}
                numberOfLines={1}
              >
                {modelBadge}
              </Text>
            ) : null}
            {subtitleText ? (
              <Text style={styles.rowPreview} numberOfLines={1}>
                {subtitleText}
              </Text>
            ) : null}
          </View>
        </View>
        {perms > 0 ? (
          <View style={styles.permPill}>
            <Text style={styles.permPillText}>{perms}</Text>
          </View>
        ) : (
          <Text style={styles.rowAge}>{age}</Text>
        )}
      </PressHighlight>
      {canSplit ? (
        <PressHighlight
          onPress={handleSplitPress}
          style={styles.actionButton}
          accessibilityRole="button"
          accessibilityLabel={isSplitOpen ? "Close split conversation" : "Open side by side"}
          testID={`sidebar-split-session-${agent.id}`}
        >
          {isSplitOpen ? <ThemedSplitActive size={12} /> : <ThemedSplitMuted size={12} />}
        </PressHighlight>
      ) : null}
      <PressHighlight
        onPress={handlePinPress}
        style={styles.actionButton}
        accessibilityRole="button"
        accessibilityLabel={isPinned ? "Unpin conversation" : "Pin conversation"}
        testID={`sidebar-pin-session-${agent.id}`}
      >
        {isPinned ? <ThemedPinActive size={12} /> : <ThemedPinMuted size={12} />}
      </PressHighlight>
      <PressHighlight
        onPress={handleActionsPress}
        style={styles.actionButton}
        accessibilityRole="button"
        accessibilityLabel="Actions de session (renommer, archiver)"
        testID={`sidebar-actions-session-${agent.id}`}
      >
        <ThemedMoreMuted size={13} />
      </PressHighlight>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  section: {
    marginBottom: theme.spacing[1.5],
  },
  viewAllButton: {
    paddingHorizontal: theme.spacing[1.5],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.base,
  },
  viewAllText: {
    fontSize: 11,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.accent,
  },
  list: {
    gap: 2,
  },
  rowOuter: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: theme.borderRadius.md,
    borderLeftWidth: 2.5,
    borderLeftColor: "transparent",
  },
  rowOuterActive: {
    backgroundColor: theme.colors.surfaceSidebarSelected,
    borderLeftColor: theme.colors.accent,
  },
  rowMainPress: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[1],
    paddingVertical: 6,
    borderRadius: theme.borderRadius.md,
  },
  actionButton: {
    width: 24,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    marginRight: 1,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    flexShrink: 0,
  },
  dotOk: {
    backgroundColor: theme.colors.statusSuccess,
  },
  dotDanger: {
    backgroundColor: theme.colors.statusDanger,
  },
  dotAccent: {
    backgroundColor: theme.colors.accent,
  },
  dotWarn: {
    backgroundColor: theme.colors.statusWarning,
  },
  rowCenter: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  rowTitleActive: {
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.foreground,
  },
  metaLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minWidth: 0,
  },
  modelChip: {
    fontSize: 10,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foregroundMuted,
    flexShrink: 0,
  },
  modelChipActive: {
    color: theme.colors.accent,
  },
  rowPreview: {
    flex: 1,
    minWidth: 0,
    fontSize: 10.5,
    color: theme.colors.foregroundExtraMuted,
  },
  rowAge: {
    fontSize: 10.5,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foregroundExtraMuted,
    flexShrink: 0,
  },
  permPill: {
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.statusDangerTint,
    borderWidth: 1,
    borderColor: theme.colors.statusDanger,
    alignItems: "center",
    justifyContent: "center",
  },
  permPillText: {
    fontSize: 9.5,
    fontFamily: theme.fontFamily.mono,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.statusDanger,
  },
}));
