import { beforeEach, describe, expect, it } from "vitest";
import { useOpenedFilesStore } from "./opened-files-store";

describe("useOpenedFilesStore", () => {
  beforeEach(() => {
    useOpenedFilesStore.setState({ entries: [] });
  });

  it("records clicked files newest-first and deduplicates by workspace and path", () => {
    const store = useOpenedFilesStore.getState();
    store.recordOpenedFile({
      serverId: "s1",
      workspaceId: "w1",
      location: { path: "/home/julienc/notes.md", lineStart: 4 },
    });
    store.recordOpenedFile({
      serverId: "s1",
      workspaceId: "w1",
      location: { path: "/home/julienc/other.md" },
    });
    store.recordOpenedFile({
      serverId: "s1",
      workspaceId: "w1",
      location: { path: "/home/julienc/notes.md", lineStart: 12 },
    });

    const entries = useOpenedFilesStore.getState().entries;
    expect(entries).toHaveLength(2);
    expect(entries[0]?.path).toBe("/home/julienc/notes.md");
    expect(entries[0]?.lineStart).toBe(12);
    expect(entries[1]?.path).toBe("/home/julienc/other.md");
  });

  it("removes single entries and clears only the matching workspace", () => {
    const store = useOpenedFilesStore.getState();
    store.recordOpenedFile({
      serverId: "s1",
      workspaceId: "w1",
      location: { path: "/tmp/a.md" },
    });
    store.recordOpenedFile({
      serverId: "s1",
      workspaceId: "w2",
      location: { path: "/tmp/b.md" },
    });

    store.clearWorkspaceOpenedFiles("s1", "w1");
    expect(useOpenedFilesStore.getState().entries.map((entry) => entry.path)).toEqual([
      "/tmp/b.md",
    ]);

    const remainingKey = useOpenedFilesStore.getState().entries[0]?.key ?? "";
    store.removeOpenedFile(remainingKey);
    expect(useOpenedFilesStore.getState().entries).toHaveLength(0);
  });
});
