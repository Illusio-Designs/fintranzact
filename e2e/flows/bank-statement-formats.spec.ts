/**
 * bank-statement-formats.spec.ts — Bank reconciliation accepts Excel and OFX
 * statements, not just CSV.
 *
 * The browser converts the file to CSV before upload, so the API's column
 * detection should fill in the mapping and show the preview rows. Covers:
 *   1. An .xlsx with bank title rows above the header (generated here)
 *   2. An OFX 1.x (SGML) statement
 */
import JSZip from "jszip";
import { test, expect, waitForPageReady } from "../helpers/fixtures";
import { loadSeed, SeedApi } from "../helpers/seed";

const ACCOUNT_NAME = `Statement Formats ${Date.now()}`;

/** A one-sheet .xlsx. Strings are inline; `{ date }` is an Excel serial date. */
async function buildXlsx(rows: (string | number | { date: number })[][]): Promise<Buffer> {
  const sheetRows = rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
          if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
          if (typeof v === "object") return `<c r="${ref}" s="1"><v>${v.date}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  const xml = '<?xml version="1.0" encoding="UTF-8"?>';
  const ns = "http://schemas.openxmlformats.org";
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `${xml}<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `${xml}<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `${xml}<workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets><sheet name="Statement" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `${xml}<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${ns}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file(
    "xl/styles.xml",
    `${xml}<styleSheet xmlns="${ns}/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `${xml}<worksheet xmlns="${ns}/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

const OFX = [
  "OFXHEADER:100",
  "DATA:OFXSGML",
  "VERSION:102",
  "",
  "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>",
  "<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260403<TRNAMT>26250.00<FITID>N078263548<NAME>NEFT GUPTA ENTERPRISES</STMTTRN>",
  "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260404<TRNAMT>-118.00<FITID>CHG0404<NAME>SMS CHARGES</STMTTRN>",
  "</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>",
].join("\r\n");

test.describe("Bank reconciliation — statement formats", () => {
  test.beforeAll(async () => {
    const { businessId } = loadSeed();
    await new SeedApi().mutate(
      "bankAccount.create",
      { accountName: ACCOUNT_NAME, bankName: "Test Bank", accountType: "current" },
      { "x-business-id": businessId },
    );
  });

  async function upload(page: import("@playwright/test").Page, file: { name: string; mimeType: string; buffer: Buffer }) {
    await page.goto("/bank-reconciliation");
    await waitForPageReady(page);
    await page.getByRole("button", { name: "Upload & Map" }).click();
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: new RegExp(ACCOUNT_NAME) }).click();
    await page.getByTestId("statement-file-input").setInputFiles(file);
    await expect(page.getByText("Click to change file")).toBeVisible();
    await page.getByRole("button", { name: "Upload & Detect Columns" }).click();
    await expect(page.getByRole("heading", { name: `Map Columns — ${file.name}` })).toBeVisible();
  }

  test("an Excel statement with title rows reaches the mapping preview", async ({ page }) => {
    const buffer = await buildXlsx([
      ["Test Bank Ltd"],
      ["Account Number", "50100012345678"],
      ["Statement from 01/04/2026 to 30/04/2026"],
      ["Txn Date", "Description", "Ref No", "Debit", "Credit", "Balance"],
      [{ date: 46113 }, "NEFT ACME SUPPLIES", "N111", 1250.5, "", 8749.5],
      [{ date: 46114 }, "UPI CUSTOMER", "U222", "", 500, 9249.5],
    ]);
    await upload(page, {
      name: "april-statement.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    });

    const table = page.locator("table").last();
    await expect(table.locator("th")).toHaveText([
      "[0] Txn Date",
      "[1] Description",
      "[2] Ref No",
      "[3] Debit",
      "[4] Credit",
      "[5] Balance",
    ]);
    await expect(table.locator("tbody tr")).toHaveCount(2);
    await expect(table.locator("tbody tr").first()).toContainText("01/04/2026");
    await expect(table.locator("tbody tr").first()).toContainText("NEFT ACME SUPPLIES");
    await expect(table.locator("tbody tr").first()).toContainText("1250.5");
    // Header detection filled the required columns.
    await expect(page.getByRole("combobox").filter({ hasText: "[0] Txn Date" })).toBeVisible();
    await expect(page.getByRole("combobox").filter({ hasText: "[1] Description" })).toBeVisible();
  });

  test("an OFX statement reaches the mapping preview", async ({ page }) => {
    await upload(page, { name: "april.ofx", mimeType: "application/x-ofx", buffer: Buffer.from(OFX) });

    const table = page.locator("table").last();
    await expect(table.locator("th")).toHaveText([
      "[0] Date",
      "[1] Description",
      "[2] Reference",
      "[3] Debit",
      "[4] Credit",
    ]);
    await expect(table.locator("tbody tr")).toHaveCount(2);
    await expect(table.locator("tbody tr").first()).toContainText("03/04/2026");
    await expect(table.locator("tbody tr").first()).toContainText("26250.00");
    await expect(table.locator("tbody tr").nth(1)).toContainText("SMS CHARGES");
    await expect(page.getByRole("combobox").filter({ hasText: "[3] Debit" })).toBeVisible();
    await expect(page.getByRole("combobox").filter({ hasText: "[4] Credit" })).toBeVisible();
  });

  test("an old .xls file is refused with a clear message", async ({ page }) => {
    await page.goto("/bank-reconciliation");
    await waitForPageReady(page);
    await page.getByRole("button", { name: "Upload & Map" }).click();
    await page
      .getByTestId("statement-file-input")
      .setInputFiles({ name: "old.xls", mimeType: "application/vnd.ms-excel", buffer: Buffer.from("x") });
    // The toast and its screen-reader announcement both carry the message.
    await expect(page.getByText(/\.xls\) files aren't supported/).first()).toBeVisible();
  });
});
