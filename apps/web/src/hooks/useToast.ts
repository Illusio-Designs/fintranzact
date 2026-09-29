import { gooeyToast } from "goey-toast";

type ToastVariant = "success" | "error" | "info" | "warning";

interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

/**
 * Show a toast notification. All toasts are rendered by goey-toast's
 * <GooeyToaster />, mounted once by <ToastContainer /> in main.tsx.
 * Returns the toast id so callers can dismiss it early.
 */
export function toast(options: ToastOptions): string | number {
  const show = gooeyToast[options.variant ?? "info"];
  return show(options.title, options.description ? { description: options.description } : undefined);
}

toast.success = (title: string, description?: string) =>
  toast({ title, description, variant: "success" });
toast.error = (title: string, description?: string) =>
  toast({ title, description, variant: "error" });
toast.info = (title: string, description?: string) =>
  toast({ title, description, variant: "info" });
toast.warning = (title: string, description?: string) =>
  toast({ title, description, variant: "warning" });
toast.dismiss = (id?: string | number) => gooeyToast.dismiss(id);
