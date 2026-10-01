import type { EndpointGroup } from "./types";
import { API_BASE_URL } from "./api-base";

const get = (path: string, json?: string) => `curl "${API_BASE_URL}/api/trpc/${path}${json ? `?input=${encodeURIComponent(`{"json":${json}}`)}` : ""}" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`;
const post = (path: string, json: string) => `curl -X POST "${API_BASE_URL}/api/trpc/${path}" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":${json}}'`;

const REASON = { name: "reason", type: "string", required: true, description: "Why, 10 to 500 characters. Recorded in the audit log." };
const NOTE = { name: "note", type: "string", required: false, description: "Up to 300 characters." };

export const periodEndpoints: EndpointGroup = {
  id: "period",
  title: "Period Locks & Year Close",
  description: "Lock a period so entries dated in it cannot be added, edited or deleted, and close a financial year. **Books lock**: everything dated on or before a date (an Indian calendar day, never later than yesterday). **GST month lock**: a return month marked as filed. Every procedure that writes dated entries (invoices, payments, expenses, journals, stock documents, bank entries, input tax credit, imports) is refused with `FORBIDDEN` and a message starting `This period is locked.` — on the web, mobile, API, CLI and imports alike; an edit is checked against both its old and its new date. **Closing a year** freezes its closing balances (ledgers, stock, who owes what), carries them into the next year as opening balances, and locks the books through the year's last day. Owners, admins and accountants can lock and close; only the business owner can unlock or reopen, and each is audit-logged with a reason.",
  endpoints: [
    {
      id: "period-status",
      method: "query",
      path: "period.status",
      title: "Lock Status",
      description: "What is locked, and what the caller may do. Open to every member so an edit screen can explain a blocked change.",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: {
        description: "`booksLockedThrough` is `null` when the books are open.",
        example: {
          booksLockedThrough: "2026-03-31",
          booksLock: { by: "Rishi Soni", at: "2026-04-05T06:30:00.000Z", note: "FY 2025-26 filed" },
          gstMonths: [{ returnPeriod: "2026-08", by: "Meera (CA)", at: "2026-09-20T06:30:00.000Z", note: null }],
          closedYears: [{ financialYear: "2025-26", closedAt: "2026-04-05T06:30:00.000Z", closedByName: "Rishi Soni" }],
          canLock: true,
          canUnlock: false,
          today: "2026-10-02",
          latestLockableDate: "2026-10-01",
        },
      },
      codeExamples: { curl: get("period.status"), javascript: `const status = await trpc.period.status.query();` },
      relatedEndpoints: ["period-lock-books", "period-lock-gst-month"],
    },
    {
      id: "period-lock-books",
      method: "mutation",
      path: "period.lockBooks",
      title: "Lock Books",
      description: "Lock everything dated on or before `through`. Extends an existing lock; going back needs `period.unlockBooks`. Audit entry `period.lockBooks`.",
      auth: "business",
      requiredRole: "member",
      input: [{ name: "through", type: "string", required: true, description: "Last day to lock, `YYYY-MM-DD`, no later than yesterday." }, NOTE],
      output: { description: "The lock.", example: { id: "uuid", lockedThrough: "2026-03-31", previous: null } },
      codeExamples: {
        curl: post("period.lockBooks", `{"through":"2026-03-31","note":"FY 2025-26 filed"}`),
        javascript: `await trpc.period.lockBooks.mutate({ through: "2026-03-31" });`,
      },
      gotchas: ["Opening balances (party, bank) can't be changed while any lock exists."],
      relatedEndpoints: ["period-unlock-books"],
    },
    {
      id: "period-unlock-books",
      method: "mutation",
      path: "period.unlockBooks",
      title: "Unlock Books",
      description: "Owner only. Lower the books lock to `through`, or remove it with `through: null`. A closed year must be reopened with `period.reopenYear` instead. Audit entry `period.unlockBooks` with the reason.",
      auth: "business",
      requiredRole: "admin",
      input: [{ name: "through", type: "string", required: true, description: "New, earlier lock date `YYYY-MM-DD`, or `null` to remove the lock." }, REASON],
      output: { description: "The new state.", example: { lockedThrough: null, previous: "2026-03-31" } },
      codeExamples: {
        curl: post("period.unlockBooks", `{"through":null,"reason":"Correcting a wrongly dated invoice"}`),
        javascript: `await trpc.period.unlockBooks.mutate({ through: null, reason: "Correcting a wrongly dated invoice" });`,
      },
      gotchas: ["FORBIDDEN for anyone but the owner."],
    },
    {
      id: "period-lock-gst-month",
      method: "mutation",
      path: "period.lockGstMonth",
      title: "Mark GST Month as Filed",
      description: "Lock a return month whose GST returns are filed. Entries dated in it, and its input tax credit, can't be changed. Audit entry `period.lockGstMonth`.",
      auth: "business",
      requiredRole: "member",
      input: [{ name: "returnPeriod", type: "string", required: true, description: "Return month `YYYY-MM`." }, NOTE],
      output: { description: "The lock.", example: { id: "uuid", returnPeriod: "2026-08" } },
      codeExamples: {
        curl: post("period.lockGstMonth", `{"returnPeriod":"2026-08"}`),
        javascript: `await trpc.period.lockGstMonth.mutate({ returnPeriod: "2026-08" });`,
      },
      relatedEndpoints: ["period-unlock-gst-month"],
    },
    {
      id: "period-unlock-gst-month",
      method: "mutation",
      path: "period.unlockGstMonth",
      title: "Unlock GST Month",
      description: "Owner only. Reopen a month marked as filed. Audit entry `period.unlockGstMonth` with the reason.",
      auth: "business",
      requiredRole: "admin",
      input: [{ name: "returnPeriod", type: "string", required: true, description: "Return month `YYYY-MM`." }, REASON],
      output: { description: "The month reopened.", example: { id: "uuid", returnPeriod: "2026-08" } },
      codeExamples: {
        curl: post("period.unlockGstMonth", `{"returnPeriod":"2026-08","reason":"Amended return being filed"}`),
        javascript: `await trpc.period.unlockGstMonth.mutate({ returnPeriod: "2026-08", reason: "Amended return being filed" });`,
      },
    },
    {
      id: "period-close-year-preview",
      method: "query",
      path: "period.closeYearPreview",
      title: "Preview Year Close",
      description: "What closing a financial year would freeze: year profit, stock value, what customers owe and what you owe, the balanced opening balances for the next year, and warnings (drafts dated in the year).",
      auth: "business",
      requiredRole: "member",
      input: [{ name: "financialYear", type: "string", required: true, description: "Like `2025-26`." }],
      output: { description: "`ended` is false while the year is still running; `alreadyClosed` says it was closed before.", example: { financialYear: "2025-26", ended: true, alreadyClosed: false, warnings: ["3 draft invoices are dated in this year."], snapshot: { ledger: { yearProfit: "125000.00" }, stock: { totalValue: "540000.00" }, outstanding: { receivable: "88000.00", payable: "42000.00" }, openingBalances: [] } } },
      codeExamples: { curl: get("period.closeYearPreview", `{"financialYear":"2025-26"}`), javascript: `const p = await trpc.period.closeYearPreview.query({ financialYear: "2025-26" });` },
      relatedEndpoints: ["period-close-year"],
    },
    {
      id: "period-close-year",
      method: "mutation",
      path: "period.closeYear",
      title: "Close Year",
      description: "Close a finished year: store its closing balances and lock the books through its last day. The next year's trial balance opens with the carried-forward balances. Audit entry `period.closeYear`.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "financialYear", type: "string", required: true, description: "Like `2025-26`; the year must be over." },
        NOTE,
        { name: "force", type: "boolean", required: false, description: "Close even though the preview has warnings.", default: "false" },
      ],
      output: { description: "The close.", example: { id: "uuid", financialYear: "2025-26", lockedThrough: "2026-03-31", forced: false } },
      codeExamples: {
        curl: post("period.closeYear", `{"financialYear":"2025-26"}`),
        javascript: `await trpc.period.closeYear.mutate({ financialYear: "2025-26" });`,
      },
      gotchas: ["BAD_REQUEST when the year isn't over, is already closed, or has warnings and `force` is false."],
      relatedEndpoints: ["period-reopen-year"],
    },
    {
      id: "period-reopen-year",
      method: "mutation",
      path: "period.reopenYear",
      title: "Reopen Year",
      description: "Owner only. Remove a year's close and unlock the books from its start. A later closed year must be reopened first. Audit entry `period.reopenYear` with the reason.",
      auth: "business",
      requiredRole: "admin",
      input: [{ name: "financialYear", type: "string", required: true, description: "Like `2025-26`." }, REASON],
      output: { description: "The reopened year.", example: { id: "uuid", financialYear: "2025-26", lockedThrough: null } },
      codeExamples: {
        curl: post("period.reopenYear", `{"financialYear":"2025-26","reason":"Auditor asked for an adjustment"}`),
        javascript: `await trpc.period.reopenYear.mutate({ financialYear: "2025-26", reason: "Auditor asked for an adjustment" });`,
      },
    },
    {
      id: "period-closes",
      method: "query",
      path: "period.closes",
      title: "List Closed Years",
      description: "Closed years with their headline figures. Requires `Report:read`.",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: { description: "Newest year first.", example: [{ id: "uuid", financialYear: "2025-26", closedAt: "2026-04-05T06:30:00.000Z", closedByName: "Rishi Soni", note: null, yearProfit: "125000.00", stockValue: "540000.00", receivable: "88000.00", payable: "42000.00" }] },
      codeExamples: { curl: get("period.closes"), javascript: `const closes = await trpc.period.closes.query();` },
      relatedEndpoints: ["period-close-detail"],
    },
    {
      id: "period-close-detail",
      method: "query",
      path: "period.closeDetail",
      title: "Closed Year Detail",
      description: "The frozen closing balances of one year (every ledger account, stock, each party's balance) and the opening balances it hands to the next year. Requires `Report:read`.",
      auth: "business",
      requiredRole: "viewer",
      input: [{ name: "financialYear", type: "string", required: true, description: "Like `2025-26`." }],
      output: { description: "The stored snapshot.", example: { financialYear: "2025-26", snapshot: { version: 1, ledger: {}, stock: {}, outstanding: {}, openingBalances: [] } } },
      codeExamples: { curl: get("period.closeDetail", `{"financialYear":"2025-26"}`), javascript: `const d = await trpc.period.closeDetail.query({ financialYear: "2025-26" });` },
    },
  ],
};
