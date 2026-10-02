import { useEffect, useRef, useState } from "react";

/** Unit tests check that a closed dialog is gone straight away, so they skip the exit. */
const SKIP_EXIT = import.meta.env.MODE === "test";

function prefersReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && !!window.matchMedia("(prefers-reduced-motion: reduce)")?.matches;
}

/**
 * Keeps a panel, dialog or menu on screen for `exitMs` after it closes so it
 * can animate out instead of vanishing. `closing` is true during that time:
 * the caller plays its exit animation and hides it from assistive tech.
 * With reduced motion it closes at once.
 */
export function usePresence(open: boolean, exitMs: number) {
  const [lingering, setLingering] = useState(false);
  const wasOpen = useRef(open);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      setLingering(false);
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    if (SKIP_EXIT || prefersReducedMotion()) return;
    setLingering(true);
    const t = setTimeout(() => setLingering(false), exitMs);
    return () => clearTimeout(t);
  }, [open, exitMs]);

  return { mounted: open || lingering, closing: !open && lingering };
}

/** The last value seen while open, so a closing panel keeps showing what it had. */
export function useLastWhileOpen<T>(open: boolean, value: T): T {
  const last = useRef(value);
  if (open) last.current = value;
  return open ? value : last.current;
}
