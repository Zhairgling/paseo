import { create } from "zustand";

export interface SplitSessionTarget {
  serverId: string;
  agentId: string;
  workspaceId: string;
}

interface SplitSessionState {
  secondarySession: SplitSessionTarget | null;
  openSplitSession: (target: SplitSessionTarget) => void;
  toggleSplitSession: (target: SplitSessionTarget) => void;
  closeSplitSession: () => void;
}

export const useSplitSessionStore = create<SplitSessionState>((set) => ({
  secondarySession: null,
  openSplitSession: (target) => set({ secondarySession: target }),
  toggleSplitSession: (target) =>
    set((state) => {
      const current = state.secondarySession;
      if (current && current.serverId === target.serverId && current.agentId === target.agentId) {
        return { secondarySession: null };
      }
      return { secondarySession: target };
    }),
  closeSplitSession: () => set({ secondarySession: null }),
}));
