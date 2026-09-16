import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  Dimensions,
  ScrollView,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { IconSymbol } from "@/components/ui/icon-symbol";
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
  const where = previousDropOff?.locationName?.trim() || null;
  const hasDetails = !!(previousDropOff || note);

  const [lightboxVisible, setLightboxVisible] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const openLightbox = (index: number) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
        <View style={[styles.iconWrap, hasPhotos ? styles.iconWrapPhotos : styles.iconWrapMuted]}>
          <IconSymbol
            name={hasPhotos ? "photo.on.rectangle" : "camera.fill"}
            size={compact ? 16 : 18}
            color={hasPhotos ? "#E65100" : hasDetails ? "#F9A825" : "#8D6E63"}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.kicker, hasPhotos ? styles.kickerPhotos : styles.kickerMuted]}>
            PREVIOUS DROP-OFF
          </Text>
          <Text style={[styles.title, hasPhotos ? styles.titlePhotos : styles.titleMuted]}>
            {hasPhotos
              ? `${photos.length} photo${photos.length === 1 ? "" : "s"} from ${who ?? "previous drop-off"}`
              : hasDetails
                ? "No previous drop-off photos"
                : "No previous drop-off photos or notes"}
          </Text>
        </View>
      </View>

      {hasPhotos ? (
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
      ) : (
        <View style={styles.emptyPhotos}>
          <Text style={styles.emptyPhotosText}>
            {hasDetails
              ? "The previous drop-off did not include photos. Use the note below to find the unit."
              : "Nobody has left drop-off photos or notes for this pickup yet."}
          </Text>
        </View>
      )}

      {(who || when || where) && (
        <Text style={styles.meta}>
          {[
            who,
            when ? `dropped ${when}` : null,
            where,
          ].filter(Boolean).join(" · ")}
        </Text>
      )}

      {keysLocation ? (
        <View style={styles.keysRow}>
          <IconSymbol name="key.fill" size={14} color="#E65100" />
          <Text style={styles.keysText}>{keysLocation}</Text>
        </View>
      ) : null}

      {note ? (
        <View style={styles.noteBlock}>
          <Text style={styles.noteLabel}>Note</Text>
          <Text style={styles.noteText}>{note}</Text>
        </View>
      ) : null}

      <Modal
        visible={lightboxVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxVisible(false)}
        statusBarTranslucent
      >
        <View style={styles.lightboxOverlay}>
          <TouchableOpacity
            style={styles.lightboxClose}
            onPress={() => setLightboxVisible(false)}
            activeOpacity={0.8}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <View style={styles.lightboxCloseCircle}>
              <IconSymbol name="xmark" size={16} color="#fff" />
            </View>
          </TouchableOpacity>
          <FlatList
            data={photos}
            keyExtractor={(_, i) => String(i)}
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={5}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={lightboxIndex}
            getItemLayout={(_, index) => ({
              length: Dimensions.get("window").width,
              offset: Dimensions.get("window").width * index,
              index,
            })}
            onMomentumScrollEnd={(e) => {
              const next = Math.round(e.nativeEvent.contentOffset.x / Dimensions.get("window").width);
              setLightboxIndex(next);
            }}
            renderItem={({ item }) => (
              <View style={[styles.lightboxPage, { width: Dimensions.get("window").width }]}>
                <Image source={{ uri: item }} style={styles.lightboxImage} contentFit="contain" />
              </View>
            )}
          />
          <Text style={styles.lightboxCounter}>
            {lightboxIndex + 1} / {photos.length}
          </Text>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    marginBottom: 12,
  },
  cardCompact: {
    padding: 12,
    marginBottom: 0,
  },
  cardWithPhotos: {
    backgroundColor: "#FFF8E1",
    borderColor: "#FFB300",
  },
  cardWithNote: {
    backgroundColor: "#FFF8E1",
    borderColor: "#FFD54F",
  },
  cardEmpty: {
    backgroundColor: "#F5F5F5",
    borderColor: "#E0E0E0",
    borderStyle: "dashed",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  iconWrapPhotos: {
    backgroundColor: "#FFE082",
  },
  iconWrapMuted: {
    backgroundColor: "rgba(0,0,0,0.06)",
  },
  kicker: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  kickerPhotos: {
    color: "#E65100",
  },
  kickerMuted: {
    color: "#8D6E63",
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
  },
  titlePhotos: {
    color: "#E65100",
  },
  titleMuted: {
    color: "#5D4037",
  },
  thumbStrip: {
    paddingTop: 12,
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
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#FFE082",
    borderRadius: 10,
    paddingVertical: 10,
  },
  viewBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#E65100",
  },
  emptyPhotos: {
    marginTop: 10,
    backgroundColor: "rgba(0,0,0,0.04)",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  emptyPhotosText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#6D4C41",
  },
  meta: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 17,
    color: "#6D4C41",
    fontWeight: "600",
  },
  keysRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 8,
  },
  keysText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: "#5D4037",
    fontWeight: "600",
  },
  noteBlock: {
    marginTop: 10,
  },
  noteLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#E65100",
    marginBottom: 3,
    letterSpacing: 0.3,
  },
  noteText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#5D4037",
  },
  lightboxOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  lightboxClose: {
    position: "absolute",
    top: 56,
    right: 20,
    zIndex: 10,
  },
  lightboxCloseCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  lightboxPage: {
    justifyContent: "center",
    alignItems: "center",
    height: Dimensions.get("window").height,
  },
  lightboxImage: {
    width: Dimensions.get("window").width,
    height: Dimensions.get("window").height * 0.75,
  },
  lightboxCounter: {
    position: "absolute",
    bottom: 60,
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontWeight: "600",
  },
});
