import { useWorkspace, useFileUrl, type PluginFilePanelProps } from "@getpaseo/plugin/client";
import { useCallback, useRef, useState } from "react";
import {
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ZoomableImage } from "@/components/zoomable-viewport/image";
import { useSessionStore } from "@/stores/session-store";
import { FileHtmlPreview } from "./html-preview";
import { FilePanelLoading } from "./loading";
import { FileMarkdownPreview } from "./markdown-preview";
import { TextFilePanel, type TextFilePreviewProps } from "./source/panel";
import type { RenderingFilePanel, SourceFilePanel } from "./catalog";

/** Source: the text file panel with no Preview, for text files no other built-in panel claims. */
function SourcePanel(props: PluginFilePanelProps) {
  return <TextFilePanel {...props} />;
}

/** Markdown: the text file panel with the rendered document as its Preview. */
function MarkdownPanel(props: PluginFilePanelProps) {
  return <TextFilePanel {...props} preview={MarkdownPreview} />;
}

/** HTML: the text file panel with the sandboxed page as its Preview. */
function HtmlPanel(props: PluginFilePanelProps) {
  return <TextFilePanel {...props} preview={HtmlPreview} />;
}

/** Shows Loading until the rendered Markdown has laid out once; later edits keep the content. */
function MarkdownPreview({ text, params, workspaceId, host }: TextFilePreviewProps) {
  const client = useSessionStore((state) => state.sessions[host.id]?.client ?? null);
  const workspaceRoot = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const [rendered, setRendered] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const scrollMetricsRef = useRef({
    scrollY: 0,
    ratio: 0,
    layoutWidth: 0,
    layoutHeight: 0,
    contentHeight: 0,
  });

  const handleLayout = useCallback(() => setRendered(true), []);

  const restoreScrollRatioIfWidthChanged = useCallback(
    (nextLayoutWidth: number, nextLayoutHeight: number, nextContentHeight: number) => {
      const m = scrollMetricsRef.current;
      const widthChanged = m.layoutWidth > 0 && Math.abs(nextLayoutWidth - m.layoutWidth) > 20;
      m.layoutWidth = nextLayoutWidth;
      m.layoutHeight = nextLayoutHeight;
      m.contentHeight = nextContentHeight;
      if (widthChanged && m.ratio > 0) {
        const maxScroll = Math.max(0, nextContentHeight - nextLayoutHeight);
        const targetY = Math.round(m.ratio * maxScroll);
        m.scrollY = targetY;
        scrollViewRef.current?.scrollTo({ y: targetY, animated: false });
      }
    },
    [],
  );

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const maxScroll = Math.max(0, contentSize.height - layoutMeasurement.height);
    scrollMetricsRef.current.scrollY = contentOffset.y;
    scrollMetricsRef.current.layoutWidth = layoutMeasurement.width;
    scrollMetricsRef.current.layoutHeight = layoutMeasurement.height;
    scrollMetricsRef.current.contentHeight = contentSize.height;
    scrollMetricsRef.current.ratio =
      maxScroll > 0 ? Math.min(1, Math.max(0, contentOffset.y / maxScroll)) : 0;
  }, []);

  const handleScrollLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      restoreScrollRatioIfWidthChanged(width, height, scrollMetricsRef.current.contentHeight);
    },
    [restoreScrollRatioIfWidthChanged],
  );

  const handleContentSizeChange = useCallback((_width: number, height: number) => {
    const m = scrollMetricsRef.current;
    if (m.ratio > 0 && m.layoutHeight > 0 && Math.abs(height - m.contentHeight) > 24) {
      const maxScroll = Math.max(0, height - m.layoutHeight);
      const targetY = Math.round(m.ratio * maxScroll);
      m.contentHeight = height;
      m.scrollY = targetY;
      scrollViewRef.current?.scrollTo({ y: targetY, animated: false });
    } else {
      m.contentHeight = height;
    }
  }, []);

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollViewRef}
        style={styles.container}
        showsVerticalScrollIndicator
        onScroll={handleScroll}
        onLayout={handleScrollLayout}
        onContentSizeChange={handleContentSizeChange}
        scrollEventThrottle={32}
      >
        <View onLayout={handleLayout}>
          <FileMarkdownPreview
            source={text}
            filePath={params.path}
            workspaceRoot={workspaceRoot ?? ""}
            client={client}
            serverId={host.id}
          />
        </View>
      </ScrollView>
      {rendered ? null : <FilePanelLoading />}
    </View>
  );
}

/** The page owns its scrolling, so there is no ScrollView around it. */
function HtmlPreview({ text }: TextFilePreviewProps) {
  return (
    <View style={styles.container}>
      <FileHtmlPreview html={text} testID="file-html-preview" />
    </View>
  );
}

function ImagePanel({ file }: PluginFilePanelProps) {
  const url = useFileUrl(file);
  if (url.status === "loading") return <FilePanelLoading />;
  if (url.status === "error") return <FilePanelError message={url.error.message} />;
  return <ZoomableImage uri={url.url} testID="image-file-preview" />;
}

function FilePanelError({ message }: { message: string }) {
  return (
    <View style={styles.centerState}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

const components = {
  "builtin:markdown": MarkdownPanel,
  "builtin:html": HtmlPanel,
  "builtin:image": ImagePanel,
  "builtin:source": SourcePanel,
};

export function BuiltinFilePanelView({
  panel,
  ...props
}: PluginFilePanelProps & { panel: RenderingFilePanel | SourceFilePanel }) {
  const Component = components[panel.id];
  return <Component {...props} />;
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, minHeight: 0 },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
}));
