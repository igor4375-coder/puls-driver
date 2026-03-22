import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from "react-native";
import * as Notifications from "expo-notifications";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AppNotification {
  id: string;
  title: string;
  body: string;
  type: string;
  receivedAt: Date;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function typeToIcon(type: string): { name: string; color: string } {
  switch (type) {
    case "load_assigned":
      return { name: "truck.box.fill", color: "#2196F3" };
    case "invite":
      return { name: "building.2.fill", color: "#9C27B0" };
    case "gate_pass_expiry":
      return { name: "doc.text.fill", color: "#FF9800" };
    case "storage_expiry":
      return { name: "clock.fill", color: "#FF5722" };
    case "location_request":
      return { name: "location.fill", color: "#4CAF50" };
    default:
      return { name: "bell.fill", color: "#607D8B" };
  }
}

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function NotificationsScreen() {
  const colors = useColors();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadNotifications = useCallback(async () => {
    try {
      const presented = await Notifications.getPresentedNotificationsAsync();
      const mapped: AppNotification[] = presented.map((n) => {
        const data = (n.request.content.data ?? {}) as Record<string, unknown>;
        return {
          id: n.request.identifier,
          title: n.request.content.title ?? "Notification",
          body: n.request.content.body ?? "",
          type: (data.type as string) ?? "general",
          receivedAt: new Date(n.date),
        };
      });
      // Most recent first
      mapped.sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
      setNotifications(mapped);
    } catch {
      // expo-notifications not available (Expo Go) — show empty state gracefully
      setNotifications([]);
    }
  }, []);

  useEffect(() => {
    loadNotifications();

    // Live-update when a new notification arrives while this screen is open
    const sub = Notifications.addNotificationReceivedListener(() => {
      loadNotifications();
    });
    return () => sub.remove();
  }, [loadNotifications]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadNotifications();
    setRefreshing(false);
  }, [loadNotifications]);

  const handleDismissAll = useCallback(async () => {
    await Notifications.dismissAllNotificationsAsync();
    setNotifications([]);
  }, []);

  const handleDismiss = useCallback(async (id: string) => {
    await Notifications.dismissNotificationAsync(id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  return (
    <ScreenContainer containerClassName="bg-background">
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.primary }]}>
        <Text style={styles.headerTitle}>Alerts</Text>
        {notifications.length > 0 && (
          <TouchableOpacity onPress={handleDismissAll} activeOpacity={0.7} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>Clear All</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={5}
        contentContainerStyle={[
          styles.list,
          notifications.length === 0 && styles.listEmpty,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
        renderItem={({ item }) => {
          const icon = typeToIcon(item.type);
          return (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={[styles.iconWrap, { backgroundColor: icon.color + "18" }]}>
                <IconSymbol name={icon.name as any} size={18} color={icon.color} />
              </View>
              <View style={styles.cardContent}>
                <View style={styles.cardTop}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={[styles.cardTime, { color: colors.muted }]}>
                    {formatRelativeTime(item.receivedAt)}
                  </Text>
                </View>
                {item.body ? (
                  <Text style={[styles.cardBody, { color: colors.muted }]} numberOfLines={3}>
                    {item.body}
                  </Text>
                ) : null}
              </View>
              <TouchableOpacity
                style={styles.dismissBtn}
                onPress={() => handleDismiss(item.id)}
                activeOpacity={0.6}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <IconSymbol name="xmark" size={13} color={colors.muted} />
              </TouchableOpacity>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={[styles.emptyIconWrap, { backgroundColor: colors.surface }]}>
              <IconSymbol name="bell.fill" size={36} color={colors.muted} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No Alerts</Text>
            <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
              You'll see load assignments, company invites, and other alerts here.
            </Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
      />
    </ScreenContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  clearBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  list: {
    padding: 16,
    gap: 10,
    paddingBottom: 32,
  },
  listEmpty: {
    flex: 1,
  },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  cardContent: {
    flex: 1,
    gap: 4,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
  },
  cardTime: {
    fontSize: 12,
    flexShrink: 0,
  },
  cardBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  dismissBtn: {
    padding: 2,
    flexShrink: 0,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
});
