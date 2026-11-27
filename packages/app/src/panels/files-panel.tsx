import { AppearanceText as Text } from "@/appearance/text";
import { ScrollView } from "@/components/ui/scroll-view";
import { FileExplorerPane } from "@/components/file-explorer-pane";
import { MaterialFileIcon } from "@/components/material-file-icon";
import { PressHighlight } from "@/components/ui/press-highlight";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { useAddFileToChat } from "@/panels/use-add-file-to-chat";
import { useOpenedFilesStore, type OpenedFileEntry } from "@/stores/opened-files-store";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import type { Theme } from "@/styles/theme";
import { Files, FolderTree, Plus, Trash2, X } from "lucide-react-native";
import { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";

const ThemedFiles = withUnistyles(Files);
const ThemedFolderTree = withUnistyles(FolderTree, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedTrash = withUnistyles(Trash2, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedClose = withUnistyles(X, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedPlus = withUnistyles(Plus, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));

const filesPanelPresentation = {
  label: (t) => t("panels.files.label"),
  subtitle: (t) => t("panels.files.subtitle"),
  tooltip: (t) => t("panels.files.tooltip"),
  icon: ThemedFiles,
} satisfies PanelPresentation;

type FilesPanelMode = "opened" | "tree";

function splitFilePath(fullPath: string): { fileName: string; directory: string } {
  const parts = fullPath.split("/").filter(Boolean);
  const fileName = parts[parts.length - 1] ?? fullPath;
  if (parts.length <= 1) {
    return { fileName, directory: "" };
  }
  const parentParts = parts.slice(-3, -1);
  return { fileName, directory: parentParts.join("/") };
}

const OpenedFileRow = memo(function OpenedFileRow({
  entry,
  canAddToChat,
  onOpen,
  onAddToChat,
  onRemove,
}: {
  entry: OpenedFileEntry;
  canAddToChat: boolean;
  onOpen: (entry: OpenedFileEntry) => void;
  onAddToChat: (path: string) => void;
  onRemove: (key: string) => void;
}) {
  const { fileName, directory } = splitFilePath(entry.path);
  const lineBadge = typeof entry.lineStart === "number" ? `L${entry.lineStart}` : null;

  const handlePress = useCallback(() => {
    onOpen(entry);
  }, [entry, onOpen]);

  const handleAdd = useCallback(() => {
    onAddToChat(entry.path);
  }, [entry.path, onAddToChat]);

  const handleRemove = useCallback(() => {
    onRemove(entry.key);
  }, [entry.key, onRemove]);

  return (
    <View style={styles.rowContainer}>
      <PressHighlight
        onPress={handlePress}
        style={styles.rowMain}
        accessibilityRole="button"
        testID={`opened-file-row-${fileName}`}
      >
        <MaterialFileIcon fileName={fileName} size={18} />
        <View style={styles.rowTextWrap}>
          <View style={styles.rowTitleLine}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {fileName}
            </Text>
            {lineBadge ? <Text style={styles.lineBadge}>{lineBadge}</Text> : null}
          </View>
          <Text style={styles.rowPath} numberOfLines={1}>
            {directory || entry.path}
          </Text>
        </View>
      </PressHighlight>
      {canAddToChat ? (
        <PressHighlight
          onPress={handleAdd}
          style={styles.iconAction}
          accessibilityRole="button"
          accessibilityLabel="Ajouter au chat"
        >
          <ThemedPlus size={14} />
        </PressHighlight>
      ) : null}
      <PressHighlight
        onPress={handleRemove}
        style={styles.iconAction}
        accessibilityRole="button"
        accessibilityLabel="Retirer de la liste"
      >
        <ThemedClose size={14} />
      </PressHighlight>
    </View>
  );
});

function FilesPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, target, openPreferredTarget, openTargetToSide } = usePaneContext();
  const workspaceRoot = useWorkspaceDirectory(serverId, workspaceId);
  const { addFile, canAddToChat } = useAddFileToChat({ serverId, workspaceId });
  const [mode, setMode] = useState<FilesPanelMode>("opened");

  const entries = useOpenedFilesStore((state) => state.entries);
  const removeOpenedFile = useOpenedFilesStore((state) => state.removeOpenedFile);
  const clearWorkspaceOpenedFiles = useOpenedFilesStore((state) => state.clearWorkspaceOpenedFiles);

  invariant(target.kind === "files", "FilesPanel requires files target");

  const workspaceEntries = useMemo(
    () => entries.filter((item) => item.serverId === serverId && item.workspaceId === workspaceId),
    [entries, serverId, workspaceId],
  );

  const onOpenFile = useCallback(
    (path: string) => openPreferredTarget({ kind: "file", path }, "explorerFiles"),
    [openPreferredTarget],
  );

  const onOpenEntry = useCallback(
    (entry: OpenedFileEntry) => {
      openPreferredTarget(
        {
          kind: "file",
          path: entry.path,
          lineStart: entry.lineStart,
          lineEnd: entry.lineEnd,
        },
        "explorerFiles",
      );
    },
    [openPreferredTarget],
  );

  const onOpenFileToSide = useCallback(
    (path: string) => openTargetToSide?.({ kind: "file", path }),
    [openTargetToSide],
  );

  const handleToggleMode = useCallback(() => {
    setMode((prev) => (prev === "opened" ? "tree" : "opened"));
  }, []);

  const handleClear = useCallback(() => {
    clearWorkspaceOpenedFiles(serverId, workspaceId);
  }, [clearWorkspaceOpenedFiles, serverId, workspaceId]);

  const renderBody = () => {
    if (mode === "tree") {
      if (!workspaceRoot) {
        return (
          <View style={styles.centerState}>
            <Text style={styles.emptyTitle}>{t("panels.file.directoryMissing")}</Text>
          </View>
        );
      }
      return (
        <FileExplorerPane
          serverId={serverId}
          workspaceId={workspaceId}
          workspaceRoot={workspaceRoot}
          onOpenFile={onOpenFile}
          onOpenFileToSide={openTargetToSide ? onOpenFileToSide : undefined}
          onAddToChat={canAddToChat ? addFile : undefined}
        />
      );
    }

    if (workspaceEntries.length === 0) {
      return (
        <View style={styles.centerState}>
          <Text style={styles.emptyTitle}>Aucun fichier ouvert</Text>
          <Text style={styles.emptySubtitle}>
            Clique sur un lien .md ou un fichier dans la conversation pour le lire ici tout en
            continuant à répondre.
          </Text>
        </View>
      );
    }

    return (
      <ScrollView style={styles.listScroll} contentContainerStyle={styles.listContent}>
        {workspaceEntries.map((entry) => (
          <OpenedFileRow
            key={entry.key}
            entry={entry}
            canAddToChat={canAddToChat}
            onOpen={onOpenEntry}
            onAddToChat={addFile}
            onRemove={removeOpenedFile}
          />
        ))}
      </ScrollView>
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <Text style={styles.toolbarTitle}>
          {mode === "opened" ? `Fichiers ouverts (${workspaceEntries.length})` : "Arborescence"}
        </Text>
        <View style={styles.toolbarActions}>
          {mode === "opened" && workspaceEntries.length > 0 ? (
            <PressHighlight
              onPress={handleClear}
              style={styles.toolbarButton}
              accessibilityRole="button"
              accessibilityLabel="Vider les fichiers ouverts"
              testID="opened-files-clear"
            >
              <ThemedTrash size={14} />
            </PressHighlight>
          ) : null}
          <PressHighlight
            onPress={handleToggleMode}
            style={[styles.modePill, mode === "tree" && styles.modePillActive]}
            accessibilityRole="button"
            testID="files-panel-mode-toggle"
          >
            <ThemedFolderTree size={13} />
            <Text style={styles.modePillText}>{mode === "opened" ? "Dossier" : "Ouverts"}</Text>
          </PressHighlight>
        </View>
      </View>

      {renderBody()}
    </View>
  );
}

export const filesPanelRegistration = definePanel("files", {
  component: FilesPanel,
  presentation: filesPanelPresentation,
});

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    minHeight: 0,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.surface2,
    gap: theme.spacing[2],
  },
  toolbarTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  toolbarActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  toolbarButton: {
    padding: theme.spacing[1.5],
    borderRadius: theme.borderRadius.md,
  },
  modePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.surface2,
    backgroundColor: theme.colors.surface1,
  },
  modePillActive: {
    borderColor: theme.colors.accent,
  },
  modePillText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  listScroll: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    padding: theme.spacing[2],
    gap: theme.spacing[1],
  },
  rowContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.surface2,
    backgroundColor: theme.colors.surface1,
    paddingRight: theme.spacing[1],
  },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    minWidth: 0,
  },
  rowTextWrap: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  rowTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
    flexShrink: 1,
  },
  lineBadge: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.accent,
    fontWeight: theme.fontWeight.semibold,
  },
  rowPath: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  iconAction: {
    padding: theme.spacing[1.5],
    borderRadius: theme.borderRadius.md,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
    gap: theme.spacing[2],
  },
  emptyTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    lineHeight: 18,
  },
}));
