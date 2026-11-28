import * as Speech from "expo-speech";
import { useCallback, useSyncExternalStore } from "react";
import { trackUsageEvent } from "@/homelab/usage-stats";
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

const CODE_EXTENSION_REGEX =
  /\.(?:tsx?|jsx?|mjs|cjs|kts?|java|py|rs|go|rb|php|css|scss|html|json|yaml|yml|toml|md|mdx|sh|bash|zsh|gradle|xml|sql|lock|txt)\b/gi;

function humanizeTechnicalIdentifier(token: string): string {
  return (
    token
      // Replace technical extensions so TTS never spells ".t-s-x" or ".k-t".
      .replace(CODE_EXTENSION_REGEX, "")
      // Split snake_case / kebab-case.
      .replace(/[_-]+/g, " ")
      // Split camelCase / PascalCase boundaries cleanly.
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function simplifyPathToken(pathToken: string): string {
  const withoutLineAnchor = pathToken.replace(/#L\d+(?:-L\d+)?$/i, "");
  const segments = withoutLineAnchor.split("/").filter(Boolean);
  const basename = segments.length > 0 ? segments[segments.length - 1] : withoutLineAnchor;
  return humanizeTechnicalIdentifier(basename) || "fichier";
}

/**
 * Strips Markdown syntax, raw file paths, git hashes, and code identifiers so TTS reads natural prose
 * without spelling out slashes, dots, or hexadecimal tokens.
 */
export function stripMarkdownForSpeech(raw: string): string {
  return (
    raw
      .replace(/```[\s\S]*?```/g, " bloc de code. ")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/file:\/\/\S+/g, "")
      // Remove git commit ranges and short/full hex SHAs before humanizing identifiers.
      .replace(/\b[0-9a-f]{7,40}(?:\.\.[0-9a-f]{7,40})?\b/gi, "")
      // Simplify inline backtick code spans (paths -> readable basename, identifiers -> spaced words).
      .replace(/`([^`]+)`/g, (_match, inner: string) => {
        const trimmed = inner.trim();
        if (trimmed.includes("/") && trimmed.length < 160) {
          return simplifyPathToken(trimmed);
        }
        if (trimmed.length > 56) {
          return " ";
        }
        return humanizeTechnicalIdentifier(trimmed);
      })
      // Simplify unquoted multi-segment filesystem paths.
      .replace(/(?:~|\.{1,2})?(?:\/[A-Za-z0-9_.@-]+){2,}(?:#L\d+(?:-L\d+)?)?/g, (match) =>
        simplifyPathToken(match),
      )
      .replace(
        /(?:[A-Za-z0-9_.-]+\/){1,}[A-Za-z0-9_.-]+(?:tsx?|jsx?|kt|java|py|rs|go|json|md|gradle|sh)\b/gi,
        (match) => simplifyPathToken(match),
      )
      // Remove isolated technical filenames with extensions (e.g. "index.tsx" -> "index").
      .replace(
        /\b([A-Za-z0-9_-]+)(?:\.(?:tsx?|jsx?|mjs|cjs|kts?|java|py|rs|go|json|yaml|yml|toml|md|gradle|sh|xml))\b/gi,
        (_m, stem: string) => humanizeTechnicalIdentifier(stem),
      )
      // Humanize remaining camelCase or snake_case symbols in prose.
      .replace(/\b[A-Za-z]+(?:_[A-Za-z0-9]+)+\b/g, (match) => humanizeTechnicalIdentifier(match))
      .replace(/\b[a-z]+[A-Z][A-Za-z0-9]*\b/g, (match) => humanizeTechnicalIdentifier(match))
      // Remove markdown table rules, pipes, arrows, and formatting symbols.
      .replace(/\|?[-:\s]{3,}\|[-|:\s]*/g, " ")
      .replace(/\|/g, ", ")
      .replace(/->|=>|<-/g, ", ")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^>\s?/gm, "")
      .replace(/^[-*+]\s+/gm, "")
      .replace(/[*_~#]+/g, "")
      .replace(/\s+([.,!?;:])/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function stopReadAloud(): void {
  trackUsageEvent("speech.stop");
  speakSequence += 1;
  if (activeSpeakingId !== null) {
    activeSpeakingId = null;
    notify();
  }
  getOnDeviceSpeechModule()?.stopSpeaking();
  void Speech.stop();
}

export function startReadAloud(id: string, rawText: string): void {
  const cleaned = stripMarkdownForSpeech(rawText);
  if (!cleaned) {
    return;
  }
  trackUsageEvent("speech.read_aloud");

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
    rate: 1.15,
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
