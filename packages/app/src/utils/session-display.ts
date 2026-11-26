import type { StreamItem } from "@/types/stream";

const MODEL_BADGE_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^evo-local\/.*gemma[-]?4/i, "EVO · Gemma4"],
  [/^evo-local\//i, "EVO · Local"],
  [/^mac\/.*27b/i, "Mac · Qwen 27B"],
  [/^mac\/.*qwen/i, "Mac · Qwen"],
  [/^mac\//i, "Mac · oMLX"],
  [/^air\/.*9b/i, "Air · Qwen 9B"],
  [/^air\//i, "Air · oMLX"],
  [/^blade\/.*9b/i, "Blade · 9B"],
  [/^blade\//i, "Blade · RTX"],
  [/^colab\/.*smart-auto/i, "Colab · Auto"],
  [/^colab\/.*(qwen3-coder|80b)/i, "Colab · 80B"],
  [/^colab\/.*72b/i, "Colab · 72B"],
  [/^colab\//i, "Colab · G4"],
  [/opus/i, "Claude · Opus"],
  [/sonnet/i, "Claude · Sonnet"],
  [/haiku/i, "Claude · Haiku"],
  [/gemini.*pro/i, "Gemini Pro"],
  [/gemini.*flash/i, "Gemini Flash"],
  [/gemini/i, "Gemini"],
];

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  antigravity: "Antigravity",
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
};

/**
 * Turn raw Paseo provider + model identifiers into a short, readable badge
 * so Julien can immediately distinguish which model/machine owns a session
 * (instead of seeing the repo name repeated 7 times).
 */
export function formatSessionModelBadge(provider?: string | null, model?: string | null): string {
  const rawModel = (model ?? "").trim();

  if (rawModel.length > 0) {
    for (const [pattern, label] of MODEL_BADGE_RULES) {
      if (pattern.test(rawModel)) {
        return label;
      }
    }
    const tail = rawModel.split("/").pop() ?? rawModel;
    return tail.length > 20 ? `${tail.slice(0, 19)}…` : tail;
  }

  const normalizedProvider = (provider ?? "").trim().toLowerCase();
  return PROVIDER_LABELS[normalizedProvider] ?? provider?.trim() ?? "";
}

/**
 * Extract a short single-line preview of the most recent user or assistant
 * message in a session's timeline stream so each sidebar row shows real
 * conversation context.
 */
export function extractLastSessionPreview(
  tail: readonly StreamItem[] | undefined,
  head: readonly StreamItem[] | undefined,
): string | null {
  const lists = [tail, head];
  for (const list of lists) {
    if (!list || list.length === 0) continue;
    for (let i = list.length - 1; i >= 0; i--) {
      const item = list[i];
      if (!item) continue;
      if (item.kind === "assistant_message" || item.kind === "user_message") {
        const cleaned = item.text
          .replace(/```[\s\S]*?```/g, "")
          .replace(/[#*_`>[\]]+/g, "")
          .replace(/https?:\/\/\S+|file:\/\/\S+/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (cleaned.length > 0) {
          return cleaned.length > 72 ? `${cleaned.slice(0, 71)}…` : cleaned;
        }
      }
    }
  }
  return null;
}
