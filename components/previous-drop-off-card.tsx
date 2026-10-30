import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { PhotoLightbox } from "@/components/photo-lightbox";
import type { PreviousDropOff } from "@/lib/data";
import {
  formatDroppedAt,
  previousDropOffDisplayNote,
  previousDropOffSourceLabel,
} from "@/lib/previous-drop-off";

type Props = {
  previousDropOff: PreviousDropOff | null | undefined;
  fallbackNote?: string | null;
  /** Pickup inspection uses a slightly tighter layout. */
  compact?: boolean;
};

/**
 * Read-only yard-handoff card. Always visible so drivers can tell at a glance
 * whether previous drop-off photos exist — not only when they do.
 */
export function PreviousDropOffCard({ previousDropOff, fallbackNote, compact }: Props) {
  const photos = previousDropOff?.photos ?? [];
  const hasPhotos = photos.length > 0;
  const note = previousDropOffDisplayNote(previousDropOff, fallbackNote);
  const keysLocation = previousDropOff?.keysLocation?.trim() || null;
  const who =
    previousDropOff?.driverName?.trim() ||
    (previousDropOff ? previousDropOffSourceLabel(previousDropOff.source) : null);
  const when = formatDroppedAt(previousDropOff?.droppedAt);
  const showKeys =
    !!keysLocation &&
    (!note || keysLocation.toLowerCase() !== note.toLowerCase());
  const hasDetails = !!(previousDropOff || note);

  const [photosExpanded, setPhotosExpanded] = useState(false);
  const [lightboxVisible, setLightboxVisible] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const tap = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const togglePhotos = () => {
    tap();
    setPhotosExpanded((open) => !open);
  };

  const openLightbox = (index: number) => {
    tap();
    setLightboxIndex(index);
    setLightboxVisible(true);
  };

  return (
    <View
      style={[
        styles.card,
        hasPhotos ? styles.cardWithPhotos : hasDetails ? styles.cardWithNote : styles.cardEmpty,
        compact && styles.cardCompact,
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.kicker, hasPhotos || note ? styles.kickerPhotos : styles.kickerMuted]}>
          PREVIOUS DROP-OFF
        </Text>
        {hasPhotos ? (
          <TouchableOpacity
            style={styles.photoChip}
            onPress={togglePhotos}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={
              photosExpanded
                ? "Hide previous drop-off photos"
                : `Show ${photos.length} previous drop-off photo${photos.length === 1 ? "" : "s"}`
            }
          >
            <IconSymbol name="photo.on.rectangle" size={13} color="#E65100" />
            <Text style={styles.photoChipText}>
              {photos.length} photo{photos.length === 1 ? "" : "s"}
            </Text>
            <IconSymbol
              name={photosExpanded ? "chevron.up" : "chevron.down"}
              size={12}
              color="#E65100"
            />
          </TouchableOpacity>
        ) : (
          <View style={styles.noPhotoChip} accessibilityLabel="No previous drop-off photos">
            <IconSymbol name="camera.fill" size={13} color="#8D6E63" />
            <Text style={styles.noPhotoChipText}>No photos</Text>
          </View>
        )}
      </View>

      {hasPhotos && photosExpanded ? (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.thumbStrip}
          >
            {photos.map((uri, index) => (
              <TouchableOpacity
                key={`${uri}-${index}`}
                onPress={() => openLightbox(index)}
                activeOpacity={0.85}
                style={[styles.thumbWrap, index === photos.length - 1 && { marginRight: 0 }]}
                accessibilityRole="imagebutton"
                accessibilityLabel={`View drop-off photo ${index + 1} of ${photos.length}`}
              >
                <Image source={{ uri }} style={styles.thumb} contentFit="cover" />
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity
            style={styles.viewBtn}
            onPress={() => openLightbox(0)}
            activeOpacity={0.8}
          >
            <IconSymbol name="photo.on.rectangle" size={14} color="#E65100" />
            <Text style={styles.viewBtnText}>View drop-off photos</Text>
          </TouchableOpacity>
        </>
      ) : null}

      {note ? (
        <Text style={styles.noteText}>{note}</Text>
      ) : !hasPhotos ? (
        <Text style={styles.emptyText}>No previous drop-off photos or notes</Text>
      ) : null}

      {showKeys ? (
        <View style={styles.keysRow}>
          <IconSymbol name="key.fill" size={13} color="#BF360C" />
          <Text style={styles.keysText}>{keysLocation}</Text>
        </View>
      ) : null}

      {(who || when) ? (
        <Text style={styles.meta}>
          {[who, when].filter(Boolean).join(" · ")}
        </Text>
      ) : null}

      <PhotoLightbox
        visible={lightboxVisible}
        uris={photos}
        initialIndex={lightboxIndex}
        onClose={() => setLightboxVisible(false)}
        title="Previous drop-off"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1.5,
    marginBottom: 12,
  },
  cardCompact: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 0,
  },
  cardWithPhotos: {
    backgroundColor: "#FFF8E1",
    borderColor: "#FFB300",
  },
  cardWithNote: {
    backgroundColor: "#FFF8E1",
    borderColor: "#FFB300",
  },
  cardEmpty: {
    backgroundColor: "#F5F5F5",
    borderColor: "#E0E0E0",
    borderStyle: "dashed",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  kicker: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  kickerPhotos: {
    color: "#E65100",
  },
  kickerMuted: {
    color: "#8D6E63",
  },
  photoChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FFE082",
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  photoChipText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#E65100",
  },
  noPhotoChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(141,110,99,0.12)",
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  noPhotoChipText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#8D6E63",
  },
  noteText: {
    marginTop: 6,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "800",
    color: "#BF360C",
  },
  emptyText: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: "600",
    color: "#6D4C41",
  },
  keysRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 6,
  },
  keysText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    color: "#BF360C",
    fontWeight: "700",
  },
  meta: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 15,
    color: "#8D6E63",
    fontWeight: "600",
  },
  thumbStrip: {
    paddingTop: 10,
    paddingBottom: 4,
  },
  thumbWrap: {
    width: 96,
    height: 96,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#FFE082",
    marginRight: 8,
  },
  thumb: {
    width: 96,
    height: 96,
  },
  viewBtn: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#FFE082",
    borderRadius: 10,
    paddingVertical: 8,
  },
  viewBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#E65100",
  },
});
