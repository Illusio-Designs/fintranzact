/**
 * Supplier GST / MSME / TDS details, extra shipping addresses, GSTIN lookup
 * fallback and the MSME payables report.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import {
  createUser,
  createTenant,
  addMember,
  createBusiness,
  createInvoiceWithItems,
  type TestUser,
  type TestTenant,
  type TestBusiness,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { partyComplianceWarnings } from "@fintranzact/shared";

let owner: TestUser;
let tenant: TestTenant;
let business: TestBusiness;
let caller: ReturnType<typeof createTestCaller>;

// Maharashtra (27) GSTIN whose embedded PAN is AABCU9603R.
const GSTIN = "27AABCU9603R1ZM";

beforeAll(async () => {
  owner = await createUser({ email: "owner.compliance@acmetrading.in", name: "Meera Owner" });
  tenant = await createTenant({ name: "Compliance Org" });
  await addMember(tenant.id, owner.id, "owner");
  business = await createBusiness(getTenantTestDb(), owner.id, { name: "Compliance Traders" });
  caller = createTestCaller({
    userId: owner.id,
    email: owner.email,
    name: owner.name ?? null,
    tenantId: tenant.id,
    businessId: business.id,
  });
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("party GST / MSME / TDS fields", () => {
  it("saves the new fields and fills PAN and state code from the GSTIN", async () => {
    const party = await caller.party.create({
      type: "supplier",
      name: "Udaan Steel",
      gstin: GSTIN,
      legalName: "Udaan Steel Private Limited",
      tradeName: "Udaan Steel",
      gstRegistrationType: "regular",
      constitution: "private_company",
      isMsme: true,
      udyamNumber: "UDYAM-MH-26-0012345",
      msmeCategory: "micro",
      tdsSection: "194Q",
      bankIfsc: "HDFC0001234",
      shippingAddress: "Plot 4, MIDC Bhosari",
      additionalShippingAddresses: [
        { label: "Chakan godown", address: "Gat 12, Chakan", city: "Pune", stateCode: "27", pincode: "410501" },
      ],
    });

    expect(party.pan).toBe("AABCU9603R");
    expect(party.stateCode).toBe("27");
    expect(party.legalName).toBe("Udaan Steel Private Limited");
    expect(party.isMsme).toBe(true);
    expect(party.tdsSection).toBe("194Q");
    expect(party.additionalShippingAddresses).toEqual([
      { label: "Chakan godown", address: "Gat 12, Chakan", city: "Pune", stateCode: "27", pincode: "410501" },
    ]);
  });

  it("saves a PAN or state that contradicts the GSTIN, and flags it", async () => {
    const party = await caller.party.create({
      type: "supplier", name: "Mismatched Supplier", gstin: GSTIN, pan: "ABCDE1234F", stateCode: "29",
    });
    expect(party.pan).toBe("ABCDE1234F");
    expect(party.stateCode).toBe("29");
    expect(partyComplianceWarnings(party).join(" ")).toMatch(/PAN ABCDE1234F doesn't match.*State code 29 doesn't match/);
  });

  it("rejects badly formatted IFSC and Udyam numbers", async () => {
    await expect(caller.party.create({ type: "supplier", name: "Bad IFSC", bankIfsc: "HDFC1234" }))
      .rejects.toThrow(/IFSC/);
    await expect(caller.party.create({ type: "supplier", name: "Bad Udyam", udyamNumber: "UDYAM-12345" }))
      .rejects.toThrow(/Udyam/);
  });

  it("forgets the verification of an old GSTIN when the GSTIN changes", async () => {
    const party = await caller.party.create({
      type: "supplier", name: "Verified Supplier", gstin: GSTIN,
      gstinStatus: "active", gstinVerifiedAt: new Date().toISOString(),
    });
    expect(party.gstinStatus).toBe("active");

    const sameGstin = await caller.party.update({ id: party.id, data: { gstin: GSTIN, name: "Verified Supplier Pvt" } });
    expect(sameGstin.gstinStatus).toBe("active");

    const moved = await caller.party.update({ id: party.id, data: { gstin: "29AABCU9603R1ZJ", stateCode: "29" } });
    expect(moved.gstin).toBe("29AABCU9603R1ZJ");
    expect(moved.gstinStatus).toBeNull();
    expect(moved.gstinVerifiedAt).toBeNull();
  });
});

describe("party.lookupGstin", () => {
  it("returns derived details and a reason when e-invoicing is not set up", async () => {
    const result = await caller.party.lookupGstin({ gstin: GSTIN.toLowerCase() });
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.derived).toEqual({
      gstin: GSTIN,
      pan: "AABCU9603R",
      stateCode: "27",
      constitution: "private_company",
    });
    expect(result.reason).toMatch(/e-invoice/i);
  });
});

describe("reports.msmePayables", () => {
  it("lists unpaid bills from micro/small suppliers with their pay-by date", async () => {
    const db = getTenantTestDb();
    const micro = await caller.party.create({
      type: "supplier", name: "Micro Castings", isMsme: true, msmeCategory: "micro",
      udyamNumber: "UDYAM-MH-26-0000001", creditPeriodDays: 60,
    });
    const medium = await caller.party.create({
      type: "supplier", name: "Medium Forgings", isMsme: true, msmeCategory: "medium",
      udyamNumber: "UDYAM-MH-26-0000002",
    });

    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
    const fiftyDaysAgo = new Date(Date.now() - 50 * 86_400_000);
    for (const [partyId, date] of [[micro.id, tenDaysAgo], [micro.id, fiftyDaysAgo], [medium.id, tenDaysAgo]] as const) {
      await createInvoiceWithItems(db, business.id, partyId, [{ itemName: "Castings", quantity: "1", unitPrice: "1000.00" }], {
        type: "purchase", status: "sent", invoiceDate: date,
      });
    }

    const report = await caller.reports.msmePayables();
    expect(report.bills.map((b) => b.partyName)).toEqual(["Micro Castings", "Micro Castings"]);
    // A 60-day credit period is capped at 45 days.
    expect(report.bills.every((b) => b.limitDays === 45)).toBe(true);
    expect(report.bills.map((b) => b.daysLeft)).toEqual([-5, 35]);
    expect(report.overdueCount).toBe(1);
    expect(report.totalOutstanding).toBe("2000.00");
    expect(report.overdueOutstanding).toBe("1000.00");
  });
});
