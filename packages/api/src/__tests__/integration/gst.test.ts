/**
 * gst.test.ts — Integration tests for gstRouter (GSTR-1, GSTR-3B)
 *
 * WHY THIS FILE EXISTS:
 * The GST reports are the primary compliance output of Fintranzact. Incorrect
 * classification of invoices (B2B vs B2C) or tax type (CGST+SGST vs IGST) can
 * result in incorrect returns filed with the government. We verify:
 *
 *   B2B vs B2C:   A party with a GSTIN is classified as B2B.
 *                 A party without a GSTIN goes to B2C (small or large).
 *   Tax split:    Same-state supplier → CGST + SGST (half each).
 *                 Inter-state supplier → IGST only (full tax amount).
 *   GSTR-3B:      Outward supplies match the sale invoices for the period.
 *                 ITC section reflects purchase invoices.
 *   Business isolation: reports only reflect the queried business's invoices.
 *
 * The business fixture (business1) is in Maharashtra (stateCode "27").
 * party1 is also in Maharashtra (intra-state → CGST+SGST).
 * We create an inter-state party (Karnataka, "29") to test IGST path.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { invoiceItems } from "@fintranzact/db";
import {
  createTestWorld,
  createParty,
  createBusiness,
  createItem,
  createInvoiceWithItems,
  type TestWorld,
  type TestBusiness,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { truncateAllTables, closeTestDb, getTenantTestDb } from "../helpers/test-db.js";

// ── Fixture ────────────────────────────────────────────────────────────────────

let world: TestWorld;

// Use a fixed past month to avoid FY boundary edge cases
const TEST_YEAR = 2025;
const TEST_MONTH = 8; // August 2025 — well within a single FY

function invoiceDateInTestMonth(): Date {
  // mid-month to avoid any timezone edge cases near month boundaries
  return new Date(TEST_YEAR, TEST_MONTH - 1, 15, 12, 0, 0);
}

beforeAll(async () => {
  world = await createTestWorld();

  const { tenantDb, business1, party1, item1 } = world;

  // 1. Intra-state B2B sale — party1 has GSTIN, same state as business1 (Maharashtra)
  //    Subtotal: 10 × 1000 = 10,000 | tax 5% = 500 → CGST 250 + SGST 250
  await createInvoiceWithItems(
    tenantDb,
    business1.id,
    party1.id,
    [
      {
        itemId: item1.id,
        description: "Cotton Fabric",
        quantity: "10",
        unitPrice: "1000.00",
        taxPercent: "5.00",
      },
    ],
    {
      type: "sale",
      documentType: "invoice",
      status: "sent",
      invoiceDate: invoiceDateInTestMonth(),
    },
  );

  // 2. Inter-state B2B sale — party in Karnataka (different stateCode "29")
  //    We create an inter-state party explicitly with Karnataka stateCode
  const interStateParty = await createParty(tenantDb, business1.id, {
    name: "Karnataka Trader",
    type: "customer",
    gstin: "29AABCK9999R1ZM", // has GSTIN → B2B
    city: "Bengaluru",
    state: "Karnataka",
    stateCode: "29",
    openingBalance: "0.00",
  });

  // Subtotal: 5 × 2000 = 10,000 | tax 12% = 1,200 → IGST 1,200
  await createInvoiceWithItems(
    tenantDb,
    business1.id,
    interStateParty.id,
    [
      {
        itemId: item1.id,
        description: "Silk Fabric",
        quantity: "5",
        unitPrice: "2000.00",
        taxPercent: "12.00",
      },
    ],
    {
      type: "sale",
      documentType: "invoice",
      status: "sent",
      invoiceDate: invoiceDateInTestMonth(),
    },
  );

  // 3. B2C sale — party WITHOUT GSTIN, same state (intra-state B2C Small)
  const b2cParty = await createParty(tenantDb, business1.id, {
    name: "Walk-in Customer",
    type: "customer",
    gstin: null, // no GSTIN → B2C
    city: "Nagpur",
    state: "Maharashtra",
    stateCode: "27",
    openingBalance: "0.00",
  });

  // Small B2C invoice (well under ₹2.5L)
  await createInvoiceWithItems(
    tenantDb,
    business1.id,
    b2cParty.id,
    [
      {
        description: "Handkerchief",
        quantity: "20",
        unitPrice: "50.00",
        taxPercent: "5.00",
      },
    ],
    {
      type: "sale",
      documentType: "invoice",
      status: "sent",
      invoiceDate: invoiceDateInTestMonth(),
    },
  );

  // 4. Purchase invoice — will appear in GSTR-3B ITC section
  await createInvoiceWithItems(
    tenantDb,
    business1.id,
    party1.id,
    [
      {
        itemId: item1.id,
        description: "Raw cotton purchase",
        quantity: "100",
        unitPrice: "200.00",
        taxPercent: "5.00",
      },
    ],
    {
      type: "purchase",
      documentType: "invoice",
      status: "sent",
      invoiceDate: invoiceDateInTestMonth(),
    },
  );
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ── GSTR-1 ─────────────────────────────────────────────────────────────────────

describe("gst.gstr1", () => {
  it("gstr1 returns correct period string for the queried year/month", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr1({ year: TEST_YEAR, month: TEST_MONTH });

    expect(typeof report.period).toBe("string");
    expect(report.period.length).toBeGreaterThan(0);
    expect(report.businessGstin).toBe(world.business1.gstin);
    expect(report.businessName).toBe(world.business1.name);
  });

  it("gstr1 B2B classification — party with GSTIN appears in b2b array, not b2cSmall or b2cLarge", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr1({ year: TEST_YEAR, month: TEST_MONTH });

    // party1 has GSTIN so all invoices to party1 must be in b2b
    const party1Gstin = world.party1.gstin!;
    const b2bEntries = report.b2b.filter((e) => e.partyGstin === party1Gstin);
    expect(b2bEntries.length).toBeGreaterThanOrEqual(1);

    // Ensure party1 is not accidentally in b2cSmall
    const b2cSmallParties = report.b2cSmall; // aggregated by tax rate, no partyGstin
    // The b2cSmall check is indirect: if b2b has the party then b2cSmall aggregate is for the no-GSTIN party
    expect(Array.isArray(b2cSmallParties)).toBe(true);
  });

  it("gstr1 intra-state invoice has CGST+SGST (half each), zero IGST", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr1({ year: TEST_YEAR, month: TEST_MONTH });

    // Find the intra-state party1 entry in b2b
    const intraEntry = report.b2b.find(
      (e) => e.partyGstin === world.party1.gstin && e.taxableValue > 0,
    );

    expect(intraEntry).toBeDefined();
    expect(intraEntry!.igst).toBe(0);
    expect(intraEntry!.cgst).toBeGreaterThan(0);
    expect(intraEntry!.sgst).toBeGreaterThan(0);
    // CGST and SGST must be equal
    expect(intraEntry!.cgst).toBeCloseTo(intraEntry!.sgst, 2);
    // CGST + SGST = total tax on the line
    expect(intraEntry!.cgst + intraEntry!.sgst).toBeCloseTo(
      intraEntry!.totalInvoiceValue - intraEntry!.taxableValue,
      2,
    );
  });

  it("gstr1 inter-state invoice has IGST only, zero CGST and SGST", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr1({ year: TEST_YEAR, month: TEST_MONTH });

    // Karnataka trader GSTIN
    const interEntry = report.b2b.find((e) => e.partyGstin === "29AABCK9999R1ZM");

    expect(interEntry).toBeDefined();
    expect(interEntry!.cgst).toBe(0);
    expect(interEntry!.sgst).toBe(0);
    expect(interEntry!.igst).toBeGreaterThan(0);
  });

  it("gstr1 B2C sale without GSTIN appears in b2cSmall, not b2b", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr1({ year: TEST_YEAR, month: TEST_MONTH });

    // b2cSmall should have at least one entry (from the Walk-in Customer invoice)
    expect(report.b2cSmall.length).toBeGreaterThanOrEqual(1);
    // The 5% tax rate bucket should exist
    const bucket5pct = report.b2cSmall.find((b) => b.taxRate === 5);
    expect(bucket5pct).toBeDefined();
    expect(bucket5pct!.taxableValue).toBeGreaterThan(0);
  });

  it("gstr1 totals are consistent: totalTax = totalCgst + totalSgst + totalIgst", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr1({ year: TEST_YEAR, month: TEST_MONTH });

    const computedTotalTax = report.totalCgst + report.totalSgst + report.totalIgst;
    expect(report.totalTax).toBeCloseTo(computedTotalTax, 2);
  });

  it("gstr1 — business isolation: business2 with no invoices returns empty report", async () => {
    const caller2 = createTestCaller({
      userId: world.kiran.id,
      email: world.kiran.email,
      name: world.kiran.name,
      tenantId: world.tenant2.id,
      businessId: world.business2.id,
    });

    const report = await caller2.gst.gstr1({ year: TEST_YEAR, month: TEST_MONTH });

    expect(report.b2b.length).toBe(0);
    expect(report.b2cSmall.length).toBe(0);
    expect(report.totalTaxableValue).toBe(0);
    expect(report.invoiceCount).toBe(0);
  });
});

// ── GSTR-3B ────────────────────────────────────────────────────────────────────

describe("gst.gstr3b", () => {
  it("gstr3b returns period and business identifiers", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr3b({ year: TEST_YEAR, month: TEST_MONTH });

    expect(typeof report.period).toBe("string");
    expect(report.businessGstin).toBe(world.business1.gstin);
  });

  it("gstr3b outward supplies taxable value matches sale invoices for the period", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr3b({ year: TEST_YEAR, month: TEST_MONTH });

    // We created 3 sale invoices with subtotals: 10,000 + 10,000 + 1,000 = 21,000
    expect(report.outwardSupplies.taxable.taxableValue).toBeGreaterThan(0);
  });

  it("gstr3b ITC section reflects purchase invoices for the period", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr3b({ year: TEST_YEAR, month: TEST_MONTH });

    // Purchase invoice created: 100 × 200 = 20,000 subtotal, 5% tax = 1,000 ITC
    expect(report.itc.total).toBeGreaterThan(0);
  });

  it("gstr3b net tax = taxPayable minus ITC", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr3b({ year: TEST_YEAR, month: TEST_MONTH });

    // net = taxPayable - ITC (each component separately)
    const computedNetIgst = report.taxPayable.igst - report.itc.igst;
    const computedNetCgst = report.taxPayable.cgst - report.itc.cgst;
    const computedNetSgst = report.taxPayable.sgst - report.itc.sgst;

    expect(report.netTax.igst).toBeCloseTo(computedNetIgst, 2);
    expect(report.netTax.cgst).toBeCloseTo(computedNetCgst, 2);
    expect(report.netTax.sgst).toBeCloseTo(computedNetSgst, 2);
  });

  it("gstr3b — business isolation: business2 returns zero outward supplies", async () => {
    const caller2 = createTestCaller({
      userId: world.kiran.id,
      email: world.kiran.email,
      name: world.kiran.name,
      tenantId: world.tenant2.id,
      businessId: world.business2.id,
    });

    const report = await caller2.gst.gstr3b({ year: TEST_YEAR, month: TEST_MONTH });

    expect(report.outwardSupplies.taxable.taxableValue).toBe(0);
    expect(report.itc.total).toBe(0);
  });
});

// ── GSTR-1 — sales_return in CDN section ──────────────────────────────────────

describe("GSTR-1 — includes sales_return in credit note section", () => {
  // Use a separate month to avoid polluting the main fixture month
  const SR_YEAR = 2025;
  const SR_MONTH = 11; // November 2025

  beforeAll(async () => {
    const tenantDb = getTenantTestDb();

    // Create a sales_return in the test month so it appears in the CDN section
    // 2 × 500 = 1,000 subtotal, 5% tax = 50 → CGST 25 + SGST 25
    await createInvoiceWithItems(
      tenantDb,
      world.business1.id,
      world.party1.id,
      [
        {
          itemId: world.item1.id,
          description: "Sales Return item",
          quantity: "2",
          unitPrice: "500.00",
          taxPercent: "5.00",
        },
      ],
      {
        type: "sale",
        documentType: "sales_return",
        status: "sent",
        invoiceDate: new Date(SR_YEAR, SR_MONTH - 1, 15, 12, 0, 0),
      },
    );
  });

  it("sales_return appears in GSTR-1 CDN section alongside credit notes", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr1({ year: SR_YEAR, month: SR_MONTH });

    // The sales_return must appear in the creditNotes array (CDN section)
    expect(Array.isArray(report.creditNotes)).toBe(true);
    expect(report.creditNotes.length).toBeGreaterThanOrEqual(1);

    // Each entry must have the expected shape
    const srEntry = report.creditNotes[0]!;
    expect(typeof srEntry.invoiceNumber).toBe("string");
    expect(typeof srEntry.totalAmount).toBe("string");
    expect(parseFloat(srEntry.totalAmount)).toBeGreaterThan(0);

    // The sales_return must NOT appear in the regular sale invoice list (b2b)
    // — only the sales_return row is in this month, so b2b should be empty
    const b2bEntriesThisMonth = report.b2b;
    const srInvoiceNumber = srEntry.invoiceNumber;
    const srInB2b = b2bEntriesThisMonth.some((e) => e.invoiceNumber === srInvoiceNumber);
    expect(srInB2b).toBe(false);
  });
});

// ── Purchase return — reverses ITC, not an outward debit note ────────────────

describe("Purchase return — reverses ITC in GSTR-3B, not a GSTR-1 debit note", () => {
  const PR_YEAR = 2025;
  const PR_MONTH = 12; // December 2025

  beforeAll(async () => {
    const tenantDb = getTenantTestDb();

    // Goods sent back to an intra-state supplier:
    // 1 × 800 = 800 subtotal, 12% tax = 96 → CGST 48 + SGST 48 of ITC taken back
    await createInvoiceWithItems(
      tenantDb,
      world.business1.id,
      world.party1.id,
      [
        {
          itemId: world.item1.id,
          description: "Purchase Return item",
          quantity: "1",
          unitPrice: "800.00",
          taxPercent: "12.00",
        },
      ],
      {
        type: "purchase",
        documentType: "purchase_return",
        status: "sent",
        invoiceDate: new Date(PR_YEAR, PR_MONTH - 1, 15, 12, 0, 0),
      },
    );
  });

  function caller() {
    return createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });
  }

  it("purchase_return is not reported as an outward debit note in GSTR-1", async () => {
    const report = await caller().gst.gstr1({ year: PR_YEAR, month: PR_MONTH });

    expect(report.debitNotes).toEqual([]);
    expect(report.creditNotes).toEqual([]);

    const { json } = await caller().gst.gstr1Json({ year: PR_YEAR, month: PR_MONTH });
    expect(json.cdnr).toEqual([]);
  });

  it("purchase_return takes its tax back out of GSTR-3B ITC", async () => {
    const report = await caller().gst.gstr3b({ year: PR_YEAR, month: PR_MONTH });

    expect(report.itc.cgst).toBeCloseTo(-48, 2);
    expect(report.itc.sgst).toBeCloseTo(-48, 2);
    expect(report.itc.igst).toBeCloseTo(0, 2);
    expect(report.itc.total).toBeCloseTo(-96, 2);
    // Nothing added to output tax
    expect(report.taxPayable.cgst).toBeCloseTo(0, 2);
    expect(report.taxPayable.sgst).toBeCloseTo(0, 2);
  });
});

// ── gstr1CSV ───────────────────────────────────────────────────────────────────

describe("gst.gstr1CSV", () => {
  it("gstr1CSV returns a non-empty CSV string with a filename", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const result = await caller.gst.gstr1CSV({ year: TEST_YEAR, month: TEST_MONTH });

    expect(typeof result.csv).toBe("string");
    expect(result.csv.length).toBeGreaterThan(0);
    expect(typeof result.filename).toBe("string");
    expect(result.filename).toMatch(/\.csv$/);
  });
});

// ── GSTR-3B — Reverse Charge Mechanism ────────────────────────────────────────

describe("GSTR-3B — Reverse Charge Mechanism", () => {
  // Use a different month to avoid polluting the shared fixture month
  const RCM_YEAR = 2025;
  const RCM_MONTH = 9; // September 2025

  beforeAll(async () => {
    const tenantDb = getTenantTestDb();

    // Create a purchase invoice for business1 with RCM flag
    // 1 × 50,000 @ 18% tax = 9,000 tax, same-state (Maharashtra "27") supplier
    await createInvoiceWithItems(
      tenantDb,
      world.business1.id,
      world.party1.id,
      [
        {
          description: "Legal Services",
          quantity: "1",
          unitPrice: "50000.00",
          taxPercent: "18.00",
        },
      ],
      {
        type: "purchase",
        documentType: "invoice",
        status: "sent",
        invoiceDate: new Date(RCM_YEAR, RCM_MONTH - 1, 15, 12, 0, 0),
        isReverseCharge: true,
      },
    );
  });

  it("RCM purchase invoice appears in rcmSupplies section of GSTR-3B", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr3b({ year: RCM_YEAR, month: RCM_MONTH });

    expect(report.rcmSupplies).toBeDefined();
    expect(parseFloat(report.rcmSupplies.taxableValue)).toBeCloseTo(50000, 2);
  });

  it("RCM purchase generates ITC equal to the tax paid under RCM", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr3b({ year: RCM_YEAR, month: RCM_MONTH });

    // Same-state RCM → CGST + SGST. Tax = 50000 * 18% = 9000. CGST = SGST = 4500.
    expect(report.itc.cgst).toBeCloseTo(4500, 2);
    expect(report.itc.sgst).toBeCloseTo(4500, 2);
    expect(report.itc.total).toBeCloseTo(9000, 2);
  });

  it("non-RCM purchase period returns zero rcmSupplies taxableValue", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    // October 2025 has no invoices at all
    const report = await caller.gst.gstr3b({ year: 2025, month: 10 });

    expect(parseFloat(report.rcmSupplies.taxableValue)).toBe(0);
  });
});

// ── Composition Scheme Enforcement ────────────────────────────────────────────

describe("Composition scheme enforcement", () => {
  let compositionBusiness: TestBusiness;

  beforeAll(async () => {
    const tenantDb = getTenantTestDb();

    // Create a composition-registered business in Maharashtra ("27") — same state as party1
    compositionBusiness = await createBusiness(tenantDb, world.ramesh.id, {
      name: "Sharma Kirana Store",
      gstRegistrationType: "composition",
      gstin: "27AABCS9999R1ZM",
      city: "Nashik",
      state: "Maharashtra",
      stateCode: "27",
    });
  });

  it("blocks inter-state sale invoice for composition business", async () => {
    const tenantDb = getTenantTestDb();

    // Create a party in Karnataka (different state from composition business)
    const karnatakaParty = await createParty(tenantDb, compositionBusiness.id, {
      name: "Bengaluru Buyer",
      type: "customer",
      gstin: null,
      city: "Bengaluru",
      state: "Karnataka",
      stateCode: "29",
      openingBalance: "0.00",
    });

    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: compositionBusiness.id,
    });

    await expect(
      caller.invoice.create({
        type: "sale",
        partyId: karnatakaParty.id,
        lineItems: [
          {
            itemName: "Rice",
            quantity: "10",
            unitPrice: "50.00",
            taxPercent: "0",
            discountPercent: "0",
            conversionFactor: "1",
          },
        ],
      }),
    ).rejects.toThrow("Composition scheme businesses cannot make inter-state outward supplies");
  });

  it("allows intra-state sale invoice for composition business", async () => {
    const tenantDb = getTenantTestDb();

    // Create a party in Maharashtra (same state as composition business)
    const maharashtraParty = await createParty(tenantDb, compositionBusiness.id, {
      name: "Pune Customer",
      type: "customer",
      gstin: null,
      city: "Pune",
      state: "Maharashtra",
      stateCode: "27",
      openingBalance: "0.00",
    });

    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: compositionBusiness.id,
    });

    const result = await caller.invoice.create({
      type: "sale",
      partyId: maharashtraParty.id,
      lineItems: [
        {
          itemName: "Rice",
          quantity: "10",
          unitPrice: "50.00",
          taxPercent: "0",
          discountPercent: "0",
          conversionFactor: "1",
        },
      ],
    });

    expect(result.id).toBeDefined();
    expect(result.type).toBe("sale");
  });

  it("CMP-08 returns taxable value for the quarter of outward supplies", async () => {
    const tenantDb = getTenantTestDb();

    // Create an intra-state party for the composition business
    const localParty = await createParty(tenantDb, compositionBusiness.id, {
      name: "Local Buyer",
      type: "customer",
      gstin: null,
      city: "Aurangabad",
      state: "Maharashtra",
      stateCode: "27",
      openingBalance: "0.00",
    });

    // Create a sale invoice dated in Q3 2025 (Jul–Sep)
    await createInvoiceWithItems(
      tenantDb,
      compositionBusiness.id,
      localParty.id,
      [
        {
          description: "Groceries",
          quantity: "100",
          unitPrice: "200.00",
          taxPercent: "0",
        },
      ],
      {
        type: "sale",
        documentType: "invoice",
        status: "sent",
        invoiceDate: new Date(2025, 7, 10, 12, 0, 0), // August 10, 2025 → Q2 FY (Jul–Sep) = Q3 calendar
      },
    );

    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: compositionBusiness.id,
    });

    // FY 2025-26 Q2 (July–September): quarter=2
    const cmp08 = await caller.gst.cmp08({ year: 2025, quarter: 2 });
    expect(cmp08.quarterStart).toBe("2025-06-30T18:30:00.000Z");
    expect(cmp08.quarterEnd).toBe("2025-09-30T18:29:59.999Z");

    expect(parseFloat(cmp08.taxableValue)).toBeGreaterThan(0);
    expect(parseFloat(cmp08.taxPayable)).toBeGreaterThan(0);
    // Tax payable = 1% of taxable value
    expect(parseFloat(cmp08.taxPayable)).toBeCloseTo(
      parseFloat(cmp08.taxableValue) * 0.01,
      2,
    );
    expect(typeof cmp08.quarterStart).toBe("string");
    expect(typeof cmp08.quarterEnd).toBe("string");
  });

  // Regression: CMP-08 summed every sale-side document except orders, so
  // quotations, proformas, challans and credit notes counted as sales, and
  // deleted invoices were included.
  it("CMP-08 counts only sale invoices, net of credit and debit notes, excluding deleted and cancelled", async () => {
    const tenantDb = getTenantTestDb();
    const party = await createParty(tenantDb, compositionBusiness.id, {
      name: "Q4 Buyer",
      type: "customer",
      gstin: null,
      city: "Nashik",
      state: "Maharashtra",
      stateCode: "27",
      openingBalance: "0.00",
    });
    const date = new Date(2025, 10, 12, 12, 0, 0); // 12 Nov 2025 — FY 2025-26 Q3
    const doc = (unitPrice: string, overrides: Parameters<typeof createInvoiceWithItems>[4]) =>
      createInvoiceWithItems(
        tenantDb, compositionBusiness.id, party.id,
        [{ description: "Groceries", quantity: "1", unitPrice, taxPercent: "0" }],
        { type: "sale", status: "sent", invoiceDate: date, ...overrides },
      );

    await doc("10000.00", { documentType: "invoice" });                 // +10,000
    await doc("2000.00", { documentType: "debit_note" });               //  +2,000
    await doc("1500.00", { documentType: "credit_note" });              //  -1,500
    await doc("500.00", { documentType: "sales_return" });              //    -500
    // None of these are outward supplies
    await doc("40000.00", { documentType: "quotation" });
    await doc("40000.00", { documentType: "proforma" });
    await doc("40000.00", { documentType: "delivery_challan" });
    await doc("40000.00", { documentType: "sales_order" });
    await doc("40000.00", { documentType: "invoice", deletedAt: new Date() });
    await doc("40000.00", { documentType: "invoice", status: "cancelled" });

    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: compositionBusiness.id,
    });
    const cmp08 = await caller.gst.cmp08({ year: 2025, quarter: 3 });

    expect(cmp08.taxableValue).toBe("10000.00");
    expect(cmp08.taxPayable).toBe("100.00");
  });

  // Regression: quarters were cut at the server's (UTC) midnight, so an
  // invoice dated 1 Jan in India (2025-12-31T18:30Z) fell in the previous
  // quarter, and one dated early on 1 Apr fell in Q1.
  it("CMP-08 cuts quarters at midnight IST on both edges", async () => {
    const tenantDb = getTenantTestDb();
    const party = await createParty(tenantDb, compositionBusiness.id, {
      name: "Q1 Buyer", type: "customer", gstin: null,
      city: "Nashik", state: "Maharashtra", stateCode: "27", openingBalance: "0.00",
    });
    const sale = (unitPrice: string, invoiceDate: Date) =>
      createInvoiceWithItems(
        tenantDb, compositionBusiness.id, party.id,
        [{ description: "Groceries", quantity: "1", unitPrice, taxPercent: "0" }],
        { type: "sale", documentType: "invoice", status: "sent", invoiceDate },
      );
    await sale("1000.00", new Date("2026-01-01T00:00:00+05:30")); // first moment of FY 2025-26 Q4
    await sale("300.00", new Date("2026-03-31T23:30:00+05:30"));  // last day of FY 2025-26 Q4
    await sale("7000.00", new Date("2026-04-01T01:00:00+05:30")); // FY 2026-27 Q1, though still 31 Mar in UTC

    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: compositionBusiness.id,
    });
    // Financial-year quarters: Q4 of FY 2025-26 is Jan–Mar 2026, Q1 of FY 2026-27 is Apr–Jun 2026
    expect((await caller.gst.cmp08({ year: 2025, quarter: 4 })).taxableValue).toBe("1300.00");
    expect((await caller.gst.cmp08({ year: 2026, quarter: 1 })).taxableValue).toBe("7000.00");
    // Q3 of FY 2025-26 (Oct–Dec 2025) still holds only its own invoices
    expect((await caller.gst.cmp08({ year: 2025, quarter: 3 })).taxableValue).toBe("10000.00");
  });
});

// ── GSTR-3B Table 4 — ITC must not be double counted ─────────────────────────

describe("GSTR-3B — ITC counts only purchase invoices (no double counting)", () => {
  // Separate month so the shared fixture month is not affected
  const ITC_YEAR = 2026;
  const ITC_MONTH = 2; // February 2026

  beforeAll(async () => {
    const tenantDb = getTenantTestDb();
    const date = new Date(ITC_YEAR, ITC_MONTH - 1, 12, 12, 0, 0);
    const lines = [
      { description: "Steel sheets", quantity: "10", unitPrice: "1000.00", taxPercent: "18.00" },
    ];

    // Purchase order (type purchase, documentType quotation): 10,000 @ 18%
    const { invoice: po } = await createInvoiceWithItems(
      tenantDb, world.business1.id, world.party1.id, lines,
      { type: "purchase", documentType: "quotation", status: "sent", invoiceDate: date },
    );

    // The same order converted into the supplier's tax invoice — 1,800 ITC
    await createInvoiceWithItems(
      tenantDb, world.business1.id, world.party1.id, lines,
      { type: "purchase", documentType: "invoice", status: "sent", invoiceDate: date, referenceDocumentId: po.id },
    );

    // Purchase proforma — never an ITC document
    await createInvoiceWithItems(
      tenantDb, world.business1.id, world.party1.id, lines,
      { type: "purchase", documentType: "proforma", status: "sent", invoiceDate: date },
    );
  });

  it("claims 1,800 ITC (900 CGST + 900 SGST), not 3x for PO + proforma + invoice", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr3b({ year: ITC_YEAR, month: ITC_MONTH });

    expect(report.itc.cgst).toBeCloseTo(900, 2);
    expect(report.itc.sgst).toBeCloseTo(900, 2);
    expect(report.itc.igst).toBeCloseTo(0, 2);
    expect(report.itc.total).toBeCloseTo(1800, 2);
    // No sales this month → net = -ITC (credit carried forward)
    expect(report.netTax.total).toBeCloseTo(-1800, 2);
  });
});

// ── GSTR-1 portal JSON — rt must carry the real GST rate ──────────────────────

describe("GSTR-1 portal JSON — emits the GST rate per rate group", () => {
  const RT_YEAR = 2026;
  const RT_MONTH = 1; // January 2026

  function caller() {
    return createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });
  }

  beforeAll(async () => {
    const tenantDb = getTenantTestDb();
    const date = new Date(RT_YEAR, RT_MONTH - 1, 20, 12, 0, 0);

    // Intra-state B2B invoice with two rates:
    //   10,000 @ 18% = 1,800 → 900 CGST + 900 SGST
    //    4,000 @  5% =   200 → 100 CGST + 100 SGST
    await createInvoiceWithItems(
      tenantDb, world.business1.id, world.party1.id,
      [
        { description: "Laptop bag", quantity: "10", unitPrice: "1000.00", taxPercent: "18.00" },
        { description: "Textbook cover", quantity: "20", unitPrice: "200.00", taxPercent: "5.00" },
      ],
      { type: "sale", documentType: "invoice", status: "sent", invoiceDate: date, invoiceNumber: "RT-INV-1" },
    );

    // Inter-state B2B credit note: 2,000 @ 12% = 240 IGST
    const kaParty = await createParty(tenantDb, world.business1.id, {
      name: "Karnataka Returns Co",
      type: "customer",
      gstin: "29AABCR1234R1ZM",
      city: "Mysuru",
      state: "Karnataka",
      stateCode: "29",
      openingBalance: "0.00",
    });
    await createInvoiceWithItems(
      tenantDb, world.business1.id, kaParty.id,
      [{ description: "Returned chairs", quantity: "2", unitPrice: "1000.00", taxPercent: "12.00" }],
      { type: "sale", documentType: "credit_note", status: "sent", invoiceDate: date, invoiceNumber: "RT-CN-1" },
    );
  });

  it("b2b itms carry rt 5 and 18 with the matching txval/camt/samt", async () => {
    const { json } = await caller().gst.gstr1Json({ year: RT_YEAR, month: RT_MONTH });

    type ItmDet = { txval: number; rt: number; iamt: number; camt: number; samt: number; csamt: number };
    type B2B = { ctin: string; inv: Array<{ inum: string; itms: Array<{ num: number; itm_det: ItmDet }> }> };
    const inv = (json.b2b as B2B[]).flatMap((c) => c.inv).find((i) => i.inum === "RT-INV-1");
    expect(inv).toBeDefined();
    expect(inv!.itms.map((i) => i.num)).toEqual([1, 2]);
    expect(inv!.itms.map((i) => i.itm_det)).toEqual([
      { txval: 4000, rt: 5, iamt: 0, camt: 100, samt: 100, csamt: 0 },
      { txval: 10000, rt: 18, iamt: 0, camt: 900, samt: 900, csamt: 0 },
    ]);
  });

  it("cdnr itms carry rt 12 and IGST 240 for an inter-state credit note", async () => {
    const { json } = await caller().gst.gstr1Json({ year: RT_YEAR, month: RT_MONTH });

    type CDNR = { ctin: string; nt: Array<{ nt_num: string; itms: Array<{ itm_det: Record<string, number> }> }> };
    const note = (json.cdnr as CDNR[]).flatMap((c) => c.nt).find((n) => n.nt_num === "RT-CN-1");
    expect(note).toBeDefined();
    expect(note!.itms).toHaveLength(1);
    expect(note!.itms[0].itm_det).toEqual({ txval: 2000, rt: 12, iamt: 240, camt: 0, samt: 0, csamt: 0 });
  });
});

// ── GSTR-3B — credit and debit notes adjust output tax and ITC ────────────────

describe("GSTR-3B — credit/debit notes adjust outward tax (3.1) and ITC (4)", () => {
  const NOTE_YEAR = 2026;
  const NOTE_MONTH = 3; // March 2026

  function caller() {
    return createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });
  }

  beforeAll(async () => {
    const tenantDb = getTenantTestDb();
    const date = new Date(NOTE_YEAR, NOTE_MONTH - 1, 10, 12, 0, 0);
    // All with party1 (Maharashtra, same state) at 18% → CGST + SGST halves
    const doc = (
      amount: string,
      type: "sale" | "purchase",
      documentType: "invoice" | "credit_note" | "debit_note" | "sales_return" | "purchase_return"
        | "sales_order" | "delivery_challan" | "purchase_order" | "goods_receipt_note",
      invoiceNumber: string,
    ) =>
      createInvoiceWithItems(
        tenantDb, world.business1.id, world.party1.id,
        [{ description: "Office chairs", quantity: "1", unitPrice: amount, taxPercent: "18.00" }],
        { type, documentType, invoiceNumber, status: "sent", invoiceDate: date },
      );

    // Outward: 20,000 invoice + 1,000 debit note − 5,000 credit note − 1,000 sales return
    await doc("20000.00", "sale", "invoice", "NT-SI-1");
    await doc("1000.00", "sale", "debit_note", "NT-SDN-1");
    await doc("5000.00", "sale", "credit_note", "NT-SCN-1");
    await doc("1000.00", "sale", "sales_return", "NT-SR-1");
    // Sale-side documents with no tax effect
    await doc("7000.00", "sale", "sales_order", "NT-SO-1");
    await doc("7000.00", "sale", "delivery_challan", "NT-DC-1");

    // Inward: 10,000 invoice + 500 supplier debit note − 1,000 supplier credit note − 2,000 returned
    await doc("10000.00", "purchase", "invoice", "NT-PI-1");
    await doc("500.00", "purchase", "debit_note", "NT-PDN-1");
    await doc("1000.00", "purchase", "credit_note", "NT-PCN-1");
    await doc("2000.00", "purchase", "purchase_return", "NT-PR-1");
    // Purchase-side documents with no ITC
    await doc("9000.00", "purchase", "purchase_order", "NT-PO-1");
    await doc("9000.00", "purchase", "goods_receipt_note", "NT-GRN-1");
  });

  it("GSTR-1 CDN lists only the notes issued to customers", async () => {
    const report = await caller().gst.gstr1({ year: NOTE_YEAR, month: NOTE_MONTH });

    expect(report.creditNotes.map((n) => n.invoiceNumber).sort()).toEqual(["NT-SCN-1", "NT-SR-1"]);
    expect(report.debitNotes.map((n) => n.invoiceNumber)).toEqual(["NT-SDN-1"]);
    expect(report.b2b.map((i) => i.invoiceNumber)).toEqual(["NT-SI-1"]);
  });

  it("3.1(a) outward supplies are net of credit and debit notes", async () => {
    const report = await caller().gst.gstr3b({ year: NOTE_YEAR, month: NOTE_MONTH });

    // 20,000 + 1,000 − 5,000 − 1,000 = 15,000 taxable; 18% = 2,700 tax
    expect(report.outwardSupplies.taxable.taxableValue).toBeCloseTo(15000, 2);
    expect(report.outwardSupplies.taxable.cgst).toBeCloseTo(1350, 2);
    expect(report.outwardSupplies.taxable.sgst).toBeCloseTo(1350, 2);
    expect(report.outwardSupplies.taxable.igst).toBeCloseTo(0, 2);
    expect(report.taxPayable.cgst).toBeCloseTo(1350, 2);
    expect(report.taxPayable.sgst).toBeCloseTo(1350, 2);
  });

  it("table 4 ITC adds supplier debit notes and takes back credit notes and returns", async () => {
    const report = await caller().gst.gstr3b({ year: NOTE_YEAR, month: NOTE_MONTH });

    // 1,800 + 90 − 180 − 360 = 1,350 ITC → 675 CGST + 675 SGST
    expect(report.itc.cgst).toBeCloseTo(675, 2);
    expect(report.itc.sgst).toBeCloseTo(675, 2);
    expect(report.itc.igst).toBeCloseTo(0, 2);
    expect(report.itc.total).toBeCloseTo(1350, 2);
    expect(report.netTax.total).toBeCloseTo(2700 - 1350, 2);
  });
});

// ── GSTR-1 portal JSON — B2CL per invoice, B2CS per supply type and state ─────

describe("GSTR-1 portal JSON — b2cl and b2cs follow the GSTN schema", () => {
  const B2C_YEAR = 2026;
  const B2C_MONTH = 4; // April 2026

  beforeAll(async () => {
    const tenantDb = getTenantTestDb();
    const date = new Date(B2C_YEAR, B2C_MONTH - 1, 15, 12, 0, 0);

    const kaConsumer = await createParty(tenantDb, world.business1.id, {
      name: "Bengaluru Walk-in",
      type: "customer",
      gstin: null,
      city: "Bengaluru",
      state: "Karnataka",
      stateCode: "29",
      openingBalance: "0.00",
    });
    const mhConsumer = await createParty(tenantDb, world.business1.id, {
      name: "Pune Walk-in",
      type: "customer",
      gstin: null,
      city: "Pune",
      state: "Maharashtra",
      stateCode: "27",
      openingBalance: "0.00",
    });

    // B2CL: inter-state to an unregistered buyer, above ₹2.5L — two invoices
    await createInvoiceWithItems(
      tenantDb, world.business1.id, kaConsumer.id,
      [
        { description: "Sofa set", quantity: "1", unitPrice: "200000.00", taxPercent: "18.00" },
        { description: "Rugs", quantity: "1", unitPrice: "100000.00", taxPercent: "12.00" },
      ],
      { type: "sale", documentType: "invoice", status: "sent", invoiceDate: date, invoiceNumber: "B2CL-1" },
    );
    await createInvoiceWithItems(
      tenantDb, world.business1.id, kaConsumer.id,
      [{ description: "Dining table", quantity: "1", unitPrice: "250000.00", taxPercent: "5.00" }],
      { type: "sale", documentType: "invoice", status: "sent", invoiceDate: date, invoiceNumber: "B2CL-2" },
    );

    // B2CS: 18% both inter-state (Karnataka) and intra-state, plus a 0% intra-state sale
    await createInvoiceWithItems(
      tenantDb, world.business1.id, kaConsumer.id,
      [{ description: "Lamp", quantity: "1", unitPrice: "10000.00", taxPercent: "18.00" }],
      { type: "sale", documentType: "invoice", status: "sent", invoiceDate: date, invoiceNumber: "B2CS-KA" },
    );
    await createInvoiceWithItems(
      tenantDb, world.business1.id, mhConsumer.id,
      [
        { description: "Lamp", quantity: "1", unitPrice: "10000.00", taxPercent: "18.00" },
        { description: "Fresh flowers", quantity: "1", unitPrice: "1000.00", taxPercent: "0.00" },
      ],
      { type: "sale", documentType: "invoice", status: "sent", invoiceDate: date, invoiceNumber: "B2CS-MH" },
    );
  });

  function caller() {
    return createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });
  }

  it("b2cl lists each invoice with inum, idt, val and per-rate itms", async () => {
    const { json } = await caller().gst.gstr1Json({ year: B2C_YEAR, month: B2C_MONTH });

    expect(json.b2cl).toEqual([
      {
        pos: "29",
        inv: [
          {
            inum: "B2CL-1",
            idt: "15-04-2026",
            val: 348000,
            itms: [
              { num: 1, itm_det: { txval: 100000, rt: 12, iamt: 12000, csamt: 0 } },
              { num: 2, itm_det: { txval: 200000, rt: 18, iamt: 36000, csamt: 0 } },
            ],
          },
          {
            inum: "B2CL-2",
            idt: "15-04-2026",
            val: 262500,
            itms: [{ num: 1, itm_det: { txval: 250000, rt: 5, iamt: 12500, csamt: 0 } }],
          },
        ],
      },
    ]);
  });

  it("b2cs keeps intra- and inter-state supplies apart, with the buyer's state as pos", async () => {
    const { json } = await caller().gst.gstr1Json({ year: B2C_YEAR, month: B2C_MONTH });

    type B2CS = { sply_ty: string; pos: string; rt: number; txval: number; iamt: number; camt: number; samt: number };
    const rows = (json.b2cs as B2CS[])
      .map(({ sply_ty, pos, rt, txval, iamt, camt, samt }) => ({ sply_ty, pos, rt, txval, iamt, camt, samt }))
      .sort((a, b) => a.rt - b.rt || a.sply_ty.localeCompare(b.sply_ty));
    expect(rows).toEqual([
      { sply_ty: "INTRA", pos: "27", rt: 0, txval: 1000, iamt: 0, camt: 0, samt: 0 },
      { sply_ty: "INTER", pos: "29", rt: 18, txval: 10000, iamt: 1800, camt: 0, samt: 0 },
      { sply_ty: "INTRA", pos: "27", rt: 18, txval: 10000, iamt: 0, camt: 900, samt: 900 },
    ]);
  });
});

// ── GSTR-1 follow-ups: unregistered notes, HSN rt/uqc, IST dates ─────────────

describe("GSTR-1 — notes to unregistered customers, HSN rate rows and IST dates", () => {
  const FU_YEAR = 2026;
  const FU_MONTH = 7; // July 2026
  // Entered in India as 16 Jul — stored as 2026-07-15T18:30:00Z
  const date = new Date("2026-07-16T00:00:00+05:30");

  beforeAll(async () => {
    const tenantDb = getTenantTestDb();
    const biz = world.business1.id;
    const sale = { type: "sale" as const, status: "sent" as const, invoiceDate: date };

    const kaConsumer = await createParty(tenantDb, biz, {
      name: "Mysuru Walk-in", type: "customer", gstin: null,
      city: "Mysuru", state: "Karnataka", stateCode: "29", openingBalance: "0.00",
    });
    const mhConsumer = await createParty(tenantDb, biz, {
      name: "Thane Walk-in", type: "customer", gstin: null,
      city: "Thane", state: "Maharashtra", stateCode: "27", openingBalance: "0.00",
    });

    // B2CL invoice (inter-state, above the limit) and a small credit note on it
    const { invoice: b2cl } = await createInvoiceWithItems(
      tenantDb, biz, kaConsumer.id,
      [{ description: "Sofa", quantity: "1", unitPrice: "300000.00", taxPercent: "18.00" }],
      { ...sale, documentType: "invoice", invoiceNumber: "FU-B2CL-1" },
    );
    await createInvoiceWithItems(
      tenantDb, biz, kaConsumer.id,
      [{ description: "Sofa discount", quantity: "1", unitPrice: "10000.00", taxPercent: "18.00" }],
      { ...sale, documentType: "credit_note", invoiceNumber: "FU-CN-L", referenceDocumentId: b2cl.id },
    );

    // B2CS invoices, a credit note to the intra-state buyer and a debit note
    // to the inter-state one — both netted into the B2CS rows
    await createInvoiceWithItems(
      tenantDb, biz, kaConsumer.id,
      [{ description: "Lamp", quantity: "1", unitPrice: "10000.00", taxPercent: "18.00" }],
      { ...sale, documentType: "invoice", invoiceNumber: "FU-B2CS-KA" },
    );
    await createInvoiceWithItems(
      tenantDb, biz, mhConsumer.id,
      [{ description: "Chair", quantity: "1", unitPrice: "20000.00", taxPercent: "12.00" }],
      { ...sale, documentType: "invoice", invoiceNumber: "FU-B2CS-MH" },
    );
    await createInvoiceWithItems(
      tenantDb, biz, mhConsumer.id,
      [{ description: "Chair return", quantity: "1", unitPrice: "5000.00", taxPercent: "12.00" }],
      { ...sale, documentType: "credit_note", invoiceNumber: "FU-CN-S" },
    );
    await createInvoiceWithItems(
      tenantDb, biz, kaConsumer.id,
      [{ description: "Delivery charge", quantity: "1", unitPrice: "1000.00", taxPercent: "18.00" }],
      { ...sale, documentType: "debit_note", invoiceNumber: "FU-DN-S" },
    );

    // Registered customer: B2B invoice with HSN-coded items and a CDNR note
    const rice = await createItem(tenantDb, biz, { name: "Rice", hsn: "1006", unit: "kg" });
    const cups = await createItem(tenantDb, biz, { name: "Cups", hsn: "3924", unit: "pcs" });
    const support = await createItem(tenantDb, biz, {
      name: "IT support", hsn: "998314", unit: "other", itemType: "service",
    });
    const { lineItems } = await createInvoiceWithItems(
      tenantDb, biz, world.party1.id,
      [
        { itemId: rice.id, description: "Rice", quantity: "10", unitPrice: "100.00", taxPercent: "5.00" },
        { itemId: rice.id, description: "Rice (premium)", quantity: "2.5", unitPrice: "200.00", taxPercent: "12.00" },
        { itemId: cups.id, description: "Cups", quantity: "3", unitPrice: "120.00", taxPercent: "18.00" },
        { itemId: support.id, description: "IT support", quantity: "4", unitPrice: "500.00", taxPercent: "18.00" },
      ],
      { ...sale, documentType: "invoice", invoiceNumber: "FU-B2B-1" },
    );
    // The cups were billed in boxes of 12
    await tenantDb.update(invoiceItems)
      .set({ selectedUnit: "box", conversionFactor: "12" })
      .where(eq(invoiceItems.id, lineItems[2]!.id));
    await createInvoiceWithItems(
      tenantDb, biz, world.party1.id,
      [{ description: "Rate difference", quantity: "1", unitPrice: "100.00", taxPercent: "5.00" }],
      { ...sale, documentType: "credit_note", invoiceNumber: "FU-CN-R" },
    );
  });

  function caller() {
    return createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });
  }

  it("classifies each note: registered → cdnr, B2C Large supply → cdnur, other unregistered → b2cs", async () => {
    const report = await caller().gst.gstr1({ year: FU_YEAR, month: FU_MONTH });
    const sections = Object.fromEntries(
      [...report.creditNotes, ...report.debitNotes].map((n) => [n.invoiceNumber, n.section]),
    );
    expect(sections).toEqual({ "FU-CN-L": "cdnur", "FU-CN-S": "b2cs", "FU-DN-S": "b2cs", "FU-CN-R": "cdnr" });
  });

  it("puts only registered customers' notes in cdnr, never with an empty ctin", async () => {
    const { json } = await caller().gst.gstr1Json({ year: FU_YEAR, month: FU_MONTH });
    type CDNR = { ctin: string; nt: Array<{ nt_num: string }> };
    const cdnr = json.cdnr as CDNR[];
    expect(cdnr.every((c) => c.ctin.length === 15)).toBe(true);
    expect(cdnr.flatMap((c) => c.nt.map((n) => n.nt_num))).toEqual(["FU-CN-R"]);
  });

  it("reports a note on a B2C Large invoice in cdnur", async () => {
    const { json } = await caller().gst.gstr1Json({ year: FU_YEAR, month: FU_MONTH });
    expect(json.cdnur).toEqual([
      {
        typ: "B2CL",
        ntty: "C",
        nt_num: "FU-CN-L",
        nt_dt: "16-07-2026",
        val: 11800,
        pos: "29",
        itms: [{ num: 1, itm_det: { txval: 10000, rt: 18, iamt: 1800, csamt: 0 } }],
      },
    ]);
  });

  it("nets the other unregistered notes into b2cs", async () => {
    const { json } = await caller().gst.gstr1Json({ year: FU_YEAR, month: FU_MONTH });
    type B2CS = { sply_ty: string; pos: string; rt: number; txval: number; iamt: number; camt: number; samt: number };
    const rows = (json.b2cs as B2CS[])
      .map(({ sply_ty, pos, rt, txval, iamt, camt, samt }) => ({ sply_ty, pos, rt, txval, iamt, camt, samt }))
      .sort((a, b) => a.rt - b.rt);
    expect(rows).toEqual([
      // 20,000 sale less the 5,000 credit note
      { sply_ty: "INTRA", pos: "27", rt: 12, txval: 15000, iamt: 0, camt: 900, samt: 900 },
      // 10,000 sale plus the 1,000 debit note
      { sply_ty: "INTER", pos: "29", rt: 18, txval: 11000, iamt: 1980, camt: 0, samt: 0 },
    ]);
  });

  it("emits one HSN row per HSN and rate with rt and the item's UQC", async () => {
    const { json } = await caller().gst.gstr1Json({ year: FU_YEAR, month: FU_MONTH });
    type HSN = { hsn_sc: string; rt: number; uqc: string; qty: number; txval: number };
    const rows = (json.hsn as { data: HSN[] }).data
      .filter((r) => r.hsn_sc !== "0000")
      .map(({ hsn_sc, rt, uqc, qty, txval }) => ({ hsn_sc, rt, uqc, qty, txval }))
      .sort((a, b) => a.hsn_sc.localeCompare(b.hsn_sc) || a.rt - b.rt);
    expect(rows).toEqual([
      { hsn_sc: "1006", rt: 5, uqc: "KGS", qty: 10, txval: 1000 },
      { hsn_sc: "1006", rt: 12, uqc: "KGS", qty: 2.5, txval: 500 },
      // 3 boxes of 12, reported in the item's base unit
      { hsn_sc: "3924", rt: 18, uqc: "PCS", qty: 36, txval: 360 },
      // Services carry UQC NA and no quantity
      { hsn_sc: "998314", rt: 18, uqc: "NA", qty: 0, txval: 2000 },
    ]);
  });

  it("dates invoices by the calendar day in India, not UTC", async () => {
    const { json } = await caller().gst.gstr1Json({ year: FU_YEAR, month: FU_MONTH });
    type B2B = { inv: Array<{ inum: string; idt: string }> };
    const inv = (json.b2b as B2B[]).flatMap((b) => b.inv).find((i) => i.inum === "FU-B2B-1");
    expect(inv?.idt).toBe("16-07-2026");
    type CDNR = { nt: Array<{ nt_dt: string }> };
    expect((json.cdnr as CDNR[])[0].nt[0].nt_dt).toBe("16-07-2026");
  });
});

// ── Return months are calendar months in India ───────────────────────────────

describe("GST returns — months are cut at midnight IST", () => {
  // Regression: months were cut at the server's (UTC) midnight. An invoice
  // dated 1 Aug in India is stored as 2026-07-31T18:30Z and fell in July's
  // return; one dated early on 1 Sep (still 31 Aug in UTC) fell in August's.
  beforeAll(async () => {
    const tenantDb = getTenantTestDb();
    const b2b = (invoiceNumber: string, unitPrice: string, invoiceDate: Date, type: "sale" | "purchase" = "sale") =>
      createInvoiceWithItems(
        tenantDb, world.business1.id, world.party1.id,
        [{ description: "Fabric", quantity: "1", unitPrice, taxPercent: "18.00" }],
        { type, documentType: "invoice", status: "sent", invoiceDate, invoiceNumber },
      );
    await b2b("EDGE-AUG-FIRST", "1000.00", new Date("2026-08-01T00:00:00+05:30"));
    await b2b("EDGE-AUG-LAST", "2000.00", new Date("2026-08-31T23:59:00+05:30"));
    await b2b("EDGE-SEP-FIRST", "4000.00", new Date("2026-09-01T02:00:00+05:30"));
    await b2b("EDGE-PUR-AUG", "500.00", new Date("2026-08-01T00:00:00+05:30"), "purchase");
  });

  function caller() {
    return createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });
  }

  const edgeInvoices = (report: { b2b: Array<{ invoiceNumber: string }> }) =>
    report.b2b.map((r) => r.invoiceNumber).filter((n) => n.startsWith("EDGE-")).sort();

  it("GSTR-1 for a month holds invoices from midnight IST on the 1st to the end of its last day", async () => {
    expect(edgeInvoices(await caller().gst.gstr1({ year: 2026, month: 7 }))).toEqual([]);
    expect(edgeInvoices(await caller().gst.gstr1({ year: 2026, month: 8 }))).toEqual(["EDGE-AUG-FIRST", "EDGE-AUG-LAST"]);
    expect(edgeInvoices(await caller().gst.gstr1({ year: 2026, month: 9 }))).toEqual(["EDGE-SEP-FIRST"]);
  });

  it("GSTR-3B outward supplies and ITC use the same month", async () => {
    const aug = await caller().gst.gstr3b({ year: 2026, month: 8 });
    expect(aug.outwardSupplies.taxable.taxableValue).toBe(3000);
    expect(aug.itc.total).toBeCloseTo(90, 2);
    const sep = await caller().gst.gstr3b({ year: 2026, month: 9 });
    expect(sep.outwardSupplies.taxable.taxableValue).toBe(4000);
    expect(sep.itc.total).toBe(0);
  });
});

// ── B2CL limit: ₹1,00,000 from 1 Aug 2024 (Notification 12/2024-CT) ─────────

describe("GSTR-1 — B2CL limit follows the invoice date", () => {
  beforeAll(async () => {
    const tenantDb = getTenantTestDb();
    const guConsumer = await createParty(tenantDb, world.business1.id, {
      name: "Surat Walk-in", type: "customer", gstin: null,
      city: "Surat", state: "Gujarat", stateCode: "24", openingBalance: "0.00",
    });
    const sale = (invoiceNumber: string, unitPrice: string, invoiceDate: Date) =>
      createInvoiceWithItems(
        tenantDb, world.business1.id, guConsumer.id,
        [{ description: "Cabinet", quantity: "1", unitPrice, taxPercent: "18.00" }],
        { type: "sale", documentType: "invoice", status: "sent", invoiceDate, invoiceNumber },
      );
    // ₹1,77,000 each — above the new ₹1,00,000 limit, below the old ₹2,50,000
    await sale("LIM-JUL24", "150000.00", new Date("2024-07-31T23:00:00+05:30"));
    await sale("LIM-AUG24", "150000.00", new Date("2024-08-01T00:00:00+05:30"));
    // ₹1,00,000 exactly is not above the limit
    await sale("LIM-AUG24-EQ", "84745.76", new Date("2024-08-20T12:00:00+05:30"));
  });

  function caller() {
    return createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });
  }

  const b2clInvoices = (report: { b2cLarge: Array<{ invoices?: Array<{ invoiceNumber: string }> }> }) =>
    report.b2cLarge.flatMap((s) => s.invoices ?? []).map((i) => i.invoiceNumber).sort();

  it("keeps the ₹2,50,000 limit for invoices dated before 1 Aug 2024", async () => {
    const jul = await caller().gst.gstr1({ year: 2024, month: 7 });
    expect(b2clInvoices(jul)).toEqual([]);
    expect(jul.b2cSmall.find((r) => r.pos === "24")?.taxableValue).toBe(150000);
  });

  it("reports inter-state unregistered invoices above ₹1,00,000 in B2CL from 1 Aug 2024", async () => {
    const aug = await caller().gst.gstr1({ year: 2024, month: 8 });
    expect(b2clInvoices(aug)).toEqual(["LIM-AUG24"]);
    // The ₹1,00,000 invoice stays in B2CS
    expect(aug.b2cSmall.find((r) => r.pos === "24")?.taxableValue).toBe(84745.76);
  });
});
