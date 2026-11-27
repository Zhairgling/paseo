import { useEffect } from "react";
import { AppState, NativeModules, Platform } from "react-native";
import { buildWidgetSnapshot } from "@/homelab/widget-snapshot";
import { usePinnedSessionsStore } from "@/stores/pinned-sessions-store";
import { useSessionStore } from "@/stores/session-store";

interface AjuCodeWidgetNativeModule {
  updateSnapshot?: (json: string) => void;
}

const UPDATE_DEBOUNCE_MS = 400;

function pushWidgetSnapshotNow(): void {
  if (Platform.OS !== "android") return;
  const mod = NativeModules.AjuCodeWidget as AjuCodeWidgetNativeModule | undefined;
  if (!mod?.updateSnapshot) return;

  const snapshot = buildWidgetSnapshot({
    sessions: useSessionStore.getState().sessions,
    pinnedKeys: usePinnedSessionsStore.getState().pinnedKeys,
  });
  try {
    mod.updateSnapshot(JSON.stringify(snapshot));
  } catch {
    // Non-critical native bridge update.
  }
}

/**
 * Keeps the Android home screen widget updated with running session counts
 * and pinned / waiting agent previews.
 */
export function useAjuCodeWidgetSync(): void {
  useEffect(() => {
    if (Platform.OS !== "android") return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleUpdate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        pushWidgetSnapshotNow();
      }, UPDATE_DEBOUNCE_MS);
    };

    pushWidgetSnapshotNow();
    const unsubSessions = useSessionStore.subscribe(scheduleUpdate);
    const unsubPinned = usePinnedSessionsStore.subscribe(scheduleUpdate);
    const appSub = AppState.addEventListener("change", (next) => {
      if (next === "background" || next === "active") {
        pushWidgetSnapshotNow();
      }
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsubSessions();
      unsubPinned();
      appSub.remove();
    };
  }, []);
}
