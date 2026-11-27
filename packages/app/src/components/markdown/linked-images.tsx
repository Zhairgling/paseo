import { memo, useCallback, useMemo } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { PressHighlight } from "@/components/ui/press-highlight";

export interface ResolvedLinkedMarkdownImage {
  source: string;
  label: string;
  uri: string;
}

const THUMBNAIL_WIDTH = 116;
const THUMBNAIL_HEIGHT = 82;

const LinkedImageThumbnailCard = memo(function LinkedImageThumbnailCard({
  item,
  index,
  onPress,
}: {
  item: ResolvedLinkedMarkdownImage;
  index: number;
  onPress: (uri: string, index: number) => void;
}) {
  const handlePress = useCallback(() => {
    onPress(item.uri, index);
  }, [index, item.uri, onPress]);
  const imageSource = useMemo(() => ({ uri: item.uri }), [item.uri]);

  return (
    <PressHighlight
      onPress={handlePress}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={item.label}
      testID={`markdown-linked-image-${item.label}`}
    >
      <Image source={imageSource} style={styles.image} resizeMode="cover" />
      <Text style={styles.label} numberOfLines={1} ellipsizeMode="middle">
        {item.label}
      </Text>
    </PressHighlight>
  );
});

/** Compact clickable image thumbnails shown inline below chat Markdown (horizontally swipeable for galleries). */
export const MarkdownLinkedImagesStrip = memo(function MarkdownLinkedImagesStrip({
  items,
  onOpenImage,
}: {
  items: readonly ResolvedLinkedMarkdownImage[];
  onOpenImage: (uri: string, index: number) => void;
}) {
  if (items.length === 0) return null;
  if (items.length === 1) {
    return (
      <View style={styles.stripSingle} testID="markdown-linked-images-strip">
        <LinkedImageThumbnailCard item={items[0]!} index={0} onPress={onOpenImage} />
      </View>
    );
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.stripScroll}
      contentContainerStyle={styles.stripContent}
      testID="markdown-linked-images-strip"
    >
      {items.map((item, index) => (
        <LinkedImageThumbnailCard
          key={item.source}
          item={item}
          index={index}
          onPress={onOpenImage}
        />
      ))}
    </ScrollView>
  );
});

const styles = StyleSheet.create((theme) => ({
  stripSingle: {
    flexDirection: "row",
    marginTop: theme.spacing[1],
  },
  stripScroll: {
    marginTop: theme.spacing[1],
    flexGrow: 0,
  },
  stripContent: {
    flexDirection: "row",
    gap: theme.spacing[2],
    paddingRight: theme.spacing[2],
  },
  card: {
    width: THUMBNAIL_WIDTH,
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: THUMBNAIL_HEIGHT,
    backgroundColor: theme.colors.surface2,
  },
  label: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
