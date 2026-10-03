/**
 * J9 — GST filing, end to end, as the business owner does it in the app.
 *
 *   A month of sales and purchases entered through the invoice forms, each on
 *   the day it happens (the browser clock walks through last month in India):
 *   a B2C small service sale at 00:05 IST on the 1st (it must land in that
 *   month — and in the invoice list's "This Month"), two supplier bills with
 *   the supplier's own bill numbers, B2B same state (CGST + SGST), B2B other
 *   state with a document discount (IGST on the discounted value), B2C large
 *   other state above ₹1 lakh (B2CL), an exempt (0%) sale, a third bill, a
 *   credit note to the unregistered B2CL buyer (CDNUR) and one to a
 *   registered buyer (CDNR) — then:
 *
 *   GSTR-1: the screen's totals and tables (B2B, B2CL, B2CS, notes, HSN),
 *   the CSV and the portal JSON (b2b / b2cl / b2cs / nil / cdnr / cdnur / hsn,
 *   every rate line with `rt`, every HSN row with `uqc`);
 *   GSTR-3B: 3.1(a) net of the notes, 3.1(c) nil/exempt, table 4 ITC, net;
 *   GSTR-2B: a portal-format JSON uploaded and reconciled (matched on the
 *   supplier's bill number, one bill missing in the 2B, one 2B invoice
 *   missing in the books); the ITC dashboard; GSTR-9 for the year;
 *   CMP-08 for a second, composition-scheme business of the same owner.
 *
 * Masters (customers, suppliers, items, the second business) are seeded
 * through the API: J3 owns creating them in the UI.
 *
 * Expected figures are worked out by hand in helpers/gst-seed.ts (GST_DOCS,
 * GST_MONTH) and checked against the screens, the downloads and the database
 * (documents, tax split by state codes, stock movements, the ITC ledger, the
 * 2B reconciliation rows).
 *
 * Time: the browser runs in Asia/Kolkata (an Indian user) with its clock
 * walked through the month; the app's theme follows India time, so the 00:05
 * entry is checked in the dark theme and the daytime ones in the light theme.
 *
 * External services: none. GSTR-2B is the file a user downloads from the GST
 * portal — the journey writes a portal-format sample and uploads it; GSTR-1
 * and GSTR-9 JSON are only downloaded, never sent anywhere. No GSTIN lookup
 * (parties are seeded), no GSP/IRP/e-way bill call (e-invoicing is off).
 * Exports (zero-rated supplies) are not covered: the app has no export
 * invoice type or GSTR-1 EXP table.
 */
import { readFileSync } from "node:fs";
import type { Download, Locator, Page } from "@playwright/test";
import { test, expect, expectNoHorizontalScroll, expectTheme, isPhone, toast } from "../../helpers/journey";
import { seedOwner, type SeededOwner } from "../../helpers/journey-seed";
import { choose, closePanel, dialog, fillLine, inr, listRow, openBusiness, openPage, pick } from "../../helpers/journey-ui";
import {
  GST_DOCS,
  GST_MONTH,
  GSTIN,
  istAt,
  istMidnight,
  lastMonthInIndia,
  portalDate,
  seedGstMasters,
  type GstDoc,
  type GstMasters,
  type GstPeriod,
} from "../../helpers/gst-seed";
import { gstDocuments, gstLines, gstr2bUpload, itcLedgerFor, stockByReference, taxableOf, taxHeadsOf } from "../../helpers/gst-db";
import { documentStockMoves, itemStock } from "../../helpers/db";

test.use({ timezoneId: "Asia/Kolkata" });

// ── Helpers ─────────────────────────────────────────────────────

/** The value on one of the app's stat cards, by its label. */
function statCard(scope: Page | Locator, label: string) {
  return scope.getByText(label, { exact: true }).locator("xpath=following-sibling::p[1]");
}

async function readDownload(download: Download) {
  return readFileSync((await download.path())!, "utf-8");
}

/** Move the browser clock to `day` hh:mm India time in the month. */
async function at(page: Page, p: GstPeriod, day: number, hh: number, mm: number) {
  await page.clock.setSystemTime(istAt(p, day, hh, mm));
}

type Booked = { id: string; number: string };

/**
 * Enter one of the month's documents the way the owner does: a sale or a
 * bill from the Invoices page, a credit note from the invoice it is against.
 */
async function enterDocument(page: Page, m: GstMasters, doc: GstDoc, booked: Record<string, Booked>) {
  const partyName = m[doc.party].name;
  if (doc.kind === "credit_note") {
    const against = booked[doc.against!];
    await openPage(page, "Invoices");
    await page.getByRole("button", { name: "Sales", exact: true }).click();
    await listRow(page, against.number).click();
    const detail = dialog(page, `Invoice ${against.number}`);
    await detail.getByRole("button", { name: "Issue Credit Note" }).click();
    const form = dialog(page, "New Credit Note");
    // The invoice's lines are copied in: keep the one coming back, at its quantity.
    const lines = form.getByTestId("document-line");
    const keep = m[doc.lines[0].item].name;
    while ((await lines.count()) > 1) {
      const other = lines.filter({ hasNot: page.locator(`input[value="${keep}"]`) }).first();
      await other.getByRole("button", { name: "Remove line" }).click();
    }
    await lines.first().getByLabel("Quantity", { exact: true }).fill(String(doc.lines[0].qty));
    await expect(form.getByTestId("document-subtotal")).toHaveText(inr(doc.taxable));
    await expect(form.getByTestId("document-tax")).toHaveText(inr(doc.tax));
    await expect(form.getByTestId("document-total")).toHaveText(inr(doc.total));
    await expectNoHorizontalScroll(page, "new credit note");
    await form.getByRole("button", { name: "Create Credit Note" }).click();
    await expect(toast(page, "Credit Note created")).toBeVisible();
    await expect(form).toBeHidden();
    return;
  }

  await openPage(page, "Invoices");
  await page.getByRole("button", { name: doc.kind === "sale" ? "Sales" : "Purchases", exact: true }).click();
  await page.getByRole("button", { name: /New Invoice/ }).first().click();
  const form = dialog(page, "New Invoice");
  await pick(page, form.getByRole("combobox", { name: doc.kind === "sale" ? "Customer" : "Supplier" }), partyName);
  if (doc.supplierInvoiceNumber) await form.getByLabel("Supplier invoice no.").fill(doc.supplierInvoiceNumber);
  for (const [i, line] of doc.lines.entries()) {
    await fillLine(page, form, i, { item: m[line.item].name, qty: String(line.qty) });
    // The item's own price and rate come in.
    const row = form.getByTestId("document-line").nth(i);
    await expect(row.getByLabel("Unit price")).toHaveValue(line.price.toFixed(2));
    await expect(row.getByLabel("Tax percent")).toHaveValue(line.tax.toFixed(2));
  }
  if (doc.discount) await form.getByLabel("Document discount").fill(String(doc.discount));
  await expect(form.getByTestId("document-tax")).toHaveText(inr(doc.tax));
  await expect(form.getByTestId("document-total")).toHaveText(inr(doc.total));
  await expectNoHorizontalScroll(page, `new ${doc.kind} invoice`);
  // The last document's toast must be gone, or the number below would be read from it.
  await expect(toast(page, /^Invoice INV-\d+ created$/)).toHaveCount(0);
  await form.getByRole("button", { name: "Create Invoice" }).click();
  const created = toast(page, /^Invoice INV-\d+ created$/);
  await expect(created).toBeVisible();
  await expect(form).toBeHidden();
  await markSent(page, (await created.innerText()).match(/INV-\d+/)![0]);
}

/** Issue an invoice: out of draft (a credit note can only be raised on an issued invoice). */
async function markSent(page: Page, number: string) {
  await listRow(page, number).click();
  const detail = dialog(page, `Invoice ${number}`);
  await detail.getByRole("button", { name: "Mark Sent" }).click();
  await expect(toast(page, "Invoice status updated")).toBeVisible();
  await expect(detail.getByText("Sent", { exact: true }).first()).toBeVisible();
  await closePanel(detail);
}

// ── Journey ─────────────────────────────────────────────────────

test.describe("J9 GST filing", () => {
  test.setTimeout(600_000);

  test("a month of sales & purchases → GSTR-1 (screen, CSV, portal JSON) → GSTR-3B → GSTR-2B reconcile → ITC → GSTR-9 → CMP-08", async ({
    context,
    page,
  }) => {
    const p = lastMonthInIndia();
    const owner = await seedOwner(context, "j9");
    const m = await seedGstMasters(owner);

    // ── The 1st, 00:05 IST: the first sale of the month (dark theme) ──
    await at(page, p, 1, 0, 5);
    await openBusiness(page, owner);
    await expectTheme(page, "dark");

    const booked: Record<string, Booked> = {};
    for (const doc of GST_DOCS) {
      await at(page, p, doc.day, doc.hh, doc.mm);
      await enterDocument(page, m, doc, booked);

      // Stored as entered: dated that day in India, totals and tax split
      // from the business's and the party's state codes.
      const docs = await gstDocuments(owner.businessId);
      const kind = doc.kind === "credit_note" ? "credit_note" : "invoice";
      const type = doc.kind === "purchase" ? "purchase" : "sale";
      const mine = docs.filter((d) => d.party_id === m[doc.party].id && d.document_type === kind && d.type === type);
      const row = mine[mine.length - 1];
      expect(row, `${doc.key} saved`).toBeTruthy();
      expect(row.invoice_date.toISOString(), `${doc.key} is dated the ${doc.day}th in India`).toBe(istMidnight(p, doc.day).toISOString());
      expect({ taxable: taxableOf(row), tax: Number(row.tax_amount), total: Number(row.total_amount) }).toEqual({
        taxable: doc.taxable,
        tax: doc.tax,
        total: doc.total,
      });
      expect(row.supplier_invoice_number).toBe(doc.supplierInvoiceNumber ?? null);
      if (doc.against) expect(row.reference_document_id).toBe(booked[doc.against].id);
      const lines = await gstLines(row.id);
      expect(lines.map((l) => ({ item: l.item_id, qty: Number(l.quantity), rate: Number(l.tax_percent) }))).toEqual(
        doc.lines.map((l) => ({ item: m[l.item].id, qty: l.qty, rate: l.tax })),
      );
      booked[doc.key] = { id: row.id, number: row.invoice_number };

      // Stock: sales out, bills in, credit notes (no goods back) nothing; services never.
      const moves = await documentStockMoves(row.id);
      const goods = doc.lines.filter((l) => l.item !== "install");
      const sign = doc.kind === "sale" ? -1 : 1;
      expect(moves.map((mv) => ({ itemId: mv.itemId, qty: mv.qty })).sort((a, b) => a.itemId.localeCompare(b.itemId))).toEqual(
        doc.kind === "credit_note"
          ? []
          : goods.map((l) => ({ itemId: m[l.item].id, qty: sign * l.qty })).sort((a, b) => a.itemId.localeCompare(b.itemId)),
      );
    }

    // ── The tax split of every document, from the database ─────────
    const docs = await gstDocuments(owner.businessId);
    const byKey = Object.fromEntries(Object.entries(booked).map(([k, v]) => [k, docs.find((d) => d.id === v.id)!]));
    expect(taxHeadsOf(byKey.boundary)).toEqual({ cgst: 180, sgst: 180, igst: 0 });
    expect(taxHeadsOf(byKey.b2bIntra)).toEqual({ cgst: 1020, sgst: 1020, igst: 0 });
    expect(taxHeadsOf(byKey.b2bInter)).toEqual({ cgst: 0, sgst: 0, igst: 1140 });
    expect(taxHeadsOf(byKey.b2cl)).toEqual({ cgst: 0, sgst: 0, igst: 18000 });
    expect(taxHeadsOf(byKey.exempt)).toEqual({ cgst: 0, sgst: 0, igst: 0 });
    expect(taxHeadsOf(byKey.cnUnreg)).toEqual({ cgst: 0, sgst: 0, igst: 1800 });
    expect(taxHeadsOf(byKey.cnReg)).toEqual({ cgst: 180, sgst: 180, igst: 0 });
    expect(taxHeadsOf(byKey.bill118)).toEqual({ cgst: 7560, sgst: 7560, igst: 0 });
    expect(taxHeadsOf(byKey.bill42)).toEqual({ cgst: 0, sgst: 0, igst: 1080 });
    // The discount came off the value before tax: 12% of ₹9,500.
    expect(byKey.b2bInter).toMatchObject({ subtotal: "10000.00", discount_amount: "500.00", tax_amount: "1140.00" });
    // GSTR-1 totals worked out from the stored invoices.
    const sales = docs.filter((d) => d.type === "sale" && d.document_type === "invoice");
    expect(sales).toHaveLength(GST_MONTH.gstr1.invoiceCount);
    expect(sales.reduce((s, d) => s + taxableOf(d), 0)).toBe(GST_MONTH.gstr1.taxable);
    expect(sales.reduce((s, d) => s + Number(d.total_amount), 0)).toBe(GST_MONTH.gstr1.value);

    // Stock at the end of the month
    expect((await itemStock(m.bracket.id)).total).toBe(GST_MONTH.stock.bracket);
    expect((await itemStock(m.tonic.id)).total).toBe(GST_MONTH.stock.tonic);
    expect((await itemStock(m.rice.id)).total).toBe(GST_MONTH.stock.rice);
    expect(await stockByReference(m.install.id)).toEqual({});

    // ITC ledger: one available entry per bill, in the month's return period
    const itc = await itcLedgerFor(owner.businessId, p.returnPeriod);
    expect(itc.map((e) => ({ id: e.invoice_id, status: e.status, cgst: Number(e.cgst), sgst: Number(e.sgst), igst: Number(e.igst) }))).toEqual([
      { id: booked.bill118.id, status: "available", cgst: 7560, sgst: 7560, igst: 0 },
      { id: booked.bill42.id, status: "available", cgst: 0, sgst: 0, igst: 1080 },
      { id: booked.bill131.id, status: "available", cgst: 630, sgst: 630, igst: 0 },
    ]);

    // ── Month-end, daytime: the invoice list still has the 1st's sale ──
    await at(page, p, 28, 11, 0);
    await page.reload();
    await expectTheme(page, "light");
    await openPage(page, "Invoices");
    await page.getByRole("button", { name: "Sales", exact: true }).click();
    await expect(page.getByRole("button", { name: "Date range: This Month" }).first()).toBeVisible();
    for (const key of ["boundary", "b2bIntra", "b2bInter", "b2cl", "exempt"]) {
      await expect(listRow(page, booked[key].number)).toHaveCount(1);
    }

    // ── GSTR-1 on screen ─────────────────────────────────────────
    await openPage(page, "GST Returns");
    const tabs = page.getByTestId("gst-report-tabs");
    await tabs.getByRole("button", { name: "GSTR-1", exact: true }).click();
    await choose(page, page.getByRole("combobox", { name: "Month", exact: true }), p.monthName);
    await choose(page, page.getByRole("combobox", { name: "Year", exact: true }), String(p.year));
    const g1 = GST_MONTH.gstr1;
    await expect(statCard(page, "Invoice Count")).toHaveText(String(g1.invoiceCount));
    await expect(statCard(page, "Taxable Value")).toHaveText(inr(g1.taxable));
    await expect(statCard(page, "Total Tax")).toHaveText(inr(g1.tax));
    await expect(statCard(page, "Total Value")).toHaveText(inr(g1.value));
    await expect(statCard(page, "CGST")).toHaveText(inr(g1.cgst));
    await expect(statCard(page, "SGST")).toHaveText(inr(g1.sgst));
    await expect(statCard(page, "IGST")).toHaveText(inr(g1.igst));
    await expectNoHorizontalScroll(page, "GSTR-1");

    const cells = (table: string, text: string) => page.getByTestId(table).getByRole("row").filter({ hasText: text }).getByRole("cell");
    await expect(cells("gstr1-b2b", booked.b2bIntra.number)).toHaveText([GSTIN.pune, m.pune.name, booked.b2bIntra.number, inr(12000), inr(1020), inr(1020), inr(0), inr(14040)]);
    await expect(cells("gstr1-b2b", booked.b2bInter.number)).toHaveText([GSTIN.tumkur, m.tumkur.name, booked.b2bInter.number, inr(9500), inr(0), inr(0), inr(1140), inr(10640)]);
    await expect(page.getByTestId("gstr1-b2b").getByRole("row")).toHaveCount(3);
    await expect(cells("gstr1-b2cl", booked.b2cl.number)).toHaveText(["Gujarat", booked.b2cl.number, /\d/, inr(100000), inr(18000), inr(118000)]);
    const b2csRows = page.getByTestId("gstr1-b2cs").getByRole("row");
    await expect(b2csRows).toHaveCount(3);
    await expect(b2csRows.nth(1).getByRole("cell")).toHaveText(["18%", "Intra-state", "27", inr(2000), inr(180), inr(180), inr(0)]);
    await expect(b2csRows.nth(2).getByRole("cell")).toHaveText(["0% (nil / exempt)", "Intra-state", "27", inr(2000), inr(0), inr(0), inr(0)]);
    await expect(cells("gstr1-notes", booked.cnUnreg.number)).toHaveText(["CDNUR", booked.cnUnreg.number, "Credit", booked.b2cl.number, m.anand.name, inr(10000), inr(0), inr(0), inr(1800), inr(11800)]);
    await expect(cells("gstr1-notes", booked.cnReg.number)).toHaveText(["CDNR", booked.cnReg.number, "Credit", booked.b2bIntra.number, m.pune.name, inr(2000), inr(180), inr(180), inr(0), inr(2360)]);
    // HSN: net of the notes (12 brackets credited), services without a quantity
    const hsn = (code: string) => page.getByTestId("gstr1-hsn").getByRole("row").filter({ hasText: new RegExp(`^${code}`) }).getByRole("cell");
    await expect(hsn("998719")).toHaveText(["998719", "NA", "0", "18%", inr(2000), inr(180), inr(180), inr(0)]);
    await expect(hsn("7326")).toHaveText(["7326", "PCS", "98", "18%", inr(98000), inr(720), inr(720), inr(16200)]);
    await expect(hsn("3004")).toHaveText(["3004", "BTL", "24", "12%", inr(11500), inr(120), inr(120), inr(1140)]);
    await expect(hsn("1006")).toHaveText(["1006", "KGS", "40", "0%", inr(2000), inr(0), inr(0), inr(0)]);

    // ── GSTR-1 CSV ──────────────────────────────────────────────
    let downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export GSTR-1 CSV" }).click();
    let download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`GSTR1_${p.label.replace(" ", "_")}.csv`);
    await expect(toast(page, "GSTR-1 CSV exported")).toBeVisible();
    const csv = (await readDownload(download)).split("\n");
    const d = (day: number) => portalDate(p, day).replace(/-/g, "/");
    expect(csv).toEqual(
      expect.arrayContaining([
        `Period,${p.label}`,
        `GSTIN,${GSTIN.business}`,
        `${GSTIN.pune},"${m.pune.name}",${booked.b2bIntra.number},${d(4)},Regular,12000.00,1020.00,1020.00,0.00,14040.00`,
        `${GSTIN.tumkur},"${m.tumkur.name}",${booked.b2bInter.number},${d(5)},Regular,9500.00,0.00,0.00,1140.00,10640.00`,
        "18,2000.00,180.00,180.00,0.00",
        "0,2000.00,0.00,0.00,0.00",
        `"Gujarat",${booked.b2cl.number},${d(8)},100000.00,18000.00,118000.00`,
        `CDNUR,Credit,${booked.cnUnreg.number},${d(12)},${booked.b2cl.number},,"${m.anand.name}",10000.00,0.00,0.00,1800.00,11800.00`,
        `CDNR,Credit,${booked.cnReg.number},${d(15)},${booked.b2bIntra.number},${GSTIN.pune},"${m.pune.name}",2000.00,180.00,180.00,0.00,2360.00`,
        `7326,"${m.bracket.name}",PCS,98,18,98000.00,720.00,720.00,16200.00,115640.00`,
        `998719,"${m.install.name}",NA,0,18,2000.00,180.00,180.00,0.00,2360.00`,
        `Total Invoices,${g1.invoiceCount}`,
        `Total Taxable Value,${g1.taxable.toFixed(2)}`,
        `Total Invoice Value,${g1.value.toFixed(2)}`,
      ]),
    );

    // ── GSTR-1 portal JSON ─────────────────────────────────────────
    downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download Portal JSON (GSTN)" }).click();
    download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`GSTR1_${p.label.replace(" ", "_")}_portal.json`);
    await expect(toast(page, "GSTR-1 portal JSON downloaded")).toBeVisible();
    const portal = JSON.parse(await readDownload(download));
    expect(Object.keys(portal).sort()).toEqual(["b2b", "b2cl", "b2cs", "cdnr", "cdnur", "fp", "gstin", "hsn", "nil"]);
    expect(portal).toMatchObject({ gstin: GSTIN.business, fp: p.fp });
    // Every rate line carries a valid rate; every HSN row a UQC.
    const SLABS = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];
    const rateLines = [
      ...portal.b2b.flatMap((c: any) => c.inv.flatMap((i: any) => i.itms.map((x: any) => x.itm_det))),
      ...portal.b2cl.flatMap((c: any) => c.inv.flatMap((i: any) => i.itms.map((x: any) => x.itm_det))),
      ...portal.cdnr.flatMap((c: any) => c.nt.flatMap((n: any) => n.itms.map((x: any) => x.itm_det))),
      ...portal.cdnur.flatMap((n: any) => n.itms.map((x: any) => x.itm_det)),
      ...portal.b2cs,
      ...portal.hsn.data,
    ];
    for (const line of rateLines) expect(SLABS, JSON.stringify(line)).toContain(line.rt);
    for (const row of portal.hsn.data) expect(row.uqc, JSON.stringify(row)).toMatch(/^[A-Z]{2,3}$/);
    expect(portal.b2b).toEqual([
      {
        ctin: GSTIN.pune,
        inv: [
          {
            inum: booked.b2bIntra.number,
            idt: portalDate(p, 4),
            val: 14040,
            pos: "27",
            rchrg: "N",
            inv_typ: "R",
            itms: [
              { num: 1, itm_det: { txval: 2000, rt: 12, iamt: 0, camt: 120, samt: 120, csamt: 0 } },
              { num: 2, itm_det: { txval: 10000, rt: 18, iamt: 0, camt: 900, samt: 900, csamt: 0 } },
            ],
          },
        ],
      },
      {
        ctin: GSTIN.tumkur,
        inv: [
          {
            inum: booked.b2bInter.number,
            idt: portalDate(p, 5),
            val: 10640,
            pos: "29",
            rchrg: "N",
            inv_typ: "R",
            itms: [{ num: 1, itm_det: { txval: 9500, rt: 12, iamt: 1140, camt: 0, samt: 0, csamt: 0 } }],
          },
        ],
      },
    ]);
    expect(portal.b2cl).toEqual([
      {
        pos: "24",
        inv: [{ inum: booked.b2cl.number, idt: portalDate(p, 8), val: 118000, itms: [{ num: 1, itm_det: { txval: 100000, rt: 18, iamt: 18000, csamt: 0 } }] }],
      },
    ]);
    expect(portal.b2cs).toEqual([{ sply_ty: "INTRA", pos: "27", typ: "OE", txval: 2000, rt: 18, camt: 180, samt: 180, iamt: 0, csamt: 0 }]);
    expect(portal.nil).toEqual({ inv: [{ sply_ty: "INTRAB2C", nil_amt: 2000, expt_amt: 0, ngsup_amt: 0 }] });
    expect(portal.cdnr).toEqual([
      {
        ctin: GSTIN.pune,
        nt: [
          {
            ntty: "C",
            nt_num: booked.cnReg.number,
            nt_dt: portalDate(p, 15),
            val: 2360,
            pos: "27",
            rchrg: "N",
            inv_typ: "R",
            itms: [{ num: 1, itm_det: { txval: 2000, rt: 18, iamt: 0, camt: 180, samt: 180, csamt: 0 } }],
          },
        ],
      },
    ]);
    expect(portal.cdnur).toEqual([
      {
        typ: "B2CL",
        ntty: "C",
        nt_num: booked.cnUnreg.number,
        nt_dt: portalDate(p, 12),
        val: 11800,
        pos: "24",
        itms: [{ num: 1, itm_det: { txval: 10000, rt: 18, iamt: 1800, csamt: 0 } }],
      },
    ]);
    expect(portal.hsn.data.map((r: any) => [r.hsn_sc, r.uqc, r.qty, r.rt, r.txval, r.iamt, r.camt, r.samt])).toEqual([
      ["998719", "NA", 0, 18, 2000, 0, 180, 180],
      ["7326", "PCS", 98, 18, 98000, 16200, 720, 720],
      ["3004", "BTL", 24, 12, 11500, 1140, 120, 120],
      ["1006", "KGS", 40, 0, 2000, 0, 0, 0],
    ]);
    // The return balances: B2B + B2CL + B2CS + nil − notes = HSN taxable value
    const hsnTaxable = portal.hsn.data.reduce((s: number, r: any) => s + r.txval, 0);
    expect(hsnTaxable).toBe(g1.taxable - 12000);

    // ── GSTR-3B ──────────────────────────────────────────────────
    await tabs.getByRole("button", { name: "GSTR-3B", exact: true }).click();
    const g3 = GST_MONTH.gstr3b;
    const t31 = page.getByTestId("gstr3b-3-1");
    await expect(t31.getByRole("row").filter({ hasText: "(a) Outward taxable supplies" }).getByRole("cell")).toHaveText([
      /^\(a\)/,
      inr(g3.outward.taxable),
      inr(g3.outward.igst),
      inr(g3.outward.cgst),
      inr(g3.outward.sgst),
    ]);
    await expect(t31.getByRole("row").filter({ hasText: "(c) Other outward supplies" }).getByRole("cell")).toHaveText([
      /^\(c\)/,
      inr(g3.exempt),
      inr(0),
      inr(0),
      inr(0),
    ]);
    await expect(statCard(page, "ITC — IGST")).toHaveText(inr(g3.itc.igst));
    await expect(statCard(page, "ITC — CGST")).toHaveText(inr(g3.itc.cgst));
    await expect(statCard(page, "ITC — SGST")).toHaveText(inr(g3.itc.sgst));
    await expect(statCard(page, "Total ITC available")).toHaveText(inr(g3.itc.total));
    await expect(statCard(page, "Net IGST")).toHaveText(inr(g3.net.igst));
    await expect(statCard(page, "Net CGST")).toHaveText(inr(g3.net.cgst));
    await expect(statCard(page, "Net SGST")).toHaveText(inr(g3.net.sgst));
    await expect(page.getByText("Total payable", { exact: true }).locator("xpath=following-sibling::p[1]")).toHaveText(inr(g3.net.total));
    await expectNoHorizontalScroll(page, "GSTR-3B");
    // 3.1(a) from the database: sales less both notes, without the 0% sale.
    const notesTaxable = taxableOf(byKey.cnUnreg) + taxableOf(byKey.cnReg);
    expect(g1.taxable - notesTaxable - taxableOf(byKey.exempt)).toBe(g3.outward.taxable);

    // ── GSTR-2B: the portal's statement for the month, uploaded ─────
    const g2b = {
      gstin: GSTIN.business,
      rtnprd: p.fp,
      data: {
        docdata: {
          b2b: [
            {
              ctin: GSTIN.bhiwandi,
              trdnm: "BHIWANDI STEEL DISTRIBUTORS",
              inv: [
                {
                  inum: "BPD/2627/118",
                  dt: portalDate(p, 2),
                  val: 102620,
                  pos: "27",
                  rev: "N",
                  itcavl: "Y",
                  typ: "R",
                  items: [
                    { num: 1, rt: 18, txval: 84000, cgst: 7560, sgst: 7560, igst: 0, cess: 0 },
                    { num: 2, rt: 0, txval: 3500, cgst: 0, sgst: 0, igst: 0, cess: 0 },
                  ],
                },
              ],
            },
            {
              ctin: GSTIN.bengaluru,
              trdnm: "BENGALURU HERBALS",
              inv: [
                {
                  inum: "KAR-INV-0042",
                  dt: portalDate(p, 3),
                  val: 10080,
                  pos: "27",
                  rev: "N",
                  itcavl: "Y",
                  typ: "R",
                  items: [{ num: 1, rt: 12, txval: 9000, cgst: 0, sgst: 0, igst: 1080, cess: 0 }],
                },
              ],
            },
            {
              ctin: GSTIN.thane,
              trdnm: "THANE PACKAGING",
              inv: [
                {
                  inum: "TPK-77",
                  dt: portalDate(p, 9),
                  val: 5900,
                  pos: "27",
                  rev: "N",
                  itcavl: "Y",
                  typ: "R",
                  items: [{ num: 1, rt: 18, txval: 5000, cgst: 450, sgst: 450, igst: 0, cess: 0 }],
                },
              ],
            },
          ],
        },
      },
    };

    await openPage(page, "GSTR-2B Recon", "GSTR-2B Reconciliation");
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await choose(page, page.getByRole("combobox", { name: "Select month" }), p.monthName);
    await choose(page, page.getByRole("combobox", { name: "Select year" }), String(p.year));
    await expect(page.getByText(`Return period: ${p.monthName} ${p.year}`)).toBeVisible();
    await expectNoHorizontalScroll(page, "GSTR-2B upload");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload GSTR-2B file" }).click();
    // The file as the portal names it (handed over as a file, like a user picking it)
    await (await chooser).setFiles({ name: `${GSTIN.business}_GSTR2B_${p.fp}.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(g2b, null, 2)) });
    await expect(toast(page, "3 records processed — 2 matched, 1 missing in books.")).toBeVisible();

    // Reconciliation (the page moves there after the upload)
    await expect(page.getByRole("button", { name: "Reconciliation", exact: true })).toHaveAttribute("aria-pressed", "true");
    const bigCard = (label: string) => page.getByText(label, { exact: true }).locator("xpath=following-sibling::p[1]");
    await expect(bigCard("Matched")).toHaveText("2");
    await expect(bigCard("Mismatched")).toHaveText("0");
    await expect(bigCard("Not in Books")).toHaveText("1");
    const recRow = (inum: string) => page.getByRole("row").filter({ hasText: inum });
    await expect(recRow("BPD/2627/118")).toContainText("Matched");
    await expect(recRow("KAR-INV-0042")).toContainText("Matched");
    await expect(recRow("TPK-77")).toContainText("Not in Books");
    await expectNoHorizontalScroll(page, "GSTR-2B reconciliation");

    await page.getByRole("button", { name: "Not in Books", exact: true }).click();
    await expect(recRow("TPK-77")).toContainText(GSTIN.thane);
    await page.getByRole("button", { name: "Not in 2B", exact: true }).click();
    const missing = recRow("BPD/2627/131");
    await expect(missing).toContainText(m.bhiwandi.name);
    await expect(missing).toContainText(booked.bill131.number);
    await expect(missing).toContainText(inr(8260));
    await expect(page.getByRole("row").filter({ hasText: "KAR-INV-0042" })).toHaveCount(0);
    await expectNoHorizontalScroll(page, "GSTR-2B not in 2B");

    const rec = await gstr2bUpload(owner.businessId, p.returnPeriod);
    expect(rec!.upload).toMatchObject({ total_records: 3, matched_records: 2, unmatched_records: 0 });
    expect(rec!.records.map((r) => ({ inum: r.invoice_number, status: r.match_status, invoice: r.matched_invoice_id }))).toEqual([
      { inum: "BPD/2627/118", status: "matched", invoice: booked.bill118.id },
      { inum: "KAR-INV-0042", status: "matched", invoice: booked.bill42.id },
      { inum: "TPK-77", status: "missing_in_books", invoice: null },
    ]);

    // ── ITC dashboard for the month ─────────────────────────────
    await openPage(page, "Input Tax Credit");
    await choose(page, page.getByRole("combobox", { name: "Select month" }), p.monthName);
    await choose(page, page.getByRole("combobox", { name: "Select year" }), String(p.year));
    await expect(page.getByText("Available ITC", { exact: true }).locator("..")).toContainText(inr(g3.itc.total));
    await expectNoHorizontalScroll(page, "ITC dashboard");
    await page.getByRole("button", { name: "GSTR-3B Table 4" }).click();
    const allOther = page.getByRole("row").filter({ hasText: "(5) All other ITC" });
    await expect(allOther.getByRole("cell")).toHaveText(["(5) All other ITC", inr(g3.itc.igst), inr(g3.itc.cgst), inr(g3.itc.sgst), inr(0)]);

    // ── GSTR-9 for the financial year ──────────────────────────────
    await openPage(page, "GST Returns");
    await tabs.getByRole("button", { name: "GSTR-9", exact: true }).click();
    const fy = `FY ${p.fyStart}-${String(p.fyStart + 1).slice(2)}`;
    await choose(page, page.getByRole("combobox", { name: "Financial year" }), new RegExp(`^${fy}`));
    const g9 = (label: string) => page.getByRole("row").filter({ has: page.getByRole("cell", { name: label, exact: true }) }).getByRole("cell");
    await expect(g9("4A")).toContainText([inr(21500), inr(1020), inr(1020), inr(1140)]);
    await expect(g9("4B")).toContainText([inr(102000), inr(180), inr(180), inr(18000)]);
    await expect(g9("4I")).toContainText([inr(12000), inr(180), inr(180), inr(1800)]);
    await expect(g9("5B")).toContainText([inr(2000)]);
    await expect(g9("6A")).toHaveText(["6A", "Total ITC as per auto-populated GSTR-3B", inr(1080), inr(8190), inr(8190), inr(0)]);
    await expectNoHorizontalScroll(page, "GSTR-9");
    downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download Portal JSON (GSTN)" }).click();
    download = await downloadPromise;
    const g9json = JSON.parse(await readDownload(download));
    expect(g9json).toMatchObject({
      gstin: GSTIN.business,
      table4: {
        "4A": { txval: 21500, camt: 1020, samt: 1020, iamt: 1140 },
        "4B": { txval: 102000, camt: 180, samt: 180, iamt: 18000 },
        "4I": { txval: 12000, camt: 180, samt: 180, iamt: 1800 },
      },
      table5: { "5B": { txval: 2000 } },
      table6: { "6A": { camt: 8190, samt: 8190, iamt: 1080 } },
    });

    // ── CMP-08: the owner's composition-scheme business ─────────────
    await composition(page, owner, p);
  });
});

/**
 * A second business of the same owner, under the composition scheme: it
 * bills without tax and pays 1% of its turnover each quarter on CMP-08.
 */
async function composition(page: Page, owner: SeededOwner, p: GstPeriod) {
  const api = owner.api;
  const name = `${owner.businessName} Kirana`;
  const biz = await api.mutate<{ id: string }>("business.create", {
    name,
    gstRegistrationType: "composition",
    gstin: "27AABCU9603R1ZM",
    pan: "AABCU9603R",
    phone: "+919876500002",
    address: "5 Market Road",
    addressLine1: "5 Market Road",
    city: "Thane",
    state: "Maharashtra",
    stateCode: "27",
    pincode: "400601",
    countryOfOperations: "India",
    currency: "INR",
  });
  const prev = api.businessId;
  api.businessId = biz.id;
  const customer = await api.mutate<{ id: string; name: string }>("party.create", {
    name: `Thane Canteen ${owner.businessId.slice(0, 6)}`,
    type: "customer",
    state: "Maharashtra",
    stateCode: "27",
    gstRegistrationType: "unregistered",
  });
  const grocery = await api.mutate<{ id: string; name: string }>("item.create", {
    name: `Grocery Hamper ${owner.businessId.slice(0, 6)}`,
    hsn: "2106",
    unit: "pcs",
    itemMode: "simple",
    itemType: "product",
    salePrice: "2500.00",
    purchasePrice: "2000.00",
    taxPercent: "0",
    stockQuantity: "0",
    taxInclusive: false,
  });
  api.businessId = prev;

  // Switch to it from the sidebar's business menu (on a fresh load: the
  // business was set up outside this page, J1's journey owns doing it here)
  await page.reload();
  await expect(page.getByTestId("app-sidebar")).toBeAttached();
  if (isPhone(page)) await page.getByRole("button", { name: "Open navigation menu" }).click();
  await page.getByRole("button", { name: /Switch business$/ }).click();
  await page.getByRole("menuitem", { name: new RegExp(name) }).click();
  await expect(page.getByTestId("app-sidebar")).toContainText(name);

  // Two bills of supply and a credit note in the month
  const m = { customer, grocery };
  const sell = async (day: number, qty: number) => {
    await page.clock.setSystemTime(istAt(p, day, 13, 0));
    await openPage(page, "Invoices");
    await page.getByRole("button", { name: /New Invoice/ }).first().click();
    const form = dialog(page, "New Invoice");
    await pick(page, form.getByRole("combobox", { name: "Customer" }), m.customer.name);
    await fillLine(page, form, 0, { item: m.grocery.name, qty: String(qty) });
    await expect(form.getByTestId("document-total")).toHaveText(inr(qty * 2500));
    await form.getByRole("button", { name: "Create Invoice" }).click();
    const created = toast(page, /^Invoice INV-\d+ created$/);
    await expect(created).toBeVisible();
    await expect(form).toBeHidden();
    await markSent(page, (await created.innerText()).match(/INV-\d+/)![0]);
  };
  await sell(6, 10);
  await sell(18, 6);
  const docs = await gstDocuments(biz.id);
  const second = docs.filter((d) => d.document_type === "invoice").at(-1)!;
  await page.clock.setSystemTime(istAt(p, 20, 13, 0));
  await openPage(page, "Invoices");
  await listRow(page, second.invoice_number).click();
  await dialog(page, `Invoice ${second.invoice_number}`).getByRole("button", { name: "Issue Credit Note" }).click();
  const note = dialog(page, "New Credit Note");
  await note.getByTestId("document-line").first().getByLabel("Quantity", { exact: true }).fill("2");
  await expect(note.getByTestId("document-total")).toHaveText(inr(5000));
  await note.getByRole("button", { name: "Create Credit Note" }).click();
  await expect(toast(page, "Credit Note created")).toBeVisible();

  // CMP-08 for the quarter: (25,000 + 15,000 − 5,000) × 1%
  await openPage(page, "GST Returns");
  await page.getByTestId("gst-report-tabs").getByRole("button", { name: "CMP-08", exact: true }).click();
  await choose(page, page.getByRole("combobox", { name: "Financial year" }), `FY ${p.fyStart}-${String(p.fyStart + 1).slice(2)}`);
  await choose(page, page.getByRole("combobox", { name: "Quarter" }), new RegExp(`^Q${p.quarter} `));
  const card = page.getByTestId("cmp08");
  await expect(statCard(card, "Outward supplies (turnover)")).toHaveText(inr(35000));
  await expect(statCard(card, "Composition tax payable")).toHaveText(inr(350));
  await expectNoHorizontalScroll(page, "CMP-08");

  // From the database: no tax charged, turnover net of the note
  const all = await gstDocuments(biz.id);
  expect(all.map((d) => [d.document_type, Number(d.tax_amount), taxableOf(d)])).toEqual([
    ["invoice", 0, 25000],
    ["invoice", 0, 15000],
    ["credit_note", 0, 5000],
  ]);
  // A composition business takes no ITC and has none in the ledger
  expect(await itcLedgerFor(biz.id, p.returnPeriod)).toEqual([]);
  await closePanelIfOpen(page);
}

async function closePanelIfOpen(page: Page) {
  const open = page.getByRole("dialog");
  if (await open.count()) await closePanel(open.first());
}
