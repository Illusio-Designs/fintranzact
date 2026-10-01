import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { trpc } from "../../../src/lib/trpc";
import { useBusinessStore } from "../../../src/stores/business";
import { formatCurrency } from "../../../src/lib/utils";
import { makeStyles } from "../../../src/lib/makeStyles";
import { useColors } from "../../../src/contexts/ThemeContext";
import { SearchBar, PressableRow, EmptyState } from "../../../src/components/ui";
import { Ionicons } from "@expo/vector-icons";

type PartyType = "customer" | "supplier";

export default function PartiesScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { businessId } = useBusinessStore();
  const [activeTab, setActiveTab] = useState<PartyType>("customer");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [allParties, setAllParties] = useState<NonNullable<typeof data>["data"]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, isFetching, refetch } =
    trpc.party.list.useQuery(
      {
        type: activeTab,
        search: search || undefined,
        page,
        limit: 20,
      },
      { enabled: !!businessId, placeholderData: (prev) => prev }
    );

  const total = data?.total ?? 0;

  // Accumulate pages — reset on page 1, append on subsequent pages
  useEffect(() => {
    if (data?.data) {
      setAllParties((prev) => {
        if (page === 1) return data.data;
        const existingIds = new Set(prev.map((p) => p.id));
        const newItems = data.data.filter((p) => !existingIds.has(p.id));
        return [...prev, ...newItems];
      });
    }
  }, [data?.data, page]);

  // Reset accumulation when filters change
  useEffect(() => {
    setPage(1);
    setAllParties([]);
  }, [activeTab, search]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(1);
    setAllParties([]);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleTabChange = (tab: PartyType) => {
    setActiveTab(tab);
    setSearch("");
  };

  const handleSearch = (text: string) => {
    setSearch(text);
  };

  const loadMore = () => {
    if (!isFetching && data && allParties.length < total) {
      setPage((p) => p + 1);
    }
  };

  const renderItem = ({ item }: { item: (typeof allParties)[0] }) => {
    const balance = parseFloat(item.balance || item.openingBalance || "0");
    const isReceivable = balance >= 0;

    return (
      <PressableRow
        style={styles.listItem}
        onPress={() => router.push(`/(app)/(parties)/${item.id}` as never)}
      >
        <View style={styles.itemLeft}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>
              {item.name.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.itemInfo}>
            <Text style={styles.itemName} numberOfLines={1}>
              {item.name}
            </Text>
            {item.phone ? (
              <Text style={styles.itemSecondary}>{item.phone}</Text>
            ) : (
              <Text style={styles.itemSecondaryMuted}>No phone</Text>
            )}
          </View>
        </View>
        <View style={styles.itemRight}>
          <Text
            style={[
              styles.balanceText,
              isReceivable ? styles.balanceGreen : styles.balanceRed,
            ]}
          >
            {formatCurrency(Math.abs(balance))}
          </Text>
          <Text style={styles.balanceLabel}>
            {isReceivable ? "Receivable" : "Payable"}
          </Text>
        </View>
      </PressableRow>
    );
  };

  const renderEmpty = () => {
    if (isLoading) return null;
    return (
      <EmptyState
        icon="people-outline"
        title={`No ${activeTab}s found`}
        description={search ? "Try a different search term" : `Add your first ${activeTab} using the + button`}
      />
    );
  };

  const renderFooter = () => {
    if (!isFetching || allParties.length === 0) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.screenTitle}>Parties</Text>
        <Text style={styles.countBadge}>{total}</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => router.push("/(app)/(parties)/create" as never)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Add party"
        >
          <Ionicons name="add" size={22} color={colors.onBrand} />
        </TouchableOpacity>
      </View>

      {/* Segmented Control */}
      <View style={styles.segmentedControl}>
        <TouchableOpacity
          style={[
            styles.segmentTab,
            activeTab === "customer" && styles.segmentTabActive,
          ]}
          onPress={() => handleTabChange("customer")}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.segmentTabText,
              activeTab === "customer" && styles.segmentTabTextActive,
            ]}
          >
            Customers
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.segmentTab,
            activeTab === "supplier" && styles.segmentTabActive,
          ]}
          onPress={() => handleTabChange("supplier")}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.segmentTabText,
              activeTab === "supplier" && styles.segmentTabTextActive,
            ]}
          >
            Suppliers
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <SearchBar
          value={search}
          onChangeText={handleSearch}
          placeholder={`Search ${activeTab}s...`}
        />
      </View>

      {/* Party List */}
      {isLoading && page === 1 && allParties.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      ) : (
        <FlatList
          data={allParties}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          contentContainerStyle={[allParties.length === 0 ? styles.listEmpty : undefined, { paddingBottom: 24 }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.brand}
              colors={[colors.brand]}
            />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          style={styles.list}
          keyboardDismissMode="on-drag"
        />
      )}

    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, gap: 10 },
  screenTitle: { fontSize: 28, fontWeight: "800", color: colors.textPrimary, letterSpacing: -0.6 },
  countBadge: { fontSize: 13, fontWeight: "700", color: colors.brand, backgroundColor: colors.brandLight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: "hidden" },
  addBtn: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center",
    shadowColor: "#0f1b3d", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.22, shadowRadius: 14, elevation: 4,
  },
  segmentedControl: { flexDirection: "row", marginHorizontal: 20, marginBottom: 12, backgroundColor: colors.surfaceHover, borderRadius: 14, padding: 4 },
  segmentTab: { flex: 1, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  segmentTabActive: { backgroundColor: colors.surface, shadowColor: "#0f1b3d", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 6, elevation: 2 },
  segmentTabText: { fontSize: 14, fontWeight: "700", color: colors.textMuted },
  segmentTabTextActive: { color: colors.textPrimary },
  searchContainer: {
    marginHorizontal: 20,
    marginBottom: 12,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  listEmpty: {
    flex: 1,
  },
  listItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 16, paddingVertical: 14, marginHorizontal: 20, backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border },
  itemLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 12,
  },
  avatarCircle: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.brandLight, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 15, fontWeight: "700", color: colors.brand },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: 2,
  },
  itemSecondary: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  itemSecondaryMuted: {
    fontSize: 13,
    color: colors.textMuted,
    fontStyle: "italic",
  },
  itemRight: {
    alignItems: "flex-end",
    gap: 2,
  },
  balanceText: {
    fontSize: 15,
    fontWeight: "700",
  },
  balanceGreen: {
    color: colors.success,
  },
  balanceRed: {
    color: colors.danger,
  },
  balanceLabel: { fontSize: 12, color: colors.textMuted },
  separator: { height: 8 },
  list: { flex: 1 },
  footer: {
    paddingVertical: 20,
    alignItems: "center",
  },
}));
