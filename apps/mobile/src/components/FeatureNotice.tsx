import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import type { PlanFlagKey } from "@fintranzact/shared";
import { makeStyles } from "../lib/makeStyles";
import { useFeature } from "../hooks/useFeature";
import { openBilling, openPricing } from "../lib/entitlement";

/**
 * "Not on your plan": shown above a screen whose feature the plan lacks.
 * Existing data stays visible below it; the create button is disabled. Text
 * says which plan has it, and "See plans" opens the web billing page for an
 * owner or the public pricing page for everyone else. Renders nothing when
 * the feature is included.
 */
export function FeatureNotice({ flag }: { flag: PlanFlagKey }) {
  const styles = useStyles();
  const feature = useFeature(flag);
  if (feature.allowed) return null;
  return (
    <View style={styles.box} accessibilityRole="alert" testID="feature-notice">
      <Text style={styles.title}>{feature.featureName}: not on your plan</Text>
      <Text style={styles.body}>{feature.message} What you already have here stays visible.</Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="See plans"
        onPress={feature.canManageBilling ? openBilling : openPricing}
        style={styles.btn}
      >
        <Text style={styles.btnText}>See plans</Text>
      </TouchableOpacity>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  box: {
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 6,
  },
  title: { color: colors.textPrimary, fontWeight: "700", fontSize: 14 },
  body: { color: colors.textSecondary, fontSize: 13 },
  btn: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  btnText: { color: colors.brand, fontWeight: "700", fontSize: 14 },
}));
