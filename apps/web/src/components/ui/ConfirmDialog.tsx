import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import { Alert02Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { IconCircle } from "./Icon";

interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  /** Label of the button that backs out (default "Cancel"). */
  cancelLabel?: string;
  variant?: "danger" | "default";
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} className="max-w-sm">
      <div className="flex items-start gap-3 pb-2">
        <IconCircle
          icon={variant === "danger" ? Delete02Icon : Alert02Icon}
          tone={variant === "danger" ? "danger" : "brand"}
          size="lg"
        />
        <div className="min-w-0 pt-0.5">
          <p className="text-sm font-semibold text-text-primary">
            {title}
          </p>
          {description && (
            <p className="text-sm mt-1.5 text-text-secondary">
              {description}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 pt-4 border-t border-border-light">
        <button
          type="button"
          className="btn-ghost"
          onClick={onCancel}
          disabled={loading}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={variant === "danger" ? "btn-danger" : "btn-primary"}
          onClick={onConfirm}
          disabled={loading}
        >
          {loading && <Spinner size="sm" />}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
