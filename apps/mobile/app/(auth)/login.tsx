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

/* ─── Types ──────────────────────────────────────────────────────────────── */
type AuthMode = "magic-link" | "magic-link-sent" | "password";

/* ─── Small pieces ───────────────────────────────────────────────────────── */
function TrustBadge({ label }: { label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.trustBadge}>
      <Text style={styles.trustBadgeText}>{label}</Text>
    </View>
  );
}

function OrDivider() {
  const styles = useStyles();
  return (
    <View style={styles.dividerRow}>
      <View style={styles.dividerLine} />
      <Text style={styles.dividerText}>or</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

function ErrorBanner({ message }: { message: string }) {
  const styles = useStyles();
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorBannerText}>{message}</Text>
    </View>
  );
}

/* ─── Shimmer Bar (animated progress indicator) ──────────────────────────── */
function ShimmerBar() {
  const styles = useStyles();
  const colors = useColors();
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [shimmerAnim]);

  const widthInterpolation = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["20%", "75%"],
  });

  const opacityInterpolation = shimmerAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 0.6, 1],
  });

  return (
    <View style={styles.shimmerTrack}>
      <Animated.View
        style={[
          styles.shimmerFill,
          {
            width: widthInterpolation,
            opacity: opacityInterpolation,
            backgroundColor: colors.brand,
          },
        ]}
      />
    </View>
  );
}

/* ─── Animated Envelope Icon ─────────────────────────────────────────────── */
function AnimatedEnvelope() {
  const styles = useStyles();
  const colors = useColors();
  const riseAnim = useRef(new Animated.Value(0)).current;
  const ringAnim = useRef(new Animated.Value(0)).current;
  const floatAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Entrance animations
    Animated.parallel([
      Animated.spring(riseAnim, {
        toValue: 1,
        damping: 12,
        stiffness: 100,
        useNativeDriver: true,
      }),
      Animated.timing(ringAnim, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    // Continuous gentle float
    const float = Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    float.start();
    return () => float.stop();
  }, [riseAnim, ringAnim, floatAnim]);

  const envelopeTranslateY = riseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 0],
  });

  const envelopeScale = riseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.85, 1],
  });

  const ringScale = ringAnim.interpolate({
    inputRange: [0, 0.6, 1],
    outputRange: [0.7, 1.15, 1],
  });

  const floatY = floatAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -6],
  });

  return (
    <View style={styles.envelopeWrapper}>
      {/* Outer ring */}
      <Animated.View
        style={[
          styles.envelopeRing,
          {
            opacity: ringAnim,
            transform: [{ scale: ringScale }],
          },
        ]}
      />
      {/* Inner circle with envelope */}
      <Animated.View
        style={[
          styles.envelopeInner,
          {
            opacity: riseAnim,
            transform: [
              { translateY: Animated.add(envelopeTranslateY, floatY) },
              { scale: envelopeScale },
            ],
          },
        ]}
      >
        <Ionicons name="mail-outline" size={34} color={colors.brand} />
      </Animated.View>
    </View>
  );
}

/* ─── Dev token input (magic-link token paste, dev builds only) ──────────── */
function DevTokenInput() {
  const styles = useStyles();
  const colors = useColors();
  const [devToken, setDevToken] = useState("");
  const [devError, setDevError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const login = useAuthStore((s) => s.login);

  const verifyMutation = trpc.auth.verifyMagicLink.useMutation({
    onSuccess: async (data) => {
      if (data.sessionToken) {
        setDevError("");
        await login(data.sessionToken);
        router.replace("/(app)/(home)");
      }
    },
    onError: (err) => {
      setDevError(err.message);
    },
  });

  const handleVerify = useCallback(() => {
    const token = devToken.trim();
    if (!token) return;
    setDevError("");
    verifyMutation.mutate({ token });
  }, [devToken, verifyMutation]);

  return (
    <View style={styles.devContainer}>
      <TouchableOpacity
        style={styles.devHeader}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.7}
      >
        <View style={styles.devBadge}>
          <Text style={styles.devBadgeText}>DEV</Text>
        </View>
        <Text style={styles.devHeaderText}>Developer Mode</Text>
        <Text style={styles.devChevron}>{expanded ? "\u25B2" : "\u25BC"}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.devBody}>
          <Text style={styles.devHint}>
            Paste the token from the API console output (the value after
            ?token= in the magic link URL).
          </Text>

          <TextInput
            style={styles.devInput}
            value={devToken}
            onChangeText={(t) => {
              setDevToken(t);
              setDevError("");
            }}
            placeholder="Paste token here"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={handleVerify}
            editable={!verifyMutation.isPending}
          />

          {devError ? (
            <View style={styles.devErrorBanner}>
              <Text style={styles.devErrorText}>{devError}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[
              styles.devButton,
              (verifyMutation.isPending || !devToken.trim()) &&
                styles.buttonDisabled,
            ]}
            onPress={handleVerify}
            disabled={verifyMutation.isPending || !devToken.trim()}
            activeOpacity={0.8}
          >
            {verifyMutation.isPending ? (
              <ActivityIndicator color={colors.onBrand} size="small" />
            ) : (
              <Text style={styles.devButtonText}>Verify Token</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
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
  const [mode, setMode] = useState<AuthMode>("magic-link");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval>>(undefined);
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
  const fadeTransition = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Logo entrance: fade + scale 0.8 -> 1.0
    Animated.timing(logoAnim, {
      toValue: 1,
      duration: 300,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();

    // Form entrance: slide up 20px + fade, delayed 200ms
    setTimeout(() => {
      Animated.timing(formAnim, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    }, 200);
  }, [logoAnim, formAnim]);

  /* ── Cooldown timer for resend ─────────────────────────────────── */
  useEffect(() => {
    if (cooldown <= 0) {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
      return;
    }
    cooldownRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          clearInterval(cooldownRef.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, [cooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Mutations ─────────────────────────────────────────────────── */
  const sendMagicLink = trpc.auth.sendMagicLink.useMutation({
    onSuccess: () => {
      setError("");
      setCooldown(60);
      switchMode("magic-link-sent");
    },
    onError: (err) => setError(err.message),
  });

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async (data) => {
      setError("");
      await useAuthStore.getState().login(data.sessionToken);
      router.replace("/(app)/(home)");
    },
    onError: (err) => setError(err.message),
  });

  const isPending = sendMagicLink.isPending || loginMutation.isPending;

  /* ── Handlers ──────────────────────────────────────────────────── */
  const switchMode = useCallback(
    (next: AuthMode) => {
      // Cross-fade transition
      Animated.timing(fadeTransition, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start(() => {
        setMode(next);
        setError("");
        Animated.timing(fadeTransition, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }).start();
      });
    },
    [fadeTransition]
  );

  const handleSendMagicLink = useCallback(() => {
    if (!email.includes("@")) return;
    setError("");
    sendMagicLink.mutate({ email, source: "mobile" });
  }, [email, sendMagicLink]);

  const handlePasswordLogin = useCallback(() => {
    if (!email.includes("@") || !password) return;
    setError("");
    loginMutation.mutate({ email, password });
  }, [email, password, loginMutation]);

  const handleResend = useCallback(() => {
    if (cooldown > 0 || sendMagicLink.isPending) return;
    sendMagicLink.mutate({ email, source: "mobile" });
    setCooldown(60);
  }, [cooldown, email, sendMagicLink]);

  /* ── Animated style values ─────────────────────────────────────── */
  const logoScale = logoAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.8, 1],
  });

  const formTranslateY = formAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [20, 0],
  });

  const heroTitle =
    mode === "password" ? "Welcome back" : mode === "magic-link-sent" ? "Check your email" : null;

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
              {mode !== "magic-link" ? (
                <TouchableOpacity
                  style={styles.heroBack}
                  onPress={() => switchMode("magic-link")}
                  accessibilityRole="button"
                  accessibilityLabel="Back"
                >
                  <Ionicons name="chevron-back" size={20} color={colors.heroText} />
                </TouchableOpacity>
              ) : null}
              <View style={styles.brandRow}>
                <Logo size={mode === "magic-link" ? 46 : 36} variant="light" />
                <Text style={mode === "magic-link" ? styles.brandName : styles.brandNameSmall}>Fintranzact</Text>
              </View>
            </View>
            {heroTitle ? (
              <View style={styles.heroCopy}>
                <Text style={styles.heroTitle}>{heroTitle}</Text>
                <Text style={styles.heroSub}>
                  {mode === "password" ? "Sign in with your email and password." : "We sent a secure sign-in link."}
                </Text>
              </View>
            ) : (
              <View style={styles.heroCopy}>
                <Text style={styles.heroHeadline}>{"Your business,\nyour books.\nAlways clear."}</Text>
                <Text style={styles.heroSub}>Invoices, GST, payments and stock.</Text>
              </View>
            )}
          </Animated.View>

          {sessionExpired && (
            <View style={styles.sessionExpiredBanner}>
              <Ionicons name="information-circle-outline" size={18} color={colors.warning} />
              <Text style={styles.sessionExpiredText}>Your session ended. Please sign in again.</Text>
            </View>
          )}

          {/* ── Form (cross-faded between modes) ──────────────────── */}
          <Animated.View
            style={[
              styles.contentArea,
              {
                opacity: Animated.multiply(formAnim, fadeTransition),
                transform: [{ translateY: formTranslateY }],
              },
            ]}
          >
            {mode === "magic-link" && (
              <>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Work email</Text>
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
                    returnKeyType="go"
                    onSubmitEditing={handleSendMagicLink}
                    editable={!isPending}
                  />
                </View>

                {error ? <ErrorBanner message={error} /> : null}

                <TouchableOpacity
                  style={[styles.primaryButton, (isPending || !email.includes("@")) && styles.buttonDisabled]}
                  onPress={handleSendMagicLink}
                  disabled={isPending || !email.includes("@")}
                  activeOpacity={0.85}
                >
                  {sendMagicLink.isPending ? (
                    <ActivityIndicator color={colors.onBrand} size="small" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Continue with email</Text>
                  )}
                </TouchableOpacity>

                <Text style={styles.helperText}>We'll email you a secure sign-in link.</Text>

                <OrDivider />

                <TouchableOpacity style={styles.secondaryButton} onPress={() => switchMode("password")} activeOpacity={0.8}>
                  <Ionicons name="lock-closed-outline" size={18} color={colors.textPrimary} />
                  <Text style={styles.secondaryButtonText}>Sign in with password</Text>
                </TouchableOpacity>

                <View style={styles.trustRow}>
                  <TrustBadge label="GST ready" />
                  <TrustBadge label="Encrypted" />
                  <TrustBadge label="Multi-business" />
                </View>
              </>
            )}

            {mode === "magic-link-sent" && (
              <View style={styles.sentContainer}>
                <AnimatedEnvelope />
                <Text style={styles.sentDescription}>We sent a sign-in link to</Text>
                <Text style={styles.sentEmail}>{email}</Text>
                <ShimmerBar />
                <Text style={styles.sentHint}>
                  The link expires in 15 minutes.{"\n"}Check your spam folder if you don't see it.
                </Text>
                <View style={styles.sentActions}>
                  <TouchableOpacity
                    style={[styles.primaryButton, (cooldown > 0 || sendMagicLink.isPending) && styles.buttonDisabled]}
                    onPress={handleResend}
                    disabled={cooldown > 0 || sendMagicLink.isPending}
                    activeOpacity={0.85}
                  >
                    {sendMagicLink.isPending ? (
                      <ActivityIndicator color={colors.onBrand} size="small" />
                    ) : (
                      <Text style={styles.primaryButtonText}>
                        {cooldown > 0 ? `Resend in ${cooldown}s` : "Send the link again"}
                      </Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondaryButton} onPress={() => switchMode("magic-link")} activeOpacity={0.8}>
                    <Text style={styles.secondaryButtonText}>Use a different email</Text>
                  </TouchableOpacity>
                </View>
                {__DEV__ && <DevTokenInput />}
              </View>
            )}

            {mode === "password" && (
              <>
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

                <OrDivider />

                <TouchableOpacity style={styles.secondaryButton} onPress={() => switchMode("magic-link")} activeOpacity={0.8}>
                  <Ionicons name="mail-outline" size={18} color={colors.textPrimary} />
                  <Text style={styles.secondaryButtonText}>Email me a sign-in link instead</Text>
                </TouchableOpacity>
              </>
            )}
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
  heroBack: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: colors.heroChip,
    alignItems: "center", justifyContent: "center",
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandName: { fontSize: 22, fontWeight: "800", color: colors.heroText, letterSpacing: -0.4 },
  brandNameSmall: { fontSize: 18, fontWeight: "800", color: colors.heroText, letterSpacing: -0.3 },
  heroCopy: { gap: 10 },
  heroHeadline: { fontSize: 32, lineHeight: 37, fontWeight: "800", color: colors.heroText, letterSpacing: -0.8 },
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
  helperText: { textAlign: "center", fontSize: 13, color: colors.textMuted },

  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { fontSize: 13, color: colors.textMuted },

  secondaryButton: {
    flexDirection: "row", gap: 10, height: 52, borderRadius: 14, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center",
  },
  secondaryButtonText: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },

  trustRow: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: 8, marginTop: 12 },
  trustBadge: { backgroundColor: colors.brandLight, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  trustBadgeText: { fontSize: 12, fontWeight: "600", color: colors.brand },

  sentContainer: { alignItems: "center", gap: 12 },
  sentActions: { alignSelf: "stretch", gap: 12, marginTop: 12 },
  sentDescription: { fontSize: 15, color: colors.textSecondary, marginTop: 4 },
  sentEmail: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  sentHint: { fontSize: 13, lineHeight: 20, color: colors.textMuted, textAlign: "center" },
  shimmerTrack: {
    alignSelf: "stretch", height: 4, borderRadius: 2, backgroundColor: colors.surfaceHover,
    overflow: "hidden", marginVertical: 8,
  },
  shimmerFill: { height: "100%", borderRadius: 2 },
  envelopeWrapper: { width: 96, height: 96, alignItems: "center", justifyContent: "center" },
  envelopeRing: {
    position: "absolute", width: 96, height: 96, borderRadius: 48,
    borderWidth: 1.5, borderColor: colors.brandLight,
  },
  envelopeInner: {
    width: 72, height: 72, borderRadius: 24, backgroundColor: colors.brandLight,
    alignItems: "center", justifyContent: "center",
  },

  devContainer: {
    alignSelf: "stretch", marginTop: 20, borderRadius: 14, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface, overflow: "hidden",
  },
  devHeader: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12 },
  devBadge: { backgroundColor: colors.warningBg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  devBadgeText: { fontSize: 11, fontWeight: "800", color: colors.warning },
  devHeaderText: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  devChevron: { fontSize: 11, color: colors.textMuted },
  devBody: { padding: 12, paddingTop: 0, gap: 10 },
  devHint: { fontSize: 12, lineHeight: 18, color: colors.textMuted },
  devInput: {
    height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bg, color: colors.textPrimary, paddingHorizontal: 12, fontSize: 14,
  },
  devErrorBanner: { backgroundColor: colors.dangerBg, borderRadius: 10, padding: 10 },
  devErrorText: { fontSize: 13, color: colors.danger },
  devButton: {
    height: 46, borderRadius: 12, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center",
  },
  devButtonText: { color: colors.onBrand, fontSize: 14, fontWeight: "700" },
}));
