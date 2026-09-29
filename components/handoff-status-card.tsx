import { View, Text, StyleSheet } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import type { LoadHandoff } from "@/lib/data";
import { handoffAnonymousExplanation } from "@/lib/handoff";

type Props = {
  handoff: LoadHandoff;
  /** Show the name-free explanation (load detail only). */
  explain?: boolean;
};

export function HandoffStatusCard({ handoff, explain }: Props) {
  const awaiting = handoff.state === "awaiting_handoff";

  if (explain && awaiting) {
    return (
      <View style={[styles.card, styles.cardAwaiting]}>
        <View style={styles.headerRow}>
          <IconSymbol name="exclamationmark.triangle.fill" size={16} color="#E65100" />
          <Text style={[styles.cardLabel, styles.labelAwaiting]}>Awaiting Handoff</Text>
        </View>
        <Text style={styles.cardMessage}>{handoffAnonymousExplanation(handoff)}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.chip, awaiting ? styles.chipAwaiting : styles.chipReady]}>
      <IconSymbol
        name={awaiting ? "exclamationmark.triangle.fill" : "checkmark.circle.fill"}
        size={11}
        color={awaiting ? "#E65100" : "#2E7D32"}
      />
      <Text style={[styles.chipLabel, awaiting ? styles.labelAwaiting : styles.labelReady]} numberOfLines={1}>
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
  chipLabel: {
    fontSize: 12,
    fontWeight: "700",
  },
  card: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1.5,
    marginBottom: 12,
  },
  cardAwaiting: {
    backgroundColor: "#FFF8E1",
    borderColor: "#FFB300",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  cardLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  cardMessage: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: "#5D4037",
  },
  labelAwaiting: { color: "#E65100" },
  labelReady: { color: "#1B5E20" },
});
