import type { HomelabGpuStatus } from "@/homelab/api";
import type { UsageTone } from "@/usage/types";

export interface ColabGpuMetrics {
  /** 0-100 VRAM/GPU utilization gauge percentage. */
  vramPct: number;
  vramUsedGb: number;
  vramTotalGb: number;
  vramEstimated: boolean;
  vramTone: UsageTone;
  /** 0-100 Compute Units balance gauge percentage. */
  cuPct: number | null;
  cuBalance: number | null;
  cuReferenceCap: number;
  cuTone: UsageTone;
  inFlight: number;
  state: string;
  gpuName: string;
  g4Hours: number | null;
}

const GPU_VRAM_TOTAL_GB: Readonly<Record<string, number>> = {
  G4: 96,
  H100: 80,
  A100: 80,
  L4: 24,
  T4: 15,
};

function estimateModelVramGb(modelName: string): number {
  const lower = modelName.toLowerCase();
  if (lower.includes("qwen3-coder-next") || lower.includes("80b")) return 50.7;
  if (lower.includes("72b")) return 44.5;
  if (lower.includes("32b")) return 20.0;
  if (lower.includes("27b") || lower.includes("26b")) return 17.5;
  if (lower.includes("14b")) return 9.5;
  if (lower.includes("9b") || lower.includes("8b")) return 6.2;
  return 24.0;
}

function estimateTotalVramGb(colab: HomelabGpuStatus["colab"], totalGb: number): number {
  const state = (colab.state ?? "").toLowerCase();
  if (state !== "ready" && state !== "running" && (colab.in_flight ?? 0) === 0) {
    return 0;
  }
  const loaded = colab.loaded_models ?? [];
  if (loaded.length === 0) {
    return (colab.in_flight ?? 0) > 0 ? estimateModelVramGb(colab.default_model ?? "") : 0;
  }
  // Ollama on Colab keeps the active model resident (first or heaviest loaded model).
  let maxGb = 0;
  for (const name of loaded) {
    const est = estimateModelVramGb(name);
    if (est > maxGb) maxGb = est;
  }
  return Math.min(totalGb, maxGb);
}

function resolveVramTone(pct: number, inFlight: number): UsageTone {
  if (pct >= 90) return "danger";
  if (pct >= 75 || inFlight >= 2) return "warning";
  return "ok";
}

function resolveCuTone(pct: number): UsageTone {
  if (pct <= 10) return "danger";
  if (pct <= 25) return "warning";
  return "ok";
}

function resolveCuReferenceCap(cuBalance: number | null): number {
  if (cuBalance !== null && cuBalance > 500) return 1000;
  if (cuBalance !== null && cuBalance > 100) return 500;
  return 100;
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Compute GPU VRAM utilization and Compute Unit reserve gauges from Colab status.
 * Uses exact `vram_used_gb` / `vram_pct` when reported by the daemon, and falls back
 * to an accurate model-footprint estimate when talking to an older daemon build.
 */
export function computeColabGpuMetrics(colab: HomelabGpuStatus["colab"]): ColabGpuMetrics {
  const gpuKey = (colab.gpu ?? "G4").toUpperCase();
  const vramTotalGb = colab.vram_total_gb ?? GPU_VRAM_TOTAL_GB[gpuKey] ?? 96;
  const inFlight = colab.in_flight ?? 0;
  const state = (colab.state ?? "stopped").toLowerCase();

  const hasExactVram = typeof colab.vram_used_gb === "number" && typeof colab.vram_pct === "number";
  const vramUsedGb = hasExactVram
    ? (colab.vram_used_gb ?? 0)
    : estimateTotalVramGb(colab, vramTotalGb);
  const vramPct = hasExactVram
    ? clampPct(colab.vram_pct ?? 0)
    : clampPct((vramUsedGb / Math.max(1, vramTotalGb)) * 100);

  const cuBalance =
    typeof colab.compute_units_balance === "number" ? colab.compute_units_balance : null;
  const cuReferenceCap = resolveCuReferenceCap(cuBalance);
  const cuPct = cuBalance !== null ? clampPct((cuBalance / cuReferenceCap) * 100) : null;

  return {
    vramPct,
    vramUsedGb: Math.round(vramUsedGb * 10) / 10,
    vramTotalGb,
    vramEstimated: !hasExactVram,
    vramTone: resolveVramTone(vramPct, inFlight),
    cuPct,
    cuBalance,
    cuReferenceCap,
    cuTone: resolveCuTone(cuPct ?? 100),
    inFlight,
    state,
    gpuName: colab.gpu ?? "G4",
    g4Hours: colab.estimated_hours_remaining?.G4_96GB_hours ?? null,
  };
}
