import { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  ScrollView,
  StyleSheet,
  Modal,
  Platform,
  TextInput,
  Alert,
} from "react-native";
import * as Haptics from "expo-haptics";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useLoads } from "@/lib/loads-context";
import { useAuth } from "@/lib/auth-context";
import { usePermissions } from "@/lib/permissions-context";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

// ─── Date Range Helpers ──────────────────────────────────────────────────────

interface DateRange {
  label: string;
  start: Date;
  end: Date;
}

function getWeekStart(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff, 0, 0, 0, 0);
}

function buildMonthRange(year: number, month: number): DateRange {
  const now = new Date();
  const start = new Date(year, month, 1);
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  const end = isCurrentMonth ? now : new Date(year, month + 1, 0, 23, 59, 59, 999);
  const label = start.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return { label, start, end };
}

function getMonthOptions(count: number = 12): { year: number; month: number; label: string }[] {
  const now = new Date();
  const options: { year: number; month: number; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    options.push({
      year: d.getFullYear(),
      month: d.getMonth(),
      label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    });
  }
  return options;
}

type ChartGranularity = "day" | "week" | "month";

// ─── Formatting ──────────────────────────────────────────────────────────────

function fmtDollars(dollars: number): string {
  const sign = dollars < 0 ? "-" : "";
  const abs = Math.abs(dollars);
  if (abs >= 1000) {
    return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtCompact(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

// ─── Haversine Distance (miles) ───────────────────────────────────────────────

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (!lat1 || !lng1 || !lat2 || !lng2) return 0;
  const R = 3958.8; // Earth radius in miles
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const colors = useColors();
  const { loads } = useLoads();
  const { driver } = useAuth();
  const { canViewRates } = usePermissions();
  const driverCode = driver?.platformDriverCode ?? driver?.driverCode ?? "";

  const allExpenses = useQuery(
    api.expenses.getByDriver,
    driverCode ? { driverCode } : "skip",
  );

  const convexProfile = useQuery(
    api.driverProfiles.getByClerkUserId,
    driver?.id ? { clerkUserId: driver.id } : "skip",
  );
  const updateProfile = useMutation(api.driverProfiles.updateProfile);
  const monthlyGoal = convexProfile?.monthlyRevenueGoal ?? 0;

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [chartGranularity, setChartGranularity] = useState<ChartGranularity>("day");

  const range = useMemo(() => buildMonthRange(selectedYear, selectedMonth), [selectedYear, selectedMonth]);
  const monthOptions = useMemo(() => getMonthOptions(12), []);

  // ── Filter loads by date range ────────────────────────────────────────────

  const deliveredLoads = useMemo(() => {
    return loads.filter((l) => {
      if (l.status !== "delivered" && l.status !== "archived") return false;
      const ts = l.deliveredAt ?? l.delivery?.date;
      if (!ts) return false;
      const d = new Date(ts);
      return d >= range.start && d <= range.end;
    });
  }, [loads, range]);

  const pickedUpLoads = useMemo(() => {
    return loads.filter((l) => {
      if (l.status !== "picked_up") return false;
      const ts = l.assignedAt ?? l.pickup?.date;
      if (!ts) return false;
      const d = new Date(ts);
      return d >= range.start && d <= range.end;
    });
  }, [loads, range]);

  const filteredExpenses = useMemo(() => {
    if (!allExpenses) return [];
    return allExpenses.filter((e) => {
      const d = new Date(e.expenseDate);
      return d >= range.start && d <= range.end;
    });
  }, [allExpenses, range]);

  // ── Compute stats ─────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const totalRevenue = deliveredLoads.reduce((s, l) => s + (l.driverPay || 0), 0);
    const totalVehicles = deliveredLoads.reduce((s, l) => s + l.vehicles.length, 0);
    const totalLoads = deliveredLoads.length;
    const inTransitVehicles = pickedUpLoads.reduce((s, l) => s + l.vehicles.length, 0);
    const totalExpenseCents = filteredExpenses.reduce((s, e) => s + e.amountCents, 0);
    const netProfit = totalRevenue - totalExpenseCents / 100;
    const avgPerLoad = totalLoads > 0 ? totalRevenue / totalLoads : 0;
    const avgPerVehicle = totalVehicles > 0 ? totalRevenue / totalVehicles : 0;

    // Compute previous period for comparison
    const rangeDuration = range.end.getTime() - range.start.getTime();
    const prevStart = new Date(range.start.getTime() - rangeDuration);
    const prevEnd = new Date(range.start.getTime() - 1);
    const prevDelivered = loads.filter((l) => {
      if (l.status !== "delivered" && l.status !== "archived") return false;
      const ts = l.deliveredAt ?? l.delivery?.date;
      if (!ts) return false;
      const d = new Date(ts);
      return d >= prevStart && d <= prevEnd;
    });
    const prevRevenue = prevDelivered.reduce((s, l) => s + (l.driverPay || 0), 0);
    const revenueDelta = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : 0;

    // Activity buckets — adapts to chartGranularity
    const activityBuckets: { label: string; value: number }[] = [];

    const countVehiclesInRange = (bStart: Date, bEnd: Date) =>
      deliveredLoads.filter((l) => {
        const ts = l.deliveredAt ?? l.delivery?.date;
        if (!ts) return false;
        const d = new Date(ts);
        return d >= bStart && d <= bEnd;
      }).reduce((s, l) => s + l.vehicles.length, 0);

    if (chartGranularity === "day") {
      for (let i = 6; i >= 0; i--) {
        const day = new Date(range.end);
        day.setDate(day.getDate() - i);
        day.setHours(0, 0, 0, 0);
        const dayEnd = new Date(day);
        dayEnd.setHours(23, 59, 59, 999);
        activityBuckets.push({
          label: day.toLocaleDateString("en-US", { weekday: "short" }),
          value: countVehiclesInRange(day, dayEnd),
        });
      }
    } else if (chartGranularity === "week") {
      const weeksToShow = 6;
      const currentWeekStart = getWeekStart(range.end);
      for (let i = weeksToShow - 1; i >= 0; i--) {
        const wStart = new Date(currentWeekStart);
        wStart.setDate(wStart.getDate() - i * 7);
        const wEnd = new Date(wStart);
        wEnd.setDate(wEnd.getDate() + 6);
        wEnd.setHours(23, 59, 59, 999);
        activityBuckets.push({
          label: wStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          value: countVehiclesInRange(wStart, wEnd),
        });
      }
    } else {
      const monthsToShow = 6;
      for (let i = monthsToShow - 1; i >= 0; i--) {
        const mStart = new Date(range.end.getFullYear(), range.end.getMonth() - i, 1);
        const mEnd = new Date(mStart.getFullYear(), mStart.getMonth() + 1, 0, 23, 59, 59, 999);
        activityBuckets.push({
          label: mStart.toLocaleDateString("en-US", { month: "short" }),
          value: countVehiclesInRange(mStart, mEnd),
        });
      }
    }

    return {
      totalRevenue,
      totalVehicles,
      totalLoads,
      inTransitVehicles,
      totalExpenseCents,
      netProfit,
      avgPerLoad,
      avgPerVehicle,
      revenueDelta,
      activityBuckets,
    };
  }, [deliveredLoads, pickedUpLoads, filteredExpenses, loads, range, chartGranularity]);

  // ── Insights: turnaround, mileage, best period ─────────────────────────

  const insights = useMemo(() => {
    // Avg turnaround time (pickup to delivery) for loads in current range
    let turnaroundDays = 0;
    let turnaroundCount = 0;
    for (const l of deliveredLoads) {
      const pickupTs = l.assignedAt ?? l.pickup?.date;
      const deliverTs = l.deliveredAt ?? l.delivery?.date;
      if (!pickupTs || !deliverTs) continue;
      const diff = new Date(deliverTs).getTime() - new Date(pickupTs).getTime();
      if (diff > 0) {
        turnaroundDays += diff / (1000 * 60 * 60 * 24);
        turnaroundCount++;
      }
    }
    const avgTurnaroundDays = turnaroundCount > 0 ? turnaroundDays / turnaroundCount : 0;

    // Mileage estimate (straight-line haversine from pickup to delivery GPS)
    let totalMiles = 0;
    for (const l of deliveredLoads) {
      const pLat = l.pickup?.lat;
      const pLng = l.pickup?.lng;
      const dLat = l.delivery?.lat;
      const dLng = l.delivery?.lng;
      if (pLat && pLng && dLat && dLng) {
        totalMiles += haversineMiles(pLat, pLng, dLat, dLng);
      }
    }
    const costPerMile = totalMiles > 0 ? stats.totalRevenue / totalMiles : 0;

    // Best week and best month (across ALL delivered loads, not just current range)
    const allDelivered = loads.filter(
      (l) => (l.status === "delivered" || l.status === "archived") && (l.deliveredAt ?? l.delivery?.date),
    );

    // Best week
    const weekBuckets: Record<string, { revenue: number; start: Date }> = {};
    for (const l of allDelivered) {
      const ts = l.deliveredAt ?? l.delivery?.date;
      if (!ts) continue;
      const d = new Date(ts);
      const ws = getWeekStart(d);
      const key = ws.toISOString();
      if (!weekBuckets[key]) weekBuckets[key] = { revenue: 0, start: ws };
      weekBuckets[key].revenue += l.driverPay || 0;
    }
    let bestWeek: { revenue: number; label: string } | null = null;
    for (const b of Object.values(weekBuckets)) {
      if (!bestWeek || b.revenue > bestWeek.revenue) {
        const wEnd = new Date(b.start);
        wEnd.setDate(wEnd.getDate() + 6);
        bestWeek = {
          revenue: b.revenue,
          label: `${b.start.toLocaleDateString("en-US", { month: "short", day: "numeric" })}–${wEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
        };
      }
    }

    // Best month
    const monthBuckets: Record<string, { revenue: number; month: Date }> = {};
    for (const l of allDelivered) {
      const ts = l.deliveredAt ?? l.delivery?.date;
      if (!ts) continue;
      const d = new Date(ts);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (!monthBuckets[key]) monthBuckets[key] = { revenue: 0, month: new Date(d.getFullYear(), d.getMonth(), 1) };
      monthBuckets[key].revenue += l.driverPay || 0;
    }
    let bestMonth: { revenue: number; label: string } | null = null;
    for (const b of Object.values(monthBuckets)) {
      if (!bestMonth || b.revenue > bestMonth.revenue) {
        bestMonth = {
          revenue: b.revenue,
          label: b.month.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
        };
      }
    }

    // Revenue goal progress (this month only, regardless of selected range)
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthRevenue = loads
      .filter((l) => {
        if (l.status !== "delivered" && l.status !== "archived") return false;
        const ts = l.deliveredAt ?? l.delivery?.date;
        if (!ts) return false;
        return new Date(ts) >= thisMonthStart;
      })
      .reduce((s, l) => s + (l.driverPay || 0), 0);
    const goalPct = monthlyGoal > 0 ? Math.min((thisMonthRevenue / monthlyGoal) * 100, 100) : 0;
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    const projectedRevenue = dayOfMonth > 0 ? (thisMonthRevenue / dayOfMonth) * daysInMonth : 0;

    return {
      avgTurnaroundDays,
      turnaroundCount,
      totalMiles: Math.round(totalMiles),
      costPerMile,
      bestWeek,
      bestMonth,
      thisMonthRevenue,
      goalPct,
      projectedRevenue,
    };
  }, [deliveredLoads, loads, stats.totalRevenue, monthlyGoal]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSelectMonth = useCallback((year: number, month: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedYear(year);
    setSelectedMonth(month);
    setShowMonthPicker(false);
  }, []);

  const handleSaveGoal = useCallback(async () => {
    const val = parseFloat(goalInput.replace(/[^0-9.]/g, ""));
    if (!val || val <= 0) {
      Alert.alert("Invalid Amount", "Please enter a valid dollar amount.");
      return;
    }
    if (!driver?.id) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await updateProfile({ clerkUserId: driver.id, monthlyRevenueGoal: val });
    setShowGoalModal(false);
    setGoalInput("");
  }, [goalInput, driver?.id, updateProfile]);

  const handleClearGoal = useCallback(async () => {
    if (!driver?.id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await updateProfile({ clerkUserId: driver.id, monthlyRevenueGoal: 0 });
    setShowGoalModal(false);
    setGoalInput("");
  }, [driver?.id, updateProfile]);

  // ── Mini bar chart ────────────────────────────────────────────────────────

  const maxBucket = Math.max(...stats.activityBuckets.map((b) => b.value), 1);

  return (
    <ScreenContainer containerClassName="bg-background">
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.primary }]}>
        <View>
          <Text style={styles.headerTitle}>Dashboard</Text>
          <Text style={styles.headerSubtitle}>{driver?.name ?? "Driver"}</Text>
        </View>
        <TouchableOpacity
          style={[styles.rangePill, { backgroundColor: "#FFFFFF22" }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowMonthPicker((v) => !v); }}
          activeOpacity={0.8}
        >
          <IconSymbol name="calendar" size={14} color="#fff" />
          <Text style={styles.rangePillText}>{range.label}</Text>
          <IconSymbol name={showMonthPicker ? "chevron.up" : "chevron.down"} size={12} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* ── Hero Stats ─────────────────────────────────────────────────── */}
        <View style={[styles.heroCard, { backgroundColor: colors.primary }]}>
          <View style={styles.heroRow}>
            {canViewRates && (
              <>
                <View style={styles.heroStat}>
                  <Text style={styles.heroValue}>{fmtDollars(stats.totalRevenue)}</Text>
                  <Text style={styles.heroLabel}>Revenue</Text>
                </View>
                <View style={[styles.heroDivider, { backgroundColor: "#FFFFFF30" }]} />
              </>
            )}
            <View style={styles.heroStat}>
              <Text style={styles.heroValue}>{stats.totalVehicles}</Text>
              <Text style={styles.heroLabel}>Vehicles</Text>
            </View>
            <View style={[styles.heroDivider, { backgroundColor: "#FFFFFF30" }]} />
            <View style={styles.heroStat}>
              <Text style={styles.heroValue}>{stats.totalLoads}</Text>
              <Text style={styles.heroLabel}>Loads</Text>
            </View>
            {!canViewRates && (
              <>
                <View style={[styles.heroDivider, { backgroundColor: "#FFFFFF30" }]} />
                <View style={styles.heroStat}>
                  <Text style={styles.heroValue}>{stats.inTransitVehicles}</Text>
                  <Text style={styles.heroLabel}>In Transit</Text>
                </View>
              </>
            )}
          </View>

          {canViewRates && stats.revenueDelta !== 0 && (
            <View style={styles.deltaRow}>
              <IconSymbol
                name={stats.revenueDelta >= 0 ? "arrow.up.right" : "arrow.down.right"}
                size={12}
                color={stats.revenueDelta >= 0 ? "#A5D6A7" : "#EF9A9A"}
              />
              <Text style={[styles.deltaText, { color: stats.revenueDelta >= 0 ? "#A5D6A7" : "#EF9A9A" }]}>
                {Math.abs(stats.revenueDelta).toFixed(1)}% vs previous period
              </Text>
            </View>
          )}

          {/* Revenue Goal Progress — only when rates visible */}
          {canViewRates && monthlyGoal > 0 && (
            <TouchableOpacity
              style={styles.goalSection}
              onPress={() => { setGoalInput(String(monthlyGoal)); setShowGoalModal(true); }}
              activeOpacity={0.8}
            >
              <View style={styles.goalLabelRow}>
                <Text style={styles.goalLabel}>Monthly Goal</Text>
                <Text style={styles.goalLabel}>
                  {fmtDollars(insights.thisMonthRevenue)} / {fmtDollars(monthlyGoal)}
                </Text>
              </View>
              <View style={styles.goalBarTrack}>
                <View style={[styles.goalBarFill, { width: `${insights.goalPct}%` }]} />
              </View>
              <Text style={styles.goalProjection}>
                {insights.goalPct >= 100
                  ? "Goal reached!"
                  : `${insights.goalPct.toFixed(0)}% — On pace for ${fmtDollars(insights.projectedRevenue)}`}
              </Text>
            </TouchableOpacity>
          )}
          {canViewRates && monthlyGoal === 0 && (
            <TouchableOpacity
              style={styles.goalSetBtn}
              onPress={() => { setGoalInput(""); setShowGoalModal(true); }}
              activeOpacity={0.8}
            >
              <IconSymbol name="target" size={14} color="#FFFFFFCC" />
              <Text style={styles.goalSetText}>Set a monthly revenue goal</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Quick Stats Row ────────────────────────────────────────────── */}
        <View style={styles.quickStatsRow}>
          {canViewRates ? (
            <>
              <View style={[styles.quickCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.quickIcon, { backgroundColor: "#4CAF5018" }]}>
                  <IconSymbol name="dollarsign.circle.fill" size={20} color="#4CAF50" />
                </View>
                <Text style={[styles.quickValue, { color: colors.text }]}>{fmtDollars(stats.netProfit)}</Text>
                <Text style={[styles.quickLabel, { color: colors.muted }]}>Net Profit</Text>
              </View>
              <View style={[styles.quickCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.quickIcon, { backgroundColor: colors.primary + "18" }]}>
                  <IconSymbol name="car.fill" size={20} color={colors.primary} />
                </View>
                <Text style={[styles.quickValue, { color: colors.text }]}>{fmtDollars(stats.avgPerVehicle)}</Text>
                <Text style={[styles.quickLabel, { color: colors.muted }]}>Avg / Vehicle</Text>
              </View>
              <View style={[styles.quickCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.quickIcon, { backgroundColor: "#FF980018" }]}>
                  <IconSymbol name="shippingbox.fill" size={20} color="#FF9800" />
                </View>
                <Text style={[styles.quickValue, { color: colors.text }]}>{stats.inTransitVehicles}</Text>
                <Text style={[styles.quickLabel, { color: colors.muted }]}>In Transit</Text>
              </View>
            </>
          ) : (
            <>
              <View style={[styles.quickCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.quickIcon, { backgroundColor: "#9C27B018" }]}>
                  <IconSymbol name="clock.fill" size={20} color="#9C27B0" />
                </View>
                <Text style={[styles.quickValue, { color: colors.text }]}>
                  {insights.turnaroundCount > 0
                    ? insights.avgTurnaroundDays < 1
                      ? `${Math.round(insights.avgTurnaroundDays * 24)}h`
                      : `${insights.avgTurnaroundDays.toFixed(1)}d`
                    : "—"}
                </Text>
                <Text style={[styles.quickLabel, { color: colors.muted }]}>Avg Turnaround</Text>
              </View>
              <View style={[styles.quickCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.quickIcon, { backgroundColor: "#00897B18" }]}>
                  <IconSymbol name="road.lanes" size={20} color="#00897B" />
                </View>
                <Text style={[styles.quickValue, { color: colors.text }]}>
                  {insights.totalMiles > 0 ? fmtCompact(insights.totalMiles) : "—"}
                </Text>
                <Text style={[styles.quickLabel, { color: colors.muted }]}>Miles (est.)</Text>
              </View>
              <View style={[styles.quickCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.quickIcon, { backgroundColor: "#FF980018" }]}>
                  <IconSymbol name="shippingbox.fill" size={20} color="#FF9800" />
                </View>
                <Text style={[styles.quickValue, { color: colors.text }]}>{stats.inTransitVehicles}</Text>
                <Text style={[styles.quickLabel, { color: colors.muted }]}>In Transit</Text>
              </View>
            </>
          )}
        </View>

        {/* ── Insights Row — only when rates visible ────────────────────── */}
        {canViewRates && (
          <View style={styles.insightsRow}>
            <View style={[styles.insightCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <IconSymbol name="clock.fill" size={18} color="#9C27B0" />
              <Text style={[styles.insightValue, { color: colors.text }]}>
                {insights.turnaroundCount > 0
                  ? insights.avgTurnaroundDays < 1
                    ? `${Math.round(insights.avgTurnaroundDays * 24)}h`
                    : `${insights.avgTurnaroundDays.toFixed(1)}d`
                  : "—"}
              </Text>
              <Text style={[styles.insightLabel, { color: colors.muted }]}>Avg Turnaround</Text>
            </View>
            <View style={[styles.insightCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <IconSymbol name="road.lanes" size={18} color="#00897B" />
              <Text style={[styles.insightValue, { color: colors.text }]}>
                {insights.totalMiles > 0 ? fmtCompact(insights.totalMiles) : "—"}
              </Text>
              <Text style={[styles.insightLabel, { color: colors.muted }]}>Miles (est.)</Text>
            </View>
            <View style={[styles.insightCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <IconSymbol name="gauge.with.needle.fill" size={18} color="#E65100" />
              <Text style={[styles.insightValue, { color: colors.text }]}>
                {insights.costPerMile > 0 ? `$${insights.costPerMile.toFixed(2)}` : "—"}
              </Text>
              <Text style={[styles.insightLabel, { color: colors.muted }]}>Rev / Mile</Text>
            </View>
          </View>
        )}

        {/* ── Best Period Highlights — only when rates visible ────────────── */}
        {canViewRates && (insights.bestWeek || insights.bestMonth) && (
          <View style={[styles.bestPeriodCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.bestPeriodHeader}>
              <IconSymbol name="trophy.fill" size={16} color="#FFB300" />
              <Text style={[styles.bestPeriodTitle, { color: colors.text }]}>Personal Bests</Text>
            </View>
            {insights.bestWeek && insights.bestWeek.revenue > 0 && (
              <View style={styles.bestPeriodRow}>
                <Text style={[styles.bestPeriodLabel, { color: colors.muted }]}>Best Week</Text>
                <View style={styles.bestPeriodRight}>
                  <Text style={[styles.bestPeriodValue, { color: "#4CAF50" }]}>
                    {fmtDollars(insights.bestWeek.revenue)}
                  </Text>
                  <Text style={[styles.bestPeriodDate, { color: colors.muted }]}>
                    {insights.bestWeek.label}
                  </Text>
                </View>
              </View>
            )}
            {insights.bestMonth && insights.bestMonth.revenue > 0 && (
              <View style={styles.bestPeriodRow}>
                <Text style={[styles.bestPeriodLabel, { color: colors.muted }]}>Best Month</Text>
                <View style={styles.bestPeriodRight}>
                  <Text style={[styles.bestPeriodValue, { color: "#4CAF50" }]}>
                    {fmtDollars(insights.bestMonth.revenue)}
                  </Text>
                  <Text style={[styles.bestPeriodDate, { color: colors.muted }]}>
                    {insights.bestMonth.label}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* ── Activity Chart ─────────────────────────────────────────────── */}
        <View style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.chartHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.chartTitle, { color: colors.text }]}>Delivery Activity</Text>
              <Text style={[styles.chartSubtitle, { color: colors.muted }]}>
                {chartGranularity === "day"
                  ? "Vehicles per day (last 7 days)"
                  : chartGranularity === "week"
                    ? "Vehicles per week (last 6 weeks)"
                    : "Vehicles per month (last 6 months)"}
              </Text>
            </View>
          </View>
          {/* Granularity toggle */}
          <View style={[styles.granularityRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
            {(["day", "week", "month"] as ChartGranularity[]).map((g) => (
              <TouchableOpacity
                key={g}
                style={[
                  styles.granularityBtn,
                  chartGranularity === g && { backgroundColor: colors.primary },
                ]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setChartGranularity(g); }}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.granularityText,
                    { color: chartGranularity === g ? "#fff" : colors.muted },
                  ]}
                >
                  {g === "day" ? "Day" : g === "week" ? "Week" : "Month"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.chartBars}>
            {stats.activityBuckets.map((b, i) => {
              const heightPct = maxBucket > 0 ? (b.value / maxBucket) * 100 : 0;
              return (
                <View key={i} style={styles.chartBarCol}>
                  <View style={styles.chartBarTrack}>
                    {b.value > 0 && (
                      <Text style={[styles.chartBarValue, { color: colors.primary }]}>{b.value}</Text>
                    )}
                    <View
                      style={[
                        styles.chartBar,
                        {
                          height: `${Math.max(heightPct, 4)}%`,
                          backgroundColor: b.value > 0 ? colors.primary : colors.border,
                          borderRadius: 4,
                        },
                      ]}
                    />
                  </View>
                  <Text style={[styles.chartBarLabel, { color: colors.muted }]}>{b.label}</Text>
                </View>
              );
            })}
          </View>
        </View>


        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Month Picker Modal ───────────────────────────────────────────────── */}
      <Modal visible={showMonthPicker} transparent animationType="fade" onRequestClose={() => setShowMonthPicker(false)}>
        <View style={{ flex: 1 }}>
          <Pressable style={styles.monthPickerBackdrop} onPress={() => setShowMonthPicker(false)} />
          <View style={[styles.monthPickerDropdown, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <ScrollView bounces={false} showsVerticalScrollIndicator={false} style={{ maxHeight: 300 }}>
              {monthOptions.map((opt) => {
                const isActive = opt.year === selectedYear && opt.month === selectedMonth;
                return (
                  <TouchableOpacity
                    key={`${opt.year}-${opt.month}`}
                    style={[styles.monthPickerRow, isActive && { backgroundColor: colors.primary + "12" }]}
                    onPress={() => handleSelectMonth(opt.year, opt.month)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.monthPickerRowText, { color: isActive ? colors.primary : colors.text, fontWeight: isActive ? "700" : "500" }]}>
                      {opt.label}
                    </Text>
                    {isActive && <IconSymbol name="checkmark" size={16} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Goal Setting Modal — drops from top to avoid keyboard ────────────── */}
      <Modal visible={canViewRates && showGoalModal} transparent animationType="fade" onRequestClose={() => setShowGoalModal(false)}>
        <View style={{ flex: 1 }}>
          <Pressable style={styles.monthPickerBackdrop} onPress={() => setShowGoalModal(false)} />
          <View style={[styles.goalDropdown, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.pickerTitle, { color: colors.text }]}>Monthly Revenue Goal</Text>
            <Text style={[styles.goalModalSub, { color: colors.muted }]}>
              Set a target to track your progress throughout the month.
            </Text>
            <View style={[styles.goalInputRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <Text style={[styles.goalInputPrefix, { color: colors.muted }]}>$</Text>
              <TextInput
                style={[styles.goalInputField, { color: colors.text }]}
                value={goalInput}
                onChangeText={setGoalInput}
                placeholder="e.g. 12000"
                placeholderTextColor={colors.muted}
                keyboardType="numeric"
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleSaveGoal}
              />
            </View>
            <TouchableOpacity
              style={[styles.goalSaveBtn, { backgroundColor: colors.primary }]}
              onPress={handleSaveGoal}
              activeOpacity={0.85}
            >
              <Text style={styles.goalSaveBtnText}>Save Goal</Text>
            </TouchableOpacity>
            {monthlyGoal > 0 && (
              <TouchableOpacity style={styles.goalClearBtn} onPress={handleClearGoal} activeOpacity={0.7}>
                <Text style={[styles.goalClearText, { color: colors.error }]}>Remove Goal</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  headerSubtitle: {
    fontSize: 13,
    color: "#FFFFFFAA",
    marginTop: 2,
  },
  rangePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  rangePillText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
  monthPickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  monthPickerDropdown: {
    position: "absolute",
    top: 100,
    right: 16,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    width: 220,
    overflow: "hidden",
  },
  monthPickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  monthPickerRowText: {
    fontSize: 15,
  },
  scrollContent: {
    paddingBottom: 20,
  },

  // Hero
  heroCard: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 16,
    padding: 20,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  heroStat: {
    flex: 1,
    alignItems: "center",
  },
  heroValue: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  heroLabel: {
    fontSize: 12,
    color: "#FFFFFFAA",
    marginTop: 4,
    fontWeight: "500",
  },
  heroDivider: {
    width: 1,
    height: 36,
  },
  deltaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#FFFFFF20",
  },
  deltaText: {
    fontSize: 12,
    fontWeight: "600",
  },

  // Goal
  goalSection: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#FFFFFF20",
  },
  goalLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  goalLabel: {
    fontSize: 12,
    color: "#FFFFFFBB",
    fontWeight: "500",
  },
  goalBarTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FFFFFF25",
    overflow: "hidden",
  },
  goalBarFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "#A5D6A7",
  },
  goalProjection: {
    fontSize: 11,
    color: "#FFFFFF99",
    marginTop: 6,
    textAlign: "center",
    fontWeight: "500",
  },
  goalSetBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#FFFFFF20",
  },
  goalSetText: {
    fontSize: 13,
    color: "#FFFFFFCC",
    fontWeight: "500",
  },

  // Insights Row
  insightsRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  insightCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 6,
    alignItems: "center",
    gap: 4,
  },
  insightValue: {
    fontSize: 15,
    fontWeight: "800",
    textAlign: "center",
  },
  insightLabel: {
    fontSize: 10,
    fontWeight: "500",
    textAlign: "center",
  },

  // Best Period
  bestPeriodCard: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  bestPeriodHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  bestPeriodTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  bestPeriodRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  bestPeriodLabel: {
    fontSize: 13,
  },
  bestPeriodRight: {
    alignItems: "flex-end",
  },
  bestPeriodValue: {
    fontSize: 15,
    fontWeight: "800",
  },
  bestPeriodDate: {
    fontSize: 11,
    marginTop: 1,
  },

  // Goal Modal
  goalDropdown: {
    position: "absolute",
    top: 100,
    left: 16,
    right: 16,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  goalModalSub: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  goalInputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 52,
    marginBottom: 16,
  },
  goalInputPrefix: {
    fontSize: 20,
    fontWeight: "700",
    marginRight: 4,
  },
  goalInputField: {
    flex: 1,
    fontSize: 20,
    fontWeight: "700",
  },
  goalSaveBtn: {
    height: 50,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  goalSaveBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  goalClearBtn: {
    alignItems: "center",
    paddingVertical: 12,
  },
  goalClearText: {
    fontSize: 14,
    fontWeight: "500",
  },

  // Quick Stats
  quickStatsRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 14,
  },
  quickCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: "center",
    gap: 6,
  },
  quickIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  quickValue: {
    fontSize: 15,
    fontWeight: "800",
    textAlign: "center",
  },
  quickLabel: {
    fontSize: 10,
    fontWeight: "500",
    textAlign: "center",
  },

  // Chart
  chartCard: {
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  chartHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  chartTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  chartSubtitle: {
    fontSize: 12,
    marginTop: 2,
    marginBottom: 12,
  },
  granularityRow: {
    flexDirection: "row",
    borderRadius: 8,
    borderWidth: 1,
    padding: 3,
    marginBottom: 14,
  },
  granularityBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 6,
    borderRadius: 6,
  },
  granularityText: {
    fontSize: 12,
    fontWeight: "600",
  },
  chartBars: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: 100,
    gap: 6,
  },
  chartBarCol: {
    flex: 1,
    alignItems: "center",
  },
  chartBarTrack: {
    width: "100%",
    height: 80,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  chartBar: {
    width: "70%",
    minHeight: 3,
  },
  chartBarValue: {
    fontSize: 10,
    fontWeight: "700",
    marginBottom: 3,
  },
  chartBarLabel: {
    fontSize: 10,
    marginTop: 6,
    fontWeight: "500",
  },

  // Shared bottom-sheet modal
  sheetWrapper: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
  },
  sheetContainer: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
    paddingTop: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 20,
  },
  pickerHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  pickerTitle: {
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 16,
  },
});
