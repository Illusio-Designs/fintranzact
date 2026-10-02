/**
 * J11 — Settings, end to end, as the owner sets the business up in the app.
 *
 *   Business profile edited (legal name, email, Udyam, address line 2) and
 *   e-way bills switched on with portal login and the business's own
 *   threshold → logo uploaded from the Business tab and a signature from the
 *   edit form → Documents: invoice prefix "J11S", next number 101, standard
 *   terms, the Tally invoice design and 58 mm receipts (previewed as a PDF)
 *   → Shipping: a custom "Dunzo Express" method with tracking → a new
 *   invoice picks that method, gets J11S-00101, the terms pre-filled, IGST to
 *   a Karnataka buyer, moves stock and downloads as a PDF in the Tally
 *   design, once and with all three copies → Barcodes: Code 128 + many per item,
 *   locked → Point-of-Sale switched on → e-Invoicing settings: test before
 *   saving, save sandbox credentials, re-save without retyping the password,
 *   test again → Data: Generic CSV import of parties, items and invoices
 *   (columns auto-mapped by name) → CSV bundle and full backup downloaded and
 *   opened → Account: an API key created, used, revoked (and refused after)
 *   → the plan screen. A second window checks Settings in the dark theme.
 *
 * External services: none are reached. The e-Invoicing "Test Connection"
 * runs with no GSP client credentials on the server (IRP_CLIENT_ID unset), so
 * the app stops at its own credential check before any call to the NIC IRP;
 * that check, and the "save first" check before it, are what is exercised.
 * The e-way bill portal is only configured here (generation is J4's). Uploads
 * are images and CSVs made in the test; downloads are read from disk.
 */
import fs from "node:fs";
import zlib from "node:zlib";
import type { Download, Locator, Page } from "@playwright/test";
import {
  API_URL,
  test,
  expect,
  expectNoHorizontalScroll,
  expectTheme,
  isPhone,
  navTo,
  newJourneyContext,
  toast,
  uid,
} from "../../helpers/journey";
import { seedOwner } from "../../helpers/journey-seed";
import { dialog, inr, istIsoDate, listRow, openBusiness, openPage, pick, choose, fillLine } from "../../helpers/journey-ui";
import { documentLines, documentStockMoves, itemStock, salesTaxByRate } from "../../helpers/db";
import {
  apiKeysOf,
  businessProfile,
  eInvoiceConfig,
  invoicesNumbered,
  itemsOf,
  partiesOf,
  tenantPlan,
} from "../../helpers/settings-db";

// An 8 × 4 navy PNG and a small SVG, made here: no fixtures on disk.
const SIGNATURE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAA8r+mnAAAAEUlEQVR4nGMQkYvCihioJwEAYtERgXCh6XsAAAAASUVORK5CYII=",
  "base64",
);
const LOGO_SVG = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80" viewBox="0 0 240 80"><rect width="240" height="80" fill="#0f1b3d"/><text x="20" y="52" font-size="36" fill="#fff">J11</text></svg>`,
);

async function settingsTab(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
}

/** Pick a file through the app's own button (the OS file chooser). */
async function chooseFile(page: Page, trigger: Locator, file: { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent("filechooser");
  await trigger.click();
  await (await chooser).setFiles(file);
}

async function readDownload(download: Download) {
  return fs.readFileSync((await download.path())!);
}

test.describe("J11 settings", () => {
  test.setTimeout(360_000);

  test("profile, logo & signature, numbering, shipping → invoice, barcodes, POS, e-invoice config, import, export, API keys, plan", async ({
    context,
    page,
    browser,
    guard,
  }) => {
    const owner = await seedOwner(context, "j11");
    const id = uid();
    // Prerequisites other journeys own (J3 creates masters in the UI).
    const buyer = await owner.api.mutate<{ id: string; name: string }>("party.create", {
      name: `Hubli Hardware ${id}`,
      type: "customer",
      gstin: "29AABCT1332L1ZT",
      state: "Karnataka",
      stateCode: "29",
      billingAddress: "4 Station Road, Hubballi",
      city: "Hubballi",
      pincode: "580020",
    });
    const item = await owner.api.mutate<{ id: string; name: string }>("item.create", {
      name: `Brass Hinge ${id}`,
      hsn: "8302",
      unit: "pcs",
      itemMode: "simple",
      itemType: "product",
      salePrice: "1000.00",
      purchasePrice: "600.00",
      taxPercent: "18",
      stockQuantity: "50",
      taxInclusive: false,
    });

    await openBusiness(page, owner);
    await expectTheme(page, "light");

    // ── Business profile ────────────────────────────────────────
    await navTo(page, "Settings");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page, "settings / business");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Legal Name").fill(`J11 Enterprises Private Limited ${id}`);
    await page.getByLabel("Email", { exact: true }).fill(`accounts-${id}@j11.example.com`);
    await page.getByLabel("Address Line 2").fill("Near Crawford Market");
    await page.getByLabel("Udyam Registration Number").fill("UDYAM-MH-19-0012345");
    // e-Way bills: on, with the business's portal login and its own threshold.
    await page.getByRole("switch", { name: /Enable E-Way Bill/ }).check();
    await page.getByLabel("Portal ID").last().fill("j11-ewb-user");
    await page.getByLabel("Portal Password").last().fill("j11-ewb-pass");
    await page.getByLabel("E-Way Bill Threshold (₹)").fill("75000");
    await expectNoHorizontalScroll(page, "settings / business edit");

    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(toast(page, /Business updated|saved/i)).toBeVisible();
    // Back on the card, the new details show.
    await expect(page.getByText(`J11 Enterprises Private Limited ${id}`)).toBeVisible();
    await expect(page.getByText(`accounts-${id}@j11.example.com`)).toBeVisible();
    await expect(page.getByText("UDYAM-MH-19-0012345")).toBeVisible();

    let biz = await businessProfile(owner.businessId);
    expect(biz).toMatchObject({
      legal_name: `J11 Enterprises Private Limited ${id}`,
      email: `accounts-${id}@j11.example.com`,
      address_line_2: "Near Crawford Market",
      udyam_number: "UDYAM-MH-19-0012345",
      e_way_bill_enabled: true,
      e_way_bill_threshold: "75000.00",
    });

    // ── Logo, from the Business tab ─────────────────────────────
    const logo = page.getByTestId("logo-uploader");
    await expect(logo.getByText("No logo")).toBeVisible();
    await chooseFile(page, logo.getByRole("button", { name: "Choose file" }), {
      name: "logo.svg",
      mimeType: "image/svg+xml",
      buffer: LOGO_SVG,
    });
    await logo.getByRole("button", { name: "Save Logo" }).click();
    await expect(toast(page, "Logo updated")).toBeVisible();
    const logoImg = logo.getByRole("img", { name: "Current business logo" });
    await expect(logoImg).toBeVisible();
    // The browser rasterised the SVG to PNG before upload; the stored image loads.
    await expect.poll(() => logoImg.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
    biz = await businessProfile(owner.businessId);
    expect(biz).toMatchObject({ logo_mime_type: "image/png", logo_has_data: true });
    const served = await page.request.get(`${API_URL}/api/businesses/${owner.businessId}/logo`);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toContain("image/png");

    // ── Authorised signature, next to the logo ──────────────────
    // (Regression: the edit form leaves out the branding step, and the tab
    // had no signature uploader, so a signature could not be added later.)
    const signature = page.getByTestId("signature-uploader");
    await expect(signature.getByText("No signature")).toBeVisible();
    await chooseFile(page, signature.getByRole("button", { name: "Choose file" }), {
      name: "signature.png",
      mimeType: "image/png",
      buffer: SIGNATURE_PNG,
    });
    await expect(signature.getByRole("img", { name: "Pending signature preview" })).toBeVisible();
    await signature.getByRole("button", { name: "Save Signature" }).click();
    await expect(toast(page, "Signature updated")).toBeVisible();
    await expect(signature.getByRole("img", { name: "Current business signature" })).toBeVisible();
    await expectNoHorizontalScroll(page, "settings / logo & signature");
    expect(await businessProfile(owner.businessId)).toMatchObject({ signature_mime_type: "image/png", signature_has_data: true });
    const servedSignature = await page.request.get(`${API_URL}/api/businesses/${owner.businessId}/signature`);
    expect(servedSignature.status()).toBe(200);
    // The E-Way Bills page reads the business's own threshold.
    await openPage(page, "E-Way Bills");
    await expect(page.getByText(/above ₹75,000/).first()).toBeVisible();

    // ── Documents: numbering and standard terms ─────────────────
    await navTo(page, "Settings");
    await settingsTab(page, "Documents");
    await expectNoHorizontalScroll(page, "settings / documents");
    const invoicePrefix = page.getByRole("textbox", { name: "Invoice prefix", exact: true });
    await expect(invoicePrefix).toHaveValue("INV");
    await invoicePrefix.fill("j11s");
    // Prefixes are upper-cased as typed.
    await expect(invoicePrefix).toHaveValue("J11S");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(toast(page, "Document prefixes saved")).toBeVisible();
    await page.getByRole("button", { name: "Change next Invoice number", exact: true }).click();
    await page.getByLabel("Next number").fill("101");
    await page.getByRole("button", { name: "Confirm Change" }).click();
    await expect(toast(page, "Sequence number updated")).toBeVisible();
    await expect(page.getByTestId("next-number-invoice")).toHaveText("101");
    const terms = "Goods once sold will not be taken back. Subject to Mumbai jurisdiction.";
    await page.getByLabel("Standard Terms & Conditions").fill(terms);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(toast(page, "Document defaults saved")).toBeVisible();
    biz = await businessProfile(owner.businessId);
    expect(biz).toMatchObject({ invoice_prefix: "J11S", next_invoice_number: 101, default_terms_and_conditions: terms });

    // ── Documents: invoice design and thermal roll ──────────────
    // Nothing changes until the owner picks: the classic layout and 80 mm.
    expect(biz).toMatchObject({ invoice_template: "classic", thermal_width: 80 });
    const design = page.getByTestId("invoice-design");
    const designs = design.getByRole("radiogroup", { name: "Invoice design" });
    await expect(designs.getByRole("radio")).toHaveCount(10);
    await expect(designs.getByRole("radio", { name: "Classic", exact: true })).toBeChecked();
    await design.getByText("Tally Classic", { exact: true }).click();
    await expect(designs.getByRole("radio", { name: "Tally Classic" })).toBeChecked();
    await design.getByText("58 mm", { exact: true }).click();
    await expect(design.getByRole("radio", { name: "58 mm" })).toBeChecked();
    await expectNoHorizontalScroll(page, "settings / invoice design");
    // The preview is a sample invoice in the picked design, opened in a new tab.
    const previewResponse = page.waitForResponse((r) => r.url().includes("/api/invoice-templates/preview?template=tally"));
    const previewTab = page.context().waitForEvent("page");
    await design.getByRole("button", { name: "Preview PDF" }).click();
    const preview = await previewResponse;
    expect(preview.status()).toBe(200);
    expect(preview.headers()["content-type"]).toBe("application/pdf");
    // (The page read the body into a blob; fetch the same preview to look inside.)
    const previewPdf = await page.request.get(preview.url(), { headers: { "x-business-id": owner.businessId } });
    expect((await previewPdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    await (await previewTab).close();
    await design.getByRole("button", { name: "Save invoice design" }).click();
    await expect(toast(page, "Invoice design saved")).toBeVisible();
    await expect(design.getByRole("button", { name: "Save invoice design" })).toBeHidden();
    expect(await businessProfile(owner.businessId)).toMatchObject({ invoice_template: "tally", thermal_width: 58 });

    // ── Shipping: the business's own delivery method ────────────
    await settingsTab(page, "Shipping");
    await page.getByPlaceholder("e.g. Dunzo, Porter, Local Tempo").fill("Dunzo Express");
    await page.getByRole("checkbox", { name: "Has tracking" }).check();
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("row", { name: /Dunzo Express/ })).toContainText("Tracking");
    await expectNoHorizontalScroll(page, "settings / shipping");
    await page.getByRole("button", { name: "Save Shipping Settings" }).click();
    await expect(toast(page, "Shipping settings saved")).toBeVisible();
    expect((await businessProfile(owner.businessId)).custom_shipping_methods).toEqual([
      { id: "dunzo_express", label: "Dunzo Express", hasTracking: true },
    ]);

    // ── An invoice uses all of it ───────────────────────────────
    await openPage(page, "Invoices");
    await page.getByRole("button", { name: /New Invoice/ }).first().click();
    const form = dialog(page, "New Invoice");
    await pick(page, form.getByRole("combobox", { name: "Customer" }), buyer.name);
    await choose(page, form.getByRole("combobox", { name: "Delivery method" }), "Dunzo Express");
    await fillLine(page, form, 0, { item: item.name, qty: "2" });
    await expect(form.getByLabel("Terms & conditions")).toHaveValue(terms);
    // 2 × ₹1,000 + 18% IGST (Maharashtra seller, Karnataka buyer).
    await expect(form.getByTestId("document-total")).toHaveText(inr(2360));
    await expectNoHorizontalScroll(page, "new invoice");
    await form.getByRole("button", { name: "Create Invoice" }).click();
    await expect(toast(page, "Invoice J11S-00101 created")).toBeVisible();
    await expect(form).toBeHidden();

    const [invoice] = await invoicesNumbered(owner.businessId, ["J11S-00101"]);
    expect(invoice).toMatchObject({
      party_name: buyer.name,
      subtotal: "2000.00",
      tax_amount: "360.00",
      total_amount: "2360.00",
      delivery_method: "dunzo_express",
      terms_and_conditions: terms,
    });
    expect(await documentLines(invoice.id)).toMatchObject([{ item_id: item.id, quantity: "2.000", tax_percent: "18.00", tax_amount: "360.00" }]);
    expect(await documentStockMoves(invoice.id)).toEqual([{ itemId: item.id, batch: "(unbatched)", qty: -2 }]);
    expect((await itemStock(item.id)).total).toBe(48);
    // Inter-state: the split is IGST, decided by the two state codes.
    expect(await salesTaxByRate(buyer.id)).toMatchObject({ seller: "27", buyer: "29", rows: [{ rate: 18, taxable: 2000, tax: 360 }] });
    await listRow(page, "J11S-00101").click();
    const detail = dialog(page, "Invoice J11S-00101");
    await expect(detail.getByText("Dunzo Express")).toBeVisible();
    await expectNoHorizontalScroll(page, "invoice detail");
    // The invoice PDF comes out in the chosen (Tally) design, as a PDF.
    await detail.getByRole("button", { name: "Download PDF" }).click();
    const pdfResponse = page.waitForResponse((r) => /\/api\/invoices\/[0-9a-f-]+\/pdf\?format=a4$/.test(r.url()));
    const [pdfDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "GST Invoice (A4)" }).click(),
    ]);
    expect((await pdfResponse).headers()["content-type"]).toBe("application/pdf");
    expect(pdfDownload.suggestedFilename()).toBe("J11S-00101_a4.pdf");
    const invoicePdf = await readDownload(pdfDownload);
    expect(invoicePdf.subarray(0, 5).toString()).toBe("%PDF-");
    // All three copies (original, duplicate, triplicate) in one file: three times the pages.
    await detail.getByRole("button", { name: "Download PDF" }).click();
    const [copiesDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "GST Invoice, all copies" }).click(),
    ]);
    const pagesOf = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
    expect(pagesOf(await readDownload(copiesDownload))).toBe(pagesOf(invoicePdf) * 3);
    await detail.getByRole("button", { name: "Close", exact: true }).click();
    await navTo(page, "Settings");
    await settingsTab(page, "Documents");
    await expect(page.getByTestId("next-number-invoice")).toHaveText("102");

    // ── Barcodes: Code 128, many per item, locked ───────────────
    await settingsTab(page, "Barcodes");
    await page.getByRole("radio", { name: /^Code 128/ }).click();
    await page.getByRole("radio", { name: /^Many barcodes per item/ }).click();
    await expect(page.getByRole("complementary").getByText("75 × 25 mm").first()).toBeVisible();
    await expectNoHorizontalScroll(page, "settings / barcodes");
    await page.getByRole("button", { name: "Lock barcode setup" }).click();
    await dialog(page, "Lock barcode setup?").getByRole("button", { name: "Lock setup" }).click();
    await expect(toast(page, "Barcode setup locked")).toBeVisible();
    await expect(page.getByText(/^Locked on /)).toBeVisible();
    biz = await businessProfile(owner.businessId);
    expect(biz).toMatchObject({ barcodes_enabled: true, barcode_type: "code128", barcode_mode: "multi" });
    expect(biz.barcode_setup_locked_at).not.toBeNull();

    // ── Point-of-Sale ───────────────────────────────────────────
    await settingsTab(page, "Point-of-Sale");
    await page.getByRole("switch", { name: "Point-of-Sale mode" }).click();
    await expect(toast(page, "POS mode enabled")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Point-of-Sale mode" })).toBeChecked();
    await expectNoHorizontalScroll(page, "settings / pos");
    expect((await businessProfile(owner.businessId)).pos_enabled).toBe(true);

    // ── e-Invoicing settings (no IRP call) ──────────────────────
    await openPage(page, "e-Invoicing", "E-Invoicing");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    // Nothing saved yet: the app says so without going to the portal (the
    // API answers 404 NOT_FOUND, which the browser logs).
    guard.allow(/api\/trpc\/eInvoice\.testConnection/);
    await page.getByRole("button", { name: "Test Connection" }).click();
    await expect(page.getByText("E-invoice configuration not found. Please configure first.")).toBeVisible();
    await page.getByLabel("GSTIN").fill("27aapfu0939f1zv");
    await expect(page.getByLabel("GSTIN")).toHaveValue("27AAPFU0939F1ZV");
    await page.getByLabel("Username", { exact: true }).fill("j11-irp-user");
    await page.getByLabel("Password", { exact: true }).fill("j11-irp-pass");
    await expect(page.getByRole("switch", { name: /Use Sandbox/ })).toBeChecked();
    await page.getByRole("switch", { name: /Enable E-Invoicing/ }).check();
    await expectNoHorizontalScroll(page, "e-invoicing settings");
    await page.getByRole("button", { name: "Save Settings" }).click();
    await expect(toast(page, "E-invoice settings saved")).toBeVisible();
    expect(await eInvoiceConfig(owner.businessId)).toMatchObject({
      gstin: "27AAPFU0939F1ZV",
      username: "j11-irp-user",
      password: "j11-irp-pass", // no ENCRYPTION_KEY in this environment: stored as given
      client_id: null,
      is_sandbox: true,
      is_enabled: true,
      threshold_crore: "5.00",
    });
    // Back later: the password field is blank ("enter to update"); changing
    // only the threshold keeps the saved password.
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByLabel("Username", { exact: true })).toHaveValue("j11-irp-user");
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
    await page.getByLabel("Threshold (crore)").fill("10");
    await page.getByRole("button", { name: "Save Settings" }).click();
    await expect(toast(page, "E-invoice settings saved")).toBeVisible();
    expect(await eInvoiceConfig(owner.businessId)).toMatchObject({ password: "j11-irp-pass", threshold_crore: "10.00" });
    // Saved, but this server has no GSP client credentials: stopped before the IRP.
    await page.getByRole("button", { name: "Test Connection" }).click();
    await expect(page.getByText("IRP GSP credentials are not configured on this server. Contact your administrator.")).toBeVisible();

    // ── Data: Generic CSV import ────────────────────────────────
    const custA = `Nashik Grapes Co ${id}`;
    const suppB = `Surat Textiles ${id}`;
    const itemA = `Cotton Saree ${id}`;
    const itemB = `Silk Dupatta ${id}`;
    const partiesCsv = [
      "Party Name,Party Type,Mobile Number,GSTIN,State,City,Opening Balance",
      `${custA},Customer,9822033344,27AAACN1234F1Z5,Maharashtra,Nashik,1500`,
      `${suppB},Supplier,9824055566,24AAACS7777K1Z2,Gujarat,Surat,0`,
    ].join("\n");
    const itemsCsv = [
      "Item Name,Sale Price,Purchase Price,Tax Rate (%),HSN/SAC,Unit",
      `${itemA},2499,1600,5,5208,Pieces`,
      `${itemB},899,500,12,5007,Pieces`,
    ].join("\n");
    const today = istIsoDate();
    const invoicesCsv = [
      "Invoice No,Invoice Date,Party Name,Subtotal,Tax Amount,Total Amount",
      `OLD-${id}-1,${today},${custA},10000,500,10500`,
      `OLD-${id}-2,${today},${custA},2000,240,2240`,
    ].join("\n");

    await navTo(page, "Settings");
    await settingsTab(page, "Data");
    await expectNoHorizontalScroll(page, "settings / data");
    await page.getByRole("button", { name: "Start import" }).click();
    const wizard = dialog(page, "Import Data");
    await wizard.getByRole("button", { name: /^Generic CSV/ }).click();
    await wizard.getByRole("button", { name: "Continue" }).click();
    for (const [key, name, body] of [
      ["parties", "parties.csv", partiesCsv],
      ["items", "items.csv", itemsCsv],
      ["invoices", "invoices.csv", invoicesCsv],
    ] as const) {
      await chooseFile(page, wizard.getByTestId(`import-dropzone-${key}`), { name, mimeType: "text/csv", buffer: Buffer.from(body) });
      await expect(wizard.getByTestId(`import-dropzone-${key}`)).toContainText(name);
    }
    await expectNoHorizontalScroll(page, "import / upload");
    await wizard.getByRole("button", { name: "Continue" }).click();
    // Columns named after the fields are mapped without touching a dropdown.
    await expect(wizard.getByRole("combobox", { name: "Parties: Party Name column" })).toContainText("Party Name");
    await expect(wizard.getByRole("combobox", { name: "Items: HSN/SAC column" })).toContainText("HSN/SAC");
    await expect(wizard.getByRole("combobox", { name: "Invoices: Amount / Total Amount column" })).toContainText("Total Amount");
    await expectNoHorizontalScroll(page, "import / map");
    await wizard.getByRole("button", { name: "Continue" }).click();
    await expect(wizard.getByText(custA).first()).toBeVisible();
    await wizard.getByRole("button", { name: "Start Import" }).click();
    await expect(wizard.getByText(/Import complete/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(wizard.getByText("2 created")).toHaveCount(3);
    await expectNoHorizontalScroll(page, "import / done");
    await wizard.getByRole("button", { name: /^(Done|Close)$/ }).first().click();
    await expect(wizard).toBeHidden();

    const parties = await partiesOf(owner.businessId, [custA, suppB]);
    expect(parties).toMatchObject([
      { name: custA, type: "customer", phone: expect.stringContaining("9822033344"), gstin: "27AAACN1234F1Z5", state: "Maharashtra", opening_balance: "1500.00" },
      { name: suppB, type: "supplier", gstin: "24AAACS7777K1Z2", state: "Gujarat", opening_balance: "0.00" },
    ]);
    expect(await itemsOf(owner.businessId, [itemA, itemB])).toMatchObject([
      { name: itemA, hsn: "5208", unit: "pcs", sale_price: "2499.00", purchase_price: "1600.00", tax_percent: "5.00" },
      { name: itemB, hsn: "5007", unit: "pcs", sale_price: "899.00", purchase_price: "500.00", tax_percent: "12.00" },
    ]);
    const imported = await invoicesNumbered(owner.businessId, [`OLD-${id}-1`, `OLD-${id}-2`]);
    expect(imported).toMatchObject([
      { party_name: custA, type: "sale", status: "sent", subtotal: "10000.00", tax_amount: "500.00", total_amount: "10500.00", amount_paid: "0.00", source: "generic" },
      { party_name: custA, type: "sale", status: "sent", subtotal: "2000.00", tax_amount: "240.00", total_amount: "2240.00", amount_paid: "0.00", source: "generic" },
    ]);
    // The catch-all line keeps the CSV's taxable value and tax.
    expect(await documentLines(imported[0].id)).toMatchObject([{ quantity: "1.000", unit_price: "10000.00", tax_amount: "500.00", total_amount: "10500.00" }]);
    // Imported masters show in the app.
    await openPage(page, "Parties");
    await page.getByRole("searchbox", { name: "Search by name…" }).fill(custA);
    await expect(listRow(page, custA)).toHaveCount(1);
    await openPage(page, "Invoices");
    await expect(listRow(page, `OLD-${id}-1`)).toContainText(inr(10500));

    // ── Export: CSV bundle and full backup ──────────────────────
    await navTo(page, "Settings");
    await settingsTab(page, "Data");
    let downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV bundle" }).click();
    const csvZip = await downloading;
    expect(csvZip.suggestedFilename()).toBe(`fintranzact-export-${today}.zip`);
    await expect(toast(page, "Data exported successfully")).toBeVisible();
    const zip = await readDownload(csvZip);
    expect(zip.subarray(0, 2).toString()).toBe("PK");
    // The bundle is stored uncompressed: names and rows read straight off it.
    const zipText = zip.toString("utf8");
    for (const file of ["parties.csv", "items.csv", "invoices.csv", "invoice_line_items.csv", "payments.csv", "expenses.csv"]) {
      expect(zipText).toContain(file);
    }
    expect(zipText).toContain(custA);
    expect(zipText).toContain("J11S-00101");

    downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export tenant data" }).click();
    const backup = await downloading;
    await expect(toast(page, "Download started")).toBeVisible();
    expect(backup.suggestedFilename()).toMatch(/^fintranzact-.+\.tar\.gz$/);
    const tar = zlib.gunzipSync(await readDownload(backup)).toString("utf8");
    expect(tar).toContain(custA);
    expect(tar).toContain(`J11 Enterprises Private Limited ${id}`);

    // ── Account: API keys ───────────────────────────────────────
    await settingsTab(page, "Account");
    await page.getByRole("button", { name: "API Keys" }).click();
    await expect(page.getByText("No API keys created yet.")).toBeVisible();
    await page.getByRole("button", { name: "+ Create API Key" }).click();
    let keyDialog = dialog(page, "Create API Key");
    await keyDialog.getByPlaceholder("e.g. CLI Access Key").fill("J11 Tally sync");
    await expectNoHorizontalScroll(page, "create API key");
    await keyDialog.getByRole("button", { name: "Create Key" }).click();
    keyDialog = dialog(page, "API Key Created");
    const rawKey = (await keyDialog.locator("code").innerText()).trim();
    expect(rawKey).toMatch(/^fintranzact_key_[A-Za-z0-9_-]{20,}$/);
    await keyDialog.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("J11 Tally sync")).toBeVisible();
    const [keyRow] = await apiKeysOf(owner.userId);
    expect(keyRow).toMatchObject({ name: "J11 Tally sync", key_prefix: rawKey.slice(0, keyRow.key_prefix.length), expires_at: null });

    // The key works from outside the browser…
    const bearer = { Authorization: `Bearer ${rawKey}`, "x-business-id": owner.businessId };
    const listed = await page.request.get(`${API_URL}/api/trpc/business.list`, { headers: bearer });
    expect(listed.status()).toBe(200);
    expect(JSON.stringify(await listed.json())).toContain(owner.businessName);

    // …until it is revoked.
    await page.getByRole("button", { name: "Revoke", exact: true }).click();
    await dialog(page, "Revoke API key?").getByRole("button", { name: "Revoke" }).click();
    await expect(toast(page, "API key revoked")).toBeVisible();
    await expect(page.getByText("No API keys created yet.")).toBeVisible();
    expect(await apiKeysOf(owner.userId)).toEqual([]);
    const refused = await page.request.get(`${API_URL}/api/trpc/business.list`, { headers: bearer });
    expect(refused.status()).toBe(401);

    // ── Plan screen ─────────────────────────────────────────────
    await page.goto("/auth/plan-selection");
    await expect(page.getByRole("heading", { name: "Select the plan that fits your business" })).toBeVisible();
    await expectNoHorizontalScroll(page, "plan selection");
    await page.getByRole("button", { name: /^Pro / }).click();
    await expect(page.getByText(/Pro is set up by the Fintranzact team/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Start free and create your company" })).toBeVisible();
    await page.getByRole("button", { name: /^Recommended Forever Free/ }).click();
    await page.getByRole("button", { name: "Create your company" }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(await tenantPlan(owner.tenantId)).toBe("forever_free");

    // ── The same settings at night ──────────────────────────────
    const night = await newJourneyContext(browser, guard, {
      theme: "dark",
      storageState: await context.storageState(),
      viewport: page.viewportSize()!,
      hasTouch: isPhone(page),
    });
    const nightPage = await night.newPage();
    await nightPage.goto("/settings");
    await nightPage.getByRole("button", { name: `Open ${owner.businessName}` }).click();
    await expect(nightPage.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible({ timeout: 20_000 });
    await expectTheme(nightPage, "dark");
    await expect(nightPage.getByTestId("logo-uploader").getByRole("img", { name: "Current business logo" })).toBeVisible();
    await expectNoHorizontalScroll(nightPage, "settings (dark)");
    await night.close();
  });
});
