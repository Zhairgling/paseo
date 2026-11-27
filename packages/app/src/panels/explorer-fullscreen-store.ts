import { create } from "zustand";

interface ExplorerFullscreenState {
  isFullscreen: boolean;
  setFullscreen: (fullscreen: boolean) => void;
  toggleFullscreen: () => void;
  exitFullscreen: () => void;
}

export const useExplorerFullscreenStore = create<ExplorerFullscreenState>((set) => ({
  isFullscreen: false,
  setFullscreen: (isFullscreen) => set({ isFullscreen }),
  toggleFullscreen: () => set((state) => ({ isFullscreen: !state.isFullscreen })),
  exitFullscreen: () => set({ isFullscreen: false }),
}));
