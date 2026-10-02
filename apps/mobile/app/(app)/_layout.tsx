import { useEffect, useCallback, useMemo, useRef } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../src/lib/trpc";
import { useAuthStore } from "../../src/stores/auth";
import { useBusinessStore } from "../../src/stores/business";
import { makeStyles } from "../../src/lib/makeStyles";
import { useColors } from "../../src/contexts/ThemeContext";
import { queryClient } from "../../src/lib/query-client";
import { BusinessSwitcherProvider } from "../../src/contexts/BusinessSwitcherContext";
import { MaintenanceBanner } from "../../src/components/MaintenanceBanner";
import { BillingBanner } from "../../src/components/BillingBanner";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fontFamilies } from "../../src/lib/theme";

export default function AppLayout() {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const token = useAuthStore((s) => s.token);
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: session, isLoading: sessionLoading } = trpc.auth.me.useQuery(undefined, { enabled: !!token });

  // Auto-select tenant if only one (same pattern as web root layout)
  const {
    data: tenantList,
  } = trpc.tenant.list.useQuery(undefined, {
    enabled: !!session?.user,
  });

  const selectTenantMutation = trpc.tenant.select.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      queryClient.invalidateQueries();
    },
  });

  useEffect(() => {
    if (session?.user && !session?.tenantId && tenantList?.length === 1 && !selectTenantMutation.isPending) {
      selectTenantMutation.mutate({ tenantId: tenantList[0].tenantId });
    }
  }, [session?.user, session?.tenantId, tenantList]);

  // Fetch businesses once tenant is selected
  const { data: businesses } = trpc.business.list.useQuery(undefined, {
    enabled: !!session?.user && !!session?.tenantId,
  });

  const setBusiness = useBusinessStore((s) => s.setBusiness);
  const businessId = useBusinessStore((s) => s.businessId);

  // True once the businessId has been verified against the business list.
  // Used as the single source of truth for both layout guard and query `enabled` flags.
  const businessValidated = useMemo(
    () => !!businessId && businesses !== undefined && businesses.some((b) => b.id === businessId),
    [businessId, businesses],
  );

  // Validate hydrated businessId against the actual business list.
  // SecureStore may hold a stale ID from a previous tenant or deleted business.
  // Also auto-select the first business when none is selected.
  // The ref prevents an invalidation loop: correction → invalidate → refetch list → re-trigger.
  const correctedRef = useRef(false);
  useEffect(() => {
    if (!businesses || businesses.length === 0) return;

    if (!businessId) {
      setBusiness(businesses[0].id, businesses[0].name);
    } else if (!businessValidated && !correctedRef.current) {
      if (__DEV__) console.log("[AppLayout] Stale businessId", businessId, "— correcting to", businesses[0].id);
      correctedRef.current = true;
      setBusiness(businesses[0].id, businesses[0].name);
      // Invalidate any queries that may have fired with the stale businessId
      queryClient.invalidateQueries();
    }
  }, [businesses, businessId, businessValidated]);

  const handleSwitchBusiness = useCallback(
    async (id: string, name: string) => {
      await setBusiness(id, name);
      utils.invalidate();
    },
    [setBusiness, utils],
  );

  // Plan limit: hide "Create New Business" when at limit
  const { data: canCreateBiz } = trpc.business.canCreate.useQuery(undefined, {
    enabled: !!session?.user && !!session?.tenantId,
  });

  const handleCreateNewBusiness = useCallback(() => {
    router.push("/(app)/create-business");
  }, [router]);

  // Low stock badge (only when business is validated against the business list)
  const { data: _lowStockCount } = trpc.item.lowStockCount.useQuery(undefined, {
    enabled: businessValidated,
  });

  // Not logged in — the root layout's auth gate handles the login redirect.
  // We show a loading state here rather than redirecting, which prevents a
  // flash of the login screen when re-mounting after lock screen unlock.
  if (!token) {
    if (__DEV__) console.log("[AppLayout] No token — showing loading spinner (NOT redirecting to login)");
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={colors.brand} />
      </View>
    );
  }

  // Wait until business is ready AND validated before rendering any screens.
  // The businessId from SecureStore may be stale (from a previous tenant or
  // deleted business). We must wait for business.list to confirm validity,
  // otherwise child screens fire queries with a stale x-business-id header
  // and get "Business not found" errors from the server.
  if (!businessValidated) {
    // If tenant is ready and businesses list loaded but empty — prompt to create one
    const bizListReady = !!session?.tenantId && businesses !== undefined;
    const noBusiness = bizListReady && businesses.length === 0;

    if (noBusiness) {
      return (
        <View style={styles.loading}>
          <View style={styles.emptyBizContainer}>
            <Ionicons name="business-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyBizTitle}>No businesses yet</Text>
            <Text style={styles.emptyBizSubtitle}>
              Create your first business to get started.
            </Text>
            <TouchableOpacity
              style={styles.createBizBtn}
              onPress={() => router.push("/(app)/create-business")}
              activeOpacity={0.8}
            >
              <Ionicons name="add" size={18} color={colors.onBrand} />
              <Text style={styles.createBizBtnText}>Create Business</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={colors.brand} />
        {sessionLoading ? null : (
          <Text style={styles.loadingText}>
            {!session?.tenantId ? "Selecting organization..." : "Loading business..."}
          </Text>
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <MaintenanceBanner />
      <BillingBanner />
      <BusinessSwitcherProvider
        businesses={businesses ?? []}
        activeBusinessId={businessId ?? ""}
        onSwitch={handleSwitchBusiness}
        onCreateNew={canCreateBiz ? handleCreateNewBusiness : undefined}
      >
        <Tabs
          screenOptions={{
            headerShown: false,
            sceneStyle: { backgroundColor: colors.bg },
            // A rounded bar inset from the screen edges. It stays in the normal
            // layout (not absolutely positioned) so it never covers content.
            tabBarStyle: {
              backgroundColor: colors.surface,
              borderTopWidth: 0,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 24,
              marginHorizontal: 12,
              marginBottom: Math.max(insets.bottom, 12),
              height: 68,
              paddingTop: 8,
              paddingBottom: 8,
              elevation: 8,
              shadowColor: "#0f1b3d",
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: 0.12,
              shadowRadius: 20,
            },
            tabBarActiveTintColor: colors.brand,
            tabBarInactiveTintColor: colors.textMuted,
            tabBarLabelStyle: { fontSize: 11, fontFamily: fontFamilies.body[700] },
          }}
        >
          <Tabs.Screen
            name="(home)"
            options={{
              title: "Home",
              tabBarIcon: ({ color, focused }) => <TabIcon name="home-outline" color={color} focused={focused} />,
            }}
          />
          <Tabs.Screen
            name="(invoices)"
            options={{
              title: "Invoices",
              tabBarIcon: ({ color, focused }) => <TabIcon name="receipt-outline" color={color} focused={focused} />,
            }}
          />
          <Tabs.Screen
            name="(parties)"
            options={{
              title: "Parties",
              tabBarIcon: ({ color, focused }) => <TabIcon name="people-outline" color={color} focused={focused} />,
            }}
          />
          <Tabs.Screen
            name="(payments)"
            options={{
              title: "Payments",
              tabBarIcon: ({ color, focused }) => <TabIcon name="card-outline" color={color} focused={focused} />,
            }}
          />
          <Tabs.Screen
            name="(items)"
            options={{
              href: null, // Hidden from tab bar — accessible via More
            }}
          />
          <Tabs.Screen
            name="create-business"
            options={{
              href: null, // Hidden from tab bar — navigated to programmatically
            }}
          />
          <Tabs.Screen
            name="(more)"
            options={{
              title: "More",
              tabBarIcon: ({ color, focused }) => <TabIcon name="grid-outline" color={color} focused={focused} />,
            }}
          />
        </Tabs>
      </BusinessSwitcherProvider>
    </View>
  );
}

/** Tab icon with a soft pill behind it when active. */
function TabIcon({ name, color, focused }: { name: keyof typeof Ionicons.glyphMap; color: string; focused: boolean }) {
  const colors = useColors();
  return (
    <View
      style={{
        width: 44,
        height: 28,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: focused ? colors.brandLight : "transparent",
      }}
    >
      <Ionicons name={name} size={21} color={color} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  loading: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  emptyBizContainer: {
    alignItems: "center",
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyBizTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
    marginTop: 8,
  },
  emptyBizSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },
  createBizBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.brand,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 8,
  },
  createBizBtnText: {
    color: colors.onBrand,
    fontWeight: "700",
    fontSize: 15,
  },
}));
