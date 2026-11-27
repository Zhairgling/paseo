import { memo, useCallback, useMemo } from "react";
import { Image, Text, View } from "react-native";
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
  onPress,
}: {
  item: ResolvedLinkedMarkdownImage;
  onPress: (uri: string) => void;
}) {
  const handlePress = useCallback(() => {
    onPress(item.uri);
  }, [item.uri, onPress]);
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

/** Compact clickable image thumbnails shown inline below chat Markdown for linked screenshots/photos. */
export const MarkdownLinkedImagesStrip = memo(function MarkdownLinkedImagesStrip({
  items,
  onOpenImage,
}: {
  items: readonly ResolvedLinkedMarkdownImage[];
  onOpenImage: (uri: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <View style={styles.strip} testID="markdown-linked-images-strip">
      {items.map((item) => (
        <LinkedImageThumbnailCard key={item.source} item={item} onPress={onOpenImage} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  strip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
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
