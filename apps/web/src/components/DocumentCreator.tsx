import { useState, useMemo, useEffect, useId, useRef } from "react";
import { trpc, getBusinessId } from "@/lib/trpc";
import { invalidateStockViews } from "@/lib/stock-cache";
import { formatCurrency, cn, todayISODate, toISOString, formatDateInput } from "@/lib/utils";
import dayjs from "dayjs";
import { SlideOver } from "@/components/ui/SlideOver";
import { Combobox } from "@/components/ui/Combobox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { useDebounce } from "@/hooks/useDebounce";
import { calcLineItem, calcInvoiceTotals, isIntraStateSupply, money, freeQuantityDocumentTypes, rejectionReasons, type GstStateParty } from "@fintranzact/shared";
import { QuickPartyCreate } from "@/components/QuickPartyCreate";
import { QuickItemCreate, type QuickItemCreateResult } from "@/components/QuickItemCreate";
import { DateInput } from "@/components/ui/DateInput";
import { Icon } from "@/components/ui/Icon";
import { Delete02Icon, Cancel01Icon, DeliveryTruck01Icon } from "@hugeicons/core-free-icons";
import { WarehouseSelect, formatQty, useWarehouses } from "@/components/inventory/shared";
import { useLevelPricing } from "@/components/pricing/useLevelPricing";
import { Select } from "@/components/ui/Select";
import { useDeliveryMethods } from "@/lib/delivery-methods";
import { BatchInFields, BatchOutSelect, batchInPayload } from "@/components/inventory/BatchFields";
import { useFeature } from "@/hooks/useFeature";

// ── Types ────────────────────────────────────────────────────────

export type DocumentType =
  | "invoice"
  | "quotation"
  | "credit_note"
  | "debit_note"
  | "delivery_challan"
  | "proforma"
  | "sales_return"
  | "purchase_return"
  | "purchase_order"
  | "sales_order"
  | "goods_receipt_note";

export interface DocumentCreatorProps {
  documentType: DocumentType;
  invoiceType: "sale" | "purchase";
  onClose: () => void;
  /** Called after successful creation/update. Receives the partyId used. */
  onSuccess?: (partyId?: string) => void;
  // Edit mode: pass existing invoice ID to pre-fill
  editInvoiceId?: string;
  // Pre-fill from an existing invoice without entering edit mode (for CN/SR creation)
  prefillFromInvoiceId?: string;
  // Pre-select a party on mount (e.g. "Create another" for same customer)
  initialPartyId?: string;
}

interface UnitOption {
  unit: string;
  salePrice: string;
  conversionFactor: number;
}

interface LineItem {
  id: string;
  itemId?: string;
  /**
   * Snapshot of the item name shown as the primary bold line on the invoice.
   * On item-pick this is set to `product.name` and should only change if the
   * user manually edits it. Wire-format key is `itemName` on the tRPC payload.
   */
  itemName: string;
  /**
   * Optional free-text notes for this line (per-invoice comments like
   * "Keep separate from order #42"). Rendered as italic muted secondary text
   * on the invoice detail view and PDF. Max 500 chars (validator-enforced).
   * UI-only key; on submission we map this to the payload's `description`
   * field (which the backend validator accepts as nullable/optional).
   */
  notes: string;
  quantity: string;
  /** Free goods on top of the billed quantity ("10 + 1"); moves stock, adds no value. */
  freeQuantity: string;
  /** Goods receipt notes: received but rejected, and why. Never enters stock. */
  rejectedQuantity: string;
  rejectionReason: string;
  unitPrice: string;
  taxPercent: string;
  discountPercent: string;
  selectedUnit?: string;
  conversionFactor?: string;
  availableUnits?: UnitOption[];
  /** On a return made against an invoice: the quantity that invoice had. */
  sourceQuantity?: string;
  /** The item keeps stock per batch: the line names its batch. */
  trackBatches?: boolean;
  trackExpiry?: boolean;
  /** Picked (outward) or saved batch. Empty on an outward line = earliest expiry first. */
  batchId?: string;
  /** Inward: batch typed in — matched to an existing batch or created. */
  batchNumber?: string;
  mfgDate?: string;
  expiryDate?: string;
  batchMrp?: string;
  /** Outward: the user allowed an expired batch to go out. */
  allowExpired?: boolean;
  /** Editing: the batch the line was saved with. */
  savedBatchId?: string;
}

interface Charge {
  label: string;
  amount: string;
  shipmentId?: string;
}

// ── Helpers ──────────────────────────────────────────────────────

const documentTypeLabels: Record<DocumentType, string> = {
  invoice: "Invoice",
  quotation: "Quotation",
  credit_note: "Credit Note",
  debit_note: "Debit Note",
  delivery_challan: "Delivery Challan",
  proforma: "Proforma Invoice",
  sales_return: "Sales Return",
  purchase_return: "Purchase Return",
  purchase_order: "Purchase Order",
  sales_order: "Sales Order",
  goods_receipt_note: "Goods Receipt Note",
};

/** Orders and GRNs are always one side; the server enforces the same. */
const fixedInvoiceType: Partial<Record<DocumentType, "sale" | "purchase">> = {
  purchase_order: "purchase",
  sales_order: "sale",
  goods_receipt_note: "purchase",
};

/** Which way a document moves stock: -1 out, +1 in, 0 not at all (mirrors the server). */
function stockDirection(documentType: DocumentType, invoiceType: "sale" | "purchase"): -1 | 0 | 1 {
  if (documentType === "invoice" || documentType === "delivery_challan") return invoiceType === "sale" ? -1 : 1;
  if (documentType === "purchase_return") return -1;
  if (documentType === "sales_return" || documentType === "goods_receipt_note") return 1;
  return 0;
}

/** Quantity of each item a set of lines takes (billed + free), in the item's base unit. */
function baseQuantities(lines: Array<{ itemId?: string | null; quantity: string; freeQuantity?: string | null; conversionFactor?: string | null }>) {
  const need = new Map<string, number>();
  for (const li of lines) {
    if (!li.itemId) continue;
    const q = (parseFloat(li.quantity || "0") + (parseFloat(li.freeQuantity || "0") || 0)) * parseFloat(li.conversionFactor || "1");
    if (Number.isFinite(q)) need.set(li.itemId, (need.get(li.itemId) ?? 0) + q);
  }
  return need;
}

/** Returns: goods coming back from a customer or going back to a supplier. */
const RETURN_TYPES: DocumentType[] = ["sales_return", "purchase_return"];

/** Documents that say how the goods go out to the party. */
function showsDeliveryMethod(documentType: DocumentType, invoiceType: "sale" | "purchase"): boolean {
  if (documentType === "purchase_return") return true;
  return invoiceType === "sale" && ["invoice", "quotation", "proforma", "sales_order", "delivery_challan"].includes(documentType);
}

function newLineItem(): LineItem {
  return {
    id: crypto.randomUUID(),
    itemName: "",
    notes: "",
    quantity: "1",
    freeQuantity: "",
    rejectedQuantity: "",
    rejectionReason: "",
    unitPrice: "",
    taxPercent: "0",
    discountPercent: "0",
  };
}

const positive = (v: string | null | undefined) => (parseFloat(v || "0") || 0) > 0;

function calcLine(li: LineItem, intraState: boolean) {
  const result = calcLineItem({
    quantity: li.quantity || "0",
    unitPrice: li.unitPrice || "0",
    taxPercent: li.taxPercent || "0",
    discountPercent: li.discountPercent || "0",
    intraState,
  });
  return {
    subtotal: money.toNumber(result.subtotal),
    afterDiscount: money.toNumber(result.afterDiscount),
    taxAmt: money.toNumber(result.taxAmount),
    total: money.toNumber(result.total),
  };
}

// ── Component ────────────────────────────────────────────────────

export function DocumentCreator({
  documentType,
  invoiceType: requestedInvoiceType,
  onClose,
  onSuccess,
  editInvoiceId,
  prefillFromInvoiceId,
  initialPartyId,
}: DocumentCreatorProps) {
  const invoiceType = fixedInvoiceType[documentType] ?? requestedInvoiceType;
  // Batch entry needs the plan's batches-and-expiry feature. Without it no batch fields are sent
  // (the server picks the earliest-expiry batch itself) and the picker explains why it is off.
  const batchFeature = useFeature("batchesExpiry");
  // Free goods ("10 + 1") on any goods document; rejections only on a GRN.
  const allowsFree = (freeQuantityDocumentTypes as readonly string[]).includes(documentType);
  const isGrn = documentType === "goods_receipt_note";
  const isPurchaseBill = documentType === "invoice" && invoiceType === "purchase";
  const [partyId, setPartyId] = useState(initialPartyId ?? "");
  const [invoiceDate, setInvoiceDate] = useState(todayISODate);
  const [dueDate, setDueDate] = useState(() => dayjs().add(7, "day").format("YYYY-MM-DD"));
  const [dueDateManuallySet, setDueDateManuallySet] = useState(false);
  const [notes, setNotes] = useState("");
  // Purchase invoices: the supplier's own bill number (matched against GSTR-2B)
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const [terms, setTerms] = useState("");
  const [items, setItems] = useState<LineItem[]>([newLineItem()]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [invoiceDiscount, setInvoiceDiscount] = useState("0");
  const [invoiceDiscountType, setInvoiceDiscountType] = useState<"amount" | "percent">("amount");
  const [roundOff, setRoundOff] = useState("0");
  // Tracks whether the user has manually edited the Round Off field on this
  // document. Once true we stop applying the per-business "round down to
  // integer" auto-fill so we don't silently undo their override.
  const [roundOffOverridden, setRoundOffOverridden] = useState(false);
  const [referenceDocumentId, setReferenceDocumentId] = useState<string | undefined>(prefillFromInvoiceId || undefined);
  // A return started from its own page picks the invoice it is against here;
  // one started from the invoice arrives with prefillFromInvoiceId instead.
  const isReturn = RETURN_TYPES.includes(documentType);
  const [pickedSourceId, setPickedSourceId] = useState("");
  const [sourceSearch, setSourceSearch] = useState("");
  const debouncedSourceSearch = useDebounce(sourceSearch, 300);
  // How the goods go out: built-in methods plus the business's own.
  const withDelivery = showsDeliveryMethod(documentType, fixedInvoiceType[documentType] ?? requestedInvoiceType);
  const [deliveryMethod, setDeliveryMethod] = useState("self_pickup");
  const [deliveryMethodTouched, setDeliveryMethodTouched] = useState(false);
  const deliveryOptions = useDeliveryMethods();
  // Warehouse the goods leave from or arrive into. Starts at the business
  // default for this kind of document; only shown when there's a choice.
  const [warehouseId, setWarehouseId] = useState("");

  // Sale prices from the party's price level (slabs, dates); typed prices are kept.
  const pricing = useLevelPricing({
    enabled: invoiceType === "sale" && documentType !== "credit_note" && documentType !== "sales_return",
    partyId,
    date: invoiceDate,
    lines: items,
    setLines: setItems,
  });

  // Confirm dialog when closing with unsaved data
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  // Ref the date input so we can move focus there as soon as a customer is
  // picked — otherwise Tab cycles back to the customer combobox in the
  // dialog's focus order.
  const dateInputId = useId();

  // Active business — used to read defaultRoundOff and defaultTermsAndConditions.
  // The list is already cached by __root.tsx; this query is essentially free.
  const { data: businessList } = trpc.business.list.useQuery();
  const currentBizId = getBusinessId();
  const activeBusiness =
    businessList?.find((b) => b.id === currentBizId) ?? businessList?.[0];
  const bizDefaultTerms = activeBusiness?.defaultTermsAndConditions ?? "";
  const bizDefaultRoundOff = activeBusiness?.defaultRoundOff ?? false;

  // Server-side search for party picker
  const [partySearch, setPartySearch] = useState("");
  const debouncedPartySearch = useDebounce(partySearch, 300);

  const { data: partiesData, isFetching: partiesFetching } = trpc.party.list.useQuery({
    type: invoiceType === "sale" ? "customer" : "supplier",
    search: debouncedPartySearch || undefined,
    page: 1,
    limit: 50,
  });

  // Server-side search for item picker (per line item)
  const [itemSearch, setItemSearch] = useState("");
  const debouncedItemSearch = useDebounce(itemSearch, 300);

  const { data: itemsData, isFetching: itemsFetching } = trpc.item.list.useQuery({
    search: debouncedItemSearch || undefined,
    page: 1,
    limit: 50,
  });

  // Quick-create dialog state
  const [quickPartyOpen, setQuickPartyOpen] = useState(false);
  const [quickPartyName, setQuickPartyName] = useState("");
  const [quickItemOpen, setQuickItemOpen] = useState(false);
  const [quickItemName, setQuickItemName] = useState("");
  const [quickItemLineId, setQuickItemLineId] = useState<string | null>(null);

  const isEditing = !!editInvoiceId;
  const canPickSource = isReturn && !isEditing && !prefillFromInvoiceId;
  const prefillId = editInvoiceId || prefillFromInvoiceId || pickedSourceId || undefined;

  const { data: sourceInvoices, isFetching: sourceInvoicesFetching } = trpc.invoice.list.useQuery(
    {
      type: invoiceType,
      partyId: partyId || undefined,
      search: debouncedSourceSearch || undefined,
      page: 1,
      limit: 50,
    },
    { enabled: canPickSource },
  );

  // A sale's last delivery method is the likeliest one for the next.
  const { data: lastDeliveryMethod } = trpc.invoice.lastDeliveryMethod.useQuery(
    { partyId },
    { enabled: withDelivery && invoiceType === "sale" && !!partyId && !isEditing },
  );
  useEffect(() => {
    if (!lastDeliveryMethod || deliveryMethodTouched || isEditing) return;
    if (deliveryOptions.some((o) => o.id === lastDeliveryMethod)) setDeliveryMethod(lastDeliveryMethod);
  }, [lastDeliveryMethod, deliveryMethodTouched, isEditing, deliveryOptions]);

  // Pre-fill standard Terms & Conditions from business defaults on new docs
  // only — editing a saved doc must respect what was actually persisted.
  // Runs once when the biz default first becomes available; if the user has
  // already typed something, we don't clobber it.
  const termsHydratedRef = useRef(false);
  useEffect(() => {
    if (isEditing || prefillId) return;
    if (termsHydratedRef.current) return;
    if (!bizDefaultTerms) return;
    if (terms.trim().length > 0) return;
    setTerms(bizDefaultTerms);
    termsHydratedRef.current = true;
  }, [bizDefaultTerms, isEditing, prefillId, terms]);

  // Auto-calculate due date: party's credit period or default 7 days
  useEffect(() => {
    if (dueDateManuallySet || isEditing) return;
    const selectedParty = partiesData?.data.find((p) => p.id === partyId);
    const creditDays = selectedParty?.creditPeriodDays ?? 7;
    const base = dayjs(invoiceDate || todayISODate()).add(creditDays, "day");
    setDueDate(base.format("YYYY-MM-DD"));
  }, [invoiceDate, partyId, partiesData, dueDateManuallySet, isEditing]);

  const utils = trpc.useUtils();

  const { data: editData } = trpc.invoice.getById.useQuery(
    { id: prefillId! },
    { enabled: !!prefillId }
  );

  const direction = stockDirection(documentType, invoiceType);
  const { data: warehouseList } = useWarehouses();
  const { data: inventorySettings } = trpc.stock.settings.useQuery(undefined, { enabled: direction !== 0, staleTime: 60_000 });
  const activeWarehouses = (warehouseList ?? []).filter((w) => w.status === "active");
  const showWarehouse = direction !== 0 && activeWarehouses.length > 1;

  useEffect(() => {
    if (warehouseId || !inventorySettings || isEditing) return;
    const fallback =
      documentType === "sales_return" ? inventorySettings.salesReturnWarehouseId
      : documentType === "purchase_return" ? inventorySettings.purchaseReturnWarehouseId
      : ((documentType === "invoice" || documentType === "delivery_challan") && invoiceType === "purchase") || documentType === "goods_receipt_note" ? inventorySettings.purchaseWarehouseId
      : inventorySettings.salesWarehouseId;
    if (fallback) setWarehouseId(fallback);
  }, [inventorySettings, warehouseId, isEditing, documentType, invoiceType]);

  // The document the form was last filled from. A background refetch of the
  // same document (window focus, a list invalidated elsewhere) must not put
  // back lines the user removed or quantities they changed.
  const filledFrom = useRef<string | null>(null);

  useEffect(() => {
    if (!editData) {
      filledFrom.current = null;
      return;
    }
    if (filledFrom.current === editData.id) return;
    filledFrom.current = editData.id;
    setPartyId(editData.partyId);
    if (isEditing && editData.warehouseId) setWarehouseId(editData.warehouseId);
    if (isEditing) {
      // Editing: use the document's own date
      setInvoiceDate(formatDateInput(editData.invoiceDate));
      if (editData.dueDate) setDueDate(formatDateInput(editData.dueDate));
      if (editData.deliveryMethod) setDeliveryMethod(editData.deliveryMethod);
      setSupplierInvoiceNumber(editData.supplierInvoiceNumber || "");
    }
    // Prefill from source: keep today's date (already the default)
    setNotes(editData.notes || "");
    setTerms(editData.termsAndConditions || "");
    setRoundOff(editData.roundOff || "0");

    // Pre-fill invoice discount
    if (editData.discountAmount && parseFloat(editData.discountAmount) > 0) {
      setInvoiceDiscount(editData.discountAmount);
      setInvoiceDiscountType("amount"); // stored discount is always an amount
    }

    // Map charges from JSONB
    if (editData.charges && Array.isArray(editData.charges)) {
      setCharges(editData.charges.map((c: any) => ({ label: c.label, amount: c.amount, ...(c.shipmentId ? { shipmentId: c.shipmentId } : {}) })));
    }

    // Map line items — backend now exposes `itemName` (required snapshot)
    // and `description` (nullable free-text notes) as separate fields.
    if (editData.lineItems?.length) {
      setItems(editData.lineItems.map((li: any) => ({
        id: crypto.randomUUID(),
        itemId: li.itemId || undefined,
        itemName: li.itemName ?? "",
        notes: li.description ?? "",
        quantity: li.quantity,
        freeQuantity: allowsFree && positive(li.freeQuantity) ? String(parseFloat(li.freeQuantity)) : "",
        // Rejections belong to the GRN they were recorded on.
        rejectedQuantity: isGrn && isEditing && positive(li.rejectedQuantity) ? String(parseFloat(li.rejectedQuantity)) : "",
        rejectionReason: isGrn && isEditing ? li.rejectionReason ?? "" : "",
        unitPrice: li.unitPrice,
        taxPercent: li.taxPercent || "0",
        discountPercent: li.discountPercent || "0",
        selectedUnit: li.selectedUnit || undefined,
        conversionFactor: li.conversionFactor && parseFloat(li.conversionFactor) !== 1 ? li.conversionFactor : undefined,
        // A return can't send back more than its invoice had.
        sourceQuantity: RETURN_TYPES.includes(documentType) && !editInvoiceId ? String(parseFloat(li.quantity)) : undefined,
        // A saved batch stays on the line (a return made from an invoice
        // brings its goods back into the batch they went out of).
        batchId: li.batchId || undefined,
        savedBatchId: li.batchId || undefined,
        batchNumber: li.batch?.batchNumber ?? undefined,
        expiryDate: li.batch?.expiryDate ?? undefined,
        mfgDate: li.batch?.mfgDate ?? undefined,
        batchMrp: li.batch?.mrp ?? undefined,
        // Sending expired stock back to the supplier is what purchase returns are for.
        allowExpired: documentType === "purchase_return" && !!li.batchId ? true : undefined,
      })));
    }
  }, [editData]);

  function pickSourceInvoice(id: string) {
    setPickedSourceId(id);
    setReferenceDocumentId(id || undefined);
    if (!id) setItems((prev) => prev.map((li) => ({ ...li, sourceQuantity: undefined })));
  }

  function invalidateLists() {
    utils.invoice.list.invalidate();
    utils.quotation.list.invalidate();
    utils.creditNote.list.invalidate();
    utils.debitNote.list.invalidate();
    utils.deliveryChallan.list.invalidate();
    utils.proforma.list.invalidate();
    utils.salesReturn.list.invalidate();
    utils.purchaseReturn.list.invalidate();
    utils.purchaseOrder.list.invalidate();
    utils.salesOrder.list.invalidate();
    utils.goodsReceiptNote.list.invalidate();
    utils.orders.invalidate();
    utils.dashboard.summary.invalidate();
    // Party balances and ledgers include what was just saved.
    utils.party.invalidate();
    utils.dashboard.shippingSummary.invalidate();
    // Stock moved: warehouses, batches and inventory reports show it now.
    void invalidateStockViews(utils);
    if (editInvoiceId) {
      utils.invoice.getById.invalidate({ id: editInvoiceId });
    }
    // A note or return changes what is left to pay on the invoice it is
    // against: its panel and the payment form must not show the old balance.
    if (referenceDocumentId) {
      utils.invoice.getById.invalidate({ id: referenceDocumentId });
      utils.payment.unpaidInvoices.invalidate();
    }
  }

  function handleSuccess() {
    invalidateLists();
    toast.success(isEditing ? `${documentTypeLabels[documentType]} updated` : `${documentTypeLabels[documentType]} created`);
    onSuccess?.(partyId || undefined);
    onClose();
  }

  function handleInvoiceCreateSuccess(data: { invoiceNumber: string }) {
    invalidateLists();
    toast.success(`Invoice ${data.invoiceNumber} created`);
    onSuccess?.(partyId || undefined);
    onClose();
  }

  function handleError(err: { message: string }) {
    toast.error(isEditing ? "Failed to update document" : "Failed to create document", err.message);
  }

  // Dirty detection: snapshot the form once it has settled (after editData
  // applies for edits, or on first mount for new docs) and compare every
  // render. The snapshot is taken in a microtask so React has flushed all
  // setStates triggered by the editData effect before we baseline.
  const formSnapshot = useMemo(
    () => JSON.stringify({
      partyId,
      invoiceDate,
      dueDate,
      notes,
      terms,
      // Strip the random `id` field so re-mounted line items don't appear
      // dirty just because of a fresh UUID.
      items: items.map(({ id: _id, ...rest }) => rest),
      charges,
      invoiceDiscount,
      invoiceDiscountType,
      roundOff,
      deliveryMethod,
    }),
    [partyId, invoiceDate, dueDate, notes, terms, items, charges, invoiceDiscount, invoiceDiscountType, roundOff, deliveryMethod]
  );
  const formSnapshotRef = useRef(formSnapshot);
  formSnapshotRef.current = formSnapshot;
  const baselineRef = useRef<string | null>(null);

  useEffect(() => {
    // Re-baseline whenever editData becomes available (or stays undefined for
    // a new doc). The microtask defer waits for setStates inside the editData
    // effect to land before snapshotting.
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      baselineRef.current = formSnapshotRef.current;
    });
    return () => { cancelled = true; };
  }, [editData?.id]);

  const isDirty =
    baselineRef.current !== null && baselineRef.current !== formSnapshot;

  // All mutation hooks called unconditionally (React rules)
  const invoiceMutation = trpc.invoice.create.useMutation({
    onSuccess: isEditing ? handleSuccess : handleInvoiceCreateSuccess,
    onError: handleError,
  });
  const quotationMutation = trpc.quotation.create.useMutation({
    onSuccess: handleSuccess,
    onError: handleError,
  });
  const creditNoteMutation = trpc.creditNote.create.useMutation({
    onSuccess: handleSuccess,
    onError: handleError,
  });
  const debitNoteMutation = trpc.debitNote.create.useMutation({
    onSuccess: handleSuccess,
    onError: handleError,
  });
  const deliveryChallanMutation = trpc.deliveryChallan.create.useMutation({
    onSuccess: handleSuccess,
    onError: handleError,
  });
  const proformaMutation = trpc.proforma.create.useMutation({
    onSuccess: handleSuccess,
    onError: handleError,
  });
  const salesReturnMutation = trpc.salesReturn.create.useMutation({
    onSuccess: handleSuccess,
    onError: handleError,
  });
  const purchaseReturnMutation = trpc.purchaseReturn.create.useMutation({
    onSuccess: handleSuccess,
    onError: handleError,
  });
  const purchaseOrderMutation = trpc.purchaseOrder.create.useMutation({
    onSuccess: handleSuccess,
    onError: handleError,
  });
  const salesOrderMutation = trpc.salesOrder.create.useMutation({
    onSuccess: handleSuccess,
    onError: handleError,
  });
  const goodsReceiptNoteMutation = trpc.goodsReceiptNote.create.useMutation({
    onSuccess: handleSuccess,
    onError: handleError,
  });

  const updateMutation = trpc.invoice.update.useMutation({
    onSuccess: handleSuccess,
    onError: handleError,
  });

  const mutationMap: Record<DocumentType, { mutate: (input: any) => void; isPending: boolean }> = {
    invoice: invoiceMutation,
    quotation: quotationMutation,
    credit_note: creditNoteMutation,
    debit_note: debitNoteMutation,
    delivery_challan: deliveryChallanMutation,
    proforma: proformaMutation,
    sales_return: salesReturnMutation,
    purchase_return: purchaseReturnMutation,
    purchase_order: purchaseOrderMutation,
    sales_order: salesOrderMutation,
    goods_receipt_note: goodsReceiptNoteMutation,
  };

  const createMutation = mutationMap[documentType];
  const activeMutation = isEditing ? updateMutation : createMutation;

  // The picked party's state, kept while a party search hides it from the
  // list. With the business's state it decides intra-state (CGST + SGST,
  // each rounded at half the rate) the way the server does when it saves.
  const [partyGst, setPartyGst] = useState<(GstStateParty & { id: string }) | null>(null);
  useEffect(() => {
    const p = partiesData?.data.find((x) => x.id === partyId)
      ?? (editData?.party?.id === partyId ? editData.party : undefined);
    if (!p) return;
    // Keep the same object while nothing changed, so a refetch (or a list
    // rebuilt on every render) does not re-render the form.
    setPartyGst((prev) =>
      prev && prev.id === p.id && prev.stateCode === p.stateCode && prev.state === p.state && prev.gstin === p.gstin
        ? prev
        : { id: p.id, stateCode: p.stateCode, state: p.state, gstin: p.gstin });
  }, [partyId, partiesData, editData]);
  const intraState = isIntraStateSupply(activeBusiness ?? {}, partyGst?.id === partyId ? partyGst : {});

  // Computed totals using fixed-point arithmetic
  const totals = useMemo(() => {
    const activeCharges = charges.filter((c) => c.amount && parseFloat(c.amount) > 0);
    const result = calcInvoiceTotals({
      lineItems: items.map((li) => ({
        quantity: li.quantity || "0",
        unitPrice: li.unitPrice || "0",
        taxPercent: li.taxPercent || "0",
        discountPercent: li.discountPercent || "0",
      })),
      charges: activeCharges.map((c) => ({ amount: c.amount })),
      invoiceDiscount: invoiceDiscount || "0",
      invoiceDiscountType,
      roundOff: roundOff || "0",
      intraState,
    });
    return {
      subtotal: money.toNumber(result.subtotal),
      taxTotal: money.toNumber(result.taxTotal),
      lineDiscountTotal: money.toNumber(result.lineDiscountTotal),
      invoiceDiscountAmount: money.toNumber(result.invoiceDiscountAmount),
      chargesTotal: money.toNumber(result.chargesTotal),
      total: money.toNumber(result.total),
    };
  }, [items, charges, invoiceDiscount, invoiceDiscountType, roundOff, intraState]);

  // Auto-fill round-off so the grand total floors to a whole rupee, when the
  // business has "round down to integer" enabled. Stops as soon as the user
  // edits the field manually (`roundOffOverridden`) so we never silently
  // override their explicit number.  Edit mode preserves whatever round-off
  // was saved with the original document.
  useEffect(() => {
    if (isEditing) return;
    if (roundOffOverridden) return;
    if (!bizDefaultRoundOff) return;
    const current = parseFloat(roundOff || "0");
    const rawTotal = totals.total - current;
    if (!Number.isFinite(rawTotal)) return;
    const target = (Math.floor(rawTotal) - rawTotal).toFixed(2);
    if (target !== current.toFixed(2)) {
      setRoundOff(target);
    }
  }, [bizDefaultRoundOff, isEditing, roundOffOverridden, totals.total, roundOff]);

  const neededByItem = useMemo(() => baseQuantities(items), [items]);
  const neededItemIds = useMemo(() => [...neededByItem.keys()].sort(), [neededByItem]);
  const { data: availability } = trpc.stock.availability.useQuery(
    { warehouseId: warehouseId || null, lines: neededItemIds.map((itemId) => ({ itemId })) },
    { enabled: direction === -1 && neededItemIds.length > 0 },
  );

  const shortages = useMemo(() => {
    if (!availability || availability.policy === "allow") return [];
    // An edited document already holds its own stock at its warehouse.
    const alreadyHeld =
      isEditing && editData?.warehouseId && editData.warehouseId === availability.warehouseId
        ? baseQuantities(editData.lineItems ?? [])
        : new Map<string, number>();
    const out: Array<{ name: string; available: number; needed: number; unit: string | null }> = [];
    for (const row of availability.lines) {
      if (row.variantId) continue;
      const needed = neededByItem.get(row.itemId) ?? 0;
      const available = parseFloat(row.available) + (alreadyHeld.get(row.itemId) ?? 0);
      if (needed - available > 0.0005) {
        const product = itemsData?.data.find((p) => p.id === row.itemId);
        const line = items.find((li) => li.itemId === row.itemId);
        out.push({ name: product?.name ?? line?.itemName ?? "Item", available, needed, unit: product?.unit ?? null });
      }
    }
    return out;
  }, [availability, neededByItem, isEditing, editData, itemsData, items]);

  function updateItem(id: string, field: keyof LineItem, value: string) {
    setItems((prev) =>
      prev.map((li) => (li.id === id ? { ...li, [field]: value } : li))
    );
  }

  function selectProduct(lineId: string, productId: string) {
    // Look in current search results; fall back gracefully if not found
    const product = itemsData?.data.find((p) => p.id === productId);
    if (!productId) {
      // Cleared selection
      setItems((prev) =>
        prev.map((li) =>
          li.id === lineId
            ? { ...li, itemId: undefined, availableUnits: undefined, selectedUnit: undefined, conversionFactor: undefined }
            : li
        )
      );
      return;
    }
    if (!product) return;

    const basePrice = (invoiceType === "sale" ? product.salePrice : product.purchasePrice) || "";
    const baseUnit: UnitOption = { unit: product.unit, salePrice: basePrice, conversionFactor: 1 };
    const variants: UnitOption[] = ((product.unitVariants as any[]) || []).map((v: any) => ({
      unit: v.unit,
      salePrice: invoiceType === "sale" ? v.salePrice : (v.purchasePrice || v.salePrice),
      conversionFactor: v.conversionFactor,
    }));
    const allUnits = [baseUnit, ...variants];

    setItems((prev) =>
      prev.map((li) =>
        li.id === lineId
          ? {
              ...li,
              itemId: product.id,
              // itemName is the frozen snapshot shown as the primary line on
              // the invoice. Notes are intentionally cleared on pick so the
              // new line starts with a blank notes field — users then type a
              // per-invoice comment (e.g. "Keep separate from order #42") if
              // they want one.
              itemName: product.name,
              notes: "",
              unitPrice: basePrice,
              taxPercent: product.taxPercent,
              selectedUnit: undefined,
              conversionFactor: undefined,
              availableUnits: allUnits.length > 1 ? allUnits : undefined,
              trackBatches: product.itemType !== "service" && !!product.trackBatches,
              trackExpiry: !!product.trackExpiry,
              batchId: undefined,
              batchNumber: undefined,
              mfgDate: undefined,
              expiryDate: undefined,
              batchMrp: undefined,
              allowExpired: undefined,
            }
          : li
      )
    );
  }

  function updateBatch(id: string, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((li) => (li.id === id ? { ...li, ...patch } : li)));
  }

  function addLine() {
    setItems((prev) => [...prev, newLineItem()]);
  }

  function removeLine(id: string) {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((li) => li.id !== id));
  }

  function handleSelectUnit(lineId: string, unitKey: string) {
    setItems((prev) =>
      prev.map((li) => {
        if (li.id !== lineId) return li;
        const unit = li.availableUnits?.find((u) =>
          unitKey === "__base__" ? u.conversionFactor === 1 : u.unit === unitKey
        );
        if (!unit) return li;
        return {
          ...li,
          selectedUnit: unitKey === "__base__" ? undefined : unit.unit,
          unitPrice: unit.salePrice,
          conversionFactor: unitKey === "__base__" ? undefined : String(unit.conversionFactor),
        };
      })
    );
  }

  function handleQuickPartyCreated(party: { id: string; name: string }) {
    setPartyId(party.id);
  }

  function handleQuickItemCreated(item: QuickItemCreateResult) {
    if (!quickItemLineId) return;
    const price = invoiceType === "sale" ? item.salePrice : item.purchasePrice;
    setItems((prev) =>
      prev.map((li) =>
        li.id === quickItemLineId
          ? {
              ...li,
              itemId: item.id,
              itemName: item.name,
              notes: "",
              unitPrice: price || "",
              taxPercent: item.taxPercent || "0",
              selectedUnit: undefined,
              conversionFactor: undefined,
              availableUnits: undefined,
            }
          : li
      )
    );
    setQuickItemLineId(null);
  }

  function handleSubmit() {
    const validItems = items.filter((li) => li.itemName.trim() && li.unitPrice);
    if (validItems.length === 0) {
      toast.error("Add at least one line item with an item name and price");
      return;
    }
    const emptyLine = validItems.find((li) =>
      !positive(li.quantity) && !(allowsFree && positive(li.freeQuantity)) && !(isGrn && positive(li.rejectedQuantity)));
    if (emptyLine) {
      toast.error(`Enter a quantity for ${emptyLine.itemName.trim()}`);
      return;
    }
    const unexplained = isGrn && validItems.find((li) => positive(li.rejectedQuantity) && !li.rejectionReason.trim());
    if (unexplained) {
      toast.error(`Give a reason for rejecting ${unexplained.itemName.trim()}`);
      return;
    }
    if (!partyId) {
      toast.error(
        `Select a ${invoiceType === "sale" ? "customer" : "supplier"}`
      );
      return;
    }
    const overReturned = validItems.find(
      (li) => li.sourceQuantity && parseFloat(li.quantity || "0") - parseFloat(li.sourceQuantity) > 0.0005,
    );
    if (overReturned) {
      toast.error(`Only ${overReturned.sourceQuantity} of ${overReturned.itemName} was on the invoice`);
      return;
    }

    // Bug B: the backend validator requires `itemName` (the frozen snapshot
    // shown as the primary bold line) and accepts an optional, nullable
    // `description` (free-text notes rendered underneath). Empty or
    // whitespace-only notes are sent as `undefined` so the validator keeps
    // the stored column NULL instead of persisting an empty string.
    const lineItemsPayload = validItems.map((li) => {
      const trimmedNotes = li.notes.trim();
      return {
        itemId: li.itemId,
        itemName: li.itemName.trim(),
        description: trimmedNotes.length > 0 ? trimmedNotes : undefined,
        quantity: li.quantity || "0",
        freeQuantity: allowsFree && positive(li.freeQuantity) ? li.freeQuantity : undefined,
        rejectedQuantity: isGrn && positive(li.rejectedQuantity) ? li.rejectedQuantity : undefined,
        rejectionReason: isGrn && positive(li.rejectedQuantity) ? li.rejectionReason.trim() : undefined,
        unitPrice: li.unitPrice,
        taxPercent: li.taxPercent,
        discountPercent: li.discountPercent,
        selectedUnit: li.selectedUnit || undefined,
        conversionFactor: li.conversionFactor || undefined,
        ...(!batchFeature.allowed
          ? {}
          : direction === 1 || (direction === 0 && li.batchId)
            ? batchInPayload(li)
            : li.batchId
              ? { batchId: li.batchId, ...(li.allowExpired ? { allowExpired: true } : {}) }
              : {}),
      };
    });

    const chargesPayload = charges
      .filter((c) => c.label && c.amount && parseFloat(c.amount) > 0)
      .map((c) => ({
        label: c.label,
        amount: parseFloat(c.amount).toFixed(2),
        ...(c.shipmentId ? { shipmentId: c.shipmentId } : {}),
      }));

    if (isEditing) {
      updateMutation.mutate({
        id: editInvoiceId!,
        partyId,
        invoiceDate: toISOString(invoiceDate),
        dueDate: toISOString(dueDate) ?? null,
        notes: notes || null,
        termsAndConditions: terms || null,
        charges: chargesPayload,
        invoiceDiscount: invoiceDiscount || "0",
        invoiceDiscountType,
        roundOff: roundOff || "0",
        lineItems: lineItemsPayload,
        warehouseId: direction !== 0 && warehouseId ? warehouseId : undefined,
        deliveryMethod: withDelivery ? deliveryMethod : undefined,
        ...(isPurchaseBill ? { supplierInvoiceNumber: supplierInvoiceNumber.trim() || null } : {}),
      });
    } else {
      createMutation.mutate({
        partyId,
        type: invoiceType,
        invoiceDate: toISOString(invoiceDate),
        dueDate: toISOString(dueDate),
        notes: notes || undefined,
        termsAndConditions: terms || undefined,
        charges: chargesPayload,
        invoiceDiscount: invoiceDiscount || "0",
        invoiceDiscountType,
        roundOff: roundOff || undefined,
        referenceDocumentId: referenceDocumentId || undefined,
        lineItems: lineItemsPayload,
        warehouseId: direction !== 0 && warehouseId ? warehouseId : undefined,
        deliveryMethod: withDelivery ? deliveryMethod : undefined,
        ...(isPurchaseBill && supplierInvoiceNumber.trim() ? { supplierInvoiceNumber: supplierInvoiceNumber.trim() } : {}),
      });
    }
  }

  const label = documentTypeLabels[documentType];
  // "Sales return" and "purchase order" already say which side they are on.
  const docKind = /^(sales|purchase) /i.test(label) ? label.toLowerCase() : `${invoiceType} ${label.toLowerCase()}`;
  const partyLabel = invoiceType === "sale" ? "Customer" : "Supplier";

  const partyOptions =
    partiesData?.data.map((p) => ({
      value: p.id,
      label: p.name,
      description: p.type === "customer" ? "Customer" : "Supplier",
    })) ?? [];

  // Drafts, cancelled invoices and ones already fully credited or returned
  // can't take a return.
  const sourceOptions: Array<{ value: string; label: string; description: string }> = (sourceInvoices?.data ?? [])
    .filter((inv: { status: string }) => !["draft", "cancelled", "adjusted"].includes(inv.status))
    .map((inv: { id: string; invoiceNumber: string; invoiceDate: string | Date; totalAmount: string; partyName?: string | null }) => ({
      value: inv.id,
      label: inv.invoiceNumber,
      description: `${inv.partyName ?? ""} · ${dayjs(inv.invoiceDate).format("DD MMM YYYY")} · ${formatCurrency(inv.totalAmount)}`,
    }));
  // Keep the picked invoice showing while the search narrows the list.
  if (pickedSourceId && editData && !sourceOptions.some((o) => o.value === pickedSourceId)) {
    sourceOptions.unshift({
      value: pickedSourceId,
      label: editData.invoiceNumber,
      description: `${editData.party?.name ?? ""} · ${dayjs(editData.invoiceDate).format("DD MMM YYYY")} · ${formatCurrency(editData.totalAmount)}`,
    });
  }

  // A saved method since removed from Settings → Shipping still shows.
  const deliverySelectOptions = deliveryOptions.some((o) => o.id === deliveryMethod)
    ? deliveryOptions
    : [...deliveryOptions, { id: deliveryMethod, label: deliveryMethod, hasTracking: false }];

  const itemOptions =
    itemsData?.data.map((p) => ({
      value: p.id,
      label: p.name,
      description: p.unit ? p.unit : undefined,
    })) ?? [];

  // Stable prefix for accessible line item IDs
  const lineItemIdPrefix = useId();

  // Close-attempt handler — only show the confirm dialog when there's data
  // worth losing. A pristine empty form closes silently.
  function handleCloseAttempt(): boolean {
    if (!isDirty) return true;
    setConfirmCloseOpen(true);
    return false;
  }

  return (
    <>
    <SlideOver
      open={true}
      onClose={onClose}
      onCloseAttempt={handleCloseAttempt}
      title={isEditing ? `Edit ${label}` : `New ${label}`}
      description={isEditing ? `Edit ${docKind}` : `Create a new ${docKind}`}
      footer={
        <div className="space-y-3">
        {shortages.length > 0 && (
          <div
            role="alert"
            className={cn(
              "rounded-lg border px-3 py-2 text-xs",
              availability?.policy === "block"
                ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
            )}
          >
            <p className="font-medium">
              {availability?.policy === "block"
                ? "Not enough stock — this can't be saved until the quantities fit"
                : "Not enough stock — saving will take it below zero"}
              {showWarehouse && ` at ${activeWarehouses.find((w) => w.id === availability?.warehouseId)?.name ?? "this warehouse"}`}
            </p>
            <ul className="mt-1 space-y-0.5">
              {shortages.map((s) => (
                <li key={s.name}>
                  {s.name}: {formatQty(Math.max(s.available, 0), s.unit)} available, {formatQty(s.needed, s.unit)} needed
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => { if (handleCloseAttempt()) onClose(); }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSubmit}
            disabled={activeMutation.isPending || !partyId || !items.some((li) => li.itemName.trim() && li.unitPrice)}
          >
            {activeMutation.isPending
              ? isEditing ? "Saving…" : "Creating…"
              : isEditing ? "Save Changes" : `Create ${label}`}
          </button>
        </div>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Top row: party, dates */}
        <div className="grid grid-cols-[1fr_140px_140px] gap-3">
          <Combobox
            label={partyLabel}
            required
            value={partyId}
            onChange={(id) => {
              setPartyId(id);
              if (pickedSourceId && editData && id !== editData.partyId) pickSourceInvoice("");
              // After picking a party, jump to the date input so Tab order
              // doesn't bounce focus back into the (now-selected) combobox
              // and re-open its dropdown.
              if (id) {
                requestAnimationFrame(() => document.getElementById(dateInputId)?.focus());
              }
            }}
            options={partyOptions}
            placeholder={`Search ${partyLabel.toLowerCase()}...`}
            emptyMessage={`No ${partyLabel.toLowerCase()}s found`}
            onQueryChange={setPartySearch}
            isLoading={partiesFetching && !!debouncedPartySearch}
            onCreateNew={(q) => {
              setQuickPartyName(q);
              setQuickPartyOpen(true);
            }}
            createNewLabel={`Create ${partyLabel.toLowerCase()}`}
            autoFocus={!isEditing && !partyId}
          />
          <div>
            <label className="label">Date</label>
            <DateInput
              id={dateInputId}
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className="input"
            />
          </div>
          {!["credit_note", "sales_return", "purchase_return"].includes(documentType) && (
            <div>
              <label className="label">{documentType === "sales_order" || documentType === "purchase_order" ? "Delivery by" : "Due date"}</label>
              <DateInput
                value={dueDate}
                onChange={(e) => { setDueDate(e.target.value); setDueDateManuallySet(true); }}
                className="input"
              />
            </div>
          )}
        </div>
        {isPurchaseBill && (
          <div className="max-w-xs">
            <label className="label" htmlFor={`${dateInputId}-supplier-invoice`}>Supplier invoice no.</label>
            <input
              id={`${dateInputId}-supplier-invoice`}
              className="input"
              value={supplierInvoiceNumber}
              maxLength={50}
              onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
              placeholder="As printed on the supplier's bill"
            />
            <p className="mt-1 text-xs text-text-tertiary">Matched against the supplier's invoices in GSTR-2B.</p>
          </div>
        )}
        {pricing.priceLevelName && (
          <p className="-mt-3 text-xs text-text-tertiary">
            Prices from the <span className="font-medium text-text-secondary">{pricing.priceLevelName}</span> price level
          </p>
        )}

        {canPickSource && (
          <div>
            <Combobox
              label={`Against ${invoiceType === "sale" ? "sale" : "purchase"} invoice (optional)`}
              value={pickedSourceId}
              onChange={pickSourceInvoice}
              options={sourceOptions}
              placeholder="Search invoice number or party…"
              emptyMessage="No invoices to return against"
              onQueryChange={setSourceSearch}
              isLoading={sourceInvoicesFetching && !!debouncedSourceSearch}
            />
            <p className="mt-1 text-xs text-text-tertiary">
              {pickedSourceId
                ? "Lines are copied from the invoice. Remove the ones not coming back and lower the quantities to what is returned."
                : "Pick the invoice the goods came on to copy its lines and count the return against it."}
            </p>
          </div>
        )}

        {withDelivery && (
          <div className="max-w-xs">
            <label className="label" htmlFor={`${dateInputId}-delivery`}>Delivery method</label>
            <Select
              id={`${dateInputId}-delivery`}
              aria-label="Delivery method"
              value={deliveryMethod}
              onChange={(e) => { setDeliveryMethod(e.target.value); setDeliveryMethodTouched(true); }}
              className="input"
            >
              {deliverySelectOptions.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </Select>
          </div>
        )}

        {showWarehouse && (
          <div className="max-w-xs">
            <WarehouseSelect
              label={direction === -1 ? "Dispatch from" : "Receive into"}
              value={warehouseId}
              onChange={setWarehouseId}
            />
          </div>
        )}

        {/* Line items */}
        <div className="space-y-3">
          <p className="text-2xs font-medium text-text-tertiary uppercase tracking-wide">Line Items</p>

          {items.map((li) => {
            const calc = calcLine(li, intraState);
            return (
              <div key={li.id} data-testid="document-line" className="rounded-xl border border-border-light bg-surface-1/50 px-4 py-3 space-y-2">
                {/* Row 1: Product (searchable combobox) + unit selector + delete */}
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <Combobox
                      value={li.itemId || ""}
                      onChange={(productId) => selectProduct(li.id, productId)}
                      options={itemOptions}
                      placeholder="Select product or custom item"
                      emptyMessage="No products found"
                      onQueryChange={setItemSearch}
                      isLoading={itemsFetching && !!debouncedItemSearch}
                      onCreateNew={(q) => {
                        setQuickItemName(q);
                        setQuickItemLineId(li.id);
                        setQuickItemOpen(true);
                      }}
                      createNewLabel="Create item"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(li.id)}
                    disabled={items.length <= 1}
                    className="p-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/50 disabled:opacity-20 disabled:cursor-not-allowed transition-colors shrink-0 mt-0.5"
                    aria-label="Remove line"
                  >
                    {/* Trash icon — distinct from the combobox's clear-X
                        which sits next to it inside the product picker. */}
                    <Icon icon={Delete02Icon} size={15} />
                  </button>
                </div>

                {/* Unit selector pills — only for items with alt units */}
                {li.availableUnits && li.availableUnits.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5 pl-0.5" role="radiogroup" aria-label="Select unit">
                    {li.availableUnits.map((u) => {
                      const isSelected = (u.conversionFactor === 1 && !li.selectedUnit) || li.selectedUnit === u.unit;
                      const isBase = u.conversionFactor === 1;
                      return (
                        <button
                          key={u.unit}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          onClick={() => handleSelectUnit(li.id, isBase ? "__base__" : u.unit)}
                          className={cn(
                            "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border",
                            isSelected
                              ? "bg-brand-600 text-white border-brand-600"
                              : "border-border-light text-text-secondary hover:bg-surface-1"
                          )}
                        >
                          <span>{u.unit.toUpperCase()}</span>
                          <span className={cn("tabular-nums", isSelected ? "text-white/80" : "text-text-tertiary")}>
                            ₹{u.salePrice}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Item name is set automatically from the picker — no separate
                    input needed. The notes textarea below handles free-text. */}

                {/* Row 3: Numbers grid + total */}
                <div className="flex items-end gap-2">
                  <div className={cn("grid gap-2 flex-1", allowsFree ? "grid-cols-5" : "grid-cols-4")}>
                    <div>
                      <label
                        htmlFor={`${lineItemIdPrefix}-${li.id}-qty`}
                        className="text-2xs font-medium text-text-tertiary block mb-0.5"
                      >
                        {isGrn ? "Accepted" : "Qty"}
                      </label>
                      <input
                        id={`${lineItemIdPrefix}-${li.id}-qty`}
                        type="number"
                        value={li.quantity}
                        onChange={(e) => updateItem(li.id, "quantity", e.target.value)}
                        min="0"
                        step="any"
                        aria-label={isGrn ? "Accepted quantity" : "Quantity"}
                        className="input py-1.5 text-sm tabular-nums"
                        placeholder="1"
                      />
                      {li.sourceQuantity && (
                        <p
                          className={cn(
                            "mt-0.5 text-2xs tabular-nums",
                            parseFloat(li.quantity || "0") - parseFloat(li.sourceQuantity) > 0.0005 ? "text-red-600" : "text-text-tertiary",
                          )}
                        >
                          of {li.sourceQuantity} invoiced
                        </p>
                      )}
                    </div>
                    {allowsFree && (
                      <div>
                        <label
                          htmlFor={`${lineItemIdPrefix}-${li.id}-free`}
                          className="text-2xs font-medium text-text-tertiary block mb-0.5"
                          title="Given free on top of the billed quantity (10 + 1). Moves stock; not charged or taxed."
                        >
                          Free
                        </label>
                        <input
                          id={`${lineItemIdPrefix}-${li.id}-free`}
                          type="number"
                          value={li.freeQuantity}
                          onChange={(e) => updateItem(li.id, "freeQuantity", e.target.value)}
                          min="0"
                          step="any"
                          aria-label="Free quantity"
                          className="input py-1.5 text-sm tabular-nums"
                          placeholder="0"
                        />
                      </div>
                    )}
                    <div>
                      <label
                        htmlFor={`${lineItemIdPrefix}-${li.id}-price`}
                        className="text-2xs font-medium text-text-tertiary block mb-0.5"
                      >
                        Price
                      </label>
                      <input
                        id={`${lineItemIdPrefix}-${li.id}-price`}
                        type="number"
                        value={li.unitPrice}
                        onChange={(e) => updateItem(li.id, "unitPrice", e.target.value)}
                        min="0"
                        step="0.01"
                        aria-label="Unit price"
                        className="input py-1.5 text-sm tabular-nums"
                        placeholder="0.00"
                      />
                      {pricing.mrpWarningFor(li) && (
                        <p className="mt-0.5 text-2xs text-amber-600 dark:text-amber-400" role="alert">{pricing.mrpWarningFor(li)}</p>
                      )}
                    </div>
                    <div>
                      <label
                        htmlFor={`${lineItemIdPrefix}-${li.id}-tax`}
                        className="text-2xs font-medium text-text-tertiary block mb-0.5"
                      >
                        Tax %
                      </label>
                      <input
                        id={`${lineItemIdPrefix}-${li.id}-tax`}
                        type="number"
                        value={li.taxPercent}
                        onChange={(e) => updateItem(li.id, "taxPercent", e.target.value)}
                        min="0"
                        step="0.01"
                        aria-label="Tax percent"
                        className="input py-1.5 text-sm tabular-nums"
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`${lineItemIdPrefix}-${li.id}-disc`}
                        className="text-2xs font-medium text-text-tertiary block mb-0.5"
                      >
                        Disc %
                      </label>
                      <input
                        id={`${lineItemIdPrefix}-${li.id}-disc`}
                        type="number"
                        value={li.discountPercent}
                        onChange={(e) => updateItem(li.id, "discountPercent", e.target.value)}
                        min="0"
                        max="100"
                        step="0.01"
                        aria-label="Discount percent"
                        className="input py-1.5 text-sm tabular-nums"
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <div className="text-right shrink-0 pb-1">
                    <p className="text-2xs text-text-tertiary mb-0.5">Amount</p>
                    <p className="text-sm font-semibold tabular-nums text-text-primary">
                      {li.unitPrice ? formatCurrency(calc.total) : "—"}
                    </p>
                  </div>
                </div>

                {isGrn && (
                  <div className="grid grid-cols-[7rem_1fr] gap-2">
                    <div>
                      <label
                        htmlFor={`${lineItemIdPrefix}-${li.id}-rejected`}
                        className="text-2xs font-medium text-text-tertiary block mb-0.5"
                      >
                        Rejected
                      </label>
                      <input
                        id={`${lineItemIdPrefix}-${li.id}-rejected`}
                        type="number"
                        value={li.rejectedQuantity}
                        onChange={(e) => updateItem(li.id, "rejectedQuantity", e.target.value)}
                        min="0"
                        step="any"
                        aria-label="Rejected quantity"
                        className="input py-1.5 text-sm tabular-nums"
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`${lineItemIdPrefix}-${li.id}-reason`}
                        className="text-2xs font-medium text-text-tertiary block mb-0.5"
                      >
                        Reason for rejecting
                      </label>
                      <input
                        id={`${lineItemIdPrefix}-${li.id}-reason`}
                        list={`${lineItemIdPrefix}-reasons`}
                        value={li.rejectionReason}
                        onChange={(e) => updateItem(li.id, "rejectionReason", e.target.value)}
                        disabled={!positive(li.rejectedQuantity)}
                        maxLength={200}
                        aria-label="Reason for rejecting"
                        className="input py-1.5 text-sm disabled:opacity-50"
                        placeholder={positive(li.rejectedQuantity) ? "Damaged, short expiry…" : "Nothing rejected"}
                      />
                    </div>
                  </div>
                )}

                {/* Batch: typed in on the way in, picked (or earliest expiry
                    first) on the way out. Only for items that track batches. */}
                {li.itemId && direction !== 0 && (li.trackBatches || li.batchId) && (
                  <div className="rounded-lg border border-border-light bg-surface-0 px-3 py-2">
                    {!batchFeature.allowed ? (
                      <p role="status" className="text-xs text-text-secondary" data-testid="batch-plan-note">
                        {batchFeature.message} Batches are picked for you, earliest expiry first.
                      </p>
                    ) : direction === 1 ? (
                      <BatchInFields
                        itemId={li.itemId}
                        trackExpiry={!!li.trackExpiry}
                        value={li}
                        onChange={(patch) => updateBatch(li.id, patch)}
                      />
                    ) : (
                      <BatchOutSelect
                        itemId={li.itemId}
                        warehouseId={warehouseId || null}
                        date={invoiceDate}
                        needed={(parseFloat(li.quantity || "0") + parseFloat(li.freeQuantity || "0")) * parseFloat(li.conversionFactor || "1") || 0}
                        batchId={li.batchId ?? ""}
                        allowExpired={!!li.allowExpired}
                        onChange={(patch) => updateBatch(li.id, patch)}
                        savedBatch={isEditing && li.savedBatchId ? { id: li.savedBatchId, label: li.batchNumber ?? "Saved batch" } : null}
                      />
                    )}
                  </div>
                )}

                {/* Row 4: Free-text notes for this line (optional). Stored
                    on the backend as `invoice_items.description` and
                    rendered as italic muted secondary text on the PDF and
                    detail views beneath the item name. */}
                <div className="relative">
                  <textarea
                    id={`${lineItemIdPrefix}-${li.id}-notes`}
                    value={li.notes}
                    onChange={(e) => updateItem(li.id, "notes", e.target.value)}
                    placeholder="Notes for this line (optional)"
                    aria-label="Line notes"
                    rows={2}
                    maxLength={500}
                    className="input py-1.5 text-xs resize-y min-h-[2.25rem]"
                  />
                  {li.notes.length > 400 && (
                    <p
                      className={`absolute right-2 bottom-1 text-2xs tabular-nums pointer-events-none ${
                        li.notes.length > 500
                          ? "text-red-500"
                          : "text-text-tertiary"
                      }`}
                      aria-live="polite"
                    >
                      {li.notes.length} / 500
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {/* Add line button */}
          <button
            type="button"
            onClick={addLine}
            className="w-full py-2.5 rounded-xl border border-dashed border-border-light text-sm font-medium text-brand-600 hover:bg-brand-600/5 hover:border-brand-400 transition-colors"
          >
            + Add line item
          </button>
          {isGrn && (
            <>
              <datalist id={`${lineItemIdPrefix}-reasons`}>
                {rejectionReasons.map((r) => <option key={r} value={r} />)}
              </datalist>
              <p className="text-xs text-text-tertiary">
                Only the accepted and free quantities come into stock. Rejected goods stay pending on the purchase order and can go back on a purchase return or debit note.
              </p>
            </>
          )}
        </div>

        {/* Totals summary */}
        <div className="flex justify-end">
          <div className="w-80 space-y-2.5">
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Subtotal</span>
              <span data-testid="document-subtotal" className="tabular-nums font-medium text-text-primary">
                {formatCurrency(totals.subtotal)}
              </span>
            </div>
            {totals.lineDiscountTotal > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Line Discounts</span>
                <span className="tabular-nums text-emerald-600">
                  -{formatCurrency(totals.lineDiscountTotal)}
                </span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Tax</span>
              <span data-testid="document-tax" className="tabular-nums text-text-primary">
                {formatCurrency(totals.taxTotal)}
              </span>
            </div>

            {/* Invoice-level discount */}
            <div className="flex justify-between items-center text-sm">
              <div className="flex items-center gap-1.5">
                <span className="text-text-secondary">Discount</span>
                <div className="inline-flex rounded-md border border-border-light overflow-hidden">
                  <button
                    type="button"
                    aria-label="Discount in rupees"
                    aria-pressed={invoiceDiscountType === "amount"}
                    onClick={() => setInvoiceDiscountType("amount")}
                    className={`px-1.5 py-0.5 text-2xs font-medium transition-colors ${invoiceDiscountType === "amount" ? "bg-brand-600/[0.1] text-brand-700 dark:text-brand-400" : "text-text-tertiary hover:text-text-secondary"}`}
                  >
                    ₹
                  </button>
                  <button
                    type="button"
                    aria-label="Discount in percent"
                    aria-pressed={invoiceDiscountType === "percent"}
                    onClick={() => setInvoiceDiscountType("percent")}
                    className={`px-1.5 py-0.5 text-2xs font-medium transition-colors ${invoiceDiscountType === "percent" ? "bg-brand-600/[0.1] text-brand-700 dark:text-brand-400" : "text-text-tertiary hover:text-text-secondary"}`}
                  >
                    %
                  </button>
                </div>
              </div>
              <input
                type="number"
                className="input w-28 text-right tabular-nums text-sm py-1"
                aria-label="Document discount"
                value={invoiceDiscount}
                onChange={(e) => setInvoiceDiscount(e.target.value)}
                step="0.01"
                min="0"
                placeholder="0.00"
              />
            </div>
            {totals.invoiceDiscountAmount > 0 && invoiceDiscountType === "percent" && (
              <div className="flex justify-end">
                <span className="text-xs tabular-nums text-emerald-600">
                  -{formatCurrency(totals.invoiceDiscountAmount)}
                </span>
              </div>
            )}

            {/* Charges section */}
            <div className="pt-1">
              {charges.map((charge, idx) => (
                <div key={idx} className="flex justify-between items-center text-sm mb-1.5">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    {charge.shipmentId ? (
                      <span className="text-xs text-text-tertiary italic truncate">{charge.label} (synced)</span>
                    ) : (
                      <>
                        <input
                          value={charge.label}
                          onChange={(e) => {
                            const next = [...charges];
                            next[idx] = { ...next[idx], label: e.target.value };
                            setCharges(next);
                          }}
                          className="input py-1 text-xs w-28"
                          placeholder="Label"
                          aria-label={`Charge ${idx + 1} name`}
                        />
                        <button
                          type="button"
                          onClick={() => setCharges(charges.filter((_, i) => i !== idx))}
                          className="text-text-tertiary hover:text-red-500 transition-colors p-0.5"
                          aria-label="Remove charge"
                        >
                          <Icon icon={Cancel01Icon} size={12} />
                        </button>
                      </>
                    )}
                  </div>
                  <input
                    type="number"
                    value={charge.amount}
                    onChange={(e) => {
                      if (charge.shipmentId) return; // synced charges are read-only
                      const next = [...charges];
                      next[idx] = { ...next[idx], amount: e.target.value };
                      setCharges(next);
                    }}
                    readOnly={!!charge.shipmentId}
                    aria-label={`${charge.label || `Charge ${idx + 1}`} amount`}
                    className={`input w-28 text-right tabular-nums py-1 text-xs ${charge.shipmentId ? "opacity-60 cursor-not-allowed" : ""}`}
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                  />
                </div>
              ))}

              {/* Quick-add buttons */}
              <div className="flex items-center gap-1.5 mt-1">
                {!charges.some((c) => c.label.toLowerCase() === "shipping") && (
                  <button
                    type="button"
                    onClick={() => setCharges([...charges, { label: "Shipping", amount: "" }])}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-2xs font-medium text-text-tertiary hover:text-text-secondary hover:bg-surface-2 transition-colors border border-dashed border-border-light"
                  >
                    <Icon icon={DeliveryTruck01Icon} size={12} />
                    Shipping
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setCharges([...charges, { label: "", amount: "" }])}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-2xs font-medium text-text-tertiary hover:text-text-secondary hover:bg-surface-2 transition-colors"
                >
                  + Add charge
                </button>
              </div>
            </div>

            {totals.chargesTotal > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">
                  Charges ({charges.filter((c) => parseFloat(c.amount) > 0).length})
                </span>
                <span className="tabular-nums text-text-primary">
                  {formatCurrency(totals.chargesTotal)}
                </span>
              </div>
            )}

            <div className="flex justify-between items-center text-sm">
              <div className="flex items-center gap-1.5">
                <span className="text-text-secondary">Round Off</span>
                {bizDefaultRoundOff && !isEditing && !roundOffOverridden && (
                  <span
                    className="text-2xs font-medium uppercase tracking-wide px-1.5 py-0.5 rounded text-brand-700 dark:text-brand-400 bg-brand-600/[0.1]"
                    title="Auto-rounded down to nearest integer (per Settings → Documents). Edit to override."
                  >
                    Auto
                  </span>
                )}
              </div>
              <input
                type="number"
                className="input w-32 text-right tabular-nums"
                aria-label="Round off"
                value={roundOff}
                onChange={(e) => {
                  setRoundOff(e.target.value);
                  setRoundOffOverridden(true);
                }}
                step="0.01"
              />
            </div>
            <div className="pt-2 border-t border-border-light flex justify-between">
              <span className="text-sm font-semibold text-text-primary">
                Total
              </span>
              <span data-testid="document-total" className="text-lg font-bold tabular-nums text-text-primary">
                {formatCurrency(totals.total)}
              </span>
            </div>
          </div>
        </div>

        {/* Notes and terms */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor={`${dateInputId}-notes`}>Notes</label>
            <textarea
              id={`${dateInputId}-notes`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Additional notes for the customer…"
              className="input resize-none"
            />
          </div>
          <div>
            <label className="label" htmlFor={`${dateInputId}-terms`}>Terms &amp; conditions</label>
            <textarea
              id={`${dateInputId}-terms`}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              rows={4}
              placeholder="Payment terms, warranty, etc…"
              className="input resize-none"
            />
          </div>
        </div>
      </div>
    </SlideOver>

    <QuickPartyCreate
      open={quickPartyOpen}
      onClose={() => setQuickPartyOpen(false)}
      onCreated={handleQuickPartyCreated}
      initialName={quickPartyName}
      defaultType={invoiceType === "sale" ? "customer" : "supplier"}
    />

    <QuickItemCreate
      open={quickItemOpen}
      onClose={() => { setQuickItemOpen(false); setQuickItemLineId(null); }}
      onCreated={handleQuickItemCreated}
      initialName={quickItemName}
      invoiceType={invoiceType}
    />

    <ConfirmDialog
      open={confirmCloseOpen}
      title="Discard unsaved changes?"
      description="You have entered information on this document. Closing now will lose those changes."
      confirmLabel="Discard"
      variant="danger"
      onCancel={() => setConfirmCloseOpen(false)}
      onConfirm={() => {
        setConfirmCloseOpen(false);
        // Bypass the dirty guard for this close — the user has confirmed.
        baselineRef.current = formSnapshotRef.current;
        onClose();
      }}
    />
    </>
  );
}
