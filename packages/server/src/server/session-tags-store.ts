import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const TAGS_FILENAME = "session-tags.json";

export interface ServerSessionTagsState {
  tagsByKey: Record<string, string>;
  updatedAt: string | null;
}

function sanitizeTagsMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(raw)) {
    const cleanKey = key.trim();
    const cleanVal = typeof val === "string" ? val.trim().slice(0, 32) : "";
    if (cleanKey.includes(":") && cleanVal) {
      out[cleanKey] = cleanVal;
    }
  }
  return out;
}

export async function readSessionTags(paseoHome: string): Promise<ServerSessionTagsState> {
  try {
    const raw = await readFile(path.join(paseoHome, TAGS_FILENAME), "utf8");
    const parsed = JSON.parse(raw) as { tagsByKey?: unknown; updatedAt?: unknown };
    return {
      tagsByKey: sanitizeTagsMap(parsed.tagsByKey),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    };
  } catch {
    return { tagsByKey: {}, updatedAt: null };
  }
}

export async function setSessionTag(
  paseoHome: string,
  input: { key?: string; serverId: string; agentId?: string; tag: string | null },
): Promise<{
  key: string;
  tag: string | null;
  tagsByKey: Record<string, string>;
  updatedAt: string;
}> {
  const resolvedKey =
    input.key?.trim() || (input.agentId?.trim() ? `${input.serverId}:${input.agentId.trim()}` : "");
  if (!resolvedKey || !resolvedKey.includes(":")) {
    throw new Error("Clé de session ou agentId requis");
  }
  const cleanTag = typeof input.tag === "string" ? input.tag.trim().slice(0, 32) : "";
  const current = await readSessionTags(paseoHome);
  const next = { ...current.tagsByKey };
  if (cleanTag) {
    next[resolvedKey] = cleanTag;
  } else {
    delete next[resolvedKey];
  }
  const updatedAt = new Date().toISOString();
  await mkdir(paseoHome, { recursive: true });
  await writeFile(
    path.join(paseoHome, TAGS_FILENAME),
    JSON.stringify({ tagsByKey: next, updatedAt }, null, 2),
    "utf8",
  );
  return {
    key: resolvedKey,
    tag: cleanTag || null,
    tagsByKey: next,
    updatedAt,
  };
}
