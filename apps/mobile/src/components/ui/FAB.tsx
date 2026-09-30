import { TouchableOpacity, Text, ViewStyle, StyleProp } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles } from "../../lib/makeStyles";
import { haptic } from "../../lib/haptics";
import { useColors } from "../../contexts/ThemeContext";

interface Props {
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
  /** Show a text label next to the icon ("New invoice"). */
  label?: string;
  /** Screen-reader label when there is no visible text. */
  accessibilityLabel?: string;
}

export function FAB({ onPress, icon = "add", style, label, accessibilityLabel }: Props) {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const colors = useColors();

  return (
    <TouchableOpacity
      style={[styles.fab, label ? styles.extended : null, { bottom: 24 + insets.bottom }, style]}
      accessibilityRole="button"
      accessibilityLabel={label ?? accessibilityLabel ?? "Add"}
      onPress={() => { haptic.medium(); onPress(); }}
      activeOpacity={0.8}
    >
      <Ionicons name={icon} size={label ? 22 : 28} color={colors.onBrand} />
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((colors) => ({
  fab: {
    position: "absolute",
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    elevation: 8,
    shadowColor: "#0f1b3d",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
  },
  extended: { width: "auto", flexDirection: "row", gap: 8, paddingLeft: 16, paddingRight: 20 },
  label: { color: colors.onBrand, fontSize: 15, fontWeight: "700" },
}));
