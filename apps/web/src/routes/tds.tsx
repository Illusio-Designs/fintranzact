import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { defaultTcsSectionRules, tdsFinancialYear, tdsQuarter, tdsSections } from "@fintranzact/shared";
import type { RouterOutputs } from "@fintranzact/api";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils";
import { badgeColor, badgeColorFallback } from "@/lib/badge-colors";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { toast } from "@/hooks/useToast";
import { PageHeader } from "@/components/ui/PageHeader";
import { PillTabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { InputField } from "@/components/ui/FormField";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";

export const Route = createFileRoute("/tds")({
  component: TdsPage,
});

type Tab = "overview" | "deductions" | "challans" | "return" | "certificates" | "settings";
/** TDS (tax we deduct on purchases) or TCS (tax we collect on sales). */
type Kind = "tds" | "tcs";

const sectionLabel = (code: string) =>
  tdsSections.find((s) => s.code === code)?.label ?? defaultTcsSectionRules("").find((s) => s.code === code)?.label ?? code;

/** The current financial year and the four before it, newest first. */
function yearOptions(): string[] {
  const current = tdsFinancialYear(new Date());
  const start = parseInt(current.slice(0, 4), 10);
  return Array.from({ length: 5 }, (_, i) => `${start - i}-${String((start - i + 1) % 100).padStart(2, "0")}`);
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="card px-5 py-4 border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800">
      <p className="text-sm text-red-700 dark:text-red-400">Failed to load data: {message}</p>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex justify-center py-12">
      <Spinner />
    </div>
  );
}

function TdsPage() {
  const years = useMemo(yearOptions, []);
  const [fy, setFy] = useState(years[0]!);
  const [tab, setTab] = useState<Tab>("overview");
  const [kind, setKind] = useState<Kind>("tds");

  return (
    <div>
      <PageHeader
        title="TDS & TCS"
        description={
          kind === "tds"
            ? "Tax deducted on your purchases and by your customers — ledgers, challans and return figures. Rates, limits and due dates change; check them with your CA."
            : "Tax you collect from customers on specified goods such as scrap — ledgers, challans and return figures. Rates, limits and due dates change; check them with your CA."
        }
        actions={
          <>
            <PillTabs
              size="sm"
              tabs={[{ value: "tds", label: "TDS" }, { value: "tcs", label: "TCS" }]}
              value={kind}
              onChange={(v) => setKind(v as Kind)}
            />
            <Select className="input w-32" value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Financial year">
              {years.map((y) => <option key={y} value={y}>FY {y}</option>)}
            </Select>
          </>
        }
      />
      <div className="mb-6">
        <PillTabs
          tabs={[
            { value: "overview", label: "Overview" },
            { value: "deductions", label: "Deductions" },
            { value: "challans", label: "Challans" },
            { value: "return", label: "Return data" },
            { value: "certificates", label: "Certificates" },
            { value: "settings", label: "Sections & limits" },
          ]}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
        />
      </div>
      {tab === "overview" && <OverviewTab fy={fy} kind={kind} />}
      {tab === "deductions" && <DeductionsTab fy={fy} kind={kind} />}
      {tab === "challans" && <ChallansTab fy={fy} kind={kind} />}
      {tab === "return" && <ReturnDataTab fy={fy} kind={kind} />}
      {tab === "certificates" && <CertificatesTab fy={fy} kind={kind} />}
      {tab === "settings" && <SettingsTab fy={fy} kind={kind} />}
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────

function OverviewTab({ fy, kind }: { fy: string; kind: Kind }) {
  const { data, isLoading, error } = trpc.tds.summary.useQuery({ financialYear: fy, kind });
  const word = kind === "tcs" ? "TCS" : "TDS";
  if (isLoading) return <Loading />;
  if (error) return <ErrorCard message={error.message} />;
  if (!data) return null;
  const { payable, receivable } = data;
  const nothing = payable.byQuarter.length === 0 && (kind === "tcs" || receivable.bySection.length === 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={kind === "tcs" ? "TCS collected (payable)" : "TDS deducted (payable)"} value={formatCurrency(payable.total)} />
        <StatCard label="Deposited" value={formatCurrency(payable.deposited)} valueColor="text-emerald-600" />
        <StatCard
          label="Still to deposit"
          value={formatCurrency(payable.pending)}
          valueColor={parseFloat(payable.pending) > 0 ? "text-amber-600" : undefined}
        />
        {kind === "tds" && <StatCard label="TDS receivable (customers)" value={formatCurrency(receivable.total)} note="Credit you claim" />}
      </div>

      {nothing && (
        <EmptyState
          title={`No ${word} this year`}
          description={kind === "tcs"
            ? "TCS appears here once you sell items that have a TCS section (such as scrap). Set the TCS section on the item to start."
            : "TDS appears here once a purchase bill crosses a section's limit, or a payment withholds tax. Set a TDS section on your suppliers to start."}
        />
      )}

      {payable.depositsDue.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border-light text-sm font-semibold text-text-primary">Deposits due</div>
          <table className="data-table">
            <thead>
              <tr><th>{kind === "tcs" ? "Collected in" : "Deducted in"}</th><th className="text-right">To deposit</th><th>Due by</th><th /></tr>
            </thead>
            <tbody>
              {payable.depositsDue.map((d) => (
                <tr key={d.month}>
                  <td>{d.month}</td>
                  <td className="text-right tabular-nums">{formatCurrency(d.pending)}</td>
                  <td>{formatDate(d.dueDate)}</td>
                  <td>{d.overdue ? <Badge size="md" color={badgeColor("red")}>Overdue</Badge> : <Badge size="md" color={badgeColorFallback}>Upcoming</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {payable.byQuarter.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border-light text-sm font-semibold text-text-primary">By quarter</div>
          <table className="data-table">
            <thead>
              <tr><th>Quarter</th><th className="text-right">Entries</th><th className="text-right">Deducted</th><th className="text-right">Deposited</th><th className="text-right">Pending</th><th>Return due</th></tr>
            </thead>
            <tbody>
              {payable.byQuarter.map((q) => (
                <tr key={q.quarter}>
                  <td>Q{q.quarter}</td>
                  <td className="text-right tabular-nums">{q.count}</td>
                  <td className="text-right tabular-nums">{formatCurrency(q.total)}</td>
                  <td className="text-right tabular-nums">{formatCurrency(q.deposited)}</td>
                  <td className="text-right tabular-nums">{formatCurrency(q.pending)}</td>
                  <td>{formatDate(q.returnDueDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {payable.bySection.length > 0 && (
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-border-light text-sm font-semibold text-text-primary">{word} payable by section</div>
            <table className="data-table">
              <thead><tr><th>Section</th><th className="text-right">Deducted</th><th className="text-right">Pending</th></tr></thead>
              <tbody>
                {payable.bySection.map((s) => (
                  <tr key={s.sectionCode}>
                    <td>{sectionLabel(s.sectionCode)}</td>
                    <td className="text-right tabular-nums">{formatCurrency(s.total)}</td>
                    <td className="text-right tabular-nums">{formatCurrency(s.pending)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {kind === "tds" && receivable.bySection.length > 0 && (
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-border-light text-sm font-semibold text-text-primary">TDS receivable by section</div>
            <table className="data-table">
              <thead><tr><th>Section</th><th className="text-right">Deducted by customers</th></tr></thead>
              <tbody>
                {receivable.bySection.map((s) => (
                  <tr key={s.sectionCode}>
                    <td>{sectionLabel(s.sectionCode)}</td>
                    <td className="text-right tabular-nums">{formatCurrency(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Deductions ────────────────────────────────────────────────

type Direction = "payable" | "receivable";

function DeductionsTab({ fy, kind }: { fy: string; kind: Kind }) {
  const [direction, setDirection] = useState<Direction>("payable");
  const word = kind === "tcs" ? "TCS" : "TDS";
  const [quarter, setQuarter] = useState<number | "">("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [challanOpen, setChallanOpen] = useState(false);

  const { data, isLoading, error } = trpc.tds.deductions.useQuery({
    financialYear: fy,
    kind,
    direction: kind === "tcs" ? "payable" : direction,
    quarter: quarter === "" ? undefined : quarter,
    deposited: pendingOnly ? false : undefined,
    limit: 200,
  });

  const rows = data?.data ?? [];
  const chosen = rows.filter((r) => selected.has(r.id));
  const chosenTotal = chosen.reduce((s, r) => s + parseFloat(r.amount), 0);
  const quarters = new Set(chosen.map((r) => r.quarter));
  const canChallan = direction === "payable" && chosen.length > 0 && quarters.size === 1;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {kind === "tds" && (
          <PillTabs
            size="sm"
            tabs={[{ value: "payable", label: "TDS payable" }, { value: "receivable", label: "TDS receivable" }]}
            value={direction}
            onChange={(v) => { setDirection(v as Direction); setSelected(new Set()); }}
          />
        )}
        <Select className="input w-28" value={quarter} onChange={(e) => { setQuarter(e.target.value ? Number(e.target.value) : ""); setSelected(new Set()); }} aria-label="Quarter">
          <option value="">All quarters</option>
          {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
        </Select>
        {direction === "payable" && (
          <label className="flex items-center gap-1.5 text-sm text-text-secondary">
            <input type="checkbox" checked={pendingOnly} onChange={(e) => { setPendingOnly(e.target.checked); setSelected(new Set()); }} />
            Not yet deposited
          </label>
        )}
        <div className="flex-1" />
        {direction === "payable" && (
          <button
            type="button"
            disabled={!canChallan}
            onClick={() => setChallanOpen(true)}
            title={quarters.size > 1 ? "A challan covers one quarter — select entries from one quarter" : undefined}
            className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            Record challan{chosen.length > 0 ? ` (${chosen.length} · ${formatCurrency(chosenTotal)})` : ""}
          </button>
        )}
      </div>

      {isLoading ? <Loading /> : error ? <ErrorCard message={error.message} /> : rows.length === 0 ? (
        <EmptyState title="No entries" description={`No ${word} entries match these filters.`} />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  {direction === "payable" && <th />}
                  <th>Date</th><th>{kind === "tcs" ? "Customer" : direction === "payable" ? "Supplier" : "Customer"}</th><th>PAN</th><th>Section</th>
                  <th className="text-right">On</th><th className="text-right">Rate</th><th className="text-right">TDS</th>
                  <th>Qtr</th>{direction === "payable" && <><th>Deposit due</th><th>Status</th></>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    {direction === "payable" && (
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.partyName}`}
                          disabled={!!r.challanId}
                          checked={selected.has(r.id)}
                          onChange={() => toggle(r.id)}
                        />
                      </td>
                    )}
                    <td className="whitespace-nowrap">{formatDate(r.deductedOn)}</td>
                    <td className="max-w-[180px] truncate">{r.partyName}</td>
                    <td className="font-mono text-[13px]">{r.partyPan ?? (r.hasPan ? "—" : <span className="text-amber-600">No PAN</span>)}</td>
                    <td>{sectionLabel(r.sectionCode)}</td>
                    <td className="text-right tabular-nums">{formatCurrency(r.baseAmount)}</td>
                    <td className="text-right tabular-nums">{parseFloat(r.rate)}%</td>
                    <td className="text-right tabular-nums font-medium">{formatCurrency(r.amount)}</td>
                    <td>Q{r.quarter}</td>
                    {direction === "payable" && (
                      <>
                        <td className="whitespace-nowrap">{formatDate(r.depositDueDate)}</td>
                        <td>
                          {r.challanId
                            ? <Badge size="md" color={badgeColor("emerald")}>Deposited</Badge>
                            : new Date(r.depositDueDate).getTime() < Date.now()
                              ? <Badge size="md" color={badgeColor("red")}>Overdue</Badge>
                              : <Badge size="md" color={badgeColor("amber")}>Pending</Badge>}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {challanOpen && (
        <ChallanModal
          fy={fy}
          kind={kind}
          quarter={[...quarters][0] as number}
          ids={chosen.map((r) => r.id)}
          taxTotal={chosenTotal}
          onClose={() => setChallanOpen(false)}
          onDone={() => { setChallanOpen(false); setSelected(new Set()); }}
        />
      )}
    </div>
  );
}

function ChallanModal({ fy, kind, quarter, ids, taxTotal, onClose, onDone }: {
  fy: string; kind: Kind; quarter: number; ids: string[]; taxTotal: number; onClose: () => void; onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const [challanNumber, setChallanNumber] = useState("");
  const [bsrCode, setBsrCode] = useState("");
  const [depositedOn, setDepositedOn] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(taxTotal.toFixed(2));
  const [interest, setInterest] = useState("0");

  const create = trpc.tds.createChallan.useMutation({
    onSuccess: () => {
      toast.success("Challan recorded");
      utils.tds.invalidate();
      onDone();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Modal open onClose={onClose} title={`Record challan — Q${quarter} FY ${fy}`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({
            financialYear: fy,
            kind,
            quarter,
            challanNumber,
            bsrCode,
            depositedOn: new Date(`${depositedOn}T12:00:00+05:30`).toISOString(),
            amount,
            interest: interest || "0",
            deductionIds: ids,
          });
        }}
      >
        <p className="text-xs text-text-tertiary">
          Marks {ids.length} TDS {ids.length === 1 ? "entry" : "entries"} ({formatCurrency(taxTotal)}) as deposited. Use the details from your ITNS 281 challan.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <InputField label="Challan serial number" required value={challanNumber} onChange={(e) => setChallanNumber(e.target.value)} maxLength={10} />
          <InputField label="BSR code (7 digits)" required value={bsrCode} onChange={(e) => setBsrCode(e.target.value.replace(/\D/g, "").slice(0, 7))} inputMode="numeric" />
          <InputField label="Date deposited" type="date" required value={depositedOn} onChange={(e) => setDepositedOn(e.target.value)} />
          <InputField label="Challan amount" required value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          <InputField label="Interest / fee included" value={interest} onChange={(e) => setInterest(e.target.value)} inputMode="decimal" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-surface-2 text-text-secondary">Cancel</button>
          <button
            type="submit"
            disabled={create.isPending || !challanNumber || bsrCode.length !== 7}
            className="px-5 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {create.isPending ? "Saving…" : "Save challan"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Challans ──────────────────────────────────────────────────

function ChallansTab({ fy, kind }: { fy: string; kind: Kind }) {
  const utils = trpc.useUtils();
  const word = kind === "tcs" ? "TCS" : "TDS";
  const { data, isLoading, error } = trpc.tds.challans.useQuery({ financialYear: fy, kind });
  const [removing, setRemoving] = useState<string | null>(null);
  const del = trpc.tds.deleteChallan.useMutation({
    onSuccess: () => { toast.success("Challan removed"); utils.tds.invalidate(); setRemoving(null); },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorCard message={error.message} />;
  if (!data || data.length === 0) {
    return <EmptyState title="No challans" description={`Select ${word} entries on the Deductions tab and record the challan you deposited them with.`} />;
  }
  return (
    <>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>Deposited</th><th>Qtr</th><th>BSR</th><th>Challan no.</th><th className="text-right">Amount</th><th className="text-right">Interest</th><th className="text-right">Linked TDS</th><th /></tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap">{formatDate(c.depositedOn)}</td>
                  <td>Q{c.quarter}</td>
                  <td className="font-mono text-[13px]">{c.bsrCode}</td>
                  <td className="font-mono text-[13px]">{c.challanNumber}</td>
                  <td className="text-right tabular-nums">{formatCurrency(c.amount)}</td>
                  <td className="text-right tabular-nums">{formatCurrency(c.interest)}</td>
                  <td className="text-right tabular-nums">{formatCurrency(c.linked)} <span className="text-text-tertiary">({c.deductionCount})</span></td>
                  <td className="text-right">
                    <button type="button" onClick={() => setRemoving(c.id)} className="text-xs text-red-600 hover:underline">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <ConfirmDialog
        open={removing !== null}
        title="Remove this challan?"
        description={`Its ${word} goes back to “not yet deposited”.`}
        confirmLabel="Remove"
        variant="danger"
        loading={del.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && del.mutate({ id: removing })}
      />
    </>
  );
}

// ── Return data ───────────────────────────────────────────────

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ReturnDataTab({ fy, kind }: { fy: string; kind: Kind }) {
  const [quarter, setQuarter] = useState<number>(tdsQuarter(new Date()));
  const word = kind === "tcs" ? "TCS" : "TDS";
  const { data, isLoading, error } = trpc.tds.returnData.useQuery({ financialYear: fy, quarter, kind });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select className="input w-28" value={quarter} onChange={(e) => setQuarter(Number(e.target.value))} aria-label="Quarter">
          {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
        </Select>
        <p className="text-sm text-text-tertiary">
          The figures for your CA or return software: who you {kind === "tcs" ? "collected from" : "deducted from"}, how much, and the challan each entry was deposited with.
        </p>
        <div className="flex-1" />
        {data && (
          <>
            <button
              type="button"
              onClick={() => downloadCsv(`${word.toLowerCase()}-deductees-${fy}-Q${quarter}.csv`, data.deducteeCsv)}
              disabled={data.rows.length === 0}
              className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
            >
              Download deductees (CSV)
            </button>
            <button
              type="button"
              onClick={() => downloadCsv(`${word.toLowerCase()}-challans-${fy}-Q${quarter}.csv`, data.challanCsv)}
              disabled={data.challans.length === 0}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-surface-2 text-text-secondary disabled:opacity-50"
            >
              Download challans (CSV)
            </button>
          </>
        )}
      </div>

      {isLoading ? <Loading /> : error ? <ErrorCard message={error.message} /> : data && (
        <>
          <div className="card px-4 py-3 text-sm flex flex-wrap gap-x-8 gap-y-1">
            <span><span className="text-text-tertiary">Deductor </span><strong>{data.deductor.name}</strong></span>
            <span><span className="text-text-tertiary">TAN </span><strong className="font-mono">{data.deductor.tan ?? "not set"}</strong></span>
            <span><span className="text-text-tertiary">PAN </span><strong className="font-mono">{data.deductor.pan ?? "—"}</strong></span>
            <span><span className="text-text-tertiary">Return due </span><strong>{formatDate(data.returnDueDate)}</strong></span>
          </div>

          {data.warnings.length > 0 && (
            <div className="card px-4 py-3 border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 space-y-1" role="alert">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Fix before filing</p>
              {data.warnings.map((w) => <p key={w} className="text-sm text-amber-800 dark:text-amber-300">{w}</p>)}
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Deductees" value={data.totals.deducteeCount} />
            <StatCard label={kind === "tcs" ? "TCS collected" : "TDS deducted"} value={formatCurrency(data.totals.deducted)} />
            <StatCard label="Deposited" value={formatCurrency(data.totals.deposited)} valueColor="text-emerald-600" />
            <StatCard label="Not on a challan" value={formatCurrency(data.totals.pending)} valueColor={parseFloat(data.totals.pending) > 0 ? "text-amber-600" : undefined} />
          </div>

          {data.rows.length === 0 ? (
            <EmptyState title={`No ${word} in Q${quarter}`} description={`No ${word} was ${kind === "tcs" ? "collected" : "deducted"} in this quarter.`} />
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Deductee</th><th>PAN</th><th>Section</th><th>Date</th>
                      <th className="text-right">Paid / credited</th><th className="text-right">Rate</th><th className="text-right">TDS</th>
                      <th>Bill</th><th>Challan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r, i) => (
                      <tr key={i}>
                        <td className="max-w-[180px] truncate">{r.partyName}</td>
                        <td className="font-mono text-[13px]">{r.pan ?? <span className="text-amber-600">PANNOTAVBL</span>}</td>
                        <td>{sectionLabel(r.sectionCode)}</td>
                        <td className="whitespace-nowrap">{formatDate(r.deductedOn)}</td>
                        <td className="text-right tabular-nums">{formatCurrency(r.baseAmount)}</td>
                        <td className="text-right tabular-nums">{parseFloat(r.rate)}%</td>
                        <td className="text-right tabular-nums font-medium">{formatCurrency(r.amount)}</td>
                        <td className="font-mono text-[13px]">{r.invoiceNumber ?? "—"}</td>
                        <td className="font-mono text-[13px]">
                          {r.challan ? `${r.challan.bsrCode} / ${r.challan.challanNumber}` : <span className="text-amber-600">Not deposited</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Certificates ──────────────────────────────────────────────

/** Download a base64 PDF the server generated. */
function downloadPdf(filename: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function CertificatesTab({ fy, kind }: { fy: string; kind: Kind }) {
  const [quarter, setQuarter] = useState<number>(tdsQuarter(new Date()));
  const [busy, setBusy] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const word = kind === "tcs" ? "TCS" : "TDS";
  const { data, isLoading, error } = trpc.tds.certificateParties.useQuery({ financialYear: fy, quarter, kind });

  async function download(partyId: string) {
    setBusy(partyId);
    try {
      const r = await utils.tds.certificate.fetch({ financialYear: fy, quarter, kind, partyId });
      downloadPdf(r.filename, r.base64);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the statement");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select className="input w-28" value={quarter} onChange={(e) => setQuarter(Number(e.target.value))} aria-label="Quarter">
          {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
        </Select>
      </div>
      <div className="card px-4 py-3 border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-300" role="note">
        These are statements generated from your books ({kind === "tcs" ? "Form 27D" : "Form 16A"} style). They are not the certificates issued through TRACES,
        which the Income Tax Department issues after the quarterly return is filed and processed.
      </div>
      {isLoading ? <Loading /> : error ? <ErrorCard message={error.message} /> : data && data.length === 0 ? (
        <EmptyState title={`No ${word} in Q${quarter}`} description={`No ${word} was ${kind === "tcs" ? "collected" : "deducted"} in this quarter.`} />
      ) : data && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{kind === "tcs" ? "Buyer" : "Deductee"}</th><th>PAN</th>
                  <th className="text-right">Entries</th><th className="text-right">{word}</th>
                  <th className="text-right">Deposited</th><th className="text-right">Pending</th><th />
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.partyId}>
                    <td className="font-medium">{r.partyName}</td>
                    <td className="font-mono">{r.pan || "—"}</td>
                    <td className="text-right tabular-nums">{r.count}</td>
                    <td className="text-right tabular-nums">{formatCurrency(r.total)}</td>
                    <td className="text-right tabular-nums">{formatCurrency(r.deposited)}</td>
                    <td className="text-right tabular-nums">{formatCurrency(r.pending)}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => download(r.partyId)}
                        disabled={busy === r.partyId}
                        className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium disabled:opacity-50"
                      >
                        {busy === r.partyId ? "Preparing…" : "Download PDF"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sections & limits ─────────────────────────────────────────

type SectionRow = RouterOutputs["tds"]["sections"]["sections"][number];

function SettingsTab({ fy, kind }: { fy: string; kind: Kind }) {
  const { data, isLoading, error } = trpc.tds.sections.useQuery({ financialYear: fy, kind });
  const [editing, setEditing] = useState<SectionRow | null>(null);
  if (isLoading) return <Loading />;
  if (error) return <ErrorCard message={error.message} />;
  if (!data) return null;
  const rupees = (v: string | null) => (v == null ? "No limit" : formatCurrency(v));

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-tertiary">
        Rates and limits are set for the year and change most Budgets. Edit a section if yours differ — verify with your CA.
        {kind === "tcs"
          ? "Set the TCS section on an item (Items → Identification) to collect TCS when you sell it."
          : "Set a section on each supplier (Parties) to deduct TDS on their bills automatically."}
      </p>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>Section</th><th className="text-right">Rate</th><th className="text-right">Individual</th><th className="text-right">No PAN</th><th className="text-right">Single limit</th><th className="text-right">Yearly limit</th><th /></tr>
            </thead>
            <tbody>
              {data.sections.map((s) => (
                <tr key={s.code} className={s.isActive ? "" : "opacity-50"}>
                  <td>
                    {s.label}
                    {s.overridden && <Badge size="sm" color={badgeColor("blue")} className="ml-2">Edited</Badge>}
                    {!s.isActive && <Badge size="sm" color={badgeColorFallback} className="ml-2">Off</Badge>}
                  </td>
                  <td className="text-right tabular-nums">{s.rate}%</td>
                  <td className="text-right tabular-nums">{s.individualRate ? `${s.individualRate}%` : "—"}</td>
                  <td className="text-right tabular-nums">{s.rateWithoutPan}%</td>
                  <td className="text-right tabular-nums">{rupees(s.singleThreshold)}</td>
                  <td className="text-right tabular-nums">{rupees(s.aggregateThreshold)}{s.excessOnly ? " (tax on excess)" : ""}</td>
                  <td className="text-right"><button type="button" onClick={() => setEditing(s)} className="text-xs text-brand-600 hover:underline">Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editing && <SectionModal fy={fy} kind={kind} section={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SectionModal({ fy, kind, section, onClose }: { fy: string; kind: Kind; section: SectionRow; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [rate, setRate] = useState(section.rate);
  const [individualRate, setIndividualRate] = useState(section.individualRate ?? "");
  const [rateWithoutPan, setRateWithoutPan] = useState(section.rateWithoutPan);
  const [single, setSingle] = useState(section.singleThreshold ?? "");
  const [aggregate, setAggregate] = useState(section.aggregateThreshold ?? "");
  const [active, setActive] = useState(section.isActive);

  const done = () => { utils.tds.invalidate(); onClose(); };
  const save = trpc.tds.updateSection.useMutation({ onSuccess: () => { toast.success("Section updated"); done(); }, onError: (e) => toast.error(e.message) });
  const reset = trpc.tds.resetSection.useMutation({ onSuccess: () => { toast.success("Back to the defaults"); done(); }, onError: (e) => toast.error(e.message) });

  return (
    <Modal open onClose={onClose} title={`${section.label} — FY ${fy}`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({
            financialYear: fy,
            sectionCode: section.code as never,
            rate, rateWithoutPan,
            individualRate: individualRate || null,
            singleThreshold: single || null,
            aggregateThreshold: aggregate || null,
            isActive: active,
          });
        }}
      >
        <div className="grid grid-cols-3 gap-3">
          <InputField label="Rate %" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" />
          {kind === "tds" && <InputField label="Individual rate %" value={individualRate} onChange={(e) => setIndividualRate(e.target.value)} inputMode="decimal" />}
          <InputField label="No-PAN rate %" value={rateWithoutPan} onChange={(e) => setRateWithoutPan(e.target.value)} inputMode="decimal" />
          <InputField label={kind === "tcs" ? "Value limit per line ₹" : "Single-payment limit ₹"} value={single} onChange={(e) => setSingle(e.target.value)} inputMode="decimal" placeholder="None" />
          {kind === "tds" && <InputField label="Yearly limit ₹" value={aggregate} onChange={(e) => setAggregate(e.target.value)} inputMode="decimal" placeholder="None" />}
        </div>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {kind === "tcs" ? "Collect TCS under this section" : "Deduct TDS under this section"}
        </label>
        <div className="flex justify-between pt-2">
          <button
            type="button"
            disabled={!section.overridden || reset.isPending}
            onClick={() => reset.mutate({ financialYear: fy, sectionCode: section.code as never })}
            className="text-sm text-text-secondary hover:underline disabled:opacity-40"
          >
            Reset to defaults
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-surface-2 text-text-secondary">Cancel</button>
            <button type="submit" disabled={save.isPending} className="px-5 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50">
              {save.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
