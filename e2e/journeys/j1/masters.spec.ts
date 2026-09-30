/**
 * J3 — Masters: the parties and items a business keeps, set up in the UI.
 *
 *   Parties: a GST-registered customer in another state (GSTIN fills PAN and
 *   state; "Fetch details" without e-invoicing set up only derives them — no
 *   GST portal call), with billing + default shipping + two extra shipping
 *   addresses, credit period/limit and an opening balance; a supplier; a
 *   duplicate of the customer that already has an invoice and a recurring
 *   invoice, merged into the original; editing the customer; and the delete
 *   rules (a party with transactions is refused, one without is deleted).
 *
 *   Items: a simple product with HSN, SKU, barcode and a stock group; a
 *   variant product (size × colour); a product sold in alternate units; a
 *   batch-tracked product with expiry and opening stock; a service; a price
 *   level with a special rate for one item assigned to a customer; editing an
 *   item; and the delete rules.
 *
 * The invoice and recurring invoice on the duplicate party are seeded through
 * the API (other journeys own invoicing).
 */
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  expectNoHorizontalScroll,
  expectTheme,
  navTo,
  toast,
  uid,
} from "../../helpers/journey";
import { seedOwner, type SeededOwner } from "../../helpers/journey-seed";
import { invoicePartyIds, partiesNamed, recurringTemplatesOf } from "../../helpers/db";

async function openBusiness(page: Page, owner: SeededOwner) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Choose a company" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: `Open ${owner.businessName}` }).click();
  await expect(page.getByTestId("app-sidebar")).toBeAttached({ timeout: 20_000 });
}

async function openPartiesPage(page: Page) {
  await navTo(page, "Parties");
  await expect(page.getByRole("heading", { name: "Parties", level: 1 })).toBeVisible();
  await expectNoHorizontalScroll(page, "parties");
}

/** The parties list filtered by the header search box. */
async function findParty(page: Page, name: string) {
  await page.getByRole("searchbox", { name: "Search by name…" }).fill(name);
  const row = page.getByRole("row").filter({ hasText: name });
  return row;
}

/** The saved party, once the save has landed (toasts from earlier saves linger). */
async function savedParty(businessId: string, name: string) {
  await expect.poll(async () => (await partiesNamed(businessId, name)).length, { message: `party ${name} saved` }).toBe(1);
  return (await partiesNamed(businessId, name))[0];
}

/** Choose `label` in one of the app's dropdowns (a combobox with a listbox). */
async function pickOption(page: Page, combobox: ReturnType<Page["getByRole"]>, label: string) {
  await combobox.click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await expect(combobox).toContainText(label);
}

/** Expand a collapsed section of the party / item form. */
async function openSection(panel: ReturnType<Page["getByRole"]>, label: string) {
  const toggle = panel.getByRole("button", { name: new RegExp(`^${label}`) });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}

test.describe("J3 masters", () => {
  test.setTimeout(300_000);

  test("customers & suppliers: GSTIN, addresses, credit terms, opening balance, merge, edit, delete rules", async ({
    context,
    page,
    guard,
  }) => {
    const owner = await seedOwner(context, "j3");
    const id = uid();
    const customer = `Tumkur Traders ${id}`;
    const duplicate = `Tumkur Traders Dup ${id}`;
    const supplier = `Pune Metals ${id}`;

    await openBusiness(page, owner);
    await expectTheme(page, "light");
    await openPartiesPage(page);

    // ── Customer with a GSTIN from another state ────────────────
    await page.getByRole("button", { name: /Add Party/ }).first().click();
    let panel = page.getByRole("dialog", { name: "Add Party" });
    await expect(panel).toBeVisible();
    await panel.getByLabel(/^Party Name/).fill(customer);
    await panel.getByLabel("Phone").fill("9845012345");
    await panel.getByLabel("Email").fill(`accounts-${id}@tumkur.example`);
    await panel.getByLabel("Opening Balance").fill("5000");
    await panel.getByLabel("GSTIN").fill("29AABCT1332L1ZT");
    await expect(panel.getByText("PAN detected: AABCT1332L")).toBeVisible();
    // No e-invoice login configured: the lookup only derives what the GSTIN
    // itself says, and tells the user so. Nothing is sent to the GST portal.
    await panel.getByRole("button", { name: "Fetch details" }).click();
    await expect(toast(page, /GSTIN lookup uses your e-invoice \(IRP\) login/)).toBeVisible();

    await openSection(panel, "Address");
    await panel.getByLabel("Billing Address").fill("12 BH Road, Tumakuru");
    await panel.getByLabel("Shipping Address").fill("Plot 7, KIADB Vasanthanarasapura");
    await panel.getByLabel("City", { exact: true }).fill("Tumakuru");
    // The GSTIN already picked the state.
    await expect(panel.getByRole("combobox", { name: "State", exact: true })).toContainText("Karnataka");
    await panel.getByLabel("Pincode", { exact: true }).fill("572101");
    for (const [n, label, address, city, state, pin] of [
      [2, "Bengaluru depot", "44 Peenya Industrial Area", "Bengaluru", "Karnataka", "560058"],
      [3, "Hosur branch", "SIPCOT Phase 2", "Hosur", "Tamil Nadu", "635109"],
    ] as const) {
      await panel.getByRole("button", { name: /Add shipping address/ }).click();
      await panel.getByLabel(`Shipping address ${n} — label`).fill(label);
      const block = panel.getByTestId(`shipping-address-${n}`);
      await block.getByLabel("Address", { exact: true }).fill(address);
      await block.getByLabel("City", { exact: true }).fill(city);
      await pickOption(page, block.getByRole("combobox", { name: `Shipping address ${n} state` }), state);
      await block.getByLabel("Pincode", { exact: true }).fill(pin);
    }

    await openSection(panel, "Credit Terms");
    await panel.getByLabel("Credit Period (Days)").fill("30");
    await panel.getByLabel("Credit Limit (₹)").fill("100000");
    await expectNoHorizontalScroll(page, "add party");
    await panel.getByRole("button", { name: "Create Party" }).click();
    await expect(toast(page, "Party created")).toBeVisible();
    await expect(panel).toBeHidden();

    const cust = await savedParty(owner.businessId, customer);
    expect(cust).toMatchObject({
      type: "customer",
      gstin: "29AABCT1332L1ZT",
      pan: "AABCT1332L",
      state: "Karnataka",
      state_code: "29",
      billing_address: "12 BH Road, Tumakuru",
      shipping_address: "Plot 7, KIADB Vasanthanarasapura",
      opening_balance: "5000.00",
      credit_limit: "100000.00",
      credit_period_days: 30,
    });
    expect(cust.phone).toContain("9845012345");
    expect(cust.additional_shipping_addresses).toEqual([
      { label: "Bengaluru depot", address: "44 Peenya Industrial Area", city: "Bengaluru", state: "Karnataka", stateCode: "29", pincode: "560058" },
      { label: "Hosur branch", address: "SIPCOT Phase 2", city: "Hosur", state: "Tamil Nadu", stateCode: "33", pincode: "635109" },
    ]);

    // The list and the party's page show it.
    let row = await findParty(page, customer);
    await expect(row).toContainText("29AABCT1332L1ZT");
    await expect(row).toContainText("₹5,000.00");
    await row.click();
    let detail = page.getByRole("dialog", { name: customer });
    await expect(detail.getByText("Opening: ₹5,000.00")).toBeVisible();
    await expect(detail.getByText("Receivable")).toBeVisible();
    await expect(detail.getByText("30 days")).toBeVisible();
    await expect(detail.getByText("₹1,00,000.00")).toBeVisible();
    await expect(detail.getByText("Bengaluru depot:")).toBeVisible();
    await expect(detail.getByText(/Hosur branch: SIPCOT Phase 2, Hosur, Tamil Nadu, 635109/)).toBeVisible();
    await expectNoHorizontalScroll(page, "party detail");
    await detail.getByRole("button", { name: "Close" }).click();

    // ── Supplier in the business's own state ────────────────────
    await page.getByRole("button", { name: /Add Party/ }).first().click();
    panel = page.getByRole("dialog", { name: "Add Party" });
    // A blank form, not the previous customer's details.
    await expect(panel.getByLabel(/^Party Name/)).toHaveValue("");
    await expect(panel.getByLabel("Opening Balance")).toHaveValue("");
    await panel.getByRole("button", { name: "Supplier", exact: true }).click();
    await panel.getByLabel(/^Party Name/).fill(supplier);
    await panel.getByLabel("Opening Balance").fill("-2500");
    await panel.getByLabel("GSTIN").fill("27AAACR5055K1Z5");
    await panel.getByRole("button", { name: "Create Party" }).click();
    await expect(toast(page, "Party created")).toBeVisible();
    await expect(panel).toBeHidden();
    const sup = await savedParty(owner.businessId, supplier);
    expect(sup).toMatchObject({ type: "supplier", state: "Maharashtra", state_code: "27", pan: "AAACR5055K", opening_balance: "-2500.00" });
    // Nothing of the customer entered before carries over to the supplier.
    expect(sup).toMatchObject({ phone: null, email: null, billing_address: null, shipping_address: null, credit_limit: null, credit_period_days: null });
    expect(sup.additional_shipping_addresses ?? []).toEqual([]);
    await page.getByRole("searchbox", { name: "Search by name…" }).fill("");
    await page.getByRole("button", { name: "Suppliers", exact: true }).click();
    row = page.getByRole("row").filter({ hasText: supplier });
    await expect(row).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: customer })).toHaveCount(0);
    await page.getByRole("button", { name: "All", exact: true }).click();

    // ── A duplicate of the customer, already billed ─────────────
    await page.getByRole("button", { name: /Add Party/ }).first().click();
    panel = page.getByRole("dialog", { name: "Add Party" });
    await panel.getByLabel(/^Party Name/).fill(duplicate);
    await panel.getByLabel("Opening Balance").fill("1000");
    await openSection(panel, "Address");
    await panel.getByLabel("Shipping Address").fill("Old godown, Sira Road");
    await panel.getByRole("button", { name: "Create Party" }).click();
    await expect(toast(page, "Party created")).toBeVisible();
    await expect(panel).toBeHidden();
    const dup = await savedParty(owner.businessId, duplicate);

    const item = await owner.api.mutate<{ id: string }>("item.create", {
      name: `J3 Seed Item ${id}`, unit: "pcs", itemMode: "simple", salePrice: "100.00", taxPercent: "18.00", itemType: "product", taxInclusive: false,
    });
    const dupInvoice = await owner.api.mutate<{ id: string; invoiceNumber: string }>("invoice.create", {
      type: "sale",
      partyId: dup.id,
      invoiceDate: new Date().toISOString(),
      lineItems: [{ itemId: item.id, itemName: "J3 Seed Item", quantity: "1", unitPrice: "100.00", taxPercent: "18.00", discountPercent: "0", conversionFactor: "1" }],
      invoiceDiscount: "0",
      invoiceDiscountType: "amount",
      additionalCharges: "0",
      roundOff: "0",
    });
    const template = await owner.api.mutate<{ id: string }>("recurringInvoice.create", {
      partyId: dup.id,
      name: `Monthly AMC ${id}`,
      type: "sale",
      frequency: "monthly",
      lineItems: [{ itemName: "AMC", quantity: "1", unitPrice: "500.00", taxPercent: "18.00" }],
      startDate: new Date(Date.now() + 20 * 86400000).toISOString(),
    });

    // ── Merge the duplicate into the customer ───────────────────
    row = await findParty(page, duplicate);
    await row.click();
    detail = page.getByRole("dialog", { name: duplicate });
    await detail.getByRole("button", { name: "Merge", exact: true }).click();
    const merge = page.getByRole("dialog", { name: "Merge Parties" });
    await expect(merge.getByText("1 invoice")).toBeVisible();
    await merge.getByPlaceholder("Search parties...").fill(customer);
    await merge.getByRole("button", { name: new RegExp(customer) }).first().click();
    await merge.getByRole("checkbox").check();
    await expectNoHorizontalScroll(page, "merge parties");
    await merge.getByRole("button", { name: "Merge & Delete" }).click();
    await expect(toast(page, `"${duplicate}" merged successfully`)).toBeVisible();
    await expect(merge).toBeHidden();

    await expect.poll(async () => (await partiesNamed(owner.businessId, duplicate)).length).toBe(0);
    const [merged] = await partiesNamed(owner.businessId, customer);
    expect(merged.opening_balance).toBe("6000.00");
    const [moved] = await invoicePartyIds([dupInvoice.id]);
    expect(moved.party_id).toBe(merged.id);
    expect(moved.notes).toContain(`originally issued to "${duplicate}"`);
    expect((await recurringTemplatesOf(merged.id)).map((t) => t.id)).toEqual([template.id]);
    // The duplicate's delivery address is kept as an extra address.
    expect(merged.additional_shipping_addresses?.map((a) => a.address)).toContain("Old godown, Sira Road");

    // ── Edit the customer ───────────────────────────────────────
    row = await findParty(page, customer);
    await expect(row).toContainText("₹6,118.00"); // 6,000 opening + the ₹118 invoice (100 + 18% GST)
    await row.click();
    detail = page.getByRole("dialog", { name: customer });
    await detail.getByRole("button", { name: "Edit", exact: true }).click();
    panel = page.getByRole("dialog", { name: "Edit Party" });
    await expect(panel.getByLabel(/^Party Name/)).toHaveValue(customer);
    await panel.getByLabel("Phone").fill("9845099999");
    await openSection(panel, "Credit Terms");
    await expect(panel.getByLabel("Credit Limit (₹)")).toHaveValue("100000.00");
    await panel.getByLabel("Credit Limit (₹)").fill("150000");
    await openSection(panel, "Address");
    await panel.getByRole("button", { name: "Remove shipping address 3" }).click();
    await panel.getByRole("button", { name: "Save Changes" }).click();
    await expect(toast(page, "Party updated")).toBeVisible();
    await expect(panel).toBeHidden();
    await expect.poll(async () => (await partiesNamed(owner.businessId, customer))[0].credit_limit).toBe("150000.00");
    const [edited] = await partiesNamed(owner.businessId, customer);
    expect(edited.phone).toContain("9845099999");
    expect(edited.credit_limit).toBe("150000.00");
    expect(edited.additional_shipping_addresses?.map((a) => a.label ?? a.address)).toEqual(["Bengaluru depot", "Old godown, Sira Road"]);
    expect(edited).toMatchObject({ gstin: "29AABCT1332L1ZT", state_code: "29", opening_balance: "6000.00" });
    detail = page.getByRole("dialog", { name: customer });
    await expect(detail.getByText("₹1,50,000.00")).toBeVisible();
    await detail.getByRole("button", { name: "Close" }).click();

    // ── Delete rules ────────────────────────────────────────────
    guard.allow(/status of 409 .*party\.delete/); // the refusal below is a 409 by design
    row = await findParty(page, customer);
    await row.getByRole("button", { name: "Delete party" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(toast(page, /has invoices or payments/)).toBeVisible();
    expect(await partiesNamed(owner.businessId, customer)).toHaveLength(1);

    row = await findParty(page, supplier);
    await row.getByRole("button", { name: "Delete party" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(toast(page, "Party deleted")).toBeVisible();
    await expect(row).toHaveCount(0);
    await expect.poll(async () => (await partiesNamed(owner.businessId, supplier)).length).toBe(0);
  });
});
