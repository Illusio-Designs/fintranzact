import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles } from "../lib/makeStyles";
import { useColors } from "../contexts/ThemeContext";
import { useTwoFactorRequirement } from "../hooks/useTwoFactorRequirement";
import { openTwoFactorSetup } from "../lib/two-factor-enforcement";

/**
 * A notice when the organisation requires two-factor authentication and the
 * user has not set it up: a warning with the deadline during the grace period,
 * a danger alert once blocked. Renders nothing otherwise.
 */
export function TwoFactorBanner() {
  const styles = useStyles();
  const colors = useColors();
  const { banner } = useTwoFactorRequirement();
  if (!banner) return null;

  const palette = banner.tone === "danger"
    ? { bg: colors.dangerBg, fg: colors.danger, icon: "alert-circle-outline" as const }
    : { bg: colors.amberBg, fg: colors.amber, icon: "warning-outline" as const };

  return (
    <View style={[styles.container, { backgroundColor: palette.bg }]} accessibilityRole="alert" testID="two-factor-banner">
      <Ionicons name={palette.icon} size={18} color={palette.fg} />
      <View style={styles.body}>
        <Text style={styles.text}>{banner.text}</Text>
        <TouchableOpacity onPress={openTwoFactorSetup} activeOpacity={0.7} accessibilityRole="link">
          <Text style={[styles.cta, { color: palette.fg }]}>{banner.cta}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  body: { flex: 1, gap: 4 },
  text: { fontSize: 13, lineHeight: 18, color: colors.textPrimary },
  cta: { fontSize: 13, fontWeight: "700", textDecorationLine: "underline" },
}));
