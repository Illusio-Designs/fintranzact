import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { trpc } from "../../../../src/lib/trpc";
import { useAuthStore } from "../../../../src/stores/auth";
import { makeStyles } from "../../../../src/lib/makeStyles";
import { useColors, useTheme } from "../../../../src/contexts/ThemeContext";
import { PressableRow, Logo } from "../../../../src/components/ui";
import { OrgSwitcherSheet } from "../../../../src/components/OrgSwitcherSheet";
import { queryClient } from "../../../../src/lib/query-client";

interface SettingItem {
  label: string;
  icon: string;
  description: string;
  route: string;
}

const GROUPS: { title: string; items: SettingItem[] }[] = [
  {
    title: "Business",
    items: [
      { label: "Business details", icon: "business-outline", description: "Name, GSTIN, address", route: "/(more)/settings/business" },
      { label: "Documents", icon: "document-text-outline", description: "Prefixes and numbering", route: "/(more)/settings/documents" },
      { label: "Team", icon: "people-outline", description: "Members and roles", route: "/(more)/settings/team" },
      { label: "Online store", icon: "storefront-outline", description: "Store link and items", route: "/(more)/settings/store" },
    ],
  },
  {
    title: "App",
    items: [
      { label: "Appearance", icon: "sunny-outline", description: "Light, dark or system", route: "/(more)/settings/appearance" },
      { label: "App lock", icon: "lock-closed-outline", description: "PIN or fingerprint on open", route: "/(more)/settings/profile" },
    ],
  },
  {
    title: "Security",
    items: [
      { label: "Account", icon: "shield-checkmark-outline", description: "Password and active sessions", route: "/(more)/settings/account" },
      { label: "API keys", icon: "key-outline", description: "Connect other software", route: "/(more)/settings/api-keys" },
    ],
  },
];

const MODE_LABEL = { light: "Light", dark: "Dark", system: "System" } as const;

export default function SettingsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { mode } = useTheme();
  const logout = useAuthStore((s) => s.logout);
  const utils = trpc.useUtils();
  const [showOrgSwitcher, setShowOrgSwitcher] = useState(false);

  const { data: session } = trpc.auth.me.useQuery();
  const { data: tenantList } = trpc.tenant.list.useQuery(undefined, { enabled: !!session?.user });
  const { data: canCreateOrg } = trpc.tenant.canCreateOrg.useQuery(undefined, { enabled: !!session?.user });

  const selectTenantMutation = trpc.tenant.select.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      queryClient.invalidateQueries();
      setShowOrgSwitcher(false);
    },
  });

  const createOrgMutation = trpc.tenant.create.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      utils.tenant.list.invalidate();
      queryClient.invalidateQueries();
      setShowOrgSwitcher(false);
    },
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await logout();
      router.replace("/(auth)/login");
    },
    onError: async () => {
      // Even if API logout fails, clear local state
      await logout();
      router.replace("/(auth)/login");
    },
  });

  const handleSignOut = () => {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => logoutMutation.mutate() },
    ]);
  };

  const userName = session?.user?.name ?? "Your profile";
  const userInitials = userName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Profile */}
        <PressableRow style={styles.profileCard} onPress={() => router.push("/(more)/settings/profile" as any)}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileAvatarText}>{userInitials || "?"}</Text>
          </View>
          <View style={styles.flexText}>
            <Text style={styles.profileName} numberOfLines={1}>{userName}</Text>
            <Text style={styles.profileSub} numberOfLines={1}>{session?.user?.email ?? "Name, email, password"}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </PressableRow>

        {/* Organization */}
        {tenantList && tenantList.length > 0 && (
          <TouchableOpacity
            style={styles.orgCard}
            onPress={() => setShowOrgSwitcher(true)}
            activeOpacity={0.7}
          >
            <View style={styles.orgAvatar}>
              <Text style={styles.orgAvatarText}>
                {(session?.tenantName ?? "O").charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.flexText}>
              <Text style={styles.orgName} numberOfLines={1}>{session?.tenantName ?? "Organization"}</Text>
              <Text style={styles.orgLabel}>Organization</Text>
            </View>
            <Ionicons name="chevron-expand-outline" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}

        {GROUPS.map((group) => (
          <View key={group.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{group.title.toUpperCase()}</Text>
            <View style={styles.settingsList}>
              {group.items.map((item, index) => (
                <PressableRow
                  key={item.label}
                  style={[styles.settingRow, index > 0 && styles.settingRowBorder]}
                  onPress={() => router.push(item.route as any)}
                >
                  <View style={styles.settingIconWrapper}>
                    <Ionicons name={item.icon as any} size={19} color={colors.textPrimary} />
                  </View>
                  <View style={styles.settingText}>
                    <Text style={styles.settingLabel} numberOfLines={1}>{item.label}</Text>
                    <Text style={styles.settingDescription} numberOfLines={1}>{item.description}</Text>
                  </View>
                  {item.label === "Appearance" ? (
                    <Text style={styles.settingValue}>{MODE_LABEL[mode]}</Text>
                  ) : null}
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </PressableRow>
              ))}
            </View>
          </View>
        ))}

        <TouchableOpacity
          style={styles.signOutBtn}
          onPress={handleSignOut}
          disabled={logoutMutation.isPending}
          activeOpacity={0.8}
          accessibilityRole="button"
        >
          {logoutMutation.isPending ? (
            <ActivityIndicator color={colors.danger} size="small" />
          ) : (
            <>
              <Ionicons name="log-out-outline" size={18} color={colors.danger} />
              <Text style={styles.signOutText}>Sign out</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.footerRow}>
          <Logo size={20} />
          <Text style={styles.footer}>Fintranzact {Constants.expoConfig?.version ?? ""}</Text>
        </View>
      </ScrollView>

      {/* Org Switcher Sheet */}
      <OrgSwitcherSheet
        visible={showOrgSwitcher}
        onClose={() => setShowOrgSwitcher(false)}
        orgs={tenantList ?? []}
        activeTenantId={session?.tenantId ?? null}
        onSwitch={(tenantId) => selectTenantMutation.mutate({ tenantId })}
        canCreateOrg={canCreateOrg ?? false}
        onCreateNew={() => createOrgMutation.mutate()}
        isCreating={createOrgMutation.isPending}
      />
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { flex: 1, fontSize: 24, fontWeight: "800", color: colors.textPrimary, letterSpacing: -0.5 },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 20 },
  flexText: { flex: 1, minWidth: 0, gap: 3 },
  profileCard: {
    flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 22,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  profileAvatar: {
    width: 52, height: 52, borderRadius: 16, backgroundColor: colors.hero,
    alignItems: "center", justifyContent: "center",
  },
  profileAvatarText: { color: colors.heroText, fontSize: 17, fontWeight: "800" },
  profileName: { fontSize: 17, fontWeight: "700", color: colors.textPrimary },
  profileSub: { fontSize: 13, color: colors.textMuted },
  orgCard: {
    flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 18,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginTop: -8,
  },
  orgAvatar: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: colors.brandLight,
    alignItems: "center", justifyContent: "center",
  },
  orgAvatarText: { color: colors.brand, fontSize: 15, fontWeight: "800" },
  orgName: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  orgLabel: { fontSize: 12, color: colors.textMuted },
  section: { gap: 8 },
  sectionTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.7, color: colors.textMuted, paddingLeft: 4 },
  settingsList: { backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  settingRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 60 },
  settingRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  settingIconWrapper: {
    width: 36, height: 36, borderRadius: 11, backgroundColor: colors.surfaceHover,
    alignItems: "center", justifyContent: "center",
  },
  settingText: { flex: 1, gap: 2 },
  settingLabel: { fontSize: 15, fontWeight: "600", color: colors.textPrimary },
  settingDescription: { fontSize: 13, color: colors.textMuted },
  settingValue: { fontSize: 14, color: colors.textMuted },
  signOutBtn: {
    flexDirection: "row", gap: 8, height: 54, borderRadius: 16, backgroundColor: colors.dangerBg,
    alignItems: "center", justifyContent: "center",
  },
  signOutText: { fontSize: 15, fontWeight: "700", color: colors.danger },
  footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  footer: { fontSize: 13, color: colors.textMuted },
}));
