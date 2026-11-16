import React, { useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Linking, Platform, AppState } from "react-native";
import type { PermissionResponse } from "expo-camera";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

type Props = {
  permission: PermissionResponse;
  /** Shows the system permission prompt. */
  onContinue: () => void;
  /** Leaves the screen. Only offered once the system prompt can no longer be shown. */
  onBack: () => void;
  /** Re-reads the permission, so returning from Settings unlocks the camera. */
  onRefresh?: () => void;
  message: string;
  dark?: boolean;
};

/**
 * App Store guideline 5.1.1(iv): the explanation before a permission prompt
 * may only offer "Continue", and that must always lead to the system prompt.
 * A way out is only allowed after the user has already answered the prompt.
 */
export function CameraPermissionScreen({ permission, onContinue, onBack, onRefresh, message, dark }: Props) {
  const colors = useColors();

  useEffect(() => {
    if (!onRefresh) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") onRefresh();
    });
    return () => sub.remove();
  }, [onRefresh]);
  const canPrompt =
    permission.status === "undetermined" ||
    (Platform.OS === "android" && permission.canAskAgain);

  const fg = dark ? "#fff" : colors.foreground;
  const muted = dark ? "#aaa" : colors.muted;

  return (
    <View style={[styles.root, { backgroundColor: dark ? "#000" : colors.background }]}>
      <IconSymbol name="camera.fill" size={52} color={dark ? "#fff" : colors.muted} />
      <Text style={[styles.title, { color: fg }]}>
        {canPrompt ? "Camera Access" : "Camera Access Is Off"}
      </Text>
      <Text style={[styles.message, { color: muted }]}>
        {canPrompt
          ? message
          : `${message}\n\nTo use this feature, turn on Camera for Puls Driver in Settings.`}
      </Text>
      {canPrompt ? (
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: colors.primary }]}
          onPress={onContinue}
          activeOpacity={0.85}
        >
          <Text style={styles.btnText}>Continue</Text>
        </TouchableOpacity>
      ) : (
        <>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: colors.primary }]}
            onPress={() => void Linking.openSettings()}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>Open Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.link} onPress={onBack} activeOpacity={0.7}>
            <Text style={[styles.linkText, { color: muted }]}>Go Back</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  title: { fontSize: 22, fontWeight: "700", textAlign: "center", marginTop: 20 },
  message: { fontSize: 15, textAlign: "center", lineHeight: 22, marginTop: 10, marginBottom: 28 },
  btn: { paddingHorizontal: 40, paddingVertical: 14, borderRadius: 14 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  link: { marginTop: 16, padding: 10 },
  linkText: { fontSize: 15 },
});
