import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const PINS_FILENAME = "pinned-sessions.json";

export interface ServerPinnedSessionsState {
  pinnedKeys: string[];
  updatedAt: string | null;
}

function normalizeKeys(keys: unknown): string[] {
  if (!Array.isArray(keys)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keys) {
    if (typeof raw !== "string") continue;
    const key = raw.trim();
    if (!key || !key.includes(":") || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function buildServerPinnedKey(serverId: string, agentId: string): string {
  return `${serverId}:${agentId}`;
}

export async function readPinnedSessions(paseoHome: string): Promise<ServerPinnedSessionsState> {
  const filePath = path.join(paseoHome, PINS_FILENAME);
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { pinnedKeys?: unknown; updatedAt?: unknown };
    return {
      pinnedKeys: normalizeKeys(parsed.pinnedKeys),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    };
  } catch {
    return { pinnedKeys: [], updatedAt: null };
  }
}

export async function writePinnedSessions(
  paseoHome: string,
  pinnedKeys: readonly string[],
): Promise<{ pinnedKeys: string[]; updatedAt: string }> {
  const normalized = normalizeKeys(pinnedKeys);
  const updatedAt = new Date().toISOString();
  await mkdir(paseoHome, { recursive: true });
  await writeFile(
    path.join(paseoHome, PINS_FILENAME),
    JSON.stringify({ pinnedKeys: normalized, updatedAt }, null, 2),
    "utf8",
  );
  return { pinnedKeys: normalized, updatedAt };
}

export async function mutatePinnedSession(
  paseoHome: string,
  input: {
    key?: string;
    serverId: string;
    agentId?: string;
    action: "pin" | "unpin" | "toggle";
  },
): Promise<{ key: string; pinned: boolean; pinnedKeys: string[]; updatedAt: string }> {
  const resolvedKey =
    input.key?.trim() ||
    (input.agentId?.trim() ? buildServerPinnedKey(input.serverId, input.agentId.trim()) : "");
  if (!resolvedKey || !resolvedKey.includes(":")) {
    throw new Error("Clé de session ou agentId requis");
  }

  const current = await readPinnedSessions(paseoHome);
  const exists = current.pinnedKeys.includes(resolvedKey);
  let shouldPin = !exists;
  if (input.action === "pin") {
    shouldPin = true;
  } else if (input.action === "unpin") {
    shouldPin = false;
  }

  const nextKeys = shouldPin
    ? [resolvedKey, ...current.pinnedKeys.filter((item) => item !== resolvedKey)]
    : current.pinnedKeys.filter((item) => item !== resolvedKey);

  const saved = await writePinnedSessions(paseoHome, nextKeys);
  return {
    key: resolvedKey,
    pinned: shouldPin,
    pinnedKeys: saved.pinnedKeys,
    updatedAt: saved.updatedAt,
  };
}
