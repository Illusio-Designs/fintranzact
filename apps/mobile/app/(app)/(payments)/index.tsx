import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../src/lib/trpc";
import { useBusinessStore } from "../../../src/stores/business";
import { formatCurrency, formatDateShort } from "../../../src/lib/utils";
import { accumulatePages } from "../../../src/lib/accumulate-pages";
import { makeStyles } from "../../../src/lib/makeStyles";
import { useColors } from "../../../src/contexts/ThemeContext";
import { SearchBar, PressableRow, EmptyState } from "../../../src/components/ui";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}



const MODE_LABELS: Record<string, string> = {
  cash: "Cash", upi: "UPI", bank: "Bank", cheque: "Cheque", other: "Other",
  credit_card: "Card", debit_card: "Card", net_banking: "Net banking", wallet: "Wallet",
};

/** Neutral mode tag ("UPI", "Bank"); the direction icon carries the colour. */
function ModeBadge({ mode }: { mode: string }) {
  const styles = useStyles();
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{MODE_LABELS[mode] ?? mode}</Text>
    </View>
  );
}

const PAGE_SIZE = 20;

function UntrackedBanner() {
  const bannerStyles = useBannerStyles();
  const colors = useColors();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  const { data: countData } = trpc.payment.untrackedPayments.useQuery(
    { page: 1, limit: 1 },
    { staleTime: 60_000 }
  );

  const { data: fullData } = trpc.payment.untrackedPayments.useQuery(
    { page: 1, limit: 100 },
    { enabled: expanded, staleTime: 60_000 }
  );

  const count = countData?.total ?? 0;

  if (count === 0) return null;

  const handleToggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((v) => !v);
  };

  const payments = fullData?.data ?? [];

  return (
    <View style={bannerStyles.wrapper}>
      <TouchableOpacity
        style={bannerStyles.header}
        onPress={handleToggle}
        activeOpacity={0.8}
      >
        <View style={bannerStyles.headerLeft}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
          <Text style={bannerStyles.headerText}>
            {count} untracked {count === 1 ? "payment" : "payments"} — not linked to a bank account
          </Text>
        </View>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.warning}
        />
      </TouchableOpacity>

      {expanded && (
        <View style={bannerStyles.list}>
          {payments.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={bannerStyles.row}
              onPress={() => router.push(`/(more)/payments/${item.id}` as never)}
              activeOpacity={0.7}
            >
              <View style={bannerStyles.rowLeft}>
                <Text style={bannerStyles.rowNumber}>{item.paymentNumber}</Text>
                <Text style={bannerStyles.rowParty} numberOfLines={1}>{item.partyName}</Text>
              </View>
              <View style={bannerStyles.rowRight}>
                <Text style={bannerStyles.rowAmount}>{formatCurrency(item.amount)}</Text>
                <Text style={bannerStyles.rowDate}>
                  {item.paymentDate ? formatDateShort(item.paymentDate) : "—"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={colors.warning} style={{ marginLeft: 6 }} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

export default function PaymentsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { businessId } = useBusinessStore();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [allPayments, setAllPayments] = useState<NonNullable<typeof data>["data"]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data, isLoading, isFetching, refetch } = trpc.payment.list.useQuery(
    {
      page,
      limit: PAGE_SIZE,
      search: search.length > 0 ? search : undefined,
    },
    { enabled: !!businessId, placeholderData: (prev) => prev }
  );

  // Accumulate pages — see `accumulatePages` for the merge semantics.
  // In particular, page-1 refetches after a mutation invalidation
  // prepend freshly-created records so they appear immediately when the
  // user returns from the create screen (this was the "table doesn't
  // update after save" bug on the payments list).
  useEffect(() => {
    if (data?.data) {
      setAllPayments((prev) => accumulatePages(prev, data.data, page));
    }
  }, [data?.data, page]);

  // Reset accumulation when search changes
  useEffect(() => {
    setPage(1);
    setAllPayments([]);
  }, [search]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setPage(1);
    setAllPayments([]);
    await refetch();
    setIsRefreshing(false);
  }, [refetch]);

  const handleSearch = useCallback((text: string) => {
    setSearch(text);
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Payments</Text>
        <TouchableOpacity
          style={styles.recordBtn}
          onPress={() => router.push("/(payments)/create" as never)}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          <Ionicons name="add" size={18} color={colors.onBrand} />
          <Text style={styles.recordBtnText}>Record</Text>
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={styles.searchWrapper}>
        <SearchBar
          value={search}
          onChangeText={handleSearch}
          placeholder="Search party or payment number"
        />
      </View>

      {/* List */}
      {isLoading && page === 1 && allPayments.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      ) : (
        <FlatList
          data={allPayments}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          keyboardDismissMode="on-drag"
          ListHeaderComponent={<UntrackedBanner />}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.brand}
              colors={[colors.brand]}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="card-outline"
              title="No payments found"
              description={search ? "Try a different search term" : "Record your first payment"}
            />
          }
          renderItem={({ item }) => (
            <PressableRow
              style={styles.card}
              onPress={() => router.push(`/(more)/payments/${item.id}` as never)}
            >
              {(() => {
                // Customers pay you; you pay suppliers.
                const isIn = item.partyType !== "supplier";
                return (
                  <>
                    <View style={[styles.dirIcon, { backgroundColor: isIn ? colors.successBg : colors.dangerBg }]}>
                      <Ionicons
                        name={isIn ? "arrow-down-outline" : "arrow-up-outline"}
                        size={18}
                        color={isIn ? colors.success : colors.danger}
                        style={{ transform: [{ rotate: "45deg" }] }}
                      />
                    </View>
                    <View style={styles.cardLeft}>
                      <Text style={styles.partyName} numberOfLines={1}>{item.partyName}</Text>
                      <View style={styles.metaRow}>
                        <Text style={styles.date} numberOfLines={1}>
                          {item.paymentDate ? formatDateShort(item.paymentDate) : "—"}
                          {item.paymentNumber ? ` · ${item.paymentNumber}` : ""}
                        </Text>
                        <ModeBadge mode={item.mode} />
                      </View>
                    </View>
                    <Text style={[styles.amount, { color: isIn ? colors.success : colors.textPrimary }]} numberOfLines={1}>
                      {isIn ? "+" : "−"}{formatCurrency(item.amount)}
                    </Text>
                  </>
                );
              })()}
            </PressableRow>
          )}
          onEndReached={() => {
            if (!isFetching && data && allPayments.length < data.total) {
              setPage((p) => p + 1);
            }
          }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            isFetching && allPayments.length > 0 ? (
              <View style={styles.footer}>
                <ActivityIndicator color={colors.brand} />
              </View>
            ) : null
          }
        />
      )}

    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12,
  },
  title: { fontSize: 28, fontWeight: "800", color: colors.textPrimary, letterSpacing: -0.6 },
  recordBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, height: 44, paddingLeft: 12, paddingRight: 16,
    borderRadius: 14, backgroundColor: colors.brand,
    shadowColor: "#0f1b3d", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.22, shadowRadius: 14, elevation: 4,
  },
  recordBtnText: { color: colors.onBrand, fontSize: 14, fontWeight: "700" },
  searchWrapper: { marginHorizontal: 20, marginBottom: 12 },
  listContent: { paddingHorizontal: 20, paddingBottom: 24 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80 },
  card: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8,
  },
  dirIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  cardLeft: { flex: 1, gap: 4 },
  partyName: { fontSize: 15, fontWeight: "600", color: colors.textPrimary },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  amount: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  date: { flexShrink: 1, fontSize: 13, color: colors.textMuted },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.surfaceHover },
  badgeText: { fontSize: 11, fontWeight: "700", color: colors.textPrimary },
  footer: { paddingVertical: 20, alignItems: "center" },
}));

const useBannerStyles = makeStyles((colors) => ({
  wrapper: {
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warning + "55",
    borderRadius: 12,
    marginBottom: 12,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  headerText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.warning,
    flex: 1,
  },
  list: {
    borderTopWidth: 1,
    borderTopColor: colors.warning + "33",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.warning + "22",
  },
  rowLeft: {
    flex: 1,
    gap: 2,
  },
  rowNumber: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.textMuted,
  },
  rowParty: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  rowRight: {
    alignItems: "flex-end",
    gap: 2,
  },
  rowAmount: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.warning,
  },
  rowDate: {
    fontSize: 11,
    color: colors.textMuted,
  },
}));
