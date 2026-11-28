import { usePathname, useRouter } from "expo-router";
import { useEffect, useMemo, useRef } from "react";
import { AppState, Platform } from "react-native";
import { useHosts } from "@/runtime/host-runtime";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { homelabFetchJson, resolveHomelabDaemonTarget } from "./api";
import {
  executeAppControlCommand,
  getAppUiSnapshot,
  registerNavigationController,
  subscribeAppUiSnapshot,
  updateAppUiLocation,
} from "./app-control-bridge";
import { setUsageStatsScreen, setUsageStatsTarget } from "./usage-stats";

interface PolledCommand {
  id: string;
  command: string;
  args?: Record<string, unknown>;
  source?: "assistant_local" | "agent_remote";
}

function classifyScreen(pathname: string): string {
  if (pathname.startsWith("/team")) return "team";
  if (pathname.startsWith("/new")) return "new";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/sessions")) return "sessions";
  if (pathname.startsWith("/inbox")) return "inbox";
  if (pathname.startsWith("/schedules")) return "schedules";
  if (pathname.includes("/agent/")) return "agent";
  return pathname === "/" ? "home" : pathname.replace(/^\//, "");
}

export function HomelabAppControlHost(): null {
  const pathname = usePathname();
  const router = useRouter();
  const hosts = useHosts();
  const activeSelection = useActiveWorkspaceSelection();
  const target = useMemo(() => resolveHomelabDaemonTarget(hosts), [hosts]);
  const deviceId = useMemo(() => `paseo-${Platform.OS}`, []);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setUsageStatsTarget(target);
  }, [target]);

  useEffect(() => {
    const screen = classifyScreen(pathname);
    setUsageStatsScreen(screen);
    updateAppUiLocation({
      pathname,
      screen,
      activeServerId: activeSelection?.serverId ?? null,
      activeWorkspaceId: activeSelection?.workspaceId ?? null,
    });
  }, [activeSelection?.serverId, activeSelection?.workspaceId, pathname]);

  useEffect(() => {
    return registerNavigationController({
      navigateToPath: (nextPath) => {
        router.push(nextPath as never);
      },
    });
  }, [router]);

  useEffect(() => {
    const pushSnapshot = () => {
      void homelabFetchJson(target, "/api/homelab/app-control/snapshot", {
        method: "POST",
        body: { deviceId, snapshot: getAppUiSnapshot() },
      }).catch(() => undefined);
    };
    pushSnapshot();
    const unsub = subscribeAppUiSnapshot(() => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(pushSnapshot, 450);
    });
    return () => {
      unsub();
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [deviceId, target]);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      if (!active || AppState.currentState !== "active") return;
      try {
        const res = await homelabFetchJson<{ ok: boolean; commands: PolledCommand[] }>(
          target,
          `/api/homelab/app-control/commands/poll?deviceId=${encodeURIComponent(deviceId)}`,
        );
        for (const cmd of res.commands ?? []) {
          const result = await executeAppControlCommand(
            cmd.command,
            cmd.args ?? {},
            cmd.source ?? "agent_remote",
          );
          await homelabFetchJson(
            target,
            `/api/homelab/app-control/commands/${encodeURIComponent(cmd.id)}/result`,
            { method: "POST", body: result },
          ).catch(() => undefined);
        }
      } catch {
        // Ignore transient poll errors
      }
    };
    const interval = setInterval(() => {
      void poll();
    }, 1800);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [deviceId, target]);

  return null;
}
