import { ReactNode } from "react";
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from "react-native";
import { cleanOtp } from "@fintranzact/shared";
import { makeStyles } from "../../lib/makeStyles";
import { useColors } from "../../contexts/ThemeContext";

/** Small building blocks of the GST filing flow: big touch targets, text labels for every state. */

export function Btn({
  label,
  onPress,
  disabled,
  busy,
  variant = "primary",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: "primary" | "secondary" | "link";
}) {
  const styles = useStyles();
  const colors = useColors();
  const off = !!disabled || !!busy;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={[styles.btn, variant === "primary" && styles.btnPrimary, variant === "secondary" && styles.btnSecondary, variant === "link" && styles.btnLink, off && styles.btnOff]}
    >
      {busy && <ActivityIndicator size="small" color={variant === "primary" ? colors.onBrand : colors.brand} />}
      <Text style={[styles.btnText, variant === "primary" ? styles.btnTextPrimary : styles.btnTextOther]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const styles = useStyles();
  return (
    <TouchableOpacity
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={styles.check}
    >
      <View style={[styles.box, value && styles.boxOn]}>{value && <Text style={styles.tick}>✓</Text>}</View>
      <Text style={styles.checkText}>{label}</Text>
    </TouchableOpacity>
  );
}

const TONES = { info: "infoBg", warning: "warningBg", error: "dangerBg", success: "successBg" } as const;

export function Note({ tone = "info", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View
      accessibilityRole={tone === "error" ? "alert" : undefined}
      accessibilityLiveRegion={tone === "error" || tone === "warning" ? "assertive" : "polite"}
      style={[styles.note, { backgroundColor: colors[TONES[tone]] }]}
    >
      <Text style={styles.noteText}>{children}</Text>
    </View>
  );
}

export function H({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return (
    <Text accessibilityRole="header" style={styles.h}>
      {children}
    </Text>
  );
}

export function P({ children, muted }: { children: ReactNode; muted?: boolean }) {
  const styles = useStyles();
  return <Text style={muted ? styles.pMuted : styles.p}>{children}</Text>;
}

export function Field({
  label,
  value,
  onChangeText,
  help,
  numeric,
  disabled,
  autoCapitalize,
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  help?: string;
  numeric?: boolean;
  disabled?: boolean;
  autoCapitalize?: "none" | "characters";
  maxLength?: number;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        editable={!disabled}
        keyboardType={numeric ? "decimal-pad" : "default"}
        autoCapitalize={autoCapitalize ?? "none"}
        autoCorrect={false}
        maxLength={maxLength}
        placeholderTextColor={colors.textMuted}
      />
      {help ? <Text style={styles.help}>{help}</Text> : null}
    </View>
  );
}

/** Numeric one-time-password field: number keypad, autofill from SMS, digits only. Never stored or logged. */
export function OtpField({ label, value, onChangeText, autoFocus = true }: { label: string; value: string; onChangeText: (v: string) => void; autoFocus?: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={[styles.input, styles.otp]}
        value={value}
        onChangeText={(t) => onChangeText(cleanOtp(t))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        autoCorrect={false}
        autoFocus={autoFocus}
        maxLength={12}
        placeholder="------"
        placeholderTextColor={colors.textMuted}
      />
    </View>
  );
}

export function KV({ k, v, testID }: { k: string; v: string; testID?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.kv} testID={testID}>
      <Text style={styles.k}>{k}</Text>
      <Text style={styles.v}>{v}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  btn: { minHeight: 48, borderRadius: 12, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  btnPrimary: { backgroundColor: colors.brand },
  btnSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  btnLink: { backgroundColor: "transparent" },
  btnOff: { opacity: 0.5 },
  btnText: { fontSize: 15, fontWeight: "600" },
  btnTextPrimary: { color: colors.onBrand },
  btnTextOther: { color: colors.brand },
  check: { flexDirection: "row", alignItems: "flex-start", gap: 10, minHeight: 44, paddingVertical: 4 },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.textMuted, alignItems: "center", justifyContent: "center", marginTop: 1 },
  boxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  tick: { color: colors.onBrand, fontSize: 14, fontWeight: "700" },
  checkText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.textPrimary },
  note: { borderRadius: 12, padding: 12 },
  noteText: { fontSize: 13, lineHeight: 19, color: colors.textPrimary },
  h: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
  p: { fontSize: 14, lineHeight: 20, color: colors.textSecondary },
  pMuted: { fontSize: 12, lineHeight: 18, color: colors.textMuted },
  field: { gap: 4 },
  label: { fontSize: 13, fontWeight: "600", color: colors.textPrimary },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 12, fontSize: 16, color: colors.textPrimary },
  otp: { fontSize: 22, letterSpacing: 6, textAlign: "center" },
  help: { fontSize: 12, lineHeight: 17, color: colors.textMuted },
  kv: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 4 },
  k: { flex: 1, fontSize: 13, color: colors.textMuted },
  v: { fontSize: 13, fontWeight: "600", color: colors.textPrimary, textAlign: "right", flexShrink: 1 },
}));
