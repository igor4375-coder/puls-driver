import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert, ActivityIndicator, Share, Platform, Switch, Modal, FlatList, PanResponder } from "react-native";
import Svg, { Path } from "react-native-svg";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/lib/auth-context";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { registerForPushNotificationsAsync } from "@/lib/push-notifications";
import { useEffect, useRef, useState, useCallback } from "react";
import { useSettings } from "@/lib/settings-context";
import { useLoads } from "@/lib/loads-context";

// ─── Equipment type helpers ────────────────────────────────────────────────────
const EQUIPMENT_TYPES = [
  { value: "tow_truck", label: "Tow Truck" },
  { value: "flatbed", label: "Flatbed" },
  { value: "stinger", label: "Stinger" },
  { value: "seven_car_carrier", label: "7-Car Carrier" },
] as const;
type EquipmentTypeValue = typeof EQUIPMENT_TYPES[number]["value"];

function equipmentLabel(val: string | null | undefined): string {
  if (!val) return "—";
  return EQUIPMENT_TYPES.find((t) => t.value === val)?.label ?? val;
}

// ─── SettingRow ────────────────────────────────────────────────────────────────
function SettingRow({
  icon,
  label,
  value,
  onPress,
  danger,
  loading,
  rightElement,
}: {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  loading?: boolean;
  rightElement?: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={[styles.settingRow, { borderBottomColor: colors.border }]}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <View style={[styles.settingIcon, { backgroundColor: danger ? colors.error + "18" : colors.primary + "18" }]}>
        <IconSymbol name={icon as any} size={18} color={danger ? colors.error : colors.primary} />
      </View>
      <Text style={[styles.settingLabel, { color: danger ? colors.error : colors.foreground }]}>{label}</Text>
      {rightElement ?? (
        <>
          {value && <Text style={[styles.settingValue, { color: colors.muted }]}>{value}</Text>}
          {loading && <ActivityIndicator size="small" color={colors.muted} />}
          {onPress && !danger && !loading && (
            <IconSymbol name="chevron.right" size={16} color={colors.muted} />
          )}
        </>
      )}
    </TouchableOpacity>
  );
}

// ─── CapacityPicker ────────────────────────────────────────────────────────────
function CapacityPicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number) => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.capacityRow}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <TouchableOpacity
          key={n}
          style={[
            styles.capacityChip,
            {
              backgroundColor: value === n ? colors.primary : colors.surface,
              borderColor: value === n ? colors.primary : colors.border,
            },
          ]}
          onPress={() => onChange(n)}
          activeOpacity={0.7}
        >
          <Text style={[styles.capacityChipText, { color: value === n ? "#FFFFFF" : colors.foreground }]}>
            {n}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const colors = useColors();
  const { driver, logout } = useAuth();
  const [codeCopied, setCodeCopied] = useState(false);
  const [respondingId, setRespondingId] = useState<number | string | null>(null);
  const [showEquipmentPicker, setShowEquipmentPicker] = useState(false);
  const { settings, setRouteDisplayMode, setMapsApp, setDriverSignaturePaths } = useSettings();
  const { loads, archiveAllDelivered, clearNonPlatformLoads } = useLoads();

  // Count non-platform loads (test/manual/demo loads that can be cleared)
  const nonPlatformLoadCount = loads.filter((l) => !l.id.startsWith("platform-")).length;

  const handleClearTestData = () => {
    if (nonPlatformLoadCount === 0) {
      Alert.alert("No Test Data", "There are no demo or manually added loads to remove.");
      return;
    }
    Alert.alert(
      "Clear Test Data?",
      `This will permanently remove ${nonPlatformLoadCount} demo/manual load${nonPlatformLoadCount === 1 ? "" : "s"} from your list. Platform-assigned loads will not be affected.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            clearNonPlatformLoads();
            if (Platform.OS !== "web") {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
          },
        },
      ]
    );
  };

  const deliveredCount = loads.filter((l) => l.status === "delivered").length;

  const handleArchiveAllDelivered = () => {
    if (deliveredCount === 0) {
      Alert.alert("Nothing to Archive", "You have no delivered loads to archive.");
      return;
    }
    Alert.alert(
      "Move All Delivered to Archive?",
      `This will move all ${deliveredCount} delivered load${deliveredCount === 1 ? "" : "s"} to the Archived tab. They will not be deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Move to Archive",
          onPress: () => {
            archiveAllDelivered();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert(
              "Done",
              `${deliveredCount} load${deliveredCount === 1 ? "" : "s"} moved to the Archived tab.`
            );
          },
        },
      ]
    );
  };
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [sigPaths, setSigPaths] = useState<{ d: string }[]>([]);
  const [sigSaved, setSigSaved] = useState(false);

  // ── Convex profile data ───────────────────────────────────────────────────
  const clerkUserId = driver?.id ?? "";
  const convexProfile = useQuery(
    api.driverProfiles.getByClerkUserId,
    clerkUserId ? { clerkUserId } : "skip",
  );
  const profileLoading = convexProfile === undefined && !!clerkUserId;
  const updateProfileMutation = useMutation(api.driverProfiles.updateProfile);

  const driverCode = convexProfile?.driverCode ?? driver?.driverCode ?? null;
  const isValidLocalCode = /^D-\d{5}$/.test(driverCode ?? "");

  const platformDriverCode = convexProfile?.platformDriverCode ?? null;
  const inviteCode = platformDriverCode ?? driverCode;
  const isValidCode = /^D-\d{5}$/.test(inviteCode ?? "");

  // Register push token once profile is loaded
  const tokenRegistered = useRef(false);
  useEffect(() => {
    if (!convexProfile || tokenRegistered.current || !clerkUserId) return;
    tokenRegistered.current = true;
    registerForPushNotificationsAsync().then((token) => {
      if (token) updateProfileMutation({ clerkUserId, pushToken: token });
    }).catch(() => {});
  }, [convexProfile, clerkUserId]);

  // ── Equipment & notification state (from Convex profile) ──────────────────
  const [equipmentType, setEquipmentType] = useState<EquipmentTypeValue | null>(null);
  const [equipmentCapacity, setEquipmentCapacity] = useState<number | null>(null);
  const [notifyNewLoad, setNotifyNewLoad] = useState(true);
  const [notifyNewInvite, setNotifyNewInvite] = useState(true);
  const [notifyGatePassExpiry, setNotifyGatePassExpiry] = useState(true);
  const [notifyStorageExpiry, setNotifyStorageExpiry] = useState(true);

  useEffect(() => {
    if (!convexProfile) return;
    if (convexProfile.equipmentType) setEquipmentType(convexProfile.equipmentType as EquipmentTypeValue);
    if (convexProfile.equipmentCapacity) setEquipmentCapacity(convexProfile.equipmentCapacity);
    setNotifyNewLoad(convexProfile.notifyNewLoad ?? true);
    setNotifyNewInvite(convexProfile.notifyNewInvite ?? true);
    setNotifyGatePassExpiry(convexProfile.notifyGatePassExpiry ?? true);
    setNotifyStorageExpiry(convexProfile.notifyStorageExpiry ?? true);
  }, [convexProfile]);

  // ── Helper: save a field via Convex ────────────────────────────────────────
  function saveField(fields: {
    truckNumber?: string;
    trailerNumber?: string;
    equipmentType?: EquipmentTypeValue | null;
    equipmentCapacity?: number | null;
    notifyNewLoad?: boolean;
    notifyNewInvite?: boolean;
    notifyGatePassExpiry?: boolean;
    notifyStorageExpiry?: boolean;
  }) {
    if (!clerkUserId) return;
    const mapped: Record<string, unknown> = { clerkUserId };
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined && v !== null) mapped[k] = v;
    }
    updateProfileMutation(mapped as any);
  }

  // ── Pending invites from company platform (via Convex action) ──────────────
  const getPendingInvitesAction = useAction(api.platform.getPendingInvites);
  const [pendingInvites, setPendingInvites] = useState<any[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);

  const fetchInvites = useCallback(async () => {
    if (!isValidCode || !inviteCode) return;
    setInvitesLoading(true);
    try {
      const result = await getPendingInvitesAction({ driverCode: inviteCode });
      setPendingInvites(Array.isArray(result) ? result : []);
    } catch (err) {
      console.warn("[Profile] Failed to fetch invites:", err);
      setPendingInvites([]);
    } finally {
      setInvitesLoading(false);
    }
  }, [isValidCode, inviteCode, getPendingInvitesAction]);

  useEffect(() => {
    fetchInvites();
    const interval = setInterval(fetchInvites, 15_000);
    return () => clearInterval(interval);
  }, [fetchInvites]);

  // ── My Companies (from Convex, reactive) ───────────────────────────────────
  const myConnections = useQuery(
    api.companies.getMyCompaniesByClerkUserId,
    clerkUserId ? { clerkUserId } : "skip",
  );
  const connectionsLoading = myConnections === undefined && !!clerkUserId;

  // ── Respond to invite ──────────────────────────────────────────────────────
  const respondToInvitePlatform = useAction(api.platform.respondToInvite);
  const acceptInviteLocally = useMutation(api.companies.acceptInviteLocally);

  const handleRespond = (inviteId: number | string, accept: boolean, companyName: string, companyCode?: string) => {
    if (!inviteCode || !clerkUserId) return;
    Alert.alert(
      accept ? `Join ${companyName}?` : `Decline ${companyName}?`,
      accept
        ? `You will be added as an Active Driver for ${companyName} and can receive load assignments from them.`
        : `You will decline the invitation from ${companyName}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: accept ? "Accept" : "Decline",
          style: accept ? "default" : "destructive",
          onPress: async () => {
            setRespondingId(inviteId);
            try {
              await respondToInvitePlatform({
                inviteId,
                accept,
                driverCode: inviteCode,
              });

              if (accept && companyName) {
                try {
                  await acceptInviteLocally({
                    clerkUserId,
                    companyCode: companyCode || "UNKNOWN",
                    companyName,
                  });
                } catch (linkErr) {
                  console.warn("[Profile] Failed to create local company link:", linkErr);
                }
              }

              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              fetchInvites();
              Alert.alert(
                accept ? "Invite Accepted!" : "Invite Declined",
                accept
                  ? "You are now connected to this company. Pull to refresh on the Loads tab to see your assigned loads."
                  : "You have declined this invitation."
              );
            } catch (err: any) {
              Alert.alert("Error", err.message ?? "Could not respond to invite. Please try again.");
            } finally {
              setRespondingId(null);
            }
          },
        },
      ]
    );
  };

  const handleLogout = () => {
    Alert.alert(
      "Sign Out",
      "Are you sure you want to sign out?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign Out",
          style: "destructive",
          onPress: async () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            await logout();
            router.replace("/(auth)/welcome" as any);
          },
        },
      ]
    );
  };

  const handleCopyCode = async (code: string) => {
    await Clipboard.setStringAsync(code);
    setCodeCopied(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  const displayName = convexProfile?.name ?? driver?.name ?? "Driver";
  const displayEmail = convexProfile?.email ?? driver?.email ?? "";
  const initials = displayName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const inviteCount = pendingInvites?.length ?? 0;

  const truckNumber = convexProfile?.truckNumber ?? driver?.truckNumber ?? null;
  const trailerNumber = convexProfile?.trailerNumber ?? driver?.trailerNumber ?? null;

  return (
    <ScreenContainer containerClassName="bg-background">
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.primary }]}>
        <Text style={styles.headerTitle}>Profile</Text>
        {inviteCount > 0 && (
          <View style={[styles.headerBadge, { backgroundColor: colors.warning }]}>
            <Text style={styles.headerBadgeText}>{inviteCount}</Text>
          </View>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* ── DRIVER ID CARD ── */}
        <View style={[styles.driverIdCard, { backgroundColor: colors.primary }]}>
          <Text style={[styles.driverIdLabel, { color: "rgba(255,255,255,0.75)" }]}>
            DISPATCHER INVITE CODE
          </Text>
          <View style={styles.driverIdRow}>
            {profileLoading && !inviteCode ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={[styles.driverIdCode, { color: "#FFFFFF" }]} numberOfLines={1} adjustsFontSizeToFit>
                {inviteCode ?? "—"}
              </Text>
            )}
            {inviteCode && (
              <View style={styles.driverIdBtns}>
                <TouchableOpacity
                  style={[styles.driverIdBtn, { backgroundColor: "rgba(255,255,255,0.2)" }]}
                  onPress={() => handleCopyCode(inviteCode)}
                  activeOpacity={0.7}
                >
                  <IconSymbol name={codeCopied ? "checkmark" : "doc.on.doc"} size={16} color="#FFFFFF" />
                  <Text style={styles.driverIdBtnText}>{codeCopied ? "Copied!" : "Copy"}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.driverIdBtn, { backgroundColor: "rgba(255,255,255,0.2)" }]}
                  onPress={async () => {
                    if (Platform.OS !== "web") await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    Share.share({
                      message: `My AutoHaul Driver ID is ${inviteCode} — enter it on the platform to invite me.`,
                      title: "My Driver ID",
                    });
                  }}
                  activeOpacity={0.7}
                >
                  <IconSymbol name="square.and.arrow.up" size={16} color="#FFFFFF" />
                  <Text style={styles.driverIdBtnText}>Share</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
          <Text style={[styles.driverIdHint, { color: "rgba(255,255,255,0.6)" }]}>
            Share this code with dispatchers to receive load assignments
          </Text>
        </View>

        {/* Avatar Card */}
        <TouchableOpacity
          style={[styles.avatarCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          activeOpacity={0.7}
          onPress={() => {
            Alert.prompt(
              "Display Name",
              "This name will be shown to companies you connect with.",
              (val) => {
                if (val !== undefined && val.trim().length > 0 && clerkUserId) {
                  updateProfileMutation({ clerkUserId, name: val.trim() });
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
              },
              "plain-text",
              displayName
            );
          }}
        >
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.driverInfo}>
            <Text style={[styles.driverName, { color: colors.foreground }]}>{displayName}</Text>
            {displayEmail ? <Text style={[styles.driverEmail, { color: colors.muted }]}>{displayEmail}</Text> : null}
            <Text style={[styles.driverEmail, { color: colors.muted, fontSize: 11, marginTop: 2 }]}>Tap to edit name</Text>
          </View>
          <IconSymbol name="pencil" size={16} color={colors.muted} />
        </TouchableOpacity>

        {/* ── PENDING INVITES SECTION ── */}
        {isValidCode && (invitesLoading || inviteCount > 0) && (
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.warning + "60" }]}>
            <View style={styles.sectionTitleRow}>
              <Text style={[styles.sectionTitle, { color: colors.warning }]}>PENDING INVITATIONS</Text>
              {inviteCount > 0 && (
                <View style={[styles.inviteBadge, { backgroundColor: colors.warning }]}>
                  <Text style={styles.inviteBadgeText}>{inviteCount}</Text>
                </View>
              )}
            </View>
            {invitesLoading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={colors.warning} />
                <Text style={[styles.loadingText, { color: colors.muted }]}>Checking for invitations…</Text>
              </View>
            ) : (
              pendingInvites.map((invite: any, index: number) => (
                <View
                  key={String(invite.inviteId)}
                  style={[styles.inviteRow, { borderTopColor: colors.border }, index > 0 && { borderTopWidth: 0.5 }]}
                >
                  <View style={styles.inviteRowTop}>
                    <View style={[styles.inviteIcon, { backgroundColor: colors.warning + "18" }]}>
                      <IconSymbol name="envelope.fill" size={18} color={colors.warning} />
                    </View>
                    <View style={styles.inviteInfo}>
                      <Text style={[styles.inviteCompanyName, { color: colors.foreground }]}>{invite.companyName}</Text>
                      <Text style={[styles.inviteCompanyCode, { color: colors.muted }]}>{invite.companyCode}</Text>
                    </View>
                  </View>
                  {invite.message ? (
                    <Text style={[styles.inviteMessage, { color: colors.muted }]}>"{invite.message}"</Text>
                  ) : null}
                  <View style={styles.inviteActions}>
                    <TouchableOpacity
                      style={[styles.declineBtn, { borderColor: colors.error + "60" }]}
                      onPress={() => handleRespond(invite.inviteId, false, invite.companyName, invite.companyCode)}
                      activeOpacity={0.7}
                      disabled={respondingId === invite.inviteId}
                    >
                      {respondingId === invite.inviteId ? (
                        <ActivityIndicator size="small" color={colors.error} />
                      ) : (
                        <Text style={[styles.declineBtnText, { color: colors.error }]}>Decline</Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.acceptBtn, { backgroundColor: colors.success }]}
                      onPress={() => handleRespond(invite.inviteId, true, invite.companyName, invite.companyCode)}
                      activeOpacity={0.8}
                      disabled={respondingId === invite.inviteId}
                    >
                      {respondingId === invite.inviteId ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.acceptBtnText}>Accept</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {/* ── MY COMPANIES ROW ── */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.settingRow, { borderBottomColor: "transparent" }]}
            onPress={() => router.push("/my-companies" as any)}
            activeOpacity={0.7}
          >
            <View style={[styles.settingIcon, { backgroundColor: colors.primary + "18" }]}>
              <IconSymbol name="building.2.fill" size={18} color={colors.primary} />
            </View>
            <Text style={[styles.settingLabel, { color: colors.foreground }]}>My Companies</Text>
            <View style={styles.companiesRowRight}>
              {connectionsLoading ? (
                <ActivityIndicator size="small" color={colors.muted} />
              ) : myConnections && myConnections.length > 0 ? (
                <View style={[styles.inviteBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.inviteBadgeText}>{myConnections.length}</Text>
                </View>
              ) : (
                <Text style={[styles.settingValue, { color: colors.muted }]}>None</Text>
              )}
              <IconSymbol name="chevron.right" size={16} color={colors.muted} />
            </View>
          </TouchableOpacity>
        </View>

        {/* ── EQUIPMENT SECTION ── */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>EQUIPMENT</Text>
          </View>
          <SettingRow
            icon="truck.box.fill"
            label="Truck Number"
            value={truckNumber ?? "—"}
            onPress={() => {
              Alert.prompt(
                "Truck Number",
                "Enter your truck number",
                (val) => { if (val !== undefined) saveField({ truckNumber: val }); },
                "plain-text",
                truckNumber ?? ""
              );
            }}
          />
          <SettingRow
            icon="car.fill"
            label="Trailer Number"
            value={trailerNumber ?? "—"}
            onPress={() => {
              Alert.prompt(
                "Trailer Number",
                "Enter your trailer number",
                (val) => { if (val !== undefined) saveField({ trailerNumber: val }); },
                "plain-text",
                trailerNumber ?? ""
              );
            }}
          />
          <SettingRow
            icon="wrench.and.screwdriver.fill"
            label="Equipment Type"
            value={equipmentLabel(equipmentType)}
            onPress={() => setShowEquipmentPicker(true)}
          />
          <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
            <View style={[styles.settingIcon, { backgroundColor: colors.primary + "18" }]}>
              <IconSymbol name="list.number" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingLabel, { color: colors.foreground, marginBottom: 10 }]}>
                Capacity (vehicles)
              </Text>
              <CapacityPicker
                value={equipmentCapacity}
                onChange={(v) => {
                  setEquipmentCapacity(v);
                  saveField({ equipmentCapacity: v });
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
              />
            </View>
          </View>
          <SettingRow
            icon="phone.fill"
            label="Phone"
            value={convexProfile?.phone ?? driver?.phone ?? "—"}
          />
        </View>

        {/* ── NOTIFICATIONS SECTION ── */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>NOTIFICATIONS</Text>
          </View>
          <SettingRow
            icon="bell.badge.fill"
            label="New Load Assigned"
            rightElement={
              <Switch
                value={notifyNewLoad}
                onValueChange={(val) => {
                  setNotifyNewLoad(val);
                  saveField({ notifyNewLoad: val });
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                }}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#FFFFFF"
              />
            }
          />
          <SettingRow
            icon="envelope.badge.fill"
            label="Company Invite Received"
            rightElement={
              <Switch
                value={notifyNewInvite}
                onValueChange={(val) => {
                  setNotifyNewInvite(val);
                  saveField({ notifyNewInvite: val });
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                }}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#FFFFFF"
              />
            }
          />
          <SettingRow
            icon="key.fill"
            label="Gate Pass Expiring"
            rightElement={
              <Switch
                value={notifyGatePassExpiry}
                onValueChange={(val) => {
                  setNotifyGatePassExpiry(val);
                  saveField({ notifyGatePassExpiry: val });
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                }}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#FFFFFF"
              />
            }
          />
          <SettingRow
            icon="calendar.badge.exclamationmark"
            label="Storage Expiry Today"
            rightElement={
              <Switch
                value={notifyStorageExpiry}
                onValueChange={(val) => {
                  setNotifyStorageExpiry(val);
                  saveField({ notifyStorageExpiry: val });
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                }}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#FFFFFF"
              />
            }
          />
        </View>

        {/* ── SETTINGS SECTION ── */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>DISPLAY</Text>
          </View>
          {/* Maps app preference */}
          <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
            <View style={[styles.settingIcon, { backgroundColor: colors.primary + "18" }]}>
              <IconSymbol name="location.fill" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingLabel, { color: colors.foreground }]}>Navigation App</Text>
              <Text style={[styles.settingSubLabel, { color: colors.muted }]}>
                {settings.mapsApp === "google" ? "Google Maps" : settings.mapsApp === "apple" ? "Apple Maps" : "Not set (will ask on first tap)"}
              </Text>
            </View>
            <View style={styles.routeToggleRow}>
              <TouchableOpacity
                style={[
                  styles.routeToggleChip,
                  {
                    backgroundColor: settings.mapsApp === "apple" ? colors.primary : colors.surface,
                    borderColor: settings.mapsApp === "apple" ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => {
                  setMapsApp("apple");
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.routeToggleText, { color: settings.mapsApp === "apple" ? "#FFFFFF" : colors.muted }]}>Apple</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.routeToggleChip,
                  {
                    backgroundColor: settings.mapsApp === "google" ? colors.primary : colors.surface,
                    borderColor: settings.mapsApp === "google" ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => {
                  setMapsApp("google");
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.routeToggleText, { color: settings.mapsApp === "google" ? "#FFFFFF" : colors.muted }]}>Google</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Route display toggle */}
          <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
            <View style={[styles.settingIcon, { backgroundColor: colors.primary + "18" }]}>
              <IconSymbol name="map.fill" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingLabel, { color: colors.foreground }]}>Route Display</Text>
              <Text style={[styles.settingSubLabel, { color: colors.muted }]}>
                {settings.routeDisplayMode === "city" ? "Showing city & state" : "Showing facility name"}
              </Text>
            </View>
            <View style={styles.routeToggleRow}>
              <TouchableOpacity
                style={[
                  styles.routeToggleChip,
                  {
                    backgroundColor: settings.routeDisplayMode === "city" ? colors.primary : colors.surface,
                    borderColor: settings.routeDisplayMode === "city" ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => {
                  setRouteDisplayMode("city");
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.routeToggleText, { color: settings.routeDisplayMode === "city" ? "#FFFFFF" : colors.muted }]}>City</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.routeToggleChip,
                  {
                    backgroundColor: settings.routeDisplayMode === "facility" ? colors.primary : colors.surface,
                    borderColor: settings.routeDisplayMode === "facility" ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => {
                  setRouteDisplayMode("facility");
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.routeToggleText, { color: settings.routeDisplayMode === "facility" ? "#FFFFFF" : colors.muted }]}>Facility</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ── MY SIGNATURE ── */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>MY SIGNATURE</Text>
          </View>
          {settings.driverSignaturePaths.length > 0 ? (
            <View style={{ padding: 16 }}>
              <View style={[{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, overflow: "hidden", height: 100 }]}>
                <Svg width="100%" height="100">
                  {settings.driverSignaturePaths
                    .filter((p: { d: string }) => !p.d.startsWith("__live__"))
                    .map((p: { d: string }, i: number) => (
                      <Path key={i} d={p.d} stroke={colors.foreground} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    ))}
                </Svg>
              </View>
              <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                <TouchableOpacity
                  style={[{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: colors.primary + "18", borderWidth: 1, borderColor: colors.primary + "40" }]}
                  onPress={() => { setSigPaths(settings.driverSignaturePaths); setSigSaved(false); setShowSignaturePad(true); }}
                  activeOpacity={0.7}
                >
                  <Text style={[{ color: colors.primary, fontWeight: "600", fontSize: 14 }]}>Update Signature</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: colors.error + "12", borderWidth: 1, borderColor: colors.error + "40" }]}
                  onPress={() => { Alert.alert("Remove Signature?", "This will delete your saved signature. You will need to sign manually on each load.", [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => setDriverSignaturePaths([]) }]); }}
                  activeOpacity={0.7}
                >
                  <Text style={[{ color: colors.error, fontWeight: "600", fontSize: 14 }]}>Remove</Text>
                </TouchableOpacity>
              </View>
              <Text style={[{ color: colors.success, fontSize: 12, textAlign: "center", marginTop: 8 }]}>
                ✓ Saved — auto-applied when customer is not available
              </Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.settingRow, { borderBottomColor: colors.border }]}
              onPress={() => { setSigPaths([]); setSigSaved(false); setShowSignaturePad(true); }}
              activeOpacity={0.7}
            >
              <View style={[styles.settingIcon, { backgroundColor: colors.primary + "18" }]}>
                <IconSymbol name="pencil.and.outline" size={18} color={colors.primary} />
              </View>
              <Text style={[styles.settingLabel, { color: colors.foreground }]}>Set My Signature</Text>
              <Text style={[styles.settingValue, { color: colors.muted }]}>Not set</Text>
              <IconSymbol name="chevron.right" size={16} color={colors.muted} />
            </TouchableOpacity>
          )}
        </View>

        {/* ── LOAD HISTORY ── */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>LOAD HISTORY</Text>
          </View>
          <SettingRow
            icon="archivebox.fill"
            label="Move All Delivered to Archive"
            value={deliveredCount > 0 ? `${deliveredCount} load${deliveredCount === 1 ? "" : "s"}` : "None"}
            onPress={handleArchiveAllDelivered}
          />
          <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
            <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 17 }}>
              Delivered loads older than 30 days are automatically moved to the Archived tab. You can also move them manually at any time.
            </Text>
          </View>
        </View>

        {/* Clear Test Data — only shown when non-platform loads exist */}
        {nonPlatformLoadCount > 0 && (
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <SettingRow
              icon="trash.fill"
              label={`Clear Test Data (${nonPlatformLoadCount} load${nonPlatformLoadCount === 1 ? "" : "s"})`}
              onPress={handleClearTestData}
              danger
            />
          </View>
        )}

        {/* Sign Out */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <SettingRow icon="arrow.right" label="Sign Out" onPress={handleLogout} danger />
        </View>

        <Text style={[styles.version, { color: colors.muted }]}>AutoHaul Driver v1.0.0</Text>
      </ScrollView>

      {/* ── EQUIPMENT TYPE PICKER MODAL ── */}
      <Modal
        visible={showEquipmentPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEquipmentPicker(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowEquipmentPicker(false)}
        >
          <View style={[styles.pickerSheet, { backgroundColor: colors.surface }]}>
            <View style={[styles.pickerHandle, { backgroundColor: colors.border }]} />
            <Text style={[styles.pickerTitle, { color: colors.foreground }]}>Equipment Type</Text>
            <FlatList
              data={EQUIPMENT_TYPES}
              keyExtractor={(item) => item.value}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.pickerItem,
                    { borderBottomColor: colors.border },
                    equipmentType === item.value && { backgroundColor: colors.primary + "12" },
                  ]}
                  onPress={() => {
                    setEquipmentType(item.value);
                    saveField({ equipmentType: item.value });
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setShowEquipmentPicker(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.pickerItemText, { color: colors.foreground }]}>{item.label}</Text>
                  {equipmentType === item.value && (
                    <IconSymbol name="checkmark" size={18} color={colors.primary} />
                  )}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── SIGNATURE PAD MODAL ── */}
      <Modal
        visible={showSignaturePad}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSignaturePad(false)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
          <View style={[{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 }]}>
            <View style={[styles.pickerHandle, { backgroundColor: colors.border, alignSelf: "center", marginBottom: 16 }]} />
            <Text style={[styles.pickerTitle, { color: colors.foreground }]}>My Signature</Text>
            <Text style={[{ color: colors.muted, fontSize: 13, textAlign: "center", marginBottom: 16 }]}>
              Draw your signature below. It will be auto-applied when a customer is not available.
            </Text>
            {/* Signature Canvas */}
            <SignaturePadInline
              paths={sigPaths}
              onPathsChange={setSigPaths}
              borderColor={colors.border}
              strokeColor={colors.foreground}
              backgroundColor={colors.background}
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <TouchableOpacity
                style={[{ flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}
                onPress={() => setSigPaths([])}
                activeOpacity={0.7}
              >
                <Text style={[{ color: colors.muted, fontWeight: "600" }]}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[{ flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: "center", backgroundColor: sigPaths.filter((p: { d: string }) => !p.d.startsWith("__live__")).length > 0 ? colors.primary : colors.border }]}
                onPress={() => {
                  const stable = sigPaths.filter((p: { d: string }) => !p.d.startsWith("__live__"));
                  if (stable.length === 0) return;
                  setDriverSignaturePaths(stable);
                  setSigSaved(true);
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  setShowSignaturePad(false);
                }}
                activeOpacity={0.7}
              >
                <Text style={[{ color: "#FFFFFF", fontWeight: "700" }]}>Save Signature</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={{ marginTop: 12, alignItems: "center", paddingVertical: 10 }}
              onPress={() => setShowSignaturePad(false)}
              activeOpacity={0.7}
            >
              <Text style={[{ color: colors.muted, fontSize: 14 }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

// ─── Inline Signature Pad (for Settings modal) ─────────────────────────────
function SignaturePadInline({
  paths,
  onPathsChange,
  borderColor,
  strokeColor,
  backgroundColor,
}: {
  paths: { d: string }[];
  onPathsChange: (p: { d: string }[]) => void;
  borderColor: string;
  strokeColor: string;
  backgroundColor: string;
}) {
  const currentPath = useRef("");
  const isDrawing = useRef(false);
  const pathsRef = useRef(paths);
  pathsRef.current = paths;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        currentPath.current = `M${locationX.toFixed(1)},${locationY.toFixed(1)}`;
        isDrawing.current = true;
      },
      onPanResponderMove: (evt) => {
        if (!isDrawing.current) return;
        const { locationX, locationY } = evt.nativeEvent;
        currentPath.current += ` L${locationX.toFixed(1)},${locationY.toFixed(1)}`;
        const stable = pathsRef.current.filter((p) => !p.d.startsWith("__live__"));
        onPathsChange([...stable, { d: "__live__" + currentPath.current }]);
      },
      onPanResponderRelease: () => {
        if (!isDrawing.current) return;
        isDrawing.current = false;
        const finalD = currentPath.current;
        currentPath.current = "";
        const stable = pathsRef.current.filter((p) => !p.d.startsWith("__live__"));
        onPathsChange([...stable, { d: finalD }]);
      },
    })
  ).current;
  return (
    <View
      style={[{ height: 150, borderRadius: 12, borderWidth: 1, borderColor, backgroundColor, overflow: "hidden" }]}
      {...panResponder.panHandlers}
    >
      <Svg width="100%" height="150">
        {paths
          .filter((p) => !p.d.startsWith("__live__"))
          .map((p, i) => (
            <Path key={i} d={p.d} stroke={strokeColor} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
        {paths
          .filter((p) => p.d.startsWith("__live__"))
          .map((p, i) => (
            <Path key={`live-${i}`} d={p.d.replace("__live__", "")} stroke={strokeColor} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
      </Svg>
      {paths.filter((p) => !p.d.startsWith("__live__")).length === 0 && (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "center", alignItems: "center", pointerEvents: "none" }}>
          <Text style={{ color: borderColor, fontSize: 13 }}>Sign here</Text>
        </View>
      )}
    </View>
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
  headerBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  headerBadgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  // ── Driver ID Card ──────────────────────────────────────────────────────────
  driverIdCard: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
    borderRadius: 20,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  driverIdLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 8,
  },
  driverIdRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 8,
  },
  driverIdCode: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 1,
    flex: 1,
  },
  driverIdBtns: {
    flexDirection: "row",
    gap: 8,
  },
  driverIdBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  driverIdBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
  driverIdHint: {
    fontSize: 11,
    lineHeight: 16,
  },
  // ── Avatar Card ─────────────────────────────────────────────────────────────
  avatarCard: {
    margin: 16,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "700",
  },
  driverInfo: {
    flex: 1,
    gap: 4,
  },
  driverName: {
    fontSize: 18,
    fontWeight: "700",
  },
  driverEmail: {
    fontSize: 13,
  },
  // ── Section ─────────────────────────────────────────────────────────────────
  section: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  inviteBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  inviteBadgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 16,
  },
  loadingText: {
    fontSize: 14,
  },
  // ── Invite rows ─────────────────────────────────────────────────────────────
  inviteRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  inviteRowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  inviteIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  inviteInfo: {
    flex: 1,
    gap: 2,
  },
  inviteCompanyName: {
    fontSize: 16,
    fontWeight: "700",
  },
  inviteCompanyCode: {
    fontSize: 13,
  },
  inviteMessage: {
    fontSize: 13,
    lineHeight: 18,
    fontStyle: "italic",
    paddingLeft: 52,
  },
  inviteActions: {
    flexDirection: "row",
    gap: 10,
    paddingLeft: 52,
  },
  acceptBtn: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  declineBtn: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  declineBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  // ── Setting rows ─────────────────────────────────────────────────────────────
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 0.5,
    gap: 12,
  },
  settingIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  settingLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
  },
  settingValue: {
    fontSize: 14,
    marginRight: 4,
  },
  companiesRowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  // ── Capacity picker ──────────────────────────────────────────────────────────
  capacityRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingBottom: 4,
  },
  capacityChip: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  capacityChipText: {
    fontSize: 14,
    fontWeight: "600",
  },
  // ── Company rows ─────────────────────────────────────────────────────────────
  companyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  companyIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  companyInfo: {
    flex: 1,
    gap: 2,
  },
  companyName: {
    fontSize: 15,
    fontWeight: "600",
  },
  companyCode: {
    fontSize: 12,
  },
  leaveBtn: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 60,
  },
  leaveBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  // ── Equipment type picker modal ───────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  pickerSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingBottom: 40,
    maxHeight: "60%",
  },
  pickerHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  pickerTitle: {
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  pickerItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 0.5,
  },
  pickerItemText: {
    fontSize: 16,
    fontWeight: "500",
  },
  // ── Route display toggle ──────────────────────────────────────────────────────
  settingSubLabel: {
    fontSize: 12,
    marginTop: 1,
  },
  routeToggleRow: {
    flexDirection: "row",
    gap: 6,
  },
  routeToggleChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  routeToggleText: {
    fontSize: 13,
    fontWeight: "600",
  },
  // ── Footer ───────────────────────────────────────────────────────────────────
  version: {
    textAlign: "center",
    fontSize: 12,
    paddingVertical: 24,
  },
});
