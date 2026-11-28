import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildEffectiveSystemPrompt,
  COLAB_ISOLATION_GUARD_PROMPT,
  evaluateColabSlotGuard,
  readHomelabTemplates,
  selectCheapestCompatibleColabGpu,
  writeHomelabTemplates,
} from "./homelab-templates-store";

describe("homelab-templates-store", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("initializes and persists default scenarios, skills, and MCP templates", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "paseo-tpl-"));
    tempDirs.push(dir);

    const data = await readHomelabTemplates(dir);
    expect(data.scenarios.length).toBeGreaterThanOrEqual(4);
    expect(data.skills.length).toBeGreaterThanOrEqual(2);
    expect(data.mcps.length).toBeGreaterThanOrEqual(2);

    data.scenarios.push({
      id: "custom-1",
      name: "Mon scénario custom",
      description: "Test CRUD",
      universe: "colab",
      providerId: "opencode",
      modelId: "colab/qwen3-coder-next",
      quant: "Q4_K_M",
      gpuTier: "A100",
      systemPrompt: "Prompt perso",
      skillIds: [],
      mcpIds: [],
      updatedAt: new Date().toISOString(),
    });
    await writeHomelabTemplates(dir, data);

    const reloaded = await readHomelabTemplates(dir);
    expect(reloaded.scenarios.find((s) => s.id === "custom-1")?.name).toBe("Mon scénario custom");
  });

  it("selects the cheapest Colab GPU tier that fits model + quant + 2-slot headroom", () => {
    expect(selectCheapestCompatibleColabGpu("colab/qwen3:32b", "Q4_K_M")).toBe("A100");
    expect(selectCheapestCompatibleColabGpu("colab/qwen3-coder-next", "Q4_K_M")).toBe("A100");
    expect(selectCheapestCompatibleColabGpu("colab/qwen3-coder-next", "Q8_0")).toBe("G4");
  });

  it("enforces the hard 2-slot Colab limit", () => {
    expect(evaluateColabSlotGuard(1, 1).allowed).toBe(true);
    const blocked = evaluateColabSlotGuard(2, 0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain("2/2");
  });

  it("injects strict Colab local-isolation rules only for Colab universe", () => {
    const colabPrompt = buildEffectiveSystemPrompt({
      universe: "colab",
      basePrompt: "Fais l'audit.",
      selectedSkills: [],
    });
    expect(colabPrompt).toContain(COLAB_ISOLATION_GUARD_PROMPT);

    const localPrompt = buildEffectiveSystemPrompt({
      universe: "local",
      basePrompt: "Fais l'audit.",
      selectedSkills: [],
    });
    expect(localPrompt).not.toContain(COLAB_ISOLATION_GUARD_PROMPT);
    expect(localPrompt).toBe("Fais l'audit.");
  });
});
