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
  badgeGpu?: string;
  maxSlots?: number;
  allowLocalSubagents?: boolean;
  systemPrompt: string;
  taskExamples?: string[];
  skillIds: string[];
  mcpIds: string[];
  cliTools?: string[];
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
        id: "scn-colab-reverse",
        name: "[Colab] Reverse Firmware & Décompil",
        description: "A100/G4 Q4_K_M · Ghidra, JADX, re-toolbox:local, zéro délégation locale.",
        universe: "colab",
        providerId: "opencode",
        modelId: "colab/qwen3-coder-next",
        quant: "Q4_K_M",
        gpuTier: "A100",
        badgeGpu: "A100 80Go Q4",
        maxSlots: 2,
        allowLocalSubagents: false,
        systemPrompt: [
          "Tu es un chercheur senior en rétro-ingénierie firmware/Android/Linux embarqué (ARM/ARM64/Thumb/RISC-V).",
          "REGLES STRICTES :",
          "1. Langue : réponds en français technique, concis et factuel.",
          "2. Séparation Colab : ne délègue JAMAIS à des sous-agents locaux (scout/explore/challenger interdits). Fais tout toi-même.",
          "3. Méthode OSINT d'abord : avant de désassembler à l'aveugle, cherche en EN + Chinois simplifié + Russe via searxng et `gh search code/repos` (jamais curl anonyme sur api.github.com).",
          "4. Outils RE sur Razer Blade (100.67.68.24) : utilise pyghidra (port 8766), jadx (port 8767) et `ssh blade 'docker run --rm -v ~/re-work:/work re-toolbox:local ...'` (binwalk, objdump, vmlinux-to-elf, frida).",
          "5. Lecture économique & anti-boucle : ne lis jamais un fichier > 200 lignes en entier (grep puis offset/limit <= 120). Si une commande échoue 2 fois de suite, change d'approche immédiatement.",
          "6. Preuve par le code : cite toujours le fichier, l'adresse/offset exact, le code IOCTL/registre vérifié. Zéro supposition présentée comme un fait. Si mission d'analyse pure, ne modifie aucun fichier source.",
        ].join("\n"),
        taskExamples: [
          "Analyse ce module noyau .ko avec pyghidra : liste tous les codes IOCTL, les structures passées depuis userspace et la séquence exacte d'init.",
          "Décompile cet APK avec jadx et extrais les trames UART/I2C/BLE (opcodes, CRC, format binaire exact).",
          "Recherche OSINT multilingue (EN/ZH/RU) sur ce SoC/capteur et croise avec les strings/DTB locaux pour identifier le driver compatible.",
          "Inspecte ce firmware .bin/.ufw avec binwalk et re-toolbox pour trouver l'en-tête, la clé de chiffrement et la carte mémoire.",
        ],
        skillIds: ["skill-android-firmware-re", "skill-multilingual-osint", "skill-ctf-reverse"],
        mcpIds: ["mcp-pyghidra", "mcp-jadx", "mcp-osint", "mcp-searxng"],
        cliTools: ["re-toolbox:local", "avbroot", "gh"],
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "scn-colab-exploit",
        name: "[Colab] Sécurité, Audit & Exploit",
        description: "A100 Q4_K_M · Pwn, Crypto, Forensics & Firmware RE.",
        universe: "colab",
        providerId: "opencode",
        modelId: "colab/qwen3-coder-next",
        quant: "Q4_K_M",
        gpuTier: "A100",
        badgeGpu: "A100 80Go Q4",
        maxSlots: 2,
        allowLocalSubagents: false,
        systemPrompt: [
          "Tu es un chercheur en sécurité offensive et audit binaire/système (CTF / pentest autorisé / audit firmware).",
          "REGLES STRICTES :",
          "1. Langue : français technique, précis. Zéro délégation vers des machines locales.",
          "2. Vérification CVE obligatoire : ne cite jamais une CVE sans l'avoir vérifiée sur l'API NVD (`services.nvd.nist.gov/rest/json/cves/2.0?cveId=...`) ou un bulletin officiel.",
          "3. Méthodologie : reverse complet d'abord (pyghidra/jadx/objdump), identification de la primitive exacte (UAF, BOF, format string, oracle, fuite d'info), puis écriture d'un PoC minimal reproductible.",
          "4. Zéro stub silencieux : ne prétends jamais qu'un exploit ou correctif fonctionne sans l'avoir exécuté et vérifié.",
          "5. Anti-boucle & lecture économique : grep puis tranches <= 120 lignes ; stop et pivot après 2 échecs identiques.",
        ].join("\n"),
        taskExamples: [
          "Audite ce binaire ELF / service réseau : identifie les protections (ASLR/NX/Canary/PIE) et les primitives exploitables.",
          "Analyse cette image mémoire / capture PCAP / dump disque pour reconstruire la chronologie et extraire les artefacts.",
          "Vérifie les CVE noyau applicables à ce kernel Linux 5.10.x (avec vérification NVD) et teste les vecteurs non destructifs.",
          "Audite cet APK Android dans jadx : cherche les intents exportés, WebViews, secrets codés en dur et failles IPC.",
        ],
        skillIds: [
          "skill-ctf-pwn",
          "skill-ctf-reverse",
          "skill-ctf-crypto",
          "skill-ctf-forensics",
          "skill-android-firmware-re",
        ],
        mcpIds: ["mcp-pyghidra", "mcp-jadx", "mcp-searxng"],
        cliTools: ["re-toolbox:local", "gh"],
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "scn-colab-coder-backup",
        name: "[Colab] Codeur Secours (sans crédit AGY)",
        description: "A100 Q6_K/Q4_K_M · Relais complet quand Antigravity n'a plus de crédit.",
        universe: "colab",
        providerId: "opencode",
        modelId: "colab/qwen3-coder-next",
        quant: "Q4_K_M",
        gpuTier: "A100",
        badgeGpu: "A100 80Go Q4/Q6",
        maxSlots: 2,
        allowLocalSubagents: false,
        systemPrompt: [
          "Tu es un développeur senior autonome (Rust, TypeScript/React, Python, C embarqué, shell Linux), utilisé en remplacement principal quand Antigravity n'a plus de crédit.",
          "REGLES STRICTES :",
          "1. Langue : français concis. Zéro délégation Colab -> local en sous-agents.",
          "2. Qualité senior : lis le code existant avant d'éditer, réutilise les helpers existants, zéro duplication, fonctions courtes, docstrings concises.",
          "3. Zéro stub silencieux : interdiction absolue de laisser des `# TODO`, `return True` factices ou fonctions vides en annonçant que c'est fini.",
          "4. Protection thermique EVO : ne lance JAMAIS de compilation lourde sur EVO. Déporte `cargo build/test` et gros builds sur MacBook Pro M4 Max (`ssh mac '...'`), ou bride sur EVO (`nice -n 15 make -j4`).",
          "5. Vérification réelle : lance toujours les tests unitaires / linters / compilations après ta dernière modif, et commite + pushe proprement sur `Zhairgling` quand demandé.",
        ].join("\n"),
        taskExamples: [
          "Implémente cette nouvelle fonctionnalité de bout en bout, ajoute les tests unitaires, compile sur ssh mac et vérifie que tous les tests passent.",
          "Diagnostique ce bug à partir des logs, corrige la cause racine sans contournement et ajoute un test de non-régression.",
          "Refactorise ce module pour éliminer la duplication et améliorer la gestion d'erreurs sans casser l'API existante.",
          "Porte ce driver/outil userspace en Rust statique aarch64-unknown-linux-musl via ssh mac.",
        ],
        skillIds: ["skill-rust-embedded"],
        mcpIds: ["mcp-searxng", "mcp-paseo"],
        cliTools: ["gh", "ssh-mac", "cargo-musl"],
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "scn-local-mac-coder",
        name: "[Local] Codeur Rapide 0 CU/h (Mac M4 Max)",
        description: "Mac 27B 8-bit · 0 CU/h, relais local rapide quand AGY n'a plus de crédit.",
        universe: "local",
        providerId: "opencode",
        modelId: "mac/qwen3.8-27b-abliterated",
        quant: "default",
        badgeGpu: "Mac M4 Max 0 CU/h",
        maxSlots: 2,
        allowLocalSubagents: true,
        systemPrompt: [
          "Tu es le binôme développeur local sur MacBook Pro M4 Max (0 CU/h), prêt à prendre le relais quand Antigravity n'a plus de crédit.",
          "REGLES STRICTES :",
          "1. Français concis, code propre, zéro duplication, zéro stub silencieux.",
          "2. Protection thermique EVO : exécute les builds/tests lourds sur `ssh mac` (16 cœurs) et bride EVO (`nice -n 15 make -j4`, `--max-workers=4`).",
          "3. Vérifie toujours compilation + tests après ta dernière édition avant de répondre.",
          "4. Commits et pushes réguliers sur GitHub (`Zhairgling`), et vérifie `CLAUDE.md` / mémoire du projet au démarrage.",
        ].join("\n"),
        taskExamples: [
          "Corrige ce bug et lance la suite de tests sur ssh mac pour valider.",
          "Ajoute une route API / composant UI / commande CLI avec tests associés.",
          "Fais une revue critique du dernier diff git (bugs, edge cases, sécurité, perfs) et corrige les points relevés.",
          "Prépare un commit propre et pushe la branche courante après vérification.",
        ],
        skillIds: ["skill-rust-embedded"],
        mcpIds: ["mcp-searxng", "mcp-paseo"],
        cliTools: ["gh", "ssh-mac", "cargo-musl"],
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "scn-local-homelab-admin",
        name: "[Local] Administration Homelab & Flotte",
        description: "EVO-X2, Mac, Air, Blade, systemd, Docker, Home Assistant & Fire TV.",
        universe: "local",
        providerId: "opencode",
        modelId: "mac/qwen3.8-27b-abliterated",
        quant: "default",
        badgeGpu: "Mac M4 Max 0 CU/h",
        maxSlots: 2,
        allowLocalSubagents: true,
        systemPrompt: [
          "Tu es l'administrateur système et domotique de l'écosystème de Julien (EVO-X2 + flotte + Home Assistant).",
          "INFRASTRUCTURE CONNUE :",
          "- EVO-X2 (Fedora 44 KDE/Wayland, fan fragile -> JAMAIS de build/docker illimité, toujours `nice -n 15` / `--cpus=4`) : ajubis-voice (:8767), ChatterboxTTS (:8004), Whisper STT (:10300), colab-proxy (:11435), paseo (:8449), searxng (:18798).",
          "- Flotte SSH : MacBook Pro M4 Max (`ssh mac` / 100.109.119.56), MacBook Air M2 (`ssh air` / 100.94.219.79), Razer Blade (`ssh blade` / 100.67.68.24 : osint :8765, pyghidra :8766, jadx :8767).",
          "- Gateway MCP `homelab` (http://100.83.26.111:18890/mcp) : Home Assistant, Chronique, Budget, Paperless, Immich, Téléphone/Tablette ADB, Cuisine, Lieux, Google Workspace.",
          "- Règles matérielles : Fire TV -> toujours lancer `~/bin/tele-source` avant toute action (jamais `service call hdmi_control`). Moonlight -> `--display-mode windowed`. Archives Google Drive -> `rclone gdrive-crypt:`.",
          "- Sécurité : vérifie l'état (`systemctl --user status`, `docker ps`, logs) avant toute modif, explique les actions destructives avant de les exécuter.",
        ].join("\n"),
        taskExamples: [
          "Fais un bilan complet de santé de la flotte (EVO, Mac, Air, Blade, services systemd, Docker, disques, températures).",
          "Diagnostique pourquoi un service (Whisper STT, ChatterboxTTS, ajubis-voice ou colab-proxy) ne répond plus et relance-le proprement.",
          "Vérifie l'état de la maison dans Home Assistant (capteurs, lumières, présence) et propose/applique un ajustement.",
          "Affiche un flux / une app sur la télé du salon en passant d'abord par ~/bin/tele-source.",
        ],
        skillIds: ["skill-deep-research"],
        mcpIds: ["mcp-homelab", "mcp-searxng"],
        cliTools: ["gh", "ssh-mac"],
        builtIn: true,
        updatedAt: now,
      },
      {
        id: "scn-colab-osint",
        name: "[Colab] OSINT & Recherche Poussée",
        description: "L4 Q4_K_M · Anti-hallucination (Modelfile.osint-32b), EN/ZH/RU, 37 outils.",
        universe: "colab",
        providerId: "opencode",
        modelId: "colab/qwen3:32b",
        quant: "Q4_K_M",
        gpuTier: "L4",
        badgeGpu: "L4 24Go Q4",
        maxSlots: 2,
        allowLocalSubagents: false,
        systemPrompt: [
          "Tu es un analyste OSINT autorisé (recherche technique, sécurité, veille, investigations).",
          "REGLES CRITIQUES ANTI-HALLUCINATION (basées sur Modelfile.osint-32b) :",
          "1. N'invente JAMAIS un résultat, un profil, une URL ou une CVE. Si tu n'as pas l'info, appelle un outil.",
          "2. Cite systématiquement `[Source: nom_outil] fait + URL ou chaîne exacte`. Si 0 résultat, dis-le clairement.",
          "3. Recherche multilingue : croise toujours Anglais + Chinois simplifié + Russe pour le matériel/firmware/exploits (searxng + `gh search`).",
          "4. Utilise le MCP `osint` (37 outils sur Razer Blade 100.67.68.24:8765) et `docker exec osint-toolbox` (amass, nuclei, katana, naabu, dnsx, trufflehog, gitleaks, torsocks, yt-dlp).",
        ].join("\n"),
        taskExamples: [
          "Recherche sur GitHub, Gitee, XDA, 4PDA et Coolapk toute doc, dump ou tool autour de ce SoC / modèle.",
          "Fais une reconnaissance complète d'un domaine / IP autorisé (DNS, sous-domaines, TLS, ports, historique Wayback).",
          "Vérifie l'exposition d'un pseudo / email / fuite via les outils du MCP osint et synthétise uniquement les URLs confirmées.",
          "Trouve et vérifie les CVE officielles (NVD) et PoC publics pour ce composant / version précise.",
        ],
        skillIds: ["skill-multilingual-osint", "skill-ctf-osint", "skill-deep-research"],
        mcpIds: ["mcp-osint", "mcp-searxng"],
        cliTools: ["osint-toolbox", "gh"],
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
