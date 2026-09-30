import { useMemo } from "react";
import { StyleSheet } from "react-native";
import { useColors } from "../contexts/ThemeContext";
import { withBrandFont, type Colors } from "./theme";

/**
 * Build a theme-aware StyleSheet. Returns a hook so styles recompute whenever
 * the active palette changes. Text styles (anything with a `fontSize` or
 * `fontWeight`) get the brand font for their weight automatically.
 *
 *   const useStyles = makeStyles((colors) => ({
 *     container: { backgroundColor: colors.bg },
 *   }));
 *
 *   function Screen() {
 *     const styles = useStyles();
 *     return <View style={styles.container} />;
 *   }
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: Colors) => T,
): () => T {
  return function useStyles(): T {
    const colors = useColors();
    return useMemo(() => StyleSheet.create(applyBrandFonts(factory(colors))), [colors]);
  };
}

function applyBrandFonts<T extends StyleSheet.NamedStyles<T>>(styles: T): T {
  const out = {} as Record<string, unknown>;
  for (const [key, style] of Object.entries(styles as unknown as Record<string, Record<string, unknown>>)) {
    out[key] = withBrandFont(style);
  }
  return out as T;
}
