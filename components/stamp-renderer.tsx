/**
 * stamp-renderer.tsx
 *
 * An offscreen component that renders a photo with a tamper-evident evidence
 * stamp burned in at the bottom. Call `captureAsync()` to get the stamped URI.
 *
 * Usage:
 *   const stampRef = useRef<StampRendererRef>(null);
 *   await stampRef.current?.captureAsync(uri, stampOptions);
 *
 * The component renders at 0 opacity, off-screen, so it never flashes on screen.
 */

import React, { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { View, Text, Image, StyleSheet, Dimensions } from "react-native";
import ViewShot from "react-native-view-shot";
import type { StampOptions } from "@/lib/photo-stamp";
import { buildStampLines } from "@/lib/photo-stamp";

const { width: SW } = Dimensions.get("window");

// Render at full camera resolution (3024×4032 on modern iPhones, 4000×3000 on Android).
// Using screen width would downscale the photo to ~390px wide — that's the main quality loss.
// We render at 3024 wide (12MP equivalent) so the stamp output matches the original photo.
const RENDER_W = 3024;
const RENDER_H = 4032; // 4:3 aspect ratio at full resolution

export interface StampRendererRef {
  captureAsync: (uri: string, opts: StampOptions) => Promise<string>;
}

export const StampRenderer = forwardRef<StampRendererRef>((_, ref) => {
  const shotRef = useRef<ViewShot>(null);
  const [currentUri, setCurrentUri] = useState<string | null>(null);
  const [currentOpts, setCurrentOpts] = useState<StampOptions>({});
  const resolveRef = useRef<((uri: string) => void) | null>(null);

  useImperativeHandle(ref, () => ({
    captureAsync: (uri: string, opts: StampOptions): Promise<string> => {
      return new Promise((resolve) => {
        resolveRef.current = resolve;
        setCurrentUri(uri);
        setCurrentOpts(opts);
        // Allow one render cycle, then capture
        setTimeout(async () => {
          try {
            const capturedUri = await (shotRef.current as any)?.capture?.();
            resolve(capturedUri ?? uri);
          } catch {
            resolve(uri); // fallback to original on error
          } finally {
            resolveRef.current = null;
          }
        }, 100);
      });
    },
  }));

  if (!currentUri) return null;

  const lines = buildStampLines(currentOpts);

  return (
    <View
      style={styles.offscreen}
      pointerEvents="none"
    >
      <ViewShot
        ref={shotRef}
        options={{ format: "jpg", quality: 1 }}  // No compression — preserve full photo quality
        style={{ width: RENDER_W, height: RENDER_H }}
      >
        {/* Photo */}
        <Image
          source={{ uri: currentUri }}
          style={{ width: RENDER_W, height: RENDER_H }}
          resizeMode="cover"
        />

        {/* Branding watermark — bottom-right, above stamp banner */}
        <View style={styles.brandingWrap}>
          <Text style={styles.brandingText}>PULS DISPATCH</Text>
        </View>

        {/* Evidence stamp banner */}
        <View style={styles.stampBanner}>
          {/* Left accent bar */}
          <View style={styles.accentBar} />
          <View style={styles.stampContent}>
            {lines.map((line, i) => (
              <Text
                key={i}
                style={[styles.stampLine, i === 0 && styles.stampLineFirst]}
                numberOfLines={1}
              >
                {line}
              </Text>
            ))}
          </View>
        </View>
      </ViewShot>
    </View>
  );
});

StampRenderer.displayName = "StampRenderer";

const styles = StyleSheet.create({
  offscreen: {
    position: "absolute",
    left: -9999,
    top: -9999,
    opacity: 0,
    pointerEvents: "none",
  },
  brandingWrap: {
    position: "absolute",
    bottom: 340,
    right: 60,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    paddingHorizontal: 48,
    paddingVertical: 20,
    borderRadius: 16,
  },
  brandingText: {
    color: "rgba(255, 255, 255, 0.92)",
    fontSize: 72,
    fontWeight: "800",
    letterSpacing: 6,
  },
  stampBanner: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0, 0, 0, 0.82)",
    flexDirection: "row",
    alignItems: "stretch",
    paddingVertical: 80,
    paddingRight: 110,
  },
  accentBar: {
    width: 32,
    backgroundColor: "#2563EB",
    marginRight: 80,
    borderRadius: 16,
  },
  stampContent: {
    flex: 1,
    gap: 16,
  },
  stampLine: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 86,  // ~11px × 7.8 scale factor
    fontFamily: "monospace",
    letterSpacing: 2,
    lineHeight: 125,
  },
  stampLineFirst: {
    color: "#FFFFFF",
    fontSize: 94,  // ~12px × 7.8 scale factor
    fontWeight: "700",
  },
});
