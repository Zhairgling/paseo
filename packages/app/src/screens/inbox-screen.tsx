import { router } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { Plus, RefreshCw } from "lucide-react-native";
import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { FlatList, Text, View, type ListRenderItemInfo } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { PressHighlight } from "@/components/ui/press-highlight";
import { SearchField } from "@/components/ui/search-field";
import { useAggregatedAgents, type AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";
import { navigateToAgent } from "@/utils/navigate-to-agent";

type InboxFilter = "active" | "running" | "attention" | "all";
type SessionStateKind = "permission" | "running" | "attention" | "idle" | "archived";

const ThemedRefreshIcon = withUnistyles(RefreshCw, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedPlusIcon = withUnistyles(Plus, (theme) => ({
  color: theme.colors.accentForeground,
}));
const ThemedSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

function repoNameFromCwd(cwd: string): string {
  const cleaned = cwd.replace(/[\\/]+$/, "");
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? (cwd || "Workspace");
}

function formatRelativeTime(date: Date): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSec < 60) return "à l'instant";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} j`;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

function isAgentRunning(agent: AggregatedAgent): boolean {
  return agent.turn.phase === "open" || agent.status === "running";
}

function isAgentActive(agent: AggregatedAgent): boolean {
  if (agent.archivedAt) return false;
  return agent.status !== "closed";
}

function needsAgentAttention(agent: AggregatedAgent): boolean {
  return (agent.pendingPermissionCount ?? 0) > 0 || Boolean(agent.requiresAttention);
}

function classifySessionState(agent: AggregatedAgent): SessionStateKind {
  if ((agent.pendingPermissionCount ?? 0) > 0) return "permission";
  if (isAgentRunning(agent)) return "running";
  if (agent.requiresAttention) return "attention";
  if (agent.archivedAt || agent.status === "closed") return "archived";
  return "idle";
}

function stateBadgeLabel(agent: AggregatedAgent, kind: SessionStateKind): string {
  if (kind === "permission") {
    return `${agent.pendingPermissionCount ?? 0} perm.`;
  }
  if (kind === "running") return "En cours";
  if (kind === "attention") return "Attention";
  if (kind === "archived") return agent.archivedAt ? "Archivée" : "Fermée";
  return "Idle";
}

function matchesSearchQuery(agent: AggregatedAgent, query: string): boolean {
  if (!query) return true;
  const repo = repoNameFromCwd(agent.cwd);
  const haystack =
    `${agent.title ?? ""} ${repo} ${agent.cwd} ${agent.provider} ${agent.id} ${agent.serverLabel}`.toLowerCase();
  return haystack.includes(query);
}

function matchesInboxFilter(agent: AggregatedAgent, filter: InboxFilter): boolean {
  if (filter === "active") return isAgentActive(agent);
  if (filter === "running") return !agent.archivedAt && isAgentRunning(agent);
  if (filter === "attention") return !agent.archivedAt && needsAgentAttention(agent);
  return true;
}

function dotStyleForKind(kind: SessionStateKind) {
  if (kind === "permission") return styles.dotDanger;
  if (kind === "running") return styles.dotOk;
  if (kind === "attention") return styles.dotAccent;
  if (kind === "idle") return styles.dotWarn;
  return styles.dotMuted;
}

function badgeStyleForKind(kind: SessionStateKind) {
  if (kind === "permission") return styles.badgeDanger;
  if (kind === "running") return styles.badgeOk;
  if (kind === "attention") return styles.badgeAccent;
  return styles.badgeNeutral;
}

function badgeTextStyleForKind(kind: SessionStateKind) {
  if (kind === "permission") return styles.badgeDangerText;
  if (kind === "running") return styles.badgeOkText;
  if (kind === "attention") return styles.badgeAccentText;
  return styles.badgeNeutralText;
}

function keyExtractor(agent: AggregatedAgent): string {
  return `${agent.serverId}:${agent.id}`;
}

export function InboxScreen(): ReactElement {
  const isFocused = useIsFocused();
  if (!isFocused) {
    return <View style={styles.container} />;
  }
  return <InboxScreenContent />;
}

function InboxScreenContent(): ReactElement {
  const { agents, isInitialLoad, isRevalidating, refreshAll } = useAggregatedAgents({
    includeArchived: true,
  });
  const [filter, setFilter] = useState<InboxFilter>("active");
  const [search, setSearch] = useState("");
  const normalizedQuery = search.trim().toLowerCase();

  // Tri chronologique pur par dernière activité décroissante (façon Claude Code Web / Linear Inbox)
  const sortedChronological = useMemo(() => {
    const copy = [...agents];
    copy.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
    return copy;
  }, [agents]);

  const counts = useMemo(() => {
    let active = 0;
    let running = 0;
    let attention = 0;
    for (const agent of sortedChronological) {
      if (isAgentActive(agent)) active += 1;
      if (!agent.archivedAt && isAgentRunning(agent)) running += 1;
      if (!agent.archivedAt && needsAgentAttention(agent)) attention += 1;
    }
    return { active, running, attention, all: sortedChronological.length };
  }, [sortedChronological]);

  const filteredAgents = useMemo(
    () =>
      sortedChronological.filter(
        (agent) => matchesInboxFilter(agent, filter) && matchesSearchQuery(agent, normalizedQuery),
      ),
    [filter, normalizedQuery, sortedChronological],
  );

  const handleNewSession = useCallback(() => {
    router.push(buildNewWorkspaceRoute());
  }, []);

  const handleOpenAgent = useCallback((agent: AggregatedAgent) => {
    navigateToAgent({
      serverId: agent.serverId,
      agentId: agent.id,
      workspaceId: agent.workspaceId,
      pin: true,
    });
  }, []);

  const handleShowAll = useCallback(() => {
    setFilter("all");
    setSearch("");
  }, []);

  const headerRight = useMemo(
    () => (
      <View style={styles.headerActions}>
        <Button variant="ghost" size="sm" onPress={refreshAll} testID="inbox-refresh">
          <ThemedRefreshIcon size={14} />
        </Button>
        <Button variant="default" size="sm" onPress={handleNewSession} testID="inbox-new-session">
          <View style={styles.newBtnInner}>
            <ThemedPlusIcon size={14} />
            <Text style={styles.newBtnText}>Nouvelle</Text>
          </View>
        </Button>
      </View>
    ),
    [handleNewSession, refreshAll],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<AggregatedAgent>) => (
      <InboxSessionRow agent={item} onOpen={handleOpenAgent} />
    ),
    [handleOpenAgent],
  );

  return (
    <View style={styles.container}>
      <MenuHeader title="Toutes les sessions" rightContent={headerRight} />

      <View style={styles.controlsBar}>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder="Rechercher une session, un repo, un modèle..."
          clearAccessibilityLabel="Effacer la recherche"
          fullWidth
          testID="inbox-search-input"
          clearTestID="inbox-search-clear"
        />

        <View style={styles.filterRow}>
          <FilterPill
            id="active"
            label={`Actives (${counts.active})`}
            active={filter === "active"}
            onSelect={setFilter}
          />
          <FilterPill
            id="running"
            label={`En cours (${counts.running})`}
            active={filter === "running"}
            onSelect={setFilter}
          />
          <FilterPill
            id="attention"
            label={`Permissions (${counts.attention})`}
            active={filter === "attention"}
            highlight={counts.attention > 0}
            onSelect={setFilter}
          />
          <FilterPill
            id="all"
            label={`Tout (${counts.all})`}
            active={filter === "all"}
            onSelect={setFilter}
          />
        </View>
      </View>

      {isInitialLoad ? (
        <View style={styles.centerBox}>
          <ThemedSpinner size="large" />
        </View>
      ) : null}

      {!isInitialLoad && filteredAgents.length === 0 ? (
        <View style={styles.centerBox}>
          <Text style={styles.emptyTitle}>Aucune session trouvée</Text>
          <Text style={styles.emptyHint}>
            {filter === "active"
              ? "Aucune session active pour le moment. Essayez le filtre « Tout » pour voir l'historique."
              : "Aucune session ne correspond à ce filtre."}
          </Text>
          {filter !== "all" || normalizedQuery.length > 0 ? (
            <Button variant="secondary" size="sm" onPress={handleShowAll}>
              Afficher toutes les sessions
            </Button>
          ) : null}
        </View>
      ) : null}

      {!isInitialLoad && filteredAgents.length > 0 ? (
        <FlatList
          data={filteredAgents}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          refreshing={isRevalidating}
          onRefresh={refreshAll}
          contentContainerStyle={styles.listContent}
          testID="inbox-session-list"
        />
      ) : null}
    </View>
  );
}

const FilterPill = memo(function FilterPill({
  id,
  label,
  active,
  highlight = false,
  onSelect,
}: {
  id: InboxFilter;
  label: string;
  active: boolean;
  highlight?: boolean;
  onSelect: (id: InboxFilter) => void;
}) {
  const handlePress = useCallback(() => {
    onSelect(id);
  }, [id, onSelect]);

  return (
    <PressHighlight
      onPress={handlePress}
      style={[styles.pill, highlight && !active && styles.pillAlert, active && styles.pillActive]}
      testID={`inbox-filter-${id}`}
    >
      <Text
        style={[
          styles.pillText,
          highlight && !active && styles.pillAlertText,
          active && styles.pillTextActive,
        ]}
      >
        {label}
      </Text>
    </PressHighlight>
  );
});

const InboxSessionRow = memo(function InboxSessionRow({
  agent,
  onOpen,
}: {
  agent: AggregatedAgent;
  onOpen: (agent: AggregatedAgent) => void;
}) {
  const handlePress = useCallback(() => {
    onOpen(agent);
  }, [agent, onOpen]);

  const kind = classifySessionState(agent);
  const repo = repoNameFromCwd(agent.cwd);
  const title = agent.title?.trim() || `Session ${agent.id.slice(0, 7)}`;
  const relTime = formatRelativeTime(agent.lastActivityAt);
  const stateLabel = stateBadgeLabel(agent, kind);

  return (
    <PressHighlight
      onPress={handlePress}
      style={[styles.rowCard, kind === "permission" && styles.rowCardAlert]}
      testID={`inbox-session-row-${agent.id}`}
    >
      <View style={styles.rowTop}>
        <View style={styles.rowTitleWrap}>
          <View style={[styles.dot, dotStyleForKind(kind)]} />
          <Text style={styles.rowTitle} numberOfLines={2}>
            {title}
          </Text>
        </View>
        <Text style={styles.timeText}>{relTime}</Text>
      </View>

      <View style={styles.rowMeta}>
        <View style={styles.repoBadge}>
          <Text style={styles.repoBadgeText} numberOfLines={1}>
            {repo}
          </Text>
        </View>
        <View style={[styles.stateBadge, badgeStyleForKind(kind)]}>
          <Text style={[styles.stateBadgeText, badgeTextStyleForKind(kind)]}>{stateLabel}</Text>
        </View>
        <Text style={styles.providerText} numberOfLines={1}>
          {agent.provider} · {agent.id.slice(0, 7)}
        </Text>
      </View>
    </PressHighlight>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  newBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  newBtnText: {
    color: theme.colors.accentForeground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  controlsBar: {
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1.5],
  },
  pill: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 6,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  pillAlert: {
    borderColor: theme.colors.statusDanger,
    backgroundColor: theme.colors.statusDangerTint,
  },
  pillActive: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  pillText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  pillAlertText: {
    color: theme.colors.statusDanger,
    fontWeight: theme.fontWeight.semibold,
  },
  pillTextActive: {
    color: theme.colors.accentForeground,
    fontWeight: theme.fontWeight.semibold,
  },
  listContent: {
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[2],
    maxWidth: 960,
    width: "100%",
    alignSelf: "center",
  },
  rowCard: {
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[3.5],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[2],
  },
  rowCardAlert: {
    borderColor: theme.colors.statusDanger,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  rowTitleWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  rowTitle: {
    flex: 1,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    lineHeight: 20,
  },
  timeText: {
    fontSize: 11,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foregroundMuted,
    paddingTop: 2,
  },
  rowMeta: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[1.5],
    paddingLeft: 16,
  },
  repoBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    maxWidth: 180,
  },
  repoBadgeText: {
    fontSize: 11,
    fontFamily: theme.fontFamily.mono,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.accentBright,
  },
  stateBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.base,
    borderWidth: 1,
  },
  badgeOk: {
    backgroundColor: theme.colors.statusSuccessTint,
    borderColor: theme.colors.statusSuccess,
  },
  badgeDanger: {
    backgroundColor: theme.colors.statusDangerTint,
    borderColor: theme.colors.statusDanger,
  },
  badgeAccent: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  badgeNeutral: {
    backgroundColor: theme.colors.surface0,
    borderColor: theme.colors.border,
  },
  stateBadgeText: {
    fontSize: 10.5,
    fontFamily: theme.fontFamily.mono,
    fontWeight: theme.fontWeight.semibold,
  },
  badgeOkText: {
    color: theme.colors.statusSuccess,
  },
  badgeDangerText: {
    color: theme.colors.statusDanger,
  },
  badgeAccentText: {
    color: theme.colors.accentForeground,
  },
  badgeNeutralText: {
    color: theme.colors.foregroundMuted,
  },
  providerText: {
    fontSize: 11,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foregroundExtraMuted,
    flexShrink: 1,
  },
  dot: {
    width: 8,
    height: 8,
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
  dotMuted: {
    backgroundColor: theme.colors.foregroundExtraMuted,
  },
  centerBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
    gap: theme.spacing[3],
  },
  emptyTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  emptyHint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    maxWidth: 340,
  },
}));
