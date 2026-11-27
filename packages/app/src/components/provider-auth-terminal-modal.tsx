import { AppearanceText as Text } from "@/appearance/text";
import { RetainedPanel } from "@/components/retained-panel";
import { TerminalPane } from "@/components/terminal-pane";
import { Button } from "@/components/ui/button";
import { openHostOverview } from "@/navigation/settings-navigation";
import {
  getHostRuntimeStore,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
} from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import { RefreshCw, RotateCw, Settings, Terminal, X } from "lucide-react-native";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Modal, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

export interface ProviderAuthTerminalRequest {
  serverId: string;
  provider?: string | null;
  cwd?: string | null;
  onComplete?: () => void;
}

const PROVIDER_AUTH_COMMANDS: Record<string, string> = {
  antigravity: "agy",
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
  opencode: "opencode auth login",
};

const ThemedTerminal = withUnistyles(Terminal, (theme: Theme) => ({
  color: theme.colors.accent,
}));
const ThemedTerminalOnAccent = withUnistyles(Terminal, (theme: Theme) => ({
  color: theme.colors.accentForeground,
}));
const ThemedClose = withUnistyles(X, (theme: Theme) => ({
  color: theme.colors.foreground,
}));
const ThemedRotate = withUnistyles(RotateCw, (theme: Theme) => ({
  color: theme.colors.foreground,
}));
const ThemedRefresh = withUnistyles(RefreshCw, (theme: Theme) => ({
  color: theme.colors.foreground,
}));
const ThemedRefreshOnAccent = withUnistyles(RefreshCw, (theme: Theme) => ({
  color: theme.colors.accentForeground,
}));
const ThemedSettings = withUnistyles(Settings, (theme: Theme) => ({
  color: theme.colors.foreground,
}));

const noopOpenFileExplorer = () => {};
const noopOpenWorkspaceFile = () => {};

let activeRequest: ProviderAuthTerminalRequest | null = null;
const requestListeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of requestListeners) {
    listener();
  }
}

function subscribeRequest(listener: () => void): () => void {
  requestListeners.add(listener);
  return () => {
    requestListeners.delete(listener);
  };
}

function getRequestSnapshot(): ProviderAuthTerminalRequest | null {
  return activeRequest;
}

export function resolveProviderAuthCommand(provider?: string | null): string | null {
  if (!provider) return null;
  const key = provider.trim().toLowerCase();
  return PROVIDER_AUTH_COMMANDS[key] ?? null;
}

export function openProviderAuthTerminal(request: ProviderAuthTerminalRequest): void {
  activeRequest = request;
  notifyListeners();
}

export function closeProviderAuthTerminal(): void {
  if (!activeRequest) return;
  activeRequest = null;
  notifyListeners();
}

function resolveHostFallbackCwd(serverId: string, preferredCwd?: string | null): string {
  const explicit = preferredCwd?.trim();
  if (explicit) return explicit;
  const session = useSessionStore.getState().sessions[serverId];
  if (session) {
    for (const workspace of session.workspaces.values()) {
      const dir = workspace.workspaceDirectory?.trim();
      if (dir) return dir;
    }
    for (const agent of session.agents.values()) {
      const dir = agent.cwd?.trim();
      if (dir) return dir;
    }
  }
  return "/tmp";
}

function ProviderAuthTerminalContent({
  request,
  onDone,
}: {
  request: ProviderAuthTerminalRequest;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const client = useHostRuntimeClient(request.serverId);
  const isConnected = useHostRuntimeIsConnected(request.serverId);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const terminalIdRef = useRef<string | null>(null);
  const commandSentRef = useRef(false);

  const cwd = useMemo(
    () => resolveHostFallbackCwd(request.serverId, request.cwd),
    [request.cwd, request.serverId],
  );
  const authCommand = useMemo(
    () => resolveProviderAuthCommand(request.provider),
    [request.provider],
  );

  const sendAuthCommand = useCallback(
    (targetTerminalId: string) => {
      if (!client || !authCommand) return;
      client.sendTerminalInput(targetTerminalId, { type: "input", data: `${authCommand}\n` });
    },
    [authCommand, client],
  );

  const spawnTerminal = useCallback(async () => {
    if (!client || !isConnected) {
      setLaunchError("Hôte déconnecté — clique sur « Reconnecter l'hôte ».");
      return;
    }
    setCreating(true);
    setLaunchError(null);
    commandSentRef.current = false;
    try {
      const created = await client.createTerminal(
        cwd,
        request.provider ? `Auth ${request.provider}` : "Terminal",
      );
      if (!created.terminal?.id) {
        throw new Error(created.error ?? "Impossible de démarrer le terminal sur l'hôte.");
      }
      const nextId = created.terminal.id;
      terminalIdRef.current = nextId;
      setTerminalId(nextId);
      if (authCommand && !commandSentRef.current) {
        commandSentRef.current = true;
        setTimeout(() => {
          client.sendTerminalInput(nextId, { type: "input", data: `${authCommand}\n` });
        }, 350);
      }
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : "Échec de création du terminal.");
    } finally {
      setCreating(false);
    }
  }, [authCommand, client, cwd, isConnected, request.provider]);

  useEffect(() => {
    if (isConnected && client && !terminalIdRef.current && !creating) {
      void spawnTerminal();
    }
  }, [client, creating, isConnected, spawnTerminal]);

  useEffect(() => {
    return () => {
      const id = terminalIdRef.current;
      terminalIdRef.current = null;
      if (id && client) {
        void client.killTerminal(id).catch(() => {});
      }
    };
  }, [client]);

  const handleRerunCommand = useCallback(() => {
    if (!terminalIdRef.current) {
      void spawnTerminal();
      return;
    }
    sendAuthCommand(terminalIdRef.current);
  }, [sendAuthCommand, spawnTerminal]);

  const handleReconnectHost = useCallback(() => {
    setReconnecting(true);
    void getHostRuntimeStore()
      .runProbeCycleNow(request.serverId)
      .finally(() => {
        setReconnecting(false);
      });
  }, [request.serverId]);

  const handleOpenHostSettings = useCallback(() => {
    closeProviderAuthTerminal();
    openHostOverview(request.serverId);
  }, [request.serverId]);

  const handleDone = useCallback(() => {
    const id = terminalIdRef.current;
    terminalIdRef.current = null;
    if (id && client) {
      void client.killTerminal(id).catch(() => {});
    }
    onDone();
  }, [client, onDone]);

  const modalRootStyle = useMemo(
    () => [styles.modalRoot, { paddingTop: insets.top, paddingBottom: insets.bottom }],
    [insets.bottom, insets.top],
  );

  const title = authCommand
    ? `Connexion ${request.provider} (${authCommand})`
    : "Terminal de reconnexion";

  return (
    <View style={modalRootStyle}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <ThemedTerminal size={18} />
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {authCommand
                ? "Connecte-toi via le lien ci-dessous puis appuie sur Terminer."
                : "Exécute une commande sur l'hôte puis ferme pour recharger."}
            </Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          {authCommand && terminalId ? (
            <Button
              size="sm"
              variant="secondary"
              onPress={handleRerunCommand}
              testID="provider-auth-rerun"
            >
              <ThemedRotate size={14} />
              <Text style={styles.actionText}>{authCommand}</Text>
            </Button>
          ) : null}
          <Button size="sm" variant="default" onPress={handleDone} testID="provider-auth-done">
            <ThemedClose size={14} />
            <Text style={styles.doneText}>Terminer</Text>
          </Button>
        </View>
      </View>

      {!isConnected || launchError || !terminalId ? (
        <View style={styles.centerState}>
          <Text style={styles.statusTitle}>
            {creating
              ? "Ouverture du terminal sur l'hôte…"
              : (launchError ?? "Connexion à l'hôte requise")}
          </Text>
          <View style={styles.recoveryButtons}>
            <Button
              variant="default"
              onPress={handleReconnectHost}
              loading={reconnecting}
              testID="provider-auth-reconnect-host"
            >
              <ThemedRefreshOnAccent size={14} />
              <Text style={styles.doneText}>Reconnecter l&apos;hôte</Text>
            </Button>
            {isConnected && !creating ? (
              <Button
                variant="secondary"
                onPress={handleRerunCommand}
                testID="provider-auth-retry-terminal"
              >
                <Text style={styles.actionText}>Réessayer le terminal</Text>
              </Button>
            ) : null}
            <Button
              variant="outline"
              onPress={handleOpenHostSettings}
              testID="provider-auth-host-settings"
            >
              <ThemedSettings size={14} />
              <Text style={styles.actionText}>Paramètres de l&apos;hôte</Text>
            </Button>
          </View>
        </View>
      ) : (
        <View style={styles.terminalHost}>
          <RetainedPanel active>
            <TerminalPane
              serverId={request.serverId}
              cwd={cwd}
              terminalId={terminalId}
              isWorkspaceFocused
              isPaneFocused
              onOpenFileExplorer={noopOpenFileExplorer}
              onOpenWorkspaceFile={noopOpenWorkspaceFile}
            />
          </RetainedPanel>
        </View>
      )}
    </View>
  );
}

export function ProviderRecoveryActions({
  serverId,
  provider,
  cwd,
  onComplete,
  onBeforeNavigate,
  showTerminal = true,
  showHostSettings = true,
  align = "center",
  spacingTop = false,
}: {
  serverId: string;
  provider?: string | null;
  cwd?: string | null;
  onComplete?: () => void;
  onBeforeNavigate?: () => void;
  showTerminal?: boolean;
  showHostSettings?: boolean;
  align?: "center" | "start";
  spacingTop?: boolean;
}) {
  const [reconnecting, setReconnecting] = useState(false);

  const handleOpenTerminal = useCallback(() => {
    onBeforeNavigate?.();
    openProviderAuthTerminal({
      serverId,
      provider,
      cwd,
      onComplete,
    });
  }, [cwd, onBeforeNavigate, onComplete, provider, serverId]);

  const handleReconnectHost = useCallback(() => {
    setReconnecting(true);
    void getHostRuntimeStore()
      .runProbeCycleNow(serverId)
      .finally(() => {
        setReconnecting(false);
        onComplete?.();
      });
  }, [onComplete, serverId]);

  const handleOpenHostSettings = useCallback(() => {
    onBeforeNavigate?.();
    openHostOverview(serverId);
  }, [onBeforeNavigate, serverId]);

  const containerStyle = useMemo(
    () => [
      styles.recoveryButtons,
      align === "start" ? styles.recoveryButtonsStart : null,
      spacingTop ? styles.recoveryButtonsSpacingTop : null,
    ],
    [align, spacingTop],
  );

  return (
    <View style={containerStyle}>
      {showTerminal ? (
        <Button
          size="sm"
          variant="default"
          onPress={handleOpenTerminal}
          testID="provider-recovery-terminal"
        >
          <ThemedTerminalOnAccent size={14} />
          <Text style={styles.doneText}>Se connecter (Terminal)</Text>
        </Button>
      ) : null}
      <Button
        size="sm"
        variant={showTerminal ? "secondary" : "default"}
        onPress={handleReconnectHost}
        loading={reconnecting}
        testID="provider-recovery-reconnect"
      >
        {showTerminal ? <ThemedRefresh size={14} /> : <ThemedRefreshOnAccent size={14} />}
        <Text style={showTerminal ? styles.actionText : styles.doneText}>
          Reconnecter l&apos;hôte
        </Text>
      </Button>
      {showHostSettings ? (
        <Button
          size="sm"
          variant="outline"
          onPress={handleOpenHostSettings}
          testID="provider-recovery-host-settings"
        >
          <ThemedSettings size={14} />
          <Text style={styles.actionText}>Paramètres hôte</Text>
        </Button>
      ) : null}
    </View>
  );
}

export const ProviderAuthTerminalHost = memo(function ProviderAuthTerminalHost() {
  const request = useSyncExternalStore(subscribeRequest, getRequestSnapshot, getRequestSnapshot);

  const handleDone = useCallback(() => {
    const callback = request?.onComplete;
    const serverId = request?.serverId;
    closeProviderAuthTerminal();
    if (serverId) {
      void getHostRuntimeStore()
        .runProbeCycleNow(serverId)
        .finally(() => callback?.());
    } else {
      callback?.();
    }
  }, [request]);

  return (
    <Modal
      visible={request !== null}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleDone}
    >
      {request ? <ProviderAuthTerminalContent request={request} onDone={handleDone} /> : null}
    </Modal>
  );
});

const styles = StyleSheet.create((theme) => ({
  modalRoot: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.surface2,
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  headerTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  headerSubtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  doneText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.accentForeground,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
    gap: theme.spacing[4],
  },
  statusTitle: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
  recoveryButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
  recoveryButtonsStart: {
    justifyContent: "flex-start",
  },
  recoveryButtonsSpacingTop: {
    marginTop: theme.spacing[3],
  },
  terminalHost: {
    flex: 1,
    minHeight: 0,
  },
}));
