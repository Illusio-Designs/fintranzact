import { gooeyToast } from "goey-toast";

type ToastVariant = "success" | "error" | "info" | "warning";

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** A button inside the toast, e.g. "Try again", "View", "Undo". */
  action?: ToastAction;
  /** Override how long it stays (ms). Infinity keeps it until closed. */
  duration?: number;
}

/** Errors and warnings stay longer so there is time to read what to do next. */
const DURATION: Record<ToastVariant, number> = { success: 4000, info: 4000, warning: 6000, error: 6000 };

/**
 * Show a toast notification. All toasts are rendered by goey-toast's
 * <GooeyToaster />, mounted once by <ToastContainer /> in main.tsx.
 * Returns the toast id so callers can dismiss it early.
 */
export function toast(options: ToastOptions): string | number {
  const variant = options.variant ?? "info";
  return gooeyToast[variant](options.title, {
    description: options.description,
    action: options.action,
    duration: options.duration ?? DURATION[variant],
    showTimestamp: false,
  });
}

toast.success = (title: string, description?: string, action?: ToastAction) =>
  toast({ title, description, variant: "success", action });
toast.error = (title: string, description?: string, action?: ToastAction) =>
  toast({ title, description, variant: "error", action });
toast.info = (title: string, description?: string, action?: ToastAction) =>
  toast({ title, description, variant: "info", action });
toast.warning = (title: string, description?: string, action?: ToastAction) =>
  toast({ title, description, variant: "warning", action });
toast.dismiss = (id?: string | number) => gooeyToast.dismiss(id);

/**
 * One toast that goes from "Saving…" to "Saved" (or to the error) in place.
 * Usage: toast.promise(save(), { loading: "Saving invoice…", success: "Invoice saved", error: "Couldn't save" })
 */
toast.promise = <T,>(
  promise: Promise<T>,
  messages: { loading: string; success: string | ((data: T) => string); error: string | ((err: unknown) => string) },
) => {
  gooeyToast.promise(promise, { ...messages, showTimestamp: false });
  return promise;
};
