import { useState, useEffect } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";
import { makeStyles } from "../../../src/lib/makeStyles";
import { useColors } from "../../../src/contexts/ThemeContext";
import { PressableRow, Logo } from "../../../src/components/ui";
import { useBusinessStore } from "../../../src/stores/business";
import { useBusinessSwitcherContext } from "../../../src/contexts/BusinessSwitcherContext";

/* ── Menu items ──────────────────────────────────────────────── */

interface MenuItem {
  label: string;
  icon: string;
  route: string;
  group: "Sales" | "Money" | "Stock & orders" | "Tax & reports";
}

const ALL_ITEMS: MenuItem[] = [
  { label: "Quotations", icon: "document-text-outline", route: "/(more)/quotations", group: "Sales" },
  { label: "Proforma invoices", icon: "document-attach-outline", route: "/(more)/proforma-invoices", group: "Sales" },
  { label: "Delivery challans", icon: "car-outline", route: "/(more)/delivery-challans", group: "Sales" },
  { label: "Credit notes", icon: "return-down-back-outline", route: "/(more)/credit-notes", group: "Sales" },
  { label: "Sales returns", icon: "return-up-back-outline", route: "/(more)/sales-returns", group: "Sales" },
  { label: "Recurring invoices", icon: "repeat-outline", route: "/(more)/automated-invoices", group: "Sales" },
  { label: "Expenses", icon: "wallet-outline", route: "/(more)/expenses", group: "Money" },
  { label: "Cash & bank", icon: "business-outline", route: "/(more)/bank", group: "Money" },
  { label: "Stock items", icon: "cube-outline", route: "/(items)", group: "Stock & orders" },
  { label: "Goods receipts", icon: "download-outline", route: "/(more)/goods-receipts", group: "Stock & orders" },
  { label: "Store orders", icon: "bag-handle-outline", route: "/(more)/store-orders", group: "Stock & orders" },
  { label: "Shipments", icon: "boat-outline", route: "/(more)/shipments", group: "Stock & orders" },
  { label: "GST returns", icon: "pie-chart-outline", route: "/(more)/gst", group: "Tax & reports" },
  { label: "Business reports", icon: "bar-chart-outline", route: "/(more)/reports", group: "Tax & reports" },
  { label: "Settings", icon: "settings-outline", route: "/(more)/settings", group: "Tax & reports" },
];

const GROUPS: MenuItem["group"][] = ["Sales", "Money", "Stock & orders", "Tax & reports"];

const RECENT_KEY = "fintranzact_recent_more";
const MAX_RECENT = 4;

/* ── Recent tracking ─────────────────────────────────────────── */

async function getRecent(): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function trackRecent(route: string) {
  try {
    const recent = await getRecent();
    const updated = [route, ...recent.filter((r) => r !== route)].slice(0, MAX_RECENT);
    await SecureStore.setItemAsync(RECENT_KEY, JSON.stringify(updated));
  } catch { /* non-fatal */ }
}

/* ── Screen ──────────────────────────────────────────────────── */

export default function MoreScreen() {
  const s = useS();
  const colors = useColors();
  const router = useRouter();
  const businessName = useBusinessStore((st) => st.businessName);
  const { openSwitcher } = useBusinessSwitcherContext();
  const [recentRoutes, setRecentRoutes] = useState<string[]>([]);

  useEffect(() => {
    getRecent().then(setRecentRoutes);
  }, []);

  function handlePress(item: MenuItem) {
    trackRecent(item.route);
    setRecentRoutes((prev) => [item.route, ...prev.filter((r) => r !== item.route)].slice(0, MAX_RECENT));
    router.push(item.route as any);
  }

  const recentItems = recentRoutes
    .map((route) => ALL_ITEMS.find((i) => i.route === route))
    .filter((i): i is MenuItem => !!i);

  const initials = (businessName || "My Business")
    .split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <View style={s.header}>
        <Text style={s.title}>More</Text>
        <Logo size={32} />
      </View>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* Active business */}
        <View style={s.bizCard}>
          <View style={s.bizAvatar}>
            <Text style={s.bizAvatarText}>{initials}</Text>
          </View>
          <View style={s.bizText}>
            <Text style={s.bizName} numberOfLines={1}>{businessName || "My Business"}</Text>
            <Text style={s.bizSub} numberOfLines={1}>Active business</Text>
          </View>
          <PressableRow
            style={s.bizSwitch}
            onPress={openSwitcher}
          >
            <Ionicons name="swap-horizontal" size={18} color={colors.heroText} accessibilityLabel="Switch business" />
          </PressableRow>
        </View>

        {recentItems.length > 0 && (
          <MenuGroup title="Recent" items={recentItems} onPress={handlePress} />
        )}

        {GROUPS.map((g) => (
          <MenuGroup key={g} title={g} items={ALL_ITEMS.filter((i) => i.group === g)} onPress={handlePress} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ── Group of rows ───────────────────────────────────────────── */

function MenuGroup({ title, items, onPress }: { title: string; items: MenuItem[]; onPress: (i: MenuItem) => void }) {
  const s = useS();
  const colors = useColors();
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title.toUpperCase()}</Text>
      <View style={s.group}>
        {items.map((item, i) => (
          <PressableRow key={item.route} style={[s.row, i > 0 && s.rowBorder]} onPress={() => onPress(item)}>
            <View style={s.iconWrap}>
              <Ionicons name={item.icon as never} size={18} color={colors.brand} />
            </View>
            <Text style={s.label} numberOfLines={1}>{item.label}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </PressableRow>
        ))}
      </View>
    </View>
  );
}

/* ── Styles ──────────────────────────────────────────────────── */

const useS = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12,
  },
  title: { fontSize: 28, fontWeight: "800", color: colors.textPrimary, letterSpacing: -0.6 },
  content: { paddingHorizontal: 20, paddingBottom: 24, gap: 20 },
  bizCard: {
    flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 22,
    backgroundColor: colors.hero, borderWidth: 1, borderColor: colors.heroBorder,
    shadowColor: "#0f1b3d", shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.25, shadowRadius: 20, elevation: 5,
  },
  bizAvatar: {
    width: 48, height: 48, borderRadius: 15, backgroundColor: "#ffffff",
    alignItems: "center", justifyContent: "center",
  },
  bizAvatarText: { fontSize: 16, fontWeight: "800", color: "#0f1b3d" },
  bizText: { flex: 1, gap: 3 },
  bizName: { fontSize: 16, fontWeight: "700", color: colors.heroText },
  bizSub: { fontSize: 13, color: colors.heroMuted },
  bizSwitch: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: colors.heroChip,
    alignItems: "center", justifyContent: "center",
  },
  section: { gap: 8 },
  sectionTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.7, color: colors.textMuted, paddingLeft: 4 },
  group: { backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 11, minHeight: 56 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  iconWrap: {
    width: 34, height: 34, borderRadius: 11, backgroundColor: colors.brandLight,
    alignItems: "center", justifyContent: "center",
  },
  label: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.textPrimary },
}));
