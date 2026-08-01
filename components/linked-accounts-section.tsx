/**
 * LinkedAccountsSection — multi-account ("account switcher") UI.
 *
 * Lets a single driver sign in with multiple Clerk accounts on the same device
 * and swap between them with one tap. Useful for drivers who run two operations
 * (e.g. personal account + a business account).
 *
 * Gated by `driverProfiles.multiAccountEnabled === true` on the active driver's
 * Convex profile. When the flag is off, this entire component renders nothing,
 * so other drivers never see the feature.
 *
 * Implementation notes:
 *  - Uses Clerk's native multi-session support (`clerk.client.sessions` + `setActive`).
 *  - The Clerk dashboard must have "Multi-session applications" enabled or the
 *    second sign-in will replace the first. (Settings → Sessions in Clerk).
 *  - When the active session changes, Convex `getByClerkUserId` automatically
 *    swaps to the other profile and the rest of the app updates (driver object,
 *    loads list, push token re-registration in AuthContext).
 */

import React, { useMemo, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useClerk } from "@clerk/expo";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useLoads } from "@/lib/loads-context";
import { photoQueue } from "@/lib/photo-queue";

interface SessionLite {
  id: string;
  email: string | null;
  name: string | null;
  imageUrl: string | null;
}

export function LinkedAccountsSection({ enabled }: { enabled: boolean }) {
  const colors = useColors();
  const clerk = useClerk();
  const { flushPlatformSyncQueue } = useLoads();
  const [busyId, setBusyId] = useState<string | null>(null);

  // Snapshot the sessions on every render — the list updates as Clerk
  // adds/removes them. Treated as `any[]` because `clerk.client.sessions`
  // type can vary across @clerk/expo versions.
  const sessions = useMemo<SessionLite[]>(() => {
    const raw = (clerk?.client as any)?.sessions ?? [];
    return raw.map((s: any) => {
      const u = s?.user;
      const email =
        u?.primaryEmailAddress?.emailAddress ??
        u?.emailAddresses?.[0]?.emailAddress ??
        null;
      const name =
        u?.fullName ??
        ([u?.firstName, u?.lastName].filter(Boolean).join(" ") || null);
      return {
        id: s?.id ?? "",
        email,
        name,
        imageUrl: u?.imageUrl ?? null,
      };
    });
  }, [clerk?.client, (clerk?.client as any)?.sessions?.length, clerk?.session?.id]);

  const activeSessionId = (clerk as any)?.session?.id ?? null;

  if (!enabled) return null;

  const handleSwitch = async (sessionId: string) => {
    if (sessionId === activeSessionId) return;
    setBusyId(sessionId);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // CRITICAL: drain pending platform calls + force-persist the photo queue
      // BEFORE swapping the Clerk session.
      //
      // Why: queued markAsPickedUp / markAsDelivered / syncInspection calls
      // pull the auth token from the *currently active* Clerk session via the
      // Convex client. If we swap mid-flight, those calls go out with the
      // wrong driver's token and the company platform rejects them — exactly
      // what caused Niklas's picked-up vehicles to bleed into the other
      // account in the v59 incident.
      //
      // We give the queue 5 s to drain. If it doesn't, the tasks are still
      // safely persisted to the OUTGOING driver's scoped storage and will be
      // retried next time that driver is the active session.
      try {
        await flushPlatformSyncQueue(5000);
      } catch {
        // Non-fatal — proceed even if drain check failed.
      }
      try {
        await photoQueue.persist();
      } catch {
        // Non-fatal.
      }

      await (clerk as any).setActive({ session: sessionId });
      // AuthProvider re-runs and Convex profile/loads/push-token swap automatically.
      // LoadsProviderWithAuth's effect calls photoQueue.setActiveDriver() with
      // the new code, which re-keys the queue's storage to the new driver.
    } catch (err: any) {
      Alert.alert("Couldn't switch account", err?.message ?? "Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const handleSignOutSession = (sessionId: string) => {
    Alert.alert(
      "Remove this account",
      "This signs out this account on this device. The other account stays signed in.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign Out",
          style: "destructive",
          onPress: async () => {
            setBusyId(sessionId);
            try {
              await (clerk as any).signOut({ sessionId });
            } catch (err: any) {
              Alert.alert("Couldn't sign out", err?.message ?? "Please try again.");
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
  };

  const handleAddAccount = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Routes to the existing email-entry flow. With Clerk multi-session enabled,
    // the new sign-in adds a parallel session instead of replacing the current one.
    router.push("/(auth)/email-entry?mode=add" as any);
  };

  return (
    <View>
      <Text style={[styles.sectionTitle, { color: colors.muted }]}>LINKED ACCOUNTS</Text>
      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {sessions.length === 0 ? (
          <View style={styles.emptyRow}>
            <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 18 }}>
              No additional accounts linked yet.
            </Text>
          </View>
        ) : (
          sessions.map((s, idx) => {
            const isActive = s.id === activeSessionId;
            const isBusy = busyId === s.id;
            return (
              <View
                key={s.id}
                style={[
                  styles.row,
                  idx < sessions.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
                ]}
              >
                <View style={[styles.avatar, { backgroundColor: colors.primary + "22" }]}>
                  <IconSymbol name="person.fill" size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
                    {s.name ?? s.email ?? "Account"}
                  </Text>
                  {s.email && (
                    <Text style={[styles.email, { color: colors.muted }]} numberOfLines={1}>
                      {s.email}
                    </Text>
                  )}
                </View>
                {isBusy ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : isActive ? (
                  <View style={[styles.activePill, { backgroundColor: colors.success + "22" }]}>
                    <IconSymbol name="checkmark.circle.fill" size={14} color={colors.success} />
                    <Text style={[styles.activeText, { color: colors.success }]}>Active</Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <TouchableOpacity
                      style={[styles.switchBtn, { backgroundColor: colors.primary }]}
                      onPress={() => handleSwitch(s.id)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.switchBtnText}>Switch</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleSignOutSession(s.id)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      activeOpacity={0.7}
                    >
                      <IconSymbol name="xmark.circle" size={20} color={colors.muted} />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })
        )}

        <TouchableOpacity style={styles.addRow} onPress={handleAddAccount} activeOpacity={0.7}>
          <View style={[styles.avatar, { backgroundColor: colors.primary + "18" }]}>
            <IconSymbol name="plus" size={18} color={colors.primary} />
          </View>
          <Text style={[styles.addText, { color: colors.primary }]}>Add another account</Text>
          <IconSymbol name="chevron.right" size={16} color={colors.muted} />
        </TouchableOpacity>
      </View>

      <Text style={[styles.hint, { color: colors.muted }]}>
        Tap an account to swap instantly. Both accounts stay signed in on this device.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    marginTop: 18,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  section: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { fontSize: 15, fontWeight: "600" },
  email: { fontSize: 12, marginTop: 1 },
  activePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  activeText: { fontSize: 11, fontWeight: "700" },
  switchBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  switchBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  emptyRow: {
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderTopColor: "rgba(0,0,0,0.06)",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  addText: { flex: 1, fontSize: 15, fontWeight: "600" },
  hint: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 8,
    paddingHorizontal: 4,
  },
});
