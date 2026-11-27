import { describe, expect, it } from "vitest";
import {
  canRepromptText,
  formatRepromptDownloadBadge,
  ONDEVICE_LLM_CATALOG,
  sanitizeRepromptOutput,
} from "./reprompt";

describe("composer reprompt helpers", () => {
  it("checks minimum draft length before enabling reprompt", () => {
    expect(canRepromptText("")).toBe(false);
    expect(canRepromptText("  hi  ")).toBe(false);
    expect(canRepromptText("fix")).toBe(true);
    expect(canRepromptText("corrige @src/app.ts")).toBe(true);
  });

  it("formats download percentage badge cleanly between 1% and 99%", () => {
    expect(formatRepromptDownloadBadge(0)).toBe("1%");
    expect(formatRepromptDownloadBadge(0.456)).toBe("46%");
    expect(formatRepromptDownloadBadge(1)).toBe("99%");
  });

  it("strips think blocks, echoed tags, wrappers, and conversational prefixes", () => {
    const original = "regarde @src/composer.tsx stp il y a un beug";
    const noisy =
      "<think>\nThinking...\n</think>\nVoici le texte corrigé : « Regarde @src/composer.tsx s'il te plaît, il y a un bug. »";
    expect(sanitizeRepromptOutput(noisy, original)).toBe(
      "Regarde @src/composer.tsx s'il te plaît, il y a un bug.",
    );
  });

  it("strips fenced wrapper added around plain prose while preserving fenced user code", () => {
    expect(sanitizeRepromptOutput("```\nCorrige ce bug.\n```", "corrige se bug")).toBe(
      "Corrige ce bug.",
    );

    const userFenced = "```ts\nconst x = 1;\n```";
    expect(sanitizeRepromptOutput(userFenced, userFenced)).toBe(userFenced);
  });

  it("falls back to original trimmed text when model returns empty output", () => {
    expect(sanitizeRepromptOutput("   <think>ok</think>  ", "  mon prompt  ")).toBe("mon prompt");
  });

  it("exposes catalog models ordered from lightweight default to quality", () => {
    expect(ONDEVICE_LLM_CATALOG.map((m) => m.id)).toEqual(["qwen3-0.6b-int4", "qwen3-1.7b-int4"]);
  });
});
