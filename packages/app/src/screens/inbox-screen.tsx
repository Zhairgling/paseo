import { router } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { Archive, Plus, RefreshCw } from "lucide-react-native";
import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { FlatList, ScrollView, Text, View, type ListRenderItemInfo } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { useSessionActionsModal } from "@/components/sidebar/session-actions-modal";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { PressHighlight } from "@/components/ui/press-highlight";
import { SearchField } from "@/components/ui/search-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { useAggregatedAgents, type AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { buildSessionTagKey, useSessionTagsStore } from "@/stores/session-tags-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { formatSessionModelBadge } from "@/utils/session-display";

type InboxFilter = "active" | "mine" | "workers" | "running" | "colab" | "attention" | "all";
type SessionStateKind = "permission" | "running" | "attention" | "idle" | "archived";

const ThemedRefreshIcon = withUnistyles(RefreshCw, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedPlusIcon = withUnistyles(Plus, (theme) => ({
  color: theme.colors.accentForeground,
}));
const ThemedArchiveIcon = withUnistyles(Archive, (theme) => ({
  color: theme.colors.statusWarning,
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

function isWorkerAgent(agent: AggregatedAgent): boolean {
  return Boolean(agent.parentAgentId || agent.labels?.["paseo.parent-agent-id"]);
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

function isColabAgent(agent: AggregatedAgent): boolean {
  const model = (agent.model ?? "").toLowerCase();
  if (model.startsWith("colab/") || model.includes("colab/")) return true;
  return (agent.title ?? "").toLowerCase().includes("colab");
}

function matchesSearchQuery(agent: AggregatedAgent, query: string, tag: string | null): boolean {
  if (!query) return true;
  const repo = repoNameFromCwd(agent.cwd);
  const modelBadge = formatSessionModelBadge(agent.provider, agent.model);
  const haystack =
    `${agent.title ?? ""} ${repo} ${agent.cwd} ${agent.provider} ${agent.model ?? ""} ${modelBadge} ${tag ?? ""} ${agent.id} ${agent.serverLabel}`.toLowerCase();
  return haystack.includes(query);
}

function matchesInboxFilter(agent: AggregatedAgent, filter: InboxFilter): boolean {
  if (filter === "active") return isAgentActive(agent);
  if (filter === "mine") return !agent.archivedAt && !isWorkerAgent(agent);
  if (filter === "workers") return !agent.archivedAt && isWorkerAgent(agent);
  if (filter === "running") return !agent.archivedAt && isAgentRunning(agent);
  if (filter === "colab") return !agent.archivedAt && isColabAgent(agent);
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
  const isCompact = useIsCompactFormFactor();
  const toast = useToast();
  const { archiveAgent } = useArchiveAgent();
  const { agents, isInitialLoad, isRevalidating, refreshAll } = useAggregatedAgents({
    includeArchived: true,
  });
  const tagsByKey = useSessionTagsStore((state) => state.tagsByKey);

  const [filter, setFilter] = useState<InboxFilter>("active");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [archivingWorkers, setArchivingWorkers] = useState(false);
  const normalizedQuery = search.trim().toLowerCase();

  const sortedChronological = useMemo(() => {
    const copy = [...agents];
    copy.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
    return copy;
  }, [agents]);

  const { counts, archivableWorkers, activeTags } = useMemo(() => {
    let active = 0;
    let mine = 0;
    let workers = 0;
    let running = 0;
    let colab = 0;
    let attention = 0;
    const doneWorkers: AggregatedAgent[] = [];
    const usedTags = new Set<string>();

    for (const agent of sortedChronological) {
      const tag = tagsByKey[buildSessionTagKey(agent.serverId, agent.id)];
      if (tag && !agent.archivedAt) usedTags.add(tag);

      if (isAgentActive(agent)) active += 1;
      if (!agent.archivedAt) {
        if (isWorkerAgent(agent)) {
          workers += 1;
          if (!isAgentRunning(agent)) doneWorkers.push(agent);
        } else {
          mine += 1;
        }
        if (isAgentRunning(agent)) running += 1;
        if (isColabAgent(agent)) colab += 1;
        if (needsAgentAttention(agent)) attention += 1;
      }
    }
    return {
      counts: { active, mine, workers, running, colab, attention, all: sortedChronological.length },
      archivableWorkers: doneWorkers,
      activeTags: [...usedTags].sort(),
    };
  }, [sortedChronological, tagsByKey]);

  const filteredAgents = useMemo(
    () =>
      sortedChronological.filter((agent) => {
        const tag = tagsByKey[buildSessionTagKey(agent.serverId, agent.id)] ?? null;
        if (selectedTag && tag !== selectedTag) return false;
        return matchesInboxFilter(agent, filter) && matchesSearchQuery(agent, normalizedQuery, tag);
      }),
    [filter, normalizedQuery, selectedTag, sortedChronological, tagsByKey],
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
      asTab: true,
    });
  }, []);

  const handleShowAll = useCallback(() => {
    setFilter("all");
    setSelectedTag(null);
    setSearch("");
  }, []);

  const handleClearTag = useCallback(() => {
    setSelectedTag(null);
  }, []);

  const handleArchiveWorkersPress = useCallback(() => {
    if (archivableWorkers.length === 0 || archivingWorkers) return;
    void (async () => {
      const confirmed = await confirmDialog({
        title: `Archiver ${archivableWorkers.length} worker${archivableWorkers.length > 1 ? "s" : ""} ?`,
        message: "Seuls les sous-agents terminés (idle/fermés) seront archivés.",
        confirmLabel: "Archiver",
        cancelLabel: "Annuler",
        destructive: true,
      });
      if (!confirmed) return;
      setArchivingWorkers(true);
      let okCount = 0;
      await Promise.all(
        archivableWorkers.map(async (w) => {
          try {
            await archiveAgent({ serverId: w.serverId, agentId: w.id });
            okCount += 1;
          } catch {
            // Ignorer un échec unitaire
          }
        }),
      );
      setArchivingWorkers(false);
      toast.show(`${okCount} worker${okCount > 1 ? "s" : ""} archivé${okCount > 1 ? "s" : ""}`, {
        variant: "success",
      });
    })();
  }, [archivableWorkers, archiveAgent, archivingWorkers, toast]);

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

  const sessionActions = useSessionActionsModal({ canSplit: true });

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<AggregatedAgent>) => (
      <InboxSessionRow
        agent={item}
        tag={tagsByKey[buildSessionTagKey(item.serverId, item.id)] ?? null}
        onOpen={handleOpenAgent}
        onLongPress={sessionActions.openActions}
      />
    ),
    [handleOpenAgent, sessionActions.openActions, tagsByKey],
  );

  return (
    <View style={styles.container}>
      <MenuHeader
        title={isCompact ? "Sessions" : "Toutes les sessions"}
        rightContent={headerRight}
      />

      <View style={styles.controlsBar}>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder="Rechercher une session, un repo, un tag…"
          clearAccessibilityLabel="Effacer la recherche"
          fullWidth
          testID="inbox-search-input"
          clearTestID="inbox-search-clear"
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          <FilterPill
            id="active"
            label={`Actives (${counts.active})`}
            active={filter === "active"}
            onSelect={setFilter}
          />
          <FilterPill
            id="mine"
            label={`Mes chats (${counts.mine})`}
            active={filter === "mine"}
            onSelect={setFilter}
          />
          <FilterPill
            id="workers"
            label={`Workers (${counts.workers})`}
            active={filter === "workers"}
            onSelect={setFilter}
          />
          <FilterPill
            id="running"
            label={`En cours (${counts.running})`}
            active={filter === "running"}
            onSelect={setFilter}
          />
          {counts.colab > 0 ? (
            <FilterPill
              id="colab"
              label={`Colab (${counts.colab})`}
              active={filter === "colab"}
              onSelect={setFilter}
            />
          ) : null}
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
        </ScrollView>

        {activeTags.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            <TagFilterPill
              label="Tous les tags"
              active={selectedTag === null}
              onPress={handleClearTag}
            />
            {activeTags.map((tag) => (
              <TagFilterPill
                key={tag}
                label={`# ${tag}`}
                active={selectedTag === tag}
                value={tag}
                onSelectTag={setSelectedTag}
              />
            ))}
          </ScrollView>
        ) : null}

        {filter === "workers" && archivableWorkers.length > 0 ? (
          <PressHighlight
            onPress={handleArchiveWorkersPress}
            style={styles.bulkArchiveBtn}
            testID="inbox-archive-workers"
          >
            <ThemedArchiveIcon size={14} />
            <Text style={styles.bulkArchiveText}>
              {archivingWorkers
                ? "Archivage en cours…"
                : `Archiver les workers terminés (${archivableWorkers.length})`}
            </Text>
          </PressHighlight>
        ) : null}
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
          {filter !== "all" || normalizedQuery.length > 0 || selectedTag !== null ? (
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

      {sessionActions.modal}
    </View>
  );
}

const TagFilterPill = memo(function TagFilterPill({
  label,
  value,
  active,
  onPress,
  onSelectTag,
}: {
  label: string;
  value?: string;
  active: boolean;
  onPress?: () => void;
  onSelectTag?: (tag: string) => void;
}) {
  const handlePress = useCallback(() => {
    if (onPress) onPress();
    else if (value && onSelectTag) onSelectTag(value);
  }, [onPress, onSelectTag, value]);

  return (
    <PressHighlight onPress={handlePress} style={[styles.tagPill, active && styles.pillActive]}>
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
    </PressHighlight>
  );
});

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
  tag,
  onOpen,
  onLongPress,
}: {
  agent: AggregatedAgent;
  tag: string | null;
  onOpen: (agent: AggregatedAgent) => void;
  onLongPress: (agent: AggregatedAgent) => void;
}) {
  const handlePress = useCallback(() => {
    onOpen(agent);
  }, [agent, onOpen]);

  const handleLongPress = useCallback(() => {
    onLongPress(agent);
  }, [agent, onLongPress]);

  const kind = classifySessionState(agent);
  const repo = repoNameFromCwd(agent.cwd);
  const title = agent.title?.trim() || `Session ${agent.id.slice(0, 7)}`;
  const relTime = formatRelativeTime(agent.lastActivityAt);
  const stateLabel = stateBadgeLabel(agent, kind);
  const modelBadge = formatSessionModelBadge(agent.provider, agent.model);
  const colab = isColabAgent(agent);
  const worker = isWorkerAgent(agent);

  return (
    <PressHighlight
      onPress={handlePress}
      onLongPress={handleLongPress}
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
        {tag ? (
          <View style={styles.tagBadge}>
            <Text style={styles.tagBadgeText} numberOfLines={1}>
              {tag}
            </Text>
          </View>
        ) : null}
        {worker ? (
          <View style={styles.badgeNeutral}>
            <Text style={styles.workerBadgeText}>Worker</Text>
          </View>
        ) : null}
        {modelBadge ? (
          <View style={[styles.stateBadge, colab ? styles.badgeAccent : styles.badgeNeutral]}>
            <Text
              style={[
                styles.stateBadgeText,
                colab ? styles.badgeAccentText : styles.badgeNeutralText,
              ]}
              numberOfLines={1}
            >
              {modelBadge}
            </Text>
          </View>
        ) : null}
        <View style={[styles.stateBadge, badgeStyleForKind(kind)]}>
          <Text style={[styles.stateBadgeText, badgeTextStyleForKind(kind)]}>{stateLabel}</Text>
        </View>
        <View style={styles.repoBadge}>
          <Text style={styles.repoBadgeText} numberOfLines={1}>
            {repo}
          </Text>
        </View>
        <Text style={styles.providerText} numberOfLines={1}>
          {agent.id.slice(0, 7)}
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
    gap: theme.spacing[2],
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
    paddingTop: theme.spacing[3],
    paddingBottom: 10,
    gap: 10,
    backgroundColor: theme.colors.surface1,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingRight: theme.spacing[2],
  },
  pill: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 6,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  tagPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
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
  bulkArchiveBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 6,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.statusWarning,
    backgroundColor: theme.colors.statusWarningTint,
  },
  bulkArchiveText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.statusWarning,
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
  tagBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
  tagBadgeText: {
    fontSize: 10.5,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.accentForeground,
  },
  workerBadgeText: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    fontSize: 10,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foregroundExtraMuted,
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
