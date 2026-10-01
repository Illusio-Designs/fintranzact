import { isIntraStateSupply } from "@fintranzact/shared";
import { getBusinessId, trpc } from "@/lib/trpc";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a POS sale to `partyId` is intra-state (CGST + SGST, each rounded
 * at half the rate) — the same place-of-supply rule the server applies when
 * it saves the invoice. A walk-in customer has no state, so it is
 * intra-state; so is everything until the business and party have loaded.
 */
export function useIntraState(partyId: string): boolean {
  const { data: businessList } = trpc.business.list.useQuery();
  const bizId = getBusinessId();
  const biz = businessList?.find((b) => b.id === bizId) ?? businessList?.[0];
  const { data: party } = trpc.party.getById.useQuery(
    { id: partyId },
    { enabled: UUID.test(partyId) },
  );
  return isIntraStateSupply(biz ?? {}, party ?? {});
}
