/**
 * VehicleDiagramImage
 *
 * Displays the professional vehicle diagram image (top-down + side view combined)
 * as a tappable area for marking damage. The image shows both views in one picture,
 * so no top/side toggle is needed.
 *
 * The image aspect ratio is 3:2 (1536 x 1024).
 */
import React from "react";
import { Image, View, StyleSheet } from "react-native";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const vehicleDiagramSource = require("@/assets/images/vehicle-diagram.png");

const ASPECT_RATIO = 990 / 751; // ~1.318 (cropped image dimensions)

interface VehicleDiagramImageProps {
  /** Width of the diagram container */
  width: number;
}

export function VehicleDiagramImage({ width }: VehicleDiagramImageProps) {
  const height = width / ASPECT_RATIO;

  return (
    <View style={[styles.container, { width, height }]}>
      <Image
        source={vehicleDiagramSource}
        style={{ width, height }}
        resizeMode="contain"
      />
    </View>
  );
}

/** @deprecated Use VehicleDiagramImage instead */
export function VehicleDiagramSvg(_props: {
  view: "top" | "side";
  width: number;
  stroke: string;
  glassFill?: string;
  bodyFill?: string;
}) {
  return <VehicleDiagramImage width={_props.width} />;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#fff",
  },
});
