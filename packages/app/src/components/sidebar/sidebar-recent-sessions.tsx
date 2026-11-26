import { router, usePathname } from "expo-router";
import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SidebarGroupToggleRow } from "@/components/sidebar/sidebar-group-toggle-row";
import { SidebarSectionHeader } from "@/components/sidebar/sidebar-section-header";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useAggregatedAgents, type AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { buildHostAgentDetailRoute, buildInboxRoute } from "@/utils/host-routes";

const DEFAULT_VISIBLE_COUNT = 6;

type SessionDotKind = "permission" | "running" | "attention" | "idle";

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
}: {
  onSessionPress?: () => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const pathname = usePathname();
  const { agents } = useAggregatedAgents({ includeArchived: false });
  const collapsed = useSidebarCollapsedSectionsStore((state) => state.collapsedRecentSessions);
  const toggleCollapsed = useSidebarCollapsedSectionsStore(
    (state) => state.toggleRecentSessionsCollapsed,
  );
  const [expanded, setExpanded] = useState(false);

  const recentAgents = useMemo(() => {
    const active = agents.filter((agent) => agent.status !== "closed");
    const list = active.length > 0 ? [...active] : [...agents];
    list.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
    return list;
  }, [agents]);

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
      router.push(buildHostAgentDetailRoute(agent.serverId, agent.id, agent.workspaceId));
    },
    [onSessionPress],
  );

  if (recentAgents.length === 0) {
    return null;
  }

  const visibleAgents = expanded
    ? recentAgents.slice(0, 18)
    : recentAgents.slice(0, DEFAULT_VISIBLE_COUNT);
  const canToggleMore = recentAgents.length > DEFAULT_VISIBLE_COUNT;

  return (
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
              isActive={pathname.includes(agent.id)}
              onPress={handleOpenAgent}
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
  );
});

const RecentSessionRow = memo(function RecentSessionRow({
  agent,
  isActive,
  onPress,
}: {
  agent: AggregatedAgent;
  isActive: boolean;
  onPress: (agent: AggregatedAgent) => void;
}) {
  const handlePress = useCallback(() => {
    onPress(agent);
  }, [agent, onPress]);

  const kind = classifyDotKind(agent);
  const title = agent.title?.trim() || `Session ${agent.id.slice(0, 7)}`;
  const repo = repoNameFromCwd(agent.cwd);
  const age = formatCompactAge(agent.lastActivityAt);
  const perms = agent.pendingPermissionCount ?? 0;

  return (
    <PressHighlight
      onPress={handlePress}
      style={[styles.row, isActive && styles.rowActive]}
      testID={`sidebar-recent-session-${agent.id}`}
    >
      <View style={[styles.dot, dotStyleFor(kind)]} />
      <View style={styles.rowCenter}>
        <Text style={[styles.rowTitle, isActive && styles.rowTitleActive]} numberOfLines={1}>
          {title}
        </Text>
        {repo ? (
          <Text style={styles.rowRepo} numberOfLines={1}>
            {repo}
          </Text>
        ) : null}
      </View>
      {perms > 0 ? (
        <View style={styles.permPill}>
          <Text style={styles.permPillText}>{perms}</Text>
        </View>
      ) : (
        <Text style={styles.rowAge}>{age}</Text>
      )}
    </PressHighlight>
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
    gap: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 6,
    borderRadius: theme.borderRadius.md,
  },
  rowActive: {
    backgroundColor: theme.colors.surfaceSidebarSelected,
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
    gap: 1,
  },
  rowTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  rowTitleActive: {
    fontWeight: theme.fontWeight.semibold,
  },
  rowRepo: {
    fontSize: 10.5,
    fontFamily: theme.fontFamily.mono,
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
