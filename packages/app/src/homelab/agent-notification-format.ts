import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import type { AgentPermissionRequest } from "@getpaseo/protocol/agent-types";

export type AgentNotificationTone = "finished" | "permission" | "question" | "error";

export interface FormattedAgentNotification {
  title: string;
  subtitle: string;
  body: string;
  color: string;
  tone: AgentNotificationTone;
}

const MAX_BODY_LENGTH = 240;

const NOTIFICATION_COLORS: Record<AgentNotificationTone, string> = {
  finished: "#5EC269",
  permission: "#E8A85A",
  question: "#E8A85A",
  error: "#EF4444",
};

const FILLER_OPENING_RE =
  /^(?:c['’]est fait|fait|parfait|voil[àa]|ok(?:ay)?|d['’]accord|bien s[ûu]r|entendu|tr[èe]s bien|bonjour)\s*[—–\-:!,.\s]*/i;

export function truncateNotificationBody(raw: string, maxLen = MAX_BODY_LENGTH): string {
  const clean = raw.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  const sliced = clean.slice(0, maxLen - 1).trimEnd();
  return `${sliced}…`;
}

export function stripMarkdownNoise(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/```[^\n]*\n([\s\S]*?)```/g, (_match, code: string) => {
      const firstLine = code
        .split("\n")
        .map((line) => line.trim())
        .find(Boolean);
      return firstLine ? ` ${firstLine} ` : " ";
    })
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => (alt.trim() ? alt.trim() : ""))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:[-*_]\s*){3,}$/gm, "")
    .replace(/^\s*\|.*\|\s*$/gm, "")
    .replace(/^\s{0,3}(?:#{1,6}|>+)\s+/gm, "")
    .replace(/[`*_~]+/g, "");
}

function isPureHeadingLine(line: string): boolean {
  const normalized = line.replace(/^[\d.)\-\s*•]+/, "").trim();
  if (!normalized) return true;
  if (normalized.endsWith(":") && normalized.length < 48) return true;
  return /^(?:r[ée]sum[ée]|ce qui a [ée]t[ée] fait|v[ée]rifications?|prochaines?\s+[ée]tapes?)$/i.test(
    normalized,
  );
}

/**
 * Extracts a concise, high-signal preview from an assistant reply instead of dumping raw markdown headings.
 */
export function formatAssistantNotificationPreview(markdown: string | null | undefined): string {
  if (!markdown?.trim()) return "Réponse prête.";
  const withoutHeadings = markdown.replace(/^\s{0,3}#{1,6}\s+[^\n.!?]{1,50}$/gm, "");
  const stripped = stripMarkdownNoise(withoutHeadings);
  const parts: string[] = [];

  for (const rawLine of stripped.split("\n")) {
    let line = rawLine.replace(/^\s*(?:[-*•]+|\d+[.)])\s+/, "").trim();
    if (!line || isPureHeadingLine(line)) continue;
    if (parts.length === 0) {
      const withoutFiller = line.replace(FILLER_OPENING_RE, "").trim();
      if (withoutFiller.length >= 12) line = withoutFiller;
    }
    if (!line) continue;
    parts.push(line);
    if (parts.join(" · ").length >= MAX_BODY_LENGTH) break;
  }

  const joined = parts.join(" · ").trim();
  if (!joined) {
    return truncateNotificationBody(stripped) || "Réponse prête.";
  }
  return truncateNotificationBody(joined);
}

export type WorkspaceNotificationMeta = Pick<
  WorkspaceDescriptor,
  "projectCustomName" | "projectDisplayName"
>;

export function extractWorkspaceLabel(
  agent: Pick<Agent, "cwd" | "workspaceId">,
  workspaces?: ReadonlyMap<string, WorkspaceNotificationMeta>,
): string | null {
  const ws = agent.workspaceId ? workspaces?.get(agent.workspaceId) : undefined;
  const named = ws?.projectCustomName?.trim() || ws?.projectDisplayName?.trim();
  if (named) return named;

  const cwd = agent.cwd?.trim().replace(/[\\/]+$/, "");
  if (!cwd) return null;
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

function sanitizeAgentTitle(
  agent: Pick<Agent, "id" | "title">,
  workspaceLabel: string | null,
): string {
  const raw = agent.title?.trim() ?? "";
  if (!raw || /^ajucode$/i.test(raw) || /^paseo$/i.test(raw)) {
    return workspaceLabel ? `Session ${workspaceLabel}` : `Session ${agent.id.slice(0, 8)}`;
  }
  return raw;
}

export function isQuestionPermission(perm: AgentPermissionRequest): boolean {
  return perm.kind === "question" || /ask_?user_?question/i.test(perm.name ?? "");
}

export function formatQuestionPermissionBody(perm: AgentPermissionRequest): string {
  const input = perm.input as
    | {
        questions?: Array<{ question?: unknown; options?: Array<{ label?: unknown }> }>;
        question?: unknown;
      }
    | undefined;
  if (input && Array.isArray(input.questions) && input.questions.length > 0) {
    const first = input.questions[0];
    const qText = typeof first?.question === "string" ? first.question.trim() : "";
    if (qText) {
      const prefix = input.questions.length > 1 ? `[1/${input.questions.length}] ` : "";
      const opts = Array.isArray(first?.options)
        ? first.options
            .map((o) => (typeof o?.label === "string" ? o.label.trim() : ""))
            .filter(Boolean)
            .slice(0, 3)
        : [];
      const optSuffix = opts.length > 0 ? ` · ${opts.join(" / ")}` : "";
      return truncateNotificationBody(`${prefix}${qText}${optSuffix}`);
    }
  }
  if (input && typeof input.question === "string" && input.question.trim()) {
    return truncateNotificationBody(input.question);
  }
  const fallback = perm.description?.trim() || perm.title?.trim() || "L'agent attend ta réponse.";
  return truncateNotificationBody(stripMarkdownNoise(fallback));
}

function firstNonEmptyString(
  record: Record<string, unknown> | undefined,
  keys: readonly string[],
): string {
  if (!record) return "";
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

export function formatToolPermissionBody(perm: AgentPermissionRequest): string {
  const input = perm.input as Record<string, unknown> | undefined;
  const command = firstNonEmptyString(input, ["command", "CommandLine"]);
  if (command) {
    return truncateNotificationBody(`$ ${command}`);
  }
  const targetPath = firstNonEmptyString(input, ["file_path", "path", "Path"]);
  const toolName = perm.title?.trim() || perm.name?.trim();
  if (targetPath && toolName) {
    const shortPath = targetPath.split(/[\\/]/).slice(-2).join("/");
    return truncateNotificationBody(`${toolName} · ${shortPath}`);
  }
  const desc = perm.description?.trim();
  if (desc) {
    return truncateNotificationBody(stripMarkdownNoise(desc));
  }
  if (targetPath) {
    return truncateNotificationBody(targetPath);
  }
  return truncateNotificationBody(toolName || "Autorisation requise");
}

function buildSubtitle(workspaceLabel: string | null, statusTag: string): string {
  return workspaceLabel ? `${workspaceLabel} · ${statusTag}` : statusTag;
}

export function formatFinishedAgentNotification(input: {
  agent: Pick<Agent, "id" | "title" | "cwd" | "workspaceId" | "attentionReason" | "lastError">;
  workspaces?: ReadonlyMap<string, WorkspaceNotificationMeta>;
  assistantMessage: string | null | undefined;
}): FormattedAgentNotification {
  const workspaceLabel = extractWorkspaceLabel(input.agent, input.workspaces);
  const title = sanitizeAgentTitle(input.agent, workspaceLabel);
  const isError = input.agent.attentionReason === "error";
  const tone: AgentNotificationTone = isError ? "error" : "finished";
  const body = isError
    ? truncateNotificationBody(
        input.agent.lastError?.trim() || "L'agent s'est arrêté avec une erreur.",
      )
    : formatAssistantNotificationPreview(input.assistantMessage);

  return {
    title,
    subtitle: buildSubtitle(workspaceLabel, isError ? "Erreur" : "Terminé"),
    body,
    color: NOTIFICATION_COLORS[tone],
    tone,
  };
}

export function formatPermissionAgentNotification(input: {
  agent: Pick<Agent, "id" | "title" | "cwd" | "workspaceId">;
  workspaces?: ReadonlyMap<string, WorkspaceNotificationMeta>;
  permission: AgentPermissionRequest;
}): FormattedAgentNotification {
  const workspaceLabel = extractWorkspaceLabel(input.agent, input.workspaces);
  const title = sanitizeAgentTitle(input.agent, workspaceLabel);
  const isQuestion = isQuestionPermission(input.permission);
  const tone: AgentNotificationTone = isQuestion ? "question" : "permission";

  return {
    title,
    subtitle: buildSubtitle(workspaceLabel, isQuestion ? "Question" : "Permission"),
    body: isQuestion
      ? formatQuestionPermissionBody(input.permission)
      : formatToolPermissionBody(input.permission),
    color: NOTIFICATION_COLORS[tone],
    tone,
  };
}
