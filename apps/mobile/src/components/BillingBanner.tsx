import React, { useCallback, useEffect, useState } from "react";
import { AppState, View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";
import dayjs from "dayjs";
import { trpc } from "../lib/trpc";
import { makeStyles } from "../lib/makeStyles";
import { useColors } from "../contexts/ThemeContext";
import { bannerFor } from "../lib/billing-banner";
import { openBilling, setCanManageBilling } from "../lib/entitlement";

const DISMISS_KEY = "fintranzact_trial_banner_dismissed";

/**
 * One persistent notice about the organisation's billing state, shown under
 * the maintenance banner. Renders nothing for free / active organisations.
 * Mobile has no billing screens: the action opens the web billing page.
 */
export function BillingBanner() {
  const styles = useStyles();
  const colors = useColors();
  const { data: status, refetch } = trpc.billing.status.useQuery(undefined, { staleTime: 60_000, retry: 1 });
  const [dismissedDay, setDismissedDay] = useState<string | null>(null);

  useEffect(() => {
    setCanManageBilling(status?.canManageBilling ?? null);
  }, [status?.canManageBilling]);

  useEffect(() => {
    SecureStore.getItemAsync(DISMISS_KEY)
      .then((v) => setDismissedDay(v))
      .catch(() => {});
  }, []);

  // Refetch when the app returns to the foreground (e.g. after paying on the web).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void refetch();
    });
    return () => sub.remove();
  }, [refetch]);

  const today = dayjs().format("YYYY-MM-DD");
  const dismiss = useCallback(() => {
    setDismissedDay(today);
    SecureStore.setItemAsync(DISMISS_KEY, today).catch(() => {});
  }, [today]);

  const spec = bannerFor(status, { today, dismissedDay });
  if (!spec) return null;

  const palette = {
    danger: { bg: colors.dangerBg, fg: colors.danger, icon: "alert-circle-outline" as const },
    warning: { bg: colors.amberBg, fg: colors.amber, icon: "warning-outline" as const },
    info: { bg: colors.brandLight, fg: colors.brand, icon: "information-circle-outline" as const },
  }[spec.tone];

  return (
    <View
      style={[styles.container, { backgroundColor: palette.bg }]}
      accessibilityRole="alert"
      testID="billing-banner"
    >
      <Ionicons name={palette.icon} size={18} color={palette.fg} />
      <View style={styles.body}>
        <Text style={styles.text}>
          <Text style={styles.title}>{spec.title}</Text> {spec.text}
        </Text>
        {spec.cta ? (
          <TouchableOpacity onPress={openBilling} activeOpacity={0.7} accessibilityRole="link">
            <Text style={[styles.cta, { color: palette.fg }]}>{spec.cta}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {spec.dismissible ? (
        <TouchableOpacity onPress={dismiss} accessibilityLabel="Dismiss trial reminder for today" hitSlop={8}>
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  body: { flex: 1, gap: 4 },
  text: { fontSize: 13, lineHeight: 18, color: colors.textPrimary },
  title: { fontWeight: "700" },
  cta: { fontSize: 13, fontWeight: "700", textDecorationLine: "underline" },
}));
