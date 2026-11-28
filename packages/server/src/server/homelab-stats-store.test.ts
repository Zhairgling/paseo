import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readHomelabUsageStatsFile,
  recordHomelabUsageEvents,
  resetHomelabUsageStats,
  summarizeHomelabUsageStats,
} from "./homelab-stats-store.js";

const tempDirs: string[] = [];

async function makeTempHome(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "paseo-stats-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("homelab-stats-store", () => {
  it("records, aggregates, and ranks top actions, screens, and LFM3 telemetry", async () => {
    const home = await makeTempHome();
    await recordHomelabUsageEvents(home, [
      { action: "composer.send", screen: "agent", source: "user" },
      { action: "composer.send", screen: "agent", source: "user" },
      {
        action: "lfm3.tool_parse_ok",
        screen: "agent",
        source: "assistant_local",
        meta: { utterance: "mets ça en brouillon", tool: "draft" },
      },
      {
        action: "lfm3.tool_parse_fail",
        screen: "agent",
        source: "assistant_local",
        meta: { rawName: "draft_prom" },
      },
      {
        action: "session.switch",
        screen: "agent",
        source: "user",
        meta: { from: "sess-a", to: "sess-b" },
      },
      {
        action: "lfm3.latency",
        screen: "team",
        source: "assistant_local",
        meta: { wsRttMs: 12, ttftMs: 45, ttfaMs: 90 },
      },
    ]);

    const file = await readHomelabUsageStatsFile(home);
    const summary = summarizeHomelabUsageStats(file);

    expect(summary.totalEvents).toBe(6);
    expect(summary.topActions[0]).toEqual({ key: "composer.send", count: 2, sharePct: 33.3 });
    expect(summary.lfm3.toolParseOk).toBe(1);
    expect(summary.lfm3.toolParseFail).toBe(1);
    expect(summary.lfm3.toolParseSuccessRatePct).toBe(50);
    expect(summary.lfm3.failRawNames[0]?.key).toBe("draft_prom");
    expect(summary.lfm3.topSessionTransitions[0]?.key).toBe("sess-a -> sess-b");
    expect(summary.lfm3.avgLatencyMs).toEqual({ wsRttMs: 12, ttftMs: 45, ttfaMs: 90 });
    expect(summary.lfm3.trainingPairsCount).toBe(1);
  });

  it("resets stats cleanly", async () => {
    const home = await makeTempHome();
    await recordHomelabUsageEvents(home, [{ action: "composer.send", screen: "agent" }]);
    const cleared = await resetHomelabUsageStats(home);
    expect(cleared.totalEvents).toBe(0);
    expect(cleared.lfm3.toolParseOk).toBe(0);
  });
});
