/**
 * Document totals are the same whichever path writes them (invoice.create,
 * invoice.update, the document-router factory), and GSTR-1 reads periods,
 * places of supply and B2CL the way the rules say.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { invoices } from "@fintranzact/db";
import { calcInvoiceTotals } from "@fintranzact/shared";
import { getTenantTestDb, truncateAllTables } from "../helpers/test-db.js";
import { createTestWorld, createParty, createInvoiceWithItems, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { generateGSTR1, generateGSTR3B } from "../../lib/gst-reports.js";

let world: TestWorld;

function caller() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

const LINES = [
  { itemName: "A", quantity: "3", unitPrice: "333.33", taxPercent: "18", discountPercent: "7.5" },
  { itemName: "B", quantity: "1.5", unitPrice: "10.03", taxPercent: "5", discountPercent: "0" },
  { itemName: "C", quantity: "2", unitPrice: "999.99", taxPercent: "28", discountPercent: "12.25" },
];
const EXTRAS = {
  charges: [{ label: "Packing", amount: "45.50" }, { label: "Insurance", amount: "12.25" }],
  invoiceDiscount: "5",
  invoiceDiscountType: "percent" as const,
  roundOff: "-0.37",
};
const TOTAL_FIELDS = ["subtotal", "taxAmount", "discountAmount", "additionalCharges", "roundOff", "totalAmount"] as const;

function pick(row: Record<string, unknown>) {
  return Object.fromEntries(TOTAL_FIELDS.map((f) => [f, Number(row[f])]));
}

beforeAll(async () => {
  world = await createTestWorld();
});

afterAll(async () => {
  await truncateAllTables();
});

describe("totals parity: invoice.create = invoice.update = document factory create", () => {
  const expected = calcInvoiceTotals({ lineItems: LINES, charges: EXTRAS.charges, invoiceDiscount: "5", invoiceDiscountType: "percent", roundOff: "-0.37" });
  const expectedRow = {
    subtotal: Number(expected.subtotal),
    taxAmount: Number(expected.taxTotal),
    discountAmount: Number(expected.invoiceDiscountAmount),
    additionalCharges: Number(expected.chargesTotal),
    roundOff: -0.37,
    totalAmount: Number(expected.total),
  };

  it("invoice.create stores the shared calculation", async () => {
    const inv = await caller().invoice.create({ partyId: world.party1.id, type: "sale", ...EXTRAS, lineItems: LINES } as never);
    expect(pick(inv)).toEqual(expectedRow);
  });

  it("invoice.update with the same inputs lands on the same totals", async () => {
    const inv = await caller().invoice.create({
      partyId: world.party1.id, type: "sale",
      lineItems: [{ itemName: "X", quantity: "1", unitPrice: "1", taxPercent: "0", discountPercent: "0" }],
    } as never);
    const updated = await caller().invoice.update({ id: inv.id, ...EXTRAS, lineItems: LINES } as never);
    expect(pick(updated)).toEqual(expectedRow);
  });

  it.each(["quotation", "proforma", "deliveryChallan", "salesOrder"] as const)("%s.create lands on the same totals", async (router) => {
    const doc = await (caller() as never as Record<string, { create: (i: unknown) => Promise<Record<string, unknown>> }>)[router]!.create({
      partyId: world.party1.id, type: "sale", ...EXTRAS, lineItems: LINES,
    });
    expect(pick(doc)).toEqual(expectedRow);
  });

  it("updating only the round-off keeps the rest of the total", async () => {
    const inv = await caller().invoice.create({ partyId: world.party1.id, type: "sale", ...EXTRAS, lineItems: LINES } as never);
    const updated = await caller().invoice.update({ id: inv.id, roundOff: "0.13" });
    expect(Number(updated.totalAmount)).toBeCloseTo(expectedRow.totalAmount + 0.37 + 0.13, 2);
  });

  it("a stored percent discount is re-read as an amount when only the lines change — documents current behaviour", async () => {
    const inv = await caller().invoice.create({ partyId: world.party1.id, type: "sale", ...EXTRAS, lineItems: LINES } as never);
    const updated = await caller().invoice.update({ id: inv.id, lineItems: [LINES[0]!] } as never);
    // The 5% was saved as its amount; it is not re-taken on the new subtotal.
    expect(Number(updated.discountAmount)).toBe(expectedRow.discountAmount);
  });
});

describe("flat additionalCharges (no itemised charges) count in the total", () => {
  const lines = [{ itemName: "Flat", quantity: "2", unitPrice: "100", taxPercent: "18", discountPercent: "0" }];

  it("invoice.create adds them (regression: stored but left out of totalAmount)", async () => {
    const inv = await caller().invoice.create({ partyId: world.party1.id, type: "sale", additionalCharges: "50", lineItems: lines } as never);
    expect(Number(inv.additionalCharges)).toBe(50);
    expect(Number(inv.totalAmount)).toBe(286); // 200 + 36 + 50
  });

  it("the document factory adds them", async () => {
    const q = await caller().quotation.create({ partyId: world.party1.id, type: "sale", additionalCharges: "50", lineItems: lines } as never);
    expect(Number(q.totalAmount)).toBe(286);
  });

  it("invoice.update keeps counting them when the charges are not touched", async () => {
    const inv = await caller().invoice.create({ partyId: world.party1.id, type: "sale", additionalCharges: "50", lineItems: lines } as never);
    const updated = await caller().invoice.update({ id: inv.id, roundOff: "-0.50" });
    expect(Number(updated.totalAmount)).toBe(285.5);
  });

  it("itemised charges win over a flat amount", async () => {
    const inv = await caller().invoice.create({
      partyId: world.party1.id, type: "sale", additionalCharges: "50",
      charges: [{ label: "Freight", amount: "20" }], lineItems: lines,
    } as never);
    expect(Number(inv.additionalCharges)).toBe(20);
    expect(Number(inv.totalAmount)).toBe(256);
  });
});

describe("GSTR-1 rules", () => {
  // Business1 is in Maharashtra (27).
  async function saleOn(date: Date, partyId: string, amount = "1000.00", tax = "18") {
    const { invoice } = await createInvoiceWithItems(
      getTenantTestDb(), world.business1.id, partyId,
      [{ quantity: "1", unitPrice: amount, taxPercent: tax }],
      { invoiceDate: date, status: "sent", stockMode: "none" },
    );
    return invoice;
  }

  it("an invoice dated 1 April in India (18:30 UTC on 31 March) is in April's return, not March's", async () => {
    const inv = await saleOn(new Date("2025-03-31T18:30:00.000Z"), world.party1.id);
    const last = await saleOn(new Date("2025-03-31T18:29:59.999Z"), world.party1.id);
    const apr = await generateGSTR1(world.business1.id, 2025, 4, getTenantTestDb() as never);
    const mar = await generateGSTR1(world.business1.id, 2025, 3, getTenantTestDb() as never);
    expect(apr.b2b.map((b) => b.invoiceNumber)).toContain(inv.invoiceNumber);
    expect(mar.b2b.map((b) => b.invoiceNumber)).not.toContain(inv.invoiceNumber);
    expect(mar.b2b.map((b) => b.invoiceNumber)).toContain(last.invoiceNumber);
    expect(apr.b2b.map((b) => b.invoiceNumber)).not.toContain(last.invoiceNumber);
  });

  it("a registered buyer with no state on record is placed by its GSTIN prefix (regression: counted inter-state)", async () => {
    const local = await createParty(getTenantTestDb(), world.business1.id, {
      name: "MH Buyer", gstin: "27AABCK1111R1ZP", stateCode: null, state: null,
    });
    const karnataka = await createParty(getTenantTestDb(), world.business1.id, {
      name: "KA Buyer", gstin: "29AABCK1111R1ZP", stateCode: null, state: null,
    });
    const intra = await saleOn(new Date("2025-05-10T06:30:00.000Z"), local.id);
    const inter = await saleOn(new Date("2025-05-11T06:30:00.000Z"), karnataka.id);
    const r = await generateGSTR1(world.business1.id, 2025, 5, getTenantTestDb() as never);
    expect(r.b2b.find((b) => b.invoiceNumber === intra.invoiceNumber)).toMatchObject({ cgst: 90, sgst: 90, igst: 0 });
    expect(r.b2b.find((b) => b.invoiceNumber === inter.invoiceNumber)).toMatchObject({ cgst: 0, sgst: 0, igst: 180 });
  });

  it("B2CL from Aug 2024 is inter-state unregistered above ₹1L; ₹1L or less is B2CS", async () => {
    const gujarat = await createParty(getTenantTestDb(), world.business1.id, {
      name: "GJ Walk-in", gstin: null, stateCode: "24", state: "Gujarat",
    });
    const large = await saleOn(new Date("2025-06-10T06:30:00.000Z"), gujarat.id, "90000.00"); // 1,06,200 with tax
    const small = await saleOn(new Date("2025-06-11T06:30:00.000Z"), gujarat.id, "84745.76"); // 99,999.99 with tax
    const r = await generateGSTR1(world.business1.id, 2025, 6, getTenantTestDb() as never);
    const b2clNumbers = r.b2cLarge.flatMap((s) => s.invoices?.map((i) => i.invoiceNumber) ?? []);
    expect(b2clNumbers).toContain(large.invoiceNumber);
    expect(b2clNumbers).not.toContain(small.invoiceNumber);
    expect(r.b2cSmall.some((s) => s.supplyType === "INTER" && s.pos === "24")).toBe(true);
  });

  it("an unregistered buyer with no state at all is reported inter-state — documents current behaviour", async () => {
    const walkIn = await createParty(getTenantTestDb(), world.business1.id, {
      name: "Walk-in", gstin: null, stateCode: null, state: null,
    });
    await saleOn(new Date("2025-07-10T06:30:00.000Z"), walkIn.id, "100.00");
    const r = await generateGSTR1(world.business1.id, 2025, 7, getTenantTestDb() as never);
    expect(r.b2cSmall).toEqual([expect.objectContaining({ supplyType: "INTER", igst: 18, cgst: 0 })]);
  });

  it("GSTR-3B puts 0% (nil/exempt) lines in 3.1(c), not 3.1(a) (regression: 3.1(c) was always zero)", async () => {
    const walkIn = await createParty(getTenantTestDb(), world.business1.id, {
      name: "Local walk-in", gstin: null, stateCode: "27", state: "Maharashtra",
    });
    await createInvoiceWithItems(
      getTenantTestDb(), world.business1.id, world.party1.id,
      [{ quantity: "1", unitPrice: "1000.00", taxPercent: "18" }, { quantity: "2", unitPrice: "250.00", taxPercent: "0" }],
      { invoiceDate: new Date("2025-09-10T06:30:00.000Z"), status: "sent", stockMode: "none" },
    );
    await createInvoiceWithItems(
      getTenantTestDb(), world.business1.id, walkIn.id,
      [{ quantity: "1", unitPrice: "300.00", taxPercent: "0" }],
      { invoiceDate: new Date("2025-09-11T06:30:00.000Z"), status: "sent", stockMode: "none" },
    );
    const r = await generateGSTR3B(world.business1.id, 2025, 9, getTenantTestDb() as never);
    expect(r.outwardSupplies.exempt.taxableValue).toBe(800);
    expect(r.outwardSupplies.taxable.taxableValue).toBe(1000);
    expect(r.outwardSupplies.taxable.cgst + r.outwardSupplies.taxable.sgst).toBe(180);
  });

  it("cancelled and deleted invoices are left out", async () => {
    const c = await saleOn(new Date("2025-08-10T06:30:00.000Z"), world.party1.id);
    const d = await saleOn(new Date("2025-08-11T06:30:00.000Z"), world.party1.id);
    const kept = await saleOn(new Date("2025-08-12T06:30:00.000Z"), world.party1.id);
    await getTenantTestDb().update(invoices).set({ status: "cancelled" }).where(eq(invoices.id, c.id));
    await getTenantTestDb().update(invoices).set({ deletedAt: new Date() }).where(eq(invoices.id, d.id));
    const r = await generateGSTR1(world.business1.id, 2025, 8, getTenantTestDb() as never);
    expect(r.b2b.map((b) => b.invoiceNumber)).toEqual([kept.invoiceNumber]);
  });
});
