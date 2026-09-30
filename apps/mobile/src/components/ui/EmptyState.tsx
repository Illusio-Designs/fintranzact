import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles } from "../../lib/makeStyles";
import { useColors } from "../../contexts/ThemeContext";

interface Props {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
}

export function EmptyState({ icon, title, description }: Props) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={28} color={colors.brand} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {description && <Text style={styles.description}>{description}</Text>}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32, gap: 10 },
  iconWrap: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.brandLight, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  title: { fontSize: 17, fontWeight: "700", color: colors.textPrimary, textAlign: "center" },
  description: { fontSize: 13, color: colors.textMuted, textAlign: "center", lineHeight: 20 },
}));
