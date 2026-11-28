import { BarChart3, RefreshCw, Trash2, Volume2 } from "lucide-react-native";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import {
  homelabFetchJson,
  type DaemonHttpTarget,
  type HomelabUsageStatsResponse,
  type TopUsageEntry,
} from "./api";
import {
  executeAppControlCommand,
  getAppUiSnapshot,
  subscribeAppUiSnapshot,
} from "./app-control-bridge";
import { getLocalUsageCounters } from "./usage-stats";

function UsageBarRow({ entry }: { entry: TopUsageEntry }) {
  const widthPct = `${Math.min(100, Math.max(4, entry.sharePct))}%` as `${number}%`;
  return (
    <View style={styles.barRow}>
      <View style={styles.barHeader}>
        <Text style={styles.barKey} numberOfLines={1}>
          {entry.key}
        </Text>
        <Text style={styles.barMeta}>{`${entry.count} (${entry.sharePct}%)`}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: widthPct }]} />
      </View>
    </View>
  );
}

export function HomelabStatsAndControlPanel({
  target,
}: {
  target: DaemonHttpTarget;
}): ReactElement {
  const [serverStats, setServerStats] = useState<HomelabUsageStatsResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [feedback, setFeedback] = useState("");
  const uiSnapshot = useSyncExternalStore(
    subscribeAppUiSnapshot,
    getAppUiSnapshot,
    getAppUiSnapshot,
  );
  const localStats = getLocalUsageCounters();

  const refresh = useCallback(async () => {
    try {
      const res = await homelabFetchJson<HomelabUsageStatsResponse>(target, "/api/homelab/stats");
      setServerStats(res);
      setErrorMsg("");
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? `${err.message} (compteurs locaux affichés en attendant le redémarrage daemon)`
          : "Stats serveur indisponibles",
      );
    }
  }, [target]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  const handleReset = useCallback(async () => {
    try {
      const res = await homelabFetchJson<HomelabUsageStatsResponse>(target, "/api/homelab/stats", {
        method: "DELETE",
      });
      setServerStats(res);
      setFeedback("Statistiques réinitialisées.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Reset impossible");
    }
  }, [target]);

  const handleTestReadLast = useCallback(async () => {
    const res = await executeAppControlCommand("speech.read_aloud", {}, "assistant_local");
    setFeedback(res.ok ? "Lecture vocale déclenchée via App Control." : String(res.error ?? ""));
  }, []);

  const topActions: TopUsageEntry[] = serverStats
    ? serverStats.topActions
    : Object.entries(localStats.actionCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([key, count]) => ({
          key,
          count,
          sharePct:
            localStats.totalEvents > 0
              ? Math.round((count / localStats.totalEvents) * 1000) / 10
              : 0,
        }));

  const sources = serverStats ? serverStats.sourceCounts : localStats.sourceCounts;
  const totalEvents = serverStats ? serverStats.totalEvents : localStats.totalEvents;

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.titleRow}>
            <BarChart3 size={16} color="#38bdf8" />
            <Text
              style={styles.sectionTitle}
            >{`Statistiques d'usage (${totalEvents} événements)`}</Text>
          </View>
          <View style={styles.actionsRow}>
            <Button size="sm" variant="ghost" leftIcon={RefreshCw} onPress={handleRefresh}>
              Actualiser
            </Button>
            <Button size="sm" variant="ghost" leftIcon={Trash2} onPress={handleReset}>
              Reset
            </Button>
          </View>
        </View>

        <Text style={styles.metaText}>
          {`Sources — Utilisateur: ${sources.user} · Assistant vocal: ${sources.assistant_local} · Agent distant: ${sources.agent_remote}`}
        </Text>

        {topActions.length === 0 ? (
          <Text style={styles.emptyText}>Aucune action enregistrée pour le moment.</Text>
        ) : (
          topActions.map((entry) => <UsageBarRow key={entry.key} entry={entry} />)
        )}

        {errorMsg ? <Text style={styles.warnText}>{errorMsg}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Habilitation App Control (Vocal & Agent)</Text>
        <Text
          style={styles.metaText}
        >{`Écran actif : ${uiSnapshot.screen} (${uiSnapshot.pathname})`}</Text>
        <Text style={styles.metaText}>
          {`Composer attaché : ${uiSnapshot.composer.attached ? "oui" : "non"} · Brouillon : ${uiSnapshot.composer.text.length} car.`}
        </Text>
        <Text style={styles.metaText}>
          {`Actions disponibles : ${uiSnapshot.availableActions.join(", ")}`}
        </Text>
        {uiSnapshot.lastAssistantMessage ? (
          <Text style={styles.previewText} numberOfLines={3}>
            {`Dernier message visible : ${uiSnapshot.lastAssistantMessage.textPreview}`}
          </Text>
        ) : null}

        <View style={styles.actionsRow}>
          <Button size="sm" variant="outline" leftIcon={Volume2} onPress={handleTestReadLast}>
            Tester lecture vocale
          </Button>
        </View>
        {feedback ? <Text style={styles.okText}>{feedback}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: {
    gap: theme.spacing[3],
  },
  card: {
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[2],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.semibold,
    fontSize: theme.fontSize.base,
  },
  metaText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  previewText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    backgroundColor: theme.colors.surface2,
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.base,
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontStyle: "italic",
    fontSize: theme.fontSize.sm,
  },
  barRow: {
    gap: 4,
  },
  barHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  barKey: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    flex: 1,
  },
  barMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  barTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.surface2,
    overflow: "hidden",
  },
  barFill: {
    height: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.accent,
  },
  warnText: {
    color: "#f59e0b",
    fontSize: theme.fontSize.sm,
  },
  okText: {
    color: "#22c55e",
    fontSize: theme.fontSize.sm,
  },
}));
