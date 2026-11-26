export interface ModelSelectorMeta {
  /** Short French summary of strengths & context window. */
  summary: string;
  /** Indicative API or local cost (per 1M tokens in/out, or free/CU). */
  price: string;
  /** Direct comparison against Anthropic Claude models. */
  claudeCompare: string;
}

interface ModelMetaRule {
  match: (provider: string, id: string, label: string) => boolean;
  meta: ModelSelectorMeta;
}

const MODEL_META_RULES: readonly ModelMetaRule[] = [
  // Google Gemini 4 family (Antigravity / Gemini API)
  {
    match: (_p, id, l) => id.includes("gemini-4-neon") || l.includes("gemini 4 neon"),
    meta: {
      summary: "Code & raisonnement avancé (1M ctx)",
      price: "$3 / $15 par 1M (inclus Antigravity)",
      claudeCompare: "vs Claude : ≈ Opus 5.5 (-25 % moins cher)",
    },
  },
  {
    match: (_p, id, l) => id.includes("gemini-4-hydrogen") || l.includes("gemini 4 hydrogen"),
    meta: {
      summary: "Rapide & léger au quotidien (1M ctx)",
      price: "~$1.50 / $7.50 par 1M (inclus Antigravity)",
      claudeCompare: "vs Claude : ≈ Sonnet 5.5 (plus rapide, moins cher)",
    },
  },
  {
    match: (_p, id, l) => id.includes("gemini-4-argon") || l.includes("gemini 4 argon"),
    meta: {
      summary: "Stable & gros contexte (1M ctx)",
      price: "~$2–3 / $10–15 par 1M",
      claudeCompare: "vs Claude : ≈ Sonnet 5.5",
    },
  },
  {
    match: (_p, id, l) => id.includes("gemini-4-carbon") || l.includes("gemini 4 carbon"),
    meta: {
      summary: "Raisonnement profond long horizon (1M ctx)",
      price: "Gamme Frontier Google",
      claudeCompare: "vs Claude : ≈ Opus 5.5 / Fable 5.2",
    },
  },
  // Google Gemini 3 / 2.5 families
  {
    match: (_p, id, l) =>
      (id.includes("gemini-3") || l.includes("gemini 3")) &&
      (id.includes("pro") || l.includes("pro")),
    meta: {
      summary: "Raisonnement & multimodal 1M ctx",
      price: "$2 / $12 par 1M (>$200K : $4/$18)",
      claudeCompare: "vs Claude : ≈ 2× moins cher qu'Opus 5.5",
    },
  },
  {
    match: (_p, id, l) =>
      (id.includes("gemini-2.5") || l.includes("gemini 2.5")) &&
      (id.includes("pro") || l.includes("pro")),
    meta: {
      summary: "Pro 1M ctx (gén. précédente)",
      price: "$1.25 / $10 par 1M",
      claudeCompare: "vs Claude : ~2× moins cher que Sonnet, ~3× qu'Opus",
    },
  },
  {
    match: (_p, id, l) =>
      id.includes("flash-lite") || l.includes("flash-lite") || l.includes("flash lite"),
    meta: {
      summary: "Ultra-rapide & très économique",
      price: "$0.10–$0.30 / $0.40–$2.50 par 1M",
      claudeCompare: "vs Claude : ≈ Haiku 5.5",
    },
  },
  {
    match: (_p, id, l) =>
      (id.includes("gemini") || l.includes("gemini")) &&
      (id.includes("flash") || l.includes("flash")),
    meta: {
      summary: "Très rapide, multimodal & 1M ctx",
      price: "$0.30–$1.50 / $2.50–$7.50 par 1M",
      claudeCompare: "vs Claude : plus rapide & moins cher que Sonnet",
    },
  },
  // Anthropic Claude family
  {
    match: (_p, id, l) => id.includes("fable") || l.includes("fable"),
    meta: {
      summary: "Agents autonomes ultra-complexes (1M ctx)",
      price: "$8 / $40 par 1M",
      claudeCompare: "Sommet Anthropic (~2,7× le prix de Gemini 4 Neon)",
    },
  },
  {
    match: (_p, id, l) => id.includes("opus") || l.includes("opus"),
    meta: {
      summary: "Top architecture & code chirurgical (1M ctx)",
      price: "$4–$5 / $20–$25 par 1M",
      claudeCompare: "Référence Anthropic (+33 % vs Gemini 4 Neon)",
    },
  },
  {
    match: (_p, id, l) => id.includes("sonnet") || l.includes("sonnet"),
    meta: {
      summary: "Équilibre vitesse / qualité de code (1M ctx)",
      price: "$2–$3 / $10–$15 par 1M",
      claudeCompare: "Référence quotidienne Anthropic (≈ Gemini 4 Hydrogen/Argon)",
    },
  },
  {
    match: (_p, id, l) => id.includes("haiku") || l.includes("haiku"),
    meta: {
      summary: "Ultra-rapide & faible coût",
      price: "$0.10–$1 / $0.50–$5 par 1M",
      claudeCompare: "Référence rapide Anthropic (≈ Gemini Flash-Lite)",
    },
  },
  // Homelab Colab & Local GPU models (OpenCode)
  {
    match: (_p, id) => id.includes("colab/") && id.includes("smart-auto"),
    meta: {
      summary: "Routeur auto Mac 8-bit ↔ Colab G4",
      price: "0 $ API (auto-routé)",
      claudeCompare: "vs Claude : gratuit en API, bascule auto selon charge",
    },
  },
  {
    match: (_p, id, l) =>
      (id.includes("colab/") || l.includes("colab")) &&
      (id.includes("qwen3-coder") || id.includes("80b") || l.includes("80b")),
    meta: {
      summary: "Colab G4 96 Go · Qwen3 Coder 80B (128K ctx)",
      price: "0 $ API (~11.2 CU/h Colab)",
      claudeCompare: "vs Claude : proche Sonnet en code, 0 $ de tokens",
    },
  },
  {
    match: (_p, id, l) =>
      (id.includes("colab/") || l.includes("colab")) && (id.includes("72b") || l.includes("72b")),
    meta: {
      summary: "Colab G4 96 Go · Qwen 2.5 72B",
      price: "0 $ API (~11.2 CU/h Colab)",
      claudeCompare: "vs Claude : gros raisonnement local, 0 $ de tokens",
    },
  },
  {
    match: (_p, id) => id.includes("mac/") || id.includes("qwen3.8-27b"),
    meta: {
      summary: "MacBook Pro M4 Max · Qwen 27B 8-bit",
      price: "0 $ (local illimité)",
      claudeCompare: "vs Claude : entre Haiku et Sonnet, 100 % privé",
    },
  },
  {
    match: (_p, id, l) =>
      id.includes("evo-local/") || id.includes("gemma-4") || l.includes("gemma 4"),
    meta: {
      summary: "EVO ROCm local · Google Gemma 4 26B",
      price: "0 $ (local illimité)",
      claudeCompare: "vs Claude : open-weights Google, ≈ Haiku+",
    },
  },
  {
    match: (_p, id) => id.includes("air/"),
    meta: {
      summary: "MacBook Air M2 · Qwen 9B rapide",
      price: "0 $ (local illimité)",
      claudeCompare: "vs Claude : exploration rapide (≈ Haiku)",
    },
  },
  {
    match: (_p, id) => id.includes("blade/"),
    meta: {
      summary: "Razer Blade RTX · Qwen 9B vérif",
      price: "0 $ (local illimité)",
      claudeCompare: "vs Claude : contrôles rapides (≈ Haiku)",
    },
  },
  // OpenAI / Codex
  {
    match: (p, id, l) =>
      p === "codex" || id.includes("gpt-5") || id.includes("codex") || l.includes("gpt-5"),
    meta: {
      summary: "Code & raisonnement OpenAI / Codex",
      price: "~$1.25–$5 / $10–$20 par 1M",
      claudeCompare: "vs Claude : concurrent direct Sonnet / Opus",
    },
  },
  // Generic Gemini fallback
  {
    match: (p, id, l) => p === "antigravity" || id.includes("gemini") || l.includes("gemini"),
    meta: {
      summary: "Modèle Google Gemini (1M ctx, multimodal)",
      price: "Inclus Antigravity / ~$1.50–$3 par 1M API",
      claudeCompare: "vs Claude : souvent 25–50 % moins cher en API",
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
