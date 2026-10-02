import { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Animated,
  Easing,
  StatusBar,
} from "react-native";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { trpc } from "../../src/lib/trpc";
import { useAuthStore } from "../../src/stores/auth";
import { makeStyles } from "../../src/lib/makeStyles";
import { useColors } from "../../src/contexts/ThemeContext";
import { Logo } from "../../src/components/ui/Logo";


function ErrorBanner({ message }: { message: string }) {
  const styles = useStyles();
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorBannerText}>{message}</Text>
    </View>
  );
}


/* ─── Login screen ───────────────────────────────────────────────────────── */
export default function LoginScreen() {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [showPassword, setShowPassword] = useState(false);
  /* ── State ─────────────────────────────────────────────────────── */
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const passwordRef = useRef<TextInput>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync("sessionExpired").then((v: string | null) => {
      if (v === "1") {
        setSessionExpired(true);
        SecureStore.deleteItemAsync("sessionExpired");
      }
    });
  }, []);

  /* ── Animations ────────────────────────────────────────────────── */
  const logoAnim = useRef(new Animated.Value(0)).current;
  const formAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Logo entrance: fade + scale 0.8 -> 1.0
    Animated.timing(logoAnim, {
      toValue: 1,
      duration: 300,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();

    // Form entrance: slide up 20px + fade, delayed 200ms
    const timer = setTimeout(() => {
      Animated.timing(formAnim, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    }, 200);
    return () => clearTimeout(timer);
  }, [logoAnim, formAnim]);

  /* ── Mutations ─────────────────────────────────────────────────── */
  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async (data) => {
      setError("");
      await useAuthStore.getState().login(data.sessionToken);
      router.replace("/(app)/(home)");
    },
    onError: (err) => setError(err.message),
  });

  const isPending = loginMutation.isPending;

  /* ── Handlers ──────────────────────────────────────────────────── */
  const handlePasswordLogin = useCallback(() => {
    if (!email.includes("@") || !password) return;
    setError("");
    loginMutation.mutate({ email, password });
  }, [email, password, loginMutation]);

  /* ── Animated style values ─────────────────────────────────────── */
  const logoScale = logoAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.8, 1],
  });

  const formTranslateY = formAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [20, 0],
  });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.hero} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex1}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
          keyboardDismissMode="on-drag"
        >
          {/* ── Navy hero ─────────────────────────────────────────── */}
          <Animated.View
            style={[
              styles.hero,
              { paddingTop: insets.top + 28, opacity: logoAnim, transform: [{ scale: logoScale }] },
            ]}
          >
            <View style={styles.heroRingLarge} pointerEvents="none" />
            <View style={styles.heroRingSmall} pointerEvents="none" />
            <View style={styles.heroTopRow}>
              <View style={styles.brandRow}>
                <Logo size={46} variant="light" />
                <Text style={styles.brandName}>Fintranzact</Text>
              </View>
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroTitle}>Welcome back</Text>
              <Text style={styles.heroSub}>Sign in with your email and password.</Text>
            </View>
          </Animated.View>

          {sessionExpired && (
            <View style={styles.sessionExpiredBanner}>
              <Ionicons name="information-circle-outline" size={18} color={colors.warning} />
              <Text style={styles.sessionExpiredText}>Your session ended. Please sign in again.</Text>
            </View>
          )}

          {/* ── Form ──────────────────────────────────────────────── */}
          <Animated.View
            style={[
              styles.contentArea,
              {
                opacity: formAnim,
                transform: [{ translateY: formTranslateY }],
              },
            ]}
          >
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={(t) => {
                  setEmail(t);
                  setError("");
                }}
                placeholder="you@yourcompany.com"
                placeholderTextColor={colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                editable={!isPending}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Password</Text>
              <View style={styles.passwordField}>
                <TextInput
                  ref={passwordRef}
                  style={styles.passwordInput}
                  value={password}
                  onChangeText={(t) => {
                    setPassword(t);
                    setError("");
                  }}
                  placeholder="Enter your password"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="go"
                  onSubmitEditing={handlePasswordLogin}
                  editable={!isPending}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowPassword((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                >
                  <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            </View>

            {error ? <ErrorBanner message={error} /> : null}

            <TouchableOpacity
              style={[styles.primaryButton, (isPending || !email.includes("@") || !password) && styles.buttonDisabled]}
              onPress={handlePasswordLogin}
              disabled={isPending || !email.includes("@") || !password}
              activeOpacity={0.85}
            >
              {loginMutation.isPending ? (
                <ActivityIndicator color={colors.onBrand} size="small" />
              ) : (
                <Text style={styles.primaryButtonText}>Sign in</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => router.push("/(auth)/register")}
              activeOpacity={0.8}
            >
              <Text style={styles.secondaryButtonText}>New here? Create an account</Text>
            </TouchableOpacity>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/* ─── Styles ─────────────────────────────────────────────────────────────── */
const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  scrollContent: { flexGrow: 1 },

  hero: {
    backgroundColor: colors.hero,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: colors.heroBorder,
    paddingHorizontal: 24,
    paddingBottom: 36,
    gap: 26,
    overflow: "hidden",
  },
  heroRingLarge: {
    position: "absolute", right: -90, top: -70, width: 260, height: 260,
    borderRadius: 130, borderWidth: 1, borderColor: colors.heroChip,
  },
  heroRingSmall: {
    position: "absolute", right: -40, top: -20, width: 160, height: 160,
    borderRadius: 80, borderWidth: 1, borderColor: colors.heroChip,
  },
  heroTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandName: { fontSize: 22, fontWeight: "800", color: colors.heroText, letterSpacing: -0.4 },
  heroCopy: { gap: 10 },
  heroTitle: { fontSize: 30, lineHeight: 35, fontWeight: "800", color: colors.heroText, letterSpacing: -0.7 },
  heroSub: { fontSize: 15, lineHeight: 22, color: colors.heroMuted },

  sessionExpiredBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 24, marginTop: 20, padding: 12, borderRadius: 14,
    backgroundColor: colors.warningBg,
  },
  sessionExpiredText: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.textPrimary },

  contentArea: { paddingHorizontal: 24, paddingTop: 28, gap: 16 },
  inputGroup: { gap: 8 },
  inputLabel: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  input: {
    height: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, color: colors.textPrimary,
    paddingHorizontal: 16, fontSize: 16, fontWeight: "500",
  },
  passwordField: {
    flexDirection: "row", alignItems: "center", height: 52, borderRadius: 14,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingLeft: 16,
  },
  passwordInput: { flex: 1, height: "100%", color: colors.textPrimary, fontSize: 16, fontWeight: "500" },
  eyeButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },

  errorBanner: {
    backgroundColor: colors.dangerBg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
  },
  errorBannerText: { color: colors.danger, fontSize: 14, fontWeight: "600" },

  primaryButton: {
    height: 54, borderRadius: 14, backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#0f1b3d", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 4,
  },
  buttonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: colors.onBrand, fontSize: 16, fontWeight: "700" },


  secondaryButton: {
    flexDirection: "row", gap: 10, height: 52, borderRadius: 14, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center",
  },
  secondaryButtonText: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },



}));
