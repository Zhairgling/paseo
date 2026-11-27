import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { homelabFetchJson, resolveHomelabDaemonTarget } from "@/homelab/api";
import { useHosts } from "@/runtime/host-runtime";
import {
  subscribePinnedSessionMutations,
  usePinnedSessionsStore,
} from "@/stores/pinned-sessions-store";

interface PinsResponse {
  ok?: boolean;
  pinnedKeys?: string[];
  updatedAt?: string | null;
}

const SYNC_POLL_MS = 20_000;

/**
 * Keep pinned sessions synchronized with EVO (`~/.paseo/pinned-sessions.json`) so pins
 * are shared across Magic V6, Honor Pad 10, Web UI, CLI scripts, and Paseo MCP tools.
 */
export function usePinnedSessionsSync(): void {
  const hosts = useHosts();
  const hostsRef = useRef(hosts);
  hostsRef.current = hosts;
  const seededRef = useRef(false);

  useEffect(() => {
    let active = true;

    async function pullFromDaemon() {
      if (hostsRef.current.length === 0) return;
      try {
        const target = resolveHomelabDaemonTarget(hostsRef.current);
        const data = await homelabFetchJson<PinsResponse>(target, "/api/homelab/pins");
        if (!active || !Array.isArray(data.pinnedKeys)) return;
        const local = usePinnedSessionsStore.getState().pinnedKeys;
        if (
          data.pinnedKeys.length === 0 &&
          !data.updatedAt &&
          local.length > 0 &&
          !seededRef.current
        ) {
          seededRef.current = true;
          await homelabFetchJson<PinsResponse>(target, "/api/homelab/pins", {
            method: "POST",
            body: { pinnedKeys: local },
          });
          return;
        }
        usePinnedSessionsStore.getState().setPinnedKeys(data.pinnedKeys);
      } catch {
        // Older daemon build without /api/homelab/pins falls back silently to AsyncStorage.
      }
    }

    void pullFromDaemon();
    const timer = setInterval(() => {
      void pullFromDaemon();
    }, SYNC_POLL_MS);

    const appSub = AppState.addEventListener("change", (next) => {
      if (next === "active") void pullFromDaemon();
    });

    const mutSub = subscribePinnedSessionMutations((event) => {
      if (hostsRef.current.length === 0) return;
      const target = resolveHomelabDaemonTarget(hostsRef.current);
      void homelabFetchJson<PinsResponse>(target, "/api/homelab/pins", {
        method: "POST",
        body: {
          key: event.key,
          serverId: event.serverId,
          agentId: event.agentId,
          action: event.action,
        },
      }).catch(() => {});
    });

    return () => {
      active = false;
      clearInterval(timer);
      appSub.remove();
      mutSub();
    };
  }, [hosts.length]);
}
