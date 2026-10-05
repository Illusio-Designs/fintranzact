import { View, Text, TouchableOpacity, Alert, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../lib/trpc";
import { formatDate } from "../lib/utils";
import { makeStyles } from "../lib/makeStyles";
import { useColors } from "../contexts/ThemeContext";
import { haptic } from "../lib/haptics";

const CHANNEL_LABEL: Record<string, string> = { email: "Email", sms: "SMS", whatsapp: "WhatsApp" };
const KIND_LABEL: Record<string, string> = {
  before_due: "Before the due date",
  on_due: "On the due date",
  after_due: "Overdue follow-up",
  manual: "Sent by hand",
};
const STATUS_LABEL: Record<string, string> = { sent: "Sent", failed: "Failed", link_opened: "Link opened", sending: "Sending" };

/** The reminder history and "send now" actions for a sale invoice (mirrors the web invoice panel). */
export function InvoiceReminders({ invoiceId }: { invoiceId: string }) {
  const styles = useStyles();
  const colors = useColors();
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.reminder.getForInvoice.useQuery({ invoiceId });

  const send = trpc.reminder.sendNow.useMutation({
    onSuccess: (res) => {
      haptic.success();
      void utils.reminder.getForInvoice.invalidate({ invoiceId });
      if (res.channel === "whatsapp") {
        if (res.url) Linking.openURL(res.url).catch(() => Alert.alert("Error", "Could not open WhatsApp."));
      } else {
        Alert.alert("Reminder sent", res.channel === "email" ? "The email reminder was sent." : "The SMS reminder was sent.");
      }
    },
    onError: (err) => {
      void utils.reminder.getForInvoice.invalidate({ invoiceId });
      Alert.alert("Could not send the reminder", err.message);
    },
  });

  if (isLoading || !data) return null;

  const { channels, history } = data;
  const blocked = data.blockedReason !== null;
  const state = data.doNotRemind
    ? "This customer is marked Do not remind, so no reminders are sent."
    : data.remindersEnabled
      ? "Automatic reminders are on. They stop when the invoice is paid."
      : "Automatic reminders are off. The owner can turn them on in Settings on the web.";

  const action = (key: "email" | "sms", label: string, icon: React.ComponentProps<typeof Ionicons>["name"]) => {
    const ch = channels[key];
    return (
      <TouchableOpacity
        key={key}
        style={[styles.chip, (!ch.available || send.isPending) && styles.chipDisabled]}
        disabled={!ch.available || send.isPending}
        onPress={() => send.mutate({ invoiceId, channel: key })}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={ch.reason ?? undefined}
        activeOpacity={0.7}
      >
        <Ionicons name={icon} size={14} color={colors.brand} style={{ marginRight: 6 }} />
        <Text style={styles.chipText}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <>
      <Text style={styles.sectionTitle}>Payment Reminders</Text>
      <View style={styles.card} testID="invoice-reminders">
        <Text style={styles.note} testID="reminder-state">{state}</Text>

        {blocked ? (
          <Text style={styles.muted} testID="reminder-blocked">{data.blockedReason}</Text>
        ) : (
          <>
            <View style={styles.chipRow}>
              {action("email", "Send email reminder", "mail-outline")}
              {action("sms", "Send SMS reminder", "chatbubble-outline")}
              <TouchableOpacity
                style={[styles.chip, (!channels.whatsapp.available || send.isPending) && styles.chipDisabled]}
                disabled={!channels.whatsapp.available || send.isPending}
                onPress={() => send.mutate({ invoiceId, channel: "whatsapp" })}
                accessibilityRole="button"
                accessibilityLabel="Send on WhatsApp"
                accessibilityHint={channels.whatsapp.reason ?? undefined}
                activeOpacity={0.7}
              >
                <Ionicons name="logo-whatsapp" size={14} color={colors.success} style={{ marginRight: 6 }} />
                <Text style={[styles.chipText, { color: colors.success }]}>Send on WhatsApp</Text>
              </TouchableOpacity>
            </View>
            {[channels.email.reason && `Email: ${channels.email.reason}`, channels.sms.reason && `SMS: ${channels.sms.reason}`]
              .filter(Boolean)
              .map((line) => (
                <Text key={String(line)} style={styles.muted}>{line}</Text>
              ))}
          </>
        )}

        {history.length === 0 ? (
          <Text style={styles.muted} testID="reminder-history-empty">No reminders sent yet.</Text>
        ) : (
          <View testID="reminder-history">
            {history.map((h) => (
              <View key={h.id} style={styles.historyRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyTitle}>
                    {CHANNEL_LABEL[h.channel] ?? h.channel}, {KIND_LABEL[h.kind] ?? h.kind}
                  </Text>
                  <Text style={styles.muted}>
                    {formatDate(h.createdAt)} by {h.trigger === "auto" ? "Automatic" : (h.sentByName ?? "Team member")}
                    {h.recipient ? ` to ${h.recipient}` : ""}
                  </Text>
                  {h.error ? <Text style={[styles.muted, { color: colors.danger }]}>{h.error}</Text> : null}
                </View>
                <Text style={[styles.status, h.status === "failed" && { color: colors.danger }]}>{STATUS_LABEL[h.status] ?? h.status}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.textMuted,
    marginTop: 16,
    marginBottom: 8,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 10,
  },
  note: { fontSize: 13, color: colors.textSecondary },
  muted: { fontSize: 12, color: colors.textMuted },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipDisabled: { opacity: 0.45 },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.brand },
  historyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  historyTitle: { fontSize: 13, fontWeight: "600", color: colors.textPrimary },
  status: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
}));
