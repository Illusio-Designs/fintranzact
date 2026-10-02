import { useRef, useState, type InputHTMLAttributes } from "react";
import { ViewIcon, ViewOffIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

/**
 * Password field with an eye button that shows or hides what was typed.
 * Accepts every normal <input> prop except `type`.
 */
export function PasswordInput({ className, disabled, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function toggle() {
    const input = inputRef.current;
    const caret = input ? [input.selectionStart, input.selectionEnd] : null;
    setVisible((v) => !v);
    // Keep the cursor in the field, where it was, so typing can carry on.
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      if (caret && caret[0] !== null && caret[1] !== null) el.setSelectionRange(caret[0], caret[1]);
    });
  }

  return (
    <div className="relative">
      <input
        {...props}
        ref={inputRef}
        disabled={disabled}
        type={visible ? "text" : "password"}
        className={cn("input pr-11", className)}
      />
      <button
        type="button"
        // Pressing the button must not pull focus out of the field.
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
        disabled={disabled}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-surface-2 hover:text-text-primary disabled:opacity-40"
      >
        <Icon icon={visible ? ViewOffIcon : ViewIcon} size={18} />
      </button>
    </div>
  );
}
