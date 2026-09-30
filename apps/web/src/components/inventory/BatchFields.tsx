/**
 * Batch / lot fields for a line of an item that tracks batches.
 *
 * Inward lines (purchase, GRN, sales return, adjustment in) type a batch
 * number — an existing one is matched, a new one is created with its dates.
 * Outward lines (sale, challan, purchase return, transfer, adjustment out)
 * pick a batch, or leave it on "earliest expiry first" and let the server
 * split the quantity across batches. Expired batches are only offered once
 * the user ticks "Allow expired".
 */
import { useId, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn, formatDate } from "@/lib/utils";
import { DateInput } from "@/components/ui/DateInput";
import { Listbox } from "@/components/ui/Listbox";
import { formatQty, useWarehouses } from "@/components/inventory/shared";

export type BatchInValue = {
  batchId?: string;
  batchNumber?: string;
  mfgDate?: string;
  expiryDate?: string;
  batchMrp?: string;
};

type BatchRow = {
  id: string;
  batchNumber: string;
  mfgDate: string | null;
  expiryDate: string | null;
  mrp: string | null;
  quantity: string;
  expired: boolean;
  daysToExpiry: number | null;
};

/** "exp 12 Oct 2026", "expired 3 Sep 2026" or "no expiry". */
export function expiryLabel(b: { expiryDate: string | null; expired?: boolean }) {
  if (!b.expiryDate) return "no expiry";
  return `${b.expired ? "expired" : "exp"} ${formatDate(b.expiryDate)}`;
}

/** How FEFO would split `needed` across these batches (unexpired unless `includeExpired`, in order). */
export function fefoPreview(batches: BatchRow[], needed: number, includeExpired = false) {
  const out: Array<{ batchNumber: string; quantity: number }> = [];
  let left = needed;
  for (const b of batches) {
    if (left <= 0.0005) break;
    if (b.expired && !includeExpired) continue;
    const q = Math.min(parseFloat(b.quantity), left);
    if (q <= 0.0005) continue;
    out.push({ batchNumber: b.batchNumber, quantity: q });
    left -= q;
  }
  return { pieces: out, short: Math.max(left, 0) };
}

export function BatchOutSelect({
  itemId,
  variantId,
  warehouseId,
  date,
  needed,
  unit,
  batchId,
  allowExpired,
  onChange,
  compact,
  expiredAlwaysAllowed,
  savedBatch,
}: {
  itemId: string;
  variantId?: string | null;
  warehouseId?: string | null;
  /** Document date (YYYY-MM-DD): a batch counts as expired after its expiry. */
  date?: string;
  /** Quantity the line takes, in the item's base unit. */
  needed: number;
  unit?: string | null;
  batchId: string;
  allowExpired: boolean;
  onChange: (patch: { batchId?: string; allowExpired?: boolean }) => void;
  compact?: boolean;
  /** Transfers and write-offs move expired stock as a matter of course. */
  expiredAlwaysAllowed?: boolean;
  /** Editing: the batch the line was saved with. The document already holds
   *  that stock, so the batch may show as empty here. */
  savedBatch?: { id: string; label: string } | null;
}) {
  const checkId = useId();
  const { data } = trpc.batch.list.useQuery(
    { itemId, variantId: variantId ?? null, warehouseId: warehouseId || null, asOf: date || null },
    { staleTime: 15_000 },
  );
  const batches = (data?.data ?? []) as BatchRow[];
  const preview = useMemo(() => fefoPreview(batches, needed, expiredAlwaysAllowed), [batches, needed, expiredAlwaysAllowed]);
  const showExpired = allowExpired || !!expiredAlwaysAllowed;
  const picked = batches.find((b) => b.id === batchId);

  const options = [
    {
      value: "",
      label: "Earliest expiry first",
      description: preview.pieces.length > 0
        ? preview.pieces.map((p) => `${p.batchNumber} × ${formatQty(p.quantity)}`).join(", ")
        : expiredAlwaysAllowed ? "No batch in stock" : "No unexpired batch in stock",
    },
    ...batches
      .filter((b) => showExpired || !b.expired || b.id === batchId)
      .map((b) => ({
        value: b.id,
        label: `${b.batchNumber}${b.expired ? " (expired)" : ""}`,
        description: `${expiryLabel(b)} · ${formatQty(b.quantity, unit)} left${b.mrp ? ` · MRP ₹${b.mrp}` : ""}`,
      })),
    ...(savedBatch && !batches.some((b) => b.id === savedBatch.id)
      ? [{ value: savedBatch.id, label: savedBatch.label, description: "Saved on this document" }]
      : []),
  ];
  const hasExpired = batches.some((b) => b.expired);
  const isSaved = !!savedBatch && savedBatch.id === batchId;
  const overPicked = picked && !isSaved && needed - parseFloat(picked.quantity) > 0.0005;

  return (
    <div className={cn("space-y-1", compact && "text-xs")}>
      <Listbox
        label="Batch"
        value={batchId}
        onChange={(v) => onChange({ batchId: v })}
        options={options}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-tertiary">
        {!batchId && preview.short > 0.0005 && batches.length > 0 && (
          <span className="text-amber-700 dark:text-amber-400" role="alert">
            {expiredAlwaysAllowed ? "Batches are" : "Unexpired batches are"} {formatQty(preview.short, unit)} short
          </span>
        )}
        {overPicked && (
          <span className="text-red-600 dark:text-red-400" role="alert">
            Only {formatQty(picked.quantity, unit)} left in {picked.batchNumber}
          </span>
        )}
        {picked?.expired && !expiredAlwaysAllowed && (
          <span className="text-red-600 dark:text-red-400">Expired batch</span>
        )}
        {hasExpired && !expiredAlwaysAllowed && (
          <label htmlFor={checkId} className="inline-flex cursor-pointer items-center gap-1.5">
            <input
              id={checkId}
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-border"
              checked={allowExpired}
              onChange={(e) => onChange({ allowExpired: e.target.checked, ...(e.target.checked ? {} : picked?.expired ? { batchId: "" } : {}) })}
            />
            Allow expired
          </label>
        )}
      </div>
    </div>
  );
}

export function BatchInFields({
  itemId,
  variantId,
  trackExpiry,
  value,
  onChange,
}: {
  itemId: string;
  variantId?: string | null;
  trackExpiry: boolean;
  value: BatchInValue;
  onChange: (patch: BatchInValue) => void;
}) {
  const uid = useId();
  const { data } = trpc.batch.list.useQuery(
    { itemId, variantId: variantId ?? null, includeEmpty: true },
    { staleTime: 15_000 },
  );
  const batches = (data?.data ?? []) as BatchRow[];
  const existing = batches.find((b) => b.batchNumber === value.batchNumber?.trim());

  function setNumber(batchNumber: string) {
    const match = batches.find((b) => b.batchNumber === batchNumber.trim());
    // An existing batch brings its dates along; a new one starts blank.
    onChange(match
      ? { batchId: undefined, batchNumber, mfgDate: match.mfgDate ?? "", expiryDate: match.expiryDate ?? "", batchMrp: match.mrp ?? "" }
      : { batchId: undefined, batchNumber });
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div>
        <label htmlFor={`${uid}-no`} className="mb-0.5 block text-[10px] font-medium text-text-tertiary">
          Batch no.
        </label>
        <input
          id={`${uid}-no`}
          list={`${uid}-list`}
          className="input py-1.5 text-sm"
          value={value.batchNumber ?? ""}
          onChange={(e) => setNumber(e.target.value)}
          placeholder="e.g. B2407"
          maxLength={60}
          autoComplete="off"
        />
        <datalist id={`${uid}-list`}>
          {batches.map((b) => (
            <option key={b.id} value={b.batchNumber}>{expiryLabel(b)}</option>
          ))}
        </datalist>
        {existing && (
          <p className="mt-0.5 text-[10px] text-text-tertiary">Existing batch · {formatQty(existing.quantity)} in stock</p>
        )}
      </div>
      <div>
        <label htmlFor={`${uid}-exp`} className="mb-0.5 block text-[10px] font-medium text-text-tertiary">
          Expiry{trackExpiry ? " *" : ""}
        </label>
        <DateInput
          id={`${uid}-exp`}
          className="input py-1.5 text-sm"
          value={value.expiryDate ?? ""}
          onChange={(e) => onChange({ expiryDate: e.target.value })}
          disabled={!!existing?.expiryDate}
        />
      </div>
      <div>
        <label htmlFor={`${uid}-mfg`} className="mb-0.5 block text-[10px] font-medium text-text-tertiary">
          Mfg date
        </label>
        <DateInput
          id={`${uid}-mfg`}
          className="input py-1.5 text-sm"
          value={value.mfgDate ?? ""}
          onChange={(e) => onChange({ mfgDate: e.target.value })}
          disabled={!!existing?.mfgDate}
        />
      </div>
      <div>
        <label htmlFor={`${uid}-mrp`} className="mb-0.5 block text-[10px] font-medium text-text-tertiary">
          Batch MRP
        </label>
        <input
          id={`${uid}-mrp`}
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          className="input py-1.5 text-sm tabular-nums"
          value={value.batchMrp ?? ""}
          onChange={(e) => onChange({ batchMrp: e.target.value })}
          disabled={!!existing?.mrp}
          placeholder="Optional"
        />
      </div>
    </div>
  );
}

/** The fields to send for an inward line's batch. */
export function batchInPayload(v: BatchInValue) {
  if (v.batchId) return { batchId: v.batchId };
  const batchNumber = v.batchNumber?.trim();
  if (!batchNumber) return {};
  return {
    batchNumber,
    mfgDate: v.mfgDate || undefined,
    expiryDate: v.expiryDate || undefined,
    batchMrp: v.batchMrp || undefined,
  };
}

/** Item form: switch batch (and expiry) tracking on, with the opening batch on a new item. */
export function BatchTrackingFields({
  trackBatches,
  trackExpiry,
  onChange,
  openingStock,
  openingBatch,
  onOpeningBatchChange,
}: {
  trackBatches: boolean;
  trackExpiry: boolean;
  onChange: (patch: { trackBatches?: boolean; trackExpiry?: boolean }) => void;
  /** New items only: opening stock goes into this batch. */
  openingStock?: string;
  openingBatch?: BatchInValue;
  onOpeningBatchChange?: (patch: BatchInValue) => void;
}) {
  const uid = useId();
  const hasOpening = !!onOpeningBatchChange && parseFloat(openingStock || "0") > 0;
  return (
    <div className="space-y-3">
      <label htmlFor={`${uid}-batches`} className="flex cursor-pointer items-start gap-2 text-sm text-text-primary">
        <input
          id={`${uid}-batches`}
          type="checkbox"
          className="mt-0.5 rounded"
          checked={trackBatches}
          onChange={(e) => onChange({ trackBatches: e.target.checked, ...(e.target.checked ? {} : { trackExpiry: false }) })}
        />
        <span>
          Track batches
          <span className="block text-xs text-text-tertiary">
            Stock is kept per batch / lot number. Purchases record the batch; sales pick one, earliest expiry first.
          </span>
        </span>
      </label>
      <label
        htmlFor={`${uid}-expiry`}
        className={cn("flex items-start gap-2 text-sm", trackBatches ? "cursor-pointer text-text-primary" : "text-text-tertiary")}
      >
        <input
          id={`${uid}-expiry`}
          type="checkbox"
          className="mt-0.5 rounded"
          checked={trackExpiry}
          disabled={!trackBatches}
          onChange={(e) => onChange({ trackExpiry: e.target.checked })}
        />
        <span>
          Track expiry
          <span className="block text-xs text-text-tertiary">
            Every new batch needs an expiry date, and expired batches aren't sold unless you allow it on the line.
          </span>
        </span>
      </label>
      {trackBatches && hasOpening && (
        <div className="space-y-1.5 rounded-lg border border-border-light px-3 py-2">
          <p className="text-xs font-medium text-text-secondary">Opening stock batch</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div>
              <label htmlFor={`${uid}-ob-no`} className="mb-0.5 block text-[10px] font-medium text-text-tertiary">Batch no.</label>
              <input
                id={`${uid}-ob-no`}
                className="input py-1.5 text-sm"
                value={openingBatch?.batchNumber ?? ""}
                onChange={(e) => onOpeningBatchChange!({ batchNumber: e.target.value })}
                maxLength={60}
                placeholder="e.g. OPEN-1"
              />
            </div>
            <div>
              <label htmlFor={`${uid}-ob-exp`} className="mb-0.5 block text-[10px] font-medium text-text-tertiary">
                Expiry{trackExpiry ? " *" : ""}
              </label>
              <DateInput
                id={`${uid}-ob-exp`}
                className="input py-1.5 text-sm"
                value={openingBatch?.expiryDate ?? ""}
                onChange={(e) => onOpeningBatchChange!({ expiryDate: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor={`${uid}-ob-mfg`} className="mb-0.5 block text-[10px] font-medium text-text-tertiary">Mfg date</label>
              <DateInput
                id={`${uid}-ob-mfg`}
                className="input py-1.5 text-sm"
                value={openingBatch?.mfgDate ?? ""}
                onChange={(e) => onOpeningBatchChange!({ mfgDate: e.target.value })}
              />
            </div>
          </div>
          <p className="text-[10px] text-text-tertiary">Leave the number blank to keep opening stock outside any batch.</p>
        </div>
      )}
    </div>
  );
}

/** Item detail: the item's batches with stock, expiry and where they sit. */
export function ItemBatchesPanel({ itemId, unit }: { itemId: string; unit?: string | null }) {
  const [showEmpty, setShowEmpty] = useState(false);
  const { data, isLoading } = trpc.batch.list.useQuery({ itemId, includeEmpty: showEmpty });
  const { data: warehouses } = useWarehouses();
  const whName = (id: string) => warehouses?.find((w) => w.id === id)?.name ?? "Warehouse";
  const rows = (data?.data ?? []) as Array<BatchRow & { byWarehouse: Record<string, string> }>;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-primary">Batches</h3>
        <label className="inline-flex items-center gap-1.5 text-xs text-text-tertiary">
          <input type="checkbox" className="h-3.5 w-3.5 rounded" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />
          Show empty
        </label>
      </div>
      {isLoading ? (
        <p className="text-xs text-text-tertiary">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-text-tertiary">No batches in stock yet. They're created as purchases and other inward entries record them.</p>
      ) : (
        <ul className="divide-y divide-border-light rounded-lg border border-border-light">
          {rows.map((b) => (
            <li key={b.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-text-primary">
                  {b.batchNumber}
                  {b.expired && (
                    <span className="ml-2 rounded bg-red-600/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-400">Expired</span>
                  )}
                  {!b.expired && b.daysToExpiry !== null && b.daysToExpiry <= 30 && (
                    <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                      {b.daysToExpiry === 0 ? "Expires today" : `${b.daysToExpiry}d left`}
                    </span>
                  )}
                </p>
                <p className="text-xs text-text-tertiary">
                  {expiryLabel(b)}{b.mfgDate ? ` · mfg ${formatDate(b.mfgDate)}` : ""}{b.mrp ? ` · MRP ₹${b.mrp}` : ""}
                </p>
                {Object.keys(b.byWarehouse).length > 1 && (
                  <p className="text-xs text-text-tertiary">
                    {Object.entries(b.byWarehouse).map(([id, q]) => `${whName(id)} ${formatQty(q)}`).join(" · ")}
                  </p>
                )}
              </div>
              <p className="shrink-0 font-semibold tabular-nums text-text-primary">{formatQty(b.quantity, unit)}</p>
            </li>
          ))}
        </ul>
      )}
      {data && parseFloat(data.unbatched) !== 0 && (
        <p className="text-xs text-text-tertiary">
          {formatQty(data.unbatched, unit)} not in any batch (stock from before batch tracking was switched on).
        </p>
      )}
    </div>
  );
}
