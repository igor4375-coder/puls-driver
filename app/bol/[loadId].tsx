import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Share,
  Platform,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useLoads } from "@/lib/loads-context";
import { useAuth } from "@/lib/auth-context";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { formatDate, formatCurrency, getPaymentLabel, type Damage } from "@/lib/data";

// ─── BOL PDF Preview (rendered as HTML-like view) ────────────────────────────

function BOLPreview({ loadId }: { loadId: string }) {
  const colors = useColors();
  const { getLoad } = useLoads();
  const { driver } = useAuth();
  const load = getLoad(loadId);

  if (!load) return null;

  const allDamages: { vehicle: string; damage: Damage }[] = [];
  load.vehicles.forEach((v) => {
    (v.pickupInspection?.damages ?? []).forEach((d) => {
      allDamages.push({ vehicle: `${v.year} ${v.make} ${v.model}`, damage: d });
    });
  });

  return (
    <View style={[styles.bolDoc, { backgroundColor: "#FFFFFF" }]}>
      {/* BOL Header */}
      <View style={[styles.bolHeader, { borderBottomColor: "#E2E8F0" }]}>
        <View style={[styles.bolLogoBox, { backgroundColor: "#1A3C5E" }]}>
          <Text style={styles.bolLogoText}>AutoHaul</Text>
        </View>
        <View style={styles.bolHeaderRight}>
          <Text style={styles.bolTitle}>BILL OF LADING</Text>
          <Text style={styles.bolLoadNum}>#{load.loadNumber}</Text>
          <Text style={styles.bolDate}>Date: {formatDate(new Date().toISOString().split("T")[0])}</Text>
        </View>
      </View>

      {/* Company & Driver Info */}
      <View style={[styles.bolSection, { borderBottomColor: "#E2E8F0" }]}>
        <View style={styles.bolTwoCol}>
          <View style={styles.bolCol}>
            <Text style={styles.bolSectionLabel}>CARRIER / COMPANY</Text>
            <Text style={styles.bolFieldValue}>{driver?.company ?? "FastLane Auto Transport"}</Text>
            <Text style={styles.bolFieldMuted}>Driver: {driver?.name}</Text>
            <Text style={styles.bolFieldMuted}>Truck: {driver?.truckNumber}</Text>
          </View>
          <View style={styles.bolCol}>
            <Text style={styles.bolSectionLabel}>PAYMENT</Text>
            <Text style={styles.bolFieldValue}>{formatCurrency(load.driverPay)}</Text>
            <Text style={styles.bolFieldMuted}>{getPaymentLabel(load.paymentType)}</Text>
          </View>
        </View>
      </View>

      {/* Pickup & Delivery */}
      <View style={[styles.bolSection, { borderBottomColor: "#E2E8F0" }]}>
        <View style={styles.bolTwoCol}>
          <View style={styles.bolCol}>
            <Text style={styles.bolSectionLabel}>PICKUP</Text>
            <Text style={styles.bolFieldValue}>{load.pickup.contact.name}</Text>
            <Text style={styles.bolFieldMuted}>{load.pickup.contact.company}</Text>
            <Text style={styles.bolFieldMuted}>{load.pickup.contact.address}</Text>
            <Text style={styles.bolFieldMuted}>
              {load.pickup.contact.city}, {load.pickup.contact.state} {load.pickup.contact.zip}
            </Text>
            <Text style={styles.bolFieldMuted}>Date: {formatDate(load.pickup.date)}</Text>
          </View>
          <View style={styles.bolCol}>
            <Text style={styles.bolSectionLabel}>DELIVERY</Text>
            <Text style={styles.bolFieldValue}>{load.delivery.contact.name}</Text>
            <Text style={styles.bolFieldMuted}>{load.delivery.contact.company}</Text>
            <Text style={styles.bolFieldMuted}>{load.delivery.contact.address}</Text>
            <Text style={styles.bolFieldMuted}>
              {load.delivery.contact.city}, {load.delivery.contact.state} {load.delivery.contact.zip}
            </Text>
            <Text style={styles.bolFieldMuted}>Date: {formatDate(load.delivery.date)}</Text>
          </View>
        </View>
      </View>

      {/* Vehicles Table */}
      <View style={[styles.bolSection, { borderBottomColor: "#E2E8F0" }]}>
        <Text style={styles.bolSectionLabel}>VEHICLES</Text>
        <View style={[styles.bolTable, { borderColor: "#E2E8F0" }]}>
          {/* Table Header */}
          <View style={[styles.bolTableRow, { backgroundColor: "#F8F9FA", borderBottomColor: "#E2E8F0" }]}>
            <Text style={[styles.bolTableHeader, { flex: 2 }]}>Vehicle</Text>
            <Text style={[styles.bolTableHeader, { flex: 2 }]}>VIN</Text>
            <Text style={[styles.bolTableHeader, { flex: 1 }]}>Color</Text>
            <Text style={[styles.bolTableHeader, { flex: 1 }]}>Damages</Text>
          </View>
          {load.vehicles.map((v) => (
            <View key={v.id} style={[styles.bolTableRow, { borderBottomColor: "#E2E8F0" }]}>
              <Text style={[styles.bolTableCell, { flex: 2 }]}>
                {v.year} {v.make} {v.model}
              </Text>
              <Text style={[styles.bolTableCell, { flex: 2, fontSize: 9 }]}>{v.vin}</Text>
              <Text style={[styles.bolTableCell, { flex: 1 }]}>{v.color}</Text>
              <Text style={[styles.bolTableCell, { flex: 1 }]}>
                {v.pickupInspection?.damages.length ?? 0}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Damage Report */}
      {allDamages.length > 0 && (
        <View style={[styles.bolSection, { borderBottomColor: "#E2E8F0" }]}>
          <Text style={styles.bolSectionLabel}>PRE-EXISTING DAMAGE REPORT</Text>
          {allDamages.map(({ vehicle, damage }, idx) => (
            <View key={idx} style={styles.bolDamageRow}>
              <Text style={styles.bolDamageVehicle}>{vehicle}:</Text>
              <Text style={styles.bolDamageDesc}>
                {damage.type} on {damage.zone.replace(/_/g, " ")} ({damage.severity})
                {damage.description ? ` — ${damage.description}` : ""}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Notes */}
      {load.notes ? (
        <View style={[styles.bolSection, { borderBottomColor: "#E2E8F0" }]}>
          <Text style={styles.bolSectionLabel}>NOTES</Text>
          <Text style={styles.bolFieldMuted}>{load.notes}</Text>
        </View>
      ) : null}

      {/* Signatures */}
      <View style={styles.bolSection}>
        <View style={styles.bolTwoCol}>
          <View style={styles.bolCol}>
            <Text style={styles.bolSectionLabel}>PICKUP SIGNATURE</Text>
            <View style={[styles.bolSigBox, { borderColor: "#E2E8F0" }]}>
              <Text style={styles.bolSigPlaceholder}>
                {load.vehicles[0]?.pickupInspection?.signatureUri ? "Signed" : "Awaiting signature"}
              </Text>
            </View>
            <Text style={styles.bolFieldMuted}>Shipper / Agent</Text>
          </View>
          <View style={styles.bolCol}>
            <Text style={styles.bolSectionLabel}>DELIVERY SIGNATURE</Text>
            <View style={[styles.bolSigBox, { borderColor: "#E2E8F0" }]}>
              <Text style={styles.bolSigPlaceholder}>
                {load.vehicles[0]?.deliveryInspection?.signatureUri ? "Signed" : "Awaiting signature"}
              </Text>
            </View>
            <Text style={styles.bolFieldMuted}>Consignee / Agent</Text>
          </View>
        </View>
      </View>

      {/* Footer */}
      <View style={[styles.bolFooter, { borderTopColor: "#E2E8F0", backgroundColor: "#F8F9FA" }]}>
        <Text style={styles.bolFooterText}>
          This Bill of Lading is generated by AutoHaul Driver. By signing, all parties agree to the terms and conditions of transport.
        </Text>
      </View>
    </View>
  );
}

// ─── Main BOL Screen ──────────────────────────────────────────────────────────

export default function BOLScreen() {
  const colors = useColors();
  const { loadId } = useLocalSearchParams<{ loadId: string }>();
  const { getLoad } = useLoads();
  const load = getLoad(loadId);

  const handleSend = () => {
    Alert.alert(
      "Send BOL",
      "Enter the email address to send the Bill of Lading to:",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send",
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert("BOL Sent", "The Bill of Lading has been sent successfully.");
          },
        },
      ]
    );
  };

  const handleShare = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await Share.share({
        title: `BOL - ${load?.loadNumber}`,
        message: `Bill of Lading for Load #${load?.loadNumber}\n\nPickup: ${load?.pickup.contact.city}, ${load?.pickup.contact.state}\nDelivery: ${load?.delivery.contact.city}, ${load?.delivery.contact.state}\n\nGenerated by AutoHaul Driver`,
      });
    } catch {
      // user cancelled
    }
  };

  const handlePrint = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      "Print BOL",
      "This will open the print dialog to print the Bill of Lading.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Print", onPress: () => Alert.alert("Print", "Print functionality will be connected to the backend.") },
      ]
    );
  };

  if (!load) {
    return (
      <ScreenContainer>
        <Text style={{ color: colors.foreground, padding: 20 }}>Load not found.</Text>
      </ScreenContainer>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View style={[styles.navHeader, { backgroundColor: colors.primary }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <IconSymbol name="xmark" size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.navHeaderCenter}>
          <Text style={styles.navTitle}>Bill of Lading</Text>
          <Text style={styles.navSubtitle}>#{load.loadNumber}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {/* Action Buttons */}
      <View style={[styles.actionBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.actionBtn} onPress={handleSend} activeOpacity={0.7}>
          <View style={[styles.actionIcon, { backgroundColor: colors.primary + "18" }]}>
            <IconSymbol name="envelope.fill" size={18} color={colors.primary} />
          </View>
          <Text style={[styles.actionLabel, { color: colors.foreground }]}>Send</Text>
        </TouchableOpacity>

        <View style={[styles.actionDivider, { backgroundColor: colors.border }]} />

        <TouchableOpacity style={styles.actionBtn} onPress={handleShare} activeOpacity={0.7}>
          <View style={[styles.actionIcon, { backgroundColor: colors.primary + "18" }]}>
            <IconSymbol name="square.and.arrow.up" size={18} color={colors.primary} />
          </View>
          <Text style={[styles.actionLabel, { color: colors.foreground }]}>Share</Text>
        </TouchableOpacity>

        <View style={[styles.actionDivider, { backgroundColor: colors.border }]} />

        <TouchableOpacity style={styles.actionBtn} onPress={handlePrint} activeOpacity={0.7}>
          <View style={[styles.actionIcon, { backgroundColor: colors.primary + "18" }]}>
            <IconSymbol name="printer.fill" size={18} color={colors.primary} />
          </View>
          <Text style={[styles.actionLabel, { color: colors.foreground }]}>Print</Text>
        </TouchableOpacity>
      </View>

      {/* BOL Document Preview */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.docContainer}
        showsVerticalScrollIndicator={false}
      >
        <BOLPreview loadId={loadId} />
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  navHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 14,
  },
  backBtn: {
    padding: 4,
  },
  navHeaderCenter: {
    flex: 1,
    alignItems: "center",
  },
  navTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  navSubtitle: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 12,
    marginTop: 2,
  },
  actionBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
  },
  actionBtn: {
    flex: 1,
    alignItems: "center",
    gap: 6,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  actionDivider: {
    width: 1,
    height: 40,
  },
  docContainer: {
    padding: 12,
  },
  // BOL Document Styles
  bolDoc: {
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  bolHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    gap: 12,
  },
  bolLogoBox: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  bolLogoText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  bolHeaderRight: {
    flex: 1,
    alignItems: "flex-end",
  },
  bolTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0F1923",
    letterSpacing: 1,
  },
  bolLoadNum: {
    fontSize: 13,
    color: "#64748B",
    marginTop: 2,
  },
  bolDate: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  bolSection: {
    padding: 14,
    borderBottomWidth: 1,
  },
  bolTwoCol: {
    flexDirection: "row",
    gap: 12,
  },
  bolCol: {
    flex: 1,
    gap: 3,
  },
  bolSectionLabel: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
    color: "#94A3B8",
    marginBottom: 6,
  },
  bolFieldValue: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F1923",
  },
  bolFieldMuted: {
    fontSize: 11,
    color: "#64748B",
    lineHeight: 16,
  },
  bolTable: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: "hidden",
    marginTop: 6,
  },
  bolTableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  bolTableHeader: {
    fontSize: 9,
    fontWeight: "800",
    color: "#64748B",
    letterSpacing: 0.5,
  },
  bolTableCell: {
    fontSize: 11,
    color: "#0F1923",
  },
  bolDamageRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 4,
  },
  bolDamageVehicle: {
    fontSize: 11,
    fontWeight: "700",
    color: "#0F1923",
  },
  bolDamageDesc: {
    fontSize: 11,
    color: "#64748B",
    flex: 1,
  },
  bolSigBox: {
    height: 50,
    borderWidth: 1,
    borderRadius: 6,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
    marginTop: 4,
  },
  bolSigPlaceholder: {
    fontSize: 11,
    color: "#94A3B8",
    fontStyle: "italic",
  },
  bolFooter: {
    padding: 12,
    borderTopWidth: 1,
  },
  bolFooterText: {
    fontSize: 9,
    color: "#94A3B8",
    lineHeight: 14,
    textAlign: "center",
  },
});
