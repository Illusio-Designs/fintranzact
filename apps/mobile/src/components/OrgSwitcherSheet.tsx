import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Easing,
  ScrollView,
  TextInput,
  Alert,
  Dimensions,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles } from "../lib/makeStyles";
import { useColors } from "../contexts/ThemeContext";
import { haptic } from "../lib/haptics";
import { trpc } from "../lib/trpc";
import { mergeClientPages, leaveClientWarning, type ClientListItem } from "@fintranzact/shared";
import { switcherRows, showSearch, nextOrgAfterLeaving } from "../lib/client-switcher";

const PAGE_SIZE = 30;
const SEARCH_DEBOUNCE_MS = 200;

interface OrgItem {
  tenantId: string;
  tenantName: string;
  role: string;
}

interface OrgSwitcherSheetProps {
  visible: boolean;
  onClose: () => void;
  orgs: OrgItem[];
  activeTenantId: string | null;
  onSwitch: (tenantId: string) => void;
  canCreateOrg?: boolean;
  onCreateNew?: () => void;
  isCreating?: boolean;
  /** After leaving a client (the parent refreshes the session; `next` is the organisation to open when the open one was left). */
  onLeft?: (tenantId: string, next: ClientListItem | null) => void;
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  superadmin: "Super Admin",
  admin: "Admin",
  seller_manager: "Sales Manager",
  seller: "Seller",
  accountant: "Accountant (bookkeeping)",
  hr: "HR / Payroll manager",
  employee: "Employee",
  auditor: "Accountant (read-only)",
  ca_filing: "Accountant (filing)",
  member: "Member",
};

function formatRole(role: string): string {
  return ROLE_LABELS[role] ?? role.charAt(0).toUpperCase() + role.slice(1).replace(/_/g, " ");
}

export function OrgSwitcherSheet({
  visible,
  onClose,
  orgs,
  activeTenantId,
  onSwitch,
  canCreateOrg,
  onCreateNew,
  isCreating,
  onLeft,
}: OrgSwitcherSheetProps) {
  const [slideAnim] = useState(() => new Animated.Value(0));
  const styles = useStyles();
  const colors = useColors();
  const utils = trpc.useUtils();

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState<ClientListItem[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setCursor(undefined), [debounced]);

  const query = trpc.tenant.listClients.useQuery(
    { search: debounced || undefined, cursor, limit: PAGE_SIZE },
    { enabled: visible },
  );
  const data = query.data;
  useEffect(() => {
    if (!data) return;
    const items = data.items as ClientListItem[];
    setLoaded((prev) => (cursor ? mergeClientPages(prev, items) : items));
  }, [data, cursor]);

  const refresh = () => {
    setCursor(undefined);
    void utils.tenant.listClients.invalidate();
  };
  const setPinned = trpc.tenant.setPinned.useMutation({
    onSuccess: refresh,
    onError: (err) => Alert.alert("Could not change the pin", err.message),
  });
  const leave = trpc.tenant.leave.useMutation({
    onSuccess: (_r, vars) => {
      const next = vars.tenantId === activeTenantId ? nextOrgAfterLeaving(loaded, vars.tenantId) : null;
      refresh();
      void utils.tenant.list.invalidate();
      onLeft?.(vars.tenantId, next);
    },
    onError: (err) => Alert.alert("Could not leave", err.message),
  });

  const confirmLeave = (org: ClientListItem) => {
    const w = leaveClientWarning(org.name);
    Alert.alert(w.title, w.description, [
      { text: "Cancel", style: "cancel" },
      { text: w.confirmLabel, style: "destructive", onPress: () => leave.mutate({ tenantId: org.tenantId }) },
    ]);
  };

  // Until the list arrives, show what the parent already has (the old behaviour).
  const fallback: ClientListItem[] = useMemo(
    () => orgs.map((o) => ({
      tenantId: o.tenantId, name: o.tenantName, slug: "", role: o.role, roleLabel: formatRole(o.role),
      isOwnFirm: o.role === "owner" || o.role === "superadmin", isClient: !(o.role === "owner" || o.role === "superadmin"),
      isCa: o.role === "auditor" || o.role === "ca_filing", plan: "", pinned: false, lastOpenedAt: null,
    })),
    [orgs],
  );
  const items = data ? loaded : fallback;
  const total = data?.counts.all ?? orgs.length;
  const rows = useMemo(() => switcherRows(items, { total, searching: !!debounced }), [items, total, debounced]);

  useEffect(() => {
    if (visible) {
      haptic.light();
      Animated.spring(slideAnim, {
        toValue: 1,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim]);

  const handleClose = () => {
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  };

  const handleSwitch = (tenantId: string) => {
    if (tenantId === activeTenantId) {
      handleClose();
      return;
    }
    haptic.medium();
    onSwitch(tenantId);
  };

  const handleCreateNew = () => {
    haptic.light();
    onCreateNew?.();
  };

  const screenHeight = Dimensions.get("window").height;

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [screenHeight, 0],
  });

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="none" statusBarTranslucent>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          {/* Handle bar */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Switch Organization</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={handleClose} activeOpacity={0.7}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {showSearch(total, search) && (
            <TextInput
              style={styles.search}
              value={search}
              onChangeText={setSearch}
              placeholder="Search organizations"
              placeholderTextColor={colors.textMuted}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              accessibilityLabel="Search organizations"
            />
          )}

          {/* Org list */}
          <ScrollView
            style={{ maxHeight: screenHeight * 0.5 }}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {rows.map((row) => {
              if (row.kind === "header") {
                return <Text key={row.key} style={styles.sectionHeader}>{row.title}</Text>;
              }
              const org = row.org;
              const isActive = org.tenantId === activeTenantId;
              return (
                <View key={row.key} style={styles.orgRowWrap}>
                  <TouchableOpacity
                    style={[styles.orgRow, styles.orgRowMain]}
                    onPress={() => handleSwitch(org.tenantId)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.avatar, isActive && styles.avatarActive]}>
                      <Text style={[styles.avatarText, isActive && styles.avatarTextActive]}>
                        {org.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.orgInfo}>
                      <Text
                        style={[styles.orgName, isActive && styles.orgNameActive]}
                        numberOfLines={1}
                      >
                        {org.name}
                      </Text>
                      <View style={styles.badgeRow}>
                        <Text style={styles.orgRole}>{org.roleLabel}</Text>
                        {org.isCa && <Text style={styles.caTag}>CA</Text>}
                      </View>
                    </View>
                    {isActive && (
                      <Ionicons name="checkmark" size={20} color={colors.brand} />
                    )}
                  </TouchableOpacity>
                  {data && (
                    <TouchableOpacity
                      style={styles.iconBtn}
                      onPress={() => setPinned.mutate({ tenantId: org.tenantId, pinned: !org.pinned })}
                      accessibilityLabel={org.pinned ? `Unpin ${org.name}` : `Pin ${org.name}`}
                      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                    >
                      <Ionicons name={org.pinned ? "star" : "star-outline"} size={18} color={org.pinned ? colors.brand : colors.textMuted} />
                    </TouchableOpacity>
                  )}
                  {data && !org.isOwnFirm && (
                    <TouchableOpacity
                      style={styles.iconBtn}
                      onPress={() => confirmLeave(org)}
                      accessibilityLabel={`Leave ${org.name}`}
                      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                    >
                      <Ionicons name="exit-outline" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
            {data && rows.length === 0 && (
              <Text style={styles.emptyText}>
                {debounced ? `No organizations match “${debounced}”.` : "No organizations."}
              </Text>
            )}
            {!data && query.isLoading && <ActivityIndicator style={styles.loadingSpinner} size="small" color={colors.textSecondary} />}
            {data?.nextCursor && (
              <TouchableOpacity
                style={styles.loadMore}
                onPress={() => setCursor(data.nextCursor ?? undefined)}
                disabled={query.isFetching}
                activeOpacity={0.7}
              >
                <Text style={styles.loadMoreText}>{query.isFetching ? "Loading..." : "Load more"}</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          {/* Create new org */}
          {canCreateOrg && onCreateNew && (
            <>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.orgRow}
                onPress={handleCreateNew}
                activeOpacity={0.7}
                disabled={isCreating}
              >
                <View style={styles.createAvatar}>
                  {isCreating ? (
                    <ActivityIndicator size="small" color={colors.textSecondary} />
                  ) : (
                    <Ionicons name="add" size={20} color={colors.textSecondary} />
                  )}
                </View>
                <Text style={styles.createText}>
                  {isCreating ? "Creating..." : "Create New Organization"}
                </Text>
              </TouchableOpacity>
            </>
          )}

          <SafeAreaView edges={["bottom"]} />
        </Animated.View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 8 : 16,
  },
  handle: {
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginBottom: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  search: {
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    color: colors.textPrimary,
    paddingHorizontal: 12,
    marginBottom: 8,
    fontSize: 15,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.textMuted,
    paddingHorizontal: 4,
    paddingTop: 10,
    paddingBottom: 2,
  },
  orgRowWrap: {
    flexDirection: "row",
    alignItems: "center",
  },
  orgRowMain: {
    flex: 1,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  caTag: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.brand,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: 4,
    paddingHorizontal: 4,
    marginTop: 1,
  },
  iconBtn: {
    width: 36,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    paddingVertical: 24,
  },
  loadingSpinner: {
    paddingVertical: 16,
  },
  loadMore: {
    alignItems: "center",
    paddingVertical: 12,
  },
  loadMoreText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.brand,
  },
  orgRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 56,
    gap: 12,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarActive: {
    backgroundColor: colors.brand,
  },
  avatarText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textSecondary,
  },
  avatarTextActive: {
    color: colors.onBrand,
  },
  orgInfo: {
    flex: 1,
    minWidth: 0,
  },
  orgName: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.textSecondary,
  },
  orgNameActive: {
    fontWeight: "700",
    color: colors.textPrimary,
  },
  orgRole: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  createAvatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  createText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    color: colors.textSecondary,
  },
}));
