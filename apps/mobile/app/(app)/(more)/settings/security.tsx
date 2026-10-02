import { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  Modal,
  Image,
  Share,
  Switch,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import {
  BACKUP_CODES_FILENAME,
  backupCodesFileContent,
  formatBackupCodeInput,
  formatTotpInput,
  groupKey,
} from "@fintranzact/shared";
import { trpc } from "../../../../src/lib/trpc";
import { makeStyles } from "../../../../src/lib/makeStyles";
import { useColors } from "../../../../src/contexts/ThemeContext";
import { fonts } from "../../../../src/lib/theme";
import { Card, Skeleton, QueryError } from "../../../../src/components/ui";
import { formatDateTime } from "../../../../src/lib/utils";
import { clearTrustedDeviceToken, getTrustedDeviceToken } from "../../../../src/lib/trusted-device";

/* ─── Small pieces ─────────────────────────────────────────────────────────── */

function InlineError({ message }: { message: string | null | undefined }) {
  const s = useS();
  const colors = useColors();
  if (!message) return null;
  return (
    <View style={s.errorBox} accessibilityRole="alert">
      <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
      <Text style={s.errorText}>{message}</Text>
    </View>
  );
}

function Btn({
  label,
  onPress,
  kind = "primary",
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  kind?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  loading?: boolean;
}) {
  const s = useS();
  const colors = useColors();
  const off = disabled || loading;
  return (
    <TouchableOpacity
      style={[s.btn, kind === "primary" && s.btnPrimary, kind === "secondary" && s.btnSecondary, kind === "danger" && s.btnDanger, off && s.btnOff]}
      onPress={onPress}
      disabled={off}
      activeOpacity={0.8}
      accessibilityRole="button"
    >
      {loading ? (
        <ActivityIndicator size="small" color={kind === "primary" ? colors.onBrand : colors.brand} />
      ) : (
        <Text style={[s.btnText, kind === "primary" && s.btnTextPrimary, kind === "danger" && s.btnTextDanger]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

function Sheet({ visible, onClose, title, children, dismissible = true }: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  dismissible?: boolean;
}) {
  const s = useS();
  const colors = useColors();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={dismissible ? onClose : undefined}>
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          {dismissible ? (
            <TouchableOpacity onPress={onClose} style={s.backBtn} accessibilityLabel="Close">
              <Ionicons name="close" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 44 }} />
          )}
          <Text style={s.title}>{title}</Text>
          <View style={{ width: 44 }} />
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={s.sheetContent} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

/* ─── Backup codes (shown once) ────────────────────────────────────────────── */

function BackupCodesView({ codes, email, onDone }: { codes: string[]; email: string; onDone: () => void }) {
  const s = useS();
  const colors = useColors();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    await Clipboard.setStringAsync(codes.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  async function share() {
    try {
      await Share.share({ title: BACKUP_CODES_FILENAME, message: backupCodesFileContent(codes, email) });
    } catch {
      /* cancelled or unavailable: the codes are still on screen */
    }
  }

  return (
    <View style={{ gap: 16 }}>
      <View style={s.warnBox}>
        <Ionicons name="warning-outline" size={18} color={colors.warning} />
        <Text style={s.warnText}>
          These codes are shown only once. Each works one time if you lose your phone. Store them somewhere safe and private.
        </Text>
      </View>
      <Card>
        <View style={s.codesGrid}>
          {codes.map((c) => (
            <Text key={c} style={s.code} selectable>{c}</Text>
          ))}
        </View>
      </Card>
      <View style={s.row}>
        <View style={{ flex: 1 }}><Btn label={copied ? "Copied" : "Copy"} kind="secondary" onPress={copy} /></View>
        <View style={{ flex: 1 }}><Btn label="Save / Share" kind="secondary" onPress={share} /></View>
      </View>
      <View style={s.confirmRow}>
        <Switch value={saved} onValueChange={setSaved} trackColor={{ true: colors.brand }} accessibilityLabel="I saved these codes" />
        <Text style={s.confirmText}>I saved these codes</Text>
      </View>
      <Btn label="Done" onPress={onDone} disabled={!saved} />
    </View>
  );
}

/* ─── Enable flow ──────────────────────────────────────────────────────────── */

function SetupSheet({ visible, onClose, email }: { visible: boolean; onClose: () => void; email: string }) {
  const s = useS();
  const utils = trpc.useUtils();
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const begin = trpc.auth.twoFactorBeginSetup.useMutation();
  const confirm = trpc.auth.twoFactorConfirmSetup.useMutation({
    onSuccess: (r) => {
      setCodes(r.backupCodes);
      utils.auth.twoFactorStatus.invalidate();
      utils.auth.me.invalidate();
    },
  });

  // A fresh secret each time the sheet opens.
  useEffect(() => {
    if (visible) {
      setCode("");
      setCodes(null);
      confirm.reset();
      begin.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const setup = begin.data;

  async function copyKey() {
    if (!setup) return;
    await Clipboard.setStringAsync(setup.manualKey.replace(/\s+/g, ""));
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Turn on two-factor" dismissible={!codes}>
      {codes ? (
        <BackupCodesView codes={codes} email={email} onDone={onClose} />
      ) : begin.isPending ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : begin.isError ? (
        <View style={{ gap: 12 }}>
          <InlineError message={begin.error.message} />
          <Btn label="Try again" onPress={() => begin.mutate()} />
        </View>
      ) : setup ? (
        <View style={{ gap: 16 }}>
          <Text style={s.step}>1. Install an authenticator app</Text>
          <Text style={s.body}>Google Authenticator, Microsoft Authenticator or Authy all work.</Text>
          <Text style={s.step}>2. Add this account</Text>
          <Text style={s.body}>Scan the QR code from the app. If you are setting up on this phone, enter the key by hand instead.</Text>
          <View style={s.qrWrap}>
            <Image source={{ uri: setup.qrDataUrl }} style={s.qr} accessibilityLabel="Two-factor QR code" />
          </View>
          <Card>
            <Text style={s.keyLabel}>Setup key</Text>
            <Text style={s.keyText} selectable>{groupKey(setup.manualKey)}</Text>
            <TouchableOpacity onPress={copyKey} style={s.keyCopy} accessibilityRole="button">
              <Ionicons name="copy-outline" size={16} />
              <Text style={s.linkText}>{copiedKey ? "Copied" : "Copy key"}</Text>
            </TouchableOpacity>
          </Card>
          <Text style={s.step}>3. Enter the 6-digit code</Text>
          <TextInput
            style={s.codeInput}
            value={code}
            onChangeText={(t) => setCode(formatTotpInput(t))}
            placeholder="123456"
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={6}
            editable={!confirm.isPending}
            accessibilityLabel="Authentication code"
          />
          <InlineError message={confirm.error?.message} />
          <Btn
            label="Confirm and turn on"
            onPress={() => confirm.mutate({ code })}
            disabled={code.length !== 6}
            loading={confirm.isPending}
          />
        </View>
      ) : null}
    </Sheet>
  );
}

/* ─── Disable / regenerate (password + code) ───────────────────────────────── */

function ReauthSheet({ mode, onClose, email }: { mode: "disable" | "regenerate" | null; onClose: () => void; email: string }) {
  const s = useS();
  const colors = useColors();
  const utils = trpc.useUtils();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const visible = mode !== null;
  const totpOnly = mode === "regenerate";

  useEffect(() => {
    if (visible) {
      setPassword("");
      setCode("");
      setCodes(null);
    }
  }, [visible]);

  const disable = trpc.auth.twoFactorDisable.useMutation({
    onSuccess: async () => {
      // The server revoked every trusted device, so the stored token is dead.
      await clearTrustedDeviceToken();
      utils.auth.twoFactorStatus.invalidate();
      utils.auth.listTrustedDevices.invalidate();
      utils.auth.me.invalidate();
      onClose();
    },
  });
  const regenerate = trpc.auth.regenerateBackupCodes.useMutation({
    onSuccess: (r) => {
      setCodes(r.backupCodes);
      utils.auth.twoFactorStatus.invalidate();
    },
  });
  const active = mode === "disable" ? disable : regenerate;
  const ready = password.length > 0 && (totpOnly ? code.length === 6 : code.replace(/[^A-Za-z0-9]/g, "").length >= 6);

  function submit() {
    if (!ready) return;
    const input = { password, code };
    if (mode === "disable") disable.mutate(input);
    else regenerate.mutate(input);
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={mode === "disable" ? "Turn off two-factor" : "New backup codes"}
      dismissible={!codes}
    >
      {codes ? (
        <BackupCodesView codes={codes} email={email} onDone={onClose} />
      ) : (
        <View style={{ gap: 14 }}>
          <Text style={s.body}>
            {mode === "disable"
              ? "Confirm with your password and a code from your authenticator app (or a backup code). Other sessions and trusted devices will be signed out."
              : "Confirm with your password and a code from your authenticator app. Your current backup codes stop working."}
          </Text>
          <Text style={s.label}>Password</Text>
          <TextInput
            style={s.input}
            value={password}
            onChangeText={(t) => { setPassword(t); active.reset(); }}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            placeholder="Your password"
            placeholderTextColor={colors.textMuted}
            editable={!active.isPending}
          />
          <Text style={s.label}>{totpOnly ? "Authentication code" : "Authentication or backup code"}</Text>
          <TextInput
            style={s.input}
            value={code}
            onChangeText={(t) => {
              active.reset();
              // Six digits are a TOTP; anything else is treated as a backup code.
              setCode(totpOnly || /^[\d\s]*$/.test(t) ? formatTotpInput(t) : formatBackupCodeInput(t));
            }}
            keyboardType={totpOnly ? "number-pad" : "default"}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="one-time-code"
            placeholder={totpOnly ? "123456" : "123456 or XXXXXX-XXXXXX"}
            placeholderTextColor={colors.textMuted}
            editable={!active.isPending}
          />
          <InlineError message={active.error?.message} />
          <Btn
            label={mode === "disable" ? "Turn off two-factor" : "Generate new codes"}
            kind={mode === "disable" ? "danger" : "primary"}
            onPress={submit}
            disabled={!ready}
            loading={active.isPending}
          />
        </View>
      )}
    </Sheet>
  );
}

/* ─── Trusted devices ──────────────────────────────────────────────────────── */

function TrustedDevices() {
  const s = useS();
  const colors = useColors();
  const utils = trpc.useUtils();
  const [token, setToken] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    getTrustedDeviceToken().then(setToken);
  }, []);

  const q = trpc.auth.listTrustedDevices.useQuery(
    { trustedDeviceToken: token ?? undefined },
    { enabled: token !== undefined },
  );

  const revoke = trpc.auth.revokeTrustedDevice.useMutation({
    onSuccess: () => utils.auth.listTrustedDevices.invalidate(),
    onError: (e) => Alert.alert("Could not revoke", e.message),
  });
  const revokeAll = trpc.auth.revokeAllTrustedDevices.useMutation({
    onSuccess: async () => {
      await clearTrustedDeviceToken();
      setToken(null);
      utils.auth.twoFactorStatus.invalidate();
      utils.auth.listTrustedDevices.invalidate();
    },
    onError: (e) => Alert.alert("Could not revoke", e.message),
  });

  function onRevoke(id: string, current: boolean) {
    Alert.alert("Revoke device", "This device will ask for a code the next time it signs in.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Revoke",
        style: "destructive",
        onPress: () =>
          revoke.mutate(
            { id },
            {
              onSuccess: async () => {
                if (current) {
                  await clearTrustedDeviceToken();
                  setToken(null);
                }
              },
            },
          ),
      },
    ]);
  }

  function onRevokeAll() {
    Alert.alert("Revoke all devices", "Every device, including this one, will ask for a code at its next sign-in.", [
      { text: "Cancel", style: "cancel" },
      { text: "Revoke all", style: "destructive", onPress: () => revokeAll.mutate() },
    ]);
  }

  const devices = q.data ?? [];
  return (
    <View style={{ gap: 10 }}>
      <Text style={s.sectionTitle}>Trusted devices</Text>
      <Text style={s.body}>Devices you chose to trust skip the code for 30 days. The password is still required.</Text>
      {q.isLoading || token === undefined ? (
        <Skeleton width="100%" height={60} borderRadius={12} />
      ) : q.isError ? (
        <QueryError message="Failed to load trusted devices" onRetry={q.refetch} />
      ) : devices.length === 0 ? (
        <Card><Text style={s.empty}>No trusted devices</Text></Card>
      ) : (
        <View style={s.list}>
          {devices.map((d, i) => (
            <View key={d.id} style={[s.deviceRow, i < devices.length - 1 && s.rowBorder]}>
              <Ionicons name="phone-portrait-outline" size={20} color={colors.textMuted} />
              <View style={{ flex: 1 }}>
                <View style={s.nameRow}>
                  <Text style={s.deviceName} numberOfLines={1}>{d.label}</Text>
                  {d.current && (
                    <View style={s.badge}><Text style={s.badgeText}>This device</Text></View>
                  )}
                </View>
                <Text style={s.meta}>
                  {d.lastUsedAt ? `Last used ${formatDateTime(d.lastUsedAt)}` : "Not used yet"} · Expires {formatDateTime(d.expiresAt)}
                </Text>
              </View>
              <TouchableOpacity
                style={s.revokeBtn}
                onPress={() => onRevoke(d.id, d.current)}
                disabled={revoke.isPending}
                accessibilityRole="button"
              >
                <Text style={s.revokeText}>Revoke</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      {devices.length > 0 && (
        <Btn label="Revoke all" kind="danger" onPress={onRevokeAll} loading={revokeAll.isPending} />
      )}
    </View>
  );
}

/* ─── Screen ───────────────────────────────────────────────────────────────── */

export default function SecurityScreen() {
  const s = useS();
  const colors = useColors();
  const router = useRouter();
  const [setupOpen, setSetupOpen] = useState(false);
  const [reauth, setReauth] = useState<"disable" | "regenerate" | null>(null);

  const { data: me } = trpc.auth.me.useQuery();
  const status = trpc.auth.twoFactorStatus.useQuery();
  const email = me?.user?.email ?? "";
  const enabled = status.data?.enabled ?? false;

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={s.title}>Two-factor authentication</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={status.isRefetching} onRefresh={() => status.refetch()} tintColor={colors.brand} colors={[colors.brand]} />
        }
      >
        {status.isLoading ? (
          <Skeleton width="100%" height={110} borderRadius={16} />
        ) : status.isError ? (
          <QueryError message="Failed to load two-factor status" onRetry={status.refetch} />
        ) : (
          <Card>
            <View style={s.statusRow}>
              <Ionicons name={enabled ? "shield-checkmark" : "shield-outline"} size={28} color={enabled ? colors.success : colors.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={s.statusTitle}>{enabled ? "Two-factor is on" : "Two-factor is off"}</Text>
                <Text style={s.meta}>
                  {enabled
                    ? `${status.data?.backupCodesRemaining ?? 0} backup codes left`
                    : "Add a code from an authenticator app when you sign in."}
                </Text>
              </View>
            </View>
            {enabled ? (
              <View style={s.actions}>
                <Btn label="New backup codes" kind="secondary" onPress={() => setReauth("regenerate")} />
                <Btn label="Turn off" kind="danger" onPress={() => setReauth("disable")} />
              </View>
            ) : (
              <View style={s.actions}>
                <Btn label="Turn on" onPress={() => setSetupOpen(true)} />
              </View>
            )}
          </Card>
        )}

        {enabled && <TrustedDevices />}
      </ScrollView>

      <SetupSheet visible={setupOpen} onClose={() => setSetupOpen(false)} email={email} />
      <ReauthSheet mode={reauth} onClose={() => setReauth(null)} email={email} />
    </SafeAreaView>
  );
}

/* ─── Styles ───────────────────────────────────────────────────────────────── */

const useS = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center",
  },
  title: { fontSize: 17, fontWeight: "700", color: colors.textPrimary },
  content: { padding: 16, gap: 20, paddingBottom: 48 },
  sheetContent: { padding: 16, paddingBottom: 48 },

  statusRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  statusTitle: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  actions: { marginTop: 16, gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  body: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
  step: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  label: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  empty: { color: colors.textMuted, fontSize: 13, textAlign: "center", paddingVertical: 12 },

  btn: { height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  btnPrimary: { backgroundColor: colors.brand },
  btnSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  btnDanger: { backgroundColor: colors.dangerBg, borderWidth: 1, borderColor: "rgba(239, 68, 68, 0.25)" },
  btnOff: { opacity: 0.5 },
  btnText: { fontSize: 15, fontWeight: "600", color: colors.textPrimary },
  btnTextPrimary: { color: colors.onBrand, fontWeight: "700" },
  btnTextDanger: { color: colors.danger },

  input: {
    height: 50, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, color: colors.textPrimary, paddingHorizontal: 16, fontSize: 16,
  },
  codeInput: {
    height: 58, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, color: colors.textPrimary,
    fontSize: 24, fontWeight: "600", textAlign: "center", letterSpacing: 4,
  },
  errorBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: colors.dangerBg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
  },
  errorText: { flex: 1, color: colors.danger, fontSize: 14, fontWeight: "600" },

  qrWrap: { alignItems: "center", backgroundColor: "#fff", padding: 12, borderRadius: 16, alignSelf: "center" },
  qr: { width: 220, height: 220 },
  keyLabel: { fontSize: 12, color: colors.textMuted },
  keyText: { fontFamily: fonts?.mono, fontSize: 16, fontWeight: "600", color: colors.textPrimary, marginTop: 4, letterSpacing: 1 },
  keyCopy: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  linkText: { color: colors.brand, fontWeight: "600", fontSize: 14 },

  warnBox: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.warningBg },
  warnText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.textPrimary },
  codesGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: 10 },
  code: { width: "50%", fontFamily: fonts?.mono, fontSize: 15, fontWeight: "600", color: colors.textPrimary },
  row: { flexDirection: "row", gap: 10 },
  confirmRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  confirmText: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.textPrimary },

  list: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  deviceRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  deviceName: { fontSize: 14, fontWeight: "600", color: colors.textPrimary, flexShrink: 1 },
  badge: {
    backgroundColor: colors.successBg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
    borderWidth: 1, borderColor: "rgba(16, 185, 129, 0.3)",
  },
  badgeText: { fontSize: 10, fontWeight: "700", color: colors.success },
  revokeBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.dangerBg,
    borderWidth: 1, borderColor: "rgba(239, 68, 68, 0.25)",
  },
  revokeText: { fontSize: 12, fontWeight: "600", color: colors.danger },
}));
