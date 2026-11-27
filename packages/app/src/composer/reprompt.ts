import type { OnDeviceLlmModelId, RepromptMode } from "../../modules/aju-ondevice-llm";

export const REPROMPT_MIN_LENGTH = 3;

export interface OnDeviceLlmCatalogItem {
  id: OnDeviceLlmModelId;
  title: string;
  subtitle: string;
  expectedMb: string;
  badge: string;
}

export const ONDEVICE_LLM_CATALOG: readonly OnDeviceLlmCatalogItem[] = [
  {
    id: "qwen3-0.6b-int4",
    title: "Qwen3 0.6B INT4 (LiteRT-LM)",
    subtitle: "Ultra-rapide · Correction fautes, ponctuation & dictée FR/EN + code",
    expectedMb: "~328 Mo",
    badge: "Rapide",
  },
  {
    id: "qwen3-1.7b-int4",
    title: "Qwen3 1.7B INT4 (LiteRT-LM)",
    subtitle: "Plus précis · Reformulation avancée & structuration de prompts",
    expectedMb: "~932 Mo",
    badge: "Qualité",
  },
] as const;

export const REPROMPT_MODE_LABELS: Record<RepromptMode, string> = {
  fix: "Dictée nettoyée",
  enhance: "Prompt amélioré",
};

export function canRepromptText(text: string): boolean {
  return text.trim().length >= REPROMPT_MIN_LENGTH;
}

export function formatRepromptDownloadBadge(progress: number): string {
  const clamped = Math.max(1, Math.min(99, Math.round(progress * 100)));
  return `${clamped}%`;
}

function stripOuterMatchingDelimiters(text: string, original: string): string {
  const trimmedOrig = original.trim();
  let result = text.trim();

  // Strip surrounding fenced code block unless the user's draft itself was fenced.
  if (!trimmedOrig.startsWith("```") && result.startsWith("```") && result.endsWith("```")) {
    const firstNewline = result.indexOf("\n");
    if (firstNewline !== -1 && result.length - 3 > firstNewline + 1) {
      result = result.slice(firstNewline + 1, -3).trim();
    }
  }

  // Strip accidental wrapping quotes added by small instruction-tuned models.
  const quotePairs: ReadonlyArray<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["«", "»"],
  ];
  for (const [open, close] of quotePairs) {
    if (
      result.length >= 2 &&
      result.startsWith(open) &&
      result.endsWith(close) &&
      !(trimmedOrig.startsWith(open) && trimmedOrig.endsWith(close))
    ) {
      result = result.slice(open.length, result.length - close.length).trim();
      break;
    }
  }

  return result;
}

export function sanitizeRepromptOutput(rawOutput: string, originalText: string): string {
  const fallback = originalText.trim();
  if (!rawOutput || !rawOutput.trim()) {
    return fallback;
  }

  let cleaned = rawOutput
    // Strip optional Qwen3 reasoning blocks if any sneak past ThinkingConfig(false).
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    // Strip echoed XML prompt delimiters if a small model repeats them.
    .replace(/<\/?brouillon>/gi, "")
    .trim();

  // Strip accidental conversational lead-ins (e.g. "Voici le texte corrigé :")
  cleaned = cleaned
    .replace(
      /^(?:voici\s+(?:le\s+)?(?:texte|message|prompt)\s+(?:corrig[eé]|am[eé]lior[eé])\s*:\s*)/i,
      "",
    )
    .replace(/^(?:corrected|improved)\s+(?:text|prompt)\s*:\s*/i, "")
    .trim();

  cleaned = stripOuterMatchingDelimiters(cleaned, originalText);

  return cleaned.length > 0 ? cleaned : fallback;
}
