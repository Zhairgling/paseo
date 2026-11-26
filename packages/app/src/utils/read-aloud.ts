import * as Speech from "expo-speech";
import { useCallback, useSyncExternalStore } from "react";

let activeSpeakingId: string | null = null;
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
  if (activeSpeakingId !== null) {
    activeSpeakingId = null;
    notify();
  }
  void Speech.stop();
}

export function toggleReadAloud(id: string, rawText: string): void {
  if (activeSpeakingId === id) {
    stopReadAloud();
    return;
  }

  const cleaned = stripMarkdownForSpeech(rawText);
  if (!cleaned) {
    return;
  }

  void Speech.stop();
  activeSpeakingId = id;
  notify();

  Speech.speak(cleaned, {
    language: "fr-FR",
    rate: 1.05,
    onDone: () => {
      if (activeSpeakingId === id) {
        activeSpeakingId = null;
        notify();
      }
    },
    onStopped: () => {
      if (activeSpeakingId === id) {
        activeSpeakingId = null;
        notify();
      }
    },
    onError: () => {
      if (activeSpeakingId === id) {
        activeSpeakingId = null;
        notify();
      }
    },
  });
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
