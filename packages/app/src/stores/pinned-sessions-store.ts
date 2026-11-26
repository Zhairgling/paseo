import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const STORAGE_KEY = "paseo:pinned-sessions:v1";

export function buildPinnedSessionKey(serverId: string, agentId: string): string {
  return `${serverId}:${agentId}`;
}

interface PinnedSessionsState {
  pinnedKeys: string[];
  togglePinSession: (serverId: string, agentId: string) => void;
  unpinSession: (serverId: string, agentId: string) => void;
}

export const usePinnedSessionsStore = create<PinnedSessionsState>()(
  persist(
    (set) => ({
      pinnedKeys: [],
      togglePinSession: (serverId, agentId) => {
        const key = buildPinnedSessionKey(serverId, agentId);
        set((state) => {
          const exists = state.pinnedKeys.includes(key);
          return {
            pinnedKeys: exists
              ? state.pinnedKeys.filter((item) => item !== key)
              : [key, ...state.pinnedKeys],
          };
        });
      },
      unpinSession: (serverId, agentId) => {
        const key = buildPinnedSessionKey(serverId, agentId);
        set((state) => ({
          pinnedKeys: state.pinnedKeys.filter((item) => item !== key),
        }));
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ pinnedKeys: state.pinnedKeys }),
    },
  ),
);
