import { mrpWarning } from "@fintranzact/shared";
import { InputField } from "@/components/ui/FormField";

/** MRP input for the item form, warning when the sale price is above it. */
export function MrpField({ value, onChange, salePrice }: { value: string; onChange: (v: string) => void; salePrice: string }) {
  const warning = mrpWarning(salePrice, value);
  return (
    <div>
      <InputField
        label="MRP (₹)"
        type="number"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Printed maximum retail price"
      />
      {warning && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400" role="alert">
          {warning}. Selling above the printed MRP isn't allowed.
        </p>
      )}
    </div>
  );
}
