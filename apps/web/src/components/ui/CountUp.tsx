import { useEffect, useRef, useState } from "react";

const SKIP = import.meta.env.MODE === "test";

function reducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && !!window.matchMedia("(prefers-reduced-motion: reduce)")?.matches;
}

/**
 * A figure that rolls up to its value the first time it appears (600 ms),
 * then simply shows new values when the data refreshes. Off with reduced
 * motion, so screen readers and tests always see the real number.
 */
export function CountUp({ value, format, duration = 600 }: { value: number; format: (n: number) => string; duration?: number }) {
  const animated = useRef(false);
  const [shown, setShown] = useState(() => (SKIP || reducedMotion() || !Number.isFinite(value) ? value : 0));

  useEffect(() => {
    if (animated.current || SKIP || reducedMotion() || !Number.isFinite(value) || value === 0) {
      animated.current = true;
      setShown(value);
      return;
    }
    animated.current = true;
    let raf = 0;
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      setShown(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      setShown(value);
    };
  }, [value, duration]);

  return <>{format(shown)}</>;
}
