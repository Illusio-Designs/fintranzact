import { ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useLastWhileOpen, usePresence } from "@/hooks/usePresence";
import { cn } from "@/lib/utils";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "./Icon";

interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * Called before any close attempt (Escape, overlay click, header X).
   * Return false to veto the close — typically used to show a "discard
   * unsaved changes?" confirm dialog. If omitted (or returns true), the
   * default onClose runs.
   */
  onCloseAttempt?: () => boolean;
}

export function SlideOver({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  onCloseAttempt,
}: SlideOverProps): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Unique per instance: two open at once (a panel over a panel) must
  // each be named by their own title.
  const titleId = useId();

  useFocusTrap(dialogRef, open);

  function attemptClose() {
    if (onCloseAttempt && onCloseAttempt() === false) return;
    onClose();
  }

  // Move focus inside the dialog when it opens (ARIA dialog best practice).
  // Prefer an element marked [autofocus] / [data-autofocus]; fall back to the
  // first focusable child.
  useEffect(() => {
    if (!open || !dialogRef.current) return;
    const target =
      dialogRef.current.querySelector<HTMLElement>("[autofocus], [data-autofocus]") ??
      dialogRef.current.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
    // Defer focus by one event-loop tick so the panel slide-in animation
    // has begun before we move focus.  setTimeout(fn, 0) is used instead
    // of requestAnimationFrame so that the timing is predictable in tests
    // (vi.useFakeTimers() + vi.runAllTimers() flushes setTimeout but rAF
    // flushing behaviour is environment-dependent in jsdom).
    const id = setTimeout(() => target?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") attemptClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose, onCloseAttempt]);

  // Slides back out when closed, still showing what it had, instead of vanishing.
  const { mounted, closing } = usePresence(open, 200);
  const shown = useLastWhileOpen(open, { title, description, children, footer });

  if (!mounted) return null;

  return createPortal(
    <div
      className={cn("fixed inset-0 z-50", closing && "pointer-events-none")}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-hidden={closing || undefined}
      inert={closing || undefined}
    >
      <div
        className={cn("fixed inset-0 bg-black/40", closing ? "animate-fade-out" : "animate-fade-in")}
        onClick={attemptClose}
      />
      <div
        ref={dialogRef}
        className={cn(
          "fixed right-0 top-0 bottom-0 w-full max-w-3xl flex flex-col shadow-modal bg-surface-0",
          closing ? "animate-slide-out" : "animate-slide-in",
        )}
      >
        <div className="flex items-start justify-between px-6 py-4 shrink-0 border-b border-border-light">
          <div>
            <h2
              id={titleId}
              className="text-base font-semibold text-text-primary"
            >
              {shown.title}
            </h2>
            {shown.description && (
              <p className="text-sm mt-0.5 text-text-tertiary">
                {shown.description}
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn-icon ml-4 shrink-0"
            onClick={attemptClose}
            aria-label="Close"
          >
            <Icon icon={Cancel01Icon} size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">{shown.children}</div>
        {shown.footer && (
          <div className="shrink-0 px-6 py-4 border-t border-border-light">
            {shown.footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
