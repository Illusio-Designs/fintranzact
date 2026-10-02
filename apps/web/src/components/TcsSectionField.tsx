import { defaultTcsSectionRules } from "@fintranzact/shared";
import { Select } from "@/components/ui/Select";

interface Props {
  value: string;
  onChange: (code: string) => void;
}

/**
 * The TCS (s.206C) section of an item that is specified goods, such as scrap.
 * Sales of the item collect tax at source from the customer, with the invoice.
 */
export function TcsSectionField({ value, onChange }: Props) {
  // Rates shown are the defaults; a business can edit them per year under TDS & TCS.
  const sections = defaultTcsSectionRules("");
  const picked = sections.find((s) => s.code === value);
  return (
    <div>
      <label className="label mb-1 block" htmlFor="item-tcs-section">TCS section (s.206C)</label>
      <Select
        id="item-tcs-section"
        aria-label="TCS section"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg text-sm outline-none"
      >
        <option value="">Not applicable</option>
        {sections.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
      </Select>
      <p className="mt-1 text-xs text-text-tertiary">
        {picked
          ? `Sales of this item collect ${picked.rate}% TCS from the customer${picked.singleThreshold ? ` when a line is above ₹${Number(picked.singleThreshold).toLocaleString("en-IN")}` : ""}, with the invoice. Verify the rate with your CA.`
          : "Only for specified goods such as scrap, minerals or alcohol. Leave blank for everything else."}
      </p>
    </div>
  );
}
