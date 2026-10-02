import { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Switch, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  formatBackupCodeInput,
  formatTotpInput,
  isCompleteBackupCode,
} from "@fintranzact/shared";
import { trpc } from "../../lib/trpc";
import { makeStyles } from "../../lib/makeStyles";
import { useColors } from "../../contexts/ThemeContext";
import { buildVerifyInput } from "../../lib/trusted-device";
import { mapVerifyError } from "../../lib/two-factor-login";

export type VerifyResult = {
  user: { id: string; email: string; name: string | null };
  sessionToken: string;
  trustedDeviceToken?: string;
};

type Mode = "totp" | "backup";

/**
 * Second sign-in step: the 6-digit code (or a backup code) after a correct
 * password. Wrong or locked codes stay here; an expired challenge hands back
 * to the password step through `onExpired`.
 */
export function TwoFactorStep({
  challengeToken,
  onVerified,
  onBack,
  onExpired,
}: {
  challengeToken: string;
  /** Same post-login work as a password login (store session, navigate). */
  onVerified: (data: VerifyResult) => void | Promise<void>;
  onBack: () => void;
  onExpired: (message: string) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const [mode, setMode] = useState<Mode>("totp");
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const [done, setDone] = useState(false);
  const inputRef = useRef<TextInput>(null);
  // A code is submitted once; typing past it or a re-render must not send it twice.
  const lastSubmitted = useRef("");

  const verify = trpc.auth.verifyTwoFactor.useMutation({
    onSuccess: async (data) => {
      setDone(true);
      try {
        await onVerified(data as VerifyResult);
      } catch (e) {
        setDone(false);
        lastSubmitted.current = "";
        setError(e instanceof Error ? e.message : "Could not sign you in. Try again.");
      }
    },
    onError: (e) => {
      lastSubmitted.current = "";
      const failure = mapVerifyError(e);
      if (failure.kind === "expired") {
        onExpired(failure.message);
        return;
      }
      setError(failure.message);
      if (failure.kind === "locked") {
        setLocked(true);
        return;
      }
      setCode("");
      setTimeout(() => inputRef.current?.focus(), 50);
    },
  });

  const busy = verify.isPending || done;
  const isTotp = mode === "totp";
  const complete = isTotp ? code.length === 6 : isCompleteBackupCode(code);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, [mode]);

  function submit(value: string) {
    if (busy || locked || lastSubmitted.current === value) return;
    lastSubmitted.current = value;
    setError("");
    verify.mutate(buildVerifyInput(challengeToken, value, remember));
  }

  function onChange(raw: string) {
    setError("");
    if (isTotp) {
      const next = formatTotpInput(raw);
      setCode(next);
      if (next.length === 6) submit(next);
    } else {
      setCode(formatBackupCodeInput(raw));
    }
  }

  function onPressVerify() {
    if (!complete) {
      setError(isTotp ? "Enter the 6-digit code from your app." : "Enter all 12 characters of a backup code.");
      return;
    }
    lastSubmitted.current = ""; // a manual press may retry the same value
    submit(code);
  }

  function toggleMode() {
    setMode(isTotp ? "backup" : "totp");
    setCode("");
    setError("");
    lastSubmitted.current = "";
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Two-factor authentication</Text>
      <Text style={styles.sub}>
        {isTotp
          ? "Enter the 6-digit code from your authenticator app."
          : "Enter one of your backup codes. Each code works only once."}
      </Text>

      <View style={styles.group}>
        <Text style={styles.label}>{isTotp ? "Authentication code" : "Backup code"}</Text>
        <TextInput
          ref={inputRef}
          style={[styles.input, !!error && !locked && styles.inputError]}
          value={code}
          onChangeText={onChange}
          placeholder={isTotp ? "123456" : "XXXXXX-XXXXXX"}
          placeholderTextColor={colors.textMuted}
          keyboardType={isTotp ? "number-pad" : "default"}
          textContentType={isTotp ? "oneTimeCode" : "none"}
          autoComplete={isTotp ? (Platform.OS === "android" ? "sms-otp" : "one-time-code") : "off"}
          autoCapitalize={isTotp ? "none" : "characters"}
          autoCorrect={false}
          autoFocus
          maxLength={isTotp ? 6 : 13}
          editable={!busy && !locked}
          returnKeyType="go"
          onSubmitEditing={onPressVerify}
          accessibilityLabel={isTotp ? "Authentication code" : "Backup code"}
        />
        {error ? (
          <View style={styles.errorBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.rememberRow}>
        <Switch
          value={remember}
          onValueChange={setRemember}
          disabled={busy}
          trackColor={{ true: colors.brand }}
          accessibilityLabel="Trust this device for 30 days"
        />
        <Text style={styles.rememberText}>Trust this device for 30 days</Text>
      </View>

      <TouchableOpacity
        style={[styles.primaryButton, (busy || locked) && styles.buttonDisabled]}
        onPress={onPressVerify}
        disabled={busy || locked}
        activeOpacity={0.85}
      >
        {busy ? <ActivityIndicator color={colors.onBrand} size="small" /> : <Text style={styles.primaryText}>Verify</Text>}
      </TouchableOpacity>

      <View style={styles.linksRow}>
        <TouchableOpacity onPress={onBack} disabled={busy} style={styles.linkBtn} accessibilityRole="button">
          <Ionicons name="chevron-back" size={16} color={colors.textMuted} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={toggleMode} disabled={busy} style={styles.linkBtn} accessibilityRole="button">
          <Text style={styles.toggleText}>{isTotp ? "Use a backup code instead" : "Use authenticator app instead"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { gap: 16 },
  title: { fontSize: 22, fontWeight: "800", color: colors.textPrimary, letterSpacing: -0.4 },
  sub: { fontSize: 15, lineHeight: 22, color: colors.textMuted },
  group: { gap: 8 },
  label: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  input: {
    height: 58, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, color: colors.textPrimary,
    paddingHorizontal: 16, fontSize: 24, fontWeight: "600", textAlign: "center", letterSpacing: 4,
  },
  inputError: { borderColor: colors.danger },
  errorBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: colors.dangerBg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
  },
  errorText: { flex: 1, color: colors.danger, fontSize: 14, fontWeight: "600" },
  rememberRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  rememberText: { flex: 1, fontSize: 14, color: colors.textPrimary },
  primaryButton: {
    height: 54, borderRadius: 14, backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  primaryText: { color: colors.onBrand, fontSize: 16, fontWeight: "700" },
  linksRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  linkBtn: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  backText: { fontSize: 14, fontWeight: "600", color: colors.textMuted },
  toggleText: { fontSize: 14, fontWeight: "700", color: colors.brand },
}));
