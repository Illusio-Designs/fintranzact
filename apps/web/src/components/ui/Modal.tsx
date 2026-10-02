import { ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useLastWhileOpen, usePresence } from "@/hooks/usePresence";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "./Icon";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
  /** Untitled modals: the id of the element inside that names the dialog. */
  labelledBy?: string;
  /** Untitled modals: the id of the element inside that describes it. */
  describedBy?: string;
}

export function Modal({ open, onClose, title, children, className, labelledBy, describedBy }: ModalProps): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Unique per instance: two open at once (a panel over a panel) must
  // each be named by their own title.
  const titleId = useId();

  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Stop propagation so that parent dialogs (SlideOver) don't also close
        e.stopImmediatePropagation();
        onClose();
      }
    };
    // Use capture phase so we intercept before the SlideOver's bubble-phase listener
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [open, onClose]);

  // Settles in from just below and fades out on close, keeping its content meanwhile.
  const { mounted, closing } = usePresence(open, 120);
  const shown = useLastWhileOpen(open, { title, children });

  if (!mounted) return null;

  return createPortal(
    <div
      className={cn("fixed inset-0 z-50 flex items-center justify-center p-4", closing && "pointer-events-none")}
      role="dialog"
      aria-modal="true"
      aria-labelledby={shown.title ? titleId : labelledBy}
      aria-describedby={describedBy}
      aria-hidden={closing || undefined}
      inert={closing || undefined}
    >
      <div
        className={cn("fixed inset-0 bg-black/40", closing ? "animate-fade-out" : "animate-fade-in")}
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        className={cn(
          "relative z-10 w-full max-w-lg rounded-xl shadow-modal bg-surface-0",
          closing ? "animate-scale-out" : "animate-dialog-in",
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {shown.title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
            <h2
              id={titleId}
              className="text-base font-semibold text-text-primary"
            >
              {shown.title}
            </h2>
            <button
              type="button"
              className="btn-icon"
              onClick={onClose}
              aria-label="Close"
            >
              <Icon icon={Cancel01Icon} size={18} />
            </button>
          </div>
        )}
        <div className="overflow-y-auto max-h-[80vh] px-6 py-4">{shown.children}</div>
      </div>
    </div>,
    document.body
  );
}
