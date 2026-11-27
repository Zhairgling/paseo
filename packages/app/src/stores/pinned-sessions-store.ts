import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const STORAGE_KEY = "paseo:pinned-sessions:v1";

export function buildPinnedSessionKey(serverId: string, agentId: string): string {
  return `${serverId}:${agentId}`;
}

export interface PinMutationEvent {
  key: string;
  serverId: string;
  agentId: string;
  action: "pin" | "unpin";
}

const pinMutationListeners = new Set<(event: PinMutationEvent) => void>();

export function subscribePinnedSessionMutations(
  listener: (event: PinMutationEvent) => void,
): () => void {
  pinMutationListeners.add(listener);
  return () => {
    pinMutationListeners.delete(listener);
  };
}

function emitPinMutation(event: PinMutationEvent): void {
  for (const listener of pinMutationListeners) {
    listener(event);
  }
}

interface PinnedSessionsState {
  pinnedKeys: string[];
  togglePinSession: (serverId: string, agentId: string) => void;
  unpinSession: (serverId: string, agentId: string) => void;
  setPinnedKeys: (pinnedKeys: readonly string[]) => void;
}

export const usePinnedSessionsStore = create<PinnedSessionsState>()(
  persist(
    (set) => ({
      pinnedKeys: [],
      togglePinSession: (serverId, agentId) => {
        const key = buildPinnedSessionKey(serverId, agentId);
        let action: "pin" | "unpin" = "pin";
        set((state) => {
          const exists = state.pinnedKeys.includes(key);
          action = exists ? "unpin" : "pin";
          return {
            pinnedKeys: exists
              ? state.pinnedKeys.filter((item) => item !== key)
              : [key, ...state.pinnedKeys],
          };
        });
        emitPinMutation({ key, serverId, agentId, action });
      },
      unpinSession: (serverId, agentId) => {
        const key = buildPinnedSessionKey(serverId, agentId);
        set((state) => ({
          pinnedKeys: state.pinnedKeys.filter((item) => item !== key),
        }));
        emitPinMutation({ key, serverId, agentId, action: "unpin" });
      },
      setPinnedKeys: (nextKeys) => {
        const deduped = [...new Set(nextKeys.map((item) => item.trim()).filter(Boolean))];
        set((state) => {
          if (
            state.pinnedKeys.length === deduped.length &&
            state.pinnedKeys.every((key, idx) => key === deduped[idx])
          ) {
            return state;
          }
          return { pinnedKeys: deduped };
        });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ pinnedKeys: state.pinnedKeys }),
    },
  ),
);
