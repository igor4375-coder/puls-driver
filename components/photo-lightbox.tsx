/**
 * Full-screen photo lightbox with pinch / double-tap zoom.
 *
 * Drivers were screenshotting inspection photos into the gallery just to zoom
 * in on damage. This viewer opens the same photos full-screen and lets them
 * pinch or double-tap without leaving the app. Horizontal swipe still pages
 * between photos when not zoomed.
 */
import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Modal,
  FlatList,
  Dimensions,
  StyleSheet,
  TouchableOpacity,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Image } from "expo-image";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconSymbol } from "@/components/ui/icon-symbol";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

type Props = {
  visible: boolean;
  uris: string[];
  initialIndex?: number;
  onClose: () => void;
  /** Optional label shown in the header, e.g. "Pickup photos". */
  title?: string;
};

type ZoomableProps = {
  uri: string;
  /** When true, pan is allowed; parent disables paging while zoomed. */
  onZoomChange: (zoomed: boolean) => void;
};

function ZoomableImage({ uri, onZoomChange }: ZoomableProps) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTX = useSharedValue(0);
  const savedTY = useSharedValue(0);

  const resetZoom = useCallback(() => {
    "worklet";
    scale.value = withTiming(1);
    savedScale.value = 1;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedTX.value = 0;
    savedTY.value = 0;
    runOnJS(onZoomChange)(false);
  }, [onZoomChange, scale, savedScale, translateX, translateY, savedTX, savedTY]);

  // Reset when the URI changes (user swiped to another page).
  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTX.value = 0;
    savedTY.value = 0;
    onZoomChange(false);
  }, [uri]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, savedScale.value * e.scale));
      scale.value = next;
    })
    .onEnd(() => {
      if (scale.value <= 1.05) {
        resetZoom();
        return;
      }
      savedScale.value = scale.value;
      runOnJS(onZoomChange)(true);
    });

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((e) => {
      if (scale.value <= 1.05) return;
      translateX.value = savedTX.value + e.translationX;
      translateY.value = savedTY.value + e.translationY;
    })
    .onEnd(() => {
      if (scale.value <= 1.05) return;
      savedTX.value = translateX.value;
      savedTY.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1.1) {
        resetZoom();
      } else {
        scale.value = withTiming(DOUBLE_TAP_SCALE);
        savedScale.value = DOUBLE_TAP_SCALE;
        runOnJS(onZoomChange)(true);
      }
    });

  // Pinch + pan together; double-tap exclusive so it doesn't fight the pinch.
  const composed = Gesture.Exclusive(
    doubleTap,
    Gesture.Simultaneous(pinch, pan),
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={[styles.page, animatedStyle]}>
        <Image
          source={{ uri }}
          style={styles.image}
          contentFit="contain"
          // Full-res when zoomed; the gallery thumbnail path is separate.
          recyclingKey={uri}
        />
      </Animated.View>
    </GestureDetector>
  );
}

export function PhotoLightbox({
  visible,
  uris,
  initialIndex = 0,
  onClose,
  title,
}: Props) {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(initialIndex);
  const [zoomed, setZoomed] = useState(false);
  // Bumped only when the modal opens so FlatList re-applies initialScrollIndex
  // without remounting on every swipe.
  const [listKey, setListKey] = useState(0);

  useEffect(() => {
    if (visible) {
      setIndex(Math.min(Math.max(0, initialIndex), Math.max(0, uris.length - 1)));
      setZoomed(false);
      setListKey((k) => k + 1);
    }
  }, [visible, initialIndex, uris.length]);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    if (next !== index) {
      setIndex(next);
      setZoomed(false);
    }
  };

  if (!uris.length) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      presentationStyle="overFullScreen"
    >
      <View style={styles.overlay}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            activeOpacity={0.8}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Close photo viewer"
          >
            <View style={styles.closeCircle}>
              <IconSymbol name="xmark" size={16} color="#fff" />
            </View>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            {title ? <Text style={styles.headerTitle}>{title}</Text> : null}
            <Text style={styles.headerSub}>
              {index + 1} / {uris.length}
            </Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <FlatList
          key={`lb-${listKey}`}
          data={uris}
          keyExtractor={(uri, i) => `${uri}-${i}`}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={Math.min(index, uris.length - 1)}
          getItemLayout={(_, i) => ({
            length: SCREEN_W,
            offset: SCREEN_W * i,
            index: i,
          })}
          onMomentumScrollEnd={onScrollEnd}
          initialNumToRender={3}
          maxToRenderPerBatch={3}
          windowSize={3}
          renderItem={({ item }) => (
            <View style={{ width: SCREEN_W, height: SCREEN_H }}>
              <ZoomableImage uri={item} onZoomChange={setZoomed} />
            </View>
          )}
        />

        <Text style={[styles.hint, { bottom: insets.bottom + 28 }]}>
          {zoomed ? "Pinch out or double-tap to reset" : "Pinch or double-tap to zoom · swipe for next"}
        </Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.96)",
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  closeBtn: {
    width: 40,
    alignItems: "flex-start",
  },
  closeCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  headerSub: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 2,
  },
  page: {
    width: SCREEN_W,
    height: SCREEN_H,
    justifyContent: "center",
    alignItems: "center",
  },
  image: {
    width: SCREEN_W,
    height: SCREEN_H * 0.78,
  },
  hint: {
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "600",
  },
});
