import { View, Text, ScrollView, RefreshControl, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState, useMemo, useEffect } from "react";
import { trpc } from "../../../src/lib/trpc";
import { useBusinessStore } from "../../../src/stores/business";
import { useBiometricStore } from "../../../src/stores/biometric";
import { useBusinessSwitcherContext } from "../../../src/contexts/BusinessSwitcherContext";
import { formatCurrency, formatDate } from "../../../src/lib/utils";

/** Whole-number currency for summary cards — paise are noise at this level */
function formatSummary(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "\u20B90";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}
import { makeStyles } from "../../../src/lib/makeStyles";
import { useColors } from "../../../src/contexts/ThemeContext";
import { StatusBadge, Skeleton, QueryError } from "../../../src/components/ui";
import type { Colors } from "../../../src/lib/theme";
import { BiometricSetupPrompt } from "../../../src/components/BiometricSetupPrompt";

/* ── Period helpers ──────────────────────────────────────────── */
// CRITICAL: Use Date.UTC() instead of new Date(y,m,d) to avoid IST timezone
// shifting. In IST (UTC+5:30), new Date(2025,3,1).toISOString() produces
// "2025-03-31T18:30:00Z" — March 31 UTC, not April 1. Aligned with web's
// useDateRange hook.

type Period = "month" | "quarter" | "fy" | "all";

const PERIODS: { key: Period; label: string; badge: string }[] = [
  { key: "month", label: "This month", badge: "This month" },
  { key: "quarter", label: "Quarter", badge: "This quarter" },
  { key: "fy", label: "This FY", badge: "This FY" },
  { key: "all", label: "All time", badge: "All time" },
];

function utcDate(y: number, m: number, d: number, h = 0, min = 0, s = 0): string {
  return new Date(Date.UTC(y, m, d, h, min, s)).toISOString();
}

function getPeriodDates(period: Period): { fromDate?: string; toDate?: string } {
  if (period === "all") return {};
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = now.getUTCMonth();
  const toDate = now.toISOString();
  if (period === "month") {
    return { fromDate: utcDate(yyyy, mm, 1), toDate };
  }
  if (period === "quarter") {
    const q = Math.floor(mm / 3);
    return { fromDate: utcDate(yyyy, q * 3, 1), toDate };
  }
  // Indian FY: April (month 3) to March
  const fyYear = mm >= 3 ? yyyy : yyyy - 1;
  return { fromDate: utcDate(fyYear, 3, 1), toDate };
}

/* ── Dashboard ──────────────────────────────────────────────── */

function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

const QUICK_ACTIONS: { label: string; icon: keyof typeof Ionicons.glyphMap; href: string }[] = [
  { label: "New invoice", icon: "receipt-outline", href: "/(invoices)/create" },
  { label: "Receive", icon: "arrow-down-outline", href: "/(payments)/create" },
  { label: "Expense", icon: "wallet-outline", href: "/(more)/expenses/create" },
  { label: "Quotation", icon: "document-text-outline", href: "/(more)/quotations/create" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function DashboardScreen() {
  const s = useS();
  const colors = useColors();
  const router = useRouter();
  const businessName = useBusinessStore((s) => s.businessName);
  const businessId = useBusinessStore((s) => s.businessId);
  const { openSwitcher } = useBusinessSwitcherContext();
  const [period, setPeriod] = useState<Period>("month");
  const dates = useMemo(() => getPeriodDates(period), [period]);

  // Biometric setup prompt — shows once after first login
  const setupPrompted = useBiometricStore((s) => s.setupPrompted);
  const biometricEnabled = useBiometricStore((s) => s.biometricEnabled);
  const pinEnabled = useBiometricStore((s) => s.pinEnabled);
  const [showSetupPrompt, setShowSetupPrompt] = useState(false);

  // Show setup prompt once if user hasn't been prompted and has no security set up
  useEffect(() => {
    if (!setupPrompted && !biometricEnabled && !pinEnabled) {
      // Slight delay so the dashboard feels loaded first
      const timer = setTimeout(() => setShowSetupPrompt(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [setupPrompted, biometricEnabled, pinEnabled]);

  const { data: me } = trpc.auth.me.useQuery(undefined);
  const firstName = me?.user?.name?.split(" ")[0];

  const { data: summary, refetch, isRefetching, isError: summaryError } = trpc.dashboard.summary.useQuery(
    dates.fromDate ? { fromDate: dates.fromDate, toDate: dates.toDate } : undefined,
    { enabled: !!businessId },
  );

  const { data: recentInvoices, isError: invoicesError, refetch: refetchInvoices } = trpc.invoice.list.useQuery(
    { page: 1, limit: 5, documentType: "invoice" },
    { enabled: !!businessId },
  );

  // Both need the Reports permission; the sections hide when it is missing.
  const { data: trend } = trpc.dashboard.salesTrend.useQuery(
    { months: 6, granularity: "month" },
    { enabled: !!businessId, retry: false },
  );
  const { data: statusBreakdown } = trpc.dashboard.invoiceStatusBreakdown.useQuery(
    {},
    { enabled: !!businessId, retry: false },
  );
  const overdue = statusBreakdown?.find((r) => r.status === "overdue");

  const bars = useMemo(() => {
    if (!trend || trend.length === 0) return null;
    const rows = trend.slice(-6).map((r) => ({
      label: MONTHS[new Date(r.period).getUTCMonth()] ?? "",
      invoiced: parseFloat(r.invoiced) || 0,
      collected: parseFloat(r.collected) || 0,
    }));
    const max = Math.max(1, ...rows.map((r) => Math.max(r.invoiced, r.collected)));
    return rows.map((r) => ({ ...r, invoicedH: (r.invoiced / max) * 110, collectedH: (r.collected / max) * 110 }));
  }, [trend]);

  const onRefresh = () => {
    refetch();
    refetchInvoices();
  };

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={colors.brand} colors={[colors.brand]} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header: business switcher */}
        <TouchableOpacity
          style={s.header}
          onPress={openSwitcher}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Switch business"
        >
          <View style={s.bizAvatar}>
            <Text style={s.bizAvatarText}>{initialsOf(businessName || "My Business")}</Text>
          </View>
          <View style={s.headerText}>
            <Text style={s.greeting} numberOfLines={1}>
              {greetingFor(new Date())}{firstName ? `, ${firstName}` : ""}
            </Text>
            <View style={s.businessNameRow}>
              <Text style={s.businessName} numberOfLines={1}>{businessName || "My Business"}</Text>
              <Ionicons name="chevron-down" size={16} color={colors.textPrimary} />
            </View>
          </View>
        </TouchableOpacity>

        {/* Period segmented control */}
        <View style={s.segment} accessibilityRole="tablist">
          {PERIODS.map((p) => {
            const active = period === p.key;
            return (
              <TouchableOpacity
                key={p.key}
                style={[s.segmentItem, active && s.segmentItemActive]}
                onPress={() => !active && setPeriod(p.key)}
                activeOpacity={0.7}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Text style={[s.segmentText, active && s.segmentTextActive]} numberOfLines={1}>{p.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Navy highlight card */}
        {summaryError ? (
          <QueryError message="Could not load summary" onRetry={refetch} />
        ) : summary ? (
          <TouchableOpacity
            style={s.hero}
            activeOpacity={0.9}
            onPress={() => router.push({ pathname: "/(invoices)", params: { type: "sale", status: "unpaid" } })}
          >
            <View style={s.heroRing} pointerEvents="none" />
            <View style={s.heroTop}>
              <View style={s.heroMain}>
                <Text style={s.heroLabel}>TO COLLECT</Text>
                <Text style={s.heroValue} numberOfLines={1} adjustsFontSizeToFit>{formatSummary(summary.receivable)}</Text>
              </View>
              <View style={s.heroBadge}>
                <Text style={s.heroBadgeText}>{PERIODS.find((p) => p.key === period)?.badge}</Text>
              </View>
            </View>
            <View style={s.heroTiles}>
              <HeroTile label="Sales" value={formatSummary(summary.totalSales)} />
              <HeroTile label="To pay" value={formatSummary(summary.payable)} />
              <HeroTile label="Expenses" value={formatSummary(summary.totalExpenses)} />
            </View>
          </TouchableOpacity>
        ) : (
          <Skeleton width="100%" height={180} borderRadius={24} />
        )}

        {/* Overdue nudge */}
        {overdue && overdue.count > 0 ? (
          <TouchableOpacity
            style={s.alert}
            onPress={() => router.push({ pathname: "/(invoices)", params: { type: "sale", status: "overdue" } })}
            activeOpacity={0.8}
          >
            <View style={s.alertIcon}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
            </View>
            <View style={s.alertText}>
              <Text style={s.alertTitle}>
                {overdue.count} invoice{overdue.count === 1 ? "" : "s"} overdue
              </Text>
              <Text style={s.alertSub} numberOfLines={1}>{formatSummary(overdue.total ?? "0")} past the due date</Text>
            </View>
            <Text style={s.alertAction}>Review</Text>
          </TouchableOpacity>
        ) : null}

        {/* Quick actions */}
        <View style={s.actions}>
          {QUICK_ACTIONS.map((a) => (
            <TouchableOpacity
              key={a.label}
              style={s.action}
              onPress={() => router.push(a.href as never)}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <View style={s.actionIcon}>
                <Ionicons name={a.icon} size={22} color={colors.brand} />
              </View>
              <Text style={s.actionLabel} numberOfLines={1}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Money at a glance */}
        {summary ? (
          <View style={s.miniRow}>
            <MiniCard label="Purchases" value={formatSummary(summary.totalPurchases)} icon="cart-outline" color={colors.info}
              onPress={() => router.push({ pathname: "/(invoices)", params: { type: "purchase" } })} />
            <MiniCard label="Cash in hand" value={formatSummary(summary.cashInHand)} icon="cash-outline" color={colors.success}
              onPress={() => router.push("/(more)/bank")} />
          </View>
        ) : null}

        {/* Sales & collections */}
        {bars ? (
          <View style={s.card}>
            <View style={s.cardHead}>
              <Text style={s.cardTitle}>Sales &amp; collections</Text>
              <Text style={s.cardHint}>Last 6 months</Text>
            </View>
            <View style={s.chart}>
              {bars.map((b) => (
                <View key={b.label} style={s.chartCol}>
                  <View style={s.chartBars}>
                    <View style={[s.bar, { height: Math.max(2, b.invoicedH), backgroundColor: colors.brand }]} />
                    <View style={[s.bar, { height: Math.max(2, b.collectedH), backgroundColor: colors.amber }]} />
                  </View>
                  <Text style={s.chartLabel}>{b.label}</Text>
                </View>
              ))}
            </View>
            <View style={s.legend}>
              <Legend color={colors.brand} label="Invoiced" />
              <Legend color={colors.amber} label="Collected" />
            </View>
          </View>
        ) : null}

        {/* Recent invoices */}
        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>Recent invoices</Text>
          <TouchableOpacity onPress={() => router.push("/(invoices)")} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={s.seeAll}>See all</Text>
          </TouchableOpacity>
        </View>
        {invoicesError ? (
          <QueryError message="Could not load invoices" onRetry={refetchInvoices} />
        ) : recentInvoices?.data && recentInvoices.data.length > 0 ? (
          <View style={s.list}>
            {recentInvoices.data.map((inv, i) => (
              <TouchableOpacity
                key={inv.id}
                style={[s.row, i > 0 && s.rowBorder]}
                onPress={() => router.push({ pathname: "/(invoices)/[id]", params: { id: inv.id } })}
                activeOpacity={0.7}
              >
                <View style={s.rowAvatar}>
                  <Text style={s.rowAvatarText}>{initialsOf(inv.partyName ?? "")}</Text>
                </View>
                <View style={s.rowMain}>
                  <Text style={s.rowTitle} numberOfLines={1}>{inv.partyName}</Text>
                  <Text style={s.rowSub} numberOfLines={1}>{inv.invoiceNumber} · {formatDate(inv.invoiceDate)}</Text>
                </View>
                <View style={s.rowRight}>
                  <Text style={s.rowAmount} numberOfLines={1}>{formatCurrency(inv.totalAmount)}</Text>
                  <StatusBadge status={inv.status} />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ) : recentInvoices ? (
          <View style={s.emptyCard}>
            <Ionicons name="receipt-outline" size={28} color={colors.brand} />
            <Text style={s.emptyText}>No invoices yet</Text>
            <Text style={s.emptyHint}>Create your first invoice to see it here</Text>
          </View>
        ) : (
          <Skeleton width="100%" height={120} borderRadius={20} />
        )}
      </ScrollView>

      {/* Biometric setup prompt — shown once after first login */}
      <BiometricSetupPrompt
        visible={showSetupPrompt}
        onDismiss={() => setShowSetupPrompt(false)}
      />
    </SafeAreaView>
  );
}

/* ── Pieces ─────────────────────────────────────────────────── */

function HeroTile({ label, value }: { label: string; value: string }) {
  const s = useS();
  return (
    <View style={s.heroTile}>
      <Text style={s.heroTileLabel} numberOfLines={1}>{label}</Text>
      <Text style={s.heroTileValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

function MiniCard({ label, value, icon, color, onPress }: {
  label: string; value: string; icon: keyof typeof Ionicons.glyphMap; color: string; onPress: () => void;
}) {
  const s = useS();
  return (
    <TouchableOpacity style={s.mini} onPress={onPress} activeOpacity={0.8}>
      <View style={[s.miniIcon, { backgroundColor: color + "22" }]}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <View style={s.miniText}>
        <Text style={s.miniLabel} numberOfLines={1}>{label}</Text>
        <Text style={s.miniValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      </View>
    </TouchableOpacity>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const s = useS();
  return (
    <View style={s.legendItem}>
      <View style={[s.legendSwatch, { backgroundColor: color }]} />
      <Text style={s.legendText}>{label}</Text>
    </View>
  );
}

/* ── Styles ──────────────────────────────────────────────────── */

const useS = makeStyles((colors: Colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28, gap: 18 },

  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  bizAvatar: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: colors.hero,
    borderWidth: 1, borderColor: colors.heroBorder, alignItems: "center", justifyContent: "center",
  },
  bizAvatarText: { color: colors.heroText, fontSize: 15, fontWeight: "800" },
  headerText: { flex: 1, gap: 2 },
  greeting: { fontSize: 13, color: colors.textMuted },
  businessNameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  businessName: { flexShrink: 1, fontSize: 17, fontWeight: "700", color: colors.textPrimary, letterSpacing: -0.2 },

  segment: { flexDirection: "row", padding: 4, gap: 4, borderRadius: 14, backgroundColor: colors.surfaceHover },
  segmentItem: { flex: 1, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  segmentItemActive: {
    backgroundColor: colors.surface,
    shadowColor: "#0f1b3d", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 6, elevation: 2,
  },
  segmentText: { fontSize: 13, fontWeight: "600", color: colors.textMuted },
  segmentTextActive: { color: colors.textPrimary },

  hero: {
    backgroundColor: colors.hero, borderRadius: 24, borderWidth: 1, borderColor: colors.heroBorder,
    padding: 22, gap: 18, overflow: "hidden",
    shadowColor: "#0f1b3d", shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.3, shadowRadius: 24, elevation: 6,
  },
  heroRing: {
    position: "absolute", right: -70, bottom: -90, width: 220, height: 220,
    borderRadius: 110, borderWidth: 1, borderColor: colors.heroChip,
  },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  heroMain: { flex: 1, gap: 6 },
  heroLabel: { fontSize: 13, fontWeight: "600", letterSpacing: 0.6, color: colors.heroMuted },
  heroValue: { fontSize: 34, fontWeight: "800", letterSpacing: -1, color: colors.heroText },
  heroBadge: { backgroundColor: colors.heroChip, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  heroBadgeText: { fontSize: 12, fontWeight: "700", color: colors.heroText },
  heroTiles: { flexDirection: "row", gap: 8 },
  heroTile: { flex: 1, backgroundColor: colors.heroChip, borderRadius: 14, padding: 12, gap: 4 },
  heroTileLabel: { fontSize: 12, color: colors.heroMuted },
  heroTileValue: { fontSize: 15, fontWeight: "700", color: colors.heroText },

  alert: {
    flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16,
    backgroundColor: colors.warningBg,
  },
  alertIcon: {
    width: 36, height: 36, borderRadius: 11, backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center",
  },
  alertText: { flex: 1, gap: 2 },
  alertTitle: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  alertSub: { fontSize: 13, color: colors.textSecondary },
  alertAction: { fontSize: 13, fontWeight: "700", color: colors.warning },

  actions: { flexDirection: "row", justifyContent: "space-between" },
  action: { width: "23%", alignItems: "center", gap: 8 },
  actionIcon: {
    width: 56, height: 56, borderRadius: 18, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center",
  },
  actionLabel: { fontSize: 12, fontWeight: "600", color: colors.textPrimary },

  miniRow: { flexDirection: "row", gap: 10 },
  mini: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 10, padding: 12,
    backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
  },
  miniIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  miniText: { flex: 1, gap: 2 },
  miniLabel: { fontSize: 12, color: colors.textMuted },
  miniValue: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },

  card: { backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 18, gap: 14 },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  cardHint: { fontSize: 12, color: colors.textMuted },
  chart: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end",
    height: 136, borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: 2,
  },
  chartCol: { alignItems: "center", gap: 6, marginBottom: -22 },
  chartBars: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 112 },
  bar: { width: 12, borderTopLeftRadius: 5, borderTopRightRadius: 5, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  chartLabel: { fontSize: 12, color: colors.textMuted, marginTop: 6 },
  legend: { flexDirection: "row", gap: 16, marginTop: 16 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendSwatch: { width: 10, height: 10, borderRadius: 3 },
  legendText: { fontSize: 13, color: colors.textMuted },

  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: -8 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  seeAll: { fontSize: 14, fontWeight: "700", color: colors.brand },
  list: { backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowAvatar: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: colors.brandLight,
    alignItems: "center", justifyContent: "center",
  },
  rowAvatarText: { fontSize: 14, fontWeight: "700", color: colors.brand },
  rowMain: { flex: 1, gap: 3 },
  rowTitle: { fontSize: 15, fontWeight: "600", color: colors.textPrimary },
  rowSub: { fontSize: 13, color: colors.textMuted },
  rowRight: { alignItems: "flex-end", gap: 5 },
  rowAmount: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  emptyCard: {
    backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border,
    padding: 28, alignItems: "center", gap: 8,
  },
  emptyText: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  emptyHint: { fontSize: 13, color: colors.textMuted, textAlign: "center" },
}));
