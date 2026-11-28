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
  it("records, aggregates, and ranks top actions and screens by source", async () => {
    const home = await makeTempHome();
    await recordHomelabUsageEvents(home, [
      { action: "composer.send", screen: "agent", source: "user" },
      { action: "composer.send", screen: "agent", source: "user" },
      { action: "speech.read_aloud", screen: "agent", source: "assistant_local" },
      { action: "team.switch_tab", screen: "team", source: "agent_remote", detail: "colab" },
    ]);

    const file = await readHomelabUsageStatsFile(home);
    const summary = summarizeHomelabUsageStats(file);

    expect(summary.totalEvents).toBe(4);
    expect(summary.sourceCounts).toEqual({
      user: 2,
      assistant_local: 1,
      agent_remote: 1,
    });
    expect(summary.topActions[0]).toEqual({
      key: "composer.send",
      count: 2,
      sharePct: 50,
    });
    expect(summary.topScreens[0]).toEqual({
      key: "agent",
      count: 3,
      sharePct: 75,
    });
    expect(summary.recentEvents).toHaveLength(4);
  });

  it("resets stats cleanly", async () => {
    const home = await makeTempHome();
    await recordHomelabUsageEvents(home, [{ action: "composer.send", screen: "agent" }]);
    const cleared = await resetHomelabUsageStats(home);
    expect(cleared.totalEvents).toBe(0);
    expect(cleared.recentEvents).toEqual([]);
  });
});
