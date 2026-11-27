import { describe, expect, it, vi } from "vitest";

vi.mock("expo-modules-core", () => ({
  NativeModule: function MockNativeModule() {
    // empty mock constructor for Vitest node environment
  },
  requireOptionalNativeModule: () => null,
}));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  return { ...actual, Platform: { ...actual.Platform, OS: "android" } };
});

import {
  isOnDeviceAsrReady,
  resolveActiveOnDeviceTts,
  useOnDeviceSpeechStore,
} from "./ondevice-speech-store";

describe("ondevice-speech-store helpers", () => {
  it("detects when Parakeet v3 ASR is ready on Android", () => {
    expect(isOnDeviceAsrReady({ asrEnabled: false, statuses: {} })).toBe(false);
    expect(
      isOnDeviceAsrReady({
        asrEnabled: true,
        statuses: {
          "asr-parakeet-v3": {
            id: "asr-parakeet-v3",
            kind: "asr",
            label: "Parakeet",
            status: "ready",
            ready: true,
            expectedSizeBytes: 1,
            installedBytes: 1,
            modelDir: "/tmp/p",
          },
        },
      }),
    ).toBe(true);
  });

  it("picks the preferred ready TTS engine and falls back cleanly between ONNX engines", () => {
    const pocketStatus = {
      id: "tts-pocket-fr" as const,
      kind: "tts" as const,
      label: "Pocket",
      status: "ready" as const,
      ready: true,
      expectedSizeBytes: 1,
      installedBytes: 1,
      modelDir: "/tmp/pocket",
    };
    const superStatus = {
      id: "tts-supertonic-3" as const,
      kind: "tts" as const,
      label: "Supertonic",
      status: "ready" as const,
      ready: true,
      expectedSizeBytes: 1,
      installedBytes: 1,
      modelDir: "/tmp/super",
    };

    expect(
      resolveActiveOnDeviceTts({
        ttsEngine: "pocket-fr",
        pocketVoice: "iris",
        supertonicVoice: "F1",
        supertonicLang: "fr",
        ttsSpeed: 1.0,
        statuses: { "tts-pocket-fr": pocketStatus },
      }),
    ).toEqual({ engine: "pocket-fr", voice: "iris", speed: 1.0, lang: "fr" });

    // Falls back to Supertonic 3 when user prefers Pocket but only Supertonic is installed
    expect(
      resolveActiveOnDeviceTts({
        ttsEngine: "pocket-fr",
        pocketVoice: "julien",
        supertonicVoice: "M2",
        supertonicLang: "fr",
        ttsSpeed: 1.15,
        statuses: { "tts-supertonic-3": superStatus },
      }),
    ).toEqual({ engine: "supertonic-3", voice: "M2", speed: 1.15, lang: "fr" });

    // System mode forces null (uses expo-speech)
    expect(
      resolveActiveOnDeviceTts({
        ttsEngine: "system",
        pocketVoice: "vald",
        supertonicVoice: "F1",
        supertonicLang: "fr",
        ttsSpeed: 1.0,
        statuses: { "tts-pocket-fr": pocketStatus, "tts-supertonic-3": superStatus },
      }),
    ).toBeNull();

    // Clamp ttsSpeed bounds cleanly
    useOnDeviceSpeechStore.getState().setTtsSpeed(9.9);
    expect(useOnDeviceSpeechStore.getState().ttsSpeed).toBe(1.8);
  });
});
