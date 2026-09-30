/**
 * Delivery methods a document can go by: the built-in ones every business
 * has, plus the business's own from Settings → Shipping. The API checks
 * custom ids against the same list.
 */
import { useMemo } from "react";
import { trpc, getBusinessId } from "@/lib/trpc";

export interface DeliveryMethodOption {
  id: string;
  label: string;
  hasTracking: boolean;
  /** Built-in methods carry a line of explanation for Settings → Shipping. */
  description?: string;
  custom?: boolean;
}

export const BUILT_IN_DELIVERY_METHODS: readonly DeliveryMethodOption[] = [
  { id: "self_pickup", label: "Self Pickup", description: "Customer picks up from your location", hasTracking: false },
  { id: "hand_delivery", label: "Self / Driver", description: "Delivered by you or your delivery person", hasTracking: false },
  { id: "bus", label: "Bus / Parcel Service", description: "Sent via bus parcel — no tracking", hasTracking: false },
  { id: "transport", label: "Transport", description: "Goods transport / logistics company", hasTracking: false },
  { id: "courier", label: "Courier", description: "Courier service with tracking", hasTracking: true },
  { id: "post", label: "India Post", description: "Speed Post / Registered Post", hasTracking: true },
];

export function isBuiltInDeliveryMethodId(id: string): boolean {
  return BUILT_IN_DELIVERY_METHODS.some((m) => m.id === id);
}

type CustomMethodInput = { id: string; label: string; hasTracking: boolean };

/** Built-in methods first, then the business's own, without repeats. */
export function deliveryMethodOptions(custom: CustomMethodInput[] | null | undefined): DeliveryMethodOption[] {
  const out: DeliveryMethodOption[] = [...BUILT_IN_DELIVERY_METHODS];
  for (const m of Array.isArray(custom) ? custom : []) {
    if (!m?.id || out.some((o) => o.id === m.id)) continue;
    out.push({ id: m.id, label: m.label, hasTracking: !!m.hasTracking, custom: true });
  }
  return out;
}

/** The name to show for a stored method id; unknown ids show as they are. */
export function deliveryMethodLabel(id: string | null | undefined, options: DeliveryMethodOption[] = [...BUILT_IN_DELIVERY_METHODS]): string {
  if (!id) return "—";
  return options.find((o) => o.id === id)?.label ?? id;
}

/** Delivery methods of the active business. */
export function useDeliveryMethods(): DeliveryMethodOption[] {
  const { data: businessList } = trpc.business.list.useQuery();
  const currentBizId = getBusinessId();
  const active = businessList?.find((b) => b.id === currentBizId) ?? businessList?.[0];
  const custom = active?.customShippingMethods as CustomMethodInput[] | null | undefined;
  return useMemo(() => deliveryMethodOptions(custom), [custom]);
}
