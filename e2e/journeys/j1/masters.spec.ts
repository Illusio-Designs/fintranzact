/**
 * J3 — Masters: the parties and items a business keeps, set up in the UI.
 *
 *   Parties: a GST-registered customer in another state (GSTIN fills PAN and
 *   state; "Search GST" without Sandbox or e-invoicing set up only derives them, no
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
import { choose } from "../../helpers/journey-ui";
import {
  invoiceLines,
  invoicePartyIds,
  itemBatches,
  itemsNamed,
  itemVariants,
  partiesNamed,
  priceLevelNamed,
  priceListEntries,
  recurringTemplatesOf,
  stockGroupNamed,
  stockMovements,
} from "../../helpers/db";

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
async function pickOption(page: Page, combobox: ReturnType<Page["getByRole"]>, label: string | RegExp) {
  await combobox.click();
  await page.getByRole("option", { name: label, exact: typeof label === "string" }).click();
  // Searchable pickers are text inputs; the others are buttons showing the choice.
  if ((await combobox.evaluate((el) => el.tagName)) === "INPUT") await expect(combobox).toHaveValue(label);
  else await expect(combobox).toContainText(label);
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
    // No Sandbox keys and no e-invoice login: the search only derives what the
    // GSTIN itself says, and tells the user so without raising an error.
    await panel.getByRole("button", { name: "Search GST" }).click();
    await expect(panel.getByRole("status").filter({ hasText: /GST search is not set up here/ })).toBeVisible();

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
    const partyType = page.getByRole("tablist", { name: "Party type" });
    await partyType.getByRole("tab", { name: /^Suppliers/ }).click();
    row = page.getByRole("row").filter({ hasText: supplier });
    await expect(row).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: customer })).toHaveCount(0);
    await partyType.getByRole("tab", { name: /^All/ }).click();

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
    await merge.getByPlaceholder("Search parties…").fill(customer);
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
    await row.getByRole("button", { name: /^Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Delete party" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(toast(page, /has invoices or payments/)).toBeVisible();
    expect(await partiesNamed(owner.businessId, customer)).toHaveLength(1);

    row = await findParty(page, supplier);
    await row.getByRole("button", { name: /^Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Delete party" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(toast(page, "Party deleted")).toBeVisible();
    await expect(row).toHaveCount(0);
    await expect.poll(async () => (await partiesNamed(owner.businessId, supplier)).length).toBe(0);
  });
});

/** Pick an ISO date (YYYY-MM-DD) in the app's calendar popover. */
async function pickDate(page: Page, trigger: ReturnType<Page["getByRole"]>, iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const label = `${d} ${months[m - 1]} ${y}`;
  await trigger.click();
  const calendar = page.getByRole("dialog", { name: "Choose date" });
  for (let i = 0; i < 36; i++) {
    const cell = calendar.getByRole("gridcell", { name: label, exact: true });
    if (await cell.count()) {
      await cell.click();
      return;
    }
    // Compare with a day shown in the middle of the month grid.
    const shown = await calendar.getByRole("gridcell").nth(15).getAttribute("aria-label");
    const [sd, sm, sy] = (shown ?? "").split(" ");
    const shownKey = Number(sy) * 12 + months.indexOf(sm);
    void sd;
    await calendar.getByRole("button", { name: shownKey < y * 12 + (m - 1) ? "Next month" : "Previous month" }).click();
  }
  throw new Error(`could not reach ${label} in the calendar`);
}

async function openItemsPage(page: Page) {
  await navTo(page, "Stock Items");
  await expect(page.getByRole("heading", { name: "Stock Items", level: 1 })).toBeVisible();
  await expectNoHorizontalScroll(page, "stock items");
}

async function startItem(page: Page, name: string) {
  await page.getByRole("button", { name: /Add Item/ }).first().click();
  const panel = page.getByRole("dialog", { name: "Add Item" });
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel(/^Item Name/)).toHaveValue("");
  await panel.getByLabel(/^Item Name/).fill(name);
  return panel;
}

async function saveItem(page: Page, panel: ReturnType<Page["getByRole"]>, businessId: string, name: string) {
  await panel.getByRole("button", { name: "Create Item" }).click();
  await expect(toast(page, "Item created")).toBeVisible();
  await expect(panel).toBeHidden();
  await expect.poll(async () => (await itemsNamed(businessId, name)).length, { message: `item ${name} saved` }).toBe(1);
  return (await itemsNamed(businessId, name))[0];
}

test.describe("J3 masters — items (dark theme)", () => {
  test.use({ theme: "dark" });
  test.setTimeout(300_000);

  test("items: simple with HSN/SKU/barcode/stock group, variants, alternate units, batches with expiry, service, price level, edit, delete rules", async ({
    context,
    page,
  }) => {
    const owner = await seedOwner(context, "j3i");
    const id = uid();
    const names = {
      laptop: `J3 Laptop ${id}`,
      tee: `J3 Tee ${id}`,
      rice: `J3 Rice ${id}`,
      pcm: `J3 Paracetamol ${id}`,
      install: `J3 Installation ${id}`,
    };
    await openBusiness(page, owner);
    await expectTheme(page, "dark");

    // ── Switch barcodes on (Settings → Barcodes) ────────────────
    await navTo(page, "Settings");
    await page.getByRole("button", { name: "Barcodes", exact: true }).filter({ visible: true }).click();
    const barcodeSwitch = page.getByRole("switch", { name: "Use barcodes" });
    await expect(page.getByText(/Barcode fields, scanning|Off — nothing barcode-related/)).toBeVisible();
    if ((await barcodeSwitch.getAttribute("aria-checked")) !== "true") {
      await barcodeSwitch.click();
    }
    await expect(page.getByText("Barcode fields, scanning, labels and Physical stock are on for this business.")).toBeVisible();
    await expect(barcodeSwitch).toHaveAttribute("aria-checked", "true");
    await expectNoHorizontalScroll(page, "settings: barcodes");

    // ── Stock groups: Electronics › Laptops ─────────────────────
    await navTo(page, "Stock Groups");
    await expect(page.getByRole("heading", { name: "Stock Groups", level: 1 })).toBeVisible();
    for (const [group, under] of [[`Electronics ${id}`, ""], [`Laptops ${id}`, `Electronics ${id}`]]) {
      await page.getByRole("button", { name: "+ Add group" }).click();
      const dlg = page.getByRole("dialog", { name: "Add stock group" });
      await dlg.getByLabel(/^Name/).fill(group);
      if (under) await pickOption(page, dlg.getByRole("combobox", { name: "Under" }), under);
      await dlg.getByRole("button", { name: "Save" }).click();
      await expect(dlg).toBeHidden();
      await expect(page.getByRole("row").filter({ hasText: group })).toBeVisible();
    }
    await expectNoHorizontalScroll(page, "stock groups");
    const electronics = await stockGroupNamed(owner.businessId, `Electronics ${id}`);
    const laptops = await stockGroupNamed(owner.businessId, `Laptops ${id}`);
    expect(laptops?.parent_id).toBe(electronics?.id);

    await openItemsPage(page);

    // ── Simple product: HSN, SKU, barcode, stock group, opening stock ─
    let panel = await startItem(page, names.laptop);
    await panel.getByLabel(/^Sale Price/).fill("55000");
    await choose(page, panel.getByRole("combobox", { name: "GST rate" }), "18%");
    await openSection(panel, "Identification");
    await panel.getByLabel("SKU").fill(`LAP-${id}`);
    await panel.getByLabel("HSN / SAC Code").fill("8471");
    await panel.getByLabel("Barcode", { exact: true }).fill("8901234567897");
    // Sub-groups are listed indented under their parent ("└ Laptops").
    await pickOption(page, panel.getByRole("combobox", { name: "Stock group" }), new RegExp(`└ Laptops ${id}$`));
    await openSection(panel, "Purchase");
    await panel.getByLabel("Purchase Price (₹)").fill("48000");
    await openSection(panel, "Stock");
    await panel.getByLabel("Stock Quantity").fill("10");
    await panel.getByLabel("Low Stock Alert").fill("2");
    await expectNoHorizontalScroll(page, "add item");
    const laptop = await saveItem(page, panel, owner.businessId, names.laptop);
    expect(laptop).toMatchObject({
      item_type: "product",
      item_mode: "simple",
      hsn: "8471",
      sku: `LAP-${id}`,
      barcode: "8901234567897",
      unit: "pcs",
      sale_price: "55000.00",
      purchase_price: "48000.00",
      tax_percent: "18.00",
      stock_quantity: "10.000",
      stock_group_id: laptops!.id,
    });
    expect(await stockMovements(laptop.id)).toEqual([expect.objectContaining({ quantity: "10.000", batch_number: null })]);
    const laptopRow = page.getByRole("row").filter({ hasText: names.laptop });
    await expect(laptopRow).toContainText("8901234567897");
    await expect(laptopRow).toContainText("₹55,000.00");
    await expect(laptopRow).toContainText("10");

    // ── Variant product: Size × Colour ──────────────────────────
    panel = await startItem(page, names.tee);
    await panel.getByLabel(/^Sale Price/).fill("499");
    await choose(page, panel.getByRole("combobox", { name: "GST rate" }), "5%");
    await openSection(panel, "Product Variants");
    await panel.getByPlaceholder("e.g. Size, Color, Material").fill("Size");
    await panel.getByRole("button", { name: "+ Add", exact: true }).click();
    for (const v of ["S", "M"]) {
      await panel.getByPlaceholder("Add Size value and press Enter").fill(v);
      await panel.getByPlaceholder("Add Size value and press Enter").press("Enter");
    }
    await panel.getByPlaceholder("e.g. Size, Color, Material").fill("Color");
    await panel.getByRole("button", { name: "+ Add", exact: true }).click();
    await panel.getByPlaceholder("Add Color value and press Enter").fill("Red");
    await panel.getByPlaceholder("Add Color value and press Enter").press("Enter");
    await panel.getByRole("button", { name: "Generate All Combinations" }).click();
    const variantRows = panel.getByRole("row").filter({ has: page.getByPlaceholder("SKU", { exact: true }) });
    await expect(variantRows).toHaveCount(2);
    await variantRows.nth(0).getByPlaceholder("SKU").fill(`TEE-S-${id}`);
    await variantRows.nth(0).getByRole("spinbutton").nth(1).fill("5");
    await variantRows.nth(1).getByPlaceholder("SKU").fill(`TEE-M-${id}`);
    await variantRows.nth(1).getByRole("spinbutton").nth(0).fill("549");
    await variantRows.nth(1).getByRole("spinbutton").nth(1).fill("7");
    const tee = await saveItem(page, panel, owner.businessId, names.tee);
    expect(tee).toMatchObject({ item_mode: "variants", variant_attributes: ["Size", "Color"], tax_percent: "5.00" });
    const teeVariants = await itemVariants(tee.id);
    expect(teeVariants.map((v) => [v.attribute_values, v.sku, v.sale_price, v.stock_quantity])).toEqual([
      // A blank variant price means "use the item's default price".
      [{ Size: "S", Color: "Red" }, `TEE-S-${id}`, null, "5.000"],
      [{ Size: "M", Color: "Red" }, `TEE-M-${id}`, "549.00", "7.000"],
    ]);
    const teePrices = await owner.api.query("pricing.resolve", {
      lines: teeVariants.map((v) => ({ itemId: tee.id, variantId: v.id, quantity: "1" })),
    });
    expect(teePrices.lines.map((l: { unitPrice: string }) => Number(l.unitPrice))).toEqual([499, 549]);

    // ── Alternate units: rice by the kg, also sold by the 25 kg bag ─
    panel = await startItem(page, names.rice);
    await panel.getByLabel(/^Sale Price/).fill("60");
    await pickOption(page, panel.getByRole("combobox", { name: "Unit" }), "Kilograms (KG)");
    await openSection(panel, "Alternate Units");
    const altUnits = panel.getByRole("region", { name: /^Alternate Units/ });
    await altUnits.getByRole("button", { name: "+ Add alternate unit" }).click();
    await pickOption(page, altUnits.getByRole("combobox", { name: "Unit" }), "Bag");
    await altUnits.getByLabel("1 bag = ? kg").fill("25");
    // The bag's price follows from the kg price: 25 × ₹60.
    await expect(altUnits.getByLabel("Sale Price (₹)")).toHaveValue("1500.00");
    await expect(panel.getByText("1 bag = 25 kg → ₹1500.00 each")).toBeVisible();
    const rice = await saveItem(page, panel, owner.businessId, names.rice);
    expect(rice).toMatchObject({ item_mode: "alt_units", unit: "kg", sale_price: "60.00" });
    expect(rice.unit_variants).toEqual([{ unit: "bag", conversionFactor: 25, salePrice: "1500.00" }]);

    // ── Batch-tracked medicine with expiry and an opening batch ─
    panel = await startItem(page, names.pcm);
    await panel.getByLabel(/^Sale Price/).fill("30");
    await choose(page, panel.getByRole("combobox", { name: "GST rate" }), "12%");
    await openSection(panel, "Identification");
    await panel.getByLabel("HSN / SAC Code").fill("3004");
    await openSection(panel, "Stock");
    await panel.getByLabel("Stock Quantity").fill("100");
    await openSection(panel, "Batches & expiry");
    await panel.getByLabel(/^Track batches/).check();
    await panel.getByLabel(/^Track expiry/).check();
    await panel.getByLabel("Batch no.").fill(`PCM-${id}`);
    await pickDate(page, panel.getByLabel(/^Expiry/), "2027-06-30");
    await pickDate(page, panel.getByLabel("Mfg date"), "2026-01-15");
    const pcm = await saveItem(page, panel, owner.businessId, names.pcm);
    expect(pcm).toMatchObject({ track_batches: true, track_expiry: true, stock_quantity: "100.000", hsn: "3004" });
    expect(await itemBatches(pcm.id)).toEqual([{ batch_number: `PCM-${id}`, expiry_date: "2027-06-30", mfg_date: "2026-01-15" }]);
    expect(await stockMovements(pcm.id)).toEqual([expect.objectContaining({ quantity: "100.000", batch_number: `PCM-${id}` })]);

    // ── Service: no stock ───────────────────────────────────────
    panel = await startItem(page, names.install);
    await panel.getByRole("button", { name: "Service", exact: true }).click();
    await panel.getByLabel(/^Sale Price/).fill("1500");
    await choose(page, panel.getByRole("combobox", { name: "GST rate" }), "18%");
    await openSection(panel, "Identification");
    await panel.getByLabel("HSN / SAC Code").fill("998713");
    await expect(panel.getByRole("button", { name: /^Stock/ })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: /^Batches/ })).toHaveCount(0);
    const service = await saveItem(page, panel, owner.businessId, names.install);
    expect(service).toMatchObject({ item_type: "service", hsn: "998713", stock_quantity: "0.000" });
    expect(await stockMovements(service.id)).toEqual([]);

    // The Services tab lists only the service.
    const itemType = page.getByRole("tablist", { name: "Item type" });
    await itemType.getByRole("tab", { name: "Services", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: names.install })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: names.laptop })).toHaveCount(0);
    await itemType.getByRole("tab", { name: "All", exact: true }).click();

    // ── Price level: Wholesale rate for the laptop, for one customer ─
    await navTo(page, "Price Levels");
    await expect(page.getByRole("heading", { name: "Price Levels", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "+ New level" }).click();
    const levelForm = page.getByRole("dialog", { name: "New price level" });
    await levelForm.getByLabel(/^Name/).fill(`Wholesale ${id}`);
    await levelForm.getByRole("button", { name: "Save" }).click();
    await expect(toast(page, "Price level created")).toBeVisible();
    await page.getByLabel(`${names.laptop} price on Wholesale ${id}`).fill("52000");
    await page.getByRole("button", { name: "Save 1 change" }).click();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await expectNoHorizontalScroll(page, "price levels");
    expect(await priceListEntries(`Wholesale ${id}`, laptop.id)).toEqual([expect.objectContaining({ price: "52000.00" })]);

    const dealer = await owner.api.mutate<{ id: string; name: string }>("party.create", {
      name: `J3 Dealer ${id}`, type: "customer", state: "Maharashtra", stateCode: "27",
    });
    await openPartiesPage(page);
    await (await findParty(page, dealer.name)).click();
    const dealerPanel = page.getByRole("dialog", { name: dealer.name });
    await pickOption(page, dealerPanel.getByRole("combobox", { name: "Price level" }), `Wholesale ${id}`);
    await expect(toast(page, "Price level updated")).toBeVisible();
    await dealerPanel.getByRole("button", { name: "Close" }).click();
    const level = await priceLevelNamed(owner.businessId, `Wholesale ${id}`);
    await expect.poll(async () => (await partiesNamed(owner.businessId, dealer.name))[0].price_level_id).toBe(level!.id);
    // What a sale to this dealer is priced at, and to anyone else.
    const quote = await owner.api.query("pricing.resolve", { partyId: dealer.id, lines: [{ itemId: laptop.id, quantity: "1" }] });
    expect(quote.priceLevel?.name).toBe(`Wholesale ${id}`);
    expect(quote.lines[0]).toMatchObject({ source: "level" });
    expect(Number(quote.lines[0].unitPrice)).toBe(52000);
    const walkIn = await owner.api.query("pricing.resolve", { lines: [{ itemId: laptop.id, quantity: "1" }] });
    expect(walkIn.lines[0]).toMatchObject({ source: "item" });
    expect(Number(walkIn.lines[0].unitPrice)).toBe(55000);

    // ── Edit an item ────────────────────────────────────────────
    await openItemsPage(page);
    await page.getByRole("row").filter({ hasText: names.laptop }).click();
    const itemPanel = page.getByRole("dialog", { name: names.laptop });
    await itemPanel.getByRole("button", { name: "Edit Item" }).click();
    const edit = page.getByRole("dialog", { name: "Edit Item" });
    await expect(edit.getByLabel(/^Item Name/)).toHaveValue(names.laptop);
    await edit.getByLabel(/^Sale Price/).fill("56000");
    await openSection(edit, "Identification");
    await edit.getByLabel("HSN / SAC Code").fill("84713010");
    await edit.getByRole("button", { name: "Save Changes" }).click();
    await expect(toast(page, "Item updated")).toBeVisible();
    await expect.poll(async () => (await itemsNamed(owner.businessId, names.laptop))[0].sale_price).toBe("56000.00");
    expect((await itemsNamed(owner.businessId, names.laptop))[0]).toMatchObject({ hsn: "84713010", stock_quantity: "10.000", stock_group_id: laptops!.id });
    await expect(page.getByRole("row").filter({ hasText: names.laptop })).toContainText("₹56,000.00");

    // ── Delete rules: a sold item is retired (kept on its invoices) ─
    const sold = await owner.api.mutate<{ id: string }>("invoice.create", {
      type: "sale",
      partyId: dealer.id,
      invoiceDate: new Date().toISOString(),
      lineItems: [{ itemId: laptop.id, itemName: names.laptop, quantity: "1", unitPrice: "52000.00", taxPercent: "18.00", discountPercent: "0", conversionFactor: "1" }],
      invoiceDiscount: "0",
      invoiceDiscountType: "amount",
      additionalCharges: "0",
      roundOff: "0",
    });
    await page.reload();
    for (const name of [names.laptop, names.install]) {
      const r = page.getByRole("row").filter({ hasText: name });
      await r.getByRole("button", { name: /^Actions for/ }).click();
      await page.getByRole("menuitem", { name: "Delete item" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
      await expect(toast(page, "Item deleted")).toBeVisible();
      await expect(r).toHaveCount(0);
      await expect.poll(async () => (await itemsNamed(owner.businessId, name))[0].deleted_at).not.toBeNull();
    }
    const [line] = await invoiceLines(sold.id);
    expect(line).toMatchObject({ item_id: laptop.id, item_name: names.laptop, quantity: "1.000" });
    expect(await stockMovements(laptop.id)).toContainEqual(expect.objectContaining({ quantity: "-1.000" }));
  });
});
