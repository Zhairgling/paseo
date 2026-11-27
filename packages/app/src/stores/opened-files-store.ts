import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { WorkspaceFileLocation } from "@/workspace/file-open";

const STORAGE_KEY = "paseo:opened-files:v1";
const MAX_OPENED_FILES = 30;

export interface OpenedFileEntry {
  key: string;
  serverId: string;
  workspaceId: string;
  path: string;
  lineStart?: number;
  lineEnd?: number;
  openedAt: number;
}

export interface OpenedFilesState {
  entries: OpenedFileEntry[];
  recordOpenedFile: (input: {
    serverId: string;
    workspaceId: string;
    location: WorkspaceFileLocation;
  }) => void;
  removeOpenedFile: (key: string) => void;
  clearWorkspaceOpenedFiles: (serverId: string, workspaceId: string) => void;
}

export function buildOpenedFileEntryKey(
  serverId: string,
  workspaceId: string,
  path: string,
): string {
  return `${serverId}::${workspaceId}::${path}`;
}

export const useOpenedFilesStore = create<OpenedFilesState>()(
  persist(
    (set) => ({
      entries: [],

      recordOpenedFile: ({ serverId, workspaceId, location }) => {
        const trimmedPath = location.path.trim();
        if (!trimmedPath) {
          return;
        }
        const key = buildOpenedFileEntryKey(serverId, workspaceId, trimmedPath);
        const nextEntry: OpenedFileEntry = {
          key,
          serverId,
          workspaceId,
          path: trimmedPath,
          lineStart: location.lineStart,
          lineEnd: location.lineEnd,
          openedAt: Date.now(),
        };
        set((state) => ({
          entries: [nextEntry, ...state.entries.filter((item) => item.key !== key)].slice(
            0,
            MAX_OPENED_FILES,
          ),
        }));
      },

      removeOpenedFile: (key) => {
        set((state) => ({
          entries: state.entries.filter((item) => item.key !== key),
        }));
      },

      clearWorkspaceOpenedFiles: (serverId, workspaceId) => {
        set((state) => ({
          entries: state.entries.filter(
            (item) => !(item.serverId === serverId && item.workspaceId === workspaceId),
          ),
        }));
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ entries: state.entries }),
    },
  ),
);
