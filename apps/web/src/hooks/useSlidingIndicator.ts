import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Places a highlight behind the selected button in a row of tabs, so it can
 * glide from one tab to the next. Buttons carry `data-value`. The first
 * placement doesn't animate, so a page never opens with a sliding tab.
 */
export function useSlidingIndicator<T extends HTMLElement>(value: string) {
  const ref = useRef<T>(null);
  const [style, setStyle] = useState<CSSProperties>({ opacity: 0 });
  const placed = useRef(false);

  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const place = () => {
      const el = [...box.querySelectorAll<HTMLElement>("[data-value]")].find((b) => b.dataset.value === value);
      // Nothing measured (hidden, or no layout): the button keeps its own highlight.
      if (!el || !el.offsetWidth) return setStyle({ opacity: 0 });
      setStyle({
        left: el.offsetLeft,
        top: el.offsetTop,
        width: el.offsetWidth,
        height: el.offsetHeight,
        opacity: 1,
        transitionProperty: placed.current ? "left, top, width, height" : "none",
      });
      placed.current = true;
    };
    place();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(place);
    ro.observe(box);
    return () => ro.disconnect();
  }, [value]);

  /** True once the highlight sits behind a tab; until then the tab paints its own. */
  const ready = style.opacity === 1;
  return { ref, style, ready };
}
