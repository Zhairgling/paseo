import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const STORAGE_KEY = "paseo:session-tags:v1";

export const PRESET_SESSION_TAGS = ["Montre", "Mi Band 8", "AjuCode", "Homelab"] as const;

export function buildSessionTagKey(serverId: string, agentId: string): string {
  return `${serverId}:${agentId}`;
}

export interface TagMutationEvent {
  key: string;
  serverId: string;
  agentId: string;
  tag: string | null;
}

const tagListeners = new Set<(event: TagMutationEvent) => void>();

export function subscribeSessionTagMutations(
  listener: (event: TagMutationEvent) => void,
): () => void {
  tagListeners.add(listener);
  return () => {
    tagListeners.delete(listener);
  };
}

interface SessionTagsState {
  tagsByKey: Record<string, string>;
  setSessionTag: (serverId: string, agentId: string, tag: string | null) => void;
  setAllTags: (next: Record<string, string>) => void;
}

export const useSessionTagsStore = create<SessionTagsState>()(
  persist(
    (set) => ({
      tagsByKey: {},
      setSessionTag: (serverId, agentId, rawTag) => {
        const key = buildSessionTagKey(serverId, agentId);
        const cleanTag = rawTag?.trim().slice(0, 32) || null;
        set((state) => {
          const next = { ...state.tagsByKey };
          if (cleanTag) next[key] = cleanTag;
          else delete next[key];
          return { tagsByKey: next };
        });
        for (const listener of tagListeners) {
          listener({ key, serverId, agentId, tag: cleanTag });
        }
      },
      setAllTags: (next) => {
        set((state) => {
          const curKeys = Object.keys(state.tagsByKey);
          const nextKeys = Object.keys(next);
          if (
            curKeys.length === nextKeys.length &&
            nextKeys.every((k) => state.tagsByKey[k] === next[k])
          ) {
            return state;
          }
          return { tagsByKey: { ...next } };
        });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ tagsByKey: state.tagsByKey }),
    },
  ),
);
