import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  getOnDeviceLlmModule,
  type OnDeviceLlmDownloadProgressEvent,
  type OnDeviceLlmModelId,
  type OnDeviceLlmModelStatus,
  type RepromptMode,
} from "../../modules/aju-ondevice-llm";
import { canRepromptText, sanitizeRepromptOutput } from "../composer/reprompt";

const STORAGE_KEY = "paseo:ondevice-llm:v1";

export interface RepromptResult {
  text: string;
  changed: boolean;
  modelId: OnDeviceLlmModelId;
  mode: RepromptMode;
}

export interface OnDeviceLlmState {
  selectedModel: OnDeviceLlmModelId;
  repromptEnabled: boolean;

  // Runtime native state (non-persisted)
  initialized: boolean;
  supported: boolean;
  totalRamMb: number;
  statuses: Partial<Record<OnDeviceLlmModelId, OnDeviceLlmModelStatus>>;
  progressByModel: Partial<Record<OnDeviceLlmModelId, OnDeviceLlmDownloadProgressEvent>>;
  errorByModel: Partial<Record<OnDeviceLlmModelId, string>>;
  isReprompting: boolean;
  activeRepromptMode: RepromptMode | null;
  lastRepromptError: string | null;

  setSelectedModel: (modelId: OnDeviceLlmModelId) => void;
  setRepromptEnabled: (enabled: boolean) => void;
  clearRepromptError: () => void;

  ensureInitialized: () => void;
  refreshStatuses: () => void;
  downloadModel: (modelId: OnDeviceLlmModelId) => Promise<boolean>;
  cancelDownload: (modelId: OnDeviceLlmModelId) => void;
  deleteModel: (modelId: OnDeviceLlmModelId) => Promise<void>;
  preloadModel: (modelId: OnDeviceLlmModelId) => Promise<void>;
  repromptDraft: (text: string, mode: RepromptMode) => Promise<RepromptResult | null>;
}

let listenersBound = false;

export const useOnDeviceLlmStore = create<OnDeviceLlmState>()(
  persist(
    (set, get) => ({
      selectedModel: "qwen3-0.6b-int4",
      repromptEnabled: true,

      initialized: false,
      supported: Platform.OS === "android",
      totalRamMb: 0,
      statuses: {},
      progressByModel: {},
      errorByModel: {},
      isReprompting: false,
      activeRepromptMode: null,
      lastRepromptError: null,

      setSelectedModel: (selectedModel) => set({ selectedModel, lastRepromptError: null }),
      setRepromptEnabled: (repromptEnabled) => set({ repromptEnabled }),
      clearRepromptError: () => set({ lastRepromptError: null }),

      refreshStatuses: () => {
        const native = getOnDeviceLlmModule();
        if (!native) {
          set({ initialized: true, supported: false });
          return;
        }
        try {
          const caps = native.getCapabilities();
          const statuses = native.getModelStatuses();
          set({
            initialized: true,
            supported: Boolean(caps.supported),
            totalRamMb: caps.totalRamMb,
            statuses,
          });
        } catch (err) {
          console.warn("[ondevice-llm] refreshStatuses failed:", err);
          set({ initialized: true, supported: false });
        }
      },

      ensureInitialized: () => {
        if (Platform.OS !== "android") return;
        const native = getOnDeviceLlmModule();
        if (!native) return;

        if (!listenersBound) {
          listenersBound = true;
          native.addListener("onDownloadProgress", (event) => {
            set((state) => {
              const nextProgress = { ...state.progressByModel, [event.modelId]: event };
              const nextErrors = { ...state.errorByModel };
              if (event.phase === "error") {
                nextErrors[event.modelId] = event.message;
              } else if (event.phase === "ready" || event.phase === "cancelled") {
                delete nextErrors[event.modelId];
                delete nextProgress[event.modelId];
              }
              return { progressByModel: nextProgress, errorByModel: nextErrors };
            });
            if (event.phase === "ready" || event.phase === "cancelled" || event.phase === "error") {
              get().refreshStatuses();
            }
          });
        }

        get().refreshStatuses();
      },

      downloadModel: async (modelId) => {
        get().ensureInitialized();
        const native = getOnDeviceLlmModule();
        if (!native) return false;
        set((state) => {
          const nextErrors = { ...state.errorByModel };
          delete nextErrors[modelId];
          return { errorByModel: nextErrors, lastRepromptError: null };
        });
        get().refreshStatuses();
        try {
          await native.downloadModel(modelId);
          get().refreshStatuses();
          return true;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          set((state) => ({
            errorByModel: { ...state.errorByModel, [modelId]: message },
          }));
          get().refreshStatuses();
          return false;
        }
      },

      cancelDownload: (modelId) => {
        getOnDeviceLlmModule()?.cancelDownload(modelId);
      },

      deleteModel: async (modelId) => {
        const native = getOnDeviceLlmModule();
        if (!native) return;
        await native.deleteModel(modelId);
        get().refreshStatuses();
      },

      preloadModel: async (modelId) => {
        const native = getOnDeviceLlmModule();
        if (!native) return;
        await native.preloadModel(modelId);
      },

      repromptDraft: async (text, mode) => {
        if (!canRepromptText(text)) return null;
        get().ensureInitialized();
        const native = getOnDeviceLlmModule();
        if (!native) {
          set({
            lastRepromptError: "Module IA locale disponible uniquement sur Android.",
          });
          return null;
        }

        let modelId = get().selectedModel;
        let ready = Boolean(get().statuses[modelId]?.ready);
        if (!ready) {
          // If user already downloaded another LiteRT-LM model, prefer it over blocking;
          // otherwise download the currently selected model on demand.
          const fallbackReady = (["qwen3-0.6b-int4", "qwen3-1.7b-int4"] as const).find((id) =>
            Boolean(get().statuses[id]?.ready),
          );
          if (fallbackReady) {
            modelId = fallbackReady;
            ready = true;
          }
        }

        if (!ready) {
          const ok = await get().downloadModel(modelId);
          if (!ok || !get().statuses[modelId]?.ready) {
            const dlError = get().errorByModel[modelId];
            set({
              lastRepromptError: dlError ?? "Téléchargement du modèle local annulé ou échoué.",
            });
            return null;
          }
        }

        set({ isReprompting: true, activeRepromptMode: mode, lastRepromptError: null });
        try {
          const raw = await native.reprompt(modelId, mode, text);
          const cleaned = sanitizeRepromptOutput(raw, text);
          return {
            text: cleaned,
            changed: cleaned !== text.trim(),
            modelId,
            mode,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          set({ lastRepromptError: message });
          return null;
        } finally {
          set({ isReprompting: false, activeRepromptMode: null });
        }
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        selectedModel: state.selectedModel,
        repromptEnabled: state.repromptEnabled,
      }),
    },
  ),
);
