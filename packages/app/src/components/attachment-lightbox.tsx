import { useOverlayRegistration, type KeyboardInputEvent } from "@/keyboard";
import { Modal } from "@/components/ui/modal";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StyleSheet } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, ChevronRight, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { AttachmentMetadata } from "@/attachments/types";
import {
  type AttachmentPreviewUrl,
  useAttachmentPreviewUrl,
} from "@/attachments/use-attachment-preview-url";
import { isNative } from "@/constants/platform";
import { SPACING } from "@/styles/theme";
import { WindowChromeRootRegion } from "@/utils/desktop-window";
import { ZoomableImage } from "@/components/zoomable-viewport/image";
import type { ViewportSize } from "@/components/zoomable-viewport/geometry";
import { useGlobalOverlayLayer } from "@/lib/overlay-root";
import { WindowSafeArea } from "@/window-layout";

export type ImageLightboxSource =
  | { type: "attachment"; metadata: AttachmentMetadata }
  | { type: "uri"; uri: string; contentSize?: ViewportSize };

interface AttachmentLightboxProps {
  source: ImageLightboxSource | null;
  gallery?: readonly ImageLightboxSource[];
  initialIndex?: number;
  onClose: () => void;
}

const ModalRoot = isNative ? GestureHandlerRootView : View;
const LIGHTBOX_FIT = { padding: SPACING[4], maxWidth: 960, maxHeight: 640 };

function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, index));
}

function LightboxSlide({
  item,
  onClose,
  onZoomScaleChange,
  showGalleryTestId,
}: {
  item: ImageLightboxSource;
  onClose: () => void;
  onZoomScaleChange: (scale: number) => void;
  showGalleryTestId?: string;
}) {
  const { t } = useTranslation();
  const metadata = item.type === "attachment" ? item.metadata : null;
  const attachmentPreview = useAttachmentPreviewUrl(metadata);
  const image: AttachmentPreviewUrl =
    item.type === "uri" ? { status: "ready", url: item.uri } : attachmentPreview;
  const url = image.status === "ready" ? image.url : null;
  const contentSize = item.type === "uri" ? item.contentSize : undefined;
  const [errored, setErrored] = useState(false);
  const failed = errored || image.status === "failed";

  useEffect(() => {
    setErrored(false);
  }, [metadata?.id, url]);

  const actions = useMemo(
    () => [
      {
        icon: X,
        label: t("message.attachments.closeImage"),
        onPress: onClose,
        testID: "attachment-lightbox-close",
      },
    ],
    [onClose, t],
  );
  const handleImageError = useCallback(() => setErrored(true), []);

  return (
    <LightboxImageArea onClose={onClose} showFallbackClose={failed || !url}>
      {failed ? (
        <Text style={styles.errorText}>{t("message.attachments.imageLoadFailed")}</Text>
      ) : null}
      {!failed && url ? (
        <ZoomableImage
          accessibilityLabel={t("composer.attachments.openImage")}
          actions={actions}
          contentSize={contentSize}
          fit={LIGHTBOX_FIT}
          onError={handleImageError}
          onPressOutsideContent={onClose}
          onZoomScaleChange={onZoomScaleChange}
          style={styles.imageViewport}
          testID={showGalleryTestId ?? "attachment-lightbox"}
          uri={url}
        />
      ) : null}
    </LightboxImageArea>
  );
}

function LightboxGalleryPager({
  items,
  activeIndex,
  pageWidth,
  isZoomed,
  pagerRef,
  onMomentumScrollEnd,
  onClose,
  onZoomScaleChange,
}: {
  items: readonly ImageLightboxSource[];
  activeIndex: number;
  pageWidth: number;
  isZoomed: boolean;
  pagerRef: React.RefObject<ScrollView | null>;
  onMomentumScrollEnd: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onClose: () => void;
  onZoomScaleChange: (scale: number) => void;
}) {
  return (
    <ScrollView
      ref={pagerRef}
      horizontal
      pagingEnabled
      scrollEnabled={!isZoomed}
      showsHorizontalScrollIndicator={false}
      onMomentumScrollEnd={onMomentumScrollEnd}
      style={styles.pager}
      testID="attachment-lightbox-gallery"
    >
      {items.map((item, idx) => (
        <View
          key={item.type === "uri" ? item.uri : item.metadata.id}
          style={[styles.slide, { width: pageWidth }]}
        >
          <LightboxSlide
            item={item}
            onClose={onClose}
            onZoomScaleChange={onZoomScaleChange}
            showGalleryTestId={
              idx === activeIndex ? "attachment-lightbox" : `attachment-lightbox-${idx}`
            }
          />
        </View>
      ))}
    </ScrollView>
  );
}

function LightboxGalleryControls({
  activeIndex,
  total,
  onPrev,
  onNext,
}: {
  activeIndex: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <>
      <View
        pointerEvents="none"
        style={[styles.counterPill, { top: insets.top + 14 }]}
        testID="attachment-lightbox-counter"
      >
        <Text style={styles.counterText}>
          {activeIndex + 1} / {total}
        </Text>
      </View>
      {activeIndex > 0 ? (
        <Pressable
          onPress={onPrev}
          style={[styles.navButton, { left: insets.left + 12 }]}
          accessibilityRole="button"
          accessibilityLabel="Image précédente"
          testID="attachment-lightbox-prev"
        >
          <ChevronLeft size={22} color="#F2EDE6" />
        </Pressable>
      ) : null}
      {activeIndex < total - 1 ? (
        <Pressable
          onPress={onNext}
          style={[styles.navButton, { right: insets.right + 12 }]}
          accessibilityRole="button"
          accessibilityLabel="Image suivante"
          testID="attachment-lightbox-next"
        >
          <ChevronRight size={22} color="#F2EDE6" />
        </Pressable>
      ) : null}
    </>
  );
}

export function AttachmentLightbox({
  source,
  gallery,
  initialIndex = 0,
  onClose,
}: AttachmentLightboxProps) {
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const items = useMemo<readonly ImageLightboxSource[]>(() => {
    if (gallery && gallery.length > 0 && source) return gallery;
    return source ? [source] : [];
  }, [gallery, source]);
  const isGallery = items.length > 1;
  const [activeIndex, setActiveIndex] = useState(() => clampIndex(initialIndex, items.length));
  const [pageWidth, setPageWidth] = useState(windowWidth);
  const [isZoomed, setIsZoomed] = useState(false);
  const pagerRef = useRef<ScrollView>(null);
  const modalLayer = useGlobalOverlayLayer("modal", items.length > 0);

  useEffect(() => {
    const nextIndex = clampIndex(initialIndex, items.length);
    setActiveIndex(nextIndex);
    setIsZoomed(false);
    if (isGallery && pageWidth > 0) {
      requestAnimationFrame(() => {
        pagerRef.current?.scrollTo({ x: nextIndex * pageWidth, y: 0, animated: false });
      });
    }
  }, [initialIndex, isGallery, items.length, pageWidth, source]);

  useEffect(() => {
    if (items.length === 0 || !isNative) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [items.length, onClose]);

  const goToIndex = useCallback(
    (nextRaw: number) => {
      const next = clampIndex(nextRaw, items.length);
      if (next === activeIndex) return;
      setActiveIndex(next);
      setIsZoomed(false);
      pagerRef.current?.scrollTo({ x: next * pageWidth, y: 0, animated: true });
    },
    [activeIndex, items.length, pageWidth],
  );

  const handlePrev = useCallback(() => goToIndex(activeIndex - 1), [activeIndex, goToIndex]);
  const handleNext = useCallback(() => goToIndex(activeIndex + 1), [activeIndex, goToIndex]);

  const handleOverlayKeyDown = useCallback(
    (event: KeyboardInputEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return true;
      }
      if (isGallery && event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        goToIndex(activeIndex - 1);
        return true;
      }
      if (isGallery && event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        goToIndex(activeIndex + 1);
        return true;
      }
      return false;
    },
    [activeIndex, goToIndex, isGallery, onClose],
  );
  const overlayKeys = useMemo(
    () => (isGallery ? ["Escape", "ArrowLeft", "ArrowRight"] : ["Escape"]),
    [isGallery],
  );
  const setOverlayScope = useOverlayRegistration({
    keys: overlayKeys,
    active: items.length > 0,
    layer: modalLayer,
    onKeyDown: handleOverlayKeyDown,
  });

  const handlePagerLayout = useCallback((event: LayoutChangeEvent) => {
    const width = Math.round(event.nativeEvent.layout.width);
    if (width > 0) setPageWidth(width);
  }, []);

  const handleMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (pageWidth <= 0) return;
      const next = clampIndex(
        Math.round(event.nativeEvent.contentOffset.x / pageWidth),
        items.length,
      );
      if (next !== activeIndex) {
        setActiveIndex(next);
        setIsZoomed(false);
      }
    },
    [activeIndex, items.length, pageWidth],
  );

  const handleZoomScaleChange = useCallback((scale: number) => {
    setIsZoomed(scale > 1.02);
  }, []);

  if (items.length === 0) {
    return null;
  }

  return (
    <Modal transparent animationType="fade" statusBarTranslucent visible onRequestClose={onClose}>
      <ModalRoot style={styles.root}>
        {/* The modal draws over the whole window: its insets are the window's, not the ones left
            where the image was opened (inside a sheet tab, the bottom one is already spent). */}
        <WindowSafeArea>
          <WindowChromeRootRegion corners="both">
            <View ref={setOverlayScope} style={styles.root} onLayout={handlePagerLayout}>
              <Pressable
                testID="attachment-lightbox-backdrop"
                accessibilityRole="button"
                accessibilityLabel={t("message.attachments.dismissImage")}
                onPress={onClose}
                style={styles.backdrop}
              />
              {isGallery ? (
                <LightboxGalleryPager
                  items={items}
                  activeIndex={activeIndex}
                  pageWidth={pageWidth}
                  isZoomed={isZoomed}
                  pagerRef={pagerRef}
                  onMomentumScrollEnd={handleMomentumScrollEnd}
                  onClose={onClose}
                  onZoomScaleChange={handleZoomScaleChange}
                />
              ) : (
                <LightboxSlide
                  item={items[0]!}
                  onClose={onClose}
                  onZoomScaleChange={handleZoomScaleChange}
                />
              )}
              {isGallery ? (
                <LightboxGalleryControls
                  activeIndex={activeIndex}
                  total={items.length}
                  onPrev={handlePrev}
                  onNext={handleNext}
                />
              ) : null}
            </View>
          </WindowChromeRootRegion>
        </WindowSafeArea>
      </ModalRoot>
    </Modal>
  );
}

function LightboxImageArea({
  children,
  onClose,
  showFallbackClose,
}: {
  children: ReactNode;
  onClose: () => void;
  showFallbackClose: boolean;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const style = useMemo(
    () => [
      styles.contentLayer,
      {
        paddingTop: insets.top,
        paddingRight: insets.right,
        paddingBottom: insets.bottom,
        paddingLeft: insets.left,
      },
    ],
    [insets.bottom, insets.left, insets.right, insets.top],
  );
  const fallbackCloseStyle = useMemo(
    () => [styles.fallbackCloseButton, { top: insets.top + 12, right: insets.right + 16 }],
    [insets.right, insets.top],
  );
  return (
    <View pointerEvents="box-none" style={style}>
      <View pointerEvents="box-none" style={styles.imageArea}>
        {children}
      </View>
      {showFallbackClose ? (
        <Pressable
          onPress={onClose}
          style={fallbackCloseStyle}
          accessibilityRole="button"
          accessibilityLabel={t("message.attachments.closeImage")}
          testID="attachment-lightbox-fallback-close"
        >
          <X size={20} color="#F2EDE6" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  pager: {
    flex: 1,
  },
  slide: {
    height: "100%",
    position: "relative",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.9)",
  },
  contentLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  imageArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  imageViewport: {
    flex: 1,
    width: "100%",
    alignSelf: "center",
  },
  errorText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  fallbackCloseButton: {
    position: "absolute",
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(30, 27, 24, 0.85)",
    alignItems: "center",
    justifyContent: "center",
  },
  counterPill: {
    position: "absolute",
    alignSelf: "center",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.14)",
    backgroundColor: "rgba(21, 16, 11, 0.84)",
  },
  counterText: {
    color: "#F2EDE6",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  navButton: {
    position: "absolute",
    top: "50%",
    marginTop: -20,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.14)",
    backgroundColor: "rgba(21, 16, 11, 0.82)",
    alignItems: "center",
    justifyContent: "center",
  },
  navPrev: {},
  navNext: {},
}));
