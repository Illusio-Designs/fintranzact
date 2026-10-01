/**
 * field-error-toast.ts — every form error is shown as one goey toast.
 *
 * Form fields (FormField, PhoneInput, GSTIN / PAN / Pincode inputs) call
 * `useFieldErrorToast(label, error)`. When a field's error appears or
 * changes, it is queued; errors that appear in the same moment (a Save that
 * fails several checks at once) are grouped into one toast:
 *   "Enter a valid email address"            — one field
 *   "Fix 3 fields" · "Party name, GSTIN, Pincode" — several
 * The field itself keeps a red outline (aria-invalid) and its message stays
 * available to screen readers, so nothing is lost by not printing it below
 * the field. If the person just pressed a button (Save), the cursor moves to
 * the first field with a problem.
 */
import { useEffect, useRef } from "react";
import { toast } from "@/hooks/useToast";

interface Pending {
  label: string;
  message: string;
}

let queue: Pending[] = [];
let scheduled = false;
let lastShown = "";
let lastShownAt = 0;

function flush() {
  scheduled = false;
  const items = queue;
  queue = [];
  if (!items.length) return;

  const key = items.map((i) => i.label + ":" + i.message).join("|");
  // The same problem reported twice in quick succession (re-render, StrictMode)
  // shows once.
  if (key === lastShown && Date.now() - lastShownAt < 1500) return;
  lastShown = key;
  lastShownAt = Date.now();

  if (items.length === 1) {
    toast({ title: items[0].message, variant: "error" });
  } else {
    const names = items.map((i) => i.label).filter(Boolean);
    toast({
      title: `Fix ${items.length} fields`,
      description: names.length ? names.join(", ") : items.map((i) => i.message).join(" · "),
      variant: "error",
    });
  }

  // Right after Save (focus is on a button), take the person to the first
  // field that needs fixing. While typing in a field, leave focus alone.
  const active = typeof document !== "undefined" ? document.activeElement : null;
  if (active && (active.tagName === "BUTTON" || active === document.body)) {
    requestAnimationFrame(() => {
      const first = document.querySelector<HTMLElement>('[aria-invalid="true"]');
      first?.focus({ preventScroll: false });
    });
  }
}

/** Queue one field's error for the next toast. */
export function reportFieldError(label: string, message: string) {
  queue.push({ label, message });
  if (!scheduled) {
    scheduled = true;
    // Let every field that errors in this render report first.
    setTimeout(flush, 0);
  }
}

/** Show `error` as a toast when it appears or changes. */
export function useFieldErrorToast(label: string, error: string | undefined | null | false) {
  const previous = useRef<string>("");
  useEffect(() => {
    const now = error || "";
    if (now && now !== previous.current) reportFieldError(label, now);
    previous.current = now;
  }, [label, error]);
}

/** Test helper: forget what was last shown. */
export function resetFieldErrorToast() {
  queue = [];
  scheduled = false;
  lastShown = "";
  lastShownAt = 0;
}
