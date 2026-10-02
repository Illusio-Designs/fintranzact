import { useCallback, useEffect, useRef, useState } from "react";

const SKIP = import.meta.env.MODE === "test";

function reducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && !!window.matchMedia("(prefers-reduced-motion: reduce)")?.matches;
}

/**
 * After a save succeeds the button shows a tick that draws itself, then the
 * panel closes. `finish(close)` runs `close` 450 ms later, or straight away
 * with reduced motion (and in unit tests).
 */
export function useSaveTick() {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const finish = useCallback((close: () => void) => {
    if (SKIP || reducedMotion()) return close();
    setSaved(true);
    timer.current = setTimeout(() => {
      setSaved(false);
      close();
    }, 450);
  }, []);

  return { saved, finish };
}
