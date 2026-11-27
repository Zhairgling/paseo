import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { homelabFetchJson, resolveHomelabDaemonTarget } from "@/homelab/api";
import { useHosts } from "@/runtime/host-runtime";
import { subscribeSessionTagMutations, useSessionTagsStore } from "@/stores/session-tags-store";

interface TagsResponse {
  ok?: boolean;
  tagsByKey?: Record<string, string>;
}

const TAG_SYNC_POLL_MS = 25_000;

export function useSessionTagsSync(): void {
  const hosts = useHosts();
  const hostsRef = useRef(hosts);
  hostsRef.current = hosts;

  useEffect(() => {
    let active = true;

    async function pull() {
      if (hostsRef.current.length === 0) return;
      try {
        const target = resolveHomelabDaemonTarget(hostsRef.current);
        const data = await homelabFetchJson<TagsResponse>(target, "/api/homelab/tags");
        if (active && data.tagsByKey) {
          useSessionTagsStore.getState().setAllTags(data.tagsByKey);
        }
      } catch {
        // Older daemon without /api/homelab/tags keeps local AsyncStorage cache silently.
      }
    }

    void pull();
    const timer = setInterval(() => {
      void pull();
    }, TAG_SYNC_POLL_MS);

    const appSub = AppState.addEventListener("change", (next) => {
      if (next === "active") void pull();
    });

    const mutSub = subscribeSessionTagMutations((event) => {
      if (hostsRef.current.length === 0) return;
      const target = resolveHomelabDaemonTarget(hostsRef.current);
      void homelabFetchJson<TagsResponse>(target, "/api/homelab/tags", {
        method: "POST",
        body: {
          key: event.key,
          serverId: event.serverId,
          agentId: event.agentId,
          tag: event.tag,
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
