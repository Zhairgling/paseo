import { memo, useMemo, useState } from "react";
import { EnrichedMarkdownText, type LinkPressEvent } from "react-native-enriched-markdown";
import { withUnistyles } from "react-native-unistyles";
import {
  useAssistantFileLinkActions,
  useAssistantFileLinkEnvironment,
} from "@/assistant-file-links";
import { useStableEvent } from "@/hooks/use-stable-event";
import { matchCommandLink, useAgentCommandHints, type CommandHints } from "@/agent-commands";
import { useForgeShorthand } from "@/git/forge-shorthand";
import { pluginOverviewUrl } from "@getpaseo/protocol/plugin-overview";
import { useSessionStore } from "@/stores/session-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { openExternalUrl } from "@/utils/open-external-url";
import {
  collectCandidateSessionTokens,
  resolveKnownSessionTokensKey,
  resolveSessionLink,
} from "@/utils/session-link";
import { AttachmentLightbox, type ImageLightboxSource } from "@/components/attachment-lightbox";
import type { Theme } from "@/styles/theme";
import { isWeb } from "@/constants/platform";
import { density, resolveDensity } from "@/styles/density";
import { MarkdownBlockStack } from "./block-stack";
import { MarkdownLinkedImagesStrip } from "./linked-images";
import { WEB_RENDERERS } from "./renderers";
import { createMarkdownStyles } from "./styles";
import { PENDING_MARKDOWN_IMAGE } from "./source";
import { splitStreamingMarkdown } from "./streaming";
import { useMarkdownSource, type MarkdownImageContext } from "./images";

import { MermaidFence, MermaidStreamingContext, splitMermaidFences } from "./fence/mermaid";

const ThemedMarkdown = withUnistyles(EnrichedMarkdownText);
const MD4C_FLAGS = { latexMath: false, hardSoftBreaks: true, admonitions: true };
// A README is written for its forge, where the lines of a paragraph join into one.
const EXTERNAL_MD4C_FLAGS = { ...MD4C_FLAGS, hardSoftBreaks: false };

// Reading the breakpoint here makes Unistyles restyle the text when the layout crosses it.
const markdownStyle =
  (compact: boolean, muted = false, chatImages = false) =>
  (theme: Theme, rt: { breakpoint?: string }) =>
    createMarkdownStyles(theme, {
      compact,
      muted,
      chatImages,
      blockGap: resolveDensity(rt, density.blockGap),
    });
const regularStyle = markdownStyle(false);
const regularChatStyle = markdownStyle(false, false, true);
const compactStyle = markdownStyle(true);
const compactChatStyle = markdownStyle(true, false, true);
const compactMutedStyle = markdownStyle(true, true);

function pickMarkdownStyle(compact: boolean, muted: boolean, chatImages: boolean) {
  if (!compact) return chatImages ? regularChatStyle : regularStyle;
  if (muted) return compactMutedStyle;
  return chatImages ? compactChatStyle : compactStyle;
}

export interface MarkdownRendererProps extends MarkdownImageContext {
  text: string;
  compact?: boolean;
  /** Muted text colour. Compact surfaces only. */
  muted?: boolean;
  selectable?: boolean;
  streaming?: boolean;
  onLinkPress?: (url: string) => unknown;
  agentCommands?: boolean;
  /**
   * Author-controlled Markdown from outside this host, such as a plugin README: only its https
   * links and images work, nothing is read as a file, forge reference or command, and the lines of
   * a paragraph join as they do on its forge.
   */
  external?: boolean;
}

/** All Markdown surfaces share the same engine and source adaptation. */
export const MarkdownRenderer = memo(function MarkdownRenderer(props: MarkdownRendererProps) {
  const streaming = !isWeb && !!props.streaming;
  // Only completed lines affect block closure. Do not run mdast on every reveal frame.
  const completeLines = streaming ? props.text.slice(0, props.text.lastIndexOf("\n") + 1) : "";
  const boundary = useMemo(
    () => splitStreamingMarkdown(completeLines, true).head.length,
    [completeLines],
  );
  const Part = props.agentCommands ? CommandMarkdownPart : MarkdownPart;
  if (!streaming || boundary === 0) return <Part {...props} />;
  return (
    <MarkdownBlockStack>
      <Part {...props} text={props.text.slice(0, boundary)} />
      <Part {...props} text={props.text.slice(boundary)} />
    </MarkdownBlockStack>
  );
});

const CommandMarkdownPart = memo(function CommandMarkdownPart(props: MarkdownRendererProps) {
  const commandHints = useAgentCommandHints();
  return <MarkdownPart {...props} commandHints={commandHints} />;
});

const MarkdownPart = memo(function MarkdownPart({
  text,
  compact = false,
  muted = false,
  selectable = true,
  streaming = false,
  onLinkPress,
  agentCommands: _agentCommands,
  external = false,
  commandHints = null,
  ...imageContext
}: MarkdownRendererProps & { commandHints?: CommandHints | null }) {
  const environment = useAssistantFileLinkEnvironment();
  const actions = useAssistantFileLinkActions();
  const workspaceForgeShorthand = useForgeShorthand();
  const forgeShorthand = external ? null : workspaceForgeShorthand;
  const candidateSessionTokens = useMemo(
    () => (external ? [] : collectCandidateSessionTokens(text)),
    [external, text],
  );
  const matchedSessionTokensKey = useSessionStore((state) =>
    external || candidateSessionTokens.length === 0
      ? ""
      : resolveKnownSessionTokensKey(candidateSessionTokens, state.sessions),
  );
  const client =
    imageContext.client ??
    (environment.client?.readFile
      ? { readFile: environment.client.readFile.bind(environment.client) }
      : undefined);
  const { markdown, imageSources, linkedImages, resolvedUriBySource, linkRecognition, linkSource } =
    useMarkdownSource(
      text,
      {
        workspaceRoot: environment.workspaceRoot,
        serverId: environment.serverId,
        ...imageContext,
        client,
      },
      {
        commandNames: commandHints?.names,
        forgeReferencePattern: forgeShorthand?.pattern,
        knownSessionTokensKey: matchedSessionTokensKey,
        external,
      },
    );
  const [lightboxState, setLightboxState] = useState<{
    source: ImageLightboxSource;
    index: number;
  } | null>(null);
  const galleryItems = useMemo<ImageLightboxSource[]>(() => {
    const seen = new Set<string>();
    const items: ImageLightboxSource[] = [];
    for (const entry of linkedImages) {
      if (seen.has(entry.uri)) continue;
      seen.add(entry.uri);
      items.push({ type: "uri", uri: entry.uri });
    }
    return items;
  }, [linkedImages]);
  const openUriInLightbox = useStableEvent((uri: string, preferredIndex?: number) => {
    const foundIndex = galleryItems.findIndex((item) => item.type === "uri" && item.uri === uri);
    const index = preferredIndex !== undefined && preferredIndex >= 0 ? preferredIndex : foundIndex;
    setLightboxState({
      source: { type: "uri", uri },
      index: index >= 0 ? index : 0,
    });
  });
  const pressLink = useStableEvent(({ url, sourceType }: LinkPressEvent) => {
    if (external) {
      // The parser still autolinks bare http, www and email text; only https links open.
      const safe = pluginOverviewUrl(url);
      if (safe) void openExternalUrl(safe);
      return;
    }
    const resolvedLinkedUri = resolvedUriBySource.get(url);
    if (resolvedLinkedUri) {
      openUriInLightbox(resolvedLinkedUri);
      return;
    }
    const command = commandHints && matchCommandLink(url, sourceType, commandHints.names);
    if (command) {
      commandHints.insert(command);
      return;
    }
    const sessionTarget = resolveSessionLink(
      url,
      useSessionStore.getState().sessions,
      environment.serverId,
    );
    if (sessionTarget) {
      navigateToAgent({ ...sessionTarget, pin: true });
      return;
    }
    const forgeUrl = sourceType === "text" ? forgeShorthand?.resolve(url) : null;
    if (forgeUrl) {
      void openExternalUrl(forgeUrl);
      return;
    }
    const source = linkSource(url, sourceType);
    if (onLinkPress && !actions.canResolveFile(source)) onLinkPress(url);
    else actions.open(source, "preferred");
  });
  const pressImage = useStableEvent(({ url }: { url: string }) => {
    if (url !== PENDING_MARKDOWN_IMAGE) openUriInLightbox(url);
  });
  const openLinkedImage = useStableEvent((uri: string, index: number) => {
    openUriInLightbox(uri, index);
  });
  const closeImage = useStableEvent(() => setLightboxState(null));
  const useChatImageSizing = !external && !imageContext.filePath;
  const segments = useMemo(
    () =>
      isWeb ? [{ kind: "markdown", id: "0", source: markdown }] : splitMermaidFences(markdown),
    [markdown],
  );
  return (
    <MermaidStreamingContext.Provider value={streaming}>
      <MarkdownBlockStack imageSources={imageSources}>
        {segments.map((segment) =>
          segment.kind === "mermaid" ? (
            <MermaidFence key={`${segment.kind}:${segment.id}`} code={segment.source} />
          ) : (
            <ThemedMarkdown
              key={`${segment.kind}:${segment.id}`}
              markdown={segment.source}
              uniProps={pickMarkdownStyle(compact, muted, useChatImageSizing)}
              flavor="github"
              selectable={selectable}
              md4cFlags={external ? EXTERNAL_MD4C_FLAGS : MD4C_FLAGS}
              linkRecognition={linkRecognition}
              enableTaskListItemToggle={false}
              enableLinkPreview={false}
              enableBlockContextMenu={false}
              // JS reveal owns pacing; native fade animation is a separate experiment.
              streamingAnimation={false}
              onLinkPress={pressLink}
              onImagePress={pressImage}
              renderers={isWeb ? WEB_RENDERERS : undefined}
            />
          ),
        )}
        {!external ? (
          <MarkdownLinkedImagesStrip items={linkedImages} onOpenImage={openLinkedImage} />
        ) : null}
      </MarkdownBlockStack>
      {lightboxState ? (
        <AttachmentLightbox
          source={lightboxState.source}
          gallery={galleryItems.length > 1 ? galleryItems : undefined}
          initialIndex={lightboxState.index}
          onClose={closeImage}
        />
      ) : null}
    </MermaidStreamingContext.Provider>
  );
});
