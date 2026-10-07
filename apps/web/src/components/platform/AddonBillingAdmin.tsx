import { useEffect, useState } from "react";
import { ADDON_IDS, AI_PACK_QUESTIONS, addonById, type AddonId } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { formatCurrency } from "@/lib/utils";
import { InputField } from "@/components/ui/FormField";

const rupees = (paise: number) => formatCurrency(paise / 100);
const fmtDate = (d: string | null) => (d ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(d)) : "—");

interface PriceRow { id: AddonId; name: string; monthly: string; yearly: string; builtIn: number; edited: boolean }

/**
 * Platform admin: add-on prices, like the plan prices (rupees before 18% GST; an empty yearly price
 * means ten months, "2 months free"), and the price of one extra AI question pack. A change applies
 * to new purchases; subscriptions already running keep the price they were bought at.
 */
export function AddonPriceEditor() {
  const utils = trpc.useUtils();
  const { data } = trpc.platform.addonPrices.useQuery();
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [pack, setPack] = useState("");
  useEffect(() => {
    if (!data) return;
    setRows(data.addons.map((a) => ({ id: a.id as AddonId, name: a.name, monthly: String(a.monthlyPriceInr), yearly: a.yearlyPriceInr === null ? "" : String(a.yearlyPriceInr), builtIn: a.builtInMonthlyPriceInr, edited: a.edited })));
    setPack(String(data.aiPack.priceInr));
  }, [data]);

  const save = trpc.platform.saveAddonPrices.useMutation({
    onSuccess: async () => {
      toast.success("Add-on prices saved", "They apply to new purchases.");
      await utils.platform.addonPrices.invalidate();
    },
    onError: (err) => toast.error("Could not save", err.message),
  });

  const isInt = (v: string) => /^\d+$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 1_000_000;
  const rowOk = (r: PriceRow) => isInt(r.monthly) && (r.yearly.trim() === "" || isInt(r.yearly));
  const valid = rows.length > 0 && rows.every(rowOk) && isInt(pack);
  const set = (i: number, patch: Partial<PriceRow>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = () => {
    if (!valid || !data) return;
    const addons: Partial<Record<AddonId, { monthlyPriceInr: number; yearlyPriceInr: number | null }>> = {};
    for (const r of rows) {
      const monthly = Number(r.monthly);
      const yearly = r.yearly.trim() === "" ? null : Number(r.yearly);
      // Only what differs from the built-in price is stored; the rest follows the code's price.
      if (monthly !== r.builtIn || yearly !== null) addons[r.id] = { monthlyPriceInr: monthly, yearlyPriceInr: yearly };
    }
    const packPrice = Number(pack);
    save.mutate({ addons, aiPackPriceInr: packPrice === data.aiPack.builtInPriceInr ? null : packPrice });
  };

  return (
    <section className="rounded-2xl border border-border-light bg-surface-0 p-4" aria-labelledby="addon-prices-heading" data-testid="addon-price-editor">
      <h2 id="addon-prices-heading" className="text-[15px] font-bold text-text-primary">Add-on prices</h2>
      <p className="mt-1 max-w-2xl text-sm text-text-tertiary">
        Monthly and yearly price per add-on, and the price of one pack of {AI_PACK_QUESTIONS} extra AI questions, in rupees before 18% GST. Leave the yearly price empty for ten months (2 months free).
        Changes apply to new purchases only.
      </p>
      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {rows.map((r, i) => (
          <div key={r.id} className="grid items-end gap-2 sm:grid-cols-[1.4fr_1fr_1fr]" data-testid={`addon-price-row-${r.id}`}>
            <p className="pb-2 text-sm font-medium text-text-primary">{addonById(r.id)?.name ?? r.id}{r.edited ? <span className="ml-2 text-xs font-normal text-amber-700">edited</span> : null}</p>
            <InputField label="Monthly ₹" type="number" inputMode="numeric" min={1} step={1} value={r.monthly} onChange={(e) => set(i, { monthly: e.target.value })} />
            <InputField label="Yearly ₹ (optional)" type="number" inputMode="numeric" min={1} step={1} value={r.yearly} onChange={(e) => set(i, { yearly: e.target.value })} />
          </div>
        ))}
        <div className="grid items-end gap-2 sm:grid-cols-[1.4fr_1fr_1fr]" data-testid="addon-price-row-ai_pack">
          <p className="pb-2 text-sm font-medium text-text-primary">Extra AI pack ({AI_PACK_QUESTIONS} questions, one-time)</p>
          <InputField label="Price ₹" type="number" inputMode="numeric" min={1} step={1} value={pack} onChange={(e) => setPack(e.target.value)} />
        </div>
        <div className="pt-1">
          <button type="submit" className="btn-primary" disabled={!valid || save.isPending}>{save.isPending ? "Saving…" : "Save add-on prices"}</button>
        </div>
      </form>
    </section>
  );
}

/** One organisation: its AI add-on subscriptions (with a free grant / revoke) and its extra-question purchases with invoices. */
export function AiPurchasesSection({ tenantId }: { tenantId: string }) {
  const utils = trpc.useUtils();
  const { data } = trpc.platform.aiPurchases.useQuery({ tenantId });
  const [addon, setAddon] = useState<AddonId>("ai_assistant");
  const [reason, setReason] = useState("");
  const done = async () => {
    await Promise.all([utils.platform.aiPurchases.invalidate({ tenantId }), utils.platform.aiCredits.invalidate({ tenantId })]);
  };
  const grant = trpc.platform.grantAddon.useMutation({
    onSuccess: async () => {
      toast.success("Add-on granted", "It runs until you revoke it and is never billed.");
      setReason("");
      await done();
    },
    onError: (err) => toast.error("Could not grant", err.message),
  });
  const revoke = trpc.platform.revokeAddon.useMutation({
    onSuccess: async () => {
      toast.success("Grant revoked");
      await done();
    },
    onError: (err) => toast.error("Could not revoke", err.message),
  });
  const valid = reason.trim().length >= 3;
  const aiIds = ADDON_IDS.filter((id) => addonById(id)?.group === "ai");

  return (
    <section className="space-y-3" aria-labelledby={`ai-purchases-${tenantId}`} data-testid="ai-purchases-section">
      <h3 id={`ai-purchases-${tenantId}`} className="text-xs font-bold uppercase tracking-wide text-text-tertiary">AI add-on and purchases</h3>

      <ul className="space-y-1 text-sm text-text-secondary" data-testid="ai-addon-list">
        {data?.addons.length === 0 ? <li>No AI add-on.</li> : null}
        {data?.addons.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-text-primary">{addonById(a.addon ?? "")?.name ?? a.addon}</span>
            <span>{a.provider === "admin" ? "granted free" : `${a.status}, ${a.cycle}${a.currentPeriodEnd ? `, to ${fmtDate(a.currentPeriodEnd)}` : ""}`}</span>
            {a.provider === "admin" ? (
              <button type="button" className="text-xs font-semibold text-red-600 hover:underline" disabled={revoke.isPending} onClick={() => revoke.mutate({ tenantId, addon: a.addon as AddonId })}>
                Revoke
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      <form
        className="grid items-end gap-2 sm:grid-cols-[10rem_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) grant.mutate({ tenantId, addon, reason: reason.trim() });
        }}
      >
        <label className="text-xs font-medium text-text-secondary">
          Grant free
          <select className="input mt-1 h-10" value={addon} onChange={(e) => setAddon(e.target.value as AddonId)} aria-label="Add-on to grant">
            {aiIds.map((id) => <option key={id} value={id}>{addonById(id)?.name}</option>)}
          </select>
        </label>
        <InputField label="Reason (kept with the grant)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button type="submit" className="btn-primary h-10" disabled={!valid || grant.isPending}>{grant.isPending ? "Granting…" : "Grant add-on"}</button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-border-light">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <caption className="sr-only">Extra question purchases</caption>
          <thead className="bg-surface-1 text-xs text-text-tertiary">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Date</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Questions</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Left</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Paid</th>
              <th scope="col" className="px-3 py-2 font-medium">Invoice</th>
            </tr>
          </thead>
          <tbody>
            {data && data.purchases.length === 0 ? <tr><td colSpan={5} className="px-3 py-3 text-text-tertiary">No purchases.</td></tr> : null}
            {data?.purchases.map((p) => (
              <tr key={p.id} className="border-t border-border-light">
                <td className="px-3 py-2">{fmtDate(p.createdAt)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.credits}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.status === "paid" ? p.creditsLeft : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.status === "paid" ? rupees(p.totalPaise) : p.status}</td>
                <td className="px-3 py-2">{p.invoiceNumber ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
