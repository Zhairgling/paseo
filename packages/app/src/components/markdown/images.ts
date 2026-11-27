import { Image } from "react-native";
import { isWeb } from "@/constants/platform";
import { useMemo, useEffect, useId } from "react";
import { useFetchQueries } from "@/data/query";
import { createAssistantImageFileAcquisition } from "@/assistant-image/file-acquisition";
import {
  persistAttachmentFromBytes,
  resolveAttachmentPreviewUrl,
  releaseAttachmentPreviewUrl,
} from "@/attachments/service";
import { createAssistantImageAcquisitionCache } from "@/assistant-image/acquisition-cache";
import { retainAttachmentForGarbageCollection } from "@/attachments/gc-retention";
import { resolveAssistantImageSource } from "@/utils/assistant-image-source";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AttachmentMetadata } from "@/attachments/types";
import { resolveMarkdownPreviewImageSource } from "./image-source";
import { prepareMarkdownSource } from "./source";
import { decodeMarkdownImage, getMarkdownImageStatus } from "./image-decoding";
import type { ResolvedLinkedMarkdownImage } from "./linked-images";

const urls = createAssistantImageAcquisitionCache<{ uri: string; attachment: AttachmentMetadata }>({
  capacity: 500,
  onRetain: ({ uri, attachment }) => {
    const release = retainAttachmentForGarbageCollection(attachment.id);
    return () => {
      release();
      void releaseAttachmentPreviewUrl({ attachment, url: uri });
    };
  },
});

export interface MarkdownImageContext {
  client?: Pick<DaemonClient, "readFile"> | null;
  workspaceRoot?: string;
  serverId?: string;
  filePath?: string;
}

export function useMarkdownSource(
  text: string,
  context: MarkdownImageContext,
  links: {
    commandNames?: ReadonlySet<string>;
    forgeReferencePattern?: string;
    knownSessionTokensKey?: string;
    external?: boolean;
  } = {},
) {
  const occurrenceKey = useId();
  const { commandNames, forgeReferencePattern, knownSessionTokensKey, external } = links;
  const knownSessionTokens = useMemo(
    () =>
      knownSessionTokensKey ? knownSessionTokensKey.split("\u0000").filter(Boolean) : undefined,
    [knownSessionTokensKey],
  );
  const prepared = useMemo(
    () =>
      prepareMarkdownSource(text, context.workspaceRoot, {
        supportsSvg: isWeb,
        commandNames,
        forgeReferencePattern,
        knownSessionTokens,
        external,
      }),
    [
      text,
      context.workspaceRoot,
      commandNames,
      forgeReferencePattern,
      knownSessionTokens,
      external,
    ],
  );
  const inlineSources = prepared.images.map((image) => image.source);
  const sources = [
    ...new Set([...inlineSources, ...prepared.linkedImages.map((img) => img.source)]),
  ];
  const acquisitions = sources.map((source) => {
    const resolved = resolveMarkdownPreviewImageSource({
      source,
      markdownPath: context.filePath ?? "",
      workspaceRoot: context.workspaceRoot,
    });
    return createAssistantImageFileAcquisition({
      port: context.client
        ? {
            readFile: (cwd, path) => context.client!.readFile(cwd, path),
            persist: persistAttachmentFromBytes,
          }
        : null,
      resolution: resolved
        ? resolveAssistantImageSource({ source: resolved, workspaceRoot: context.workspaceRoot })
        : null,
      serverId: context.serverId,
      occurrenceKey,
      unavailableMessage: "Image unavailable",
    });
  });
  const results = useFetchQueries(
    acquisitions.map((acquisition, index) => ({
      queryKey: ["markdownImage", acquisition?.key ?? sources[index]],
      // A host that hasn't connected yet has no client. Its images stay pending until it does: the
      // key doesn't change when the client arrives, so a read that already failed would not run
      // again. Markdown with no host has no client to wait for and falls back to its alt text.
      enabled: acquisition !== null && (context.client != null || !context.serverId),
      immutableWhen: () => true,
      dataShape: "value",
      gcTime: 0,
      queryFn: async () => {
        if (!acquisition) throw new Error("No image acquisition");
        return urls.acquire(acquisition.key, async () => {
          const attachment = await acquisition.locate();
          const uri = await resolveAttachmentPreviewUrl(attachment);
          return { attachment, uri };
        });
      },
    })),
  );
  useEffect(() => {
    const releases = results.flatMap((result, index) => {
      const acquisition = acquisitions[index];
      if (!result.data || !acquisition) return [];
      const value = result.data;
      return [urls.acquireRetained(acquisition.key, async () => value).release];
    });
    return () => releases.forEach((release) => release());
  }, [results, acquisitions]);
  const resolved = new Map<string, string>();
  results.forEach((result, index) => {
    if (result.data) resolved.set(sources[index]!, result.data.uri);
  });
  const displayUrls = sources.map(
    (source) =>
      resolved.get(source) ?? (/^(https?:|data:|blob:)/i.test(source) ? source : undefined),
  );
  const decoded = useFetchQueries(
    displayUrls.map((uri, index) => ({
      queryKey: ["markdownImageDecode", occurrenceKey, uri ?? sources[index]],
      refetchOnReconnect: true,
      enabled: uri !== undefined,
      immutableWhen: () => true,
      dataShape: "value",
      gcTime: 0,
      queryFn: () => {
        if (!uri) throw new Error("No image URL to decode");
        return decodeMarkdownImage(uri, Image.getSize);
      },
    })),
  );
  const statuses = sources.map((_source, index) =>
    getMarkdownImageStatus({
      canAcquire: acquisitions[index] !== null,
      url: displayUrls[index],
      acquisitionFailed: results[index].isError,
      decodeFailed: decoded[index].isError,
      decoded: decoded[index].data === true,
    }),
  );
  const unavailableImages = new Set(
    inlineSources.filter((source) => statuses[sources.indexOf(source)] === "unavailable"),
  );
  const pendingImages = new Set(
    inlineSources.filter((source) => statuses[sources.indexOf(source)] === "pending"),
  );
  const resolvedUriBySource = new Map<string, string>();
  const linkedImages: ResolvedLinkedMarkdownImage[] = [];
  sources.forEach((source, index) => {
    const uri = displayUrls[index];
    if (uri && statuses[index] === "ready") {
      resolvedUriBySource.set(source, uri);
    }
  });
  for (const item of prepared.linkedImages) {
    const uri = resolvedUriBySource.get(item.source);
    if (uri) {
      linkedImages.push({ source: item.source, label: item.label, uri });
    }
  }
  return {
    markdown: prepared.render(resolved, unavailableImages, pendingImages),
    linkRecognition: prepared.linkRecognition,
    linkSource: prepared.linkSource,
    imageSources: Object.fromEntries([...resolved].map(([source, url]) => [url, source])),
    linkedImages,
    resolvedUriBySource,
  };
}
