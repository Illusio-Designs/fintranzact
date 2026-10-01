import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { SquareLock02Icon } from "@hugeicons/core-free-icons";
import {
  BARCODE_TYPE_NAMES,
  BarcodeSymbol,
  useBarcodeSetup,
  type BarcodeType,
} from "@/components/barcodes/BarcodeSymbol";

type BarcodeMode = "single" | "multi";

const TYPES: Array<{ value: BarcodeType; desc: string; size: string; roll: string; sample: string }> = [
  {
    value: "ean13",
    desc: "13 digits, the retail standard. Codes we create use the in-store 2… range.",
    size: "50 × 25 mm",
    roll: "50 × 25 mm thermal roll, 1 across",
    sample: "2000000000039",
  },
  {
    value: "code128",
    desc: "Letters and numbers — a short SKU becomes the barcode (up to 14 characters).",
    size: "75 × 25 mm",
    roll: "75 × 25 mm thermal roll, 1 across",
    sample: "HC12-0004",
  },
  {
    value: "qr",
    desc: "Square code that any phone camera reads — handy for counting stock with a phone.",
    size: "38 × 25 mm",
    roll: "38 × 25 mm thermal roll, 2 across",
    sample: "HC12-0004",
  },
];

const MODES: Array<{ value: BarcodeMode; name: string; desc: string }> = [
  {
    value: "single",
    name: "One barcode per item",
    desc: "Each item (and each size / colour) has exactly one code. Simple and fast.",
  },
  {
    value: "multi",
    name: "Many barcodes per item",
    desc: "Supplier code, your own code, and box / carton codes that add a whole pack in one scan.",
  },
];

const FEATURES = [
  "Barcode field on items (and on each size / colour)",
  "Scan to add items in POS",
  "A code for items that arrive without one",
  "Barcode label printing",
  "Physical stock by scanning, with a report after End scan",
];

function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors",
        checked ? "bg-brand-600" : "bg-surface-3",
        disabled ? "opacity-50 cursor-wait" : "cursor-pointer",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5",
          checked ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/**
 * Settings → Barcodes. Barcodes on/off, then a one-time choice of barcode type
 * and barcodes-per-item that is locked for the business. The label size
 * follows the type, so there is nothing to set up for printing.
 */
export function BarcodesTab() {
  const utils = trpc.useUtils();
  const { data: setup, isLoading } = useBarcodeSetup();
  const [type, setType] = useState<BarcodeType>("ean13");
  const [mode, setMode] = useState<BarcodeMode>("single");
  const [confirmLock, setConfirmLock] = useState(false);

  useEffect(() => {
    if (setup) {
      setType(setup.type);
      setMode(setup.mode);
    }
  }, [setup]);

  const refresh = () => {
    utils.barcode.setup.invalidate();
    // The sidebar reads the on/off switch from the business row.
    utils.business.list.invalidate();
  };
  const update = trpc.barcode.update.useMutation({
    onSuccess: refresh,
    onError: (err) => toast.error("Could not update barcode settings", err.message),
  });
  const lock = trpc.barcode.lock.useMutation({
    onSuccess: () => {
      setConfirmLock(false);
      toast.success("Barcode setup locked");
      refresh();
    },
    onError: (err) => toast.error("Could not lock barcode setup", err.message),
  });

  if (isLoading || !setup) {
    return <div className="skeleton h-64 rounded-xl" />;
  }

  const locked = !!setup.lockedAt;
  const shownType = locked ? setup.type : type;
  const current = TYPES.find((t) => t.value === shownType)!;
  const modeName = MODES.find((m) => m.value === (locked ? setup.mode : mode))!.name;

  return (
    <div className="grid gap-6 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start">
      <div className="space-y-6 min-w-0">
        <div className="card p-6 flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-text-primary">Use barcodes</h3>
            <p className="text-sm text-text-secondary mt-1">
              {setup.enabled
                ? "Barcode fields, scanning, labels and Physical stock are on for this business."
                : "Off — nothing barcode-related shows anywhere in the app."}
            </p>
          </div>
          <Switch
            label="Use barcodes"
            checked={setup.enabled}
            disabled={update.isPending}
            onChange={(enabled) => update.mutate({ enabled })}
          />
        </div>

        {!setup.enabled ? (
          <div className="card p-6 border-dashed">
            <p className="text-sm font-semibold text-text-primary">Switch on to get</p>
            <ul className="mt-3 space-y-2 text-sm text-text-secondary list-disc pl-5">
              {FEATURES.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <div className={cn("card overflow-hidden", !locked && "ring-1 ring-brand-500/40")}>
              <div className="px-6 py-4 border-b border-border-subtle flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-text-primary">
                    {locked ? "Barcode setup" : "Set up barcodes for this business"}
                  </h3>
                  <p className="text-sm text-text-secondary mt-0.5">
                    {locked
                      ? `${BARCODE_TYPE_NAMES[setup.type]} · ${modeName}`
                      : "Pick once. It's locked after you confirm."}
                  </p>
                </div>
                {locked && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-text-secondary">
                    <Icon icon={SquareLock02Icon} size={14} /> Locked
                  </span>
                )}
              </div>
              <div className="p-6 space-y-6">
                <fieldset>
                  <legend className="text-sm font-semibold text-text-secondary mb-2">1 · Barcode type</legend>
                  <div role="radiogroup" aria-label="Barcode type" className="grid gap-3 sm:grid-cols-3">
                    {TYPES.map((t) => {
                      const on = shownType === t.value;
                      return (
                        <button
                          key={t.value}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          disabled={locked && !on}
                          onClick={() => !locked && setType(t.value)}
                          className={cn(
                            "text-left rounded-xl border p-4 transition-colors",
                            on ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-border hover:bg-surface-1",
                            locked && !on && "opacity-50",
                            locked && "cursor-default",
                          )}
                        >
                          <span className="block text-sm font-bold text-text-primary">{BARCODE_TYPE_NAMES[t.value]}</span>
                          <span className="block mt-1 text-xs leading-relaxed text-text-secondary">{t.desc}</span>
                          <span className="block mt-2 text-xs font-semibold text-brand-600 dark:text-brand-300">Label {t.size}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="text-sm font-semibold text-text-secondary mb-2">2 · Barcodes per item</legend>
                  <div role="radiogroup" aria-label="Barcodes per item" className="grid gap-3 sm:grid-cols-2">
                    {MODES.map((m) => {
                      const on = (locked ? setup.mode : mode) === m.value;
                      return (
                        <button
                          key={m.value}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          disabled={locked && !on}
                          onClick={() => !locked && setMode(m.value)}
                          className={cn(
                            "text-left rounded-xl border p-4 transition-colors",
                            on ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-border hover:bg-surface-1",
                            locked && !on && "opacity-50",
                            locked && "cursor-default",
                          )}
                        >
                          <span className="block text-sm font-bold text-text-primary">{m.name}</span>
                          <span className="block mt-1 text-xs leading-relaxed text-text-secondary">{m.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                {locked ? (
                  <p className="text-xs text-text-tertiary">
                    Locked on {new Date(setup.lockedAt!).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    {setup.lockedBy ? ` by ${setup.lockedBy}` : ""}. Every code and label follows this setup.
                  </p>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 px-4 py-3">
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      Both choices are fixed for this business once you lock them.
                    </p>
                    <button type="button" className="btn-primary shrink-0" onClick={() => setConfirmLock(true)}>
                      Lock barcode setup
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="card p-6 flex items-start justify-between gap-6">
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-text-primary">Create a code for items that don't have one</h4>
                <p className="text-sm text-text-secondary mt-1">
                  When a purchase is received. A supplier's barcode is always kept.
                </p>
              </div>
              <Switch
                label="Create a code for items that don't have one"
                checked={setup.autoGenerate}
                disabled={update.isPending}
                onChange={(autoGenerate) => update.mutate({ autoGenerate })}
              />
            </div>
          </>
        )}
      </div>

      <aside className={cn("card p-6 space-y-4", !setup.enabled && "opacity-50")}>
        <h4 className="text-sm font-semibold text-text-primary">Label — fixed size</h4>
        <div className="flex justify-center rounded-lg bg-surface-2 p-4">
          <div
            className={cn(
              "bg-white rounded shadow-sm p-2 flex items-center justify-center gap-2 text-black max-w-full",
              shownType === "qr" ? "flex-row w-[190px] h-[125px]" : "flex-col",
              shownType === "ean13" && "w-[250px] h-[125px]",
              shownType === "code128" && "w-[300px] h-[100px]",
            )}
          >
            {shownType === "qr" && <BarcodeSymbol code={current.sample} type="qr" width={90} height={90} showText={false} />}
            <div className={cn("flex flex-col gap-0.5 min-w-0", shownType === "qr" ? "items-start" : "items-center")}>
              <span className="text-xs font-bold truncate">Hose clamp</span>
              {shownType !== "qr" && (
                <BarcodeSymbol code={current.sample} type={shownType} width={shownType === "ean13" ? 200 : 240} height={shownType === "ean13" ? 60 : 48} />
              )}
              {shownType === "qr" && <span className="font-mono text-[10px]">{current.sample}</span>}
              <span className="text-xs font-extrabold">₹25</span>
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-text-tertiary">Type</dt>
          <dd className="font-medium text-text-primary">{BARCODE_TYPE_NAMES[shownType]}</dd>
          <dt className="text-text-tertiary">Label size</dt>
          <dd className="font-medium text-text-primary">{current.size}</dd>
          <dt className="text-text-tertiary">Buy labels</dt>
          <dd className="text-text-primary">{current.roll}</dd>
        </dl>
        <p className="text-xs leading-relaxed text-text-tertiary border-t border-border-subtle pt-3">
          The size comes from the barcode type, so every label from every counter looks the same. Printing uses
          the printers on your computer — set the roll size once in your label printer's own settings.
        </p>
      </aside>

      <ConfirmDialog
        open={confirmLock}
        onCancel={() => setConfirmLock(false)}
        onConfirm={() => lock.mutate({ type, mode })}
        loading={lock.isPending}
        title="Lock barcode setup?"
        description={`${BARCODE_TYPE_NAMES[type]} with ${MODES.find((m) => m.value === mode)!.name.toLowerCase()}. Labels will always be ${TYPES.find((t) => t.value === type)!.size}. This can't be changed later.`}
        confirmLabel="Lock setup"
      />
    </div>
  );
}
