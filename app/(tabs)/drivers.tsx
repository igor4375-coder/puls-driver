import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  TextInput,
  Modal,
  ActivityIndicator,
  FlatList,
  Share,
  Platform,
} from "react-native";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { trpc } from "@/lib/trpc";

type TabType = "fleet" | "invitations";

function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  const colors = useColors();
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.surface }]}>
        <IconSymbol name={icon as any} size={32} color={colors.muted} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.emptySubtitle, { color: colors.muted }]}>{subtitle}</Text>
    </View>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors = useColors();
  const config: Record<string, { bg: string; text: string; label: string }> = {
    active: { bg: colors.success + "18", text: colors.success, label: "Active" },
    inactive: { bg: colors.muted + "18", text: colors.muted, label: "Inactive" },
    suspended: { bg: colors.error + "18", text: colors.error, label: "Suspended" },
    pending: { bg: colors.warning + "18", text: colors.warning, label: "Pending" },
    accepted: { bg: colors.success + "18", text: colors.success, label: "Accepted" },
    expired: { bg: colors.muted + "18", text: colors.muted, label: "Expired" },
    revoked: { bg: colors.error + "18", text: colors.error, label: "Revoked" },
  };
  const c = config[status] ?? config.inactive;
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.text }]}>{c.label}</Text>
    </View>
  );
}

export default function DriversScreen() {
  const colors = useColors();
  const [activeTab, setActiveTab] = useState<TabType>("fleet");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);

  // Fetch fleet drivers
  const { data: drivers, isLoading: driversLoading, refetch: refetchDrivers } = trpc.company.getDrivers.useQuery(undefined, {
    retry: false,
  });

  // Fetch invitations
  const { data: invitations, isLoading: invitationsLoading, refetch: refetchInvitations } = trpc.company.getInvitations.useQuery(undefined, {
    retry: false,
  });

  const generateInviteMutation = trpc.company.generateInvitation.useMutation({
    onSuccess: (data) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setGeneratedCode(data.code);
      refetchInvitations();
    },
    onError: (err) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Error", err.message ?? "Could not generate invitation.");
    },
  });

  const revokeInviteMutation = trpc.company.revokeInvitation.useMutation({
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refetchInvitations();
    },
    onError: (err) => {
      Alert.alert("Error", err.message ?? "Could not revoke invitation.");
    },
  });

  const removeDriverMutation = trpc.company.removeDriver.useMutation({
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refetchDrivers();
    },
    onError: (err) => {
      Alert.alert("Error", err.message ?? "Could not remove driver.");
    },
  });

  const handleGenerateInvite = () => {
    if (!inviteName.trim() && !inviteEmail.trim()) {
      Alert.alert("Add Details", "Please enter at least the driver's name or email.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    generateInviteMutation.mutate({
      driverName: inviteName.trim() || undefined,
      driverEmail: inviteEmail.trim() || undefined,
    });
  };

  const handleCopyCode = async (code: string) => {
    await Clipboard.setStringAsync(code);
    setCodeCopied(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  const handleShareCode = async (code: string, driverName?: string | null) => {
    const name = driverName ? ` for ${driverName}` : "";
    await Share.share({
      message: `You've been invited to join our fleet on AutoHaul Driver${name}.\n\nYour invitation code is: ${code}\n\nDownload AutoHaul Driver and enter this code to get started.`,
      title: "AutoHaul Driver Invitation",
    });
  };

  const handleRevokeInvite = (invitationId: number) => {
    Alert.alert(
      "Revoke Invitation",
      "Are you sure you want to revoke this invitation? The driver will no longer be able to use this code.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: () => revokeInviteMutation.mutate({ invitationId }),
        },
      ]
    );
  };

  const handleRemoveDriver = (driverProfileId: number, driverName: string) => {
    Alert.alert(
      "Remove Driver",
      `Remove ${driverName} from your fleet? They will no longer see their assigned loads.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => removeDriverMutation.mutate({ driverProfileId }),
        },
      ]
    );
  };

  const handleCloseModal = () => {
    setShowInviteModal(false);
    setInviteName("");
    setInviteEmail("");
    setGeneratedCode(null);
    setCodeCopied(false);
  };

  const pendingInvitations = invitations?.filter((i) => i.status === "pending") ?? [];
  const pastInvitations = invitations?.filter((i) => i.status !== "pending") ?? [];

  return (
    <ScreenContainer containerClassName="bg-background">
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.primary }]}>
        <Text style={styles.headerTitle}>Drivers</Text>
        <TouchableOpacity
          style={[styles.inviteBtn, { backgroundColor: "#FFFFFF20" }]}
          onPress={() => setShowInviteModal(true)}
          activeOpacity={0.8}
        >
          <IconSymbol name="plus" size={16} color="#FFFFFF" />
          <Text style={styles.inviteBtnText}>Invite Driver</Text>
        </TouchableOpacity>
      </View>

      {/* Tab Bar */}
      <View style={[styles.tabBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        {(["fleet", "invitations"] as TabType[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && [styles.activeTab, { borderBottomColor: colors.primary }]]}
            onPress={() => setActiveTab(tab)}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, { color: activeTab === tab ? colors.primary : colors.muted }]}>
              {tab === "fleet" ? `Fleet (${drivers?.length ?? 0})` : `Invitations (${pendingInvitations.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Fleet Tab */}
      {activeTab === "fleet" && (
        driversLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : !drivers || drivers.length === 0 ? (
          <EmptyState
            icon="truck.box.fill"
            title="No Drivers Yet"
            subtitle="Invite drivers to join your fleet. They'll appear here once they accept your invitation."
          />
        ) : (
          <FlatList
            data={drivers}
            keyExtractor={(item) => (item?.id ?? Math.random()).toString()}
            contentContainerStyle={{ padding: 16, gap: 10 }}
            renderItem={({ item: rawItem }) => {
              if (!rawItem) return null;
              const item = rawItem;
              const initials = (item.name ?? "D")
                .split(" ")
                .map((n: string) => n[0])
                .join("")
                .toUpperCase()
                .slice(0, 2);
              const joinedDate = item.createdAt
                ? new Date(item.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                : "Unknown";

              return (
                <View style={[styles.driverCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={[styles.driverAvatar, { backgroundColor: colors.primary }]}>
                    <Text style={styles.driverAvatarText}>{initials}</Text>
                  </View>
                  <View style={styles.driverCardInfo}>
                    <View style={styles.driverCardTop}>
                      <Text style={[styles.driverCardName, { color: colors.foreground }]}>{item.name}</Text>
                      <StatusBadge status={item.status} />
                    </View>
                    {item.driverCode && (
                      <Text style={[styles.driverCardDetail, { color: colors.primary, fontWeight: "600" }]}>{item.driverCode}</Text>
                    )}
                    {item.email && (
                      <Text style={[styles.driverCardDetail, { color: colors.muted }]}>{item.email}</Text>
                    )}
                    {item.phone && (
                      <Text style={[styles.driverCardDetail, { color: colors.muted }]}>{item.phone}</Text>
                    )}
                    <Text style={[styles.driverCardJoined, { color: colors.muted }]}>Joined {joinedDate}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.removeBtn}
                    onPress={() => handleRemoveDriver(item.id, item.name ?? "Driver")}
                    activeOpacity={0.7}
                  >
                    <IconSymbol name="xmark" size={16} color={colors.error} />
                  </TouchableOpacity>
                </View>
              );
            }}
          />
        )
      )}

      {/* Invitations Tab */}
      {activeTab === "invitations" && (
        invitationsLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : !invitations || invitations.length === 0 ? (
          <EmptyState
            icon="envelope.fill"
            title="No Invitations Sent"
            subtitle="Tap 'Invite Driver' to generate an invitation code and share it with a driver."
          />
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
            {pendingInvitations.length > 0 && (
              <>
                <Text style={[styles.inviteGroupTitle, { color: colors.muted }]}>PENDING</Text>
                {pendingInvitations.map((inv) => {
                  const expiresDate = new Date(inv.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  return (
                    <View key={inv.id} style={[styles.inviteCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <View style={styles.inviteCardTop}>
                        <View style={styles.inviteCardLeft}>
                          <Text style={[styles.inviteCode, { color: colors.primary }]}>{inv.code}</Text>
                          {inv.driverName && (
                            <Text style={[styles.inviteDriver, { color: colors.foreground }]}>{inv.driverName}</Text>
                          )}
                          {inv.driverEmail && (
                            <Text style={[styles.inviteEmail, { color: colors.muted }]}>{inv.driverEmail}</Text>
                          )}
                          <Text style={[styles.inviteExpiry, { color: colors.muted }]}>Expires {expiresDate}</Text>
                        </View>
                        <StatusBadge status={inv.status} />
                      </View>
                      <View style={[styles.inviteActions, { borderTopColor: colors.border }]}>
                        <TouchableOpacity
                          style={styles.inviteAction}
                          onPress={() => handleCopyCode(inv.code)}
                          activeOpacity={0.7}
                        >
                          <IconSymbol name={codeCopied ? "checkmark" : "square.and.arrow.up"} size={15} color={colors.primary} />
                          <Text style={[styles.inviteActionText, { color: colors.primary }]}>
                            {codeCopied ? "Copied!" : "Copy Code"}
                          </Text>
                        </TouchableOpacity>
                        <View style={[styles.actionDivider, { backgroundColor: colors.border }]} />
                        <TouchableOpacity
                          style={styles.inviteAction}
                          onPress={() => handleShareCode(inv.code, inv.driverName)}
                          activeOpacity={0.7}
                        >
                          <IconSymbol name="square.and.arrow.up" size={15} color={colors.primary} />
                          <Text style={[styles.inviteActionText, { color: colors.primary }]}>Share</Text>
                        </TouchableOpacity>
                        <View style={[styles.actionDivider, { backgroundColor: colors.border }]} />
                        <TouchableOpacity
                          style={styles.inviteAction}
                          onPress={() => handleRevokeInvite(inv.id)}
                          activeOpacity={0.7}
                        >
                          <IconSymbol name="xmark" size={15} color={colors.error} />
                          <Text style={[styles.inviteActionText, { color: colors.error }]}>Revoke</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </>
            )}

            {pastInvitations.length > 0 && (
              <>
                <Text style={[styles.inviteGroupTitle, { color: colors.muted, marginTop: 16 }]}>PAST</Text>
                {pastInvitations.map((inv) => (
                  <View key={inv.id} style={[styles.inviteCard, { backgroundColor: colors.surface, borderColor: colors.border, opacity: 0.7 }]}>
                    <View style={styles.inviteCardTop}>
                      <View style={styles.inviteCardLeft}>
                        <Text style={[styles.inviteCode, { color: colors.muted }]}>{inv.code}</Text>
                        {inv.driverName && (
                          <Text style={[styles.inviteDriver, { color: colors.foreground }]}>{inv.driverName}</Text>
                        )}
                        {inv.driverEmail && (
                          <Text style={[styles.inviteEmail, { color: colors.muted }]}>{inv.driverEmail}</Text>
                        )}
                      </View>
                      <StatusBadge status={inv.status} />
                    </View>
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        )
      )}

      {/* Invite Modal */}
      <Modal
        visible={showInviteModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={handleCloseModal}
      >
        <View style={[styles.modal, { backgroundColor: colors.background }]}>
          {/* Modal Header */}
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              {generatedCode ? "Invitation Created" : "Invite a Driver"}
            </Text>
            <TouchableOpacity onPress={handleCloseModal} activeOpacity={0.7}>
              <IconSymbol name="xmark" size={20} color={colors.muted} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
            {!generatedCode ? (
              <>
                <Text style={[styles.modalSubtitle, { color: colors.muted }]}>
                  Enter the driver's details to generate a unique invitation code. Share the code with the driver so they can join your fleet in the AutoHaul Driver app.
                </Text>

                <View style={styles.formGroup}>
                  <Text style={[styles.formLabel, { color: colors.muted }]}>DRIVER NAME</Text>
                  <TextInput
                    style={[styles.formInput, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]}
                    placeholder="e.g. John Smith"
                    placeholderTextColor={colors.muted}
                    value={inviteName}
                    onChangeText={setInviteName}
                    autoCapitalize="words"
                    returnKeyType="next"
                  />
                </View>

                <View style={styles.formGroup}>
                  <Text style={[styles.formLabel, { color: colors.muted }]}>DRIVER EMAIL (OPTIONAL)</Text>
                  <TextInput
                    style={[styles.formInput, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]}
                    placeholder="driver@email.com"
                    placeholderTextColor={colors.muted}
                    value={inviteEmail}
                    onChangeText={setInviteEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    returnKeyType="done"
                    onSubmitEditing={handleGenerateInvite}
                  />
                </View>

                <TouchableOpacity
                  style={[
                    styles.generateBtn,
                    { backgroundColor: colors.primary },
                    (generateInviteMutation.isPending || (!inviteName.trim() && !inviteEmail.trim())) && { opacity: 0.5 },
                  ]}
                  onPress={handleGenerateInvite}
                  disabled={generateInviteMutation.isPending || (!inviteName.trim() && !inviteEmail.trim())}
                  activeOpacity={0.85}
                >
                  {generateInviteMutation.isPending ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.generateBtnText}>Generate Invitation Code</Text>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                {/* Success State */}
                <View style={[styles.codeCard, { backgroundColor: colors.primary + "0E", borderColor: colors.primary + "30" }]}>
                  <Text style={[styles.codeCardLabel, { color: colors.muted }]}>Invitation Code</Text>
                  <Text style={[styles.codeCardCode, { color: colors.primary }]}>{generatedCode}</Text>
                  <Text style={[styles.codeCardExpiry, { color: colors.muted }]}>Valid for 7 days</Text>
                </View>

                <Text style={[styles.codeInstructions, { color: colors.muted }]}>
                  Share this code with {inviteName || "the driver"}. They will enter it in the AutoHaul Driver app under "Join with Invitation Code" on the login screen.
                </Text>

                <TouchableOpacity
                  style={[styles.generateBtn, { backgroundColor: colors.primary }]}
                  onPress={() => handleCopyCode(generatedCode)}
                  activeOpacity={0.85}
                >
                  <IconSymbol name={codeCopied ? "checkmark" : "square.and.arrow.up"} size={18} color="#FFFFFF" />
                  <Text style={styles.generateBtnText}>{codeCopied ? "Copied to Clipboard!" : "Copy Code"}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.shareBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  onPress={() => handleShareCode(generatedCode, inviteName)}
                  activeOpacity={0.85}
                >
                  <IconSymbol name="square.and.arrow.up" size={18} color={colors.primary} />
                  <Text style={[styles.shareBtnText, { color: colors.primary }]}>Share via SMS / Email</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.doneBtn}
                  onPress={handleCloseModal}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.doneBtnText, { color: colors.muted }]}>Done</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  inviteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  inviteBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
  },
  tab: {
    flex: 1,
    paddingVertical: 13,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  activeTab: {},
  tabText: {
    fontSize: 14,
    fontWeight: "600",
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  // Driver card
  driverCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 2,
  },
  driverAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  driverAvatarText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  driverCardInfo: {
    flex: 1,
    gap: 2,
  },
  driverCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  driverCardName: {
    fontSize: 15,
    fontWeight: "700",
    flex: 1,
  },
  driverCardDetail: {
    fontSize: 13,
  },
  driverCardJoined: {
    fontSize: 12,
    marginTop: 2,
  },
  removeBtn: {
    padding: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  // Invitation cards
  inviteGroupTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  inviteCard: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 2,
    overflow: "hidden",
  },
  inviteCardTop: {
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  inviteCardLeft: {
    flex: 1,
    gap: 2,
  },
  inviteCode: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 3,
  },
  inviteDriver: {
    fontSize: 14,
    fontWeight: "600",
  },
  inviteEmail: {
    fontSize: 13,
  },
  inviteExpiry: {
    fontSize: 12,
    marginTop: 2,
  },
  inviteActions: {
    flexDirection: "row",
    borderTopWidth: 1,
  },
  inviteAction: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 10,
  },
  inviteActionText: {
    fontSize: 13,
    fontWeight: "600",
  },
  actionDivider: {
    width: 1,
    alignSelf: "stretch",
  },
  // Modal
  modal: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 18,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  modalSubtitle: {
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 28,
  },
  formGroup: {
    marginBottom: 20,
  },
  formLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  formInput: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  generateBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
    marginBottom: 12,
  },
  generateBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  codeCard: {
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 28,
    alignItems: "center",
    marginBottom: 20,
  },
  codeCardLabel: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  codeCardCode: {
    fontSize: 36,
    fontWeight: "900",
    letterSpacing: 6,
    marginBottom: 8,
  },
  codeCardExpiry: {
    fontSize: 13,
  },
  codeInstructions: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginBottom: 24,
  },
  shareBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    borderWidth: 1.5,
    marginBottom: 12,
  },
  shareBtnText: {
    fontSize: 16,
    fontWeight: "600",
  },
  doneBtn: {
    alignItems: "center",
    paddingVertical: 14,
  },
  doneBtnText: {
    fontSize: 15,
    fontWeight: "500",
  },
});
