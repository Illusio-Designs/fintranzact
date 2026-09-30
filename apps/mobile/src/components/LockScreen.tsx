import { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useBiometricStore } from "../stores/biometric";
import { Logo } from "./ui/Logo";
import { makeStyles } from "../lib/makeStyles";
import { useColors } from "../contexts/ThemeContext";
import { haptic } from "../lib/haptics";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const PIN_LENGTH = 4;

type Mode = "biometric" | "pin";

interface LockScreenProps {
  /**
   * Called after the user successfully authenticates locally (biometric or PIN).
   * The parent is responsible for verifying the server session and calling
   * biometricStore.unlock(). While this runs the lock screen shows a
   * "Verifying..." spinner.
   */
  onUnlock: () => Promise<void>;
  /** Called when the user taps "Sign out" on the lock screen. */
  onSignOut: () => void;
}

export function LockScreen({ onUnlock, onSignOut }: LockScreenProps) {
  const {
    biometricEnabled,
    pinEnabled,
    authenticate,
    verifyPin,
  } = useBiometricStore();
  const styles = useStyles();
  const colors = useColors();

  const [mode, setMode] = useState<Mode>(biometricEnabled ? "biometric" : "pin");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [biometricFailCount, setBiometricFailCount] = useState(0);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  // Entrance animation
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  // Glow pulse animation
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [glowAnim]);

  /**
   * After a successful local authentication (biometric or PIN), show a
   * "Verifying..." state and delegate to the parent's onUnlock which
   * checks the server session.
   */
  const handleUnlockSuccess = useCallback(async () => {
    haptic.success();
    setVerifying(true);
    setError("");
    try {
      await onUnlock();
    } catch {
      // If the parent's onUnlock throws (e.g. session expired), it will
      // have already handled navigation. Reset the verifying state so
      // the lock screen is usable again if it's still mounted.
      setVerifying(false);
    }
  }, [onUnlock]);

  const triggerShake = useCallback(() => {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 4, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  // Auto-trigger biometric on mount / mode change
  useEffect(() => {
    if (mode === "biometric" && !verifying) {
      attemptBiometric();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const attemptBiometric = useCallback(async () => {
    if (verifying) return;
    const result = await authenticate();
    if (result.success) {
      handleUnlockSuccess();
    } else if (result.cancelled && pinEnabled) {
      // User tapped "Use PIN" on the system biometric dialog
      setMode("pin");
      setError("");
    } else {
      haptic.error();
      const newCount = biometricFailCount + 1;
      setBiometricFailCount(newCount);
      if (newCount >= 3 && pinEnabled) {
        setMode("pin");
        setError("Too many attempts. Use PIN instead.");
      } else {
        setError(
          pinEnabled
            ? "Authentication failed. Tap to try again, or use PIN."
            : "Authentication failed. Tap to try again."
        );
      }
    }
  }, [authenticate, biometricFailCount, handleUnlockSuccess, pinEnabled, verifying]);

  // Handle PIN digit entry
  const handlePinDigit = useCallback((digit: string) => {
    if (verifying) return;
    haptic.light();
    setError("");
    setPin((prev) => {
      if (prev.length >= PIN_LENGTH) return prev;
      const newPin = prev + digit;
      if (newPin.length === PIN_LENGTH) {
        // Verify after state update
        setTimeout(async () => {
          const valid = await verifyPin(newPin);
          if (valid) {
            handleUnlockSuccess();
          } else {
            haptic.error();
            triggerShake();
            setError("Incorrect PIN");
            setPin("");
          }
        }, 100);
      }
      return newPin;
    });
  }, [handleUnlockSuccess, triggerShake, verifyPin, verifying]);

  const handlePinDelete = useCallback(() => {
    if (verifying) return;
    haptic.light();
    setError("");
    setPin((prev) => prev.slice(0, -1));
  }, [verifying]);

  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.06, 0.15],
  });

  // Verifying state -- shown after successful local auth while token is checked
  if (verifying) {
    return (
      <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
        <Animated.View style={[styles.ambientGlow, { opacity: glowOpacity }]} />
        <View style={styles.content}>
          <LogoIcon size={64} />
          <Text style={styles.brandName}>Fintranzact</Text>
          <ActivityIndicator size="small" color={colors.heroText} style={{ marginTop: 24 }} />
          <Text style={styles.verifyingText}>Verifying session...</Text>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      {/* Ambient glow */}
      <Animated.View style={[styles.ambientGlow, { opacity: glowOpacity }]} />

      {mode === "biometric" ? (
        <View style={styles.content}>
          {/* Logo */}
          <LogoIcon size={64} />
          <Text style={styles.brandName}>Fintranzact</Text>

          {/* Fingerprint tap area */}
          <TouchableOpacity
            style={styles.biometricButton}
            onPress={attemptBiometric}
            activeOpacity={0.7}
          >
            <Ionicons name="finger-print" size={44} color={colors.heroText} />
          </TouchableOpacity>
          <Text style={styles.tapHint}>Tap to unlock</Text>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {/* Fallback to PIN */}
          {pinEnabled && (
            <>
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>
              <TouchableOpacity onPress={() => { setMode("pin"); setError(""); }} activeOpacity={0.7}>
                <Text style={styles.switchModeText}>Use PIN instead</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      ) : (
        <Animated.View style={[styles.content, { transform: [{ translateX: shakeAnim }] }]}>
          <LogoIcon size={40} />
          <Text style={styles.pinTitle}>Enter your PIN</Text>
          <Text style={styles.pinHint}>Unlock Fintranzact</Text>

          {/* Dot indicators */}
          <View style={styles.dotRow}>
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i < pin.length ? styles.dotFilled : styles.dotEmpty,
                ]}
              />
            ))}
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {/* Number pad */}
          <View style={styles.numPad}>
            {[
              ["1", "2", "3"],
              ["4", "5", "6"],
              ["7", "8", "9"],
              ["", "0", "del"],
            ].map((row, rowIndex) => (
              <View key={rowIndex} style={styles.numRow}>
                {row.map((key) => {
                  if (key === "") {
                    if (!biometricEnabled) return <View key="empty" style={styles.numKeyEmpty} />;
                    return (
                      <TouchableOpacity
                        key="bio"
                        style={styles.numKeyGhost}
                        onPress={() => {
                          setMode("biometric");
                          setError("");
                          setPin("");
                          setBiometricFailCount(0);
                        }}
                        activeOpacity={0.6}
                        accessibilityRole="button"
                        accessibilityLabel="Unlock with fingerprint"
                      >
                        <Ionicons name="finger-print" size={26} color={colors.heroText} />
                      </TouchableOpacity>
                    );
                  }
                  if (key === "del") {
                    return (
                      <TouchableOpacity
                        key="del"
                        style={styles.numKeyGhost}
                        onPress={handlePinDelete}
                        activeOpacity={0.6}
                        accessibilityRole="button"
                        accessibilityLabel="Delete"
                      >
                        <Ionicons name="backspace-outline" size={24} color={colors.heroText} />
                      </TouchableOpacity>
                    );
                  }
                  return (
                    <TouchableOpacity
                      key={key}
                      style={styles.numKey}
                      onPress={() => handlePinDigit(key)}
                      activeOpacity={0.6}
                    >
                      <Text style={styles.numKeyText}>{key}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>

        </Animated.View>
      )}

      {/* Sign out link — always visible at the bottom */}
      <TouchableOpacity style={styles.signOutButton} onPress={onSignOut} activeOpacity={0.7}>
        <Text style={styles.signOutText}>Forgot PIN? Sign out and sign in again</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

/* -- Logo ------------------------------------------------- */

function LogoIcon({ size = 64 }: { size?: number }) {
  return <Logo size={size} variant="light" />;
}

/* -- Styles ------------------------------------------------- */

const useStyles = makeStyles((colors) => ({
  // Always the navy brand surface, in light and dark mode.
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.hero,
    zIndex: 999,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  ambientGlow: {
    position: "absolute",
    width: SCREEN_WIDTH * 0.9,
    height: SCREEN_WIDTH * 0.9,
    borderRadius: SCREEN_WIDTH * 0.45,
    borderWidth: 1,
    borderColor: colors.heroText,
    top: -SCREEN_WIDTH * 0.35,
    left: -SCREEN_WIDTH * 0.3,
  },
  content: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  brandName: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.heroText,
    letterSpacing: -0.4,
    marginTop: 16,
    marginBottom: 40,
  },
  biometricButton: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.heroChip,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  tapHint: { fontSize: 15, color: colors.heroMuted, marginBottom: 8 },
  verifyingText: { fontSize: 14, color: colors.heroMuted, marginTop: 12 },
  errorText: { fontSize: 14, fontWeight: "600", color: "#fda4af", marginTop: 12, textAlign: "center" },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 32, marginBottom: 8 },
  dividerLine: { width: 40, height: 1, backgroundColor: colors.heroChip },
  dividerText: { fontSize: 12, color: colors.heroMuted },
  switchModeText: { fontSize: 15, fontWeight: "700", color: colors.heroText, paddingVertical: 12 },

  signOutButton: { position: "absolute", bottom: 40, paddingVertical: 12, paddingHorizontal: 16 },
  signOutText: { fontSize: 14, fontWeight: "700", color: colors.heroMuted },

  // PIN mode
  pinTitle: { fontSize: 22, fontWeight: "800", color: colors.heroText, marginTop: 20, letterSpacing: -0.3 },
  pinHint: { fontSize: 15, color: colors.heroMuted, marginTop: 6, marginBottom: 28 },
  dotRow: { flexDirection: "row", gap: 18, marginBottom: 8 },
  dot: { width: 16, height: 16, borderRadius: 8 },
  dotFilled: { backgroundColor: colors.heroText },
  dotEmpty: { backgroundColor: "transparent", borderWidth: 2, borderColor: colors.heroMuted },

  // Number pad
  numPad: { marginTop: 36, gap: 16 },
  numRow: { flexDirection: "row", gap: 28, justifyContent: "center" },
  numKey: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.heroChip,
    alignItems: "center",
    justifyContent: "center",
  },
  numKeyGhost: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  numKeyEmpty: { width: 72, height: 72 },
  numKeyText: { fontSize: 28, fontWeight: "600", color: colors.heroText },
}));
