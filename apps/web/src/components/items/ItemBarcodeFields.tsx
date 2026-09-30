import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { InputField } from "@/components/ui/FormField";
import { Icon } from "@/components/ui/Icon";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { BARCODE_TYPE_NAMES, useBarcodeSetup } from "@/components/barcodes/BarcodeSymbol";

/**
 * The item's main barcode — the one printed on labels. Hidden while barcodes
 * are switched off for the business. "Create code" makes one in the
 * business's barcode type.
 */
export function ItemBarcodeField({
  value,
  onChange,
  sku,
}: {
  value: string;
  onChange: (value: string) => void;
  sku?: string;
}) {
  const { data: setup } = useBarcodeSetup();
  const generate = trpc.barcode.generate.useMutation({
    onSuccess: (res) => onChange(res.code),
    onError: (err) => toast.error("Could not create a code", err.message),
  });
  if (!setup?.enabled) return null;
  return (
    <div className="flex items-end gap-2">
      <div className="flex-1 min-w-0">
        <InputField
          label={setup.mode === "multi" ? "Main barcode (printed on labels)" : "Barcode"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={setup.autoGenerate ? "Scan or type — created on purchase if left blank" : "Scan or type"}
        />
      </div>
      <button
        type="button"
        className="btn-secondary h-[38px] shrink-0"
        disabled={generate.isPending || !!value.trim()}
        onClick={() => generate.mutate({ sku: sku || null })}
        title={`Create a new ${BARCODE_TYPE_NAMES[setup.type]} code`}
      >
        Create code
      </button>
    </div>
  );
}

/**
 * Extra codes for businesses on "many barcodes per item": supplier codes, old
 * codes and box / carton codes that stand for several pieces in one scan.
 */
export function ItemExtraCodes({ itemId }: { itemId: string }) {
  const utils = trpc.useUtils();
  const { data: setup } = useBarcodeSetup();
  const enabled = !!setup?.enabled && setup.mode === "multi";
  const { data: codes } = trpc.barcode.itemCodes.useQuery({ itemId }, { enabled });
  const [code, setCode] = useState("");
  const [packQty, setPackQty] = useState("1");
  const [label, setLabel] = useState("");

  const refresh = () => utils.barcode.itemCodes.invalidate({ itemId });
  const add = trpc.barcode.addItemCode.useMutation({
    onSuccess: () => {
      setCode("");
      setPackQty("1");
      setLabel("");
      refresh();
    },
    onError: (err) => toast.error("Could not add the code", err.message),
  });
  const remove = trpc.barcode.removeItemCode.useMutation({
    onSuccess: refresh,
    onError: (err) => toast.error("Could not remove the code", err.message),
  });

  if (!enabled) return null;

  const pack = parseFloat(packQty);
  const canAdd = !!code.trim() && Number.isFinite(pack) && pack > 0;

  return (
    <div className="mt-3 rounded-xl border border-border-light">
      <div className="flex items-baseline justify-between px-3 py-2 border-b border-border-light">
        <p className="text-sm font-semibold text-text-primary">More barcodes</p>
        <p className="text-xs text-text-tertiary">They scan to this item; only the main code prints</p>
      </div>
      {(codes ?? []).length > 0 && (
        <ul className="divide-y divide-border-light">
          {codes!.map((c) => {
            const n = parseFloat(c.packQty);
            return (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="font-mono text-text-primary flex-1 min-w-0 truncate">{c.code}</span>
                <span className="font-semibold text-text-primary shrink-0">
                  {c.label || (n === 1 ? "1 pc" : `${n.toLocaleString("en-IN")} pcs`)}
                </span>
                <span className="text-xs text-text-tertiary shrink-0 capitalize">{c.source}</span>
                <button
                  type="button"
                  className="btn-icon text-red-500 shrink-0"
                  aria-label={`Remove code ${c.code}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ id: c.id })}
                >
                  <Icon icon={Delete02Icon} size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="grid gap-2 p-3 sm:grid-cols-[1.4fr_0.6fr_1fr_auto] items-end">
        <InputField label="Code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Scan or type" />
        <InputField label="1 scan =" inputMode="decimal" value={packQty} onChange={(e) => setPackQty(e.target.value)} placeholder="1" />
        <InputField label="Name (optional)" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Box of 12" />
        <button
          type="button"
          className="btn-secondary h-[38px]"
          disabled={!canAdd || add.isPending}
          onClick={() =>
            add.mutate({
              itemId,
              code: code.trim(),
              packQty: String(pack),
              label: label.trim() || undefined,
              source: "manual",
            })
          }
        >
          Add
        </button>
      </div>
    </div>
  );
}
