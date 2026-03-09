import { View, Text, FlatList, StyleSheet } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";

const MOCK_NOTIFICATIONS = [
  {
    id: "n1",
    type: "new_load",
    title: "New Load Assigned",
    message: "Load #FLT-2024-001: Kansas City, MO → Beverly Hills, CA",
    time: "2 hours ago",
    read: false,
  },
  {
    id: "n2",
    type: "new_load",
    title: "New Load Assigned",
    message: "Load #FLT-2024-002: Dallas, TX → Miami, FL",
    time: "4 hours ago",
    read: false,
  },
  {
    id: "n3",
    type: "status",
    title: "Load Reminder",
    message: "Pickup for Load #FLT-2024-001 is scheduled for tomorrow.",
    time: "1 day ago",
    read: true,
  },
];

export default function NotificationsScreen() {
  const colors = useColors();

  return (
    <ScreenContainer containerClassName="bg-background">
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.primary }]}>
        <Text style={styles.headerTitle}>Notifications</Text>
      </View>

      <FlatList
        data={MOCK_NOTIFICATIONS}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={[
            styles.notifCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
            !item.read && { borderLeftColor: colors.primary, borderLeftWidth: 3 }
          ]}>
            <View style={styles.notifHeader}>
              <View style={[
                styles.notifDot,
                { backgroundColor: item.read ? colors.muted : colors.primary }
              ]} />
              <Text style={[styles.notifTitle, { color: colors.foreground }]}>{item.title}</Text>
              <Text style={[styles.notifTime, { color: colors.muted }]}>{item.time}</Text>
            </View>
            <Text style={[styles.notifMessage, { color: colors.muted }]}>{item.message}</Text>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🔔</Text>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No Notifications</Text>
            <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
              You'll be notified when new loads are assigned to you.
            </Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  list: {
    padding: 16,
    gap: 10,
    paddingBottom: 32,
  },
  notifCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  notifHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  notifDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  notifTitle: {
    fontSize: 14,
    fontWeight: "700",
    flex: 1,
  },
  notifTime: {
    fontSize: 12,
  },
  notifMessage: {
    fontSize: 13,
    lineHeight: 18,
    paddingLeft: 16,
  },
  emptyState: {
    alignItems: "center",
    paddingTop: 80,
    paddingHorizontal: 32,
  },
  emptyEmoji: {
    fontSize: 56,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
});
