import type { EndpointGroup } from "./types";
import { API_BASE_URL } from "./api-base";

export const gstEndpoints: EndpointGroup = {
  id: "gst",
  title: "GST Returns",
  description: "Generate filing-ready GST returns. GSTR-1 (outward supplies), GSTR-3B (summary return), GSTR-9 (annual return), CMP-08 (composition scheme quarterly statement) and GSTR-4 (composition scheme annual return). All endpoints return structured data ready for export to the GST portal.",
  endpoints: [
    {
      id: "gst-gstr1",
      method: "query",
      path: "gst.gstr1",
      title: "Generate GSTR-1",
      description: "Generate GSTR-1 (outward supplies) data for a given month. Returns structured sections — B2B, B2CS, B2CL, HSN summary, document summary — computed from all sale invoices in the period. Works for both GST-registered and non-GST businesses (non-GST businesses get generic financial report terminology).",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "year", type: "number", required: true, description: "Calendar year (2020–2099)" },
        { name: "month", type: "number", required: true, description: "Month number (1–12)" },
      ],
      output: {
        description: "Structured GSTR-1 report with B2B, B2CS, B2CL, HSN summary, and document summary sections.",
        example: {
          period: "January 2026",
          gstin: "27AABCS1429B1Z5",
          b2b: [
            {
              gstin: "29AABCT1332L1ZL",
              partyName: "Gupta Enterprises",
              invoices: [
                {
                  invoiceNumber: "INV-2026-0042",
                  invoiceDate: "2026-01-15",
                  invoiceValue: "118000.00",
                  taxableValue: "100000.00",
                  cgst: "9000.00",
                  sgst: "9000.00",
                  igst: "0.00",
                  reverseCharge: false,
                },
              ],
            },
          ],
          b2cs: {
            taxableValue: "50000.00",
            cgst: "4500.00",
            sgst: "4500.00",
            igst: "0.00",
          },
          hsnSummary: [
            { hsn: "6109", description: "T-shirts", quantity: 500, taxableValue: "75000.00", cgst: "6750.00", sgst: "6750.00", igst: "0.00" },
          ],
          documentSummary: {
            invoicesIssued: { from: "INV-2026-0038", to: "INV-2026-0055", total: 18, cancelled: 1 },
          },
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/gst.gstr1?input=%7B%22json%22%3A%7B%22year%22%3A2026%2C%22month%22%3A1%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const report = await trpc.gst.gstr1.query({
  year: 2026,
  month: 1,
});
console.log("B2B invoices:", report.b2b.length);
console.log("B2CS taxable:", report.b2cs.taxableValue);`,
        python: `import httpx

resp = httpx.get(
    "${API_BASE_URL}/api/trpc/gst.gstr1",
    params={"input": '{"json":{"year":2026,"month":1}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
report = resp.json()["result"]["data"]["json"]
print("Period:", report["period"])`,
      },
      gotchas: [
        "Requires `Report:read` permission. Viewer role and above can access.",
        "Both GST-registered and non-GST businesses can use this endpoint. Non-GST businesses receive the same data with generic terminology.",
        "Only sale invoices with status != 'cancelled' are included.",
        "B2B section only includes invoices where the customer has a GSTIN.",
      ],
      relatedEndpoints: ["gst-gstr1csv", "gst-gstr1json", "gst-gstr3b"],
    },
    {
      id: "gst-gstr3b",
      method: "query",
      path: "gst.gstr3b",
      title: "Generate GSTR-3B",
      description: "Generate GSTR-3B (monthly summary return) data for a given month. Includes outward supplies summary, inter-state supplies, ITC claimed, and tax payable. This is a summary-level return — individual invoice details are not included.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "year", type: "number", required: true, description: "Calendar year (2020–2099)" },
        { name: "month", type: "number", required: true, description: "Month number (1–12)" },
      ],
      output: {
        description: "GSTR-3B summary with tables 3.1 (outward supplies), 3.2 (inter-state), 4 (ITC), and 6 (tax payable).",
        example: {
          period: "January 2026",
          gstin: "27AABCS1429B1Z5",
          table3_1: {
            outwardTaxable: { taxableValue: "150000.00", igst: "0.00", cgst: "13500.00", sgst: "13500.00", cess: "0.00" },
            outwardZeroRated: { taxableValue: "0.00", igst: "0.00", cgst: "0.00", sgst: "0.00", cess: "0.00" },
            outwardNilExempt: { taxableValue: "5000.00", igst: "0.00", cgst: "0.00", sgst: "0.00", cess: "0.00" },
            inwardReverseCharge: { taxableValue: "0.00", igst: "0.00", cgst: "0.00", sgst: "0.00", cess: "0.00" },
          },
          table4: {
            itcAvailable: { igst: "0.00", cgst: "4500.00", sgst: "4500.00", cess: "0.00" },
            itcReversed: { igst: "0.00", cgst: "0.00", sgst: "0.00", cess: "0.00" },
            netItc: { igst: "0.00", cgst: "4500.00", sgst: "4500.00", cess: "0.00" },
          },
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/gst.gstr3b?input=%7B%22json%22%3A%7B%22year%22%3A2026%2C%22month%22%3A1%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const summary = await trpc.gst.gstr3b.query({
  year: 2026,
  month: 1,
});
console.log("Outward taxable:", summary.table3_1.outwardTaxable.taxableValue);
console.log("Net ITC CGST:", summary.table4.netItc.cgst);`,
        python: `import httpx

resp = httpx.get(
    "${API_BASE_URL}/api/trpc/gst.gstr3b",
    params={"input": '{"json":{"year":2026,"month":1}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
summary = resp.json()["result"]["data"]["json"]
print("Tax payable CGST:", summary["table3_1"]["outwardTaxable"]["cgst"])`,
      },
      gotchas: [
        "Requires `Report:read` permission.",
        "GSTR-3B is a summary return — it aggregates all invoices into category totals. Use `gst.gstr1` for invoice-level detail.",
        "Inter-state supplies (table 3.2) are derived from invoice place-of-supply vs business state code.",
      ],
      relatedEndpoints: ["gst-gstr1", "itc-gstr3b-table4"],
    },
    {
      id: "gst-gstr1csv",
      method: "query",
      path: "gst.gstr1CSV",
      title: "Export GSTR-1 as CSV",
      description: "Generate GSTR-1 data and return it as a CSV string ready for download. The CSV follows the format expected by most GST filing tools and CAs for offline filing.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "year", type: "number", required: true, description: "Calendar year (2020–2099)" },
        { name: "month", type: "number", required: true, description: "Month number (1–12)" },
      ],
      output: {
        description: "CSV string and suggested filename.",
        example: {
          csv: "GSTIN,Invoice Number,Invoice Date,Value,Taxable Value,CGST,SGST,IGST\n29AABCT1332L1ZL,INV-2026-0042,15-01-2026,118000.00,100000.00,9000.00,9000.00,0.00",
          filename: "GSTR1_January_2026.csv",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/gst.gstr1CSV?input=%7B%22json%22%3A%7B%22year%22%3A2026%2C%22month%22%3A1%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { csv, filename } = await trpc.gst.gstr1CSV.query({
  year: 2026,
  month: 1,
});
// Download as file
const blob = new Blob([csv], { type: "text/csv" });
const a = document.createElement("a");
a.href = URL.createObjectURL(blob);
a.download = filename;
a.click();`,
        python: `import httpx

resp = httpx.get(
    "${API_BASE_URL}/api/trpc/gst.gstr1CSV",
    params={"input": '{"json":{"year":2026,"month":1}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
data = resp.json()["result"]["data"]["json"]
with open(data["filename"], "w") as f:
    f.write(data["csv"])`,
      },
      gotchas: [
        "The CSV is returned as a string in the JSON response — not as a file download. Your client must convert it to a downloadable file.",
        "Requires `Report:read` permission.",
      ],
      relatedEndpoints: ["gst-gstr1", "gst-gstr1json"],
    },
    {
      id: "gst-gstr1json",
      method: "query",
      path: "gst.gstr1Json",
      title: "Export GSTR-1 as Portal JSON",
      description: "Generate GSTR-1 data in the exact JSON schema accepted by the GST portal's offline tool. Users can download this JSON and upload it directly to gstn.gov.in instead of manually entering invoice data. Includes the business GSTIN, financial year, and filing period in the portal-required format.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "year", type: "number", required: true, description: "Calendar year (2020–2099)" },
        { name: "month", type: "number", required: true, description: "Month number (1–12)" },
      ],
      output: {
        description: "Portal-compatible JSON and suggested filename.",
        example: {
          json: {
            gstin: "27AABCS1429B1Z5",
            fp: "012026",
            fy: "2025-26",
            b2b: [],
            b2cs: [],
            hsn: { data: [] },
            doc_issue: { doc_det: [] },
          },
          filename: "GSTR1_January_2026_portal.json",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/gst.gstr1Json?input=%7B%22json%22%3A%7B%22year%22%3A2026%2C%22month%22%3A1%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { json, filename } = await trpc.gst.gstr1Json.query({
  year: 2026,
  month: 1,
});
// Download as JSON file for GST portal upload
const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
const a = document.createElement("a");
a.href = URL.createObjectURL(blob);
a.download = filename;
a.click();`,
        python: `import httpx, json

resp = httpx.get(
    "${API_BASE_URL}/api/trpc/gst.gstr1Json",
    params={"input": '{"json":{"year":2026,"month":1}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
data = resp.json()["result"]["data"]["json"]
with open(data["filename"], "w") as f:
    json.dump(data["json"], f, indent=2)
print("Saved portal JSON:", data["filename"])`,
      },
      gotchas: [
        "The JSON schema matches the GST portal's offline tool format exactly. Upload it at gstn.gov.in under GSTR-1 > Upload JSON.",
        "The `fp` (filing period) field uses MMYYYY format (e.g. '012026' for January 2026) as required by the portal.",
        "Financial year (`fy`) is auto-detected from the business's `financialYearStart` setting (default April).",
        "Requires `Report:read` permission.",
      ],
      relatedEndpoints: ["gst-gstr1", "gst-gstr1csv"],
    },
    {
      id: "gst-gstr9",
      method: "query",
      path: "gst.gstr9",
      title: "Generate GSTR-9 (Annual Return)",
      description: "Generate GSTR-9 annual return data for a financial year. Consolidates 12 months of GSTR-1 and GSTR-3B data into the annual return format. Tables 4-9 are auto-generated from monthly data — no separate data entry required. Filed once per financial year (April-March).",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "financialYear", type: "number", required: true, description: "Financial year start year (2020–2099). For FY 2025-26, pass 2025." },
      ],
      output: {
        description: "Annual return data with tables 4 (outward supplies), 5 (outward supplies amendments), 6 (ITC), 7 (reverse charge), 8 (other ITC), and 9 (late fee).",
        example: {
          financialYear: "2025-26",
          gstin: "27AABCS1429B1Z5",
          table4: {
            b2b: { taxableValue: "1800000.00", cgst: "162000.00", sgst: "162000.00", igst: "0.00", cess: "0.00" },
            b2cs: { taxableValue: "600000.00", cgst: "54000.00", sgst: "54000.00", igst: "0.00", cess: "0.00" },
            total: { taxableValue: "2400000.00", cgst: "216000.00", sgst: "216000.00", igst: "0.00", cess: "0.00" },
          },
          table6: {
            totalItcAvailed: { cgst: "108000.00", sgst: "108000.00", igst: "0.00", cess: "0.00" },
          },
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/gst.gstr9?input=%7B%22json%22%3A%7B%22financialYear%22%3A2025%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const annual = await trpc.gst.gstr9.query({
  financialYear: 2025, // FY 2025-26
});
console.log("FY:", annual.financialYear);
console.log("Total outward:", annual.table4.total.taxableValue);`,
        python: `import httpx

resp = httpx.get(
    "${API_BASE_URL}/api/trpc/gst.gstr9",
    params={"input": '{"json":{"financialYear":2025}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
annual = resp.json()["result"]["data"]["json"]
print("FY:", annual["financialYear"])`,
      },
      gotchas: [
        "Requires `GstReport:read` permission (stricter than the monthly reports which need `Report:read`).",
        "Pass the START year of the financial year. For FY 2025-26 (April 2025 to March 2026), pass `financialYear: 2025`.",
        "GSTR-9 must be filed by December 31 of the following year (e.g. FY 2025-26 deadline is 31 Dec 2026).",
        "Data is generated from monthly GSTR-1 and GSTR-3B calculations — ensure monthly returns are correct before generating the annual return.",
      ],
      relatedEndpoints: ["gst-gstr9json", "gst-gstr1", "gst-gstr3b"],
    },
    {
      id: "gst-gstr9json",
      method: "query",
      path: "gst.gstr9Json",
      title: "Export GSTR-9 as Portal JSON",
      description: "Generate GSTR-9 annual return data in the exact JSON schema accepted by the GST portal's offline tool. Download and upload directly to gstn.gov.in for filing.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "financialYear", type: "number", required: true, description: "Financial year start year (2020–2099). For FY 2025-26, pass 2025." },
      ],
      output: {
        description: "Portal-compatible GSTR-9 JSON and suggested filename.",
        example: {
          json: {
            gstin: "27AABCS1429B1Z5",
            fy: "2025-26",
            table4: {},
            table5: {},
            table6: {},
          },
          filename: "GSTR9_FY2025_26_portal.json",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/gst.gstr9Json?input=%7B%22json%22%3A%7B%22financialYear%22%3A2025%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { json, filename } = await trpc.gst.gstr9Json.query({
  financialYear: 2025,
});
// Download for GST portal upload
const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
const a = document.createElement("a");
a.href = URL.createObjectURL(blob);
a.download = filename;
a.click();`,
        python: `import httpx, json

resp = httpx.get(
    "${API_BASE_URL}/api/trpc/gst.gstr9Json",
    params={"input": '{"json":{"financialYear":2025}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
data = resp.json()["result"]["data"]["json"]
with open(data["filename"], "w") as f:
    json.dump(data["json"], f, indent=2)`,
      },
      gotchas: [
        "Requires `GstReport:read` permission.",
        "The filename uses underscores: `GSTR9_FY2025_26_portal.json` (the dash in '2025-26' becomes an underscore).",
      ],
      relatedEndpoints: ["gst-gstr9"],
    },
    {
      id: "gst-cmp08",
      method: "query",
      path: "gst.cmp08",
      title: "Generate CMP-08 (Composition Scheme)",
      description: "CMP-08 quarterly statement data for composition scheme dealers. Totals the taxable value of sale invoices in the financial-year quarter (plus sale debit notes, less sale credit notes and sales returns; quotations, proformas, orders, challans and deleted or cancelled documents are excluded) and applies the composition rate of the business's category for that financial year (set with gst.updateCompositionSettings; default 1% manufacturers and traders, 5% restaurants, 6% other service providers). CMP-08 is filed for all four quarters, Jan-Mar included. Also returns the tax by head, reverse-charge tax on inward supplies, interest and the due date. Rate, due day and interest rate resolve per business and financial year: the business's override, else the built-in versioned default.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "year", type: "number", required: true, description: "Start year of the financial year (2020–2099): 2025 for FY 2025-26" },
        { name: "quarter", type: "number", required: true, description: "Financial-year quarter (1–4). Q1 = Apr-Jun, Q2 = Jul-Sep, Q3 = Oct-Dec, Q4 = Jan-Mar of the next calendar year." },
        { name: "paidOn", type: "string", required: false, description: "ISO date. When the tax was paid, to work out interest on a late payment. Without it interest is 0.00 and interestBasis says payment_date_unknown." },
      ],
      output: {
        description: "Turnover, composition tax (rate, category, central and state share), reverse-charge tax, interest and due date for the quarter.",
        example: {
          financialYear: "2026-27", quarter: 1, category: "manufacturer_trader", rate: "1",
          taxableValue: "450000.00", centralTax: "2250.00", stateTax: "2250.00", integratedTax: "0.00", taxPayable: "4500.00",
          rcm: { taxableValue: "10000.00", centralTax: "900.00", stateTax: "900.00", integratedTax: "0.00", tax: "1800.00" },
          interest: "0.00", interestRatePercent: "18", interestBasis: "payment_date_unknown", cmp08Applicable: true,
          dueDate: "2026-07-17T18:30:00.000Z",
          quarterStart: "2026-03-31T18:30:00.000Z",
          quarterEnd: "2026-06-30T18:29:59.999Z",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/gst.cmp08?input=%7B%22json%22%3A%7B%22year%22%3A2026%2C%22quarter%22%3A1%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const cmp = await trpc.gst.cmp08.query({
  year: 2026,
  quarter: 1, // Q1 = Apr-Jun (FY 2026-27)
});
console.log("Taxable value:", cmp.taxableValue);
console.log("Tax payable (1%):", cmp.taxPayable);`,
        python: `import httpx

resp = httpx.get(
    "${API_BASE_URL}/api/trpc/gst.cmp08",
    params={"input": '{"json":{"year":2026,"quarter":1}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
cmp = resp.json()["result"]["data"]["json"]
print(f"Tax payable: Rs. {cmp['taxPayable']}")`,
      },
      gotchas: [
        "Requires `Report:read` permission.",
        "Quarters are financial-year quarters: Q1 = Apr-Jun ... Q4 = Jan-Mar. CMP-08 is filed for all four (cmp08Applicable is always true; it is kept for compatibility).",
        "Default due dates: Q1 18 Jul, Q2 18 Oct, Q3 18 Jan, Q4 18 Apr. The due day is a per-business, per-year setting. Dates and rates are defaults from secondary sources: verify them with a CA each year.",
        "Interest is 18% a year by default (a setting), simple, only when paidOn is given and is after the due date.",
        "gst.cmp08Year returns all four quarters of a financial year in one call: `{ year }` in, `{ financialYear, quarters }` out.",
      ],
      relatedEndpoints: ["gst-gstr4", "gst-composition-settings"],
    },
    {
      id: "gst-gstr4",
      method: "query",
      path: "gst.gstr4",
      title: "Generate GSTR-4 (Composition Annual Return)",
      description: "GSTR-4 tables for a composition taxpayer's financial year: Table 4 inward supplies (registered, registered under reverse charge, unregistered, import of services), Table 5 summary of self-assessed liability per CMP-08 (four quarters), Table 6 tax rate-wise (outward and inward reverse charge), Table 7 TDS/TCS credit received (not held by Fintranzact: zero) and Table 8 tax, interest and late fee payable against tax paid through CMP-08. Table numbers and row numbers follow secondary sources and are best effort: verify them against the GST offline tool. Turnover and tax come from the four CMP-08 quarters, so the two always agree. The due date, interest rate and late fee come from the business's settings for the year, else the built-in versioned defaults. Fails with PRECONDITION_FAILED for a business that is not registered under the composition scheme.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "financialYear", type: "string", required: true, description: "Financial year such as \"2026-27\" (April to March)" },
        { name: "cmp08Paid", type: "object", required: false, description: "Amount actually paid through CMP-08 per quarter, as `{ 1?, 2?, 3?, 4? }` strings like \"1500.00\". Fintranzact does not record payments. A quarter left out is assumed paid in full and paidAssumed is true." },
        { name: "filedOn", type: "string", required: false, description: "ISO date GSTR-4 is (to be) filed and the balance paid. Interest on the balance and the late fee are worked out only with it: without it both are 0.00 and filingDateKnown is false." },
      ],
      output: {
        description: "inward (Table 4), cmp08Summary (Table 5), rateWise (Table 6), tdsTcs (Table 7), taxPaid (Table 8: payable, paid, balance, interest, lateFee, paidAssumed), dueDate, dueDateSource and notes.",
        example: {
          financialYear: "2026-27", isComposition: true, dueDate: "2027-06-29T18:30:00.000Z", dueDateSource: "default",
          inward: { rows: [{ kind: "registered_non_rcm", taxableValue: "10000.00", tax: "0.00", documentCount: 1 }], totalTaxableValue: "10000.00", totalRcmTax: "0.00" },
          cmp08Summary: { taxableValue: "400000.00", compositionTax: "4000.00", rcmTax: "0.00", totalTax: "4000.00" },
          rateWise: { outward: [{ rate: "1", taxableValue: "400000.00", centralTax: "2000.00", stateTax: "2000.00", integratedTax: "0.00", tax: "4000.00" }] },
          tdsTcs: { tds: "0.00", tcs: "0.00" },
          taxPaid: { totalPayable: "4000.00", paidThroughCmp08: "3000.00", paidAssumed: true, balancePayable: "1000.00", interest: "4.93", lateFee: "500.00", filingDateKnown: true, nilReturn: false },
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/gst.gstr4?input=%7B%22json%22%3A%7B%22financialYear%22%3A%222026-27%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const gstr4 = await trpc.gst.gstr4.query({
  financialYear: "2026-27",
  cmp08Paid: { 1: "1000.00", 2: "1000.00", 3: "1000.00", 4: "1000.00" },
  filedOn: new Date("2027-07-10"), // optional: for interest on the balance and the late fee
});
if (gstr4.taxPaid.paidAssumed) console.warn("Some quarters were assumed paid");
console.log("Balance with GSTR-4:", gstr4.taxPaid.balancePayable);`,
        python: `import httpx

resp = httpx.get(
    "${API_BASE_URL}/api/trpc/gst.gstr4",
    params={"input": '{"json":{"financialYear":"2026-27"}}'},
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)
print(resp.json()["result"]["data"]["json"]["taxPaid"])`,
      },
      gotchas: [
        "Requires `Report:read` permission. Returns PRECONDITION_FAILED unless the business GST registration type is composition.",
        "The default due date is 30 June after the year since FY 2024-25 (CGST Notification 12/2024; 30 April before). It is often extended: set the notified date for the year with gst.updateCompositionSettings. Verify with a CA.",
        "Payments are not tracked: quarters (Q1-Q4, all have a CMP-08) without an amount in cmp08Paid are assumed paid in full (paidAssumed: true).",
        "Late fee: 50 a day (25 central + 25 state) up to 2,000; nil return 20 a day up to 500, by default. All four amounts, the interest rate (18%) and the due date are per-year settings. Computed only when filedOn is given.",
        "Exempt, nil-rated and non-GST outward supplies, cess and TDS/TCS credit (Table 7) are not tracked: always 0.00. Interest on the balance runs from the GSTR-4 due date, an approximation.",
        "Unregistered purchases are only treated as reverse charge when the document is flagged reverse charge; the app does not apply s.9(4) automatically.",
      ],
      relatedEndpoints: ["gst-gstr4-json", "gst-cmp08"],
    },
    {
      id: "gst-gstr4-json",
      method: "query",
      path: "gst.gstr4Json",
      title: "GSTR-4 Portal JSON (best effort)",
      description: "The GSTR-4 tables as a JSON file shaped like the GST portal offline utility's upload. BEST EFFORT: the amount keys (txval, camt, samt, iamt, csamt, rt) and the gstin/fy header follow portal convention, but the table keys (table4 to table8: 4 inward, 5 CMP-08 summary, 6 rate-wise, 7 TDS/TCS, 8 tax paid), the quarter and tax-paid keys are NOT verified against the portal schema. Check the file against the GST offline tool before uploading.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "financialYear", type: "string", required: true, description: "Financial year such as \"2026-27\"" },
        { name: "cmp08Paid", type: "object", required: false, description: "Same as gst.gstr4" },
        { name: "filedOn", type: "string", required: false, description: "Same as gst.gstr4" },
      ],
      output: {
        description: "A filename and the JSON document.",
        example: {
          filename: "GSTR4_FY2026_27_portal.json",
          json: { gstin: "27AABCS1429B1Z5", fy: "2026-27", table4: { "4A": { txval: 10000, iamt: 0, camt: 0, samt: 0, csamt: 0 } }, table5: { txval: 400000 }, table6: { outward: [{ rt: 1, txval: 400000 }] }, table7: { tds: 0, tcs: 0 }, table8: { tot_tax: 4000 } },
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/gst.gstr4Json?input=%7B%22json%22%3A%7B%22financialYear%22%3A%222026-27%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { filename, json } = await trpc.gst.gstr4Json.query({ financialYear: "2026-27" });
// Save it, then compare it with the GST offline tool schema before uploading.`,
        python: `import httpx, json

resp = httpx.get(
    "${API_BASE_URL}/api/trpc/gst.gstr4Json",
    params={"input": '{"json":{"financialYear":"2026-27"}}'},
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)
data = resp.json()["result"]["data"]["json"]
open(data["filename"], "w").write(json.dumps(data["json"], indent=2))`,
      },
      gotchas: [
        "Requires `Report:read` permission. Same PRECONDITION_FAILED rule as gst.gstr4.",
        "Best effort and unverified: all guessed key names are in one block (GSTR4_PORTAL_KEYS in packages/api/src/lib/gstr4-json.ts). See docs/GSTR-4.md.",
        "Amounts are JSON numbers with two decimals; unregistered purchases (with or without reverse charge) are merged under 4C.",
      ],
      relatedEndpoints: ["gst-gstr4"],
    },
    {
      id: "gst-composition-settings",
      method: "query",
      path: "gst.compositionSettings",
      title: "Composition Category, Rate and Year Settings",
      description: "Reads the composition category and every compliance value for a financial year (rate, CMP-08 due day, GSTR-4 due date, interest rate, GSTR-4 late fee per day / cap / nil per day / nil cap): the effective value, the built-in default beside it, whether each is the default or this business's override, and the date the defaults were last reviewed. Resolution order: business financial-year override, else the built-in year-versioned default (COMPOSITION_DEFAULTS in packages/shared/src/composition.ts). gst.updateCompositionSettings (mutation, admin role, needs update:Business) saves the category and the overrides for a year: null resets an override to the default, leaving an override out keeps it (the rate is the exception: leaving it out resets it). Changes show in CMP-08 and GSTR-4 immediately and are audited.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "financialYear", type: "string", required: false, description: "Financial year such as \"2026-27\". Defaults to the current one." },
      ],
      output: {
        description: "The category, rate and the default category rules.",
        example: {
          financialYear: "2026-27", category: "manufacturer_trader", rateOverride: null, configured: false, rate: "1",
          effective: { rate: "1", cmp08DueDay: 18, gstr4DueDate: "2027-06-30", interestRatePercent: "18", lateFeePerDay: "50", lateFeeCap: "2000", lateFeeNilPerDay: "20", lateFeeNilCap: "500" },
          defaults: { rate: "1", cmp08DueDay: 18, gstr4DueDate: "2027-06-30", interestRatePercent: "18", lateFeePerDay: "50", lateFeeCap: "2000", lateFeeNilPerDay: "20", lateFeeNilCap: "500" },
          sources: { rate: "default", gstr4DueDate: "default" },
          meta: { lastReviewed: "2026-10-02", verifyWithCA: true, effectiveFromFy: "2024-25", sourceNotes: ["busy.in guide-to-gstr-4"] },
          categories: [
            { code: "manufacturer_trader", label: "Manufacturer or trader (goods)", rate: "1", note: "Central 0.5% + State 0.5% of turnover" },
            { code: "restaurant", label: "Restaurant (not serving alcohol)", rate: "5", note: "Central 2.5% + State 2.5% of turnover" },
            { code: "other_service", label: "Other service provider", rate: "6", note: "Central 3% + State 3% of turnover" },
          ],
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/gst.compositionSettings?input=%7B%22json%22%3A%7B%22financialYear%22%3A%222026-27%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `await trpc.gst.updateCompositionSettings.mutate({
  financialYear: "2026-27",
  category: "restaurant",
  rate: "5", // optional: omit to use the category default
  gstr4DueDate: "2027-07-31", // optional: a notified extension; null resets to the default
  lateFeePerDay: "50", // also lateFeeCap, lateFeeNilPerDay, lateFeeNilCap, interestRate, cmp08DueDay
});`,
        python: `import httpx

resp = httpx.get(
    "${API_BASE_URL}/api/trpc/gst.compositionSettings",
    params={"input": '{"json":{"financialYear":"2026-27"}}'},
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)
print(resp.json()["result"]["data"]["json"]["rate"])`,
      },
      gotchas: [
        "Every value is a default researched from secondary sources that the Government can change: confirm each year with a CA, and override the value if it has changed.",
        "Dates are YYYY-MM-DD, amounts have at most two decimals, rates are percents (0-100), cmp08DueDay is 1-28.",
        "Until a category is saved, manufacturer_trader (1%) is used and `configured` is false.",
        "Saving is audited and needs `Business:update` (admin).",
      ],
      relatedEndpoints: ["gst-cmp08", "gst-gstr4"],
    },
  ],
};
