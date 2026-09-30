import type { EndpointGroup } from "./types";
const API_BASE_URL = (import.meta.env.API_URL || (typeof window !== "undefined" ? window.location.origin : "https://fintranzact-production.up.railway.app")).replace(/\/$/, "");

export const dashboardEndpoints: EndpointGroup = {
  id: "dashboard",
  title: "Dashboard",
  description: "High-level business overview widgets. All endpoints are read-only queries scoped to the active business. The `summary` endpoint is the primary KPI card — all others are secondary widgets for charts and leaderboards.",
  endpoints: [
    {
      id: "dashboard-summary",
      method: "query",
      path: "dashboard.summary",
      title: "Business Summary",
      description: "Core KPI summary for the active business. With no input (or neither date) the figures cover all time; pass `fromDate` and/or `toDate` to scope them to a period. `fyStart` reports the start of the current financial year (from the business's financial-year setting, April by default) so clients can build a \"This FY\" preset. Returns sales, purchases, expenses, receivables, payables, estimated cash position, and up to 10 recent invoices.",
      auth: "business",
      input: [
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Start of the summary period. If only `toDate` is given, the period starts at the financial year start. Omit both for all time." },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "End of the summary period. Open-ended when omitted." },
      ],
      output: {
        description: "Financial KPIs for the period plus 10 most recently created invoices.",
        example: {
          totalSales: "485000.00",
          totalPurchases: "210000.00",
          totalExpenses: "45000.00",
          receivable: "92000.00",
          payable: "38000.00",
          cashInHand: "189000.00",
          fyStart: "2026-04-01T00:00:00.000Z",
          recentInvoices: [
            {
              id: "inv-uuid",
              invoiceNumber: "INV-0042",
              partyName: "Sharma Electronics",
              totalAmount: "12500.00",
              status: "unpaid",
              invoiceDate: "2026-03-28T00:00:00.000Z",
            },
          ],
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/dashboard.summary" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const summary = await trpc.dashboard.summary.query();
console.log("Sales:", summary.totalSales);
console.log("Receivable:", summary.receivable);`,
        python: `import httpx

resp = httpx.get(
    "${API_BASE_URL}/api/trpc/dashboard.summary",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
summary = resp.json()["result"]["data"]["json"]
print("Sales:", summary["totalSales"])`,
      },
      gotchas: [
        "`receivable` and `payable` are always all-time (not period-scoped) — they represent open balances on non-paid, non-cancelled invoices regardless of the date range. Amounts offset by credit notes or sales returns (`totalAdjusted`) are deducted from the outstanding balance before computing these figures.",
        "`cashInHand` is an estimate: cash received from sales minus cash paid for purchases minus expenses in the selected period. It is NOT the actual bank balance.",
        "The financial year start month is read from the business record each time — if it changes, the default period window shifts accordingly.",
      ],
    },
    {
      id: "dashboard-shipping-summary",
      method: "query",
      path: "dashboard.shippingSummary",
      title: "Shipping Summary",
      description: "Compares shipping charges billed to customers (via invoice charges with labels matching 'shipping', 'freight', 'delivery', or 'courier') against actual shipping expenses recorded in the expense tracker. Returns the net margin on logistics.",
      auth: "business",
      input: [
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Start of the period" },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "End of the period" },
      ],
      output: {
        description: "Shipping amounts charged, spent, and net margin.",
        example: {
          charged: "18500.00",
          spent: "14200.00",
          net: "4300.00",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/dashboard.shippingSummary" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const shipping = await trpc.dashboard.shippingSummary.query({
  fromDate: "2026-04-01T00:00:00.000Z",
});
console.log("Net shipping margin:", shipping.net);`,
        python: `resp = httpx.get(
    "${API_BASE_URL}/api/trpc/dashboard.shippingSummary",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Only invoice-level charges (the `charges` JSONB array on invoices) are counted as 'charged'. Per-line-item shipping costs are not included.",
        "Expense matching uses a case-insensitive LOWER() comparison on the category name.",
      ],
    },
    {
      id: "dashboard-sales-trend",
      method: "query",
      path: "dashboard.salesTrend",
      title: "Sales Trend",
      description: "Monthly sales trend showing invoiced amount and actual cash collected per calendar month. Use this for line/bar charts. Specify `months` to control how many months of history to show, or provide explicit `fromDate`/`toDate`.",
      auth: "business",
      input: [
        { name: "months", type: "number", required: false, description: "Number of months of history to return (3–24, default 6). Ignored if fromDate/toDate are provided." },
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Override: start of the date range" },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "Override: end of the date range" },
      ],
      output: {
        description: "Array of monthly data points ordered by month ascending.",
        example: [
          { month: "2025-10-01T00:00:00.000Z", invoiced: "125000.00", collected: "98000.00" },
          { month: "2025-11-01T00:00:00.000Z", invoiced: "140000.00", collected: "120000.00" },
        ],
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/dashboard.salesTrend?input=%7B%22json%22%3A%7B%22months%22%3A12%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const trend = await trpc.dashboard.salesTrend.query({ months: 12 });
trend.forEach(({ month, invoiced, collected }) => {
  console.log(new Date(month).toLocaleString("en", { month: "short" }), invoiced, collected);
});`,
        python: `import urllib.parse, json

params = urllib.parse.quote(json.dumps({"json": {"months": 6}}))
resp = httpx.get(
    f"${API_BASE_URL}/api/trpc/dashboard.salesTrend?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
    },
    {
      id: "dashboard-top-outstanding",
      method: "query",
      path: "dashboard.topOutstanding",
      title: "Top Outstanding Customers",
      description: "Returns the top N customers by total outstanding balance (unpaid sales invoices + opening balance). Useful for a collections priority widget.",
      auth: "business",
      input: [
        { name: "limit", type: "number", required: false, description: "Number of customers to return (3–20, default 5)" },
      ],
      output: {
        description: "List of customers sorted by outstanding balance descending.",
        example: [
          { partyId: "party-uuid", partyName: "Meena Traders", outstanding: "45000.00" },
          { partyId: "party-uuid-2", partyName: "Kapoor Stores", outstanding: "28500.00" },
        ],
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/dashboard.topOutstanding?input=%7B%22json%22%3A%7B%22limit%22%3A10%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const top = await trpc.dashboard.topOutstanding.query({ limit: 10 });`,
        python: `params = urllib.parse.quote(json.dumps({"json": {"limit": 10}}))
resp = httpx.get(f"${API_BASE_URL}/api/trpc/dashboard.topOutstanding?input={params}", ...)`,
      },
      gotchas: [
        "Includes the party's `openingBalance` in the outstanding calculation. A party with a large opening balance and no invoices will still appear here.",
        "Only customers (`type = 'customer'`) are considered — not suppliers.",
      ],
    },
    {
      id: "dashboard-top-customers",
      method: "query",
      path: "dashboard.topCustomers",
      title: "Top Customers by Revenue",
      description: "Returns the top N customers ranked by total invoiced amount in the given period. Excludes draft and cancelled invoices.",
      auth: "business",
      input: [
        { name: "limit", type: "number", required: false, description: "Number of customers to return (3–20, default 5)" },
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Start of the period" },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "End of the period" },
      ],
      output: {
        description: "Customers ranked by total invoiced amount.",
        example: [
          { partyId: "party-uuid", partyName: "Sharma Electronics", totalAmount: "185000.00", invoiceCount: 14 },
          { partyId: "party-uuid-2", partyName: "Gupta Hardware", totalAmount: "92000.00", invoiceCount: 6 },
        ],
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/dashboard.topCustomers?input=%7B%22json%22%3A%7B%22limit%22%3A5%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const customers = await trpc.dashboard.topCustomers.query({ limit: 5 });`,
        python: `params = urllib.parse.quote(json.dumps({"json": {"limit": 5}}))
resp = httpx.get(f"${API_BASE_URL}/api/trpc/dashboard.topCustomers?input={params}", ...)`,
      },
    },
    {
      id: "dashboard-top-selling-items",
      method: "query",
      path: "dashboard.topSellingItems",
      title: "Top Selling Items",
      description: "Returns the top N items ranked by total revenue from sales invoices in the given period. Optionally filter by item type (product or service). Excludes draft and cancelled invoices.",
      auth: "business",
      input: [
        { name: "limit", type: "number", required: false, description: "Number of items to return (3–20, default 5)" },
        { name: "itemType", type: "'product' | 'service'", required: false, description: "Filter to a specific item type" },
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Start of the period" },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "End of the period" },
      ],
      output: {
        description: "Items ranked by total revenue.",
        example: [
          {
            itemId: "item-uuid",
            itemName: "Laptop Battery",
            unit: "pcs",
            totalQty: "45.00",
            totalAmount: "112500.00",
            invoiceCount: 18,
          },
        ],
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/dashboard.topSellingItems?input=%7B%22json%22%3A%7B%22limit%22%3A5%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const items = await trpc.dashboard.topSellingItems.query({
  limit: 5,
  itemType: "product",
});`,
        python: `params = urllib.parse.quote(json.dumps({"json": {"limit": 5, "itemType": "product"}}))
resp = httpx.get(f"${API_BASE_URL}/api/trpc/dashboard.topSellingItems?input={params}", ...)`,
      },
    },
    {
      id: "dashboard-expenses-by-category",
      method: "query",
      path: "dashboard.expensesByCategory",
      title: "Expenses by Category",
      description: "Returns total expenses grouped by category for the given period, ordered by total amount descending. Use for a pie or bar chart widget.",
      auth: "business",
      input: [
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Start of the period" },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "End of the period" },
      ],
      output: {
        description: "Array of category totals.",
        example: [
          { category: "Rent", total: "25000.00", count: 1 },
          { category: "Transport", total: "8500.00", count: 34 },
        ],
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/dashboard.expensesByCategory" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const breakdown = await trpc.dashboard.expensesByCategory.query();`,
        python: `resp = httpx.get(
    "${API_BASE_URL}/api/trpc/dashboard.expensesByCategory",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
    },
    {
      id: "dashboard-invoice-status-breakdown",
      method: "query",
      path: "dashboard.invoiceStatusBreakdown",
      title: "Invoice Status Breakdown",
      description: "Returns a count and total amount of invoices grouped by status (draft, unpaid, partial, paid, overdue, cancelled) for the given period. Useful for a status distribution widget.",
      auth: "business",
      input: [
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Start of the period" },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "End of the period" },
      ],
      output: {
        description: "Array of status groups.",
        example: [
          { status: "paid", count: 42, total: "380000.00" },
          { status: "unpaid", count: 8, total: "92000.00" },
        ],
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/dashboard.invoiceStatusBreakdown" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const breakdown = await trpc.dashboard.invoiceStatusBreakdown.query();`,
        python: `resp = httpx.get(
    "${API_BASE_URL}/api/trpc/dashboard.invoiceStatusBreakdown",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
    },
    {
      id: "dashboard-profit-and-loss",
      method: "query",
      path: "dashboard.profitAndLoss",
      title: "Profit & Loss",
      description: "Simple trading P&L for the active business. Revenue and purchases are the taxable value (total minus GST) of non-cancelled sale / purchase invoices in the period. Cost of goods sold uses periodic stock valuation: opening stock + purchases − closing stock, where stock is valued with the business's inventory valuation method (`weighted_average` or `fifo`, from inventory settings). Net profit is gross profit minus expenses. Returns margins and an expense breakdown by category.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Start of the period. Opening stock is valued as of 1 ms before this instant; when omitted, opening stock is 0 and all history is included." },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "End of the period. Closing stock is valued as of this instant (now when omitted)." },
      ],
      output: {
        description: "P&L summary. All amounts are decimal strings: `revenue`, `purchases` (taxable purchase value), `openingStock`, `closingStock`, `valuationMethod` (`weighted_average` | `fifo`), `cogs`, `grossProfit`, `grossMarginPercent`, `expenses` (by category, descending), `totalExpenses`, `netProfit`, `netMarginPercent`.",
        example: {
          revenue: "485000.00",
          purchases: "240000.00",
          openingStock: "62000.00",
          closingStock: "92000.00",
          valuationMethod: "weighted_average",
          cogs: "210000.00",
          grossProfit: "275000.00",
          grossMarginPercent: "56.7",
          expenses: [
            { category: "Rent", total: "25000.00" },
            { category: "Transport", total: "8500.00" },
          ],
          totalExpenses: "45000.00",
          netProfit: "230000.00",
          netMarginPercent: "47.4",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/dashboard.profitAndLoss?input=%7B%22json%22%3A%7B%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const pl = await trpc.dashboard.profitAndLoss.query({
  fromDate: "2026-04-01T00:00:00.000Z",
  toDate: "2027-03-31T23:59:59.999Z",
});
console.log("Net profit:", pl.netProfit, "(" + pl.netMarginPercent + "%)");`,
        python: `resp = httpx.get(
    "${API_BASE_URL}/api/trpc/dashboard.profitAndLoss",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Requires `Report:read` permission.",
        "COGS = openingStock + purchases − closingStock (periodic, Tally-style). Stock valuation is computed on the fly from purchase bills and manufacturing journals; nothing is posted to the ledger. Negative stock is valued at zero.",
        "Change the valuation method in inventory settings (`stock.updateSettings`); the response echoes the method used as `valuationMethod`.",
        "The input object is required (send `{}` for all time) — calling with no input at all fails validation.",
        "Draft invoices are included (only `cancelled` is excluded), and expense totals do not filter soft-deleted expenses.",
        "Margin percentages are returned as strings like '56.7' (one decimal place).",
      ],
    },
    {
      id: "dashboard-receivables-aging",
      method: "query",
      path: "dashboard.receivablesAging",
      title: "Receivables Aging",
      description: "Buckets all outstanding sale invoices by age (0–30 days, 31–60 days, 61–90 days, 90+ days) per customer. Uses due date if available, otherwise falls back to invoice date. Returns both per-party rows and an aggregate summary.",
      auth: "business",
      input: [],
      output: {
        description: "Per-party aging buckets and aggregate summary totals.",
        example: {
          rows: [
            {
              partyId: "party-uuid",
              partyName: "Meena Traders",
              current: "15000.00",
              days31_60: "8000.00",
              days61_90: "0.00",
              days90Plus: "22000.00",
              total: "45000.00",
            },
          ],
          summary: {
            current: "15000.00",
            days31_60: "8000.00",
            days61_90: "0.00",
            days90Plus: "22000.00",
            total: "45000.00",
          },
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/dashboard.receivablesAging" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const aging = await trpc.dashboard.receivablesAging.query();
const overdue = aging.rows.filter(r => parseFloat(r.days90Plus) > 0);`,
        python: `resp = httpx.get(
    "${API_BASE_URL}/api/trpc/dashboard.receivablesAging",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Only sale invoices with status NOT IN ('paid', 'cancelled', 'draft', 'adjusted') are included. Invoices fully covered by credit notes or sales returns (`adjusted` status) are excluded from aging.",
        "The aging uses the current server time — results will shift day to day.",
        "For the full outstanding report with payables and filtering, use `reports.outstanding` instead.",
      ],
      relatedEndpoints: ["reports-outstanding"],
    },
    {
      id: "dashboard-payment-mode-breakdown",
      method: "query",
      path: "dashboard.paymentModeBreakdown",
      title: "Payment Mode Breakdown",
      description: "Total and count of payments grouped by payment mode (cash, UPI, bank, cheque, …) for the period, ordered by total descending. Includes both received and made payments — it does not split by direction. Soft-deleted payments are excluded. Use for a donut chart of how money moves.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Start of the period (payment date)" },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "End of the period (payment date)" },
      ],
      output: {
        description: "Array of `{ mode, total, count }`, largest total first. `mode` is one of `cash`, `bank`, `upi`, `cheque`, `other`, `credit_card`, `debit_card`, `net_banking`, `wallet`; `total` is a decimal string.",
        example: [
          { mode: "upi", total: "185400.00", count: 212 },
          { mode: "bank", total: "142000.00", count: 18 },
          { mode: "cash", total: "46750.00", count: 95 },
          { mode: "cheque", total: "25000.00", count: 2 },
        ],
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/dashboard.paymentModeBreakdown?input=%7B%22json%22%3A%7B%22fromDate%22%3A%222026-04-01T00%3A00%3A00.000Z%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const modes = await trpc.dashboard.paymentModeBreakdown.query({
  fromDate: "2026-04-01T00:00:00.000Z",
  toDate: "2027-03-31T23:59:59.999Z",
});
modes.forEach(m => console.log(m.mode, m.total, m.count));`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"fromDate": "2026-04-01T00:00:00.000Z"}}))
resp = httpx.get(
    f"${API_BASE_URL}/api/trpc/dashboard.paymentModeBreakdown?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Requires `Report:read` permission.",
        "Money received from customers and paid to suppliers are summed together per mode. Use `reports.paymentSummary` for a received/paid split.",
        "The input object is required — send `{}` for all time.",
      ],
      relatedEndpoints: ["reports-payment-summary"],
    },
    {
      id: "dashboard-collection-efficiency",
      method: "query",
      path: "dashboard.collectionEfficiency",
      title: "Collection Efficiency",
      description: "How much of what was invoiced has been collected: sums `totalAmount` and `amountPaid` over sale invoices (document type `invoice`, excluding draft and cancelled) dated in the period and returns the collected percentage. When both dates are given, the same figure is computed for the immediately preceding period of equal length so the widget can show a trend.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Start of the period (invoice date)" },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "End of the period (invoice date). Both dates are needed for `prevEfficiencyPct`." },
      ],
      output: {
        description: "`totalInvoiced` and `totalCollected` are decimal strings; `efficiencyPct` is a whole-number percentage (0 when nothing was invoiced); `prevEfficiencyPct` is null unless both dates were given and the previous period had invoices.",
        example: {
          totalInvoiced: "485000.00",
          totalCollected: "393000.00",
          efficiencyPct: 81,
          prevEfficiencyPct: 74,
          invoiceCount: 128,
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/dashboard.collectionEfficiency?input=%7B%22json%22%3A%7B%22fromDate%22%3A%222026-07-01T00%3A00%3A00.000Z%22%2C%22toDate%22%3A%222026-09-30T23%3A59%3A59.999Z%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const eff = await trpc.dashboard.collectionEfficiency.query({
  fromDate: "2026-07-01T00:00:00.000Z",
  toDate: "2026-09-30T23:59:59.999Z",
});
const trend = eff.prevEfficiencyPct === null ? null : eff.efficiencyPct - eff.prevEfficiencyPct;`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {
    "fromDate": "2026-07-01T00:00:00.000Z",
    "toDate": "2026-09-30T23:59:59.999Z",
}}))
resp = httpx.get(
    f"${API_BASE_URL}/api/trpc/dashboard.collectionEfficiency?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Requires `Report:read` permission.",
        "`totalCollected` is the invoices' current `amountPaid`, so a payment received after the period for an invoice dated inside it still counts as collected.",
        "Credit notes / sales returns applied to an invoice are not counted as collections.",
        "Soft-deleted invoices are not explicitly filtered out.",
        "For the payments-based report with per-party detail, see `reports.collectionEfficiency`.",
      ],
      relatedEndpoints: ["reports-collection-efficiency", "dashboard-receivables-aging"],
    },
    {
      id: "dashboard-expense-category-breakdown",
      method: "query",
      path: "dashboard.expenseCategoryBreakdown",
      title: "Expense Category Breakdown",
      description: "Top expense categories for the period plus the grand total of all expenses, for a \"where the money goes\" widget. Soft-deleted expenses are excluded. Unlike `dashboard.expensesByCategory`, the list is capped and the grand total covers every category so you can render an \"Other\" slice.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Start of the period (expense date)" },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "End of the period (expense date)" },
        { name: "limit", type: "number", required: false, description: "Maximum number of categories to return (3–20)", default: "8" },
      ],
      output: {
        description: "`categories` is `{ category, total, count }[]` sorted by total descending; `grandTotal` is the sum of all matching expenses (decimal string).",
        example: {
          categories: [
            { category: "Rent", total: "150000.00", count: 6 },
            { category: "Salaries", total: "96000.00", count: 12 },
            { category: "Transport", total: "18450.00", count: 41 },
          ],
          grandTotal: "289300.00",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/dashboard.expenseCategoryBreakdown?input=%7B%22json%22%3A%7B%22limit%22%3A5%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { categories, grandTotal } = await trpc.dashboard.expenseCategoryBreakdown.query({
  fromDate: "2026-04-01T00:00:00.000Z",
  limit: 5,
});
const shown = categories.reduce((s, c) => s + parseFloat(c.total), 0);
const other = parseFloat(grandTotal) - shown;`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"limit": 5}}))
resp = httpx.get(
    f"${API_BASE_URL}/api/trpc/dashboard.expenseCategoryBreakdown?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Requires `Report:read` permission.",
        "`limit` outside 3–20 is rejected with BAD_REQUEST.",
      ],
      relatedEndpoints: ["dashboard-expenses-by-category"],
    },
    {
      id: "dashboard-monthly-comparison",
      method: "query",
      path: "dashboard.monthlyComparison",
      title: "Month-on-Month Comparison",
      description: "Compares the current calendar month with the previous one for sales, purchases and expenses. Sales and purchases are invoice totals (including GST) of `invoice` documents that are not draft or cancelled; expenses are summed by expense date. Takes no input.",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: {
        description: "Month labels (`en-IN` short month + 2-digit year) and, for each metric, `curr`/`prev` decimal strings and `pctChange` as a whole-number percentage (null when the previous month is zero).",
        example: {
          currMonth: "Sept 26",
          prevMonth: "Aug 26",
          sales: { curr: "412500.00", prev: "368000.00", pctChange: 12 },
          purchases: { curr: "198000.00", prev: "221400.00", pctChange: -11 },
          expenses: { curr: "48200.00", prev: "0", pctChange: null },
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/dashboard.monthlyComparison" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const cmp = await trpc.dashboard.monthlyComparison.query();
console.log(\`Sales \${cmp.currMonth}: ₹\${cmp.sales.curr} (\${cmp.sales.pctChange ?? "–"}% vs \${cmp.prevMonth})\`);`,
        python: `import httpx

resp = httpx.get(
    "${API_BASE_URL}/api/trpc/dashboard.monthlyComparison",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)
cmp = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Requires `Report:read` permission.",
        "Month boundaries are computed in the API server's local time zone (usually UTC), not IST, so invoices dated in the first hours of a month (IST) can land in the previous month.",
        "The current month is month-to-date, so early in a month `pctChange` is typically strongly negative.",
        "Soft-deleted invoices and expenses are not filtered out.",
      ],
      relatedEndpoints: ["dashboard-sales-trend", "dashboard-summary"],
    },
  ],
};
