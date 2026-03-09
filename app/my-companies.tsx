import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  RefreshControl,
} from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/lib/auth-context";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useCallback } from "react";
import { Platform } from "react-native";

export default function MyCompaniesScreen() {
  const colors = useColors();
  const { driver } = useAuth();

  const clerkUserId = driver?.id ?? "";

  const myConnections = useQuery(
    api.companies.getMyCompaniesByClerkUserId,
    clerkUserId ? { clerkUserId } : "skip",
  );
  const isLoading = myConnections === undefined && !!clerkUserId;
  const [isRefetching, setIsRefetching] = useState(false);

  const handleRefresh = useCallback(() => {
    setIsRefetching(true);
    setTimeout(() => setIsRefetching(false), 1000);
  }, []);

  const [leavingLinkId, setLeavingLinkId] = useState<string | null>(null);

  const removeCompanyMutation = useMutation(api.companies.removeCompany);

  const handleLeaveCompany = (linkId: string, companyName: string) => {
    Alert.alert(
      `Leave ${companyName}?`,
      `You will be disconnected from ${companyName} and will no longer receive load assignments from them.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: async () => {
            setLeavingLinkId(linkId);
            try {
              await removeCompanyMutation({ linkId: linkId as any });
              if (Platform.OS !== "web") {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
            } catch (err: any) {
              Alert.alert("Error", err.message ?? "Could not leave company. Please try again.");
            } finally {
              setLeavingLinkId(null);
            }
          },
        },
      ]
    );
  };

  const connections = myConnections ?? [];

  return (
    <ScreenContainer containerClassName="bg-background">
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.primary }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <IconSymbol name="chevron.left" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Companies</Text>
        {!isLoading && connections.length > 0 && (
          <View style={[styles.headerBadge, { backgroundColor: "rgba(255,255,255,0.25)" }]}>
            <Text style={styles.headerBadgeText}>{connections.length}</Text>
          </View>
        )}
        {(isLoading || connections.length === 0) && <View style={styles.headerSpacer} />}
      </View>

      <FlatList
        data={connections}
        keyExtractor={(item) => item.linkId}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={connections.length === 0 ? styles.emptyContainer : styles.listContent}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.emptyText, { color: colors.muted }]}>Loading companies…</Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.surface }]}>
                <IconSymbol name="building.2.fill" size={40} color={colors.muted} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No Companies Yet</Text>
              <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
                Share your Driver ID with a dispatcher to receive an invite. Once you accept, the company will appear here.
              </Text>
              <TouchableOpacity
                style={[styles.backToProfileBtn, { backgroundColor: colors.primary }]}
                onPress={() => router.back()}
                activeOpacity={0.8}
              >
                <Text style={styles.backToProfileBtnText}>Back to Profile</Text>
              </TouchableOpacity>
            </View>
          )
        }
        renderItem={({ item, index }) => (
          <View
            style={[
              styles.companyCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                marginTop: index === 0 ? 16 : 0,
              },
            ]}
          >
            <View style={[styles.companyIconWrap, { backgroundColor: colors.primary + "18" }]}>
              <IconSymbol name="building.2.fill" size={24} color={colors.primary} />
            </View>
            <View style={styles.companyInfo}>
              <Text style={[styles.companyName, { color: colors.foreground }]}>
                {item.company?.name ?? "Unknown Company"}
              </Text>
              <View style={styles.companyMeta}>
                {item.company?.companyCode ? (
                  <View style={[styles.companyCodeBadge, { backgroundColor: colors.primary + "15" }]}>
                    <Text style={[styles.companyCodeText, { color: colors.primary }]}>
                      {item.company.companyCode}
                    </Text>
                  </View>
                ) : null}
                <View style={[styles.statusBadge, { backgroundColor: colors.success + "20" }]}>
                  <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
                  <Text style={[styles.statusText, { color: colors.success }]}>Active</Text>
                </View>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.leaveBtn, { borderColor: colors.error + "50" }]}
              onPress={() => handleLeaveCompany(item.linkId, item.company?.name ?? "this company")}
              activeOpacity={0.7}
              disabled={leavingLinkId === item.linkId}
            >
              {leavingLinkId === item.linkId ? (
                <ActivityIndicator size="small" color={colors.error} />
              ) : (
                <Text style={[styles.leaveBtnText, { color: colors.error }]}>Leave</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.border }} />}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  headerBadge: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  headerBadgeText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  headerSpacer: {
    width: 28,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  emptyContainer: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingTop: 80,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    marginTop: 8,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
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
  backToProfileBtn: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  backToProfileBtnText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 15,
  },
  companyCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 0,
    gap: 12,
  },
  companyIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  companyInfo: {
    flex: 1,
    gap: 6,
  },
  companyName: {
    fontSize: 16,
    fontWeight: "600",
  },
  companyMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  companyCodeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  companyCodeText: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
  },
  leaveBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 60,
    alignItems: "center",
  },
  leaveBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
