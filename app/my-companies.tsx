import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  RefreshControl,
  Platform,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/lib/auth-context";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useCallback } from "react";
import { usePermissions } from "@/lib/permissions-context";

export default function MyCompaniesScreen() {
  const colors = useColors();
  const { driver } = useAuth();
  const { exclusive: platformExclusive, refresh: refreshPermissions } = usePermissions();

  const clerkUserId = driver?.id ?? "";
  const driverCode =
    driver?.platformDriverCode ?? driver?.driverCode ?? "";

  const myConnections = useQuery(
    api.companies.getMyCompaniesByClerkUserId,
    clerkUserId ? { clerkUserId } : "skip",
  );
  const isLoading = myConnections === undefined && !!clerkUserId;
  const [isRefetching, setIsRefetching] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void refreshPermissions();
    }, [refreshPermissions]),
  );

  const handleRefresh = useCallback(async () => {
    setIsRefetching(true);
    try {
      await refreshPermissions();
    } finally {
      setTimeout(() => setIsRefetching(false), 400);
    }
  }, [refreshPermissions]);

  const [leavingLinkId, setLeavingLinkId] = useState<string | null>(null);

  const removeCompanyMutation = useMutation(api.companies.removeCompany);
  const leaveCompanyPlatform = useAction(api.platform.leaveCompany);

  const handleLeaveCompany = (
    linkId: string,
    companyName: string,
    companyCode?: string,
    companyOrgId?: string,
  ) => {
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
              if (driverCode && (companyOrgId || companyCode)) {
                try {
                  await leaveCompanyPlatform({
                    driverCode,
                    companyOrgId,
                    companyCode,
                  });
                } catch (platformErr: any) {
                  // If the platform link is already gone, still clear local.
                  console.warn(
                    "[MyCompanies] leaveCompany platform:",
                    platformErr?.message ?? platformErr,
                  );
                }
              }
              await removeCompanyMutation({ linkId: linkId as any });
              await refreshPermissions();
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

      {platformExclusive && connections.length > 0 && (
        <View style={[styles.exclusiveBanner, { backgroundColor: "#E65100" + "18", borderColor: "#E65100" + "40" }]}>
          <Text style={[styles.exclusiveBannerText, { color: "#E65100" }]}>
            Exclusive link active — you can't accept invites from other companies until you leave the exclusive company.
          </Text>
        </View>
      )}

      <FlatList
        data={connections}
        keyExtractor={(item) => item.linkId}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={5}
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
                {item.exclusive && (
                  <View style={[styles.exclusiveBadge, { backgroundColor: "#E65100" }]}>
                    <Text style={styles.exclusiveBadgeText}>Exclusive</Text>
                  </View>
                )}
              </View>
            </View>
            <TouchableOpacity
              style={styles.leaveBtn}
              onPress={() =>
                handleLeaveCompany(
                  item.linkId,
                  item.company?.name ?? "this company",
                  item.company?.companyCode,
                  item.company?.companyOrgId,
                )
              }
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
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
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
    fontSize: 13,
    fontWeight: "700",
  },
  headerSpacer: { width: 36 },
  exclusiveBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  exclusiveBannerText: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    gap: 12,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  emptyState: {
    alignItems: "center",
    gap: 12,
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
    fontSize: 18,
    fontWeight: "700",
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  emptyText: {
    fontSize: 14,
    marginTop: 8,
  },
  backToProfileBtn: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  backToProfileBtnText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15,
  },
  companyCard: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  companyIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  companyInfo: {
    flex: 1,
    gap: 6,
  },
  companyName: {
    fontSize: 16,
    fontWeight: "700",
  },
  companyMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    alignItems: "center",
  },
  companyCodeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  companyCodeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
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
  exclusiveBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  exclusiveBadgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  leaveBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  leaveBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
});
