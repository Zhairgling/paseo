import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  getOnDeviceSpeechModule,
  type DownloadProgressEvent,
  type OnDeviceModelId,
  type OnDeviceModelStatus,
  type OnDeviceTtsEngine,
  type PocketVoiceId,
  type SupertonicVoiceId,
} from "../../modules/aju-ondevice-speech";

const STORAGE_KEY = "paseo:ondevice-speech:v1";

export type TtsEnginePreference = OnDeviceTtsEngine | "system";
export type SupertonicLang = "fr" | "en" | "na";

export interface OnDeviceSpeechState {
  asrEnabled: boolean;
  ttsEngine: TtsEnginePreference;
  pocketVoice: PocketVoiceId;
  supertonicVoice: SupertonicVoiceId;
  supertonicLang: SupertonicLang;
  ttsSpeed: number;

  // Runtime native state (non-persisted)
  initialized: boolean;
  supported: boolean;
  totalRamMb: number;
  statuses: Partial<Record<OnDeviceModelId, OnDeviceModelStatus>>;
  progressByModel: Partial<Record<OnDeviceModelId, DownloadProgressEvent>>;
  errorByModel: Partial<Record<OnDeviceModelId, string>>;
  isSpeaking: boolean;

  setAsrEnabled: (enabled: boolean) => void;
  setTtsEngine: (engine: TtsEnginePreference) => void;
  setPocketVoice: (voice: PocketVoiceId) => void;
  setSupertonicVoice: (voice: SupertonicVoiceId) => void;
  setSupertonicLang: (lang: SupertonicLang) => void;
  setTtsSpeed: (speed: number) => void;

  ensureInitialized: () => void;
  refreshStatuses: () => void;
  downloadModel: (modelId: OnDeviceModelId) => Promise<boolean>;
  cancelDownload: (modelId: OnDeviceModelId) => void;
  deleteModel: (modelId: OnDeviceModelId) => Promise<void>;
  preloadModel: (modelId: OnDeviceModelId) => Promise<void>;
}

let listenersBound = false;

export const useOnDeviceSpeechStore = create<OnDeviceSpeechState>()(
  persist(
    (set, get) => ({
      asrEnabled: true,
      ttsEngine: "pocket-fr",
      pocketVoice: "iris",
      supertonicVoice: "F1",
      supertonicLang: "fr",
      ttsSpeed: 1.15,

      initialized: false,
      supported: Platform.OS === "android",
      totalRamMb: 0,
      statuses: {},
      progressByModel: {},
      errorByModel: {},
      isSpeaking: false,

      setAsrEnabled: (asrEnabled) => set({ asrEnabled }),
      setTtsEngine: (ttsEngine) => set({ ttsEngine }),
      setPocketVoice: (pocketVoice) => set({ pocketVoice }),
      setSupertonicVoice: (supertonicVoice) => set({ supertonicVoice }),
      setSupertonicLang: (supertonicLang) => set({ supertonicLang }),
      setTtsSpeed: (speed) => set({ ttsSpeed: Math.max(0.6, Math.min(1.8, speed)) }),

      refreshStatuses: () => {
        const native = getOnDeviceSpeechModule();
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
          console.warn("[ondevice-speech] refreshStatuses failed:", err);
          set({ initialized: true, supported: false });
        }
      },

      ensureInitialized: () => {
        if (Platform.OS !== "android") return;
        const native = getOnDeviceSpeechModule();
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

          native.addListener("onTtsState", (event) => {
            set({ isSpeaking: event.state === "speaking" });
          });
        }

        get().refreshStatuses();
      },

      downloadModel: async (modelId) => {
        get().ensureInitialized();
        const native = getOnDeviceSpeechModule();
        if (!native) return false;
        set((state) => {
          const nextErrors = { ...state.errorByModel };
          delete nextErrors[modelId];
          return { errorByModel: nextErrors };
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
        getOnDeviceSpeechModule()?.cancelDownload(modelId);
      },

      deleteModel: async (modelId) => {
        const native = getOnDeviceSpeechModule();
        if (!native) return;
        await native.deleteModel(modelId);
        get().refreshStatuses();
      },

      preloadModel: async (modelId) => {
        const native = getOnDeviceSpeechModule();
        if (!native) return;
        await native.preloadModel(modelId);
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        asrEnabled: state.asrEnabled,
        ttsEngine: state.ttsEngine,
        pocketVoice: state.pocketVoice,
        supertonicVoice: state.supertonicVoice,
        supertonicLang: state.supertonicLang,
        ttsSpeed: state.ttsSpeed,
      }),
    },
  ),
);

export function isOnDeviceAsrReady(
  state: Pick<OnDeviceSpeechState, "asrEnabled" | "statuses">,
): boolean {
  return (
    Platform.OS === "android" &&
    state.asrEnabled &&
    Boolean(state.statuses["asr-parakeet-v3"]?.ready)
  );
}

export function resolveActiveOnDeviceTts(
  state: Pick<
    OnDeviceSpeechState,
    "ttsEngine" | "pocketVoice" | "supertonicVoice" | "supertonicLang" | "ttsSpeed" | "statuses"
  >,
): { engine: OnDeviceTtsEngine; voice: string; speed: number; lang: string } | null {
  if (Platform.OS !== "android" || state.ttsEngine === "system") {
    return null;
  }
  const pocketReady = Boolean(state.statuses["tts-pocket-fr"]?.ready);
  const superReady = Boolean(state.statuses["tts-supertonic-3"]?.ready);

  if (state.ttsEngine === "pocket-fr") {
    if (pocketReady) {
      return { engine: "pocket-fr", voice: state.pocketVoice, speed: state.ttsSpeed, lang: "fr" };
    }
    if (superReady) {
      return {
        engine: "supertonic-3",
        voice: state.supertonicVoice,
        speed: state.ttsSpeed,
        lang: state.supertonicLang,
      };
    }
    return null;
  }

  if (superReady) {
    return {
      engine: "supertonic-3",
      voice: state.supertonicVoice,
      speed: state.ttsSpeed,
      lang: state.supertonicLang,
    };
  }
  if (pocketReady) {
    return { engine: "pocket-fr", voice: state.pocketVoice, speed: state.ttsSpeed, lang: "fr" };
  }
  return null;
}
