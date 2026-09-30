import { View, Text } from "react-native";
import { makeStyles } from "../../lib/makeStyles";
import { useColors } from "../../contexts/ThemeContext";
import type { Colors } from "../../lib/theme";

type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "muted";

const STATUS: Record<string, { tone: Tone; label: string }> = {
  draft: { tone: "neutral", label: "Draft" },
  unfulfilled: { tone: "info", label: "Unfulfilled" },
  sent: { tone: "info", label: "Sent" },
  paid: { tone: "success", label: "Paid" },
  partial: { tone: "warning", label: "Partial" },
  overdue: { tone: "danger", label: "Overdue" },
  cancelled: { tone: "muted", label: "Cancelled" },
  adjusted: { tone: "info", label: "Adjusted" },
  pending: { tone: "warning", label: "Pending" },
  confirmed: { tone: "info", label: "Confirmed" },
  delivered: { tone: "success", label: "Delivered" },
};

function toneColors(colors: Colors, tone: Tone): { bg: string; fg: string } {
  switch (tone) {
    case "info": return { bg: colors.brandLight, fg: colors.brand };
    case "success": return { bg: colors.successBg, fg: colors.success };
    case "warning": return { bg: colors.warningBg, fg: colors.warning };
    case "danger": return { bg: colors.dangerBg, fg: colors.danger };
    case "muted": return { bg: colors.surfaceHover, fg: colors.textMuted };
    default: return { bg: colors.surfaceHover, fg: colors.textSecondary };
  }
}

/** Status pill with a coloured dot, matching the web app. */
export function StatusBadge({ status }: { status: string }) {
  const styles = useStyles();
  const colors = useColors();
  const config = STATUS[status] ?? { tone: "neutral" as Tone, label: status.charAt(0).toUpperCase() + status.slice(1) };
  const { bg, fg } = toneColors(colors, config.tone);
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <View style={[styles.dot, { backgroundColor: fg }]} />
      <Text style={[styles.text, { color: fg }]} numberOfLines={1}>{config.label}</Text>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  badge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: "flex-start" },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 12, fontWeight: "700" },
}));
