import { router } from "expo-router";
import { Cpu } from "lucide-react-native";
import { memo, useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { PressHighlight } from "@/components/ui/press-highlight";
import { homelabFetchJson, resolveHomelabDaemonTarget, type HomelabGpuStatus } from "@/homelab/api";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useHosts } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import { buildTeamRoute } from "@/utils/host-routes";

const POLL_INTERVAL_MS = 15_000;

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

function formatColabSummary(colab: HomelabGpuStatus["colab"]): string {
  const parts: string[] = [];
  const inFlight = colab.in_flight ?? 0;
  const state = (colab.state ?? "").toLowerCase();
  if (inFlight > 0) {
    parts.push(`${inFlight} actif${inFlight > 1 ? "s" : ""}`);
  } else if (state === "ready") {
    parts.push("prêt");
  } else if (state === "starting" || state === "warming") {
    parts.push("démarrage");
  } else if (state) {
    parts.push(state);
  }
  if (typeof colab.compute_units_balance === "number") {
    parts.push(`${Math.round(colab.compute_units_balance)} CU`);
  }
  const g4Hours = colab.estimated_hours_remaining?.G4_96GB_hours;
  if (typeof g4Hours === "number" && g4Hours > 0) {
    parts.push(`~${Math.round(g4Hours)}h`);
  }
  return parts.join(" · ");
}

/**
 * Compact 1-line Colab G4 + Compute Units indicator sitting in the sidebar
 * footer alongside cloud provider usage quotas. Tapping it opens Équipe & GPU.
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
  const gpuLabel = colab.gpu ? `Colab ${colab.gpu}` : "Colab";
  const summary = formatColabSummary(colab);

  return (
    <PressHighlight
      onPress={handlePress}
      style={styles.trigger}
      accessibilityRole="button"
      accessibilityLabel={`${gpuLabel}: ${summary}`}
      testID="sidebar-colab-status"
    >
      <View style={styles.row}>
        <ThemedCpuIcon size={13} />
        <View style={[styles.dot, dotStyleForHealth(health)]} />
        <Text style={styles.gpuLabel} numberOfLines={1}>
          {gpuLabel}
        </Text>
        {summary ? (
          <Text style={styles.summaryText} numberOfLines={1}>
            {summary}
          </Text>
        ) : null}
      </View>
    </PressHighlight>
  );
});

const styles = StyleSheet.create((theme) => ({
  trigger: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    borderRadius: theme.borderRadius.md,
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
}));
