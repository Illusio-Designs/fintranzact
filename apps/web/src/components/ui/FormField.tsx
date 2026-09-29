import {
  ChangeEvent,
  ReactNode,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  useId,
} from "react";
import { cn } from "@/lib/utils";
import { Select } from "./Select";
import { DateInput } from "./DateInput";

interface FormFieldProps {
  label: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
  /** Explicit id for the control — used when you pass a custom child (e.g. Combobox) */
  htmlFor?: string;
}

export function FormField({ label, error, required, children, className, htmlFor }: FormFieldProps) {
  return (
    <div className={cn("flex flex-col", className)}>
      <label htmlFor={htmlFor} className="label">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && (
        <p className="text-xs mt-1 text-red-500">{error}</p>
      )}
    </div>
  );
}

interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  required?: boolean;
}

export function InputField({ label, error, required, className, id, ...props }: InputFieldProps) {
  // Generate a stable id so the <label htmlFor> association works even when
  // the caller does not supply an explicit id.
  const autoId = useId();
  const fieldId = id ?? autoId;
  if (props.type === "date") {
    // Dates use the custom calendar popover instead of the browser's picker.
    const { value, defaultValue, onChange, onBlur, min, max, name, disabled, autoFocus, placeholder } = props;
    return (
      <FormField label={label} error={error} required={required} htmlFor={fieldId}>
        <DateInput
          id={fieldId}
          className={className}
          value={value === undefined ? undefined : String(value ?? "")}
          defaultValue={defaultValue === undefined ? undefined : String(defaultValue)}
          onChange={(e) => onChange?.(e as unknown as ChangeEvent<HTMLInputElement>)}
          onBlur={onBlur ? () => onBlur({} as never) : undefined}
          min={min === undefined ? undefined : String(min)}
          max={max === undefined ? undefined : String(max)}
          name={name}
          disabled={disabled}
          required={required}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={props["aria-describedby"]}
          data-testid={(props as { "data-testid"?: string })["data-testid"]}
        />
      </FormField>
    );
  }
  return (
    <FormField label={label} error={error} required={required} htmlFor={fieldId}>
      <input id={fieldId} className={cn("input", className)} {...props} />
    </FormField>
  );
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}

export function SelectField({
  label,
  error,
  required,
  children,
  className,
  id,
  ...props
}: SelectFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FormField label={label} error={error} required={required} htmlFor={fieldId}>
      <Select
        id={fieldId}
        className={className}
        value={props.value as string | number | undefined}
        defaultValue={props.defaultValue as string | number | undefined}
        onChange={(e) => props.onChange?.(e as unknown as ChangeEvent<HTMLSelectElement>)}
        name={props.name}
        disabled={props.disabled}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={props["aria-describedby"]}
        data-testid={(props as { "data-testid"?: string })["data-testid"]}
      >
        {children}
      </Select>
    </FormField>
  );
}

interface TextareaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  required?: boolean;
}

export function TextareaField({
  label,
  error,
  required,
  className,
  id,
  ...props
}: TextareaFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FormField label={label} error={error} required={required} htmlFor={fieldId}>
      <textarea id={fieldId} className={cn("input", className)} {...props} />
    </FormField>
  );
}
