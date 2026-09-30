import { Platform } from "react-native";

/**
 * Palette values are kept in sync with the web app (`apps/web/src/styles/globals.css`
 * and `apps/web/tailwind.config.js`) so web, desktop and mobile look the same:
 * navy `#0f1b3d` text and hero surfaces, brand blue `#3b5eaa`, a cool grey
 * page with white cards in light mode and deep navy in dark mode.
 *
 * - `brand` is the button / active colour; put text on it with `onBrand`.
 * - `hero*` style the navy highlight cards (totals, invoice amount, lock screen).
 * - Semantic colours (success / warning / danger / info) come with a soft
 *   `*Bg` tint for pills and banners.
 */

export type Colors = {
  bg: string;
  surface: string;
  surfaceHover: string;
  border: string;
  borderLight: string;
  brand: string;
  brandLight: string;
  brandDark: string;
  /** Text and icons placed on a `brand` background. */
  onBrand: string;
  /** Navy highlight card and the lock screen. */
  hero: string;
  heroBorder: string;
  heroText: string;
  heroMuted: string;
  /** Translucent chip / tile on a `hero` surface. */
  heroChip: string;
  /** Floating tab bar and sticky bottom bars. */
  bar: string;
  amber: string;
  amberBg: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  success: string;
  successBg: string;
  danger: string;
  dangerBg: string;
  warning: string;
  warningBg: string;
  info: string;
  infoBg: string;
};

export const lightColors: Colors = {
  bg: "#f4f6fb",
  surface: "#ffffff",
  surfaceHover: "#eef2f9",
  border: "#e3e8f2",
  borderLight: "#e9edf5",
  brand: "#3b5eaa",
  brandLight: "#e8eefa",
  brandDark: "#2f4f95",
  onBrand: "#ffffff",
  hero: "#0f1b3d",
  heroBorder: "#223261",
  heroText: "#ffffff",
  heroMuted: "#b3bfdd",
  heroChip: "rgba(255, 255, 255, 0.09)",
  bar: "rgba(255, 255, 255, 0.96)",
  amber: "#d97706",
  amberBg: "#fdf1dc",
  textPrimary: "#0f1b3d",
  textSecondary: "#56627d",
  textMuted: "#6b7690",
  success: "#15803d",
  successBg: "#e3f4e8",
  danger: "#b42318",
  dangerBg: "#fdebea",
  warning: "#b45309",
  warningBg: "#fdf1dc",
  info: "#2563eb",
  infoBg: "#e6efff",
};

export const darkColors: Colors = {
  bg: "#070c1b",
  surface: "#0f1730",
  surfaceHover: "#16203d",
  border: "#212c4d",
  borderLight: "#1a2442",
  brand: "#86a4ea",
  brandLight: "#1a2649",
  brandDark: "#6f8fdc",
  onBrand: "#0a1024",
  hero: "#131f42",
  heroBorder: "#26356a",
  heroText: "#ffffff",
  heroMuted: "#a9b7dd",
  heroChip: "rgba(255, 255, 255, 0.08)",
  bar: "rgba(15, 23, 48, 0.96)",
  amber: "#fbbf24",
  amberBg: "#33260b",
  textPrimary: "#eaeef8",
  textSecondary: "#a3aecb",
  textMuted: "#8390b0",
  success: "#4ade80",
  successBg: "#12301f",
  danger: "#fb7185",
  dangerBg: "#3a1620",
  warning: "#fbbf24",
  warningBg: "#33260b",
  info: "#60a5fa",
  infoBg: "#132647",
};

/**
 * Legacy default export — kept as `darkColors` so that any import path we
 * haven't migrated yet continues to render the dark palette (the only one
 * mobile shipped with before multi-theme support). Prefer `useColors()` from
 * `contexts/ThemeContext` in new and migrated code.
 */
export const colors: Colors = darkColors;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  full: 999,
} as const;

export const fonts = {
  mono: Platform.OS === "ios" ? "Menlo" : "monospace",
} as const;

/**
 * Brand typefaces, loaded in `app/_layout.tsx`: DM Sans for text and
 * Plus Jakarta Sans for headings and big numbers (same as the web app).
 * Custom fonts ship one file per weight, so a weight is picked by family
 * name rather than `fontWeight`.
 */
export const fontFamilies = {
  body: {
    400: "DMSans_400Regular",
    500: "DMSans_500Medium",
    600: "DMSans_600SemiBold",
    700: "DMSans_700Bold",
    800: "DMSans_800ExtraBold",
  },
  display: {
    600: "PlusJakartaSans_600SemiBold",
    700: "PlusJakartaSans_700Bold",
    800: "PlusJakartaSans_800ExtraBold",
  },
} as const;

type Weight = 400 | 500 | 600 | 700 | 800;

function toWeight(fontWeight: unknown): Weight {
  if (fontWeight === "bold") return 700;
  const n = Number(fontWeight);
  if (!Number.isFinite(n) || n <= 400) return 400;
  if (n >= 800) return 800;
  return (Math.round(n / 100) * 100) as Weight;
}

/** Headings: bold text at 20px and up uses the display face. */
const DISPLAY_MIN_SIZE = 20;

/**
 * Give a text style the brand font for its weight. Styles that already name
 * a `fontFamily` (monospace numbers, icons) are left alone.
 */
export function withBrandFont<T extends { fontFamily?: string; fontWeight?: unknown; fontSize?: number }>(style: T): T {
  if (style.fontFamily || (style.fontWeight === undefined && style.fontSize === undefined)) return style;
  const weight = toWeight(style.fontWeight);
  const display = weight >= 600 && (style.fontSize ?? 0) >= DISPLAY_MIN_SIZE;
  const fontFamily = display
    ? fontFamilies.display[weight === 600 ? 600 : weight === 700 ? 700 : 800]
    : fontFamilies.body[weight];
  const { fontWeight: _dropped, ...rest } = style;
  return { ...rest, fontFamily } as T;
}
