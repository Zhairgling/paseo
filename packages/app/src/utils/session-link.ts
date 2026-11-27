import { parseAgentDeepLink } from "@getpaseo/protocol/agent-deep-link";
import type { SessionState } from "@/stores/session-store";

export interface ResolvedSessionLinkTarget {
  serverId: string;
  agentId: string;
  workspaceId?: string;
}

const CANDIDATE_SESSION_TOKEN_RE =
  /(?<![a-zA-Z0-9_-])([0-9a-f]{7,8}(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?|[0-9a-f]{7,12})(?![a-zA-Z0-9_-])/gi;

const EXACT_SESSION_ID_RE =
  /^(?:[0-9a-f]{7,12}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

const HTTP_AGENT_ROUTE_RE = /^https?:\/\/[^/]+\/h\/([^/?#]+)\/agent\/([^/?#]+)/i;
const PASEO_AGENT_ROUTE_RE = /^paseo:\/\/\/?h\/([^/?#]+)\/agent\/([^/?#]+)/i;

type SessionMapLike = Record<string, Pick<SessionState, "agents" | "agentDetails"> | undefined>;

function findMatchingAgentInSession(
  session: Pick<SessionState, "agents" | "agentDetails"> | undefined,
  query: string,
): { agentId: string; workspaceId?: string; exact: boolean } | null {
  if (!session) return null;
  const exact = session.agents.get(query) ?? session.agentDetails.get(query);
  if (exact) {
    return { agentId: exact.id, workspaceId: exact.workspaceId, exact: true };
  }
  const normalized = query.toLowerCase();
  if (normalized.length < 7) return null;

  let prefixMatch: { agentId: string; workspaceId?: string } | null = null;
  for (const agent of session.agents.values()) {
    if (agent.id.toLowerCase().startsWith(normalized)) {
      if (prefixMatch && prefixMatch.agentId !== agent.id) {
        return null;
      }
      prefixMatch = { agentId: agent.id, workspaceId: agent.workspaceId };
    }
  }
  for (const agent of session.agentDetails.values()) {
    if (agent.id.toLowerCase().startsWith(normalized)) {
      if (prefixMatch && prefixMatch.agentId !== agent.id) {
        return null;
      }
      prefixMatch = { agentId: agent.id, workspaceId: agent.workspaceId };
    }
  }
  return prefixMatch ? { ...prefixMatch, exact: false } : null;
}

/**
 * Collect distinct 7–12 char hex prefixes or full UUIDs appearing in Markdown text.
 * Bounded so arbitrarily huge inputs stay fast during streaming.
 */
export function collectCandidateSessionTokens(text: string): string[] {
  if (!text || text.length < 7) return [];
  const found = new Set<string>();
  CANDIDATE_SESSION_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CANDIDATE_SESSION_TOKEN_RE.exec(text)) !== null) {
    found.add(match[1]);
    if (found.size >= 32) break;
  }
  return [...found];
}

/**
 * Return a compact primitive key listing which candidate tokens match a known session ID.
 */
export function resolveKnownSessionTokensKey(
  candidates: readonly string[],
  sessions: SessionMapLike,
): string {
  if (candidates.length === 0) return "";
  const matched: string[] = [];
  for (const candidate of candidates) {
    if (resolveSessionLink(candidate, sessions)) {
      matched.push(candidate);
    }
  }
  return matched.join("\u0000");
}

export function extractAgentRouteFromUrl(
  input: string,
): { serverId: string; agentId: string; scheme: "paseo" | "http" } | null {
  const trimmed = input.trim();
  const deepLink = parseAgentDeepLink(trimmed);
  if (deepLink) {
    return { ...deepLink, scheme: "paseo" };
  }
  const paseoMatch = PASEO_AGENT_ROUTE_RE.exec(trimmed);
  if (paseoMatch) {
    try {
      return {
        serverId: decodeURIComponent(paseoMatch[1]),
        agentId: decodeURIComponent(paseoMatch[2]),
        scheme: "paseo",
      };
    } catch {
      return null;
    }
  }
  const httpMatch = HTTP_AGENT_ROUTE_RE.exec(trimmed);
  if (!httpMatch) return null;
  try {
    return {
      serverId: decodeURIComponent(httpMatch[1]),
      agentId: decodeURIComponent(httpMatch[2]),
      scheme: "http",
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a Markdown link or inline token (deep link, host `/h/.../agent/...` URL, UUID, or 7+ hex prefix)
 * into a concrete session navigation target using active Zustand sessions.
 */
export function resolveSessionLink(
  input: string,
  sessions: SessionMapLike,
  preferredServerId?: string,
): ResolvedSessionLinkTarget | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const route = extractAgentRouteFromUrl(trimmed);
  if (route) {
    // Paseo deep links always navigate inside the app; http(s) routes match known hosts or `srv_*` servers.
    if (
      route.scheme === "http" &&
      !sessions[route.serverId] &&
      !route.serverId.startsWith("srv_")
    ) {
      return null;
    }
    const found = findMatchingAgentInSession(sessions[route.serverId], route.agentId);
    return {
      serverId: route.serverId,
      agentId: found?.agentId ?? route.agentId,
      workspaceId: found?.workspaceId,
    };
  }

  if (!EXACT_SESSION_ID_RE.test(trimmed)) return null;

  if (preferredServerId) {
    const preferred = findMatchingAgentInSession(sessions[preferredServerId], trimmed);
    if (preferred) {
      return {
        serverId: preferredServerId,
        agentId: preferred.agentId,
        workspaceId: preferred.workspaceId,
      };
    }
  }

  const matches: ResolvedSessionLinkTarget[] = [];
  for (const [serverId, session] of Object.entries(sessions)) {
    if (serverId === preferredServerId) continue;
    const found = findMatchingAgentInSession(session, trimmed);
    if (found) {
      if (found.exact) {
        return { serverId, agentId: found.agentId, workspaceId: found.workspaceId };
      }
      matches.push({ serverId, agentId: found.agentId, workspaceId: found.workspaceId });
    }
  }

  return matches.length === 1 ? matches[0] : null;
}
