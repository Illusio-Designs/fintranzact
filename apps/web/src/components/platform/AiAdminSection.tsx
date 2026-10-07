import { useEffect, useState } from "react";
import { aiPriceTableSchema, AI_PACK_QUESTIONS, aiQuotaPeriod, type AiPriceTable } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { formatCurrency } from "@/lib/utils";
import { InputField } from "@/components/ui/FormField";

const rupees = (paise: number) => formatCurrency(paise / 100);
const NUM = new Intl.NumberFormat("en-IN");

/**
 * Platform admin: AI assistant usage and estimated cost per organisation for a
 * month (IST), and the price table the estimate is worked from. The cost is an
 * estimate from tokens and the table below, not the provider's invoice.
 */
export function AiAdminSection() {
  const [period, setPeriod] = useState<string>(() => aiQuotaPeriod(new Date()));
  const { data, isLoading } = trpc.platform.aiUsage.useQuery({ period });
  const periods = Array.from(new Set([aiQuotaPeriod(new Date()), ...(data?.periods ?? [])])).sort().reverse();

  return (
    <section className="rounded-2xl border border-border-light bg-surface-0 p-4" aria-labelledby="ai-usage-heading" data-testid="ai-admin-usage">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="ai-usage-heading" className="text-[15px] font-bold text-text-primary">AI assistant usage and cost</h2>
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          Month
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className="input h-9 w-auto py-0" aria-label="Month">
            {periods.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
      </div>
      <p className="mt-1 text-sm text-text-tertiary">Questions answered, tokens and the estimated provider cost per organisation. One question is one message that got an answer; refunded ones are shown apart.</p>

      <div className="mt-3 overflow-x-auto rounded-xl border border-border-light">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <caption className="sr-only">AI usage for {period}</caption>
          <thead className="bg-surface-1 text-xs text-text-tertiary">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Organisation</th>
              <th scope="col" className="px-3 py-2 font-medium">Plan</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Questions</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Refunded</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Tokens in</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Tokens out</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="px-3 py-3 text-text-tertiary">Loading…</td></tr>}
            {data?.organisations.map((o) => (
              <tr key={o.tenantId} className="border-t border-border-light">
                <th scope="row" className="px-3 py-2 font-medium text-text-primary">{o.name}</th>
                <td className="px-3 py-2 capitalize text-text-secondary">{o.plan}</td>
                <td className="px-3 py-2 text-right tabular-nums">{NUM.format(o.questions)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-text-tertiary">{NUM.format(o.refunded)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{NUM.format(o.inputTokens)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{NUM.format(o.outputTokens)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{rupees(o.costPaise)}</td>
              </tr>
            ))}
            {data && data.organisations.length === 0 && <tr><td colSpan={7} className="px-3 py-3 text-text-tertiary">No questions in {period}.</td></tr>}
          </tbody>
          {data && data.organisations.length > 0 && (
            <tfoot>
              <tr className="border-t border-border-light bg-surface-1 font-semibold">
                <th scope="row" className="px-3 py-2" colSpan={2}>Total</th>
                <td className="px-3 py-2 text-right tabular-nums">{NUM.format(data.totals.questions)}</td>
                <td />
                <td className="px-3 py-2 text-right tabular-nums">{NUM.format(data.totals.inputTokens)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{NUM.format(data.totals.outputTokens)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{rupees(data.totals.costPaise)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <AiPriceEditor />
    </section>
  );
}

interface Row { model: string; input: string; output: string }

const toRows = (t: AiPriceTable): Row[] =>
  Object.entries(t).map(([model, p]) => ({ model, input: String(p.inputPaisePerMTok / 100), output: String(p.outputPaisePerMTok / 100) }));

function toTable(rows: Row[]): unknown {
  return Object.fromEntries(rows.map((r) => [r.model.trim(), { inputPaisePerMTok: Math.round(Number(r.input) * 100), outputPaisePerMTok: Math.round(Number(r.output) * 100) }]));
}

/** The price table: rupees per million tokens, per model id. */
export function AiPriceEditor() {
  const utils = trpc.useUtils();
  const { data } = trpc.platform.aiPrices.useQuery();
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (data) setRows(toRows(data.prices));
  }, [data]);

  const save = trpc.platform.saveAiPrices.useMutation({
    onSuccess: async () => {
      toast.success("Price table saved", "It applies to questions answered from now on.");
      await utils.platform.aiPrices.invalidate();
    },
    onError: (err) => toast.error("Could not save", err.message),
  });

  const parsed = aiPriceTableSchema.safeParse(toTable(rows));
  const numbersOk = rows.every((r) => r.input.trim() !== "" && r.output.trim() !== "" && Number(r.input) >= 0 && Number(r.output) >= 0);
  const duplicate = new Set(rows.map((r) => r.model.trim())).size !== rows.length;
  const set = (i: number, patch: Partial<Row>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="mt-5" data-testid="ai-price-editor">
      <h3 className="text-sm font-semibold text-text-primary">Price table</h3>
      <p className="mt-0.5 text-xs text-text-tertiary">
        Rupees per million tokens, converted from the provider&apos;s dollar prices at the rate you choose. Used only to estimate cost.
        Fast model: {data?.models.fast ?? "…"}. Strong model: {data?.models.strong ?? "…"}.
      </p>
      <form
        className="mt-2 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (parsed.success) save.mutate(parsed.data);
        }}
      >
        {rows.map((r, i) => (
          <div key={i} className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
            <InputField label="Model id" value={r.model} onChange={(e) => set(i, { model: e.target.value })} />
            <InputField label="Input ₹ / M tokens" type="number" inputMode="decimal" min={0} step="0.01" value={r.input} onChange={(e) => set(i, { input: e.target.value })} />
            <InputField label="Output ₹ / M tokens" type="number" inputMode="decimal" min={0} step="0.01" value={r.output} onChange={(e) => set(i, { output: e.target.value })} />
            <button type="button" className="btn-secondary h-10" onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))} aria-label={`Remove ${r.model || "row"}`} disabled={rows.length <= 1}>
              Remove
            </button>
          </div>
        ))}
        {duplicate && <p className="text-xs text-red-600">Each model id can appear once.</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={() => setRows((cur) => [...cur, { model: "", input: "0", output: "0" }])}>Add a model</button>
          <button type="submit" className="btn-primary" disabled={!parsed.success || !numbersOk || duplicate || save.isPending}>
            {save.isPending ? "Saving…" : "Save price table"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** One organisation: extra question packs granted so far, and a form to grant more (admin grant; the purchase flow is separate). */
export function AiCreditsSection({ tenantId }: { tenantId: string }) {
  const utils = trpc.useUtils();
  const { data } = trpc.platform.aiCredits.useQuery({ tenantId });
  const [credits, setCredits] = useState(String(AI_PACK_QUESTIONS));
  const [reason, setReason] = useState("");
  const grant = trpc.platform.grantAiCredits.useMutation({
    onSuccess: async () => {
      toast.success("Extra questions granted");
      setReason("");
      await utils.platform.aiCredits.invalidate({ tenantId });
    },
    onError: (err) => toast.error("Could not grant", err.message),
  });
  const n = Number(credits);
  const valid = Number.isInteger(n) && n >= 1 && n <= 100_000 && reason.trim().length >= 3;

  return (
    <section className="space-y-2" aria-labelledby={`ai-credits-${tenantId}`} data-testid="ai-credits-section">
      <h3 id={`ai-credits-${tenantId}`} className="text-xs font-bold uppercase tracking-wide text-text-tertiary">AI questions · extra packs</h3>
      <p className="text-sm text-text-secondary">{data ? `${NUM.format(data.remaining)} extra question${data.remaining === 1 ? "" : "s"} left.` : "Loading…"} Extra questions are used after the questions included each month.</p>
      <form
        className="grid items-end gap-2 sm:grid-cols-[8rem_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) grant.mutate({ tenantId, credits: n, reason: reason.trim() });
        }}
      >
        <InputField label="Questions" type="number" inputMode="numeric" min={1} max={100000} step={1} value={credits} onChange={(e) => setCredits(e.target.value)} />
        <InputField label="Reason (kept with the grant)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button type="submit" className="btn-primary h-10" disabled={!valid || grant.isPending}>{grant.isPending ? "Granting…" : "Grant"}</button>
      </form>
    </section>
  );
}
