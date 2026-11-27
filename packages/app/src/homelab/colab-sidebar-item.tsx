import { router } from "expo-router";
import { Cpu } from "lucide-react-native";
import { memo, useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { PressHighlight } from "@/components/ui/press-highlight";
import { homelabFetchJson, resolveHomelabDaemonTarget, type HomelabGpuStatus } from "@/homelab/api";
import { computeColabGpuMetrics } from "@/homelab/colab-metrics";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useHosts } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import { UsageMeter } from "@/usage/meter";
import { buildTeamRoute } from "@/utils/host-routes";

const POLL_INTERVAL_MS = 5000;

const ThemedCpuIcon = withUnistyles(Cpu, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));

type ColabHealth = "active" | "ready" | "starting" | "off";

function classifyColabHealth(colab: HomelabGpuStatus["colab"] | undefined): ColabHealth {
  if (!colab) return "off";
  const state = (colab.state ?? "").toLowerCase();
  if ((colab.in_flight ?? 0) > 0) return "active";
  if (state === "ready" || state === "running") return "ready";
  if (state === "starting" || state === "warming" || state === "booting") return "starting";
  return "off";
}

function dotStyleForHealth(health: ColabHealth) {
  if (health === "active" || health === "ready") return styles.dotOk;
  if (health === "starting") return styles.dotWarn;
  return styles.dotOff;
}

function formatColabLoadCaption(input: {
  state: string;
  inFlight: number;
  parallelSlots: number;
  freeSlots: number;
  isQueued: boolean;
}): string {
  const { state, inFlight, parallelSlots, freeSlots, isQueued } = input;
  if (state !== "ready" && state !== "running" && inFlight === 0) {
    return state === "starting" || state === "warming" ? "démarrage..." : "en veille (0 CU/h)";
  }
  if (isQueued) {
    return `${inFlight}/${parallelSlots} · file (+${inFlight - parallelSlots})`;
  }
  if (freeSlots === 0) {
    return `${inFlight}/${parallelSlots} · plein`;
  }
  if (inFlight === 0) {
    return `0/${parallelSlots} · ${freeSlots} libres`;
  }
  return `${inFlight}/${parallelSlots} · ${freeSlots} libre${freeSlots > 1 ? "s" : ""}`;
}

/**
 * Compact Colab G4 status + live parallel load gauge (in_flight / 4 slots) +
 * Compute Units indicator sitting in the sidebar footer. Tapping opens Équipe & GPU.
 */
export const ColabSidebarStatusItem = memo(function ColabSidebarStatusItem({
  onBeforeNavigate,
}: {
  onBeforeNavigate?: () => void;
}): ReactElement | null {
  const hosts = useHosts();
  const active = useRetainedPanelActive();
  const isAppVisible = useAppVisible();
  const target = useMemo(() => resolveHomelabDaemonTarget(hosts), [hosts]);
  const [colab, setColab] = useState<HomelabGpuStatus["colab"] | null>(null);

  const shouldPoll = active && isAppVisible && hosts.length > 0;

  useEffect(() => {
    if (!shouldPoll) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await homelabFetchJson<HomelabGpuStatus>(target, "/api/homelab/gpu");
        if (
          !cancelled &&
          res.colab &&
          (res.colab.state || res.colab.compute_units_balance != null)
        ) {
          setColab(res.colab);
        }
      } catch {
        // Silent: non-homelab hosts simply do not expose /api/homelab/gpu.
      }
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [shouldPoll, target]);

  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(buildTeamRoute());
  }, [onBeforeNavigate]);

  if (!colab) {
    return null;
  }

  const health = classifyColabHealth(colab);
  const metrics = computeColabGpuMetrics(colab);
  const gpuLabel = `Colab ${metrics.gpuName}`;
  const cuShort = metrics.cuBalance !== null ? `${Math.round(metrics.cuBalance)} CU` : "";
  const hoursShort = metrics.g4Hours !== null ? `~${Math.round(metrics.g4Hours)}h` : "";
  const rightMeta = [cuShort, hoursShort].filter(Boolean).join(" · ");
  const loadCaption = formatColabLoadCaption(metrics);

  return (
    <PressHighlight
      onPress={handlePress}
      style={styles.trigger}
      accessibilityRole="button"
      accessibilityLabel={`${gpuLabel}: ${loadCaption}${rightMeta ? `, ${rightMeta}` : ""}`}
      testID="sidebar-colab-status"
    >
      <View style={styles.row}>
        <ThemedCpuIcon size={13} />
        <View style={[styles.dot, dotStyleForHealth(health)]} />
        <Text style={styles.gpuLabel} numberOfLines={1}>
          {gpuLabel}
        </Text>
        <Text style={styles.summaryText} numberOfLines={1}>
          {rightMeta}
        </Text>
      </View>
      <View style={styles.gaugeRow}>
        <View style={styles.gaugeTrack}>
          <UsageMeter percent={metrics.loadPct} tone={metrics.loadTone} />
        </View>
        <Text style={styles.gaugeLabel} numberOfLines={1}>
          {loadCaption}
        </Text>
      </View>
    </PressHighlight>
  );
});

const styles = StyleSheet.create((theme) => ({
  trigger: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    borderRadius: theme.borderRadius.md,
    gap: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: theme.borderRadius.full,
    flexShrink: 0,
  },
  dotOk: {
    backgroundColor: theme.colors.statusSuccess,
  },
  dotWarn: {
    backgroundColor: theme.colors.statusWarning,
  },
  dotOff: {
    backgroundColor: theme.colors.foregroundExtraMuted,
  },
  gpuLabel: {
    fontSize: 12,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
    flexShrink: 0,
  },
  summaryText: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foregroundMuted,
  },
  gaugeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  gaugeTrack: {
    flex: 1,
    minWidth: 44,
  },
  gaugeLabel: {
    fontSize: 10,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foregroundMuted,
    flexShrink: 0,
  },
}));
