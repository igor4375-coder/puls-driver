/**
 * PendingInviteBanner
 *
 * A company invite is useless if the driver never finds it. The accept and
 * decline buttons live on the Profile tab, which drivers had to be talked
 * into opening over the phone. This banner rides on top of the app for as
 * long as an invite is unanswered and takes one tap to get to those buttons.
 *
 * Positioned absolutely so it never changes layout height, and offset below
 * the build-tag pill so the two overlays do not collide. Rendered by the tab
 * layout, so it shows on every tab and is covered by any screen pushed on top
 * (load detail, inspection, camera) without having to list those routes.
 */

import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { usePendingInvites } from "@/lib/pending-invites-context";

export function PendingInviteBanner() {
  const { invites } = usePendingInvites();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  if (invites.length === 0) return null;

  const [first] = invites;
  const extra = invites.length - 1;
  const company = first.companyName || "A company";
  const title =
    invites.length > 1
      ? `${invites.length} company invitations`
      : "Company invitation";
  const detail =
    extra > 0
      ? `${company} and ${extra} other${extra > 1 ? "s" : ""}`
      : `${company} wants to add you`;

  return (
    <TouchableOpacity
      style={[styles.banner, { top: insets.top + 26 }]}
      onPress={() => router.navigate("/(tabs)/profile")}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}. Tap to accept or decline.`}
    >
      <View style={styles.icon}>
        <IconSymbol name="envelope.fill" size={16} color="#E65100" />
      </View>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.detail} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <View style={styles.cta}>
        <Text style={styles.ctaText}>Review</Text>
        <IconSymbol name="chevron.right" size={12} color="#FFFFFF" />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    left: 10,
    right: 10,
    zIndex: 2500,
    elevation: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#FFF8E1",
    borderWidth: 1,
    borderColor: "#FFB300",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFE0B2",
  },
  text: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: "700",
    color: "#E65100",
  },
  detail: {
    fontSize: 11,
    color: "#5D4037",
    marginTop: 1,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#2E7D32",
  },
  ctaText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
