import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type TemplateUniverse = "colab" | "local";
export type QuantOption = "Q4_K_M" | "Q6_K" | "Q8_0" | "default";
export type ColabGpuTier = "L4" | "A100" | "G4";

export interface ScenarioTemplate {
  id: string;
  name: string;
  description: string;
  universe: TemplateUniverse;
  providerId: string;
  modelId: string;
  quant: QuantOption;
  gpuTier?: ColabGpuTier;
  systemPrompt: string;
  skillIds: string[];
  mcpIds: string[];
  builtIn?: boolean;
  updatedAt: string;
}

export interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
  scope: "both" | TemplateUniverse;
  builtIn?: boolean;
  updatedAt: string;
}

export interface McpTemplate {
  id: string;
  name: string;
  serverName: string;
  description: string;
  transport: "http" | "stdio";
  target: string;
  scope: "both" | TemplateUniverse;
  enabledByDefault: boolean;
  builtIn?: boolean;
  updatedAt: string;
}

export interface HomelabTemplatesStoreData {
  version: 1;
  scenarios: ScenarioTemplate[];
  skills: SkillTemplate[];
  mcps: McpTemplate[];
  updatedAt: string;
}

export interface ProviderModelSpec {
  id: string;
  label: string;
  universe: TemplateUniverse;
  providerId: string;
  modelId: string;
  defaultQuant: QuantOption;
  supportedQuants: QuantOption[];
  vramGbByQuant: Partial<Record<QuantOption, number>>;
}

export const COLAB_MAX_SLOTS = 2;

export const COLAB_GPU_TIERS: ReadonlyArray<{
  tier: ColabGpuTier;
  label: string;
  vramGb: number;
  relativeCostRank: number;
}> = [
  { tier: "L4", label: "L4 · 24 Go (économique)", vramGb: 24, relativeCostRank: 1 },
  { tier: "A100", label: "A100 · 80 Go (recommandé 80B Q4)", vramGb: 80, relativeCostRank: 2 },
  { tier: "G4", label: "G4 · 96 Go (lourd)", vramGb: 96, relativeCostRank: 3 },
];

export const PROVIDER_CATALOG: ReadonlyArray<ProviderModelSpec> = [
  {
    id: "colab-qwen3-coder-next",
    label: "Colab · Qwen3 Coder Next 80B",
    universe: "colab",
    providerId: "opencode",
    modelId: "colab/qwen3-coder-next",
    defaultQuant: "Q4_K_M",
    supportedQuants: ["Q4_K_M", "Q6_K", "Q8_0"],
    vramGbByQuant: { Q4_K_M: 52, Q6_K: 68, Q8_0: 88 },
  },
  {
    id: "colab-qwen25-72b",
    label: "Colab · Qwen 2.5 72B",
    universe: "colab",
    providerId: "opencode",
    modelId: "colab/qwen2.5:72b",
    defaultQuant: "Q4_K_M",
    supportedQuants: ["Q4_K_M", "Q6_K"],
    vramGbByQuant: { Q4_K_M: 48, Q6_K: 64 },
  },
  {
    id: "colab-qwen3-32b",
    label: "Colab · Qwen 3 32B (éco L4)",
    universe: "colab",
    providerId: "opencode",
    modelId: "colab/qwen3:32b",
    defaultQuant: "Q4_K_M",
    supportedQuants: ["Q4_K_M", "Q6_K"],
    vramGbByQuant: { Q4_K_M: 21, Q6_K: 28 },
  },
  {
    id: "local-mac-27b",
    label: "MacBook Pro · 27B 8-bit",
    universe: "local",
    providerId: "opencode",
    modelId: "mac/qwen3.8-27b-abliterated",
    defaultQuant: "default",
    supportedQuants: ["default"],
    vramGbByQuant: {},
  },
  {
    id: "local-evo-gemma4",
    label: "EVO · Gemma 4 local",
    universe: "local",
    providerId: "opencode",
    modelId: "evo/gemma4:latest",
    defaultQuant: "default",
    supportedQuants: ["default"],
    vramGbByQuant: {},
  },
  {
    id: "local-air-9b",
    label: "MacBook Air · 9B Explore",
    universe: "local",
    providerId: "opencode",
    modelId: "air/qwen3.5-9b-abliterated",
    defaultQuant: "default",
    supportedQuants: ["default"],
    vramGbByQuant: {},
  },
  {
    id: "local-blade-9b",
    label: "Blade · 9B Verify",
    universe: "local",
    providerId: "opencode",
    modelId: "blade/huihui_ai/qwen3.5-abliterated:9b",
    defaultQuant: "default",
    supportedQuants: ["default"],
    vramGbByQuant: {},
  },
  {
    id: "cloud-antigravity-hydrogen",
    label: "Antigravity · Gemini 4 Hydrogen",
    universe: "local",
    providerId: "antigravity",
    modelId: "gemini-4-hydrogen",
    defaultQuant: "default",
    supportedQuants: ["default"],
    vramGbByQuant: {},
  },
  {
    id: "cloud-claude-sonnet",
    label: "Claude Code · Sonnet",
    universe: "local",
    providerId: "claude",
    modelId: "claude-sonnet-4-20250514",
    defaultQuant: "default",
    supportedQuants: ["default"],
    vramGbByQuant: {},
  },
  {
    id: "cloud-codex",
    label: "Codex · GPT-5.4",
    universe: "local",
    providerId: "codex",
    modelId: "gpt-5.4",
    defaultQuant: "default",
    supportedQuants: ["default"],
    vramGbByQuant: {},
  },
];

export const COLAB_ISOLATION_GUARD_PROMPT = [
  "RÈGLE IMPÉRATIVE COLAB (ZÉRO HYBRIDE LOCAL) :",
  "- Tu tournes exclusivement sur GPU Google Colab (facturé à l'heure, max 2 slots parallèles).",
  "- INTERDICTION STRICTE de déléguer à des sous-agents locaux (MacBook Air 9B / scout, EVO, Blade, Mac) qui laisseraient le GPU Colab tourner à vide.",
  "- Travaille de façon autonome et directe dans ce workspace sans sous-agent local.",
].join("\n");

/**
 * Picks the cheapest Colab GPU tier that fits the model + chosen quantization with headroom
 * for 2 parallel 128K slots.
 */
export function selectCheapestCompatibleColabGpu(
  modelId: string,
  quant: QuantOption,
): ColabGpuTier {
  const spec = PROVIDER_CATALOG.find(
    (entry) => entry.universe === "colab" && entry.modelId === modelId,
  );
  const requiredVram = spec?.vramGbByQuant[quant] ?? spec?.vramGbByQuant[spec.defaultQuant] ?? 52;
  // Reserve ~8 GB headroom for KV cache across 2 concurrent slots.
  const neededWithHeadroom = requiredVram + 8;
  for (const tier of COLAB_GPU_TIERS) {
    if (tier.vramGb >= neededWithHeadroom) {
      return tier.tier;
    }
  }
  return "G4";
}

export function evaluateColabSlotGuard(
  activeColabAgents: number,
  inFlight: number,
): {
  allowed: boolean;
  usedSlots: number;
  maxSlots: number;
  reason?: string;
} {
  const usedSlots = Math.max(activeColabAgents, inFlight);
  if (usedSlots >= COLAB_MAX_SLOTS) {
    return {
      allowed: false,
      usedSlots,
      maxSlots: COLAB_MAX_SLOTS,
      reason: `Verrou Colab actif : ${usedSlots}/${COLAB_MAX_SLOTS} slots déjà occupés. Termine ou arrête un agent Colab avant d'en lancer un autre.`,
    };
  }
  return {
    allowed: true,
    usedSlots,
    maxSlots: COLAB_MAX_SLOTS,
  };
}

export function buildDefaultTemplatesData(): HomelabTemplatesStoreData {
  const now = new Date().toISOString();
  return {
    version: 1,
    updatedAt: now,
    scenarios: [
      {
        id: "scn-colab-boss",
        name: "Colab Boss 80B · Code & Reverse",
        description:
          "Agent autonome sur Colab Q4_K_M (A100 80G, max 2 slots, zéro délégation locale).",
        universe: "colab",
        providerId: "opencode",
        modelId: "colab/qwen3-coder-next",
        quant: "Q4_K_M",
        gpuTier: "A100",
        systemPrompt:
          "Tu es un ingénieur senior autonome exécutant sur GPU Colab. Avance par étapes concrètes vérifiées par tests et builds sans attendre de sous-agent externe.",
        skillIds: ["skill-reverse-osint", "skill-rust-embedded"],
        mcpIds: ["mcp-paseo"],
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "scn-colab-eco",
        name: "Colab Éco 32B · L4 24G",
        description: "Tâches ciblées rapides sur GPU L4 économique en Q4_K_M.",
        universe: "colab",
        providerId: "opencode",
        modelId: "colab/qwen3:32b",
        quant: "Q4_K_M",
        gpuTier: "L4",
        systemPrompt:
          "Tu es un développeur rapide et précis. Va droit au but, édite proprement et vérifie chaque changement.",
        skillIds: [],
        mcpIds: ["mcp-paseo"],
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "scn-colab-reverse",
        name: "Colab Reverse Firmware & Décompil",
        description: "A100/G4 Q4_K_M · Ghidra, JADX, re-toolbox:local, zéro délégation locale.",
        universe: "colab",
        providerId: "opencode",
        modelId: "colab/qwen3-coder-next",
        quant: "Q4_K_M",
        gpuTier: "A100",
        systemPrompt:
          "Analyse binaire/firmware (ARM64/ARM/APK). Cite uniquement octets, offsets et symboles vérifiés via pyghidra/jadx/re-toolbox. Zéro stub silencieux, vérification CVE NVD obligatoire.",
        skillIds: ["skill-android-firmware-re", "skill-ctf-reverse", "skill-multilingual-osint"],
        mcpIds: ["mcp-pyghidra", "mcp-jadx", "mcp-osint", "mcp-searxng"],
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "scn-colab-exploit",
        name: "Colab Sécurité / Exploit / Audit",
        description: "A100 Q4_K_M · Pwn, Crypto, Forensics & Firmware RE.",
        universe: "colab",
        providerId: "opencode",
        modelId: "colab/qwen3-coder-next",
        quant: "Q4_K_M",
        gpuTier: "A100",
        systemPrompt:
          "Audit sécurité et exploitation binaire (ROP, heap, kernel, crypto). Reproduis chaque vulnérabilité par PoC vérifié, sans boucle ni délégation locale.",
        skillIds: [
          "skill-ctf-pwn",
          "skill-ctf-crypto",
          "skill-ctf-forensics",
          "skill-android-firmware-re",
        ],
        mcpIds: ["mcp-pyghidra", "mcp-jadx"],
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "scn-colab-osint",
        name: "Colab OSINT & Recherche Poussée",
        description: "L4 Q4_K_M · Recherche multilingue EN/ZH/RU, 37 outils OSINT + SearXNG.",
        universe: "colab",
        providerId: "opencode",
        modelId: "colab/qwen3:32b",
        quant: "Q4_K_M",
        gpuTier: "L4",
        systemPrompt:
          "Mode anti-hallucination OSINT : ne jamais inventer de fait, toujours citer l'outil utilisé et l'URL exacte. Croiser EN + Chinois simplifié + Russe.",
        skillIds: ["skill-multilingual-osint", "skill-ctf-osint", "skill-deep-research"],
        mcpIds: ["mcp-osint", "mcp-searxng"],
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "scn-local-mac-dev",
        name: "Local Mac 27B · Dev complet",
        description: "Travail local gratuit et rapide sur MacBook Pro M4 Max (27B 8-bit).",
        universe: "local",
        providerId: "opencode",
        modelId: "mac/qwen3.8-27b-abliterated",
        quant: "default",
        systemPrompt:
          "Tu développes en local sur la flotte EVO/Mac sans utiliser Colab. Respecte la limite -j4 sur EVO et déporte les builds lourds sur ssh mac.",
        skillIds: ["skill-rust-embedded"],
        mcpIds: ["mcp-paseo", "mcp-homelab"],
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "scn-local-hydrogen",
        name: "Cloud · Gemini 4 Hydrogen",
        description: "Architecture, UI complexe et coordination multi-fichiers.",
        universe: "local",
        providerId: "antigravity",
        modelId: "gemini-4-hydrogen",
        quant: "default",
        systemPrompt:
          "Planifie proprement, évite toute duplication, vérifie avec tests/typecheck et déploie les builds Android via ssh mac.",
        skillIds: [],
        mcpIds: ["mcp-homelab"],
        builtIn: true,
        updatedAt: now,
      },
    ],
    skills: [
      {
        id: "skill-reverse-osint",
        name: "OSINT & Reverse Multilingue",
        description: "Méthodologie d'analyse binaire, firmware et recherche multilingue.",
        content:
          "Cite uniquement les octets, offsets, symboles et commandes observés. Documente chaque piste vérifiée.",
        scope: "both",
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "skill-rust-embedded",
        name: "Rust / Embarqué / C++",
        description: "Bonnes pratiques mémoire, cross-compilation ARM64 et tests.",
        content:
          "Privilégie zéro copie inutile, gestion d'erreur explicite (Result), et tests unitaires ciblés.",
        scope: "both",
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "skill-android-firmware-re",
        name: "android-firmware-re",
        description: "Boot/vendor_boot/vbmeta, ARM64/ARM, APKs, EDL 9008, Trusty OS, triage CVE.",
        content:
          "Applique le skill android-firmware-re (~/.config/opencode/skills/android-firmware-re) : analyse boot/vendor_boot/vbmeta/Trusty OS et triage CVE kernel.",
        scope: "both",
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "skill-multilingual-osint",
        name: "multilingual-osint",
        description: "Recherche EN + Chinois simplifié + Russe (GitHub, Gitee, 4PDA, NVD).",
        content:
          "Applique le skill multilingual-osint : requêtes croisées EN/ZH/RU sur GitHub, Bilibili, Gitee, Coolapk, XDA, 4PDA et NVD.",
        scope: "both",
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "skill-ctf-reverse",
        name: "ctf-reverse",
        description: "Décompilation & rétro-ingénierie ELF, APK, WASM, firmware, anti-debug.",
        content:
          "Applique le skill ctf-reverse : décompilation méthodique, recherche xrefs et analyse de bytecode/VM.",
        scope: "both",
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "skill-ctf-pwn",
        name: "ctf-pwn",
        description: "Exploitation binaire (heap, ROP, ret2libc, kernel, sandbox escape).",
        content:
          "Applique le skill ctf-pwn : analyse des protections (NX/ASLR/PIE/RELRO) et PoC reproductible.",
        scope: "both",
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "skill-ctf-forensics",
        name: "ctf-forensics",
        description: "Dumps mémoire/disque, PCAP, stégano, side-channel.",
        content: "Applique le skill ctf-forensics pour l'analyse de dumps, PCAP et signaux.",
        scope: "both",
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "skill-ctf-crypto",
        name: "ctf-crypto",
        description: "Attaques RSA, AES, ECC, lattices, LWE, padding oracle, PRNG.",
        content: "Applique le skill ctf-crypto pour la cryptanalyse et l'audit d'implémentations.",
        scope: "both",
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "skill-ctf-osint",
        name: "ctf-osint",
        description: "Géoloc, DNS, reverse image, dorking, Wayback, hashes.",
        content: "Applique le skill ctf-osint avec preuves vérifiables (URL + outil).",
        scope: "both",
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "skill-deep-research",
        name: "deep-research",
        description: "Recherche approfondie multi-sources et synthèse structurée.",
        content: "Applique le skill deep-research pour croiser et vérifier les sources.",
        scope: "both",
        builtIn: true,
        updatedAt: now,
      },
    ],
    mcps: [
      {
        id: "mcp-paseo",
        name: "Paseo Session Tools",
        serverName: "paseo",
        description: "Gestion des sessions et épinglage dans Paseo.",
        transport: "stdio",
        target: "internal:paseo",
        scope: "both",
        enabledByDefault: true,
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "mcp-pyghidra",
        name: "PyGhidra (Blade)",
        serverName: "pyghidra",
        description: "Ghidra headless + recherche sémantique (ARM64/ARM, .ko, .so) sur Blade.",
        transport: "http",
        target: "http://100.67.68.24:8766/mcp",
        scope: "both",
        enabledByDefault: false,
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "mcp-jadx",
        name: "JADX (Blade)",
        serverName: "jadx",
        description: "JADX headless pour décompilation/audit APK Android sur Blade.",
        transport: "http",
        target: "http://100.67.68.24:8767/mcp",
        scope: "both",
        enabledByDefault: false,
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "mcp-osint",
        name: "OSINT 37 outils (Blade)",
        serverName: "osint",
        description: "Sherlock, Maigret, Holehe, Shodan, Subfinder, Playwright sur Blade.",
        transport: "http",
        target: "http://100.67.68.24:8765/mcp",
        scope: "both",
        enabledByDefault: false,
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "mcp-searxng",
        name: "SearXNG (EVO)",
        serverName: "searxng",
        description: "Moteur de recherche web local auto-hébergé sur EVO.",
        transport: "http",
        target: "http://100.83.26.111:18798",
        scope: "both",
        enabledByDefault: false,
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "mcp-homelab",
        name: "Homelab Gateway",
        serverName: "homelab",
        description: "Domotique, téléphone/tablette ADB, agenda, fichiers et chronique.",
        transport: "http",
        target: "http://100.83.26.111:18890/mcp",
        scope: "local",
        enabledByDefault: true,
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "mcp-osint",
        name: "OSINT Recon",
        serverName: "osint",
        description: "Outils de recherche web, GitHub, DNS, metadata et binaires.",
        transport: "stdio",
        target: "internal:osint",
        scope: "both",
        enabledByDefault: false,
        builtIn: true,
        updatedAt: now,
      },
    ],
  };
}

function resolveTemplatesPath(paseoHome: string): string {
  return path.join(paseoHome, "homelab-templates.json");
}

export async function readHomelabTemplates(paseoHome: string): Promise<HomelabTemplatesStoreData> {
  const filePath = resolveTemplatesPath(paseoHome);
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<HomelabTemplatesStoreData>;
    if (
      parsed &&
      Array.isArray(parsed.scenarios) &&
      Array.isArray(parsed.skills) &&
      Array.isArray(parsed.mcps)
    ) {
      return {
        version: 1,
        scenarios: parsed.scenarios,
        skills: parsed.skills,
        mcps: parsed.mcps,
        updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      };
    }
  } catch {
    // Initialize defaults cleanly on first read.
  }
  const defaults = buildDefaultTemplatesData();
  await writeHomelabTemplates(paseoHome, defaults);
  return defaults;
}

export async function writeHomelabTemplates(
  paseoHome: string,
  data: HomelabTemplatesStoreData,
): Promise<void> {
  const filePath = resolveTemplatesPath(paseoHome);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
  await rename(tmpPath, filePath);
}

export function buildEffectiveSystemPrompt(options: {
  universe: TemplateUniverse;
  basePrompt: string;
  selectedSkills: SkillTemplate[];
}): string {
  const parts: string[] = [];
  if (options.universe === "colab") {
    parts.push(COLAB_ISOLATION_GUARD_PROMPT);
  }
  const base = options.basePrompt.trim();
  if (base) {
    parts.push(base);
  }
  if (options.selectedSkills.length > 0) {
    const skillsText = options.selectedSkills
      .map((skill) => `### Skill: ${skill.name}\n${skill.content.trim()}`)
      .join("\n\n");
    parts.push(`## Skills actifs\n${skillsText}`);
  }
  return parts.join("\n\n").trim();
}
