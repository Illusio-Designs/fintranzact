import { isIntraStateSupply } from "@fintranzact/shared";
import { trpc } from "../lib/trpc";
import { useBusinessStore } from "../stores/business";

/**
 * Whether a document for `partyId` is intra-state (CGST + SGST, each rounded
 * at half the rate) — the place-of-supply rule the server applies when it
 * saves the document, so the on-screen totals match. A party with no state
 * is intra-state; so is everything until the business and party load.
 */
export function useIntraState(partyId: string | null | undefined): boolean {
  const businessId = useBusinessStore((s) => s.businessId);
  const { data: businesses } = trpc.business.list.useQuery();
  const biz = businesses?.find((b) => b.id === businessId) ?? businesses?.[0];
  const { data: party } = trpc.party.getById.useQuery({ id: partyId ?? "" }, { enabled: !!partyId });
  return isIntraStateSupply(biz ?? {}, party ?? {});
}
