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
 * True while a screen without the app's top bar is showing (sign-in,
 * register). Those screens set `data-no-topbar` on <html>.
 */
function useNoTopBar(): boolean {
  const read = () => typeof document !== "undefined" && document.documentElement.hasAttribute("data-no-topbar");
  const [noTopBar, setNoTopBar] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setNoTopBar(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-no-topbar"] });
    return () => observer.disconnect();
  }, []);
  return noTopBar;
}

function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  // Some test setups stub matchMedia with a function that returns nothing.
  const media = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? (window.matchMedia(query) as MediaQueryList | undefined)
      : undefined;
  const [reduce, setReduce] = useState(() => !!media()?.matches);
  useEffect(() => {
    const mq = media();
    if (!mq?.addEventListener) return;
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}

/**
 * App-wide toast host. Mount once (main.tsx); trigger toasts with
 * `toast()` from "@/hooks/useToast".
 */
export function ToastContainer(): React.JSX.Element {
  const theme = useResolvedTheme();
  const reduceMotion = usePrefersReducedMotion();
  const noTopBar = useNoTopBar();
  return (
    <GooeyToaster
      position="top-right"
      // Sit below the 64px top bar so toasts never cover the bell or
      // "New invoice" button. Sign-in screens have no top bar.
      offset={noTopBar ? 16 : 76}
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
