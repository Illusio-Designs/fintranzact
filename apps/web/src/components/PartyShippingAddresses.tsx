import type { PartyShippingAddress } from "@fintranzact/shared";
import { InputField, TextareaField } from "@/components/ui/FormField";
import { Select } from "@/components/ui/Select";
import { Icon } from "@/components/ui/Icon";
import { Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { INDIAN_STATES } from "@/lib/indian-states";

export type ShippingAddressDraft = Required<Pick<PartyShippingAddress, "address">> & {
  label: string;
  city: string;
  stateCode: string;
  pincode: string;
};

export const emptyShippingAddress = (): ShippingAddressDraft => ({
  label: "",
  address: "",
  city: "",
  stateCode: "",
  pincode: "",
});

/** Drafts with an address → API payload (state name filled from the code). */
export function shippingAddressesPayload(drafts: ShippingAddressDraft[]): PartyShippingAddress[] | undefined {
  const filled = drafts.filter((d) => d.address.trim());
  if (filled.length === 0) return undefined;
  return filled.map((d) => ({
    label: d.label.trim() || undefined,
    address: d.address.trim(),
    city: d.city.trim() || undefined,
    stateCode: d.stateCode || undefined,
    state: INDIAN_STATES.find((s) => s.code === d.stateCode)?.name,
    pincode: d.pincode.trim() || undefined,
  }));
}

/**
 * Extra delivery locations for a party. Each "Add shipping address" click adds
 * a blank set of address fields; the trash button removes one.
 */
export function PartyShippingAddresses({
  value,
  onChange,
}: {
  value: ShippingAddressDraft[];
  onChange: (next: ShippingAddressDraft[]) => void;
}) {
  function update(index: number, patch: Partial<ShippingAddressDraft>) {
    onChange(value.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  return (
    <div className="space-y-3">
      {value.map((draft, index) => (
        <div key={index} data-testid={`shipping-address-${index + 2}`} className="rounded-lg border border-border-light p-3 space-y-3">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <InputField
                label={`Shipping address ${index + 2} — label`}
                value={draft.label}
                onChange={(e) => update(index, { label: e.target.value })}
                placeholder="e.g. Pune warehouse"
              />
            </div>
            <button
              type="button"
              className="btn-ghost text-red-600 mb-0.5"
              onClick={() => onChange(value.filter((_, i) => i !== index))}
              aria-label={`Remove shipping address ${index + 2}`}
            >
              <Icon icon={Delete02Icon} size={16} />
            </button>
          </div>
          <TextareaField
            label="Address"
            rows={2}
            value={draft.address}
            onChange={(e) => update(index, { address: e.target.value })}
            placeholder="Street, area..."
          />
          <div className="grid grid-cols-3 gap-3">
            <InputField
              label="City"
              value={draft.city}
              onChange={(e) => update(index, { city: e.target.value })}
            />
            <div>
              <label className="label">State</label>
              <Select
                className="input w-full"
                value={draft.stateCode}
                onChange={(e) => update(index, { stateCode: e.target.value })}
                aria-label={`Shipping address ${index + 2} state`}
              >
                <option value="">Select state</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </Select>
            </div>
            <InputField
              label="Pincode"
              value={draft.pincode}
              onChange={(e) => update(index, { pincode: e.target.value.replace(/\D/g, "").slice(0, 6) })}
              inputMode="numeric"
            />
          </div>
        </div>
      ))}

      <button
        type="button"
        className="btn-secondary w-full justify-center"
        onClick={() => onChange([...value, emptyShippingAddress()])}
        disabled={value.length >= 20}
      >
        <Icon icon={Add01Icon} size={16} />
        Add shipping address
      </button>
    </div>
  );
}
