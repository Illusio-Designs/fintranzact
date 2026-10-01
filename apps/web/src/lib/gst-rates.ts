import type { ListboxOption } from "@/components/ui/Listbox";

/**
 * GST rates an item can carry. 5%, 18% and 40% are the main slabs from
 * 22 Sep 2025; 12% and 28% stay for items still taxed at the older slabs.
 * The small rates cover gold and silver (3%), cut diamonds (1.5%), rough
 * diamonds (0.25%) and supplies to merchant exporters (0.1%).
 */
export const GST_RATE_OPTIONS: ListboxOption[] = [
  { value: "0", label: "0% (Nil / exempt)" },
  { value: "0.1", label: "0.1%" },
  { value: "0.25", label: "0.25%" },
  { value: "1.5", label: "1.5%" },
  { value: "3", label: "3%" },
  { value: "5", label: "5%" },
  { value: "12", label: "12%" },
  { value: "18", label: "18%" },
  { value: "28", label: "28%" },
  { value: "40", label: "40%" },
];

/** The option value for a stored rate ("18.00" → "18"); unknown rates pass through. */
export function gstRateValue(rate: string | number | null | undefined): string {
  const n = Number(rate ?? 0);
  return GST_RATE_OPTIONS.find((o) => Number(o.value) === n)?.value ?? String(rate ?? "0");
}

/**
 * The rate options for a field currently set to `rate`. An item saved earlier
 * with a rate outside the list keeps it as an option, so opening and saving
 * the item never changes its tax.
 */
export function gstRateOptions(rate: string | number | null | undefined): ListboxOption[] {
  const value = gstRateValue(rate);
  if (GST_RATE_OPTIONS.some((o) => o.value === value)) return GST_RATE_OPTIONS;
  return [...GST_RATE_OPTIONS, { value, label: `${Number(value)}% (current)` }];
}
