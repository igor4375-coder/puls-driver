import { View, Text, StyleSheet } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import type { LoadHandoff } from "@/lib/data";

type Props = {
  handoff: LoadHandoff;
  compact?: boolean;
};

/**
 * Read-only yard-readiness card. Uses platform `label` + `message` as-is.
 */
export function HandoffStatusCard({ handoff, compact }: Props) {
  const awaiting = handoff.state === "awaiting_handoff";

  return (
    <View
      style={[
        styles.card,
        awaiting ? styles.cardAwaiting : styles.cardReady,
        compact && styles.cardCompact,
      ]}
    >
      <View style={styles.headerRow}>
        <IconSymbol
          name={awaiting ? "exclamationmark.triangle.fill" : "checkmark.circle.fill"}
          size={compact ? 15 : 16}
          color={awaiting ? "#E65100" : "#2E7D32"}
        />
        <Text style={[styles.label, awaiting ? styles.labelAwaiting : styles.labelReady]} numberOfLines={1}>
          {handoff.label}
        </Text>
      </View>
      {handoff.message ? (
        <Text
          style={[styles.message, awaiting ? styles.messageAwaiting : styles.messageReady]}
          numberOfLines={compact ? 2 : 6}
        >
          {handoff.message}
        </Text>
      ) : null}
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
    marginBottom: 8,
    borderRadius: 10,
  },
  cardAwaiting: {
    backgroundColor: "#FFF8E1",
    borderColor: "#FFB300",
  },
  cardReady: {
    backgroundColor: "#E8F5E9",
    borderColor: "#A5D6A7",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  label: {
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  labelAwaiting: { color: "#E65100" },
  labelReady: { color: "#1B5E20" },
  message: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  messageAwaiting: { color: "#5D4037" },
  messageReady: { color: "#33691E" },
});
