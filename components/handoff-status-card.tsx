import { View, Text, StyleSheet } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import type { LoadHandoff } from "@/lib/data";

type Props = {
  handoff: LoadHandoff;
};

/** Compact caution / ready chip. No explanation copy. */
export function HandoffStatusCard({ handoff }: Props) {
  const awaiting = handoff.state === "awaiting_handoff";

  return (
    <View style={[styles.chip, awaiting ? styles.chipAwaiting : styles.chipReady]}>
      <IconSymbol
        name={awaiting ? "exclamationmark.triangle.fill" : "checkmark.circle.fill"}
        size={11}
        color={awaiting ? "#E65100" : "#2E7D32"}
      />
      <Text style={[styles.label, awaiting ? styles.labelAwaiting : styles.labelReady]} numberOfLines={1}>
        {awaiting ? "Awaiting Handoff" : "Ready for Pickup"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginBottom: 6,
  },
  chipAwaiting: {
    backgroundColor: "#FFF8E1",
  },
  chipReady: {
    backgroundColor: "#E8F5E9",
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
  },
  labelAwaiting: { color: "#E65100" },
  labelReady: { color: "#1B5E20" },
});
