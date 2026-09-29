import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Tooltip — a label that appears beside its trigger on hover or focus.
 *
 * WHY A PORTAL:
 * The primary caller is the collapsed sidebar rail, which sets
 * `overflow-hidden` so the nav can scroll. An absolutely-positioned tooltip
 * inside that box would be clipped at the rail's edge, which is exactly where
 * it needs to appear. Rendering into `document.body` at fixed coordinates
 * measured from the trigger sidesteps clipping and stacking contexts alike.
 *
 * WHY `display: contents` ON THE WRAPPER:
 * Callers wrap flex/grid children, so an ordinary wrapper span would insert a
 * box into the layout and break alignment. `contents` makes the wrapper
 * generate no box at all while still receiving bubbled pointer/focus events.
 */
interface TooltipProps {
  label: string;
  /** Skip rendering entirely — e.g. an expanded sidebar already shows the text. */
  disabled?: boolean;
  side?: "right" | "top";
  children: ReactNode;
}

interface Coords {
  x: number;
  y: number;
}

export function Tooltip({ label, disabled, side = "right", children }: TooltipProps) {
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const [coords, setCoords] = useState<Coords | null>(null);

  const hide = useCallback(() => setCoords(null), []);

  const show = useCallback(() => {
    if (disabled) return;
    // The wrapper itself has no box (display: contents), so measure the real
    // element the caller handed us.
    const target = wrapperRef.current?.firstElementChild;
    if (!target) return;
    const r = target.getBoundingClientRect();
    setCoords(
      side === "right"
        ? { x: r.right + 10, y: r.top + r.height / 2 }
        : { x: r.left + r.width / 2, y: r.top - 10 },
    );
  }, [disabled, side]);

  // A tooltip pinned to viewport coordinates goes stale the moment anything
  // moves, so dismiss rather than chase.
  useEffect(() => {
    if (!coords) return;
    const dismiss = () => setCoords(null);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("keydown", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("keydown", dismiss);
    };
  }, [coords]);

  useEffect(() => {
    if (disabled) setCoords(null);
  }, [disabled]);

  return (
    <span
      ref={wrapperRef}
      className="contents"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {children}
      {coords &&
        createPortal(
          <span
            role="tooltip"
            className={
              "pointer-events-none fixed z-[100] whitespace-nowrap rounded-md " +
              "bg-text-primary px-2 py-1 text-[11px] font-medium text-surface-0 shadow-lg"
            }
            style={
              side === "right"
                ? { left: coords.x, top: coords.y, transform: "translateY(-50%)" }
                : { left: coords.x, top: coords.y, transform: "translate(-50%, -100%)" }
            }
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
