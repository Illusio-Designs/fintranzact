import { useEffect, useState } from "react";
import { GooeyToaster } from "goey-toast";
import "goey-toast/styles.css";

/** Follows the `.dark` class that useTheme toggles on <html>. */
function useResolvedTheme(): "light" | "dark" {
  const read = () =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";
  const [theme, setTheme] = useState<"light" | "dark">(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

/**
 * App-wide toast host. Mount once (main.tsx); trigger toasts with
 * `toast()` from "@/hooks/useToast".
 */
export function ToastContainer(): React.JSX.Element {
  const theme = useResolvedTheme();
  return (
    <GooeyToaster
      position="top-right"
      theme={theme}
      duration={4000}
      closeButton="top-right"
      preset="smooth"
      showTimestamp={false}
    />
  );
}
