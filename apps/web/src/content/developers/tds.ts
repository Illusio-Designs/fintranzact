import type { EndpointGroup } from "./types";
import { API_BASE_URL } from "./api-base";

const KIND = { name: "kind", type: "string", required: false, description: "`tds` (tax you deduct on purchases, the default) or `tcs` (tax you collect on sales). TCS has only `payable` entries.", default: "tds", enumValues: ["tds", "tcs"] };

const FY = { name: "financialYear", type: "string", required: true, description: "Financial year, April to March, like `2026-27`. The second part must be the year after the first." };

const get = (path: string, json: string) => `curl "${API_BASE_URL}/api/trpc/${path}?input=${encodeURIComponent(`{"json":${json}}`)}" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`;
const post = (path: string, json: string) => `curl -X POST "${API_BASE_URL}/api/trpc/${path}" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":${json}}'`;

export const tdsEndpoints: EndpointGroup = {
  id: "tds",
  title: "TDS & TCS",
  description: "Income-tax TDS and TCS: **TCS (s.206C)** is tax you collect from a customer on specified goods such as scrap, minerals or motor vehicles above ₹10 lakh. An item carries a TCS section (`tcsSection` on `item.create` / `update`); `invoice.create` / `update` collect TCS on those lines unless `tcsMode` is `none`, add it to `totalAmount` (`tcsAmount` says how much of the total it is), and record a payable `tcs` entry. Every ledger, challan, summary and return procedure below takes `kind: \"tds\" | \"tcs\"` to choose which. TCS deposit is due on the 7th of the next month for every month (March included) and the 27EQ return on the 15th after the quarter. TDS: yearly section rates and limits, the TDS payable and receivable ledgers, and the challans tax is deposited with. The tax itself is recorded by other procedures. **On a purchase bill** (`invoice.create` / `update`, with `tdsMode`) TDS is worked out when the bill is credited from the supplier's TDS section, their PAN and the purchases so far this year, and settled against the bill by a system payment (`source: \"tds\"`, no bank account) so the bill shows its total, the TDS adjusted and what is left to pay. **On a payment** (`payment.create` with `tdsAmount` + `tdsSection`) TDS applies to an advance to a supplier (not against a bill) and to tax a customer withholds from what they pay you (TDS receivable); the gross `amount` settles the invoice and the bank moves `amount - tdsAmount`. The financial year is always April to March, whatever the business's own accounting year. Rates, limits and due dates are defaults that change most Budgets: verify with a CA. Requires the `Tds` permission, held by owners, admins and accountants (`tds.preview` needs only `Payment:read`).",
  endpoints: [
    {
      id: "tds-sections",
      method: "query",
      path: "tds.sections",
      title: "List Sections",
      description: "Every TDS section for a financial year with this business's overrides applied. `defaults` holds the built-in values so an edit can be compared.",
      auth: "business",
      requiredRole: "viewer",
      input: [{ ...FY, required: false, description: "Defaults to the current financial year." }, KIND],
      output: {
        description: "Rates are percents; `singleThreshold` / `aggregateThreshold` are rupees or `null` for no limit. `excessOnly` is true for 194Q, where tax is only on purchases above the yearly limit.",
        example: {
          financialYear: "2026-27",
          sections: [
            { code: "194J_PROF", label: "194J · Professional fees", rate: "10", individualRate: null, rateWithoutPan: "20", singleThreshold: null, aggregateThreshold: "50000", basis: "payments", excessOnly: false, isActive: true, overridden: false },
          ],
        },
      },
      codeExamples: {
        curl: get("tds.sections", `{"financialYear":"2026-27"}`),
        javascript: `const { sections } = await trpc.tds.sections.query({ financialYear: "2026-27" });`,
      },
      gotchas: ["BAD_REQUEST when the second half of the year is not the next year (`2026-28`)."],
      relatedEndpoints: ["tds-update-section", "tds-reset-section"],
    },
    {
      id: "tds-update-section",
      method: "mutation",
      path: "tds.updateSection",
      title: "Update Section",
      description: "Override a section's rates and limits for one financial year, or switch it off. Fields you leave out keep the default. Audit entry `tds.updateSection`.",
      auth: "business",
      requiredRole: "member",
      input: [
        FY,
        { name: "sectionCode", type: "string", required: true, description: "One of the section codes from `tds.sections` (TDS) or, with `kind: \"tcs\"`, a TCS section.", enumValues: ["194Q", "194C", "194J_TECH", "194J_PROF", "194H", "194I_PM", "194I_LB", "206C_ALCOHOL", "206C_TENDU", "206C_TIMBER_LEASE", "206C_TIMBER_OTHER", "206C_FOREST", "206C_SCRAP", "206C_MINERALS", "206C_PARKING", "206C_VEHICLE"] },
        { name: "rate", type: "string", required: false, description: "Percent, 0 to 100." },
        { name: "individualRate", type: "string", required: false, description: "Percent for proprietors and HUFs where the section has one." },
        { name: "rateWithoutPan", type: "string", required: false, description: "Percent when the supplier has no PAN (s.206AA)." },
        { name: "singleThreshold", type: "string", required: false, description: "Rupees; a single payment above this is taxed on its own." },
        { name: "aggregateThreshold", type: "string", required: false, description: "Rupees; once a supplier's yearly total passes this, everything not yet taxed is taxed." },
        { name: "isActive", type: "boolean", required: false, description: "`false` stops TDS under this section for the year.", default: "true" },
      ],
      output: { description: "The stored override.", example: { id: "uuid", financialYear: "2026-27", sectionCode: "194H", rate: "5.000", aggregateThreshold: "50000.00", isActive: true } },
      codeExamples: {
        curl: post("tds.updateSection", `{"financialYear":"2026-27","sectionCode":"194H","rate":"5","aggregateThreshold":"50000"}`),
        javascript: `await trpc.tds.updateSection.mutate({ financialYear: "2026-27", sectionCode: "194H", rate: "5" });`,
      },
      gotchas: [
        "An override replaces the whole row: send every field you want to keep overridden.",
        "Changing a limit does not re-work bills already saved; edit a bill to re-calculate its TDS.",
      ],
      relatedEndpoints: ["tds-sections", "tds-reset-section"],
    },
    {
      id: "tds-reset-section",
      method: "mutation",
      path: "tds.resetSection",
      title: "Reset Section",
      description: "Remove a year's override and go back to the defaults. Resetting a section that was never overridden is not an error and returns `{ id: null }`. Audit entry `tds.resetSection`.",
      auth: "business",
      requiredRole: "member",
      input: [FY, { name: "sectionCode", type: "string", required: true, description: "Section code." }],
      output: { description: "The id of the override that was removed, or `null`.", example: { id: "uuid" } },
      codeExamples: {
        curl: post("tds.resetSection", `{"financialYear":"2026-27","sectionCode":"194H"}`),
        javascript: `await trpc.tds.resetSection.mutate({ financialYear: "2026-27", sectionCode: "194H" });`,
      },
      relatedEndpoints: ["tds-sections", "tds-update-section"],
    },
    {
      id: "tds-preview",
      method: "query",
      path: "tds.preview",
      title: "Preview TDS",
      description: "What TDS buying from, or paying, a party would carry: the section, whether their PAN is on file, their year to date, and the amount. This is what the purchase-bill form and the payment form show before saving.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "partyId", type: "string (UUID)", required: true, description: "The supplier." },
        { name: "amount", type: "string", required: true, description: "Taxable value in rupees, excluding GST." },
        { name: "paymentDate", type: "string (ISO datetime)", required: false, description: "Picks the financial year. Defaults to now." },
        { name: "sectionCode", type: "string", required: false, description: "Use this section instead of the party's own." },
        { name: "excludePaymentId", type: "string (UUID)", required: false, description: "Leave a payment out of the year to date, when re-working it." },
      ],
      output: {
        description: "`result` is `null` when the party has no section. `result.reason` is one of `below_threshold`, `single_payment_over_threshold`, `aggregate_threshold_crossed`, `above_threshold` (194Q) or `no_threshold`. When the yearly limit is crossed, `base` includes earlier purchases that were not yet taxed.",
        example: {
          financialYear: "2026-27", quarter: 3, sectionCode: "194J_PROF", hasPan: true, ytdPaid: "30000.00", ytdTaxedBase: "0.00",
          result: { applicable: true, reason: "aggregate_threshold_crossed", base: "60000.00", rate: "10", tds: "6000.00" },
          warnings: [],
        },
      },
      codeExamples: {
        curl: get("tds.preview", `{"partyId":"PARTY_ID","amount":"30000"}`),
        javascript: `const p = await trpc.tds.preview.query({ partyId, amount: "30000" });
if (p.result?.applicable) console.log("TDS", p.result.tds, "at", p.result.rate + "%");`,
      },
      gotchas: [
        "NOT_FOUND for a party of another business.",
        "TDS is rounded to the nearest rupee.",
        "Without a PAN (or a GSTIN, which contains one) the higher no-PAN rate applies and a warning is returned.",
      ],
      relatedEndpoints: ["tds-sections", "tds-summary"],
    },
    {
      id: "tds-tcs-preview",
      method: "query",
      path: "tds.tcsPreview",
      title: "Preview TCS",
      description: "The TCS a sale would collect, for the lines entered on the invoice form: the taxable value of each line (GST excluded), matched to its item's TCS section, for this customer. This is what the sale-invoice form shows before saving; `invoice.create` works the same amount out itself.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "partyId", type: "string (UUID)", required: true, description: "The customer; a missing PAN (or GSTIN) raises the rate (s.206CC)." },
        { name: "invoiceDate", type: "string (ISO datetime)", required: false, description: "Picks the financial year. Defaults to now." },
        { name: "lines", type: "{ itemId?: string, taxable: string }[]", required: true, description: "One entry per line: the item and its taxable value after discount, in rupees." },
      ],
      output: {
        description: "`amount` is the total TCS; `sections` groups it by section. Lines whose item has no TCS section, and motor vehicles at or below ₹10 lakh, add nothing.",
        example: {
          financialYear: "2026-27", hasPan: true, amount: "1000.00",
          sections: [{ sectionCode: "206C_SCRAP", label: "206C · Scrap", base: "100000.00", rate: "1", amount: "1000.00" }],
          warnings: [],
        },
      },
      codeExamples: {
        curl: get("tds.tcsPreview", `{"partyId":"PARTY_ID","lines":[{"itemId":"ITEM_ID","taxable":"100000"}]}`),
        javascript: `const p = await trpc.tds.tcsPreview.query({ partyId, lines: [{ itemId, taxable: "100000" }] });
console.log("TCS", p.amount);`,
      },
      gotchas: [
        "Requires `Invoice:read`.",
        "NOT_FOUND for a customer of another business.",
        "The rate is the section's default for the year unless the business overrode it (`tds.updateSection` with `kind: \"tcs\"` codes).",
      ],
      relatedEndpoints: ["tds-sections", "tds-summary"],
    },
    {
      id: "tds-deductions",
      method: "query",
      path: "tds.deductions",
      title: "List Deductions",
      description: "The entries behind the TDS payable and receivable ledgers, newest first, with each one's deposit due date.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        FY,
        KIND,
        { name: "direction", type: "string", required: false, description: "`payable` (TDS we deducted) or `receivable` (TDS customers deducted from us).", enumValues: ["payable", "receivable"] },
        { name: "quarter", type: "number", required: false, description: "1 to 4 (Q1 is April to June)." },
        { name: "sectionCode", type: "string", required: false, description: "Section code." },
        { name: "partyId", type: "string (UUID)", required: false, description: "One party." },
        { name: "deposited", type: "boolean", required: false, description: "`true` for TDS on a challan, `false` for TDS not yet deposited." },
        { name: "page", type: "number", required: false, description: "Page number.", default: "1" },
        { name: "limit", type: "number", required: false, description: "Page size, up to 200.", default: "50" },
      ],
      output: {
        description: "`depositDueDate` is the 7th of the month after `deductedOn` (30 April for March).",
        example: {
          data: [{ id: "uuid", direction: "payable", partyName: "CA Associates", partyPan: "AABCS1234D", invoiceId: "uuid", sectionCode: "194J_PROF", quarter: 3, baseAmount: "60000.00", rate: "10.000", amount: "6000.00", hasPan: true, deductedOn: "2026-10-15T06:30:00.000Z", depositDueDate: "2026-11-06T18:30:00.000Z", challanId: null }],
          total: 1, page: 1, limit: 50,
        },
      },
      codeExamples: {
        curl: get("tds.deductions", `{"financialYear":"2026-27","direction":"payable","deposited":false}`),
        javascript: `const { data } = await trpc.tds.deductions.query({ financialYear: "2026-27", direction: "payable", deposited: false });`,
      },
      relatedEndpoints: ["tds-summary", "tds-create-challan"],
    },
    {
      id: "tds-summary",
      method: "query",
      path: "tds.summary",
      title: "Year Summary",
      description: "The year at a glance: TDS payable by section and quarter with what is deposited and what is pending, the months with tax still to deposit and when it is due, and TDS receivable.",
      auth: "business",
      requiredRole: "viewer",
      input: [{ ...FY, required: false, description: "Defaults to the current financial year." }, KIND],
      output: {
        description: "`payable.byQuarter[].returnDueDate` is the quarterly return's due date (31 Jul, 31 Oct, 31 Jan, 31 May). `payable.depositsDue` lists months with pending tax and flags the overdue ones.",
        example: {
          financialYear: "2026-27",
          payable: {
            total: "3000.00", deposited: "2000.00", pending: "1000.00",
            bySection: [{ sectionCode: "194H", total: "3000.00", deposited: "2000.00", pending: "1000.00" }],
            byQuarter: [{ quarter: 1, total: "2000.00", deposited: "2000.00", pending: "0.00", count: 1, returnDueDate: "2026-07-30T18:30:00.000Z" }],
            depositsDue: [{ month: "2026-08", pending: "1000.00", dueDate: "2026-09-06T18:30:00.000Z", overdue: true }],
          },
          receivable: { total: "100.00", bySection: [{ sectionCode: "194C", total: "100.00" }] },
        },
      },
      codeExamples: {
        curl: get("tds.summary", `{"financialYear":"2026-27"}`),
        javascript: `const s = await trpc.tds.summary.query({ financialYear: "2026-27" });
console.log("Still to deposit:", s.payable.pending);`,
      },
      gotchas: ["Due dates follow the current rules (deposit by the 7th of the next month, 30 April for March). Confirm with a CA."],
      relatedEndpoints: ["tds-deductions", "tds-challans"],
    },
    {
      id: "tds-return-data",
      method: "query",
      path: "tds.returnData",
      title: "Quarterly Return Data",
      description: "The figures for one quarter's TDS return: every TDS deduction in the quarter (deductee, PAN, section, amount paid or credited, TDS, and the challan it was deposited with), the quarter's challans, totals, the return due date, and the things to fix before filing. Returned as data and as two CSV strings. This is data for preparing the return, not a filed return: check the layout with your CA or return software.",
      auth: "business",
      requiredRole: "viewer",
      input: [FY, { name: "quarter", type: "number", required: true, description: "1 to 4 (Q1 is April to June)." }, KIND],
      output: {
        description: "`rows` are TDS we deducted (payable) only, not TDS customers deducted from us. `warnings` lists a missing TAN, deductees without a PAN (TDS was deducted at the higher rate) and deductions not yet on a challan. `deducteeCsv` and `challanCsv` have a header line, one line per row and a total line; dates are the Indian calendar day as DD/MM/YYYY; a deductee with no PAN shows `PANNOTAVBL`.",
        example: {
          deductor: { name: "Acme Traders", tan: "MUMA12345B", pan: "AABCA1234A", gstin: "27AABCA1234A1Z5" },
          financialYear: "2026-27", quarter: 3, returnDueDate: "2027-01-30T18:30:00.000Z",
          rows: [{ partyName: "CA Associates", pan: "AABCS1234D", hasPan: true, sectionCode: "194J_PROF", deductedOn: "2026-10-15T06:30:00.000Z", baseAmount: "60000.00", rate: "10.000", amount: "6000.00", invoiceNumber: "INV-00007", challan: { bsrCode: "0510308", challanNumber: "00041", depositedOn: "2026-11-05T06:30:00.000Z" } }],
          challans: [{ challanNumber: "00041", bsrCode: "0510308", depositedOn: "2026-11-05T06:30:00.000Z", amount: "6000.00", interest: "0.00", linked: "6000.00" }],
          totals: { deducted: "6000.00", deposited: "6000.00", pending: "0.00", deducteeCount: 1 },
          warnings: [],
          deducteeCsv: "Sr No,Deductee name,PAN,Section,...",
          challanCsv: "Sr No,BSR code,Challan serial no,...",
        },
      },
      codeExamples: {
        curl: get("tds.returnData", `{"financialYear":"2026-27","quarter":3}`),
        javascript: `const r = await trpc.tds.returnData.query({ financialYear: "2026-27", quarter: 3 });
if (r.warnings.length) console.warn(r.warnings);
await fs.promises.writeFile("deductees-q3.csv", r.deducteeCsv);`,
      },
      gotchas: [
        "Requires the `Tds` permission (owners, admins and accountants).",
        "The deductor's TAN comes from the business settings; without it the response carries a warning.",
        "Every deduction needs a challan before a return can be filed; `totals.pending` and the warnings show what is missing.",
      ],
      relatedEndpoints: ["tds-deductions", "tds-challans", "tds-create-challan"],
    },
    {
      id: "tds-certificate-parties",
      method: "query",
      path: "tds.certificateParties",
      title: "Certificate Parties",
      description: "The parties you deducted TDS from (or collected TCS from) in one quarter, with the number of entries, the tax, how much is on a deposited challan and how much is still pending. Use it to choose whom to call `tds.certificate` for.",
      auth: "business",
      requiredRole: "viewer",
      input: [KIND, FY, { name: "quarter", type: "number", required: true, description: "1 to 4 (Q1 is April to June)." }],
      output: {
        description: "An array, sorted by party name. Amounts are rupee strings.",
        example: [{ partyId: "3f1c2d4e-0000-4000-8000-000000000001", partyName: "CA Associates", pan: "AABCS1234D", count: 2, total: "7000.00", deposited: "6000.00", pending: "1000.00" }],
      },
      codeExamples: {
        curl: get("tds.certificateParties", `{"kind":"tds","financialYear":"2026-27","quarter":3}`),
        javascript: `const parties = await trpc.tds.certificateParties.query({ kind: "tds", financialYear: "2026-27", quarter: 3 });`,
      },
      gotchas: ["Requires the `Tds` permission (owners, admins and accountants).", "Only tax you deducted or collected (payable) is listed, not TDS customers deducted from you."],
      relatedEndpoints: ["tds-certificate"],
    },
    {
      id: "tds-certificate",
      method: "query",
      path: "tds.certificate",
      title: "TDS / TCS Certificate Statement",
      description: "One party's statement for a quarter as a base64 PDF: Form 16A style for TDS, Form 27D style for TCS. It lists the deductor or collector (name, TAN, PAN from the business settings; blank where not set), the party's name and PAN, each payment with section, amount paid or credited, tax and the challan (BSR code, number, deposit date) it is linked to, and the totals. Tax not linked to a challan is shown as pending. It is generated from your books and is NOT the certificate issued through TRACES, which exists only after the return is filed and processed; the PDF says so.",
      auth: "business",
      requiredRole: "viewer",
      input: [KIND, { name: "partyId", type: "string", required: true, description: "The supplier (TDS) or buyer (TCS), from `tds.certificateParties`." }, FY, { name: "quarter", type: "number", required: true, description: "1 to 4 (Q1 is April to June)." }],
      output: {
        description: "`base64` is the PDF; decode it and save it as `filename`. `totals` are rupee strings and `notes` lists what to know before relying on it (pending tax, missing TAN or PAN).",
        example: { filename: "tds-statement-CA-Associates-Q3-2026-27.pdf", contentType: "application/pdf", base64: "JVBERi0xLjMK...", totals: { paid: "70000.00", tax: "7000.00", deposited: "6000.00", pending: "1000.00" }, notes: ["This is a statement generated from the books of the deductor. It is NOT the certificate issued through TRACES. ..."] },
      },
      codeExamples: {
        curl: get("tds.certificate", `{"kind":"tds","partyId":"PARTY_ID","financialYear":"2026-27","quarter":3}`),
        javascript: `const c = await trpc.tds.certificate.query({ kind: "tds", partyId, financialYear: "2026-27", quarter: 3 });
await fs.promises.writeFile(c.filename, Buffer.from(c.base64, "base64"));`,
      },
      gotchas: [
        "Requires the `Tds` permission (owners, admins and accountants).",
        "Returns NOT_FOUND when no tax was recorded for the party in that quarter.",
        "Not a TRACES certificate: do not give it to the party as the official Form 16A / 27D.",
      ],
      relatedEndpoints: ["tds-certificate-parties", "tds-return-data"],
    },
    {
      id: "tds-reminders",
      method: "query",
      path: "tds.reminders",
      title: "Due-Date Reminders",
      description: "TDS and TCS deposits and quarterly returns that are due within 14 days or overdue, soonest first: the items the due-date reminder emails and the notifications bell are about. Deposits are the tax deducted in a month and not yet on a challan (due the 7th of the next month, 30 April for March TDS); a return is listed for every quarter with tax in it, since the books do not know whether it was filed. Due dates follow current rules: verify with a CA.",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: {
        description: "`daysUntil` is whole Indian calendar days to `dueDate` (negative when overdue). `key` is stable per item.",
        example: { items: [{ key: "deposit:tds:2026-27:2026-09", type: "deposit", kind: "tds", title: "TDS deducted in Sep 2026 to deposit", amount: "700.00", dueDate: "2026-10-06T18:30:00.000Z", daysUntil: 5, overdue: false, financialYear: "2026-27" }], note: "Verify due dates with your CA." },
      },
      codeExamples: {
        curl: get("tds.reminders", `null`),
        javascript: `const { items } = await trpc.tds.reminders.query();`,
      },
      gotchas: ["Requires the `Tds` permission (owners, admins and accountants)."],
      relatedEndpoints: ["tds-summary"],
    },
    {
      id: "tds-challans",
      method: "query",
      path: "tds.challans",
      title: "List Challans",
      description: "The challans recorded for a financial year, newest first, with how much TDS each one is linked to.",
      auth: "business",
      requiredRole: "viewer",
      input: [FY, { name: "quarter", type: "number", required: false, description: "1 to 4." }, KIND],
      output: {
        description: "`linked` is the TDS marked as deposited by this challan; the challan may be for more (interest).",
        example: [{ id: "uuid", kind: "tds", financialYear: "2026-27", quarter: 1, challanNumber: "00041", bsrCode: "0510308", depositedOn: "2026-06-05T06:30:00.000Z", amount: "2000.00", interest: "0.00", notes: null, linked: "2000.00", deductionCount: 1 }],
      },
      codeExamples: {
        curl: get("tds.challans", `{"financialYear":"2026-27"}`),
        javascript: `const challans = await trpc.tds.challans.query({ financialYear: "2026-27" });`,
      },
      relatedEndpoints: ["tds-create-challan", "tds-delete-challan"],
    },
    {
      id: "tds-create-challan",
      method: "mutation",
      path: "tds.createChallan",
      title: "Record Challan",
      description: "Record a deposit (ITNS 281 challan) and mark the TDS it pays as deposited. Only TDS you deducted (`payable`), for that financial year and quarter, that is not already on a challan. A bill or payment whose TDS is on a challan cannot be edited, cancelled or deleted until the challan is removed. Audit entry `tds.createChallan`.",
      auth: "business",
      requiredRole: "member",
      input: [
        FY,
        KIND,
        { name: "quarter", type: "number", required: true, description: "1 to 4. A challan covers one quarter." },
        { name: "challanNumber", type: "string", required: true, description: "Challan serial number, up to 10 characters." },
        { name: "bsrCode", type: "string", required: true, description: "7-digit BSR code of the bank branch." },
        { name: "depositedOn", type: "string (ISO datetime)", required: true, description: "Date the tax was deposited." },
        { name: "amount", type: "string", required: true, description: "Challan amount in rupees; may exceed the linked TDS (interest or fee)." },
        { name: "interest", type: "string", required: false, description: "Interest or fee included in the amount.", default: "0" },
        { name: "notes", type: "string", required: false, description: "Up to 500 characters." },
        { name: "deductionIds", type: "string[] (UUID)", required: true, description: "The TDS entries this challan pays, from `tds.deductions`." },
      ],
      output: { description: "The challan, with `linkedCount`.", example: { id: "uuid", kind: "tds", quarter: 1, challanNumber: "00041", bsrCode: "0510308", amount: "2000.00", linkedCount: 1 } },
      codeExamples: {
        curl: post("tds.createChallan", `{"financialYear":"2026-27","quarter":1,"challanNumber":"00041","bsrCode":"0510308","depositedOn":"2026-06-05T06:30:00.000Z","amount":"2000","deductionIds":["DEDUCTION_ID"]}`),
        javascript: `await trpc.tds.createChallan.mutate({
  financialYear: "2026-27", quarter: 1, challanNumber: "00041", bsrCode: "0510308",
  depositedOn: new Date().toISOString(), amount: "2000", deductionIds: [deductionId],
});`,
      },
      gotchas: [
        "NOT_FOUND when an entry id does not exist in this business.",
        "BAD_REQUEST when an entry is receivable, already on a challan, or from another quarter or year; or when the entries add up to more than `amount`.",
        "CONFLICT when a challan with the same BSR code, serial number and date already exists.",
      ],
      relatedEndpoints: ["tds-deductions", "tds-delete-challan"],
    },
    {
      id: "tds-delete-challan",
      method: "mutation",
      path: "tds.deleteChallan",
      title: "Delete Challan",
      description: "Remove a challan. Its TDS goes back to \"not yet deposited\" and the bills and payments it locked can be edited again. Audit entry `tds.deleteChallan`.",
      auth: "business",
      requiredRole: "member",
      input: [{ name: "id", type: "string (UUID)", required: true, description: "The challan." }],
      output: { description: "The removed challan's id and number.", example: { id: "uuid", challanNumber: "00041" } },
      codeExamples: {
        curl: post("tds.deleteChallan", `{"id":"CHALLAN_ID"}`),
        javascript: `await trpc.tds.deleteChallan.mutate({ id: challanId });`,
      },
      gotchas: ["NOT_FOUND when the challan does not exist (deleting twice fails the second time)."],
      relatedEndpoints: ["tds-challans", "tds-create-challan"],
    },
  ],
};
