import {
  Activity01Icon,
  Alert02Icon,
  AiChat02Icon,
  ApiIcon,
  BarCode01Icon,
  Building03Icon,
  Calculator01Icon,
  Calendar03Icon,
  Cancel01Icon,
  ChartBarLineIcon,
  CheckListIcon,
  Clock01Icon,
  CommandLineIcon,
  ComputerIcon,
  DeliveryTruck01Icon,
  Download04Icon,
  FileExportIcon,
  FileValidationIcon,
  GitCompareIcon,
  Invoice01Icon,
  Key01Icon,
  LaptopIcon,
  Layers01Icon,
  PaintBoardIcon,
  PercentIcon,
  PieChartIcon,
  QrCodeIcon,
  RefreshIcon,
  Route01Icon,
  SecurityCheckIcon,
  Share01Icon,
  ShoppingBag01Icon,
  SmartPhone01Icon,
  SourceCodeIcon,
  Target02Icon,
  TaxesIcon,
  Upload04Icon,
  UserAdd01Icon,
  UserGroupIcon,
  WarehouseIcon,
  WhatsappIcon,
} from "@hugeicons/core-free-icons";
import type { FeaturePage } from "./types";

/**
 * Feature pages for GST compliance, reporting and the platform (apps, team,
 * API and online store).
 *
 * Every claim here was checked against the product: the API routers (gst,
 * gstr2b, itc, eInvoice, ewayBill, reports, store, apiKey, target), the web
 * routes, packages/mcp and packages/cli, apps/mobile and apps/desktop, and the
 * help centre articles under src/content/help. Where the product has a known
 * limit (for example, the app exports GSTR-1 as CSV; its portal JSON is API-only, and
 * e-invoicing, e-way bills and GSTR-2B are not in the mobile app) the copy
 * says so or stays silent rather than overpromising.
 */
export const GST_PLATFORM_PAGES: FeaturePage[] = [
  // ── GST returns ──────────────────────────────────────────────
  {
    slug: "gst-filing",
    title: "GST returns, ready from your books",
    navLabel: "GST returns",
    tagline:
      "GSTR-1, GSTR-3B and the GSTR-9 annual return are worked out from the invoices you already raised, so month-end is a review, not a rebuild.",
    summary:
      "GSTR-1, GSTR-3B and GSTR-9 figures built live from your invoices and purchases, with HSN summaries, CSV export for your CA and GSTR-9 portal JSON.",
    icon: TaxesIcon,
    highlights: [
      {
        title: "GSTR-1 in every section",
        body: "B2B invoices, B2C large and small, the HSN summary, and credit and debit notes for the month, straight from your sale documents.",
        icon: Invoice01Icon,
      },
      {
        title: "GSTR-3B summary",
        body: "Outward supplies, input tax credit from purchase bills and your net tax payable, split into IGST, CGST and SGST.",
        icon: Calculator01Icon,
      },
      {
        title: "GSTR-9 annual return",
        body: "Pick a financial year to see the annual figures laid out table by table, and download the GSTR-9 JSON in the portal's format.",
        icon: Calendar03Icon,
      },
      {
        title: "Correct tax split every time",
        body: "Your state code and the party's state code decide CGST + SGST or IGST on each invoice, so the return totals follow on their own.",
        icon: PercentIcon,
      },
      {
        title: "Hand-off to your CA",
        body: "Export the month's GSTR-1 as a CSV named for the period, with your GSTIN and business name at the top, and send it on.",
        icon: FileExportIcon,
      },
      {
        title: "Composition scheme support",
        body: "Mark the business as a composition dealer and inter-state sale invoices are blocked, as the scheme requires.",
        icon: SecurityCheckIcon,
      },
    ],
    steps: [
      {
        title: "Set up GST once",
        body: "Enter your GSTIN and state code in business settings, add HSN or SAC codes and tax rates to your items, and state codes to your parties.",
      },
      {
        title: "Bill as usual",
        body: "Every sale invoice, credit note and purchase bill carries its tax. There is nothing extra to key in for the return.",
      },
      {
        title: "Open GST Returns and pick the month",
        body: "The GSTR-1 and GSTR-3B tabs are calculated live, so they always reflect the latest invoices, including edits made a minute ago.",
      },
      {
        title: "Review and file",
        body: "Check the totals, export the GSTR-1 CSV for your CA, and use the GSTR-3B figures when you or your CA file on the GST portal.",
      },
    ],
    details: [
      {
        heading: "What each GSTR-1 section contains",
        points: [
          "B2B: one row per sale invoice to a party with a GSTIN, with taxable value and CGST, SGST or IGST.",
          "B2C Large: inter-state invoices to unregistered buyers above ₹2.5 lakh, grouped by state.",
          "B2C Small: all other sales to unregistered buyers, grouped by tax rate.",
          "HSN summary: quantity, taxable value and tax for each HSN or SAC code.",
          "Credit notes and debit notes issued in the month, linked to the original invoice where you set one.",
        ],
      },
      {
        heading: "What is counted, and what is not",
        points: [
          "Sale invoices dated in the month are included; cancelled invoices are left out.",
          "Quotations, proforma invoices and delivery challans never appear in a return.",
          "Draft invoices dated in the month are counted, so finalise or cancel them before you file.",
          "The invoice date decides the month, not the day you created it.",
        ],
      },
      {
        heading: "More than returns on the same page",
        points: [
          "Profit & loss, trial balance and balance sheet, each with a side-by-side period comparison.",
          "A receivables ageing report and a party ledger you can export as CSV or PDF.",
          "A Tally export of your vouchers for a period, compatible with Tally ERP 9 and TallyPrime.",
          "A Tax Summary report under Reports shows output tax against input tax by GST rate for any date range.",
        ],
      },
    ],
    faqs: [
      {
        q: "Does Fintranzact file my return on the GST portal?",
        a: "No. Fintranzact prepares the figures and the files; you or your CA upload and file on the GST portal. In the app GSTR-1 is exported as a CSV for review, and GSTR-9 can be downloaded as portal-format JSON. A portal-format GSTR-1 JSON is also available through the API.",
      },
      {
        q: "Why is a sale missing from my GSTR-1?",
        a: "The usual reasons are that the invoice is cancelled, dated in a different month, or is a quotation or challan rather than an invoice. Check the invoice's status and date.",
      },
      {
        q: "Can my accountant see the GST reports without being able to edit invoices?",
        a: "Yes. Give them the Accountant role. Accountants can view reports and GST returns but have read-only access to invoices, parties and items.",
      },
      {
        q: "What happens to items that have no HSN code?",
        a: "They are reported under HSN 0000 in the HSN summary. Add an HSN or SAC code to every item to keep the summary accurate.",
      },
      {
        q: "Do I get these reports if my business is not GST-registered?",
        a: "Yes. Unregistered businesses still see total sales and purchases; the CGST, SGST and IGST split appears once the business is registered.",
      },
    ],
    related: ["gstr-2b-itc", "e-invoicing", "reporting", "invoicing"],
    helpPath: "/help/gst",
  },

  // ── e-Invoicing ──────────────────────────────────────────────
  {
    slug: "e-invoicing",
    title: "e-Invoicing with automatic IRN generation",
    navLabel: "e-Invoicing",
    tagline:
      "Connect your IRP login once and every eligible B2B sale invoice is registered in the background, with the IRN and signed QR code saved against it.",
    summary:
      "Register B2B invoices with the IRP automatically, with the IRN, acknowledgement and signed QR saved on each invoice, easy retries and 24-hour cancellation.",
    icon: QrCodeIcon,
    highlights: [
      {
        title: "Submitted as you save",
        body: "With e-invoicing switched on, a B2B sale invoice with tax is sent to the Invoice Registration Portal as soon as you save it.",
        icon: FileValidationIcon,
      },
      {
        title: "IRN and signed QR stored",
        body: "The IRN, acknowledgement number and date, signed QR code and signed invoice returned by the IRP are kept with the invoice.",
        icon: QrCodeIcon,
      },
      {
        title: "One dashboard for every status",
        body: "See generated, pending, failed and cancelled e-invoices at a glance, search by invoice number or party, and read the IRP's error on any failure.",
        icon: CheckListIcon,
      },
      {
        title: "Retry after fixing",
        body: "Correct the party, item or invoice and retry. The request is rebuilt from the current data, and Retry All Failed works through up to 50 at a time.",
        icon: RefreshIcon,
      },
      {
        title: "Cancel within 24 hours",
        body: "Cancel an IRN with the portal's reasons (duplicate, data entry mistake, order cancelled or others) inside the 24-hour window.",
        icon: Cancel01Icon,
      },
      {
        title: "Test in the sandbox first",
        body: "New connections start on the NIC sandbox. Test your setup, then switch to live when you are ready to issue real e-invoices.",
        icon: SecurityCheckIcon,
      },
    ],
    steps: [
      {
        title: "Create an IRP API user",
        body: "On the e-invoice portal, create an API user for your GSTIN. Fintranzact signs in with that user on your behalf.",
      },
      {
        title: "Save your credentials",
        body: "Turn on e-Invoice in business settings or the e-Invoicing settings tab and enter the API username and password. They are stored encrypted.",
      },
      {
        title: "Test the connection",
        body: "Click Test Connection to confirm the login works, then turn off sandbox mode to go live.",
      },
      {
        title: "Keep billing",
        body: "Eligible invoices are registered automatically. Check the Failed tab once a day, fix any missing details and retry.",
      },
    ],
    details: [
      {
        heading: "Which invoices are registered",
        points: [
          "Sale documents to a party with a GSTIN, where the total tax is more than ₹0.",
          "Credit notes and sales returns go to the IRP as credit notes; debit notes go as debit notes.",
          "Quotations, proforma invoices and delivery challans are never submitted.",
          "Tax is sent as CGST + SGST when your state matches the buyer's, and as IGST otherwise; reverse charge is flagged when set.",
        ],
      },
      {
        heading: "Getting invoices accepted first time",
        points: [
          "Fill in your business GSTIN, legal name, address, city, pincode and state code.",
          "Give each B2B customer a GSTIN, billing address, pincode and state code.",
          "Set an HSN or SAC code on every item; lines without one are sent as 9999, which the IRP may reject.",
          "Units are converted to GST unit codes automatically.",
        ],
      },
      {
        heading: "Who can do what",
        points: [
          "Owners and admins configure the connection, generate, retry and cancel.",
          "Accountants can view the e-invoicing dashboard.",
          "Sellers do not see e-invoicing at all.",
          "e-Invoicing is available in the web and desktop apps.",
        ],
      },
    ],
    faqs: [
      {
        q: "Do I need to be above the e-invoicing turnover limit to use this?",
        a: "No. Any GST-registered business can switch it on. The threshold you enter in settings is kept for reference; deciding whether e-invoicing is mandatory for you is up to you or your CA.",
      },
      {
        q: "An invoice shows Failed. How do I find out why?",
        a: "Hover over the warning icon next to the status on the e-Invoicing dashboard to read the exact error the IRP returned. Most failures come from a missing pincode, state code or HSN code.",
      },
      {
        q: "Will invoices I raised before switching it on be registered?",
        a: "Not automatically. Submission happens when an invoice is created, so earlier invoices stay as they are. They can still be registered through the API or the MCP server.",
      },
      {
        q: "Does cancelling the IRN cancel my invoice?",
        a: "No. It only cancels the e-invoice on the IRP. If the sale did not happen, cancel the invoice in Fintranzact too so it drops out of GSTR-1.",
      },
      {
        q: "Can I generate a new IRN for an invoice after cancelling it?",
        a: "Not for the same invoice. Create a new invoice with a new number and it will be registered afresh.",
      },
    ],
    related: ["e-way-bills", "gst-filing", "invoicing", "credit-notes-returns"],
    helpPath: "/help/gst/e-invoicing",
  },

  // ── e-Way bills ──────────────────────────────────────────────
  {
    slug: "e-way-bills",
    title: "e-Way bills for goods on the move",
    navLabel: "e-Way bills",
    tagline:
      "Generate e-way bills from your invoices through the NIC e-way bill system, update the vehicle when plans change, and see which bills are about to run out.",
    summary:
      "Generate e-way bills from your invoices through NIC, with validity worked out from distance, Part-B vehicle updates, 24-hour cancellation and expiry alerts.",
    icon: Route01Icon,
    highlights: [
      {
        title: "Generated from the invoice",
        body: "Pick the invoice, add the vehicle, distance and transport mode, and the e-way bill is created with party, address and HSN details filled in.",
        icon: Invoice01Icon,
      },
      {
        title: "Sales and purchases",
        body: "Generate for outward supplies on sale invoices and inward supplies on purchase invoices. Unregistered parties are sent as URP.",
        icon: DeliveryTruck01Icon,
      },
      {
        title: "Validity worked out for you",
        body: "Valid-upto is calculated from the distance: one day per 100 km for regular vehicles, one day per 20 km for over-dimensional cargo.",
        icon: Clock01Icon,
      },
      {
        title: "Update the vehicle (Part-B)",
        body: "Record a breakdown, transshipment or change of vehicle in a few taps. Every change is kept in the bill's vehicle history.",
        icon: RefreshIcon,
      },
      {
        title: "Expiring soon, flagged",
        body: "A dedicated tab lists bills that expire in the next 24 hours, soonest first, with the time left highlighted in red under 8 hours.",
        icon: Alert02Icon,
      },
      {
        title: "Cancel within 24 hours",
        body: "Cancel a bill for a data entry mistake, a cancelled order or another reason within 24 hours of generating it, then raise a fresh one.",
        icon: Cancel01Icon,
      },
    ],
    steps: [
      {
        title: "Connect your e-way bill login",
        body: "In business settings, turn on e-Way Bill and enter the API user and password you created on the NIC e-way bill portal. They are stored encrypted.",
      },
      {
        title: "Raise the invoice",
        body: "Create the sale or purchase invoice as usual, with HSN codes on the items and pincodes on the parties.",
      },
      {
        title: "Generate the e-way bill",
        body: "On the E-Way Bills page, choose the invoice and enter the vehicle number, distance, transport mode and, if you use one, the transporter.",
      },
      {
        title: "Track it until delivery",
        body: "Watch the colour-coded validity, update the vehicle if the goods change trucks, and cancel within 24 hours if the dispatch is called off.",
      },
    ],
    details: [
      {
        heading: "Checks before a bill is generated",
        points: [
          "The invoice total, including GST, reaches your e-way bill threshold: ₹50,000 unless you set your own in business settings.",
          "At least one line is goods; service-only invoices are refused.",
          "The invoice is not cancelled and does not already have an active e-way bill.",
          "Transport by road, rail, air or ship, over 1 to 4,000 km.",
        ],
      },
      {
        heading: "Addresses filled in for you",
        points: [
          "From and to pincodes default to your business and the party, the right way round for sales and purchases.",
          "Override either pincode when goods leave from or go to another place.",
          "Add the transporter's ID and name when a transporter carries the goods.",
          "Each line goes with the item's HSN code, so keep HSN codes on your items.",
        ],
      },
      {
        heading: "One view of every bill",
        points: [
          "Summary cards for generated, active, expiring soon and expired bills; click a card to filter.",
          "Valid-upto shown green, amber with hours left, or red once it has passed.",
          "Bill details include mode, vehicle, distance, from and to states and the full vehicle update history.",
          "Owners and admins generate, update and cancel; accountants can view. Available in the web and desktop apps.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can I generate an e-way bill for a purchase?",
        a: "Yes. Pick the purchase invoice and the bill is sent as an inward supply, with the supplier's details on the 'from' side.",
      },
      {
        q: "Can I use a lower threshold than ₹50,000?",
        a: "Yes. Enter your own E-Way Bill Threshold in business settings (some states set a lower limit for movement within the state). Leave it blank to use the ₹50,000 limit.",
      },
      {
        q: "How do I extend a bill that is about to expire?",
        a: "Extension is available through the API within 8 hours either side of expiry, and on the NIC e-way bill portal. There is no extend button on the page yet, so use Update Vehicle early if a consignment is delayed.",
      },
      {
        q: "Does cancelling an e-way bill cancel the invoice?",
        a: "No. If the supply itself was called off, cancel the invoice too so it drops out of your GST returns.",
      },
    ],
    related: ["e-invoicing", "delivery-challans", "gst-filing", "invoicing"],
    helpPath: "/help/gst/eway-bills",
  },

  // ── GSTR-2B & ITC ────────────────────────────────────────────
  {
    slug: "gstr-2b-itc",
    title: "GSTR-2B reconciliation and input tax credit",
    navLabel: "GSTR-2B & ITC",
    tagline:
      "Upload GSTR-2B, see which supplier bills match your books, and keep a clear ledger of the credit you can claim, the credit you have blocked and the credit at risk.",
    summary:
      "Match GSTR-2B against your purchase bills, find missing and mismatched invoices, block Section 17(5) credit and get 180-day alerts before ITC is lost.",
    icon: GitCompareIcon,
    highlights: [
      {
        title: "Upload GSTR-2B as JSON or CSV",
        body: "Drop in the file from the GST portal. B2B invoices, amendments, supplier credit and debit notes and ISD documents are read from the JSON.",
        icon: Upload04Icon,
      },
      {
        title: "Matched, mismatched, missing",
        body: "Each 2B record is matched to a purchase invoice by supplier GSTIN and bill number, then compared on taxable value, tax and date.",
        icon: GitCompareIcon,
      },
      {
        title: "Not in books, not in 2B",
        body: "See bills your suppliers reported that you have not entered, and bills you entered that your suppliers have not reported yet.",
        icon: CheckListIcon,
      },
      {
        title: "An ITC ledger that builds itself",
        body: "Every purchase invoice with GST adds an entry, split into CGST, SGST or IGST and marked for reverse charge where it applies.",
        icon: Layers01Icon,
      },
      {
        title: "Section 17(5) blocking",
        body: "Block credit on motor vehicles, food and beverages, personal use, club membership and other ineligible purchases, and unblock if needed.",
        icon: SecurityCheckIcon,
      },
      {
        title: "180-day ageing alerts",
        body: "Unpaid bills over 150 days old are flagged, and those past 180 days marked critical, with the credit at risk on each.",
        icon: Alert02Icon,
      },
    ],
    steps: [
      {
        title: "Enter the supplier's bill number",
        body: "Record purchase bills with the supplier's own invoice number and a party GSTIN. That is what the matching uses.",
      },
      {
        title: "Upload the month's GSTR-2B",
        body: "Pick the return period and upload the JSON or CSV. You see how many records matched and how many are missing within seconds.",
      },
      {
        title: "Work through the gaps",
        body: "Book the bills on the Not in Books tab, and follow up with suppliers on the Not in 2B tab. Upload again to re-run the match.",
      },
      {
        title: "Settle the ITC for GSTR-3B",
        body: "Block ineligible credit, review the GSTR-3B Table 4 view, and record how the credit was set off once you have filed.",
      },
    ],
    details: [
      {
        heading: "How matching works",
        points: [
          "Supplier GSTIN and invoice number must agree; case and extra spaces are ignored.",
          "Amounts may differ by about ₹1 to allow for rounding.",
          "Differences are listed per record: taxable value, CGST, SGST, IGST or a date more than 3 days apart.",
          "Records you have already dealt with can be ignored so they drop out of the ITC figures.",
          "Every upload is kept in the upload history; the newest one for a month is used.",
        ],
      },
      {
        heading: "The Input Tax Credit page",
        points: [
          "Dashboard cards for available, utilised, reversed and blocked credit, each split by CGST, SGST and IGST.",
          "A ledger of every entry for the period, filterable by status, with reverse-charge entries marked.",
          "Cancelling or deleting a purchase invoice reverses its credit automatically.",
          "No entries are created for composition dealers, who cannot claim ITC.",
        ],
      },
      {
        heading: "Utilisation and GSTR-3B Table 4",
        points: [
          "Record the period's set-off of CGST, SGST and IGST credit against output tax.",
          "Saving the set-off posts a journal entry between your input and output tax accounts.",
          "A Table 4 view lays out eligible ITC, reversals and ineligible ITC in the GSTR-3B rows.",
          "Available to owners, admins and accountants in the web and desktop apps.",
        ],
      },
    ],
    faqs: [
      {
        q: "Which file should I download from the GST portal?",
        a: "The GSTR-2B JSON is the most complete, as it carries amendments, credit and debit notes and ISD documents. A CSV works too if its header row uses the standard column names such as GSTIN and Invoice No.",
      },
      {
        q: "Why does a bill I definitely entered show as Not in Books?",
        a: "Usually the party's GSTIN or the bill number does not exactly match what the supplier reported. Use the supplier's own invoice number on the purchase bill.",
      },
      {
        q: "Does reconciling change my ITC claim?",
        a: "No. Reconciliation is a review tool. Credit comes from your purchase invoices, and you block or unblock it on the Input Tax Credit page.",
      },
      {
        q: "Will Fintranzact reverse credit on bills unpaid for 180 days?",
        a: "No, the ageing alert is a warning. Pay the supplier to clear it, or deal with the reversal when you file.",
      },
      {
        q: "Can I block only part of a bill's credit?",
        a: "No. Blocking applies to the whole ITC entry for that purchase invoice.",
      },
    ],
    related: ["gst-filing", "e-invoicing", "payments", "reporting"],
    helpPath: "/help/gst/gstr2b",
  },

  // ── Reporting ────────────────────────────────────────────────
  {
    slug: "reporting",
    title: "Business and accounting reports",
    navLabel: "Reports",
    tagline:
      "Two dozen ready-made reports and your financial statements, all built live from what you bill, buy, spend and stock, with CSV export for your CA.",
    summary:
      "Daybook, sales and purchase registers, outstanding ageing, MSME payables, stock reports, P&L, balance sheet and Tally export, all live from your books.",
    icon: ChartBarLineIcon,
    highlights: [
      {
        title: "Day-to-day registers",
        body: "The daybook, sales register and purchase register show every transaction for the period, with totals, tax and payment status.",
        icon: Invoice01Icon,
      },
      {
        title: "Who owes whom",
        body: "The outstanding report splits receivables and payables into current, 31-60, 61-90 and 90+ day buckets, with phone numbers for follow-up.",
        icon: Clock01Icon,
      },
      {
        title: "MSME pay-by dates",
        body: "See unpaid bills from micro and small suppliers with the date each must be paid by under Section 43B(h), capped at 45 days.",
        icon: Calendar03Icon,
      },
      {
        title: "Financial statements",
        body: "Profit & loss, trial balance and balance sheet, each with a period comparison, plus a cash flow statement.",
        icon: PieChartIcon,
      },
      {
        title: "Stock and order reports",
        body: "Stock summary, ledger, ageing, reorder and dead stock, and lists of what is still pending on orders, GRNs and challans.",
        icon: WarehouseIcon,
      },
      {
        title: "Export anywhere",
        body: "Download tabular reports as CSV for Excel or Google Sheets, and export vouchers for Tally ERP 9 or TallyPrime.",
        icon: Download04Icon,
      },
    ],
    steps: [
      {
        title: "Open Reports",
        body: "Every report is grouped in one sidebar: financial, receivables and payables, inventory, orders, and payments and tax.",
      },
      {
        title: "Pick a date range",
        body: "Choose this month, last month, the last 30 days, this or last financial year, a custom range or everything. The range stays as you move between reports.",
      },
      {
        title: "Drill in",
        body: "Filter by customers or suppliers, pick a party for its statement, sort item sales by revenue or margin, or compare with the previous period.",
      },
      {
        title: "Share or export",
        body: "Download the report as CSV, or export a party ledger as PDF to send as an account statement.",
      },
    ],
    details: [
      {
        heading: "The report library",
        points: [
          "Financial: daybook, sales register, purchase register.",
          "Receivables and payables: outstanding report, MSME payables, party statement.",
          "Inventory: stock summary, stock ledger, movement summary, stock group and godown summaries, stock ageing, reorder status, dead stock, price list and item-wise sales.",
          "Orders: pending sales orders, purchase orders, GRNs and delivery challans.",
          "Payments and tax: payment summary by mode, tax summary by GST rate, collection efficiency and cash flow statement.",
        ],
      },
      {
        heading: "Accounting statements",
        points: [
          "Profit & loss, trial balance and balance sheet, each with a side-by-side comparison of two periods.",
          "Receivables ageing and a party ledger with CSV and PDF export.",
          "Tally export of vouchers for a date range, compatible with Tally ERP 9 and TallyPrime.",
          "Your financial year starts in April by default and can be changed per business.",
        ],
      },
      {
        heading: "Numbers you can act on",
        points: [
          "Item-wise sales shows quantity, revenue, customers and margin for each product.",
          "Collection efficiency shows your on-time collection rate and days sales outstanding.",
          "The dashboard shows sales, purchases, expenses, receivables, payables and cash for the year at a glance.",
          "Reports are open to owners, admins, sales managers and accountants; sellers do not see them.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can I export reports to Excel?",
        a: "Yes. Every tabular report has a CSV download you can open in Excel or Google Sheets. Collection efficiency and the cash flow statement are card views and have no CSV.",
      },
      {
        q: "Do reports include cancelled or draft invoices?",
        a: "Cancelled invoices are left out. Drafts are counted, so finalise or cancel them if a figure looks high.",
      },
      {
        q: "Can I move my books to Tally?",
        a: "Yes. The Tally export gives you a file of vouchers for the period you choose, in a format compatible with Tally ERP 9 and TallyPrime.",
      },
      {
        q: "Why does the stock summary ignore my date range?",
        a: "It is a snapshot of stock right now. Use the stock ledger or movement summary to see stock over a period.",
      },
      {
        q: "Can I see reports on my phone?",
        a: "The mobile app shows the dashboard and a business reports screen with profit & loss, receivables ageing and expenses by category. The full report library is in the web and desktop apps.",
      },
    ],
    related: ["gst-filing", "inventory-reports", "payments", "banking"],
    helpPath: "/help/reports",
  },

  // ── Mobile & desktop apps ────────────────────────────────────
  {
    slug: "mobile-desktop-apps",
    title: "Web, desktop and mobile apps",
    navLabel: "Mobile & desktop",
    tagline:
      "Work in the browser, in a desktop app for Windows, macOS and Linux, or on your phone, with the same account and the same books everywhere.",
    summary:
      "Use Fintranzact in the browser, as a desktop app for Windows, macOS and Linux, or on Android and iOS, with one account and the same live data on every device.",
    icon: SmartPhone01Icon,
    highlights: [
      {
        title: "Nothing to install on the web",
        body: "Open Fintranzact in any modern browser and get every feature, from invoicing to GST returns and reports.",
        icon: ComputerIcon,
      },
      {
        title: "A proper desktop app",
        body: "The desktop app for Windows, macOS and Linux runs the full product in its own window, ideal for the billing counter or the accounts desk.",
        icon: LaptopIcon,
      },
      {
        title: "Bill from your phone",
        body: "Create and edit invoices, record payments, add parties and items, and share an invoice PDF on WhatsApp straight from the mobile app.",
        icon: SmartPhone01Icon,
      },
      {
        title: "One set of books",
        body: "Every app talks to the same account, so an invoice raised on the phone is on the office computer the moment it is saved.",
        icon: RefreshIcon,
      },
      {
        title: "Your team on their own devices",
        body: "Each person signs in with their own login and role, whether they are at the counter, in the warehouse or on the road.",
        icon: UserGroupIcon,
      },
    ],
    steps: [
      {
        title: "Create your account on the web",
        body: "Sign up, create your business and add your GSTIN, items and parties.",
      },
      {
        title: "Add the devices you need",
        body: "Install the desktop app on the counter or office computer and the mobile app on your phone.",
      },
      {
        title: "Sign in with the same account",
        body: "Pick your business from the switcher and carry on where you left off.",
      },
    ],
    details: [
      {
        heading: "What the mobile app covers",
        points: [
          "Invoices: create, edit, view and share the PDF in A4, A5 or thermal size.",
          "Quotations, proforma invoices, delivery challans, credit notes, sales returns and recurring invoices.",
          "Payments, expenses, and cash and bank accounts, including transfers between them.",
          "Parties, items, store orders and shipments.",
          "A dashboard with sales trend and invoice status, plus profit & loss, receivables ageing and expenses by category.",
          "Settings for your business, team invitations, online store and API keys.",
        ],
      },
      {
        heading: "Best done on web or desktop",
        points: [
          "GST returns (GSTR-1, GSTR-3B, GSTR-9), e-invoicing, e-way bills and GSTR-2B reconciliation.",
          "The full library of business, stock and accounting reports.",
          "Point of sale, warehouses, stock counts and manufacturing.",
          "Bulk imports from spreadsheets.",
        ],
      },
      {
        heading: "The desktop app",
        points: [
          "The same application as the web, with no features left out.",
          "Runs in its own resizable window rather than a browser tab.",
          "Available for Windows, macOS and Linux.",
        ],
      },
    ],
    faqs: [
      {
        q: "Do I pay separately for the apps?",
        a: "No. Your plan covers your account, and you can sign in to the web, desktop and mobile apps with it.",
      },
      {
        q: "Does data sync between my phone and computer?",
        a: "There is nothing to sync. Every app reads and writes the same books, so a change on one device shows on the others straight away.",
      },
      {
        q: "Can I file GST returns from my phone?",
        a: "Not yet. GST returns, e-invoicing, e-way bills and GSTR-2B reconciliation are in the web and desktop apps. Your invoices raised on the phone are included in them.",
      },
      {
        q: "Is the desktop app different from the website?",
        a: "It runs the same application, so every feature is there. It simply lives in its own window on your computer.",
      },
    ],
    related: ["invoicing", "team-roles", "point-of-sale", "api-integrations"],
    helpPath: "/help/getting-started",
  },

  // ── Team & roles ─────────────────────────────────────────────
  {
    slug: "team-roles",
    title: "Team access with roles and permissions",
    navLabel: "Team & roles",
    tagline:
      "Invite your staff and your CA, give each person a role that fits the job, and keep control of who can bill, edit, delete and see the numbers.",
    summary:
      "Invite admins, sales managers, sellers and your accountant, each with the right permissions, plus per-warehouse stock access, sales targets and an activity log.",
    icon: UserGroupIcon,
    highlights: [
      {
        title: "Roles made for Indian businesses",
        body: "Superadmin, admin, sales manager, seller and accountant, each with access that matches what they actually do.",
        icon: UserGroupIcon,
      },
      {
        title: "Invite by email",
        body: "Send an invitation with a role attached. It is valid for 7 days, and you can revoke it at any time before it is accepted.",
        icon: UserAdd01Icon,
      },
      {
        title: "Guard rails on edits",
        body: "Sellers and sales managers can change their own invoices and payments only in the first 2 hours; deleting payments is for admins.",
        icon: SecurityCheckIcon,
      },
      {
        title: "Warehouse-level stock access",
        body: "Decide, godown by godown, who may transfer stock, adjust it, count it or run production there.",
        icon: WarehouseIcon,
      },
      {
        title: "Sales targets",
        body: "Set targets for your salespeople and let each of them follow their own progress.",
        icon: Target02Icon,
      },
      {
        title: "Activity log",
        body: "See who did what in the business, filtered to today, this week or this month.",
        icon: Activity01Icon,
      },
    ],
    steps: [
      {
        title: "Open Settings, then Team",
        body: "Owners and admins see everyone in the business and any pending invitations.",
      },
      {
        title: "Invite a member",
        body: "Enter their email address and pick a role. They get an email with a link to join.",
      },
      {
        title: "They sign in and start work",
        body: "Once accepted, the business appears in their business switcher with exactly the access their role allows.",
      },
      {
        title: "Adjust as things change",
        body: "Change a role and it takes effect straight away, or remove someone and their access ends at once. Their past invoices stay intact.",
      },
    ],
    details: [
      {
        heading: "What each role can do",
        points: [
          "Superadmin: everything, including managing members. Only the owner can delete the business.",
          "Admin: full access to business data and settings, and can invite or remove members.",
          "Sales manager: invoices, parties, items, payments and the online store, with reports; limited deletes.",
          "Seller: creates invoices, records payments and adds parties; no reports, expenses or deletes.",
          "Accountant: payments, expenses and bank accounts, plus reports and GST; read-only on invoices, parties and items.",
        ],
      },
      {
        heading: "Working with your CA",
        points: [
          "Invite your CA as an accountant so they can see reports, GST returns and ITC without changing your bills.",
          "Roles are per business, so the same person can be an admin in one business and an accountant in another.",
          "One login can belong to several businesses and switch between them from the sidebar.",
        ],
      },
      {
        heading: "Keeping control",
        points: [
          "Sales managers can delete an unpaid invoice only within 2 hours of creating it.",
          "Importing data, inviting members and changing business settings are for superadmins and admins.",
          "Removing a member never deletes their invoices or payments; the creator's name stays on each record.",
          "The number of team members you can add depends on your plan.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can a salesperson see my profit figures?",
        a: "No. Sellers cannot open Reports or GST. They see the invoices and prices they work with, not your profit and loss.",
      },
      {
        q: "How do I give my CA access?",
        a: "Invite them from Settings, then Team, with the Accountant role. They can view reports, GST returns and ITC and manage payments and expenses, but cannot edit your invoices.",
      },
      {
        q: "Can I limit someone to one warehouse?",
        a: "For stock work, yes. Each warehouse has an Access tab where you choose who may transfer or adjust stock there. It does not restrict which warehouse they pick on invoices.",
      },
      {
        q: "What happens if an invitation expires?",
        a: "Invitations last 7 days. Delete the old one and send a fresh invitation.",
      },
      {
        q: "How do I pause someone's access without removing them?",
        a: "Change their role to Accountant. They keep read-only access to invoices, parties and items and can no longer create or edit invoices. Change it back when needed.",
      },
    ],
    related: ["warehouses", "mobile-desktop-apps", "api-integrations", "reporting"],
    helpPath: "/help/team",
  },

  // ── API & integrations ───────────────────────────────────────
  {
    slug: "api-integrations",
    title: "API, CLI and AI assistant integrations",
    navLabel: "API & integrations",
    tagline:
      "Everything you can do in the app is available through the API, so you can connect your own tools, script routine work, or let an AI assistant work in your books.",
    summary:
      "Connect Fintranzact to your tools with API keys, a typed API reference, a command-line tool with JSON output and an MCP server with 150+ AI assistant tools.",
    icon: ApiIcon,
    highlights: [
      {
        title: "API keys you control",
        body: "Create named keys with an optional expiry date. The key is shown once and stored only as a hash; revoke it whenever you like.",
        icon: Key01Icon,
      },
      {
        title: "The same API the app uses",
        body: "The web, desktop and mobile apps run on the same API, so invoices, parties, items, payments, GST and reports are all reachable.",
        icon: SourceCodeIcon,
      },
      {
        title: "A command-line tool",
        body: "Look things up, create records and run reports from the terminal. Add --json to any command to pipe the output into scripts.",
        icon: CommandLineIcon,
      },
      {
        title: "MCP server for AI assistants",
        body: "Connect Claude or any MCP-compatible assistant to your business with more than 150 tools across invoicing, stock, payments, GST and reports.",
        icon: AiChat02Icon,
      },
      {
        title: "Ready-made AI workflows",
        body: "Built-in prompts for a morning briefing, a party deep dive, GST filing prep, collection follow-up, inventory health and month close.",
        icon: CheckListIcon,
      },
      {
        title: "Your data, in and out",
        body: "Import parties and items from spreadsheets, export all of your data whenever you like, and export vouchers to Tally.",
        icon: Share01Icon,
      },
    ],
    steps: [
      {
        title: "Create an API key",
        body: "In your account settings, open API keys, give the key a name and, if you like, an expiry date. Copy it; it is shown only once.",
      },
      {
        title: "Read the API reference",
        body: "The developer reference on this site explains authentication, conventions and every endpoint group, with examples.",
      },
      {
        title: "Pick your tool",
        body: "Call the API from your own code, sign in to the CLI with the key, or add the MCP server to your AI assistant's configuration.",
      },
      {
        title: "Automate the routine",
        body: "Send the overdue list every morning, prepare the month's GST figures, or create invoices from orders in another system.",
      },
    ],
    details: [
      {
        heading: "What the API covers",
        points: [
          "Invoices and every other sales and purchase document, payments, expenses and journal entries.",
          "Parties, items, stock, warehouses and price levels.",
          "GST returns, e-invoicing, e-way bills, GSTR-2B and input tax credit.",
          "Reports, bank accounts and reconciliation, the online store, shipments and sales targets.",
          "Every request works on one business, chosen with a business ID, so multi-business setups stay separate.",
        ],
      },
      {
        heading: "The CLI and MCP server",
        points: [
          "The CLI has commands for invoices, parties, items, payments, expenses, bank, GST, ITC, e-invoices, e-way bills, reports, store and backups.",
          "Tables by default, clean JSON with --json for scripts and scheduled jobs.",
          "The MCP server runs locally next to your AI assistant and talks to your Fintranzact account with your credentials.",
          "It also offers read-only resources your assistant can consult, such as business details and summaries.",
        ],
      },
      {
        heading: "Access and safety",
        points: [
          "API keys are tied to your login and your organisation; each call has the same permissions as your role.",
          "Keys can expire on a date you choose and can be revoked instantly.",
          "How many keys you can create depends on your plan.",
        ],
      },
    ],
    faqs: [
      {
        q: "Do I need to be a developer to use this?",
        a: "Not for the AI assistant. Once the MCP server is added to your assistant, you ask in plain English, for example 'which customers owe me more than ₹10,000?', and it uses the tools for you. The API and CLI are aimed at developers.",
      },
      {
        q: "Can an AI assistant change my books?",
        a: "Yes, if you let it. The MCP server can create and update records as well as read them, with the permissions of the account it signs in with. Use a role with narrower access if you want it limited.",
      },
      {
        q: "Is there a REST API?",
        a: "The API is a typed RPC API over HTTPS. Requests and responses are JSON, so any language that can make HTTP calls can use it. The developer reference shows the exact request shapes.",
      },
      {
        q: "Where do I find the API reference?",
        a: "In the Developers section of this site. It covers authentication with API keys, request conventions and every endpoint group, with examples.",
      },
    ],
    related: ["team-roles", "mobile-desktop-apps", "reporting", "online-store"],
    helpPath: "/help/ai",
  },

  // ── Online store ─────────────────────────────────────────────
  {
    slug: "online-store",
    title: "Your own online store, linked to your books",
    navLabel: "Online store",
    tagline:
      "Publish a storefront for the items you choose, take orders from customers on their phones, and see every order arrive as an invoice ready to confirm.",
    summary:
      "Publish an online store for your items: customers order on their phone, each order becomes a draft invoice, and you confirm, pack and deliver from Fintranzact.",
    icon: ShoppingBag01Icon,
    highlights: [
      {
        title: "Your own store link",
        body: "Choose a store name for your link, add a tagline and accent colour, and share it on WhatsApp, Instagram or a printed card.",
        icon: PaintBoardIcon,
      },
      {
        title: "Pick what to sell",
        body: "Show only the items you want, set a store price, category, description and display order, or switch many items on at once.",
        icon: BarCode01Icon,
      },
      {
        title: "Variants and units",
        body: "Customers choose size, colour or unit on the product page, with a separate store price for each variant if you like.",
        icon: Layers01Icon,
      },
      {
        title: "Orders become invoices",
        body: "Each order creates a draft sale invoice with the customer as the party, so there is no retyping.",
        icon: Invoice01Icon,
      },
      {
        title: "Simple order tracking",
        body: "Move orders from pending to confirmed, preparing, ready and delivered, or cancel with a reason.",
        icon: DeliveryTruck01Icon,
      },
      {
        title: "A WhatsApp button",
        body: "Add your WhatsApp number and customers can message you from the storefront with a tap.",
        icon: WhatsappIcon,
      },
    ],
    steps: [
      {
        title: "Turn on the store",
        body: "In store settings, pick your store name, tagline, accent colour, minimum order, delivery note and order number prefix.",
      },
      {
        title: "Add items",
        body: "Tick Show in Store on the items you want to sell and set their store prices and categories.",
      },
      {
        title: "Share your link",
        body: "Customers browse, add to cart, enter their name, phone and address, and place the order.",
      },
      {
        title: "Confirm and deliver",
        body: "Confirm the order to send the invoice, move it through packing and delivery, and record the payment when it comes in.",
      },
    ],
    details: [
      {
        heading: "Store settings",
        points: [
          "A store link of your choice, a tagline and an accent colour.",
          "An optional minimum order amount and a delivery note shown at checkout.",
          "A choice to allow or stop orders for items that are out of stock.",
          "Sequential order numbers with your own prefix, such as ORD-00001.",
        ],
      },
      {
        heading: "How orders flow into your books",
        points: [
          "A new order creates a draft sale invoice linked to it.",
          "The customer is matched to an existing party by phone number, or added as a new one.",
          "Confirming the order moves the invoice from draft to sent.",
          "Cancelling the order cancels the linked invoice too.",
        ],
      },
      {
        heading: "Built to be safe and simple",
        points: [
          "Checkout is protected against bot orders with Cloudflare Turnstile, with nothing for you to set up.",
          "Customers do not need an account to order.",
          "Store orders can be handled from the web, desktop and mobile apps.",
          "Sales managers and admins can manage the store; sellers cannot.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can customers pay online in the store?",
        a: "Not at the moment. The store collects orders; you take payment on delivery, by UPI or however you usually do, and record it against the invoice.",
      },
      {
        q: "Do you take a commission on orders?",
        a: "No. Orders come straight to you as invoices in your own books, and Fintranzact takes no cut of them.",
      },
      {
        q: "Can I have more than one store?",
        a: "Each business has one store. If you run separate businesses in Fintranzact, each can have its own.",
      },
      {
        q: "Does cancelling an order put the stock back?",
        a: "No, not automatically. If you need the stock back, adjust it on the item after cancelling.",
      },
      {
        q: "Can I change how the store looks?",
        a: "You can set the tagline and accent colour. The layout itself is fixed and designed to work well on phones.",
      },
    ],
    related: ["inventory", "invoicing", "price-levels", "payments"],
    helpPath: "/help/online-store",
  },
];
