/**
 * Business access for the non-tRPC endpoints (label sheets, invoice and
 * ledger PDFs, business images) and the barcode values those labels print.
 *
 * verifyBusinessAccess must enforce the same rule as the hasBusinessAccess
 * tRPC middleware: being in the tenant is not enough, the caller has to be a
 * member of the business itself.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getTenantDb, itemVariants } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables } from "../helpers/test-db.js";
import { addMember, createTestWorld, createUser, type TestUser, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { backfillLegacyBusinessMembers, verifyBusinessAccess } from "../../lib/business-membership.js";
import { LABEL_SIZES, resolveCodes } from "../../lib/barcode-setup.js";
import { LABEL_PRESETS, TYPE_PRESET } from "../../lib/label-pdf.js";

let world: TestWorld;
let outsider: TestUser;

beforeAll(async () => {
  world = await createTestWorld();
  // Give business1 its members (everyone in tenant1 so far), as first access would.
  await backfillLegacyBusinessMembers(await getTenantDb(world.tenant1.id), world.tenant1.id);
  // Joined the tenant afterwards and was never assigned to business1.
  outsider = await createUser({ email: "new.cashier@acmetrading.in", name: "New Cashier" });
  await addMember(world.tenant1.id, outsider.id, "seller");
});

afterAll(async () => {
  await truncateAllTables();
});

describe("verifyBusinessAccess (label / PDF endpoints)", () => {
  it("lets a business member in", async () => {
    const res = await verifyBusinessAccess(await getTenantDb(world.tenant1.id), world.business1.id, world.tenant1.id, world.suresh.id);
    expect(res.ok).toBe(true);
  });

  it("refuses a tenant member who is not a member of the business", async () => {
    const res = await verifyBusinessAccess(await getTenantDb(world.tenant1.id), world.business1.id, world.tenant1.id, outsider.id);
    expect(res).toEqual({ ok: false, error: "You do not have access to this business" });
  });

  it("refuses a business from another tenant", async () => {
    const res = await verifyBusinessAccess(await getTenantDb(world.tenant1.id), world.business2.id, world.tenant1.id, world.ramesh.id);
    expect(res.ok).toBe(false);
  });

  it("matches what tRPC says for the same caller", async () => {
    const caller = createTestCaller({
      userId: outsider.id,
      email: outsider.email,
      name: outsider.name ?? null,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });
    await expect(caller.barcode.setup()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("barcode values are stored the way labels and scans read them", () => {
  const owner = () =>
    createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name ?? null,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

  it("trims variant barcodes on create, add and bulk add, so a scan of the printed code finds them", async () => {
    const caller = owner();
    const item = await caller.item.create({
      name: "Tee",
      itemMode: "variants",
      variantAttributes: ["size"],
      variants: [{ attributeValues: { size: "S" }, barcode: "  TEE-S  ", stockQuantity: "0" }],
    });
    await caller.item.createVariant({
      itemId: item.id,
      variant: { attributeValues: { size: "M" }, barcode: " TEE-M", stockQuantity: "0" },
    });
    await caller.item.bulkCreateVariants({
      itemId: item.id,
      variants: [{ attributeValues: { size: "L" }, barcode: "TEE-L ", stockQuantity: "0" }],
    });

    const rows = await getTenantTestDb()
      .select({ barcode: itemVariants.barcode })
      .from(itemVariants)
      .where(eq(itemVariants.itemId, item.id));
    expect(rows.map((r) => r.barcode).sort()).toEqual(["TEE-L", "TEE-M", "TEE-S"]);

    const hits = await resolveCodes(await getTenantDb(world.tenant1.id), world.business1.id, ["TEE-S", "TEE-M", "TEE-L"], "single");
    expect(hits.size).toBe(3);

    // The trimmed value is now seen by the duplicate check.
    await expect(
      caller.item.createVariant({
        itemId: item.id,
        variant: { attributeValues: { size: "XL" }, barcode: "TEE-S", stockQuantity: "0" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("clears an item's barcode when the edit form sends an empty value", async () => {
    const caller = owner();
    const item = await caller.item.create({ name: "Hose clamp", barcode: "HC12-0004" });
    const updated = await caller.item.update({ id: item.id, data: { name: "Hose clamp", barcode: "" } });
    expect(updated.barcode).toBeNull();
  });
});

describe("label sizes", () => {
  it("each barcode type's fixed label matches the preset the PDF is drawn on", () => {
    const MM = 72 / 25.4;
    for (const type of Object.keys(LABEL_SIZES) as Array<keyof typeof LABEL_SIZES>) {
      const size = LABEL_SIZES[type];
      const preset = LABEL_PRESETS[TYPE_PRESET[type]]!;
      expect(preset.labelWidth / MM).toBeCloseTo(size.width, 5);
      expect(preset.labelHeight / MM).toBeCloseTo(size.height, 5);
      expect(preset.columns).toBe(size.across);
    }
  });
});
