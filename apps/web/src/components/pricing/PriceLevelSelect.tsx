import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { Listbox } from "@/components/ui/Listbox";

/** Price levels of the business, cached for every picker on the page. */
function usePriceLevels() {
  return trpc.priceLevel.list.useQuery(undefined, { staleTime: 60_000 });
}

/**
 * Pick a party's price level. "" means the business default. Renders nothing
 * while the business has no price levels.
 */
export function PriceLevelSelect({
  value,
  onChange,
  label = "Price level",
}: {
  value: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  const { data } = usePriceLevels();
  if (!data || data.length === 0) return null;
  const def = data.find((l) => l.isDefault);
  const options = [
    { value: "", label: def ? `Default (${def.name})` : "Item sale price" },
    ...data.map((l) => ({ value: l.id, label: l.name })),
  ];
  return <Listbox label={label} value={value} onChange={onChange} options={options} />;
}

/** A party's price level on its detail view, changeable in place. */
export function PartyPriceLevel({ partyId, priceLevelId }: { partyId: string; priceLevelId: string | null }) {
  const utils = trpc.useUtils();
  const { data } = usePriceLevels();
  const update = trpc.party.update.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.party.getById.invalidate({ id: partyId }), utils.party.list.invalidate(), utils.priceLevel.list.invalidate()]);
      toast({ title: "Price level updated", variant: "success" });
    },
    onError: (e) => toast({ title: "Couldn't change the price level", description: e.message, variant: "error" }),
  });
  if (!data || data.length === 0) return null;
  return (
    <div className="max-w-[240px]">
      <PriceLevelSelect
        value={priceLevelId ?? ""}
        onChange={(id) => update.mutate({ id: partyId, data: { priceLevelId: id || null } })}
      />
    </div>
  );
}
