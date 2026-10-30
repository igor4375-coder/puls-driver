/**
 * Full-screen photo lightbox with pinch / double-tap zoom.
 *
 * Zoom used to feel broken: nothing for a beat, then a sudden jump. Two causes
 * from the Gesture Handler docs / known FlatList+pinch issues:
 *
 * 1. Gesture.Exclusive(doubleTap, pinch) made the pinch wait for the double-tap
 *    recognizer to fail (it holds for a second tap). Race lets whichever
 *    gesture activates first win — pinch activates as soon as the fingers move.
 * 2. The paging FlatList treated a two-finger drag as a scroll and cancelled
 *    the pinch. We freeze paging on pinch begin (not after zoom settles).
 *
 * Scale uses the documented pattern: onStart stash the current scale, onUpdate
 * set scale = saved * event.scale (event.scale starts at 1.0 each gesture).
 * Translation pivots around the pinch focal point so the area under the fingers
 * stays put — same idea as Apple Photos.
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
  title?: string;
};

type ZoomableProps = {
  uri: string;
  onPinchActiveChange: (active: boolean) => void;
  onZoomedChange: (zoomed: boolean) => void;
};

function ZoomableImage({ uri, onPinchActiveChange, onZoomedChange }: ZoomableProps) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTX = useSharedValue(0);
  const savedTY = useSharedValue(0);
  // Focal point at pinch start, relative to the view center.
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);

  const notifyZoomed = useCallback(
    (zoomed: boolean) => {
      onZoomedChange(zoomed);
    },
    [onZoomedChange],
  );

  const notifyPinch = useCallback(
    (active: boolean) => {
      onPinchActiveChange(active);
    },
    [onPinchActiveChange],
  );

  const resetZoom = () => {
    "worklet";
    scale.value = withTiming(1);
    savedScale.value = 1;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedTX.value = 0;
    savedTY.value = 0;
    runOnJS(notifyZoomed)(false);
  };

  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTX.value = 0;
    savedTY.value = 0;
    onZoomedChange(false);
    onPinchActiveChange(false);
  }, [uri]);

  const pinch = Gesture.Pinch()
    // Freeze the pager the instant a pinch is recognized — before scale moves —
    // so the FlatList can't steal the two-finger gesture.
    .onBegin(() => {
      runOnJS(notifyPinch)(true);
    })
    .onStart((e) => {
      savedScale.value = scale.value;
      savedTX.value = translateX.value;
      savedTY.value = translateY.value;
      // Focal is relative to the view; convert to offset from center so scale
      // pivots under the fingers instead of the view's midpoint.
      originX.value = e.focalX - SCREEN_W / 2;
      originY.value = e.focalY - SCREEN_H / 2;
    })
    .onUpdate((e) => {
      // event.scale is 1.0 at gesture start and grows/shrinks with finger distance.
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE * 0.85, savedScale.value * e.scale));
      const ratio = next / savedScale.value;
      scale.value = next;
      // Keep the focal point under the fingers while scaling.
      translateX.value = originX.value + (savedTX.value - originX.value) * ratio;
      translateY.value = originY.value + (savedTY.value - originY.value) * ratio;
    })
    .onEnd(() => {
      runOnJS(notifyPinch)(false);
      if (scale.value < 1.05) {
        resetZoom();
        return;
      }
      if (scale.value > MAX_SCALE) {
        scale.value = withTiming(MAX_SCALE);
        savedScale.value = MAX_SCALE;
      } else {
        savedScale.value = scale.value;
      }
      savedTX.value = translateX.value;
      savedTY.value = translateY.value;
      runOnJS(notifyZoomed)(true);
    })
    .onFinalize((_e, success) => {
      // If the recognizer was cancelled (e.g. by a competing scroll), unfreeze.
      if (!success) {
        runOnJS(notifyPinch)(false);
      }
    });

  // Pan only when already zoomed — otherwise the FlatList owns the swipe.
  const pan = Gesture.Pan()
    .manualActivation(true)
    .onTouchesMove((_e, state) => {
      if (scale.value > 1.05) {
        state.activate();
      } else {
        state.fail();
      }
    })
    .onStart(() => {
      savedTX.value = translateX.value;
      savedTY.value = translateY.value;
    })
    .onUpdate((e) => {
      translateX.value = savedTX.value + e.translationX;
      translateY.value = savedTY.value + e.translationY;
    })
    .onEnd(() => {
      savedTX.value = translateX.value;
      savedTY.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd((e) => {
      if (scale.value > 1.1) {
        resetZoom();
        return;
      }
      const ox = e.x - SCREEN_W / 2;
      const oy = e.y - SCREEN_H / 2;
      const next = DOUBLE_TAP_SCALE;
      // Zoom toward the tap point.
      translateX.value = withTiming(ox * (1 - next));
      translateY.value = withTiming(oy * (1 - next));
      scale.value = withTiming(next);
      savedScale.value = next;
      savedTX.value = ox * (1 - next);
      savedTY.value = oy * (1 - next);
      runOnJS(notifyZoomed)(true);
    });

  // Race — NOT Exclusive. Exclusive made pinch wait for the double-tap
  // recognizer to time out, which felt like "pinch does nothing, then jumps".
  const composed = Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan));

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={[styles.page, animatedStyle]} collapsable={false}>
        <Image
          source={{ uri }}
          style={styles.image}
          contentFit="contain"
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
  const [pinching, setPinching] = useState(false);
  const [listKey, setListKey] = useState(0);

  useEffect(() => {
    if (visible) {
      setIndex(Math.min(Math.max(0, initialIndex), Math.max(0, uris.length - 1)));
      setZoomed(false);
      setPinching(false);
      setListKey((k) => k + 1);
    }
  }, [visible, initialIndex, uris.length]);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    if (next !== index) {
      setIndex(next);
      setZoomed(false);
      setPinching(false);
    }
  };

  if (!uris.length) return null;

  // Freeze paging for the whole pinch, and while zoomed so a one-finger drag
  // pans the image instead of flipping pages.
  const allowPaging = !zoomed && !pinching;

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
        <View style={[styles.header, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
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
          <View style={styles.headerCenter} pointerEvents="none">
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
          scrollEnabled={allowPaging}
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
              <ZoomableImage
                uri={item}
                onPinchActiveChange={setPinching}
                onZoomedChange={setZoomed}
              />
            </View>
          )}
        />

        <Text style={[styles.hint, { bottom: insets.bottom + 28 }]} pointerEvents="none">
          {zoomed || pinching
            ? "Pinch out or double-tap to reset"
            : "Pinch or double-tap to zoom · swipe for next"}
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
