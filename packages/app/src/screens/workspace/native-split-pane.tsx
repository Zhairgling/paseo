import { X } from "lucide-react-native";
import { memo, useCallback, useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { PressHighlight } from "@/components/ui/press-highlight";
import { HEADER_INNER_HEIGHT } from "@/constants/layout";
import {
  buildWorkspacePaneContentModel,
  WorkspacePaneContent,
} from "@/screens/workspace/workspace-pane-content";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { useSessionStore } from "@/stores/session-store";
import type { SplitSessionTarget } from "@/stores/split-session-store";
import type { Theme } from "@/styles/theme";
import { formatSessionModelBadge } from "@/utils/session-display";

const ThemedCloseIcon = withUnistyles(X, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));

const noop = () => undefined;

export const NativeSplitSessionPane = memo(function NativeSplitSessionPane({
  target,
  isWorkspaceFocused,
  onClose,
}: {
  target: SplitSessionTarget;
  isWorkspaceFocused: boolean;
  onClose: () => void;
}): ReactElement {
  const agent = useSessionStore(
    (state) => state.sessions[target.serverId]?.agents.get(target.agentId) ?? null,
  );

  const tabDescriptor = useMemo<WorkspaceTabDescriptor>(
    () => ({
      tabId: `split-agent:${target.agentId}`,
      key: `split-agent:${target.serverId}:${target.agentId}`,
      kind: "agent",
      target: { kind: "agent", agentId: target.agentId },
      state: undefined,
    }),
    [target.agentId, target.serverId],
  );

  const contentModel = useMemo(
    () =>
      buildWorkspacePaneContentModel({
        tab: tabDescriptor,
        normalizedServerId: target.serverId,
        normalizedWorkspaceId: target.workspaceId,
        host: "main",
        onOpenTab: noop,
        onOpenPreferredTarget: noop,
        onCloseCurrentTab: onClose,
        onRetargetCurrentTab: noop,
        onSetCurrentTabState: noop,
        onOpenWorkspaceFile: noop,
        onOpenImportSheet: noop,
      }),
    [onClose, tabDescriptor, target.serverId, target.workspaceId],
  );

  const title = agent?.title?.trim() || `Session ${target.agentId.slice(0, 7)}`;
  const modelBadge = formatSessionModelBadge(
    agent?.provider,
    agent?.runtimeInfo?.model ?? agent?.model,
  );

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <View style={styles.pane} testID={`native-split-pane-${target.agentId}`}>
      <View style={styles.header}>
        <View style={styles.headerTitleGroup}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
          {modelBadge ? (
            <Text style={styles.headerBadge} numberOfLines={1}>
              {modelBadge}
            </Text>
          ) : null}
        </View>
        <PressHighlight
          onPress={handleClose}
          style={styles.closeButton}
          accessibilityRole="button"
          accessibilityLabel="Close split conversation"
          testID="native-split-pane-close"
        >
          <ThemedCloseIcon size={16} />
        </PressHighlight>
      </View>
      <View style={styles.body}>
        <WorkspacePaneContent
          content={contentModel}
          isWorkspaceFocused={isWorkspaceFocused}
          isPaneFocused={isWorkspaceFocused}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  pane: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  header: {
    height: HEADER_INNER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
    gap: theme.spacing[2],
  },
  headerTitleGroup: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  headerTitle: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  headerBadge: {
    fontSize: 11,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.accent,
    flexShrink: 0,
  },
  closeButton: {
    width: 30,
    height: 30,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
}));
