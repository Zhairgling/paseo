import { describe, expect, it, vi } from "vitest";

vi.mock("expo-speech", () => ({
  speak: vi.fn(),
  stop: vi.fn(),
}));

import { stripMarkdownForSpeech } from "./read-aloud";

describe("stripMarkdownForSpeech", () => {
  it("humanizes file paths, extensions, git SHAs, and code symbols instead of spelling them", () => {
    const input =
      "J'ai corrigé `packages/app/src/composer/index.tsx` ([ondevice-llm-store.ts](file:///home/julienc/paseo/ondevice-llm-store.ts#L10-L20)) sur le commit cf5b2d0f0..63bb17b85 avec `useAgentAttentionClear`.";

    const spoken = stripMarkdownForSpeech(input);

    expect(spoken).not.toContain("/");
    expect(spoken).not.toContain(".tsx");
    expect(spoken).not.toContain(".ts");
    expect(spoken).not.toContain("cf5b2d0f0");
    expect(spoken).not.toContain("file://");
    expect(spoken).toContain("index");
    expect(spoken).toContain("ondevice llm store");
    expect(spoken).toContain("use Agent Attention Clear");
  });

  it("summarizes code blocks and cleans markdown formatting", () => {
    const input =
      "## Résumé\n\n- Modifié `read_aloud.ts`\n\n```ts\nconst x = 1;\n```\n\nC'est prêt !";
    expect(stripMarkdownForSpeech(input)).toBe(
      "Résumé Modifié read aloud bloc de code. C'est prêt!",
    );
  });
});
