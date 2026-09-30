import { Image, type ImageStyle, type StyleProp } from "react-native";

const LOGO = require("../../../assets/logo.png");
const LOGO_LIGHT = require("../../../assets/logo-light.png");

/**
 * The Fintranzact mark. `light` is the white disc with a blue mark, for navy
 * or brand-blue backgrounds (same as the web sidebar).
 */
export function Logo({
  size = 40,
  variant = "default",
  style,
}: {
  size?: number;
  variant?: "default" | "light";
  style?: StyleProp<ImageStyle>;
}) {
  return (
    <Image
      source={variant === "light" ? LOGO_LIGHT : LOGO}
      style={[{ width: size, height: size }, style]}
      accessibilityRole="image"
      accessibilityLabel="Fintranzact"
    />
  );
}
