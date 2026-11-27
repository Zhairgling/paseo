import * as Speech from "expo-speech";
import { useCallback, useSyncExternalStore } from "react";
import { resolveActiveOnDeviceTts, useOnDeviceSpeechStore } from "@/stores/ondevice-speech-store";
import { getOnDeviceSpeechModule } from "../../modules/aju-ondevice-speech";

let activeSpeakingId: string | null = null;
let speakSequence = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getActiveSpeakingId(): string | null {
  return activeSpeakingId;
}

/**
 * Strips Markdown syntax, file URLs, and code fences so TTS reads clean natural prose.
 */
export function stripMarkdownForSpeech(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " bloc de code. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/file:\/\/\S+/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/[*_~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function stopReadAloud(): void {
  speakSequence += 1;
  if (activeSpeakingId !== null) {
    activeSpeakingId = null;
    notify();
  }
  getOnDeviceSpeechModule()?.stopSpeaking();
  void Speech.stop();
}

function startReadAloud(id: string, rawText: string): void {
  const cleaned = stripMarkdownForSpeech(rawText);
  if (!cleaned) {
    return;
  }

  speakSequence += 1;
  const seq = speakSequence;
  getOnDeviceSpeechModule()?.stopSpeaking();
  void Speech.stop();
  activeSpeakingId = id;
  notify();

  const onDeviceConfig = resolveActiveOnDeviceTts(useOnDeviceSpeechStore.getState());
  const native = onDeviceConfig ? getOnDeviceSpeechModule() : null;
  if (native && onDeviceConfig) {
    void native
      .speak(cleaned, onDeviceConfig)
      .catch((err) => {
        console.warn("[read-aloud] On-device TTS failed:", err);
      })
      .finally(() => {
        if (speakSequence === seq && activeSpeakingId === id) {
          activeSpeakingId = null;
          notify();
        }
      });
    return;
  }

  Speech.speak(cleaned, {
    language: "fr-FR",
    rate: 1.05,
    onDone: () => {
      if (speakSequence === seq && activeSpeakingId === id) {
        activeSpeakingId = null;
        notify();
      }
    },
    onStopped: () => {
      if (speakSequence === seq && activeSpeakingId === id) {
        activeSpeakingId = null;
        notify();
      }
    },
    onError: () => {
      if (speakSequence === seq && activeSpeakingId === id) {
        activeSpeakingId = null;
        notify();
      }
    },
  });
}

export function restartReadAloud(id: string, rawText: string): void {
  startReadAloud(id, rawText);
}

export function toggleReadAloud(id: string, rawText: string): void {
  if (activeSpeakingId === id) {
    stopReadAloud();
    return;
  }

  startReadAloud(id, rawText);
}

export function useReadAloud(id: string): {
  isSpeaking: boolean;
  toggle: (rawText: string) => void;
} {
  const currentId = useSyncExternalStore(subscribe, getActiveSpeakingId, getActiveSpeakingId);
  const toggle = useCallback(
    (rawText: string) => {
      toggleReadAloud(id, rawText);
    },
    [id],
  );
  return { isSpeaking: currentId === id, toggle };
}
