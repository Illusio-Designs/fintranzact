/**
 * DocumentCreator — Bug B (Stage 3) + Bug C (Stage 4)
 *
 * These tests cover:
 *
 * Bug B — itemName / description split:
 *   - `itemName` is populated from `product.name` when an item is picked,
 *     and frozen on the invoice line so later renames don't rewrite
 *     historical invoices.
 *   - `description` carries the user's free-text notes. Empty or
 *     whitespace-only notes become `undefined` so the backend keeps the
 *     column NULL instead of persisting "".
 *
 * Bug C — AltUnitSelector pill row:
 *   - Items with `itemMode === "alt_units"` and at least one unitVariant
 *     get a horizontal pill row below the product combobox.
 *   - Clicking a variant pill swaps `unitPrice` and stores `conversionFactor`.
 *   - Clicking the base-unit pill reverts to base price and clears CF.
 *   - Submission payload carries the stored `conversionFactor` directly
 *     (no longer derived dynamically from `availableUnits`).
 *
 * tRPC is mocked so the tests run without a real API server.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ─── tRPC mock surface ────────────────────────────────────────────────────

// vi.mock factories are hoisted to the top of the file, so we can't
// reference normal top-level vars inside them. vi.hoisted() is the
// official escape hatch — it runs BEFORE the hoisted factories so the
// references are available at mock-initialisation time.
const {
  invoiceCreateMutate,
  quotationCreateMutate,
  grnCreateMutate,
  purchaseReturnCreateMutate,
  invalidateStub,
  businessListQuery,
  pricingResolveFetch,
  invoiceGetByIdQuery,
  invoiceListQuery,
} =
  vi.hoisted(() => ({
    purchaseReturnCreateMutate: vi.fn(),
    // Returns data only for queries that are switched on; tests swap in a source invoice.
    invoiceGetByIdQuery: vi.fn((_input: { id: string }, _opts?: { enabled?: boolean }): { data: unknown } => ({ data: null })),
    invoiceListQuery: vi.fn((): { data: unknown; isFetching: boolean } => ({ data: { data: [] }, isFetching: false })),
    grnCreateMutate: vi.fn(),
    // Price level lookups; rejects by default so lines keep the item price.
    pricingResolveFetch: vi.fn((): Promise<unknown> => Promise.reject(new Error("no pricing"))),
    invoiceCreateMutate: vi.fn(),
    quotationCreateMutate: vi.fn(),
    invalidateStub: vi.fn(),
    businessListQuery: vi.fn(() => ({
      data: [
        {
          id: "biz-1",
          name: "Test Business",
          defaultRoundOff: false,
          defaultTermsAndConditions: null as string | null,
        },
      ],
      isFetching: false,
    })),
  }));

vi.mock("@/lib/trpc", () => ({
  getBusinessId: () => "biz-1",
  trpc: {
    business: {
      list: {
        useQuery: () => businessListQuery(),
      },
    },
    // One warehouse, so the form shows no warehouse picker.
    stock: {
      warehouses: {
        useQuery: () => ({ data: [{ id: "wh-1", name: "Main warehouse", status: "active", isDefault: true }] }),
      },
      settings: {
        useQuery: () => ({ data: { negativeStockPolicy: "warn", salesWarehouseId: "wh-1", purchaseWarehouseId: "wh-1", salesReturnWarehouseId: "wh-1", purchaseReturnWarehouseId: "wh-1", stockAdjustmentWarehouseId: "wh-1" } }),
      },
      availability: {
        useQuery: () => ({ data: undefined }),
      },
    },
    party: {
      list: {
        useQuery: () => ({
          data: {
            data: [
              {
                id: "party-1",
                name: "Ramesh Traders",
                type: "customer",
                creditPeriodDays: 7,
              },
            ],
          },
          isFetching: false,
        }),
        invalidate: invalidateStub,
      },
      create: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    item: {
      list: {
        useQuery: () => ({
          data: {
            data: [
              {
                id: "item-1",
                name: "Steel Rod",
                salePrice: "1000",
                purchasePrice: "800",
                taxPercent: "18",
                itemMode: "standard",
                unit: "kg",
                unitVariants: [],
              },
              {
                id: "item-2",
                name: "Cement Bag",
                salePrice: "350",
                purchasePrice: "300",
                taxPercent: "5",
                itemMode: "standard",
                unit: "bag",
                unitVariants: [],
              },
              {
                id: "item-3",
                name: "Rice Basmati",
                salePrice: "100",
                purchasePrice: "80",
                taxPercent: "5",
                itemMode: "alt_units",
                unit: "kg",
                unitVariants: [
                  { unit: "packet", conversionFactor: 0.2, salePrice: "20" },
                ],
              },
            ],
          },
          isFetching: false,
        }),
        invalidate: invalidateStub,
      },
      create: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    invoice: {
      create: {
        useMutation: () => ({ mutate: invoiceCreateMutate, isPending: false }),
      },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      getById: {
        useQuery: (input: { id: string }, opts?: { enabled?: boolean }) => invoiceGetByIdQuery(input, opts),
      },
      list: { useQuery: () => invoiceListQuery(), invalidate: invalidateStub },
      lastDeliveryMethod: { useQuery: () => ({ data: undefined }) },
    },
    quotation: {
      create: {
        useMutation: () => ({ mutate: quotationCreateMutate, isPending: false }),
      },
      list: { invalidate: invalidateStub },
    },
    creditNote: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      list: { invalidate: invalidateStub },
    },
    debitNote: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      list: { invalidate: invalidateStub },
    },
    deliveryChallan: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      list: { invalidate: invalidateStub },
    },
    proforma: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      list: { invalidate: invalidateStub },
    },
    salesReturn: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      list: { invalidate: invalidateStub },
    },
    purchaseReturn: {
      create: { useMutation: () => ({ mutate: purchaseReturnCreateMutate, isPending: false }) },
      list: { invalidate: invalidateStub },
    },
    purchaseOrder: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      list: { invalidate: invalidateStub },
    },
    salesOrder: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      list: { invalidate: invalidateStub },
    },
    goodsReceiptNote: {
      create: { useMutation: () => ({ mutate: grnCreateMutate, isPending: false }) },
      list: { invalidate: invalidateStub },
    },
    dashboard: {
      summary: { invalidate: invalidateStub },
      shippingSummary: { invalidate: invalidateStub },
    },
    useUtils: () => ({
      invoice: {
        list: { invalidate: invalidateStub },
        getById: { invalidate: invalidateStub },
      },
      quotation: { list: { invalidate: invalidateStub } },
      creditNote: { list: { invalidate: invalidateStub } },
      debitNote: { list: { invalidate: invalidateStub } },
      deliveryChallan: { list: { invalidate: invalidateStub } },
      proforma: { list: { invalidate: invalidateStub } },
      salesReturn: { list: { invalidate: invalidateStub } },
      purchaseReturn: { list: { invalidate: invalidateStub } },
      purchaseOrder: { list: { invalidate: invalidateStub } },
      salesOrder: { list: { invalidate: invalidateStub } },
      goodsReceiptNote: { list: { invalidate: invalidateStub } },
      orders: { invalidate: invalidateStub },
      dashboard: {
        summary: { invalidate: invalidateStub },
        shippingSummary: { invalidate: invalidateStub },
      },
      item: { list: { invalidate: invalidateStub } },
      pricing: { resolve: { fetch: pricingResolveFetch } },
    }),
  },
}));

vi.mock("@/hooks/useToast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after the mocks so the component picks up the stubbed trpc.
import { DocumentCreator } from "../DocumentCreator";
import { toast } from "@/hooks/useToast";

function renderCreator(props: Partial<React.ComponentProps<typeof DocumentCreator>> = {}) {
  return render(
    <DocumentCreator
      documentType="invoice"
      invoiceType="sale"
      onClose={vi.fn()}
      {...props}
    />
  );
}

function getFirstNotesTextarea() {
  return screen.getAllByPlaceholderText(
    "Notes for this line (optional)"
  )[0] as HTMLTextAreaElement;
}

/** Pick a party from the customer combobox. */
async function pickParty(user: ReturnType<typeof userEvent.setup>) {
  const partyCombobox = screen.getByRole("combobox", { name: /customer/i });
  await user.click(partyCombobox);
  await user.click(screen.getByText("Ramesh Traders"));
}

/** Pick "Steel Rod" (item-1) from the product combobox. */
async function pickSteelRod(user: ReturnType<typeof userEvent.setup>) {
  const combobox = screen.getByPlaceholderText("Select product or custom item");
  await user.click(combobox);
  const option = await screen.findByRole("option", { name: /steel rod/i });
  await user.click(option);
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("DocumentCreator — Bug B itemName / description split", () => {
  beforeEach(() => {
    invoiceCreateMutate.mockClear();
    quotationCreateMutate.mockClear();
    invalidateStub.mockClear();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
  });

  describe("form structure", () => {
    it("renders a notes textarea below each line item (no separate item-name input — name comes from picker)", () => {
      renderCreator();

      // No standalone "Item name *" input — name is set from the product picker.
      expect(screen.queryByPlaceholderText("Item name *")).not.toBeInTheDocument();

      // The notes textarea IS present for free-text line comments.
      const notes = screen.getAllByPlaceholderText("Notes for this line (optional)");
      expect(notes.length).toBeGreaterThan(0);
      expect(notes[0].tagName).toBe("TEXTAREA");
    });
  });

  describe("item pick — sets itemName automatically, notes start empty", () => {
    it("selecting a product from the combobox auto-fills itemName and leaves notes blank", async () => {
      renderCreator();
      const user = userEvent.setup();
      await pickSteelRod(user);

      // Notes should be blank after item pick.
      const notesInput = getFirstNotesTextarea();
      expect(notesInput.value).toBe("");
    });
  });

  describe("notes input behaviour", () => {
    it("typing into the notes textarea updates only notes, not the item name in the payload", async () => {
      renderCreator();
      const user = userEvent.setup();
      await pickParty(user);
      await pickSteelRod(user);

      const notesInput = getFirstNotesTextarea();
      fireEvent.change(notesInput, { target: { value: "Keep separate from order #42" } });
      expect(notesInput.value).toBe("Keep separate from order #42");

      // Submit and check the payload carries both fields independently.
      const submit = screen.getByRole("button", { name: /create invoice/i });
      await user.click(submit);

      await waitFor(() => expect(invoiceCreateMutate).toHaveBeenCalledTimes(1));
      const payload = invoiceCreateMutate.mock.calls[0][0];
      expect(payload.lineItems[0].itemName).toBe("Steel Rod");
      expect(payload.lineItems[0].description).toBe("Keep separate from order #42");
    });

    it("shows a 500-char counter once the notes exceed 400 characters (soft warning zone)", () => {
      renderCreator();
      const notesInput = getFirstNotesTextarea();

      fireEvent.change(notesInput, { target: { value: "a".repeat(100) } });
      expect(screen.queryByText(/\/ 500/)).not.toBeInTheDocument();

      fireEvent.change(notesInput, { target: { value: "a".repeat(450) } });
      expect(screen.getByText("450 / 500")).toBeInTheDocument();
    });

    it("the notes textarea enforces a 500-character maximum via maxLength", () => {
      renderCreator();
      const notesInput = getFirstNotesTextarea();
      expect(notesInput.maxLength).toBe(500);
    });
  });

  describe("submission payload — itemName from picker, description from notes", () => {
    async function primeInvoiceWithItem(notes?: string) {
      const user = userEvent.setup();
      await pickParty(user);
      await pickSteelRod(user);

      if (notes !== undefined) {
        const notesInput = getFirstNotesTextarea();
        fireEvent.change(notesInput, { target: { value: notes } });
      }
      return user;
    }

    it("sends itemName from the picked product and description from notes", async () => {
      renderCreator();
      const user = await primeInvoiceWithItem("Keep separate from order #42");

      const submit = screen.getByRole("button", { name: /create invoice/i });
      await user.click(submit);

      await waitFor(() => expect(invoiceCreateMutate).toHaveBeenCalledTimes(1));
      const payload = invoiceCreateMutate.mock.calls[0][0];
      expect(payload.lineItems).toHaveLength(1);
      expect(payload.lineItems[0].itemName).toBe("Steel Rod");
      expect(payload.lineItems[0].description).toBe("Keep separate from order #42");
    });

    it("omits description when notes are empty so the DB column stays NULL", async () => {
      renderCreator();
      const user = await primeInvoiceWithItem();

      const submit = screen.getByRole("button", { name: /create invoice/i });
      await user.click(submit);

      await waitFor(() => expect(invoiceCreateMutate).toHaveBeenCalledTimes(1));
      const payload = invoiceCreateMutate.mock.calls[0][0];
      expect(payload.lineItems[0].itemName).toBe("Steel Rod");
      expect(payload.lineItems[0].description).toBeUndefined();
    });

    it("omits description when notes are only whitespace", async () => {
      renderCreator();
      const user = await primeInvoiceWithItem("   \n\t  ");

      const submit = screen.getByRole("button", { name: /create invoice/i });
      await user.click(submit);

      await waitFor(() => expect(invoiceCreateMutate).toHaveBeenCalledTimes(1));
      expect(invoiceCreateMutate.mock.calls[0][0].lineItems[0].description).toBeUndefined();
    });
  });

  describe("create button disabled state", () => {
    it("create button is disabled when no party is selected", () => {
      renderCreator();
      const submit = screen.getByRole("button", { name: /create invoice/i });
      expect(submit).toBeDisabled();
    });

    it("create button is disabled when party is selected but no item picked", async () => {
      renderCreator();
      const user = userEvent.setup();
      await pickParty(user);

      const submit = screen.getByRole("button", { name: /create invoice/i });
      expect(submit).toBeDisabled();
    });

    it("create button becomes enabled when party + item are both selected", async () => {
      renderCreator();
      const user = userEvent.setup();
      await pickParty(user);
      await pickSteelRod(user);

      const submit = screen.getByRole("button", { name: /create invoice/i });
      expect(submit).not.toBeDisabled();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug C — AltUnitSelector pill row
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Selects "Rice Basmati" (item-3, an alt_units item) from the first line's
 * product combobox by clicking it open and choosing the option.
 *
 * The product Combobox has no label prop so we find it via placeholder text
 * (which maps to the underlying input's placeholder attribute).
 */
async function selectRiceBasmati() {
  const user = userEvent.setup();
  // The product Combobox uses placeholder="Select product or custom item".
  const combobox = screen.getByPlaceholderText("Select product or custom item");
  await user.click(combobox);
  // The Combobox renders matching options in a listbox; find the Rice option.
  const option = await screen.findByRole("option", { name: /rice basmati/i });
  await user.click(option);
  return user;
}

describe("DocumentCreator — Bug C AltUnitSelector pill row", () => {
  beforeEach(() => {
    invoiceCreateMutate.mockClear();
    invalidateStub.mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it("renders pill row for an item with alt units", async () => {
    renderCreator();
    await selectRiceBasmati();

    const radiogroup = await screen.findByRole("radiogroup", { name: /select unit/i });
    expect(radiogroup).toBeInTheDocument();
    const pills = screen.getAllByRole("radio");
    expect(pills.length).toBe(2); // KG (base) + PACKET (variant)
  });

  it("each pill shows unit name and price", async () => {
    renderCreator();
    await selectRiceBasmati();

    // Base unit pill
    const kgPill = await screen.findByRole("radio", { name: /KG/i });
    expect(kgPill).toBeInTheDocument();
    expect(kgPill.textContent).toMatch(/KG/i);
    expect(kgPill.textContent).toMatch(/100/);

    // Variant pill
    const packetPill = screen.getByRole("radio", { name: /PACKET/i });
    expect(packetPill.textContent).toMatch(/PACKET/i);
    expect(packetPill.textContent).toMatch(/20/);
  });

  it("base unit pill is selected by default (aria-checked=true)", async () => {
    renderCreator();
    await selectRiceBasmati();

    const kgPill = await screen.findByRole("radio", { name: /KG/i });
    expect(kgPill).toHaveAttribute("aria-checked", "true");

    const packetPill = screen.getByRole("radio", { name: /PACKET/i });
    expect(packetPill).toHaveAttribute("aria-checked", "false");
  });

  it("clicking a variant pill swaps the unit price input to the variant price", async () => {
    renderCreator();
    const user = await selectRiceBasmati();

    // Initially price should be ₹100 (base)
    const priceInput = screen.getAllByLabelText("Unit price")[0] as HTMLInputElement;
    expect(priceInput.value).toBe("100");

    // Click the PACKET pill
    const packetPill = await screen.findByRole("radio", { name: /PACKET/i });
    await user.click(packetPill);

    expect(priceInput.value).toBe("20");
  });

  it("clicking a variant pill marks it as selected (aria-checked=true) and deselects base", async () => {
    renderCreator();
    const user = await selectRiceBasmati();

    const packetPill = await screen.findByRole("radio", { name: /PACKET/i });
    await user.click(packetPill);

    expect(packetPill).toHaveAttribute("aria-checked", "true");
    const kgPill = screen.getByRole("radio", { name: /KG/i });
    expect(kgPill).toHaveAttribute("aria-checked", "false");
  });

  it("clicking base-unit pill after a variant reverts price to base price", async () => {
    renderCreator();
    const user = await selectRiceBasmati();

    // Select variant first
    const packetPill = await screen.findByRole("radio", { name: /PACKET/i });
    await user.click(packetPill);

    const priceInput = screen.getAllByLabelText("Unit price")[0] as HTMLInputElement;
    expect(priceInput.value).toBe("20");

    // Revert to base
    const kgPill = screen.getByRole("radio", { name: /KG/i });
    await user.click(kgPill);

    expect(priceInput.value).toBe("100");
  });

  it("submission payload carries conversionFactor from stored state (not derived)", async () => {
    renderCreator();
    const user = await selectRiceBasmati();

    // Pick the party
    const partyCombobox = screen.getByRole("combobox", { name: /customer/i });
    await user.click(partyCombobox);
    await user.click(screen.getByText("Ramesh Traders"));

    // Select PACKET variant
    const packetPill = await screen.findByRole("radio", { name: /PACKET/i });
    await user.click(packetPill);

    const submit = screen.getByRole("button", { name: /create invoice/i });
    await user.click(submit);

    await waitFor(() => {
      expect(invoiceCreateMutate).toHaveBeenCalledTimes(1);
    });

    const payload = invoiceCreateMutate.mock.calls[0][0];
    expect(payload.lineItems[0].selectedUnit).toBe("packet");
    expect(payload.lineItems[0].conversionFactor).toBe("0.2");
  });

  it("submission payload has no conversionFactor when base unit is selected", async () => {
    renderCreator();
    const user = await selectRiceBasmati();

    // Pick the party
    const partyCombobox = screen.getByRole("combobox", { name: /customer/i });
    await user.click(partyCombobox);
    await user.click(screen.getByText("Ramesh Traders"));

    // Leave on base unit (default after item pick)
    const submit = screen.getByRole("button", { name: /create invoice/i });
    await user.click(submit);

    await waitFor(() => {
      expect(invoiceCreateMutate).toHaveBeenCalledTimes(1);
    });

    const payload = invoiceCreateMutate.mock.calls[0][0];
    expect(payload.lineItems[0].conversionFactor).toBeUndefined();
    expect(payload.lineItems[0].selectedUnit).toBeUndefined();
  });

  it("no pill row rendered for a single-unit item (Steel Rod)", async () => {
    renderCreator();
    const user = userEvent.setup();

    // Select Steel Rod (standard, no unitVariants)
    const combobox = screen.getByPlaceholderText("Select product or custom item");
    await user.click(combobox);
    const option = await screen.findByRole("option", { name: /steel rod/i });
    await user.click(option);

    // No radiogroup should appear
    expect(screen.queryByRole("radiogroup", { name: /select unit/i })).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Confirm-close on dirty form
// ─────────────────────────────────────────────────────────────────────────────

describe("DocumentCreator — confirm-close on dirty form", () => {
  beforeEach(() => {
    invoiceCreateMutate.mockClear();
    invalidateStub.mockClear();
    vi.mocked(toast.error).mockClear();
    businessListQuery.mockReturnValue({
      data: [
        {
          id: "biz-1",
          name: "Test Business",
          defaultRoundOff: false,
          defaultTermsAndConditions: null,
        },
      ],
      isFetching: false,
    });
  });

  it("pristine close fires onClose directly without showing confirm dialog", async () => {
    const onClose = vi.fn();
    renderCreator({ onClose });

    // Wait for the baseline microtask to settle
    await waitFor(() => {});

    // Click the Cancel footer button on a pristine (untouched) form
    const cancelBtn = screen.getByRole("button", { name: /^cancel$/i });
    fireEvent.click(cancelBtn);

    // onClose fires immediately — no confirm dialog
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Discard unsaved changes?")).not.toBeInTheDocument();
  });

  it("typing in a line's notes marks the form dirty and shows confirm dialog on Cancel", async () => {
    const onClose = vi.fn();
    renderCreator({ onClose });

    // Wait for the baseline microtask to settle
    await waitFor(() => {});

    // Type into the first line notes textarea to mark dirty
    const notesInput = getFirstNotesTextarea();
    fireEvent.change(notesInput, { target: { value: "abc" } });

    // Click Cancel
    const cancelBtn = screen.getByRole("button", { name: /^cancel$/i });
    fireEvent.click(cancelBtn);

    // Confirm dialog should appear, onClose should NOT have been called yet
    expect(await screen.findByText("Discard unsaved changes?")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("clicking Discard on the confirm dialog fires onClose and removes the dialog", async () => {
    const onClose = vi.fn();
    renderCreator({ onClose });

    // Wait for the baseline microtask to settle
    await waitFor(() => {});

    // Make form dirty
    const notesInput = getFirstNotesTextarea();
    fireEvent.change(notesInput, { target: { value: "abc" } });

    // Click Cancel to open confirm dialog
    const cancelBtn = screen.getByRole("button", { name: /^cancel$/i });
    fireEvent.click(cancelBtn);

    // Wait for the confirm dialog
    await screen.findByText("Discard unsaved changes?");

    // Click the "Discard" button inside the dialog
    const discardBtn = screen.getByRole("button", { name: /^discard$/i });
    fireEvent.click(discardBtn);

    // onClose must fire and the dialog must disappear
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Discard unsaved changes?")).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auto round-off from business default
// ─────────────────────────────────────────────────────────────────────────────

/** Locate the Round Off number input.
 * JSX structure:
 *   outer div.flex.justify-between
 *     inner div.flex.items-center (span "Round Off" + optional Auto badge)
 *     input[type="number"]
 * We go: span → parent inner div → parent outer div → querySelector input
 */
function getRoundOffInput(): HTMLInputElement {
  const span = screen.getByText("Round Off");
  // span.parentElement = inner "flex items-center gap-1.5" div
  // span.parentElement.parentElement = outer "flex justify-between" div
  const outerDiv = span.parentElement?.parentElement;
  const input = outerDiv?.querySelector('input[type="number"]') as HTMLInputElement | null;
  if (!input) throw new Error("Could not locate Round Off input");
  return input;
}

describe("DocumentCreator — auto round-off from business default", () => {
  beforeEach(() => {
    invoiceCreateMutate.mockClear();
    invalidateStub.mockClear();
    vi.mocked(toast.error).mockClear();
    // Enable defaultRoundOff for all tests in this block
    businessListQuery.mockReturnValue({
      data: [
        {
          id: "biz-1",
          name: "Test Business",
          defaultRoundOff: true,
          defaultTermsAndConditions: null,
        },
      ],
      isFetching: false,
    });
  });

  afterEach(() => {
    // Restore default
    businessListQuery.mockReturnValue({
      data: [
        {
          id: "biz-1",
          name: "Test Business",
          defaultRoundOff: false,
          defaultTermsAndConditions: null,
        },
      ],
      isFetching: false,
    });
  });

  it("auto-fills round-off so the grand total floors to a whole rupee", async () => {
    renderCreator();
    const user = userEvent.setup();
    await pickSteelRod(user);

    // Change unit price to 100.25 → with 18% tax, pre-round total ≈ 118.295
    // round-off should auto-fill to a non-zero value to floor the total
    const priceInput = screen.getAllByLabelText("Unit price")[0] as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: "100.25" } });

    // Wait for the auto-fill effect to run
    await waitFor(() => {
      const roInput = getRoundOffInput();
      expect(roInput.value).not.toBe("0");
    });

    const roundOffInput = getRoundOffInput();
    // round-off value must be non-zero (auto-filled to floor the total)
    expect(roundOffInput.value).not.toBe("0");
  });

  it("'Auto' badge appears next to Round Off label when bizDefaultRoundOff is on and user hasn't overridden", async () => {
    renderCreator();

    // The Auto badge should appear once the component renders with defaultRoundOff: true
    await waitFor(() => {
      expect(screen.getByText("Auto")).toBeInTheDocument();
    });

    // Both "Round Off" text and "Auto" badge should be visible
    expect(screen.getByText("Round Off")).toBeInTheDocument();
    expect(screen.getByText("Auto")).toBeInTheDocument();
  });

  it("editing the Round Off input manually stops auto-fill and hides the Auto badge", async () => {
    renderCreator();

    // Confirm Auto badge is present initially
    await waitFor(() => {
      expect(screen.getByText("Auto")).toBeInTheDocument();
    });

    // Manually edit the round-off input
    const roundOffInput = getRoundOffInput();
    fireEvent.change(roundOffInput, { target: { value: "5" } });

    // Auto badge should disappear
    await waitFor(() => {
      expect(screen.queryByText("Auto")).not.toBeInTheDocument();
    });

    // Further changes to price should NOT re-populate round-off
    const priceInput = screen.getAllByLabelText("Unit price")[0] as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: "200" } });

    // Round-off stays at what the user set ("5"), auto-fill doesn't override
    await waitFor(() => {
      expect(getRoundOffInput().value).toBe("5");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T&C pre-fill from business default
// ─────────────────────────────────────────────────────────────────────────────

describe("DocumentCreator — T&C pre-fill from business default", () => {
  const DEFAULT_TERMS = "Payment due within 15 days";

  beforeEach(() => {
    invoiceCreateMutate.mockClear();
    invalidateStub.mockClear();
    vi.mocked(toast.error).mockClear();
    // Enable defaultTermsAndConditions for all tests in this block
    businessListQuery.mockReturnValue({
      data: [
        {
          id: "biz-1",
          name: "Test Business",
          defaultRoundOff: false,
          defaultTermsAndConditions: DEFAULT_TERMS as string | null,
        },
      ],
      isFetching: false,
    });
  });

  afterEach(() => {
    // Restore default
    businessListQuery.mockReturnValue({
      data: [
        {
          id: "biz-1",
          name: "Test Business",
          defaultRoundOff: false,
          defaultTermsAndConditions: null,
        },
      ],
      isFetching: false,
    });
  });

  it("terms textarea pre-fills from bizDefaultTerms on a new doc", async () => {
    renderCreator();

    const termsTextarea = screen.getByPlaceholderText("Payment terms, warranty, etc…") as HTMLTextAreaElement;

    await waitFor(() => {
      expect(termsTextarea.value).toBe(DEFAULT_TERMS);
    });
  });

  it("terms textarea does NOT re-populate if user has already typed something", async () => {
    renderCreator();

    const termsTextarea = screen.getByPlaceholderText("Payment terms, warranty, etc…") as HTMLTextAreaElement;

    // Immediately type into terms before the effect fires
    fireEvent.change(termsTextarea, { target: { value: "hand-written terms" } });

    // Wait a tick for any effects
    await waitFor(() => {});

    // The user's input should be preserved, not overwritten by the default
    expect(termsTextarea.value).toBe("hand-written terms");
  });

  it("terms does NOT pre-fill when prefillFromInvoiceId is passed (prefill mode)", async () => {
    // prefillFromInvoiceId puts the form in prefill mode (prefillId is set),
    // which causes the termsHydratedRef guard to skip hydration.
    renderCreator({ prefillFromInvoiceId: "some-invoice-id" });

    const termsTextarea = screen.getByPlaceholderText("Payment terms, warranty, etc…") as HTMLTextAreaElement;

    // Wait for any async effects
    await waitFor(() => {});

    // Terms should remain empty — editData returns null (mocked), so setTerms
    // stays at "" and the hydration effect is blocked by prefillId guard.
    expect(termsTextarea.value).toBe("");
  });
});

describe("DocumentCreator — price levels", () => {
  const resolved = (unitPrice: string, extra: Record<string, unknown> = {}) => ({
    priceLevel: { id: "lvl-1", name: "Wholesale" },
    lines: [{ itemId: "item-1", variantId: null, unit: null, unitPrice, discountPercent: null, netPrice: unitPrice, source: "level", minQuantity: "0", mrp: null, ...extra }],
  });

  beforeEach(() => {
    pricingResolveFetch.mockReset();
  });
  afterEach(() => {
    pricingResolveFetch.mockReset();
    pricingResolveFetch.mockImplementation(() => Promise.reject(new Error("no pricing")));
  });

  it("fills the price from the party's price level when an item is picked", async () => {
    pricingResolveFetch.mockResolvedValue(resolved("900.00"));
    renderCreator();
    const user = userEvent.setup();
    await pickParty(user);
    await pickSteelRod(user);

    const priceInput = screen.getAllByLabelText("Unit price")[0] as HTMLInputElement;
    await waitFor(() => expect(priceInput.value).toBe("900"));
    expect(screen.getByText("Wholesale")).toBeInTheDocument();
    expect(pricingResolveFetch).toHaveBeenCalledWith(
      expect.objectContaining({ partyId: "party-1", lines: [expect.objectContaining({ itemId: "item-1", quantity: "1" })] }),
    );
  });

  it("keeps a price the user typed when the quantity changes", async () => {
    pricingResolveFetch.mockResolvedValue(resolved("900.00"));
    renderCreator();
    const user = userEvent.setup();
    await pickSteelRod(user);
    const priceInput = screen.getAllByLabelText("Unit price")[0] as HTMLInputElement;
    await waitFor(() => expect(priceInput.value).toBe("900"));

    fireEvent.change(priceInput, { target: { value: "950" } });
    pricingResolveFetch.mockResolvedValue(resolved("850.00"));
    const qty = screen.getAllByLabelText("Quantity")[0] as HTMLInputElement;
    fireEvent.change(qty, { target: { value: "20" } });

    await waitFor(() => expect(pricingResolveFetch).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(priceInput.value).toBe("950");
  });

  it("re-prices a level price when the quantity reaches a slab", async () => {
    pricingResolveFetch.mockResolvedValue(resolved("900.00"));
    renderCreator();
    const user = userEvent.setup();
    await pickSteelRod(user);
    const priceInput = screen.getAllByLabelText("Unit price")[0] as HTMLInputElement;
    await waitFor(() => expect(priceInput.value).toBe("900"));

    pricingResolveFetch.mockResolvedValue(resolved("850.00"));
    const qty = screen.getAllByLabelText("Quantity")[0] as HTMLInputElement;
    fireEvent.change(qty, { target: { value: "20" } });
    await waitFor(() => expect(priceInput.value).toBe("850"));
  });

  it("warns when the price is above the MRP", async () => {
    pricingResolveFetch.mockResolvedValue(resolved("1000.00", { source: "item", mrp: "950.00" }));
    renderCreator();
    const user = userEvent.setup();
    await pickSteelRod(user);
    expect(await screen.findByText(/above the MRP 950.00/)).toBeInTheDocument();
  });

  it("leaves purchase documents alone", async () => {
    pricingResolveFetch.mockResolvedValue(resolved("1.00"));
    renderCreator({ invoiceType: "purchase" });
    const user = userEvent.setup();
    const combobox = screen.getByPlaceholderText("Select product or custom item");
    await user.click(combobox);
    await user.click(await screen.findByRole("option", { name: /steel rod/i }));
    await new Promise((r) => setTimeout(r, 350));
    expect(pricingResolveFetch).not.toHaveBeenCalled();
  });
});

describe("DocumentCreator — free quantities and rejections", () => {
  beforeEach(() => {
    invoiceCreateMutate.mockClear();
    grnCreateMutate.mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it("sends a free quantity without changing the line amount", async () => {
    renderCreator();
    const user = userEvent.setup();
    await pickParty(user);
    await pickSteelRod(user);

    const amountBefore = screen.getAllByText(/1,180/).length;
    fireEvent.change(screen.getByLabelText("Free quantity"), { target: { value: "1" } });
    // 1 × 1000 + 18% tax is still the amount: free goods aren't charged.
    expect(screen.getAllByText(/1,180/).length).toBe(amountBefore);

    await user.click(screen.getByRole("button", { name: /create invoice/i }));
    await waitFor(() => expect(invoiceCreateMutate).toHaveBeenCalledTimes(1));
    const li = invoiceCreateMutate.mock.calls[0][0].lineItems[0];
    expect(li.quantity).toBe("1");
    expect(li.freeQuantity).toBe("1");
    expect(li.rejectedQuantity).toBeUndefined();
  });

  it("leaves freeQuantity out when none is given", async () => {
    renderCreator();
    const user = userEvent.setup();
    await pickParty(user);
    await pickSteelRod(user);
    await user.click(screen.getByRole("button", { name: /create invoice/i }));
    await waitFor(() => expect(invoiceCreateMutate).toHaveBeenCalledTimes(1));
    expect(invoiceCreateMutate.mock.calls[0][0].lineItems[0].freeQuantity).toBeUndefined();
  });

  it("credit notes have no free quantity, and only a GRN has rejections", () => {
    const { unmount } = renderCreator({ documentType: "credit_note" });
    expect(screen.queryByLabelText("Free quantity")).not.toBeInTheDocument();
    unmount();
    renderCreator();
    expect(screen.queryByLabelText("Rejected quantity")).not.toBeInTheDocument();
  });

  it("a GRN records accepted and rejected quantities and needs a reason", async () => {
    renderCreator({ documentType: "goods_receipt_note", invoiceType: "purchase" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: /supplier/i }));
    await user.click(screen.getByText("Ramesh Traders"));
    await pickSteelRod(user);

    expect(screen.getByLabelText("Accepted quantity")).toBeInTheDocument();
    const reason = screen.getByLabelText("Reason for rejecting") as HTMLInputElement;
    expect(reason).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Accepted quantity"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Rejected quantity"), { target: { value: "2" } });
    expect(reason).not.toBeDisabled();

    await user.click(screen.getByRole("button", { name: /create goods receipt note/i }));
    expect(grnCreateMutate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Give a reason for rejecting Steel Rod");

    fireEvent.change(reason, { target: { value: "Damaged" } });
    await user.click(screen.getByRole("button", { name: /create goods receipt note/i }));
    await waitFor(() => expect(grnCreateMutate).toHaveBeenCalledTimes(1));
    const li = grnCreateMutate.mock.calls[0][0].lineItems[0];
    expect(li).toMatchObject({ quantity: "8", rejectedQuantity: "2", rejectionReason: "Damaged" });
  });

  it("a GRN line can be wholly rejected", async () => {
    renderCreator({ documentType: "goods_receipt_note", invoiceType: "purchase" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: /supplier/i }));
    await user.click(screen.getByText("Ramesh Traders"));
    await pickSteelRod(user);
    fireEvent.change(screen.getByLabelText("Accepted quantity"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Rejected quantity"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Reason for rejecting"), { target: { value: "Wrong item" } });
    await user.click(screen.getByRole("button", { name: /create goods receipt note/i }));
    await waitFor(() => expect(grnCreateMutate).toHaveBeenCalledTimes(1));
    expect(grnCreateMutate.mock.calls[0][0].lineItems[0]).toMatchObject({ quantity: "0", rejectedQuantity: "5" });
  });
});

// ─── Delivery methods (Settings → Shipping) ───────────────────────────────

describe("DocumentCreator — delivery method", () => {
  beforeEach(() => {
    invoiceCreateMutate.mockClear();
    quotationCreateMutate.mockClear();
    businessListQuery.mockReturnValue({
      data: [
        {
          id: "biz-1",
          name: "Test Business",
          defaultRoundOff: false,
          defaultTermsAndConditions: null,
          customShippingMethods: [{ id: "porter", label: "Porter", hasTracking: false }],
        } as never,
      ],
      isFetching: false,
    });
  });

  afterEach(() => {
    businessListQuery.mockReset();
    businessListQuery.mockReturnValue({
      data: [{ id: "biz-1", name: "Test Business", defaultRoundOff: false, defaultTermsAndConditions: null }],
      isFetching: false,
    });
  });

  it("offers the business's custom methods alongside the built-ins", async () => {
    renderCreator();
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Delivery method" }));
    for (const name of ["Self Pickup", "Self / Driver", "Bus / Parcel Service", "Transport", "Courier", "India Post", "Porter"]) {
      expect(screen.getByRole("option", { name })).toBeInTheDocument();
    }
  });

  it("sends the picked custom method on the invoice", async () => {
    renderCreator();
    const user = userEvent.setup();
    await pickParty(user);
    await pickSteelRod(user);
    await user.click(screen.getByRole("combobox", { name: "Delivery method" }));
    await user.click(screen.getByRole("option", { name: "Porter" }));

    await user.click(screen.getByRole("button", { name: /create invoice/i }));
    await waitFor(() => expect(invoiceCreateMutate).toHaveBeenCalledTimes(1));
    expect(invoiceCreateMutate.mock.calls[0][0].deliveryMethod).toBe("porter");
  });

  it("defaults to self pickup and is also on other sale documents", async () => {
    renderCreator({ documentType: "quotation" });
    const user = userEvent.setup();
    await pickParty(user);
    await pickSteelRod(user);
    await user.click(screen.getByRole("button", { name: /create quotation/i }));
    await waitFor(() => expect(quotationCreateMutate).toHaveBeenCalledTimes(1));
    expect(quotationCreateMutate.mock.calls[0][0].deliveryMethod).toBe("self_pickup");
  });

  it("is not asked on purchase invoices", () => {
    renderCreator({ invoiceType: "purchase" });
    expect(screen.queryByRole("combobox", { name: "Delivery method" })).not.toBeInTheDocument();
  });
});

// ─── Purchase return against a purchase invoice ───────────────────────────

describe("DocumentCreator — purchase return from a purchase invoice", () => {
  const sourceInvoice = {
    id: "11111111-1111-4111-8111-111111111111",
    invoiceNumber: "PINV-00007",
    invoiceDate: "2026-09-01T00:00:00.000Z",
    totalAmount: "2000.00",
    partyId: "party-1",
    party: { name: "Ramesh Traders" },
    notes: null,
    termsAndConditions: null,
    roundOff: "0",
    discountAmount: "0",
    charges: null,
    deliveryMethod: "self_pickup",
    lineItems: [
      { id: "li-1", itemId: "item-1", itemName: "Steel Rod", description: null, quantity: "5", unitPrice: "300", taxPercent: "18", discountPercent: "0", selectedUnit: null, conversionFactor: "1" },
      { id: "li-2", itemId: "item-2", itemName: "Cement Bag", description: null, quantity: "2", unitPrice: "250", taxPercent: "5", discountPercent: "0", selectedUnit: null, conversionFactor: "1" },
    ],
  };

  beforeEach(() => {
    purchaseReturnCreateMutate.mockClear();
    vi.mocked(toast.error).mockClear();
    invoiceListQuery.mockReturnValue({
      data: { data: [{ id: sourceInvoice.id, invoiceNumber: "PINV-00007", invoiceDate: sourceInvoice.invoiceDate, totalAmount: "2000.00", partyName: "Ramesh Traders" }] },
      isFetching: false,
    });
    invoiceGetByIdQuery.mockImplementation((input, opts) => ({
      data: opts?.enabled && input.id === sourceInvoice.id ? sourceInvoice : null,
    }));
  });

  afterEach(() => {
    invoiceListQuery.mockReset();
    invoiceListQuery.mockReturnValue({ data: { data: [] }, isFetching: false });
    invoiceGetByIdQuery.mockReset();
    invoiceGetByIdQuery.mockReturnValue({ data: null });
  });

  async function pickSource(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("combobox", { name: /against purchase invoice/i }));
    await user.click(await screen.findByRole("option", { name: /PINV-00007/ }));
  }

  it("copies the invoice's lines, then sends only what is returned, linked to the invoice", async () => {
    renderCreator({ documentType: "purchase_return", invoiceType: "purchase" });
    const user = userEvent.setup();
    await pickSource(user);

    await waitFor(() => expect(screen.getAllByLabelText("Quantity")).toHaveLength(2));
    expect(screen.getByText("of 5 invoiced")).toBeInTheDocument();

    // Return 2 of the 5 rods and none of the cement.
    fireEvent.change(screen.getAllByLabelText("Quantity")[0], { target: { value: "2" } });
    await user.click(screen.getAllByRole("button", { name: "Remove line" })[1]);

    await user.click(screen.getByRole("button", { name: /create purchase return/i }));
    await waitFor(() => expect(purchaseReturnCreateMutate).toHaveBeenCalledTimes(1));
    const payload = purchaseReturnCreateMutate.mock.calls[0][0];
    expect(payload).toMatchObject({ type: "purchase", partyId: "party-1", referenceDocumentId: sourceInvoice.id });
    expect(payload.lineItems).toEqual([expect.objectContaining({ itemId: "item-1", quantity: "2" })]);
  });

  it("won't send back more than the invoice had", async () => {
    renderCreator({ documentType: "purchase_return", invoiceType: "purchase" });
    const user = userEvent.setup();
    await pickSource(user);
    await waitFor(() => expect(screen.getAllByLabelText("Quantity")).toHaveLength(2));

    fireEvent.change(screen.getAllByLabelText("Quantity")[0], { target: { value: "6" } });
    await user.click(screen.getByRole("button", { name: /create purchase return/i }));

    expect(purchaseReturnCreateMutate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Only 5 of Steel Rod was on the invoice");
  });

  it("doesn't offer drafts, cancelled or fully adjusted invoices", async () => {
    const row = (id: string, invoiceNumber: string, status: string) => ({ id, invoiceNumber, status, invoiceDate: sourceInvoice.invoiceDate, totalAmount: "100.00", partyName: "Ramesh Traders" });
    invoiceListQuery.mockReturnValue({
      data: {
        data: [
          row(sourceInvoice.id, "PINV-00007", "sent"),
          row("22222222-2222-4222-8222-222222222222", "PINV-00008", "paid"),
          row("33333333-3333-4333-8333-333333333333", "PINV-00009", "adjusted"),
          row("44444444-4444-4444-8444-444444444444", "PINV-00010", "draft"),
          row("55555555-5555-4555-8555-555555555555", "PINV-00011", "cancelled"),
        ],
      },
      isFetching: false,
    });
    renderCreator({ documentType: "purchase_return", invoiceType: "purchase" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: /against purchase invoice/i }));
    expect(await screen.findByRole("option", { name: /PINV-00007/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /PINV-00008/ })).toBeInTheDocument();
    for (const n of ["PINV-00009", "PINV-00010", "PINV-00011"]) {
      expect(screen.queryByRole("option", { name: new RegExp(n) })).not.toBeInTheDocument();
    }
  });

  it("has no invoice picker when opened from the invoice itself", () => {
    renderCreator({ documentType: "purchase_return", invoiceType: "purchase", prefillFromInvoiceId: sourceInvoice.id });
    expect(screen.queryByRole("combobox", { name: /against purchase invoice/i })).not.toBeInTheDocument();
  });
});
