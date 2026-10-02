import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { Add01Icon, ArrowRight01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { trpc } from "@/lib/trpc";
import { invalidateStockViews } from "@/lib/stock-cache";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate, todayISODate, toISOString, cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { SlideOver } from "@/components/ui/SlideOver";
import { InputField, TextareaField } from "@/components/ui/FormField";
import { Listbox } from "@/components/ui/Listbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { Pagination } from "@/components/ui/Pagination";
import { TableScroll } from "@/components/ui/Table";
import { usePageSize } from "@/hooks/usePageSize";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { WarehouseSelect, formatQty, parseUnitKey, unitKey } from "@/components/inventory/shared";
import { UnitCombobox, type UnitChoice } from "@/components/inventory/UnitCombobox";

export const Route = createFileRoute("/manufacturing")({
  component: ManufacturingPage,
});

const QTY = /^\d+(\.\d{1,3})?$/;
const MONEY = /^\d+(\.\d{1,2})?$/;

type Line = { key: string; unitKey: string; info: UnitChoice | null; standard: string | null; quantity: string };
type Cost = { key: string; label: string; amount: string };

let seq = 0;
const nextKey = () => `m${++seq}`;
const newLine = (): Line => ({ key: nextKey(), unitKey: "", info: null, standard: null, quantity: "" });

function ManufacturingPage() {
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("manufacturing", 25);
  const tableRef = useRef<HTMLDivElement>(null);
  const { data, isFetching } = trpc.manufacturing.journals.useQuery(
    { page, limit: pageSize },
    // Keep the current page on screen while the next one loads.
    { placeholderData: (prev) => prev },
  );
  const [formOpen, setFormOpen] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const [viewing, setViewing] = useState<string | null>(null);
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Back to page 1 when rows per page change.
  useEffect(() => { setPage(1); }, [pageSize]);
  // Cancelling or deleting the last row of the last page: step back a page.
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  // A new page starts at its first row.
  useEffect(() => { tableRef.current?.scrollTo({ top: 0 }); }, [page]);

  const openForm = () => {
    setFormVersion((v) => v + 1);
    setFormOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Manufacturing"
        description="Record production: components come out of stock, the finished item goes in, costed from what went into it."
        actions={<button className="btn-primary" onClick={openForm}>+ Manufacture</button>}
      />

      <div className="card overflow-clip">
        {!data ? (
          <SkeletonRows />
        ) : data.data.length === 0 ? (
          <EmptyState
            title="Nothing manufactured yet"
            description="Each production run is kept here as a manufacturing journal, newest first."
            action={<button className="btn-primary" onClick={openForm}>Manufacture</button>}
          />
        ) : (
          <div className={cn("transition-opacity", isFetching && "opacity-60")}>
            <Pagination
              placement="top"
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              total={total}
              pageSize={pageSize}
            />
            <TableScroll ref={tableRef}>
              <table className="data-table w-full">
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Date</th>
                    <th>Item made</th>
                    <th className="text-right">Quantity</th>
                    <th>Components from → To</th>
                    <th className="text-right">Cost</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((j) => (
                    <tr key={j.id} className="cursor-pointer" onClick={() => setViewing(j.id)}>
                      <td className="whitespace-nowrap font-medium text-text-primary">{j.journalNumber}</td>
                      <td className="whitespace-nowrap text-text-secondary">{formatDate(j.date)}</td>
                      <td>
                        <p className="font-medium text-text-primary">{j.itemName}</p>
                        {j.bomName && <p className="text-xs text-text-tertiary">{j.bomName}</p>}
                      </td>
                      <td className="text-right tabular-nums">{formatQty(j.quantity, j.unit)}</td>
                      <td>
                        <span className="inline-flex items-center gap-1.5 text-text-secondary">
                          {j.sourceName}
                          <Icon icon={ArrowRight01Icon} size={14} className="text-text-tertiary" />
                          {j.destinationName}
                        </span>
                      </td>
                      <td className="text-right tabular-nums">
                        <p className="font-semibold text-text-primary">{formatCurrency(j.totalCost)}</p>
                        <p className="text-xs text-text-tertiary">{formatCurrency(j.unitCost)} / {j.unit}</p>
                      </td>
                      <td>
                        <span className={cn(
                          "rounded px-1.5 py-0.5 text-2xs font-medium",
                          j.status === "cancelled" ? "bg-red-600/10 text-red-600" : "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
                        )}>
                          {j.status === "cancelled" ? "Cancelled" : "Posted"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              total={total}
              pageSize={pageSize}
              onPageSizeChange={setPageSize}
            />
          </div>
        )}
      </div>

      <ManufactureForm
        key={formVersion}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        defaultWarehouseId={data?.productionWarehouseId ?? ""}
        onPosted={async () => {
          await Promise.all([
            utils.manufacturing.journals.invalidate(),
            invalidateStockViews(utils),
          ]);
          setFormOpen(false);
        }}
      />
      <JournalDetail id={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

function ManufactureForm({
  open,
  onClose,
  onPosted,
  defaultWarehouseId,
}: {
  open: boolean;
  onClose: () => void;
  onPosted: () => Promise<void>;
  defaultWarehouseId: string;
}) {
  const [finishedKey, setFinishedKey] = useState("");
  const [finishedInfo, setFinishedInfo] = useState<UnitChoice | null>(null);
  const [bomId, setBomId] = useState("");
  const [bomTouched, setBomTouched] = useState(false);
  const [quantity, setQuantity] = useState("1");
  const [date, setDate] = useState(todayISODate());
  const [from, setFrom] = useState(defaultWarehouseId);
  const [to, setTo] = useState(defaultWarehouseId);
  const [lines, setLines] = useState<Line[]>([]);
  const [byLines, setByLines] = useState<Line[]>([]);
  const [costs, setCosts] = useState<Cost[]>([]);
  const [notes, setNotes] = useState("");
  const [appliedKey, setAppliedKey] = useState("");

  useEffect(() => {
    if (!from && defaultWarehouseId) setFrom(defaultWarehouseId);
    if (!to && defaultWarehouseId) setTo(defaultWarehouseId);
  }, [defaultWarehouseId, from, to]);

  const finished = finishedKey ? parseUnitKey(finishedKey) : null;
  const bomsQuery = trpc.manufacturing.boms.useQuery(
    { itemId: finished?.itemId, activeOnly: true, page: 1, limit: 50 },
    { enabled: !!finished },
  );
  const bomOptions = useMemo(
    () => (bomsQuery.data?.data ?? []).filter((b) => (b.variantId ?? null) === (finished?.variantId ?? null)),
    [bomsQuery.data, finished?.variantId],
  );

  // Pick the item's default BOM until the user chooses otherwise.
  useEffect(() => {
    if (bomTouched || !bomsQuery.data) return;
    const preferred = bomOptions.find((b) => b.isDefault) ?? bomOptions[0];
    setBomId(preferred?.id ?? "");
  }, [bomOptions, bomsQuery.data, bomTouched]);

  const quantityOk = QTY.test(quantity.trim()) && parseFloat(quantity) > 0;
  const bomKeys = new Set(lines.filter((l) => l.standard !== null).map((l) => l.unitKey));
  const extra = lines.filter((l) => l.unitKey && !bomKeys.has(l.unitKey)).map((l) => parseUnitKey(l.unitKey));
  const plan = trpc.manufacturing.plan.useQuery(
    { bomId: bomId || null, quantity: quantityOk ? quantity.trim() : "1", sourceWarehouseId: from || null, extra },
    { enabled: open && !!finished && quantityOk, placeholderData: keepPreviousData },
  );

  // Prefill components from the BOM whenever the BOM or quantity changes.
  const prefillKey = `${bomId}|${quantity.trim()}`;
  useEffect(() => {
    if (!plan.data || plan.isPlaceholderData || appliedKey === prefillKey) return;
    if ((plan.data.bom?.id ?? "") !== bomId) return;
    const toLine = (l: { itemId: string; variantId: string | null; name: string; unit: string; standardQuantity: string }): Line => ({
      key: nextKey(),
      unitKey: unitKey(l.itemId, l.variantId),
      info: { name: l.name, unit: l.unit },
      standard: l.standardQuantity,
      quantity: String(parseFloat(l.standardQuantity)),
    });
    if (bomId) {
      setLines(plan.data.components.map(toLine));
      setByLines(plan.data.byProducts.map(toLine));
    } else if (lines.length === 0) {
      setLines([newLine()]);
    }
    setAppliedKey(prefillKey);
  }, [plan.data, plan.isPlaceholderData, appliedKey, prefillKey, bomId, lines.length]);

  const facts = useMemo(() => {
    const map = new Map<string, { available: string | null; rate: string }>();
    for (const c of [...(plan.data?.components ?? []), ...(plan.data?.extra ?? [])]) {
      map.set(unitKey(c.itemId, c.variantId), { available: c.available, rate: c.rate });
    }
    return map;
  }, [plan.data]);

  const readyLines = lines.filter((l) => l.unitKey && QTY.test(l.quantity.trim()));
  const readyBy = byLines.filter((l) => l.unitKey && QTY.test(l.quantity.trim()));
  const readyCosts = costs.filter((c) => c.label.trim() && MONEY.test(c.amount.trim()));
  const componentsCost = readyLines.reduce((s, l) => s + parseFloat(l.quantity) * parseFloat(facts.get(l.unitKey)?.rate ?? "0"), 0);
  const extraCost = readyCosts.reduce((s, c) => s + parseFloat(c.amount), 0);
  const totalCost = componentsCost + extraCost;
  const short = readyLines.some((l) => {
    const a = facts.get(l.unitKey)?.available;
    return a != null && parseFloat(a) < parseFloat(l.quantity);
  });
  const badInput =
    lines.some((l) => l.unitKey && !QTY.test(l.quantity.trim())) ||
    costs.some((c) => (c.label.trim() || c.amount.trim()) && !(c.label.trim() && MONEY.test(c.amount.trim())));

  const manufacture = trpc.manufacturing.manufacture.useMutation({
    onSuccess: async (res) => {
      toast({ title: `Manufactured — journal ${res.journalNumber}`, description: `Cost ${formatCurrency(res.totalCost)}`, variant: "success" });
      await onPosted();
    },
    onError: (e) => toast({ title: "Couldn't manufacture", description: e.message, variant: "error" }),
  });

  const canPost = !!finished && quantityOk && !!from && !!to && readyLines.some((l) => parseFloat(l.quantity) > 0) && !badInput;

  function post() {
    if (!finished) return;
    manufacture.mutate({
      bomId: bomId || null,
      itemId: finished.itemId,
      variantId: finished.variantId,
      quantity: quantity.trim(),
      date: toISOString(date),
      sourceWarehouseId: from,
      destinationWarehouseId: to,
      components: readyLines.map((l) => ({ ...parseUnitKey(l.unitKey), quantity: l.quantity.trim() })),
      byProducts: readyBy.map((l) => ({ ...parseUnitKey(l.unitKey), quantity: l.quantity.trim() })),
      additionalCosts: readyCosts.map((c) => ({ label: c.label.trim(), amount: c.amount.trim() })),
      notes: notes.trim() || null,
    });
  }

  const unit = finishedInfo?.unit ?? plan.data?.finished?.unit ?? "";
  const updateLine = (setter: typeof setLines, key: string, patch: Partial<Line>) =>
    setter((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Manufacture"
      description="Components are prefilled from the BOM for the quantity you make — change them to what was actually used."
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            <span className="text-text-secondary">Cost </span>
            <span className="font-semibold tabular-nums text-text-primary">{formatCurrency(totalCost)}</span>
            {quantityOk && totalCost > 0 && (
              <span className="text-text-tertiary"> · {formatCurrency(totalCost / parseFloat(quantity))} / {unit || "unit"}</span>
            )}
          </div>
          <div className="flex gap-3">
            <button className="btn-secondary" onClick={onClose} disabled={manufacture.isPending}>Cancel</button>
            <button className="btn-primary" onClick={post} disabled={manufacture.isPending || !canPost}>
              {manufacture.isPending ? "Posting…" : "Post journal"}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <UnitCombobox
          label="Item to make"
          value={finishedKey}
          known={finishedInfo}
          onChange={(key, info) => {
            setFinishedKey(key);
            setFinishedInfo(info);
            setBomTouched(false);
            setBomId("");
            setLines([]);
            setByLines([]);
            setAppliedKey("");
          }}
        />
        {finished && (
          <Listbox
            label="Bill of materials"
            value={bomId || "none"}
            onChange={(v) => {
              setBomTouched(true);
              setBomId(v === "none" ? "" : v);
              setAppliedKey("");
              if (v === "none") {
                setLines([newLine()]);
                setByLines([]);
              }
            }}
            options={[
              ...bomOptions.map((b) => ({
                value: b.id,
                label: b.isDefault ? `${b.name} (default)` : b.name,
                description: `Makes ${formatQty(b.outputQuantity, b.unit)} from ${b.componentCount} component${b.componentCount === 1 ? "" : "s"}`,
              })),
              { value: "none", label: "No BOM — enter components" },
            ]}
          />
        )}
        <div className="grid grid-cols-2 gap-4">
          <InputField
            label={`Quantity to make${unit ? ` (${unit})` : ""}`}
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
          <InputField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <WarehouseSelect label="Take components from" value={from} onChange={setFrom} required />
          <WarehouseSelect label="Put finished goods in" value={to} onChange={setTo} required />
        </div>

        {finished && (
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Components used</h3>
            <div className="mt-2 space-y-2">
              {lines.length > 0 && (
                <div className="grid grid-cols-[minmax(0,1fr)_110px_90px_36px] gap-2 text-xs font-medium text-text-secondary">
                  <span>Item</span>
                  <span>Quantity</span>
                  <span className="text-right">Value</span>
                  <span />
                </div>
              )}
              {lines.map((l, i) => {
                const f = facts.get(l.unitKey);
                const q = parseFloat(l.quantity) || 0;
                const isShort = f?.available != null && parseFloat(f.available) < q;
                return (
                  <div key={l.key}>
                    <div className="grid grid-cols-[minmax(0,1fr)_110px_90px_36px] items-center gap-2">
                      <UnitCombobox
                        ariaLabel={`Component, line ${i + 1}`}
                        value={l.unitKey}
                        known={l.info}
                        onChange={(key, info) => updateLine(setLines, l.key, { unitKey: key, info: info ?? l.info, standard: null })}
                      />
                      <input
                        className={cn("input tabular-nums", isShort && "border-amber-500")}
                        inputMode="decimal"
                        aria-label={`Quantity used, line ${i + 1}`}
                        value={l.quantity}
                        onChange={(e) => updateLine(setLines, l.key, { quantity: e.target.value })}
                      />
                      <span className="text-right text-sm tabular-nums text-text-secondary">
                        {f ? formatCurrency(q * parseFloat(f.rate)) : "—"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                        className="grid h-9 w-9 place-items-center rounded-lg text-text-tertiary hover:bg-red-600/[0.08] hover:text-red-500"
                        aria-label={`Remove line ${i + 1}`}
                      >
                        <Icon icon={Delete02Icon} size={15} />
                      </button>
                    </div>
                    {l.unitKey && (
                      <p className={cn("mt-0.5 text-xs", isShort ? "text-amber-600" : "text-text-tertiary")}>
                        {f?.available != null ? `${formatQty(f.available, l.info?.unit)} in this warehouse` : ""}
                        {l.standard !== null && ` · BOM: ${formatQty(l.standard, l.info?.unit)}`}
                        {f && ` · ${formatCurrency(f.rate)} / ${l.info?.unit ?? "unit"}`}
                      </p>
                    )}
                  </div>
                );
              })}
              <AddButton onClick={() => setLines((ls) => [...ls, newLine()])}>Add component</AddButton>
              {short && (
                <p className="text-xs text-amber-600">Some components are short at this warehouse. Posting may be refused if negative stock is blocked.</p>
              )}
            </div>
          </div>
        )}

        {finished && (byLines.length > 0 || bomId) && (
          <div>
            <h3 className="text-sm font-semibold text-text-primary">By-products</h3>
            <div className="mt-2 space-y-2">
              {byLines.map((l, i) => (
                <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_110px_36px] items-center gap-2">
                  <UnitCombobox
                    ariaLabel={`By-product, line ${i + 1}`}
                    value={l.unitKey}
                    known={l.info}
                    onChange={(key, info) => updateLine(setByLines, l.key, { unitKey: key, info: info ?? l.info })}
                  />
                  <input
                    className="input tabular-nums"
                    inputMode="decimal"
                    aria-label={`By-product quantity, line ${i + 1}`}
                    value={l.quantity}
                    onChange={(e) => updateLine(setByLines, l.key, { quantity: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => setByLines((ls) => ls.filter((x) => x.key !== l.key))}
                    className="grid h-9 w-9 place-items-center rounded-lg text-text-tertiary hover:bg-red-600/[0.08] hover:text-red-500"
                    aria-label={`Remove by-product ${i + 1}`}
                  >
                    <Icon icon={Delete02Icon} size={15} />
                  </button>
                </div>
              ))}
              <AddButton onClick={() => setByLines((ls) => [...ls, newLine()])}>Add by-product</AddButton>
            </div>
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold text-text-primary">Additional costs</h3>
          <p className="mt-0.5 text-xs text-text-tertiary">Labour, power, job work… added to the cost of what you make.</p>
          <div className="mt-2 space-y-2">
            {costs.map((c, i) => (
              <div key={c.key} className="grid grid-cols-[minmax(0,1fr)_130px_36px] items-center gap-2">
                <input
                  className="input"
                  aria-label={`Cost name, line ${i + 1}`}
                  placeholder="e.g. Labour"
                  value={c.label}
                  onChange={(e) => setCosts((cs) => cs.map((x) => (x.key === c.key ? { ...x, label: e.target.value } : x)))}
                />
                <input
                  className="input tabular-nums"
                  inputMode="decimal"
                  aria-label={`Cost amount, line ${i + 1}`}
                  placeholder="0.00"
                  value={c.amount}
                  onChange={(e) => setCosts((cs) => cs.map((x) => (x.key === c.key ? { ...x, amount: e.target.value } : x)))}
                />
                <button
                  type="button"
                  onClick={() => setCosts((cs) => cs.filter((x) => x.key !== c.key))}
                  className="grid h-9 w-9 place-items-center rounded-lg text-text-tertiary hover:bg-red-600/[0.08] hover:text-red-500"
                  aria-label={`Remove cost ${i + 1}`}
                >
                  <Icon icon={Delete02Icon} size={15} />
                </button>
              </div>
            ))}
            <AddButton onClick={() => setCosts((cs) => [...cs, { key: nextKey(), label: "", amount: "" }])}>Add cost</AddButton>
          </div>
        </div>

        <div className="rounded-lg bg-surface-2 px-4 py-3 text-sm">
          <div className="flex justify-between"><span className="text-text-secondary">Components</span><span className="tabular-nums">{formatCurrency(componentsCost)}</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">Additional costs</span><span className="tabular-nums">{formatCurrency(extraCost)}</span></div>
          <div className="mt-1 flex justify-between border-t border-border-light pt-1 font-semibold">
            <span>Cost of goods made</span><span className="tabular-nums">{formatCurrency(totalCost)}</span>
          </div>
          <p className="mt-1 text-xs text-text-tertiary">Components are costed at their current stock valuation rate.</p>
        </div>

        <TextareaField label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </SlideOver>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300"
    >
      <Icon icon={Add01Icon} size={15} />
      {children}
    </button>
  );
}

function JournalDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data } = trpc.manufacturing.journal.useQuery({ id: id ?? "" }, { enabled: !!id });
  const [confirm, setConfirm] = useState(false);
  const cancel = trpc.manufacturing.cancel.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.manufacturing.journals.invalidate(),
        utils.manufacturing.journal.invalidate(),
        invalidateStockViews(utils),
      ]);
      toast({ title: "Journal cancelled", description: "The stock movements were reversed.", variant: "success" });
      setConfirm(false);
    },
    onError: (e) => toast({ title: "Couldn't cancel", description: e.message, variant: "error" }),
  });
  const j = id && data?.id === id ? data : null;

  return (
    <>
      <SlideOver
        open={!!id}
        onClose={onClose}
        title={j ? `Manufacturing journal ${j.journalNumber}` : "Manufacturing journal"}
        description={j ? `${formatDate(j.date)} · ${j.status === "cancelled" ? "Cancelled" : "Posted"}` : undefined}
        footer={
          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={onClose}>Close</button>
            {j?.status === "posted" && (
              <button className="btn-secondary text-red-600" onClick={() => setConfirm(true)}>Cancel journal</button>
            )}
          </div>
        }
      >
        {!j ? (
          <SkeletonRows />
        ) : (
          <div className="space-y-5 text-sm">
            <div>
              <p className="text-base font-semibold text-text-primary">{formatQty(j.quantity, j.unit)} {j.itemName}</p>
              <p className="text-text-secondary">
                {j.bomName ? `BOM: ${j.bomName} · ` : ""}Components from {j.sourceName}, made into {j.destinationName}
              </p>
            </div>
            <LinesTable
              title="Components used"
              rows={j.components.map((c) => ({ ...c, cost: formatCurrency(c.amount) }))}
            />
            {j.byProducts.length > 0 && (
              <LinesTable title="By-products" rows={j.byProducts.map((c) => ({ ...c, cost: "—" }))} />
            )}
            <div className="rounded-lg bg-surface-2 px-4 py-3">
              <div className="flex justify-between"><span className="text-text-secondary">Components</span><span className="tabular-nums">{formatCurrency(j.componentsCost)}</span></div>
              {j.additionalCosts.map((c, i) => (
                <div key={i} className="flex justify-between"><span className="text-text-secondary">{c.label}</span><span className="tabular-nums">{formatCurrency(c.amount)}</span></div>
              ))}
              <div className="mt-1 flex justify-between border-t border-border-light pt-1 font-semibold">
                <span>Total cost</span><span className="tabular-nums">{formatCurrency(j.totalCost)}</span>
              </div>
              <p className="mt-1 text-xs text-text-tertiary">{formatCurrency(j.unitCost)} per {j.unit}</p>
            </div>
            {j.notes && <p className="whitespace-pre-wrap text-text-secondary">{j.notes}</p>}
          </div>
        )}
      </SlideOver>
      <ConfirmDialog
        open={confirm}
        onCancel={() => setConfirm(false)}
        onConfirm={() => j && cancel.mutate({ id: j.id })}
        title="Cancel this journal?"
        description="Components go back to stock and the goods made are taken out again."
        confirmLabel="Cancel journal"
        variant="danger"
        loading={cancel.isPending}
      />
    </>
  );
}

function LinesTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ id: string; name: string; unit: string; quantity: string; standardQuantity: string | null; cost: string }>;
}) {
  return (
    <div>
      <h3 className="mb-2 font-semibold text-text-primary">{title}</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="text-right">BOM</th>
            <th className="text-right">Actual</th>
            <th className="text-right">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td className="text-right tabular-nums text-text-tertiary">{r.standardQuantity ? formatQty(r.standardQuantity, r.unit) : "—"}</td>
              <td className="text-right tabular-nums">{formatQty(r.quantity, r.unit)}</td>
              <td className="text-right tabular-nums">{r.cost}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
