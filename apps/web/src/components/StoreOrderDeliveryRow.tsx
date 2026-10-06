/**
 * The delivery charge line in a store order's item table: the charge, the GST
 * on it and the rate it was taxed at, shown as one amount that includes GST
 * (the same way every item line in the table does). Renders nothing for an
 * order without a delivery charge.
 */
import { formatCurrency } from "@/lib/utils";

export interface StoreOrderDelivery {
  taxableValue: string;
  taxAmount: string;
  rate: string;
}

export function StoreOrderDeliveryRow({ delivery }: { delivery?: StoreOrderDelivery }) {
  if (!delivery || !(parseFloat(delivery.taxableValue) > 0)) return null;
  const tax = parseFloat(delivery.taxAmount);
  return (
    <tr className="border-t border-border-light" data-testid="store-order-delivery">
      <td className="px-4 py-3 font-medium text-text-primary">
        Delivery charge
        <span className="block text-xs font-normal text-text-tertiary mt-0.5">
          {formatCurrency(delivery.taxableValue)}
          {tax > 0 ? ` + GST ${formatCurrency(delivery.taxAmount)} (${parseFloat(delivery.rate)}%)` : ""}
        </span>
      </td>
      <td colSpan={2} />
      <td className="px-4 py-3 text-right font-medium tabular-nums">
        {formatCurrency(parseFloat(delivery.taxableValue) + tax)}
      </td>
    </tr>
  );
}
