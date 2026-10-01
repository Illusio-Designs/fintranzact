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

function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const supported = typeof window !== "undefined" && typeof window.matchMedia === "function";
  const [reduce, setReduce] = useState(() => supported && window.matchMedia(query).matches);
  useEffect(() => {
    if (!supported) return;
    const mq = window.matchMedia(query);
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [supported]);
  return reduce;
}

/**
 * App-wide toast host. Mount once (main.tsx); trigger toasts with
 * `toast()` from "@/hooks/useToast".
 */
export function ToastContainer(): React.JSX.Element {
  const theme = useResolvedTheme();
  const reduceMotion = usePrefersReducedMotion();
  return (
    <GooeyToaster
      position="top-right"
      // Sit below the 64px top bar so toasts never cover the bell or
      // "New invoice" button.
      offset={76}
      theme={theme}
      duration={4000}
      visibleToasts={3}
      closeButton="top-right"
      preset={reduceMotion ? "subtle" : "smooth"}
      spring={!reduceMotion}
      showTimestamp={false}
    />
  );
}
