/**
 * J7 — Inventory, as the business owner runs it in the app.
 *
 * 1. Warehouses and stock movements (light theme):
 *    two warehouses created (a godown and a shop) → stock added to the
 *    godown into three batches of a batch-tracked item (one already
 *    expired, one expiring in two months) → a stock transfer of one batch to
 *    the shop → stock removed at the shop (damaged) → a physical stock count
 *    by barcode at the Main warehouse, posted (short one box, an unknown
 *    code) → the batch reports: batch-wise, expiring soon, expired → a sale
 *    from the godown that can't take the expired batch until "Allow expired"
 *    is ticked on the line → Stock by warehouse and the Godown Summary.
 *
 * 2. Production and pricing (dark theme):
 *    a stock group for finished goods → a bill of materials (with wastage) →
 *    a production run from it with labour on top (manufacturing journal):
 *    components out, finished goods in at their cost → a price level for a
 *    dealer, applied on an invoice → the stock ledger, stock group summary
 *    and reorder status reports.
 *
 * Masters (items, customers) are seeded through the API: J3 owns creating
 * them in the UI. Everything that moves stock is done here in the UI, and
 * every quantity is checked against the stock movements, warehouse balances,
 * batches and journals in the database.
 *
 * External services: none (no GSP, no e-invoice: these sales are below every
 * threshold and e-invoicing is off).
 */
import type { Page } from "@playwright/test";
import { test, expect, expectNoHorizontalScroll, expectTheme, isPhone, toast } from "../../helpers/journey";
import { seedOwner } from "../../helpers/journey-seed";
import { seedProductionMasters, seedStockMasters } from "../../helpers/inventory-seed";
import {
  choose,
  dialog,
  fillLine,
  inr,
  isoMonthsAhead,
  listRow,
  openBusiness,
  openPage,
  pick,
  pickDateMonthsAhead,
} from "../../helpers/journey-ui";
import {
  batchesOf,
  bomsOf,
  documentLines,
  documentsOf,
  itemMovements,
  itemsNamed,
  manufacturingJournalsOf,
  partiesNamed,
  physicalCountsOf,
  priceLevelNamed,
  priceListEntries,
  stockAdjustmentsOf,
  stockByWarehouse,
  stockGroupNamed,
  warehousesOf,
} from "../../helpers/db";

/** Business Reports → one report, found with "Go to a report". */
async function openReport(page: Page, label: string) {
  if (!page.url().endsWith("/reports")) await openPage(page, "Business Reports", /.+/);
  // The Reports Centre lists one category at a time; "Go to a report" finds any.
  await page.getByRole("searchbox", { name: "Go to a report" }).fill(label);
  await page.getByRole("button", { name: label, exact: true }).click();
  await expect(page.getByRole("heading", { name: label, level: 1 })).toBeVisible();
}

test.describe("J7 inventory", () => {
  test.setTimeout(420_000);

  test("warehouses → batches in → transfer → adjustments → physical count → batch reports → expired batch on a sale", async ({
    context,
    page,
  }) => {
    const owner = await seedOwner(context, "j7");
    const m = await seedStockMasters(owner);

    await openBusiness(page, owner);
    await expectTheme(page, "light");

    // ── Two warehouses: a godown and a shop ──────────────────────
    await openPage(page, "Warehouses");
    // The business's first warehouse, holding the gloves' opening stock.
    const cards = page.getByTestId("warehouse-card");
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("Main warehouse");
    await expect(cards.first()).toContainText("Default");
    for (const w of [
      { name: `Pune Godown ${m.id}`, code: "PUNE", type: "Godown" },
      { name: `Nagpur Shop ${m.id}`, code: "NGP", type: "Shop / store" },
    ]) {
      await page.getByRole("button", { name: "+ Add warehouse" }).click();
      const form = dialog(page, "Add warehouse");
      await form.getByLabel(/^Name/).fill(w.name);
      await form.getByLabel(/^Short code/).fill(w.code);
      await choose(page, form.getByRole("combobox", { name: "Type" }), w.type);
      await form.getByLabel("Address (optional)").fill("Plot 4, MIDC");
      await expectNoHorizontalScroll(page, "add warehouse");
      await form.getByRole("button", { name: "Add warehouse" }).click();
      await expect(toast(page, "Warehouse added")).toBeVisible();
      await expect(form).toBeHidden();
      await expect(cards.filter({ hasText: w.name })).toContainText(`${w.code} · ${w.type}`);
    }
    const godown = `Pune Godown ${m.id}`;
    const shop = `Nagpur Shop ${m.id}`;
    expect((await warehousesOf(owner.businessId)).map((w) => [w.name, w.code, w.warehouse_type, w.status])).toEqual([
      ["Main warehouse", "MAIN", "main", "active"],
      [godown, "PUNE", "godown", "active"],
      [shop, "NGP", "store", "active"],
    ]);
    await expectNoHorizontalScroll(page, "warehouses");

    // ── Stock in at the godown, into three batches ───────────────
    await openPage(page, "Stock Adjustments");
    await page.getByRole("button", { name: "+ New adjustment" }).click();
    const adj = dialog(page, "New stock adjustment");
    await choose(page, adj.getByRole("combobox", { name: "Warehouse" }), godown);
    await adj.getByRole("button", { name: "Add stock" }).first().click();
    await choose(page, adj.getByRole("combobox", { name: "Reason" }), "Opening stock");
    const batchesIn = [
      { batch: "PCM-A", qty: "100", months: 12 },
      { batch: "PCM-SOON", qty: "20", months: 2 },
      { batch: "PCM-OLD", qty: "30", months: -2 },
    ];
    for (const [i, b] of batchesIn.entries()) {
      if (i > 0) await adj.getByRole("button", { name: "Add item" }).click();
      await pick(page, adj.getByRole("combobox", { name: `Item, line ${i + 1}` }), m.tablets.name);
      await adj.getByLabel(`Add for line ${i + 1}`).fill(b.qty);
      await adj.getByLabel("Batch no.").nth(i).fill(b.batch);
      await pickDateMonthsAhead(page, adj.getByRole("button", { name: /^Expiry/ }).nth(i), b.months);
    }
    await expectNoHorizontalScroll(page, "new stock adjustment (in)");
    await adj.getByRole("button", { name: "Add stock" }).last().click();
    await expect(toast(page, "Stock adjusted")).toBeVisible();
    await expect(adj).toBeHidden();
    expect(await batchesOf(m.tablets.id)).toEqual([
      { batch_number: "PCM-A", expiry_date: isoMonthsAhead(12) },
      { batch_number: "PCM-OLD", expiry_date: isoMonthsAhead(-2) },
      { batch_number: "PCM-SOON", expiry_date: isoMonthsAhead(2) },
    ]);
    expect(await stockByWarehouse(m.tablets.id)).toEqual({
      total: 150,
      byWarehouse: { [godown]: 150 },
      byBatch: [
        { warehouse: godown, batch: "PCM-A", qty: 100 },
        { warehouse: godown, batch: "PCM-OLD", qty: 30 },
        { warehouse: godown, batch: "PCM-SOON", qty: 20 },
      ],
    });
    expect(await stockAdjustmentsOf(m.tablets.id)).toEqual([
      { qty: 20, previous: 100, next: 120, reason: "Opening stock" },
      { qty: 30, previous: 120, next: 150, reason: "Opening stock" },
      { qty: 100, previous: 0, next: 100, reason: "Opening stock" },
    ]);
    for (const b of batchesIn) {
      await expect(listRow(page, `Batch ${b.batch}`)).toContainText(`+${b.qty} pkt`);
    }

    // ── Transfer 40 of batch PCM-A to the shop ───────────────────
    await openPage(page, "Stock Transfers");
    await page.getByRole("button", { name: "+ New transfer" }).click();
    const move = dialog(page, "New stock transfer");
    await choose(page, move.getByRole("combobox", { name: "From" }), godown);
    await choose(page, move.getByRole("combobox", { name: "To" }), shop);
    await pick(page, move.getByRole("combobox", { name: "Item, line 1" }), m.tablets.name);
    await expect(move.getByText("150 pkt in this warehouse")).toBeVisible();
    await move.getByLabel("Quantity for line 1").fill("40");
    const transferBatch = move.getByRole("combobox", { name: "Batch" });
    await transferBatch.click();
    // Transfers move expired stock too; earliest expiry first would take it.
    await expect(page.getByRole("option", { name: /^Earliest expiry first/ })).toContainText("PCM-OLD × 30, PCM-SOON × 10");
    await page.getByRole("option", { name: /^PCM-A/ }).click();
    await expect(transferBatch).toContainText("PCM-A");
    await expectNoHorizontalScroll(page, "new stock transfer");
    await move.getByRole("button", { name: "Transfer 1 item" }).click();
    await expect(toast(page, "Stock transferred")).toBeVisible();
    await expect(move).toBeHidden();
    await expect(listRow(page, godown)).toContainText(shop);
    await expect(listRow(page, godown)).toContainText(`${m.tablets.name} (PCM-A) × 40 pkt`);
    const transfers = await itemMovements(m.tablets.id, "STOCK_TRANSFER");
    expect(transfers.map((t) => [t.movement_type, t.warehouse, t.batch_number, t.qty])).toEqual([
      ["TRANSFER_OUT", godown, "PCM-A", -40],
      ["TRANSFER_IN", shop, "PCM-A", 40],
    ]);
    expect(transfers[0].reference_id).toBe(transfers[1].reference_id);

    // ── Stock out at the shop: 5 damaged ─────────────────────────
    await openPage(page, "Stock Adjustments");
    await page.getByRole("button", { name: "+ New adjustment" }).click();
    const out = dialog(page, "New stock adjustment");
    await choose(page, out.getByRole("combobox", { name: "Warehouse" }), shop);
    await expect(out.getByRole("button", { name: "Remove stock", pressed: true })).toBeVisible();
    await choose(page, out.getByRole("combobox", { name: "Reason" }), "Damaged goods");
    await pick(page, out.getByRole("combobox", { name: "Item, line 1" }), m.tablets.name);
    await out.getByLabel("Remove for line 1").fill("5");
    await expect(out.getByText("40 pkt in this warehouse")).toBeVisible();
    await expectNoHorizontalScroll(page, "new stock adjustment (out)");
    await out.getByRole("button", { name: "Remove stock", pressed: false }).click();
    await expect(toast(page, "Stock adjusted")).toBeVisible();
    await expect(out).toBeHidden();
    await expect(listRow(page, "Damaged goods")).toContainText(`-5 pkt`);
    await expect(listRow(page, "Damaged goods")).toContainText(shop);
    expect(await stockByWarehouse(m.tablets.id)).toEqual({
      total: 145,
      byWarehouse: { [shop]: 35, [godown]: 110 },
      byBatch: [
        { warehouse: shop, batch: "PCM-A", qty: 35 },
        { warehouse: godown, batch: "PCM-A", qty: 60 },
        { warehouse: godown, batch: "PCM-OLD", qty: 30 },
        { warehouse: godown, batch: "PCM-SOON", qty: 20 },
      ],
    });
    expect((await stockAdjustmentsOf(m.tablets.id)).at(-1)).toEqual({ qty: -5, previous: 150, next: 145, reason: "Damaged goods" });

    // ── Physical stock count at the Main warehouse, by barcode ───
    await openPage(page, "Physical Stock");
    await expect(page.getByRole("combobox", { name: "Count stock at" })).toContainText("Main warehouse");
    await page.getByRole("button", { name: "Start scanning" }).click();
    await expect(page.getByRole("heading", { name: "Scanning · Main warehouse", level: 1 })).toBeVisible();
    const scanner = page.getByLabel("Scan or type a barcode");
    for (let i = 0; i < 11; i++) {
      await scanner.fill(m.gloves.barcode);
      await scanner.press("Enter");
    }
    await expect(page.getByRole("status").filter({ hasText: m.gloves.barcode })).toContainText(`${m.gloves.name} +1`);
    await scanner.fill("J7-NOT-A-CODE");
    await scanner.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "J7-NOT-A-CODE" })).toContainText("not in the system");
    await expect(page.getByText("12 scans · 1 items found · 1 unknown")).toBeVisible();
    await expectNoHorizontalScroll(page, "physical stock: scanning");
    await page.getByRole("button", { name: "End scan" }).click();
    await expect(page.getByRole("heading", { name: "Physical stock report", level: 1 })).toBeVisible();
    const diff = listRow(page, m.gloves.name);
    await expect(diff.getByRole("cell")).toHaveText([`${m.gloves.name}Short`, "12", "11", "-1", inr(-100)]);
    await expect(page.getByText("J7-NOT-A-CODE × 1")).toBeVisible();
    await page.getByLabel("Note (optional)").fill("Month-end count");
    await expectNoHorizontalScroll(page, "physical stock: report");
    await page.getByRole("button", { name: "Post 1 adjustment" }).click();
    await page.getByRole("dialog", { name: "Post this count?" }).getByRole("button", { name: "Post count" }).click();
    await expect(toast(page, "Count posted")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /^Posted/ })).toContainText("1 adjustments");
    expect(await physicalCountsOf(owner.businessId)).toEqual([
      expect.objectContaining({
        status: "posted",
        warehouse: "Main warehouse",
        scan_count: 12,
        adjusted_count: 1,
        note: "Month-end count",
        unknown_codes: [{ code: "J7-NOT-A-CODE", count: 1 }],
        lines: [expect.objectContaining({ itemId: m.gloves.id, books: "12.000", scanned: "11.000" })],
      }),
    ]);
    expect(await stockByWarehouse(m.gloves.id)).toMatchObject({ total: 11, byWarehouse: { "Main warehouse": 11 } });
    expect((await itemMovements(m.gloves.id, "PHYSICAL_STOCK")).map((x) => [x.warehouse, x.qty])).toEqual([["Main warehouse", -1]]);
    await page.getByRole("button", { name: "All counts" }).click();
    await expect(listRow(page, "Main warehouse")).toContainText("Posted · 1 adjusted");

    // ── Batch reports ────────────────────────────────────────────
    await openReport(page, "Batch-wise Stock");
    const batchRow = (batch: string, warehouse: string) =>
      page.getByRole("row").filter({ hasText: `Batch ${batch}` }).filter({ hasText: warehouse });
    await expect(page.getByRole("row").filter({ hasText: m.tablets.name })).toHaveCount(4);
    await expect(batchRow("PCM-A", godown)).toContainText("60 pkt");
    await expect(batchRow("PCM-A", shop)).toContainText("35 pkt");
    await expect(batchRow("PCM-SOON", godown)).toContainText("20 pkt");
    await expect(batchRow("PCM-OLD", godown)).toContainText("30 pkt");
    await expect(batchRow("PCM-OLD", godown)).toContainText(/\d+d ago/);
    await expectNoHorizontalScroll(page, "report: batch-wise stock");

    await openReport(page, "Expiring Soon");
    await expect(page.getByText("Nothing expiring soon")).toBeVisible();
    await choose(page, page.getByRole("combobox").filter({ hasText: "Next 30 days" }), "Next 90 days");
    await expect(page.getByRole("row").filter({ hasText: m.tablets.name })).toHaveCount(1);
    await expect(batchRow("PCM-SOON", godown)).toContainText("20 pkt");
    await expectNoHorizontalScroll(page, "report: expiring soon");

    await openReport(page, "Expired Stock");
    await expect(page.getByRole("row").filter({ hasText: m.tablets.name })).toHaveCount(1);
    await expect(batchRow("PCM-OLD", godown)).toContainText("30 pkt");
    await expectNoHorizontalScroll(page, "report: expired stock");

    // ── A sale can't take the expired batch until it's allowed ───
    await openPage(page, "Invoices");
    await page.getByRole("button", { name: /New Invoice/ }).first().click();
    const sale = dialog(page, "New Invoice");
    await pick(page, sale.getByRole("combobox", { name: "Customer" }), m.customer.name);
    await choose(page, sale.getByRole("combobox", { name: "Dispatch from" }), godown);
    await fillLine(page, sale, 0, { item: m.tablets.name, qty: "10" });
    const line = sale.getByTestId("document-line").first();
    const saleBatch = line.getByRole("combobox", { name: "Batch" });
    await saleBatch.click();
    // Earliest expiry first skips the expired batch, which isn't offered.
    await expect(page.getByRole("option", { name: /^Earliest expiry first/ })).toContainText("PCM-SOON × 10");
    await expect(page.getByRole("option", { name: /^PCM-A/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /^PCM-OLD/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await line.getByLabel("Allow expired").check();
    await saleBatch.click();
    await page.getByRole("option", { name: /^PCM-OLD \(expired\)/ }).click();
    await expect(line.getByText("Expired batch")).toBeVisible();
    // Unticking it again puts the line back on earliest expiry first…
    await line.getByLabel("Allow expired").uncheck();
    await expect(saleBatch).toContainText("Earliest expiry first");
    // …and the owner decides to clear the expired stock at a price after all.
    await line.getByLabel("Allow expired").check();
    await saleBatch.click();
    await page.getByRole("option", { name: /^PCM-OLD \(expired\)/ }).click();
    await expect(sale.getByTestId("document-total")).toHaveText(inr(392));
    await expectNoHorizontalScroll(page, "new invoice (expired batch)");
    await sale.getByRole("button", { name: "Create Invoice" }).click();
    await expect(toast(page, /^Invoice INV-\d+ created$/)).toBeVisible();
    const [invoice] = await documentsOf(m.customer.id, "invoice");
    expect(invoice).toMatchObject({ subtotal: "350.00", tax_amount: "42.00", total_amount: "392.00", stock_mode: "tracked" });
    expect(await documentLines(invoice.id)).toMatchObject([{ item_id: m.tablets.id, quantity: "10.000", batch_number: "PCM-OLD" }]);
    expect((await itemMovements(m.tablets.id)).filter((x) => x.reference_id === invoice.id).map((x) => [x.warehouse, x.batch_number, x.qty])).toEqual([
      [godown, "PCM-OLD", -10],
    ]);

    // ── Where everything is now ──────────────────────────────────
    await openPage(page, "Warehouses");
    await expect(cards.filter({ hasText: godown })).toContainText("Units in stock100");
    await expect(cards.filter({ hasText: shop })).toContainText("Units in stock35");
    await expect(cards.filter({ hasText: "Main warehouse" })).toContainText("Units in stock11");
    const stockRow = listRow(page, m.tablets.name);
    const headers = (await page.getByRole("columnheader").allInnerTexts()).map((h) => h.trim());
    const cell = (name: string) => stockRow.getByRole("cell").nth(headers.indexOf(name));
    await expect(cell(godown)).toHaveText("100");
    await expect(cell(shop)).toHaveText("35");
    await expect(cell("Total")).toHaveText("135 pkt");
    expect(await stockByWarehouse(m.tablets.id)).toMatchObject({ total: 135, byWarehouse: { [shop]: 35, [godown]: 100 } });

    await openReport(page, "Godown Summary");
    // Valued at average cost: the tablets came in at their ₹20 purchase
    // price, the gloves at ₹100.
    await expect(page.getByText("Total stock value at average cost:")).toContainText(inr(3800));
    // (The quantity column is left out on a phone.)
    const godownRow = (name: string, code: string, items: string, quantity: string, value: number) =>
      expect(listRow(page, name).getByRole("cell")).toHaveText(
        [`${name}${code} · Main premises`, items, ...(isPhone(page) ? [] : [quantity]), inr(value)],
      );
    await godownRow(godown, "PUNE", "1", "100", 2000);
    await godownRow(shop, "NGP", "1", "35", 700);
    await godownRow("Main warehouse", "MAIN", "1", "11", 1100);
    await expectNoHorizontalScroll(page, "report: godown summary");
  });

  test.describe("after 7 pm India time", () => {
    test.use({ theme: "dark" });

    test("stock group → bill of materials → production → finished goods → price level on an invoice → stock reports", async ({
      context,
      page,
    }) => {
      const owner = await seedOwner(context, "j7");
      const m = await seedProductionMasters(owner);
      const group = `Finished Garments ${m.id}`;

      await openBusiness(page, owner);
      await expectTheme(page, "dark");

      // ── A stock group for what the workshop makes ──────────────
      await openPage(page, "Stock Groups");
      await page.getByRole("button", { name: "+ Add group" }).click();
      const groupForm = dialog(page, "Add stock group");
      await groupForm.getByLabel(/^Name/).fill(group);
      await expectNoHorizontalScroll(page, "add stock group");
      await groupForm.getByRole("button", { name: "Save" }).click();
      await expect(toast(page, "Stock group added")).toBeVisible();
      await expect(listRow(page, group)).toBeVisible();
      const savedGroup = await stockGroupNamed(owner.businessId, group);
      expect(savedGroup).toMatchObject({ name: group, parent_id: null });

      // The shirt goes in it (Stock Items → Edit).
      await openPage(page, "Stock Items");
      await listRow(page, m.shirt.name).click();
      await dialog(page, m.shirt.name).getByRole("button", { name: "Edit Item" }).click();
      const edit = dialog(page, "Edit Item");
      const identification = edit.getByRole("button", { name: /^Identification/ });
      if ((await identification.getAttribute("aria-expanded")) !== "true") await identification.click();
      await choose(page, edit.getByRole("combobox", { name: "Stock group" }), new RegExp(`${group}$`));
      await edit.getByRole("button", { name: "Save Changes" }).click();
      await expect(toast(page, "Item updated")).toBeVisible();
      await expect.poll(async () => (await itemsNamed(owner.businessId, m.shirt.name))[0].stock_group_id).toBe(savedGroup!.id);

      // ── Bill of materials: 10 shirts from 15 m (+2%) and 80 buttons ─
      await openPage(page, "Bill of Materials");
      await page.getByRole("button", { name: "+ New BOM" }).click();
      const bomForm = dialog(page, "New bill of materials");
      await pick(page, bomForm.getByRole("combobox", { name: "Item made" }), m.shirt.name);
      await expect(bomForm.getByLabel(/^BOM name/)).toHaveValue(m.shirt.name);
      await bomForm.getByLabel(/^BOM name/).fill("Standard shirt");
      await bomForm.getByLabel(/^Output quantity/).fill("10");
      await bomForm.getByLabel("Default BOM for this item").check();
      await pick(page, bomForm.getByRole("combobox", { name: "Components item, line 1" }), m.fabric.name);
      await bomForm.getByLabel("Components quantity, line 1").fill("15");
      await bomForm.getByLabel("Wastage percent, line 1").fill("2");
      await bomForm.getByRole("button", { name: "Add component" }).click();
      await pick(page, bomForm.getByRole("combobox", { name: "Components item, line 2" }), m.buttons.name);
      await bomForm.getByLabel("Components quantity, line 2").fill("80");
      await expectNoHorizontalScroll(page, "new bill of materials");
      await bomForm.getByRole("button", { name: "Save BOM" }).click();
      await expect(toast(page, "BOM created")).toBeVisible();
      await expect(bomForm).toBeHidden();
      const bomRow = listRow(page, "Standard shirt");
      await expect(bomRow).toContainText(m.shirt.name);
      await expect(bomRow).toContainText("10 pcs");
      await expect(bomRow).toContainText("Default");
      const [bom] = await bomsOf(m.shirt.id);
      expect(bom).toMatchObject({
        name: "Standard shirt",
        output_quantity: "10.000",
        is_default: true,
        is_active: true,
        components: [
          { itemId: m.fabric.id, quantity: "15.000", wastage: "2.00" },
          { itemId: m.buttons.id, quantity: "80.000", wastage: "0.00" },
        ],
      });

      // ── Production: 20 shirts, labour on top ───────────────────
      // Components at their average cost: fabric 30.6 m (15 × 2 + 2%) ×
      // ₹150 = ₹4,590, buttons 160 × ₹2 = ₹320; + ₹2,000 labour = ₹6,910,
      // ₹345.50 a shirt.
      await openPage(page, "Manufacturing");
      await page.getByRole("button", { name: "+ Manufacture" }).click();
      const make = dialog(page, "Manufacture");
      await pick(page, make.getByRole("combobox", { name: "Item to make" }), m.shirt.name);
      await expect(make.getByRole("combobox", { name: "Bill of materials" })).toContainText("Standard shirt (default)");
      await make.getByLabel(/^Quantity to make/).fill("20");
      await expect(make.getByLabel("Quantity used, line 1")).toHaveValue("30.6");
      await expect(make.getByLabel("Quantity used, line 2")).toHaveValue("160");
      await expect(make.getByRole("combobox", { name: "Component, line 1" })).toHaveValue(m.fabric.name);
      await expect(make.getByRole("combobox", { name: "Take components from" })).toContainText("Main warehouse");
      await expect(make.getByRole("combobox", { name: "Put finished goods in" })).toContainText("Main warehouse");
      await make.getByRole("button", { name: "Add cost" }).click();
      await make.getByLabel("Cost name, line 1").fill("Labour");
      await make.getByLabel("Cost amount, line 1").fill("2000");
      await expect(make.getByText("Cost of goods made")).toBeVisible();
      await expect(make.getByText(`${inr(6910)} · ${inr(345.5)} / pcs`)).toBeVisible();
      await expectNoHorizontalScroll(page, "manufacture");
      await make.getByRole("button", { name: "Post journal" }).click();
      await expect(toast(page, /^Manufactured — journal \S+$/)).toBeVisible();
      await expect(make).toBeHidden();
      const [journal] = await manufacturingJournalsOf(m.shirt.id);
      expect(journal).toMatchObject({
        bom_id: bom.id,
        quantity: "20.000",
        components_cost: "4910.00",
        additional_costs: [{ label: "Labour", amount: "2000.00" }],
        additional_cost_total: "2000.00",
        total_cost: "6910.00",
        unit_cost: "345.5000",
        status: "posted",
        source: "Main warehouse",
        destination: "Main warehouse",
        lines: [
          { itemId: m.fabric.id, kind: "component", standard: "30.600", quantity: "30.600", amount: "4590.00" },
          { itemId: m.buttons.id, kind: "component", standard: "160.000", quantity: "160.000", amount: "320.00" },
        ],
      });
      const made = (id: string) => itemMovements(id, "MANUFACTURING");
      expect((await made(m.fabric.id)).map((x) => [x.warehouse, x.qty])).toEqual([["Main warehouse", -30.6]]);
      expect((await made(m.buttons.id)).map((x) => [x.warehouse, x.qty])).toEqual([["Main warehouse", -160]]);
      expect((await made(m.shirt.id)).map((x) => [x.warehouse, x.qty, x.unit_cost])).toEqual([["Main warehouse", 20, "345.50"]]);
      expect(await stockByWarehouse(m.shirt.id)).toMatchObject({ total: 20, byWarehouse: { "Main warehouse": 20 } });
      expect((await stockByWarehouse(m.fabric.id)).total).toBe(169.4);
      expect((await stockByWarehouse(m.buttons.id)).total).toBe(840);

      const journalRow = listRow(page, journal.journal_number);
      await expect(journalRow).toContainText(m.shirt.name);
      await expect(journalRow).toContainText("20 pcs");
      await expect(journalRow).toContainText(inr(6910));
      await expect(journalRow).toContainText("Posted");
      await journalRow.click();
      const journalPanel = dialog(page, `Manufacturing journal ${journal.journal_number}`);
      await expect(journalPanel.getByRole("row").filter({ hasText: m.fabric.name }).getByRole("cell")).toHaveText([
        m.fabric.name, "30.6 m", "30.6 m", inr(4590),
      ]);
      await expect(journalPanel.getByText(`${inr(345.5)} per pcs`)).toBeVisible();
      await expectNoHorizontalScroll(page, "manufacturing journal");
      await journalPanel.getByRole("button", { name: "Close", exact: true }).first().click();
      await expect(journalPanel).toBeHidden();

      // The finished goods are on the shelf (still under the reorder level of 25).
      await openPage(page, "Warehouses");
      await expect(listRow(page, m.shirt.name).getByRole("cell").last()).toHaveText(/^20 pcs\s*low$/);

      // ── A dealer price level, applied on an invoice ────────────
      const level = `Distributor ${m.id}`;
      await openPage(page, "Price Levels");
      await page.getByRole("button", { name: "+ New level" }).click();
      const levelForm = dialog(page, "New price level");
      await levelForm.getByLabel(/^Name/).fill(level);
      await levelForm.getByRole("button", { name: "Save" }).click();
      await expect(toast(page, "Price level created")).toBeVisible();
      await page.getByLabel(`${m.shirt.name} price on ${level}`).fill("650");
      await page.getByRole("button", { name: "Save 1 change" }).click();
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      await expectNoHorizontalScroll(page, "price levels");
      expect(await priceListEntries(level, m.shirt.id)).toEqual([expect.objectContaining({ price: "650.00" })]);

      await openPage(page, "Parties");
      await page.getByRole("searchbox", { name: "Search by name…" }).fill(m.dealer.name);
      await listRow(page, m.dealer.name).click();
      const dealerPanel = dialog(page, m.dealer.name);
      await choose(page, dealerPanel.getByRole("combobox", { name: "Price level" }), level);
      await expect(toast(page, "Price level updated")).toBeVisible();
      await dealerPanel.getByRole("button", { name: "Close" }).first().click();
      const savedLevel = await priceLevelNamed(owner.businessId, level);
      await expect.poll(async () => (await partiesNamed(owner.businessId, m.dealer.name))[0].price_level_id).toBe(savedLevel!.id);

      // 5 shirts at the dealer's ₹650 (not ₹800): ₹3,250 + 5% = ₹3,412.50, rounded down to
      // ₹3,412 (the business rounds totals off by default).
      await openPage(page, "Invoices");
      await page.getByRole("button", { name: /New Invoice/ }).first().click();
      const sale = dialog(page, "New Invoice");
      await pick(page, sale.getByRole("combobox", { name: "Customer" }), m.dealer.name);
      await fillLine(page, sale, 0, { item: m.shirt.name, qty: "5" });
      await expect(sale.getByText(`Prices from the ${level} price level`)).toBeVisible();
      await expect(sale.getByTestId("document-line").first().getByLabel("Unit price")).toHaveValue(/^650(\.00)?$/);
      await expect(sale.getByTestId("document-total")).toHaveText(inr(3412));
      await expectNoHorizontalScroll(page, "new invoice (price level)");
      await sale.getByRole("button", { name: "Create Invoice" }).click();
      await expect(toast(page, /^Invoice INV-\d+ created$/)).toBeVisible();
      const [invoice] = await documentsOf(m.dealer.id, "invoice");
      expect(invoice).toMatchObject({ subtotal: "3250.00", tax_amount: "162.50", round_off: "-0.50", total_amount: "3412.00", stock_mode: "tracked" });
      expect(await documentLines(invoice.id)).toMatchObject([{ item_id: m.shirt.id, quantity: "5.000", unit_price: "650.00" }]);
      expect((await itemMovements(m.shirt.id)).filter((x) => x.reference_id === invoice.id).map((x) => [x.warehouse, x.qty])).toEqual([
        ["Main warehouse", -5],
      ]);
      expect((await stockByWarehouse(m.shirt.id)).total).toBe(15);

      // ── Inventory reports ──────────────────────────────────────
      await openReport(page, "Stock Ledger");
      await pick(page, page.getByRole("combobox", { name: "Item" }), m.shirt.name);
      await expect(statCard(page, "Opening")).toHaveText("0 pcs");
      await expect(statCard(page, "Inward")).toHaveText("20 pcs");
      await expect(statCard(page, "Outward")).toHaveText("5 pcs");
      await expect(statCard(page, "Closing")).toHaveText("15 pcs");
      await expect(page.getByRole("row").filter({ hasText: journal.journal_number })).toContainText("20");
      await expect(page.getByRole("row").filter({ hasText: invoice.invoice_number })).toContainText(m.dealer.name);
      await expectNoHorizontalScroll(page, "report: stock ledger");

      await openReport(page, "Stock Group Summary");
      // 15 shirts at their ₹345.50 production cost.
      await expect(listRow(page, group)).toContainText("15");
      await expect(listRow(page, group)).toContainText(inr(5182.5));
      await page.getByRole("button", { name: group }).click();
      await expect(listRow(page, m.shirt.name)).toContainText("15 pcs");
      await expectNoHorizontalScroll(page, "report: stock group summary");

      await openReport(page, "Reorder Status");
      // At 15 the shirt is below its reorder level of 25; the fabric and
      // buttons have no level.
      const reorder = listRow(page, m.shirt.name);
      // Suggested: the 10 short of 25, plus 30 days of sales at the last 30
      // days' pace (5 sold) = 15.
      await expect(reorder.getByRole("cell").nth(1)).toHaveText("15 pcs");
      await expect(reorder.getByRole("cell").last()).toHaveText("15 pcs");
      await expect(page.getByRole("row").filter({ hasText: m.fabric.name })).toHaveCount(0);
      await expectNoHorizontalScroll(page, "report: reorder status");
    });
  });
});

/** The value on one of the reports' stat cards, by its label. */
function statCard(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator("xpath=following-sibling::p[1]");
}
