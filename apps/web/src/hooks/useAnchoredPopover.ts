import { useCallback, useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

interface Options {
  /** Popover width. "anchor" matches the trigger's width. */
  width?: number | "anchor";
  /** Estimated popover height, used to decide whether to flip above the trigger. */
  estimatedHeight?: number;
  gap?: number;
}

/**
 * Positions a portal-rendered popover (fixed positioning) next to its trigger
 * so it is never clipped by an `overflow: hidden` table, card or modal body.
 * Flips above the trigger when there is not enough room below, and keeps the
 * popover inside the viewport horizontally.
 */
export function useAnchoredPopover(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  { width = "anchor", estimatedHeight = 280, gap = 6 }: Options = {},
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ position: "fixed", top: -9999, left: -9999 });

  const update = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = width === "anchor" ? rect.width : width;
    const left = Math.max(8, Math.min(rect.left, vw - w - 8));
    const spaceBelow = vh - rect.bottom;
    const flip = spaceBelow < estimatedHeight + gap && rect.top > spaceBelow;
    setStyle({
      position: "fixed",
      left,
      width: w,
      ...(flip ? { bottom: vh - rect.top + gap } : { top: rect.bottom + gap }),
    });
  }, [anchorRef, width, estimatedHeight, gap]);

  useLayoutEffect(() => {
    if (!open) return;
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, update]);

  return style;
}
