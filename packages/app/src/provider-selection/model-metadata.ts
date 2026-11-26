export interface ModelSelectorMeta {
  /** Short French summary of strengths & context window. */
  summary: string;
  /** Subscription quota / Compute Units impact (calibrated for Google AI Ultra & Claude Ultra). */
  price: string;
  /** Direct comparison against Anthropic Claude (or Google Gemini) models. */
  claudeCompare: string;
}

interface ModelMetaRule {
  match: (provider: string, id: string, label: string) => boolean;
  meta: ModelSelectorMeta;
}

const MODEL_META_RULES: readonly ModelMetaRule[] = [
  // Google Gemini 4 family (Antigravity — Google AI Ultra)
  {
    match: (_p, id, l) => id.includes("gemini-4-neon") || l.includes("gemini 4 neon"),
    meta: {
      summary: "Code & raisonnement avancé (1M ctx)",
      price: "Inclus Google AI Ultra · Quota moyen",
      claudeCompare: "vs Claude : ≈ Opus 5.5 (plus rapide, ~25 % plus économe)",
    },
  },
  {
    match: (_p, id, l) => id.includes("gemini-4-hydrogen") || l.includes("gemini 4 hydrogen"),
    meta: {
      summary: "Rapide & léger au quotidien (1M ctx)",
      price: "Inclus Google AI Ultra · Quota léger",
      claudeCompare: "vs Claude : ≈ Sonnet 5.5 (~2× plus léger que Neon)",
    },
  },
  {
    match: (_p, id, l) => id.includes("gemini-4-argon") || l.includes("gemini 4 argon"),
    meta: {
      summary: "Stable & gros contexte (1M ctx)",
      price: "Inclus Google AI Ultra · Quota moyen",
      claudeCompare: "vs Claude : ≈ Sonnet 5.5",
    },
  },
  {
    match: (_p, id, l) => id.includes("gemini-4-carbon") || l.includes("gemini 4 carbon"),
    meta: {
      summary: "Raisonnement profond long horizon (1M ctx)",
      price: "Inclus Google AI Ultra · Quota élevé",
      claudeCompare: "vs Claude : ≈ Opus 5.5 / Fable 5.2 (tâches très dures)",
    },
  },
  // Google Gemini 3 / 2.5 families
  {
    match: (_p, id, l) =>
      (id.includes("gemini-3") || l.includes("gemini 3")) &&
      (id.includes("pro") || l.includes("pro")),
    meta: {
      summary: "Raisonnement & multimodal 1M ctx",
      price: "Inclus Google AI Ultra · Quota moyen",
      claudeCompare: "vs Claude : niveau Sonnet/Opus (~2× plus léger qu'Opus)",
    },
  },
  {
    match: (_p, id, l) =>
      (id.includes("gemini-2.5") || l.includes("gemini 2.5")) &&
      (id.includes("pro") || l.includes("pro")),
    meta: {
      summary: "Pro 1M ctx (gén. précédente)",
      price: "Inclus Google AI Ultra · Quota léger",
      claudeCompare: "vs Claude : ≈ Sonnet 4 (très économe en quota)",
    },
  },
  {
    match: (_p, id, l) =>
      id.includes("flash-lite") || l.includes("flash-lite") || l.includes("flash lite"),
    meta: {
      summary: "Ultra-rapide & très économe",
      price: "Inclus Google AI Ultra · Quota minime",
      claudeCompare: "vs Claude : ≈ Haiku 5.5",
    },
  },
  {
    match: (_p, id, l) =>
      (id.includes("gemini") || l.includes("gemini")) &&
      (id.includes("flash") || l.includes("flash")),
    meta: {
      summary: "Très rapide, multimodal & 1M ctx",
      price: "Inclus Google AI Ultra · Quota léger",
      claudeCompare: "vs Claude : plus rapide & plus économe que Sonnet",
    },
  },
  // Anthropic Claude family (Claude Ultra)
  {
    match: (_p, id, l) => id.includes("fable") || l.includes("fable"),
    meta: {
      summary: "Agents autonomes ultra-complexes (1M ctx)",
      price: "Inclus Claude Ultra · Quota très élevé (max 50% hebdo)",
      claudeCompare: "Sommet Anthropic (~2× le quota d'Opus, ≈ Gemini 4 Carbon)",
    },
  },
  {
    match: (_p, id, l) => id.includes("opus") || l.includes("opus"),
    meta: {
      summary: "Top architecture & code chirurgical (1M ctx)",
      price: "Inclus Claude Ultra · Quota élevé (sans limite 5h)",
      claudeCompare: "Référence Anthropic (≈ Gemini 4 Neon, ~2× le quota de Sonnet)",
    },
  },
  {
    match: (_p, id, l) => id.includes("sonnet") || l.includes("sonnet"),
    meta: {
      summary: "Équilibre vitesse / qualité de code (1M ctx)",
      price: "Inclus Claude Ultra · Quota moyen (sans limite 5h)",
      claudeCompare: "Quotidien Anthropic (≈ Gemini 4 Hydrogen / Argon)",
    },
  },
  {
    match: (_p, id, l) => id.includes("haiku") || l.includes("haiku"),
    meta: {
      summary: "Ultra-rapide & léger",
      price: "Inclus Claude Ultra · Quota minime",
      claudeCompare: "Rapide Anthropic (≈ Gemini Flash-Lite)",
    },
  },
  // Homelab Colab & Local GPU models (OpenCode)
  {
    match: (_p, id) => id.includes("colab/") && id.includes("smart-auto"),
    meta: {
      summary: "Routeur auto Mac 8-bit ↔ Colab G4",
      price: "0 % quota cloud · Auto-routé",
      claudeCompare: "vs Claude : bascule auto local / Colab G4 selon charge",
    },
  },
  {
    match: (_p, id, l) =>
      (id.includes("colab/") || l.includes("colab")) &&
      (id.includes("qwen3-coder") || id.includes("80b") || l.includes("80b")),
    meta: {
      summary: "Colab G4 96 Go · Qwen3 Coder 80B (128K ctx)",
      price: "Inclus Google AI Ultra (~11.2 CU/h, 0 % quota)",
      claudeCompare: "vs Claude : proche Sonnet en code (préserve Claude Ultra)",
    },
  },
  {
    match: (_p, id, l) =>
      (id.includes("colab/") || l.includes("colab")) && (id.includes("72b") || l.includes("72b")),
    meta: {
      summary: "Colab G4 96 Go · Qwen 2.5 72B",
      price: "Inclus Google AI Ultra (~11.2 CU/h, 0 % quota)",
      claudeCompare: "vs Claude : gros raisonnement hors quota Claude Ultra",
    },
  },
  {
    match: (_p, id) => id.includes("mac/") || id.includes("qwen3.8-27b"),
    meta: {
      summary: "MacBook Pro M4 Max · Qwen 27B 8-bit",
      price: "0 % quota · 0 CU (local illimité)",
      claudeCompare: "vs Claude : entre Haiku et Sonnet, 100 % privé",
    },
  },
  {
    match: (_p, id, l) =>
      id.includes("evo-local/") || id.includes("gemma-4") || l.includes("gemma 4"),
    meta: {
      summary: "EVO ROCm local · Google Gemma 4 26B",
      price: "0 % quota · 0 CU (local illimité)",
      claudeCompare: "vs Claude : open-weights Google, ≈ Haiku+",
    },
  },
  {
    match: (_p, id) => id.includes("air/"),
    meta: {
      summary: "MacBook Air M2 · Qwen 9B rapide",
      price: "0 % quota · 0 CU (local illimité)",
      claudeCompare: "vs Claude : exploration rapide (≈ Haiku)",
    },
  },
  {
    match: (_p, id) => id.includes("blade/"),
    meta: {
      summary: "Razer Blade RTX · Qwen 9B vérif",
      price: "0 % quota · 0 CU (local illimité)",
      claudeCompare: "vs Claude : contrôles rapides (≈ Haiku)",
    },
  },
  // OpenAI / Codex
  {
    match: (p, id, l) =>
      p === "codex" || id.includes("gpt-5") || id.includes("codex") || l.includes("gpt-5"),
    meta: {
      summary: "Code & raisonnement OpenAI / Codex",
      price: "Inclus quota Codex",
      claudeCompare: "vs Claude : concurrent direct Sonnet / Opus",
    },
  },
  // Generic Gemini fallback
  {
    match: (p, id, l) => p === "antigravity" || id.includes("gemini") || l.includes("gemini"),
    meta: {
      summary: "Modèle Google Gemini (1M ctx, multimodal)",
      price: "Inclus Google AI Ultra",
      claudeCompare: "vs Claude : quota très large sur Google AI Ultra",
    },
  },
];

export function getModelSelectorMeta(
  provider: string,
  modelId: string,
  modelLabel: string,
): ModelSelectorMeta | null {
  const p = provider.trim().toLowerCase();
  const id = modelId.trim().toLowerCase();
  const l = modelLabel.trim().toLowerCase();
  if (!id && !l) return null;

  for (const rule of MODEL_META_RULES) {
    if (rule.match(p, id, l)) {
      return rule.meta;
    }
  }
  return null;
}
