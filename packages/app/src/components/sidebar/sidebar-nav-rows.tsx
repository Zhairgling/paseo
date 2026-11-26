import { router, usePathname } from "expo-router";
import { CalendarClock, Cpu, History, Inbox, Plus, Search } from "lucide-react-native";
import { memo, useCallback, useMemo, useRef, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { PluginSidebarItem } from "@/plugins/sidebar-items";
import { canCreateWorktreeForProjectKind } from "@/projects/host-projects";
import { useHostFeature } from "@/runtime/host-features";
import {
  builtinSidebarNavLabelKey,
  builtinSidebarNavShortcutAction,
  type BuiltinSidebarNavId,
} from "@/sidebar-nav/model";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import {
  buildInboxRoute,
  buildNewWorkspaceRoute,
  buildSchedulesRoute,
  buildSessionsRoute,
  buildTeamRoute,
} from "@/utils/host-routes";

interface SidebarNavRowProps {
  onBeforeNavigate?: () => void;
}

interface SidebarNavRowsProps extends SidebarNavRowProps {
  /** Style for the group wrapper, which the sidebar owns. */
  style?: StyleProp<ViewStyle>;
  /** Sits to the right of the first row, which shrinks to make room. */
  firstRowTrailing?: ReactNode;
}

/** The top-level items the user keeps visible, in display order. */
export function useVisibleSidebarNavItems() {
  const { items } = useSidebarNavItems("header");
  return useMemo(() => items.filter((item) => item.visible), [items]);
}

/**
 * Top-level sidebar navigation, ordered and filtered by the user's
 * `sidebarNavItems` preference. Renders nothing — not even the bordered group
 * wrapper — when every item is hidden and there is no `firstRowTrailing`.
 */
export function SidebarNavRows({ style, onBeforeNavigate, firstRowTrailing }: SidebarNavRowsProps) {
  const visibleItems = useVisibleSidebarNavItems();
  const groupRef = useRef<View | null>(null);

  if (visibleItems.length === 0 && !firstRowTrailing) return null;

  const [firstRow, ...restRows] = visibleItems.map((item) => {
    if (item.kind === "plugin") {
      return (
        <PluginSidebarItem
          key={item.key}
          group={item.group}
          section="header"
          fallbackAnchorRef={groupRef}
          onBeforeNavigate={onBeforeNavigate}
        />
      );
    }
    const Row = BUILTIN_ROWS[item.id];
    return <Row key={item.key} onBeforeNavigate={onBeforeNavigate} />;
  });

  return (
    <View ref={groupRef} collapsable={false} style={style}>
      {firstRowTrailing ? (
        <View style={styles.firstRow}>
          <View style={styles.firstRowItem}>{firstRow}</View>
          {firstRowTrailing}
        </View>
      ) : (
        firstRow
      )}
      {restRows}
    </View>
  );
}

const SidebarNewWorkspaceRow = memo(function SidebarNewWorkspaceRow({
  onBeforeNavigate,
}: SidebarNavRowProps) {
  const { t } = useTranslation();
  const shortcutKeys = useShortcutKeys(builtinSidebarNavShortcutAction("new-workspace"));
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const activeWorkspaceServerId = activeWorkspaceSelection?.serverId ?? null;
  const activeWorkspaceId = activeWorkspaceSelection?.workspaceId ?? null;
  const activeWorkspace = useWorkspace(activeWorkspaceServerId, activeWorkspaceId);
  const supportsWorkspaceMultiplicity = useHostFeature(
    activeWorkspaceServerId,
    "workspaceMultiplicity",
  );
  const canUseActiveWorkspaceContext = Boolean(
    activeWorkspace &&
    (supportsWorkspaceMultiplicity || canCreateWorktreeForProjectKind(activeWorkspace.projectKind)),
  );

  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(
      activeWorkspaceServerId
        ? buildNewWorkspaceRoute(
            activeWorkspace && canUseActiveWorkspaceContext
              ? {
                  serverId: activeWorkspaceServerId,
                  sourceDirectory: activeWorkspace.projectRootPath,
                  projectId: activeWorkspace.projectId,
                }
              : { serverId: activeWorkspaceServerId },
          )
        : buildNewWorkspaceRoute(),
    );
  }, [activeWorkspace, activeWorkspaceServerId, canUseActiveWorkspaceContext, onBeforeNavigate]);

  return (
    <SidebarHeaderRow
      icon={Plus}
      label={t(builtinSidebarNavLabelKey("new-workspace"))}
      onPress={handlePress}
      testID="sidebar-global-new-workspace"
      variant="compact"
      shortcutKeys={shortcutKeys}
    />
  );
});

function SidebarHistoryRow({ onBeforeNavigate }: SidebarNavRowProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(buildSessionsRoute());
  }, [onBeforeNavigate]);

  return (
    <SidebarHeaderRow
      icon={History}
      label={t(builtinSidebarNavLabelKey("history"))}
      onPress={handlePress}
      isActive={pathname.includes("/sessions")}
      testID="sidebar-sessions"
      variant="compact"
    />
  );
}

function SidebarSearchRow() {
  const { t } = useTranslation();
  const shortcutKeys = useShortcutKeys(builtinSidebarNavShortcutAction("search"));
  const setCommandCenterOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);
  const handlePress = useCallback(() => {
    setCommandCenterOpen(true);
  }, [setCommandCenterOpen]);

  return (
    <SidebarHeaderRow
      icon={Search}
      label={t(builtinSidebarNavLabelKey("search"))}
      onPress={handlePress}
      testID="sidebar-search"
      variant="compact"
      shortcutKeys={shortcutKeys}
    />
  );
}

function SidebarSchedulesRow({ onBeforeNavigate }: SidebarNavRowProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(buildSchedulesRoute());
  }, [onBeforeNavigate]);

  return (
    <SidebarHeaderRow
      icon={CalendarClock}
      label={t(builtinSidebarNavLabelKey("schedules"))}
      onPress={handlePress}
      isActive={pathname.includes("/schedules")}
      testID="sidebar-schedules"
      variant="compact"
    />
  );
}

function SidebarInboxRow({ onBeforeNavigate }: SidebarNavRowProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const { agents } = useAggregatedAgents({ includeArchived: false });
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(buildInboxRoute());
  }, [onBeforeNavigate]);

  const { permCount, runningCount } = useMemo(() => {
    let perms = 0;
    let running = 0;
    for (const agent of agents) {
      perms += agent.pendingPermissionCount ?? 0;
      if (agent.turn.phase === "open" || agent.status === "running") {
        running += 1;
      }
    }
    return { permCount: perms, runningCount: running };
  }, [agents]);

  const badge = useMemo(() => {
    if (permCount > 0) {
      return (
        <View style={styles.badgeDanger}>
          <Text style={styles.badgeDangerText}>{permCount}</Text>
        </View>
      );
    }
    if (runningCount > 0) {
      return (
        <View style={styles.badgeOk}>
          <Text style={styles.badgeOkText}>{runningCount}</Text>
        </View>
      );
    }
    return null;
  }, [permCount, runningCount]);

  return (
    <SidebarHeaderRow
      icon={Inbox}
      label={t(builtinSidebarNavLabelKey("inbox"))}
      onPress={handlePress}
      isActive={pathname === "/inbox"}
      testID="sidebar-inbox"
      variant="compact"
      trailing={badge}
    />
  );
}

function SidebarTeamRow({ onBeforeNavigate }: SidebarNavRowProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(buildTeamRoute());
  }, [onBeforeNavigate]);

  return (
    <SidebarHeaderRow
      icon={Cpu}
      label={t(builtinSidebarNavLabelKey("team"))}
      onPress={handlePress}
      isActive={pathname === "/team"}
      testID="sidebar-team"
      variant="compact"
    />
  );
}

const BUILTIN_ROWS: Record<BuiltinSidebarNavId, ComponentType<SidebarNavRowProps>> = {
  "new-workspace": SidebarNewWorkspaceRow,
  inbox: SidebarInboxRow,
  team: SidebarTeamRow,
  history: SidebarHistoryRow,
  search: SidebarSearchRow,
  schedules: SidebarSchedulesRow,
};

const styles = StyleSheet.create((theme) => ({
  firstRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  firstRowItem: {
    flex: 1,
    minWidth: 0,
  },
  badgeDanger: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.statusDangerTint,
    borderWidth: 1,
    borderColor: theme.colors.statusDanger,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeDangerText: {
    fontSize: 10,
    fontFamily: theme.fontFamily.mono,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.statusDanger,
  },
  badgeOk: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.statusSuccessTint,
    borderWidth: 1,
    borderColor: theme.colors.statusSuccess,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeOkText: {
    fontSize: 10,
    fontFamily: theme.fontFamily.mono,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.statusSuccess,
  },
}));
