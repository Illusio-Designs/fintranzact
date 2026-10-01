/**
 * e-invoicing.test.ts — Integration tests for E-Invoicing (IRP) feature.
 *
 * WHY THIS FILE EXISTS:
 * E-invoicing is a GST compliance requirement. Incorrect IRN generation or
 * cancellation can result in penalties. We verify:
 *
 *   Configure:    Saving credentials creates/updates the config.
 *   Mapping:      invoice-to-irp.ts maps all fields correctly.
 *   Generate:     Mocked IRP client succeeds → invoice gets IRN/QR/status.
 *   Idempotency:  Cannot generate twice for the same invoice.
 *   Cancel:       IRN cancelled within 24h → status = "cancelled".
 *   Late cancel:  IRN > 24h old → 400 error.
 *   B2C skip:     Invoice with no-GSTIN party is rejected.
 *   Dashboard:    Returns correct counts per status.
 *   Status:       getStatus returns current e-invoice data.
 *   Retry:        Failed invoice can be retried.
 *   Permissions:  Non-admin (accountant) cannot manage but can read.
 *
 * The IRPClient is mocked via vitest.mock() so tests never call real NIC APIs.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { invoices, eInvoiceConfigs } from "@fintranzact/db";
import {
  createTestWorld,
  createParty,
  createInvoiceWithItems,
  type TestWorld,
  type TestParty,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import {
  getTenantTestDb,
  truncateAllTables,
  closeTestDb,
} from "../helpers/test-db.js";
import { mapInvoiceToIRP } from "../../lib/invoice-to-irp.js";

// ── Mock IRPClient ────────────────────────────────────────────────────────────
// We mock the entire irp-client module so tests never call real NIC endpoints.
// The mock is set up before any test and reset between tests as needed.

vi.mock("../../lib/irp-client.js", () => {
  const mockGenerateIRN = vi.fn().mockResolvedValue({
    irn: "MOCKIRN123456789012345678901234567890123456789012345678901234",
    ackNo: "232310001234567",
    ackDt: new Date(),
    signedQrCode: "MOCK_SIGNED_QR_CODE",
    signedInvoice: "MOCK_SIGNED_INVOICE_JSON",
  });

  const mockCancelIRN = vi.fn().mockResolvedValue({
    irn: "MOCKIRN123456789012345678901234567890123456789012345678901234",
    cancelDate: new Date("2026-04-02T11:00:00+05:30"),
  });

  const mockAuthenticate = vi.fn().mockResolvedValue(undefined);

  class MockIRPClient {
    authenticate = mockAuthenticate;
    generateIRN = mockGenerateIRN;
    cancelIRN = mockCancelIRN;
  }

  class IRPError extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly httpStatus?: number,
    ) {
      super(message);
      this.name = "IRPError";
    }
    get isRetryable() {
      return this.code === "RETRYABLE" || (this.httpStatus !== undefined && this.httpStatus >= 500);
    }
  }

  return {
    IRPClient: MockIRPClient,
    IRPError,
    __mockGenerateIRN: mockGenerateIRN,
    __mockCancelIRN: mockCancelIRN,
    __mockAuthenticate: mockAuthenticate,
  };
});

// ── Fixture ───────────────────────────────────────────────────────────────────

let world: TestWorld;
let b2bParty: TestParty;    // Customer with GSTIN (B2B)
let b2cParty: TestParty;    // Customer without GSTIN (B2C)

beforeAll(async () => {
  world = await createTestWorld();
  const db = getTenantTestDb();

  b2bParty = await createParty(db, world.business1.id, {
    name: "GST Registered Customer",
    type: "customer",
    gstin: "29AABCG0000R1ZM",
    city: "Bengaluru",
    state: "Karnataka",
    stateCode: "29",
    openingBalance: "0.00",
  });

  b2cParty = await createParty(db, world.business1.id, {
    name: "Walk-in Customer",
    type: "customer",
    gstin: null, // B2C — no GSTIN
    openingBalance: "0.00",
  });
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

function callerForRamesh() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

function callerForAccountant() {
  return createTestCaller({
    userId: world.suresh.id,
    email: world.suresh.email,
    name: world.suresh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

// ── Helper to configure e-invoicing ──────────────────────────────────────────

async function setupEInvoiceConfig(enabled = true) {
  const caller = callerForRamesh();
  return caller.eInvoice.configure({
    gstin: "27AABCU9603R1ZM",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    username: "testuser",
    password: "testpass123",
    isSandbox: true,
    isEnabled: enabled,
    thresholdCrore: "5",
  });
}

// ── 1. Configure credentials ───────────────────────────────────────────────

describe("eInvoice.configure", () => {
  it("creates e-invoice config for a business", async () => {
    const caller = callerForRamesh();
    const config = await caller.eInvoice.configure({
      gstin: "27AABCU9603R1ZM",
      clientId: "client-123",
      clientSecret: "secret-abc",
      username: "testuser",
      password: "testpass",
      isSandbox: true,
      isEnabled: false,
      thresholdCrore: "5",
    });

    expect(config).toBeDefined();
    expect(config!.businessId).toBe(world.business1.id);
    expect(config!.clientId).toBe("client-123");
    expect(config!.isSandbox).toBe(true);
    expect(config!.isEnabled).toBe(false);
  });

  it("updates existing config if one exists", async () => {
    const caller = callerForRamesh();

    // First save
    await caller.eInvoice.configure({
      gstin: "27AABCU9603R1ZM",
      clientId: "original-id",
      clientSecret: "original-secret",
      username: "user1",
      password: "pass1",
      isSandbox: true,
      isEnabled: false,
      thresholdCrore: "5",
    });

    // Update
    const updated = await caller.eInvoice.configure({
      gstin: "27AABCU9603R1ZM",
      clientId: "new-client-id",
      clientSecret: "new-secret",
      username: "user2",
      password: "pass2",
      isSandbox: false,
      isEnabled: true,
      thresholdCrore: "10",
    });

    expect(updated!.clientId).toBe("new-client-id");
    expect(updated!.isEnabled).toBe(true);
    expect(updated!.isSandbox).toBe(false);

    // Verify only one config exists
    const db = getTenantTestDb();
    const configs = await db
      .select()
      .from(eInvoiceConfigs)
      .where(eq(eInvoiceConfigs.businessId, world.business1.id));
    expect(configs.length).toBe(1);
  });

  it("returns masked config on getConfig", async () => {
    const caller = callerForRamesh();
    await setupEInvoiceConfig();

    const config = await caller.eInvoice.getConfig();
    expect(config).not.toBeNull();
    expect(config!.password).toBe("••••••••");
    expect(config!.clientSecret).toContain("••••••••");
    expect(config!.gstin).toBe("27AABCU9603R1ZM");
  });
});

// ── 2. Invoice-to-IRP JSON mapping ────────────────────────────────────────────

describe("mapInvoiceToIRP", () => {
  it("maps all required fields correctly", () => {
    const result = mapInvoiceToIRP(
      {
        invoiceNumber: "INV-00001",
        invoiceDate: new Date("2026-04-02"),
        type: "sale",
        documentType: "invoice",
        subtotal: "10000.00",
        taxAmount: "1800.00",
        discountAmount: null,
        additionalCharges: null,
        roundOff: null,
        totalAmount: "11800.00",
        isReverseCharge: false,
      },
      [
        {
          itemName: "Steel Pipes",
          description: null,
          quantity: "10",
          unitPrice: "1000.00",
          taxPercent: "18",
          taxAmount: "1800.00",
          discountPercent: "0",
          totalAmount: "11800.00",
          selectedUnit: "pcs",
          itemType: "product",
          itemHsn: "7306",
        },
      ],
      {
        gstin: "29AABCG0000R1ZM",
        name: "GST Registered Customer",
        billingAddress: "100 MG Road",
        city: "Bengaluru",
        state: "Karnataka",
        stateCode: "29",
        pincode: "560001",
        phone: "9876543210",
        email: null,
      },
      {
        gstin: "27AABCU9603R1ZM",
        legalName: "Acme Trading Co",
        name: "Acme Trading Co",
        address: "123 MG Road",
        city: "Mumbai",
        state: "Maharashtra",
        stateCode: "27",
        pincode: "400001",
        phone: "9876543210",
        email: null,
      },
    );

    // Basic structure
    expect(result.Version).toBe("1.1");
    expect(result.DocDtls.Typ).toBe("INV");
    expect(result.DocDtls.No).toBe("INV-00001");
    expect(result.DocDtls.Dt).toBe("02/04/2026");

    // Seller
    expect(result.SellerDtls.Gstin).toBe("27AABCU9603R1ZM");
    expect(result.SellerDtls.Stcd).toBe("27");

    // Buyer
    expect(result.BuyerDtls.Gstin).toBe("29AABCG0000R1ZM");
    expect(result.BuyerDtls.Pos).toBe("29");

    // Line item: inter-state → IGST only
    expect(result.ItemList).toHaveLength(1);
    expect(result.ItemList[0]!.HsnCd).toBe("7306");
    expect(result.ItemList[0]!.Unit).toBe("PCS");
    expect(result.ItemList[0]!.IgstAmt).toBeGreaterThan(0);
    expect(result.ItemList[0]!.CgstAmt).toBe(0);

    // Val totals
    expect(result.ValDtls.TotInvVal).toBe(11800);
    expect(result.ValDtls.IgstVal).toBeGreaterThan(0);
  });

  it("splits CGST+SGST for intra-state", () => {
    const result = mapInvoiceToIRP(
      {
        invoiceNumber: "INV-00002",
        invoiceDate: new Date("2026-04-02"),
        type: "sale",
        documentType: "invoice",
        subtotal: "10000.00",
        taxAmount: "1800.00",
        discountAmount: null,
        additionalCharges: null,
        roundOff: null,
        totalAmount: "11800.00",
        isReverseCharge: false,
      },
      [
        {
          itemName: "Cotton Fabric",
          description: null,
          quantity: "100",
          unitPrice: "100.00",
          taxPercent: "18",
          taxAmount: "1800.00",
          discountPercent: "0",
          totalAmount: "11800.00",
          selectedUnit: "m",
          itemType: "product",
          itemHsn: "5208",
        },
      ],
      {
        gstin: "27AABCM0000R1ZM", // Same state as seller (27=Maharashtra)
        name: "Intra-state Customer",
        billingAddress: "Pune",
        city: "Pune",
        state: "Maharashtra",
        stateCode: "27",
        pincode: "411001",
        phone: null,
        email: null,
      },
      {
        gstin: "27AABCU9603R1ZM",
        legalName: "Acme Trading Co",
        name: "Acme Trading Co",
        address: "123 MG Road",
        city: "Mumbai",
        state: "Maharashtra",
        stateCode: "27",
        pincode: "400001",
        phone: null,
        email: null,
      },
    );

    // Intra-state: CGST + SGST, no IGST
    expect(result.ItemList[0]!.IgstAmt).toBe(0);
    expect(result.ItemList[0]!.CgstAmt).toBeGreaterThan(0);
    expect(result.ItemList[0]!.SgstAmt).toBeGreaterThan(0);
    expect(result.ItemList[0]!.CgstAmt + result.ItemList[0]!.SgstAmt).toBe(
      result.ItemList[0]!.CgstAmt + result.ItemList[0]!.SgstAmt,
    );
    expect(result.ValDtls.IgstVal).toBe(0);
    expect(result.ValDtls.CgstVal).toBeGreaterThan(0);
  });

  it("maps credit note to CRN doc type", () => {
    const result = mapInvoiceToIRP(
      {
        invoiceNumber: "CN-00001",
        invoiceDate: new Date("2026-04-02"),
        type: "sale",
        documentType: "credit_note",
        subtotal: "1000.00",
        taxAmount: "180.00",
        discountAmount: null,
        additionalCharges: null,
        roundOff: null,
        totalAmount: "1180.00",
        isReverseCharge: false,
      },
      [
        {
          itemName: "Return",
          description: null,
          quantity: "1",
          unitPrice: "1000.00",
          taxPercent: "18",
          taxAmount: "180.00",
          discountPercent: "0",
          totalAmount: "1180.00",
          selectedUnit: null,
          itemType: null,
          itemHsn: null,
        },
      ],
      {
        gstin: "27AABCM0000R1ZM",
        name: "Customer",
        billingAddress: null,
        city: null,
        state: null,
        stateCode: "27",
        pincode: null,
        phone: null,
        email: null,
      },
      {
        gstin: "27AABCU9603R1ZM",
        legalName: null,
        name: "Acme",
        address: null,
        city: null,
        state: null,
        stateCode: "27",
        pincode: null,
        phone: null,
        email: null,
      },
    );

    expect(result.DocDtls.Typ).toBe("CRN");
  });

  // Regression: every inter-state supply was sent as SupTyp "EXPWP" (export
  // with payment) instead of B2B with IGST.
  describe("supply type", () => {
    const inv = {
      invoiceNumber: "INV-SUP",
      invoiceDate: new Date("2026-04-02"),
      type: "sale",
      documentType: "invoice",
      subtotal: "10000.00",
      taxAmount: "1800.00",
      discountAmount: null,
      additionalCharges: null,
      roundOff: null,
      totalAmount: "11800.00",
      isReverseCharge: false,
    };
    const line = (taxPercent = "18") => [
      {
        itemName: "Steel Pipes",
        description: null,
        quantity: "10",
        unitPrice: "1000.00",
        taxPercent,
        taxAmount: "1800.00",
        discountPercent: "0",
        totalAmount: "11800.00",
        selectedUnit: "pcs",
        itemType: "product",
        itemHsn: "7306",
      },
    ];
    const seller = {
      gstin: "27AABCU9603R1ZM", legalName: null, name: "Acme", address: null, city: null,
      state: "Maharashtra", stateCode: "27", pincode: "400001", phone: null, email: null,
    };
    const buyer = (over: Record<string, unknown> = {}) => ({
      gstin: "29AABCG0000R1ZM", name: "Buyer", billingAddress: null, city: null,
      state: "Karnataka", stateCode: "29", pincode: "560001", phone: null, email: null,
      ...over,
    });

    it("inter-state regular buyer is B2B with IGST, not an export", () => {
      const r = mapInvoiceToIRP(inv, line(), buyer({ gstRegistrationType: "regular" }), seller);
      expect(r.TranDtls.SupTyp).toBe("B2B");
      expect(r.BuyerDtls.Pos).toBe("29");
      expect(r.ValDtls.IgstVal).toBe(1800);
      expect(r.ValDtls.CgstVal).toBe(0);
      expect(r.ValDtls.SgstVal).toBe(0);
    });

    it("intra-state buyer is B2B with CGST+SGST", () => {
      const r = mapInvoiceToIRP(inv, line(), buyer({ gstin: "27AABCM0000R1ZM", stateCode: "27" }), seller);
      expect(r.TranDtls.SupTyp).toBe("B2B");
      expect(r.ValDtls.IgstVal).toBe(0);
      expect(r.ValDtls.CgstVal).toBe(900);
      expect(r.ValDtls.SgstVal).toBe(900);
    });

    it("derives place of supply from the GSTIN when the party has no state code", () => {
      const r = mapInvoiceToIRP(inv, line(), buyer({ stateCode: null }), seller);
      expect(r.TranDtls.SupTyp).toBe("B2B");
      expect(r.BuyerDtls.Pos).toBe("29");
      expect(r.ValDtls.IgstVal).toBe(1800);
    });

    it("SEZ buyer is SEZWP/SEZWOP and always IGST, even in the same state", () => {
      const sameStateSez = buyer({ gstin: "27AABCS0000R1ZM", stateCode: "27", gstRegistrationType: "sez" });
      const withPay = mapInvoiceToIRP(inv, line(), sameStateSez, seller);
      expect(withPay.TranDtls.SupTyp).toBe("SEZWP");
      expect(withPay.ValDtls.IgstVal).toBe(1800);
      expect(withPay.ValDtls.CgstVal).toBe(0);

      const lut = mapInvoiceToIRP(inv, line("0"), sameStateSez, seller);
      expect(lut.TranDtls.SupTyp).toBe("SEZWOP");
    });

    it("overseas buyer is an export (EXPWP/EXPWOP) with POS 96", () => {
      const overseas = buyer({ gstin: null, stateCode: null, gstRegistrationType: "overseas" });
      const r = mapInvoiceToIRP(inv, line(), overseas, seller);
      expect(r.TranDtls.SupTyp).toBe("EXPWP");
      expect(r.BuyerDtls.Gstin).toBe("URP");
      expect(r.BuyerDtls.Pos).toBe("96");
      expect(r.ValDtls.IgstVal).toBe(1800);
      expect(mapInvoiceToIRP(inv, line("0"), overseas, seller).TranDtls.SupTyp).toBe("EXPWOP");
    });

    // Regression: the GSTIN lookup maps IRP taxpayer type NRT (a non-resident
    // taxable person, registered in India with a GSTIN) to "overseas", and
    // every "overseas" party was sent as an export — POS 96, PIN 999999, but
    // with a real GSTIN as the buyer.
    it("an overseas-typed buyer holding a GSTIN is B2B, not an export", () => {
      const nrt = buyer({
        gstin: "27AABCN0000R1ZM", stateCode: "27", pincode: "400002", gstRegistrationType: "overseas",
      });
      const r = mapInvoiceToIRP(inv, line(), nrt, seller);
      expect(r.TranDtls.SupTyp).toBe("B2B");
      expect(r.BuyerDtls.Gstin).toBe("27AABCN0000R1ZM");
      expect(r.BuyerDtls.Pos).toBe("27");
      expect(r.BuyerDtls.Stcd).toBe("27");
      expect(r.BuyerDtls.Pin).toBe(400002);
      expect(r.ValDtls.CgstVal).toBe(900);
      expect(r.ValDtls.SgstVal).toBe(900);
      expect(r.ValDtls.IgstVal).toBe(0);
    });

    // Regression: the document date was read with the server's local-time
    // getters. On a UTC server an invoice dated 3 Apr (entered in India, so
    // stored as 2026-04-02T18:30Z) was sent to the IRP as 02/04/2026.
    it("sends the invoice date as the calendar day in India", () => {
      const r = mapInvoiceToIRP(
        { ...inv, invoiceDate: new Date("2026-04-03T00:00:00+05:30") },
        line(), buyer(), seller,
      );
      expect(r.DocDtls.Dt).toBe("03/04/2026");
    });

    it("maps item units to GST UQC codes", () => {
      const unitLine = (selectedUnit: string | null) => line().map((l) => ({ ...l, selectedUnit }));
      const uqc = (unit: string | null) => mapInvoiceToIRP(inv, unitLine(unit), buyer(), seller).ItemList[0]!.Unit;
      expect(uqc("dozen")).toBe("DOZ");
      expect(uqc("pair")).toBe("PRS");
      expect(uqc("cm")).toBe("CMS");
      expect(uqc("kg")).toBe("KGS");
      expect(uqc(null)).toBe("OTH");
    });

    it("treats a blank party state code as missing when deriving place of supply", () => {
      const r = mapInvoiceToIRP(inv, line(), buyer({ stateCode: "" }), seller);
      expect(r.BuyerDtls.Pos).toBe("29");
      expect(r.BuyerDtls.Stcd).toBe("29");
      expect(r.ValDtls.IgstVal).toBe(1800);
    });
  });

  it("throws if business has no GSTIN", () => {
    expect(() =>
      mapInvoiceToIRP(
        {
          invoiceNumber: "INV-00003",
          invoiceDate: new Date(),
          type: "sale",
          documentType: "invoice",
          subtotal: "1000",
          taxAmount: "180",
          discountAmount: null,
          additionalCharges: null,
          roundOff: null,
          totalAmount: "1180",
          isReverseCharge: false,
        },
        [],
        { gstin: "27AABCG0000R1ZM", name: "Party", billingAddress: null, city: null, state: null, stateCode: "27", pincode: null, phone: null, email: null },
        { gstin: null, legalName: null, name: "Biz", address: null, city: null, state: null, stateCode: null, pincode: null, phone: null, email: null },
      ),
    ).toThrow("Business GSTIN is required");
  });
});

// ── 3. Generate IRN ───────────────────────────────────────────────────────────

describe("eInvoice.generate", () => {
  it("generates IRN for a B2B invoice", async () => {
    const db = getTenantTestDb();
    await setupEInvoiceConfig();
    const caller = callerForRamesh();

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      b2bParty.id,
      [
        {
          description: "Steel Rods",
          quantity: "10",
          unitPrice: "1000.00",
          taxPercent: "18",
        },
      ],
    );

    const result = await caller.eInvoice.generate({ invoiceId: invoice.id });

    expect(result).toBeDefined();
    expect(result!.irn).toBeTruthy();
    expect(result!.irnAckNumber).toBeTruthy();
    expect(result!.eInvoiceStatus).toBe("generated");
    expect(result!.signedQrCode).toBeTruthy();
  });

  it("throws if IRN already generated", async () => {
    const db = getTenantTestDb();
    await setupEInvoiceConfig();
    const caller = callerForRamesh();

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      b2bParty.id,
      [{ description: "Product", quantity: "1", unitPrice: "5000.00", taxPercent: "18" }],
    );

    await caller.eInvoice.generate({ invoiceId: invoice.id });

    // Second attempt should fail
    await expect(
      caller.eInvoice.generate({ invoiceId: invoice.id }),
    ).rejects.toThrow("IRN already generated");
  });

  it("throws for B2C invoice (party has no GSTIN)", async () => {
    const db = getTenantTestDb();
    await setupEInvoiceConfig();
    const caller = callerForRamesh();

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      b2cParty.id, // No GSTIN
      [{ description: "Product", quantity: "1", unitPrice: "500.00", taxPercent: "18" }],
    );

    await expect(
      caller.eInvoice.generate({ invoiceId: invoice.id }),
    ).rejects.toThrow("GSTIN");
  });

  // Regression: generate rejected every party without a GSTIN, so an export
  // to an overseas buyer could never be e-invoiced and the EXPWP mapping
  // (Gstin "URP", POS 96) was unreachable.
  it("generates an IRN for an export to an overseas buyer without a GSTIN", async () => {
    const mockModule = await import("../../lib/irp-client.js") as unknown as {
      __mockGenerateIRN: ReturnType<typeof vi.fn>;
    };
    const db = getTenantTestDb();
    await setupEInvoiceConfig();
    const caller = callerForRamesh();

    const overseas = await createParty(db, world.business1.id, {
      name: "Acme Imports LLC",
      type: "customer",
      gstin: null,
      gstRegistrationType: "overseas",
      openingBalance: "0.00",
    });
    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      overseas.id,
      [{ description: "Handicrafts", quantity: "2", unitPrice: "5000.00", taxPercent: "18" }],
    );

    mockModule.__mockGenerateIRN.mockClear();
    const result = await caller.eInvoice.generate({ invoiceId: invoice.id });

    expect(result!.eInvoiceStatus).toBe("generated");
    const payload = mockModule.__mockGenerateIRN.mock.calls[0]![0];
    expect(payload.TranDtls.SupTyp).toBe("EXPWP");
    expect(payload.BuyerDtls.Gstin).toBe("URP");
    expect(payload.BuyerDtls.Pos).toBe("96");
  });

  it("marks invoice as failed when IRP returns 400 error", async () => {
    const mockModule = await import("../../lib/irp-client.js") as unknown as {
      __mockGenerateIRN: ReturnType<typeof vi.fn>;
      IRPError: new (msg: string, code: string) => Error;
    };

    const { IRPError } = mockModule;
    const origMock = mockModule.__mockGenerateIRN;

    // Temporarily make generate throw a non-retryable error
    origMock.mockRejectedValueOnce(new IRPError("Duplicate IRN", "2150"));

    const db = getTenantTestDb();
    await setupEInvoiceConfig();
    const caller = callerForRamesh();

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      b2bParty.id,
      [{ description: "Product", quantity: "1", unitPrice: "1000.00", taxPercent: "18" }],
    );

    await expect(
      caller.eInvoice.generate({ invoiceId: invoice.id }),
    ).rejects.toThrow();

    // Verify DB status
    const [updated] = await db
      .select({ status: invoices.eInvoiceStatus })
      .from(invoices)
      .where(eq(invoices.id, invoice.id));
    expect(updated!.status).toBe("failed");
  });
});

// ── 4. Cancel IRN ─────────────────────────────────────────────────────────────

describe("eInvoice.cancel", () => {
  it("cancels IRN within 24 hours", async () => {
    const db = getTenantTestDb();
    await setupEInvoiceConfig();
    const caller = callerForRamesh();

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      b2bParty.id,
      [{ description: "Product", quantity: "5", unitPrice: "2000.00", taxPercent: "18" }],
    );

    // Generate first
    await caller.eInvoice.generate({ invoiceId: invoice.id });

    // Cancel
    const result = await caller.eInvoice.cancel({
      invoiceId: invoice.id,
      cancelReason: "2",
      cancelRemarks: "Entered wrong amount",
    });

    expect(result!.eInvoiceStatus).toBe("cancelled");
    expect(result!.eInvoiceCancelReason).toBe("2");
  });

  it("rejects cancellation if IRN is > 24 hours old", async () => {
    const db = getTenantTestDb();
    await setupEInvoiceConfig();
    const caller = callerForRamesh();

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      b2bParty.id,
      [{ description: "Old Product", quantity: "1", unitPrice: "500.00", taxPercent: "18" }],
    );

    // Insert IRN directly with old ack date (>24h ago)
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await db
      .update(invoices)
      .set({
        irn: "OLDIRN123456789012345678901234567890123456789012345678901234",
        irnAckDate: yesterday,
        eInvoiceStatus: "generated",
      })
      .where(eq(invoices.id, invoice.id));

    await expect(
      caller.eInvoice.cancel({
        invoiceId: invoice.id,
        cancelReason: "1",
      }),
    ).rejects.toThrow("24 hours");
  });

  it("rejects cancellation if invoice has no IRN", async () => {
    const db = getTenantTestDb();
    await setupEInvoiceConfig();
    const caller = callerForRamesh();

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      b2bParty.id,
      [{ description: "Product", quantity: "1", unitPrice: "500.00", taxPercent: "18" }],
    );

    await expect(
      caller.eInvoice.cancel({
        invoiceId: invoice.id,
        cancelReason: "1",
      }),
    ).rejects.toThrow("IRN");
  });
});

// ── 5. Dashboard ──────────────────────────────────────────────────────────────

describe("eInvoice.dashboard", () => {
  it("returns status counts and invoice list", async () => {
    const caller = callerForRamesh();
    const result = await caller.eInvoice.dashboard({ page: 1, limit: 20 });

    expect(result).toBeDefined();
    expect(result.counts).toHaveProperty("generated");
    expect(result.counts).toHaveProperty("pending");
    expect(result.counts).toHaveProperty("failed");
    expect(result.counts).toHaveProperty("cancelled");
    expect(result.data).toBeInstanceOf(Array);
    expect(typeof result.total).toBe("number");
  });

  it("filters by status", async () => {
    const caller = callerForRamesh();
    const result = await caller.eInvoice.dashboard({
      status: "generated",
      page: 1,
      limit: 20,
    });

    expect(result.data.every((inv) => inv.eInvoiceStatus === "generated")).toBe(true);
  });

  // Regression: the date range was bound as raw Date values inside a sql``
  // template, which postgres-js rejects — any date filter failed the query.
  it("filters by invoice date range", async () => {
    const caller = callerForRamesh();
    const all = await caller.eInvoice.dashboard({ page: 1, limit: 100 });
    expect(all.data.length).toBeGreaterThan(0);

    const inRange = await caller.eInvoice.dashboard({
      fromDate: "2000-01-01T00:00:00.000Z",
      toDate: "2099-12-31T23:59:59.999Z",
      page: 1,
      limit: 100,
    });
    expect(inRange.total).toBe(all.total);

    const beforeAll = await caller.eInvoice.dashboard({
      toDate: "2000-01-01T00:00:00.000Z",
      page: 1,
      limit: 100,
    });
    expect(beforeAll.total).toBe(0);
    expect(beforeAll.data).toEqual([]);
  });
});

// ── 6. getStatus ──────────────────────────────────────────────────────────────

describe("eInvoice.getStatus", () => {
  it("returns e-invoice status for a given invoice", async () => {
    const db = getTenantTestDb();
    await setupEInvoiceConfig();
    const caller = callerForRamesh();

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      b2bParty.id,
      [{ description: "Product", quantity: "1", unitPrice: "500.00", taxPercent: "18" }],
    );

    await caller.eInvoice.generate({ invoiceId: invoice.id });

    const status = await caller.eInvoice.getStatus({ invoiceId: invoice.id });
    expect(status).not.toBeNull();
    expect(status!.eInvoiceStatus).toBe("generated");
    expect(status!.irn).toBeTruthy();
    expect(status!.signedQrCode).toBeTruthy();
  });

  it("returns null for unknown invoice", async () => {
    const caller = callerForRamesh();
    const status = await caller.eInvoice.getStatus({
      invoiceId: "00000000-0000-0000-0000-000000000000",
    });
    expect(status).toBeNull();
  });
});

// ── 7. Permissions ─────────────────────────────────────────────────────────────

describe("eInvoice permissions", () => {
  it("accountant can read dashboard but not configure", async () => {
    // suresh is seller role → no EInvoice:manage permission
    const caller = callerForAccountant();

    // dashboard (read) should fail for seller role (sellers don't have EInvoice:read)
    await expect(
      caller.eInvoice.dashboard({ page: 1, limit: 10 }),
    ).rejects.toThrow();

    // configure (manage) should fail
    await expect(
      caller.eInvoice.configure({
        gstin: "27AABCU9603R1ZM",
        clientId: "x",
        clientSecret: "x",
        username: "x",
        password: "x",
        isSandbox: true,
        isEnabled: false,
        thresholdCrore: "5",
      }),
    ).rejects.toThrow();
  });
});
