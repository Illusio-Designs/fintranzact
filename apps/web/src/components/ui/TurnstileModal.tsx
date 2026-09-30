/**
 * TurnstileModal — Bot protection via Cloudflare Turnstile in a modal.
 *
 * Flow:
 *   1. User fills a form and clicks submit.
 *   2. The form handler opens this modal instead of submitting directly.
 *   3. The modal renders the Turnstile challenge widget.
 *   4. On success, onVerified(token) fires and the modal closes.
 *   5. The form handler receives the token and completes the submission.
 *
 * In dev (no VITE_TURNSTILE_SITE_KEY), the Cloudflare test key is used
 * which always passes immediately — the modal still shows briefly so the
 * flow is exercised, then auto-closes.
 */

import { useRef, useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { SecurityCheckIcon } from "@hugeicons/core-free-icons";
import { Icon } from "./Icon";
import { Spinner } from "./Spinner";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
/** How long to wait for Cloudflare's script before telling the visitor it did not load. */
const LOAD_TIMEOUT_MS = 10_000;

/** Load the Turnstile script again (after an ad-blocker or network hiccup). */
function reloadTurnstileScript() {
  if (window.turnstile) return;
  document.querySelectorAll(`script[src^="https://challenges.cloudflare.com/turnstile/"]`).forEach((el) => el.remove());
  const script = document.createElement("script");
  script.src = SCRIPT_SRC;
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
}

type ModalState = "loading" | "ready" | "load-failed" | "check-failed";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          size: "normal" | "flexible" | "compact";
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
        },
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

interface TurnstileModalProps {
  open: boolean;
  onVerified: (token: string) => void;
  onClose: () => void;
}

export function TurnstileModal({ open, onVerified, onClose }: TurnstileModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [state, setState] = useState<ModalState>("loading");
  // Bumped by "Try again" to re-run the effect that loads and mounts the widget.
  const [attempt, setAttempt] = useState(0);

  useFocusTrap(dialogRef, open);

  const cleanup = useCallback(() => {
    if (window.turnstile && widgetIdRef.current !== null) {
      window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open || !containerRef.current) return;

    setState(window.turnstile ? "ready" : "loading");

    const sitekey =
      (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ||
      "1x00000000000000000000AA"; // Cloudflare test key — always passes

    function mount() {
      if (!containerRef.current || !window.turnstile) return;
      if (widgetIdRef.current !== null) return;
      setState("ready");

      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey,
        size: "normal",
        theme: "auto",
        callback: (token: string) => {
          onVerified(token);
        },
        "error-callback": () => setState("check-failed"),
        "expired-callback": () => setState("check-failed"),
      });
    }

    if (window.turnstile) {
      mount();
      return cleanup;
    }

    // The script is still loading, or was blocked (ad-blocker, firewall,
    // offline). Wait for it, but say so instead of showing an empty box.
    const started = Date.now();
    const interval = setInterval(() => {
      if (window.turnstile) {
        clearInterval(interval);
        mount();
      } else if (Date.now() - started > LOAD_TIMEOUT_MS) {
        clearInterval(interval);
        setState("load-failed");
      }
    }, 100);
    return () => {
      clearInterval(interval);
      cleanup();
    };
  }, [open, onVerified, cleanup, attempt]);

  const retry = () => {
    cleanup();
    if (window.turnstile) {
      setState("ready");
    } else {
      reloadTurnstileScript();
      setState("loading");
    }
    setAttempt((n) => n + 1);
  };

  // Escape key closes
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="turnstile-title"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 animate-fade-in"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-sm rounded-2xl animate-scale-in shadow-modal bg-surface-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-2 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-brand-50 dark:bg-brand-950 flex items-center justify-center">
            <Icon icon={SecurityCheckIcon} size={22} className="text-brand-600" />
          </div>
          <h2 id="turnstile-title" className="text-base font-semibold text-text-primary">
            Quick verification
          </h2>
          <p className="text-sm text-text-tertiary mt-1">
            Confirm you're not a robot to continue
          </p>
        </div>

        {/* Turnstile widget */}
        <div className="flex min-h-[65px] items-center justify-center px-6 py-5">
          {state === "loading" && (
            <span className="flex items-center gap-2 text-sm text-text-tertiary" role="status">
              <Spinner size="sm" className="text-brand-600" />
              Loading security check…
            </span>
          )}
          <div ref={containerRef} className={state === "loading" || state === "load-failed" ? "hidden" : undefined} />
        </div>

        {/* Error state */}
        {(state === "load-failed" || state === "check-failed") && (
          <div className="px-6 pb-2 text-center" role="alert">
            <p className="text-sm text-red-600 dark:text-red-400">
              {state === "load-failed"
                ? "The security check couldn't load. Check your internet connection, or pause any ad-blocker for this site, then try again."
                : "Verification failed. Please try again."}
            </p>
            <button type="button" onClick={retry} className="btn-primary mt-3">
              Try again
            </button>
          </div>
        )}

        {/* Cancel */}
        <div className="px-6 pb-5">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 text-sm text-text-tertiary hover:text-text-secondary transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
