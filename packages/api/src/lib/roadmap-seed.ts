/**
 * The starting roadmap for the "Upcoming features" board in the platform
 * admin console. Inserted once, the first time the board is opened on a
 * server whose roadmap is empty (see lib/roadmap.ts). After that the admins
 * own the list; editing this file does not change existing boards.
 *
 * Statutory rates and limits below are planning notes, not tax advice:
 * every figure is to be verified yearly with a CA before it is built in.
 */

import type { RoadmapBilling, RoadmapLaunchStage, RoadmapPriority, RoadmapStatus } from "@fintranzact/shared";

export interface RoadmapSeedItem {
  title: string;
  category: string;
  status: RoadmapStatus;
  priority: RoadmapPriority;
  launchStage: RoadmapLaunchStage;
  phase: number | null;
  billing: RoadmapBilling;
  priceNote: string | null;
  description: string;
  checklist: string[];
}

const PAYROLL_PRICE = "₹49 per active employee per month, minimum ₹499/month (covers 10); yearly 2 months free (ex-GST)";

const PAYROLL_INVENTORY_AND_DOMAINS: RoadmapSeedItem[] = [
  // ── 1. Payroll phase 1 ──────────────────────────────────────────────
  {
    title: "Payroll — Phase 1: employees, attendance, salary and payroll run",
    category: "Payroll",
    status: "planned",
    launchStage: "after_launch",
    priority: "high",
    phase: 1,
    billing: "paid_add_on",
    priceNote: PAYROLL_PRICE,
    description: `**Build order: 3** — Payroll Phase 1 + its billing (after 1 Plans, trial & billing and 2 AI Assistant Phase 1).

The core of the Payroll add-on: keep employee records, mark attendance and leave, set up salary structures that follow the Labour Codes, run payroll every month, and post it to the books. Billing (see "Payroll add-on billing") is built alongside this phase.

### Employee master
- Personal: name, date of birth, gender, father's/spouse's name, address, phone, email, photo
- Statutory IDs: PAN (for TDS), Aadhaar, UAN (for PF), ESIC IP number
- Job: employee code, date of joining, department, designation, branch/location (the branch decides which state's rules apply), manager, type (permanent / contract / intern)
- Bank: account number, IFSC, name as per bank
- Salary structure assigned to the employee
- Tax regime choice (new / old)
- Exit: last working day, reason, full & final settlement

### Attendance & leave
- Daily status: present / absent / half-day / week-off
- Check-in and check-out times
- Shifts, weekly offs, holiday calendar per state/branch plus national holidays
- Leave types CL / SL / EL-PL / LOP, with accrual, carry-forward and encashment rules
- Overtime (usually twice the ordinary wage rate — verify yearly with CA)
- Monthly paid days and LOP days feed the payroll run

### Salary structure
- Earnings: Basic, DA, HRA, conveyance, special allowance, bonus, incentives, overtime
- Labour Codes (in force since Nov 2025): "wages" (Basic + DA + retaining allowance) must be at least 50% of total remuneration; PF and gratuity are computed on wages (verify yearly with CA)
- Templates, e.g. "Staff 25k", "Manager 60k"
- Monthly amounts derived from annual CTC

### Payroll run
1. Lock attendance for the month
2. Calculate: earnings − LOP − deductions = net pay
3. Review and approve (maker-checker)
4. Payslips as PDF (email or share link)
5. Bank bulk-payment file
6. Automatic accounting entries: salary expense, PF / ESI / TDS / PT payable, salary payable — paid through the existing bank and journal screens`,
    checklist: [
      "Employee master: personal details and photo",
      "Employee master: PAN, Aadhaar, UAN, ESIC IP number",
      "Employee master: code, joining date, department, designation, branch, manager, type",
      "Employee master: bank account, IFSC, name as per bank",
      "Employee master: tax regime choice (new/old)",
      "Employee exit: last working day, reason, link to full & final",
      "Attendance: daily present/absent/half-day/week-off with check-in/out",
      "Shifts, weekly offs and holiday calendar per state/branch + national holidays",
      "Leave types CL/SL/EL-PL/LOP with accrual, carry-forward and encashment",
      "Overtime at the configured rate (default 2x ordinary wage)",
      "Monthly paid days and LOP days summary for payroll",
      "Salary components: Basic, DA, HRA, conveyance, special, bonus, incentives, overtime",
      "50% wage rule check (Basic + DA + retaining allowance ≥ 50% of remuneration)",
      "Salary structure templates",
      "Monthly salary derived from annual CTC",
      "Payroll run: lock attendance",
      "Payroll run: calculate earnings − LOP − deductions = net pay",
      "Payroll run: review and approve (maker-checker)",
      "Payslip PDF with email and share link",
      "Bank bulk-payment file",
      "Accounting entries: salary expense, PF/ESI/TDS/PT payable, salary payable",
      "Pay salaries through existing bank and journal screens",
      "CA review of rules and figures before go-live",
    ],
  },

  // ── 2. Payroll phase 2 ──────────────────────────────────────────────
  {
    title: "Payroll — Phase 2: PF, ESI, PT, TDS and statutory filings",
    category: "Payroll",
    status: "planned",
    launchStage: "after_launch",
    priority: "medium",
    phase: 2,
    billing: "paid_add_on",
    priceNote: PAYROLL_PRICE,
    description: `Statutory deductions and the files businesses submit every month, quarter and year — including businesses and employees that are NOT covered by PF, EPS or ESI. All rates and limits are editable settings per financial year and must be verified with a CA before go-live (and yearly after that).

### Deductions (verify yearly with CA)
- **PF / EPF:** 12% employee + 12% employer, of which 8.33% goes to EPS on wages up to ₹15,000; mandatory at 20+ employees
- **ESI:** employee 0.75%, employer 3.25% for wages ≤ ₹21,000/month; mandatory at 10+ employees in notified areas
- **Professional Tax:** state-wise slabs (e.g. Maharashtra, Karnataka, Gujarat, West Bengal), maximum ₹2,500 a year
- **TDS on salary (s.192):** projected annual income under the chosen regime; new regime has ₹75,000 standard deduction and the s.87A rebate
- **Labour Welfare Fund:** state-wise, half-yearly or yearly
- **Other deductions:** advances, loans/EMI, penalties

### Businesses and employees without PF / EPS / ESI
- Business settings: "PF registered?" (+ establishment code), "ESI registered?" (+ code), PT state(s), LWF state — if PF is off, PF/EPS never appear anywhere
- Employee settings: PF applicable yes/no
- EPS eligible yes/no, auto-suggested: joined PF after 1 Sep 2014 with wages > ₹15,000 → no EPS; age ≥ 58 → EPS stops; international workers are a special case
- "Excluded employee": wages > ₹15,000 and never a PF member (opted out)
- PF on actual wages or capped at ₹15,000
- VPF % (voluntary PF)
- ESI applicable yes/no, switched off automatically above ₹21,000 subject to the contribution-period rules
- PF split: with EPS → employer 8.33% (capped) to EPS, rest to EPF; without EPS → employer's full 12% to EPF

### Filings and registers
- PF ECR file for EPFO (only PF members; zero pension where there is no EPS)
- ESIC monthly contribution file
- TDS Form 24Q quarterly data
- Form 16 yearly
- PT returns per state
- Registers: wages, attendance, leave, bonus, gratuity`,
    checklist: [
      "Statutory rates and limits as settings per financial year",
      "Business settings: PF registered + establishment code",
      "Business settings: ESI registered + code",
      "Business settings: PT state(s) and LWF state",
      "Hide PF/EPS everywhere when the business has no PF",
      "Employee settings: PF applicable yes/no",
      "Employee settings: EPS eligible, with auto-suggest (post-Sep-2014 > ₹15,000, age 58, international workers)",
      "Employee settings: excluded employee (opted out, never a PF member)",
      "PF on actual wages or capped at ₹15,000",
      "VPF percentage",
      "PF/EPF calculation: 12% + 12%, EPS 8.33% capped; full 12% to EPF without EPS",
      "ESI calculation (0.75% / 3.25%, ≤ ₹21,000) with auto-off and contribution-period rules",
      "Professional Tax slabs by state (Maharashtra, Karnataka, Gujarat, West Bengal…)",
      "TDS on salary (s.192) for new and old regime, standard deduction and 87A rebate",
      "Labour Welfare Fund by state (half-yearly/yearly)",
      "Other deductions: advances, loan EMIs, penalties",
      "PF ECR file (PF members only; zero pension without EPS)",
      "ESIC monthly contribution file",
      "TDS Form 24Q quarterly data",
      "Form 16 yearly",
      "PT returns per state",
      "Registers: wages, attendance, leave, bonus, gratuity",
      "CA verification of all rates and limits before go-live",
    ],
  },

  // ── 3. Payroll phase 3 ──────────────────────────────────────────────
  {
    title: "Payroll — Phase 3: mobile attendance, self-service and biometric import",
    category: "Payroll",
    status: "planned",
    launchStage: "after_launch",
    priority: "medium",
    phase: 3,
    billing: "paid_add_on",
    priceNote: PAYROLL_PRICE,
    description: `Let employees take part directly, so HR is not keying everything in.

- **Mobile attendance** with selfie and geo-location
- **Employee login (self-service):** payslips, apply for leave, see attendance, download Form 16
- **Biometric device import** of attendance punches
- **New roles:** HR / Payroll manager, and Employee (sees only their own records)`,
    checklist: [
      "Mobile check-in/out with selfie",
      "Geo-location capture (and allowed-location rules)",
      "Employee login and invitation flow",
      "Self-service: payslips",
      "Self-service: leave application and approval",
      "Self-service: attendance view",
      "Self-service: Form 16 download",
      "Biometric device attendance import",
      "HR / Payroll manager role and permissions",
      "Employee role limited to own records",
    ],
  },

  // ── 4. Payroll phase 4 ──────────────────────────────────────────────
  {
    title: "Payroll — Phase 4: bonus, gratuity, full & final, loans and registers",
    category: "Payroll",
    status: "planned",
    launchStage: "after_launch",
    priority: "medium",
    phase: 4,
    billing: "paid_add_on",
    priceNote: PAYROLL_PRICE,
    description: `Year-end and exit processing. Figures to be verified yearly with a CA.

- **Bonus** under the Payment of Bonus Act: 8.33%–20% for eligible staff
- **Gratuity:** 15 days' wages per year of service; fixed-term staff qualify after 1 year under the new Labour Codes, otherwise after 5 years
- **Full & final settlement:** pending salary, leave encashment, gratuity, recoveries, relieving letter
- **Loans and advances:** issue, EMI recovery through payroll, balance tracking
- **Labour-law registers**`,
    checklist: [
      "Bonus eligibility and calculation (8.33%–20%)",
      "Gratuity calculation (15 days per year; 1 year fixed-term / 5 years others)",
      "Full & final: pending salary",
      "Full & final: leave encashment",
      "Full & final: gratuity and recoveries",
      "Relieving letter",
      "Loans/advances: issue, EMI recovery, balance",
      "Labour-law registers",
      "CA verification of bonus and gratuity rules",
    ],
  },

  // ── 5. Payroll add-on billing ───────────────────────────────────────
  {
    title: "Payroll add-on billing",
    category: "Platform",
    status: "planned",
    launchStage: "after_launch",
    priority: "high",
    phase: 1,
    billing: "paid_add_on",
    priceNote: PAYROLL_PRICE,
    description: `**Build order: 3** — Payroll Phase 1 + this billing (after 1 Plans, trial & billing and 2 AI Assistant Phase 1).

Payroll is sold separately from plans: any paid plan can add Payroll. Build alongside Payroll Phase 1.

### Pricing (ex-18% GST, editable in admin)
- ₹49 per active employee per month, minimum ₹499/month (covers 10 employees)
- Yearly: 2 months free
- Included in the Full Access Trial for up to 10 employees

### Admin controls
- Enable / disable Payroll per organisation from the admin console
- Extend the trial or grant Payroll free for an organisation
- Price per employee, minimum and yearly discount editable in admin, like plans

### Billing
- Billed monthly or yearly through Razorpay subscriptions, together with the plan (see "Checkout & subscription billing")
- Count = active employees in that month
- GST invoice from Finvera Solutions LLP

### When Payroll is off, or unpaid after the grace period
- The Payroll menu shows an "Add payroll" page with pricing
- Existing data becomes read-only (old payslips can still be downloaded) and is never deleted
- Every payroll API and screen checks the add-on — no bypass through the API, mobile app, CLI or MCP

### Partners
- Optional partner commission on Payroll, and credit towards partner badges

### Owner decision (1 Oct 2026)
- Partners earn commission on Payroll, like on plans, and it counts towards their badge`,
    checklist: [
      "Partner commission on Payroll (decided: yes) — include add-on revenue in payouts and badges",
      "Add-on on/off per organisation in admin",
      "Trial (up to 10 employees) and free grant per organisation",
      "Add-on pricing editable in admin (₹49/employee, ₹499 minimum, yearly 2 months free)",
      "Razorpay billing monthly/yearly with the plan",
      "Monthly active-employee count for billing",
      "GST invoice from Finvera Solutions LLP",
      "\"Add payroll\" page with pricing and Start trial",
      "Read-only payroll data when off/unpaid after grace; payslips still downloadable",
      "Paywall check on every payroll API and screen (web, mobile, CLI, MCP)",
      "Partner commission and badge credit (if approved)",
    ],
  },

  // ── 6–12. Inventory, GST and mobile ─────────────────────────────────
  {
    title: "Serial / IMEI numbers",
    category: "Inventory",
    status: "planned",
    launchStage: "after_launch",
    priority: "medium",
    phase: null,
    billing: "included",
    priceNote: null,
    description: `Track individual units by serial or IMEI number, for electronics, mobiles and appliances.

- Mark an item as serial-tracked
- Capture serial / IMEI numbers on purchases and goods receipts, and pick them on sales
- Look up a serial number's history (bought from, sold to, warranty dates)
- Serials on invoice PDFs and in stock reports`,
    checklist: [
      "Serial-tracked flag on items",
      "Capture serials on purchase / GRN",
      "Pick serials on sales invoices and challans",
      "Prevent selling the same serial twice",
      "Serial number history and lookup",
      "Serials on invoice PDFs",
      "Serial-wise stock report",
      "Import serials from CSV",
    ],
  },
  {
    title: "Job work (ITC-04)",
    category: "Inventory",
    status: "planned",
    launchStage: "after_launch",
    priority: "medium",
    phase: null,
    billing: "included",
    priceNote: null,
    description: `Send goods to a job worker and receive them back, with the stock and GST records this needs.

- Job-work challan for goods sent out (stock moves to the job worker, not sold)
- Receive processed goods and scrap back
- Pending-with-job-worker report, with the 1-year / 3-year return limits
- ITC-04 return data`,
    checklist: [
      "Job-work out challan",
      "Stock location for goods at job workers",
      "Receive back processed goods and scrap",
      "Job-work charges bill linked to the challan",
      "Pending with job worker report (1/3-year limits)",
      "ITC-04 data export",
    ],
  },
  {
    title: "Landed cost",
    category: "Inventory",
    status: "planned",
    launchStage: "after_launch",
    priority: "medium",
    phase: null,
    billing: "included",
    priceNote: null,
    description: `Add freight, customs duty, insurance and other charges to the cost of purchased stock, so margins and stock valuation are right.

- Link expense or purchase bills (freight, clearing, duty) to a purchase
- Split charges by value, quantity or weight
- Updated item cost flows into stock valuation and profit reports`,
    checklist: [
      "Landed cost voucher linked to purchases/GRNs",
      "Allocate by value, quantity or weight",
      "Update item cost and stock valuation",
      "Show landed cost in item and profit reports",
    ],
  },
  {
    title: "Kits / bundles",
    category: "Inventory",
    status: "planned",
    launchStage: "after_launch",
    priority: "medium",
    phase: null,
    billing: "included",
    priceNote: null,
    description: `Sell several items together as one product (gift hampers, combo packs, spare-part kits).

- Define a kit from component items and quantities
- Selling a kit reduces component stock
- Kit price fixed or from components; GST per component or per kit`,
    checklist: [
      "Kit definition (components and quantities)",
      "Sell kits on invoices and POS",
      "Reduce component stock on sale",
      "Kit pricing and GST treatment",
      "Kit availability from component stock",
    ],
  },
  {
    title: "E-way bills from challans and stock transfers",
    category: "GST",
    status: "planned",
    launchStage: "after_launch",
    priority: "medium",
    phase: null,
    billing: "included",
    priceNote: null,
    description: `Generate e-way bills for goods that move without a sales invoice.

- From delivery challans (job work, supply on approval, exhibitions)
- From stock transfers between warehouses/branches (including other GSTINs of the same business)
- Right document type and transaction type on each`,
    checklist: [
      "E-way bill from delivery challan",
      "E-way bill from stock transfer",
      "Document and sub-supply types for each case",
      "Vehicle update and cancel from these screens",
      "Show e-way bill number on challan/transfer PDFs",
    ],
  },
  {
    title: "Warehouse features on mobile and CLI",
    category: "Mobile",
    status: "planned",
    launchStage: "after_launch",
    priority: "medium",
    phase: null,
    billing: "included",
    priceNote: null,
    description: `Bring the web's warehouse screens to the mobile app and the CLI/MCP: warehouses, stock by location, transfers, adjustments and physical stock verification. Remove the matching parity exceptions once done.`,
    checklist: [
      "Mobile: warehouse list and stock by warehouse",
      "Mobile: stock transfers",
      "Mobile: stock adjustments",
      "Mobile: physical stock verification (scan and count)",
      "CLI/MCP: warehouse and stock commands",
      "Remove parity exceptions for stock.*",
    ],
  },
  {
    title: "Free quantity & rejections on POS, mobile and CLI/MCP",
    category: "Mobile",
    status: "planned",
    launchStage: "after_launch",
    priority: "medium",
    phase: null,
    billing: "included",
    priceNote: null,
    description: `Free quantities on document lines and GRN rejections are on the web. Bring the same to POS, the mobile app and the CLI/MCP.`,
    checklist: [
      "POS: free quantity on lines",
      "Mobile: free quantity on document lines",
      "Mobile: GRN rejections",
      "CLI/MCP: free quantity and rejections",
      "Remove matching parity exceptions",
    ],
  },

  // ── 13. Old domains ─────────────────────────────────────────────────
  {
    title: "Redirect old docs and API docs domains",
    category: "Platform",
    status: "planned",
    launchStage: "before_launch",
    priority: "high",
    phase: null,
    billing: "included",
    priceNote: null,
    description: `Owner action (DNS / Vercel): send the old documentation domains to their new homes in the app.

- docs.fintranzact.com → /help
- api-docs.fintranzact.com → /developers

Use permanent (301) redirects and keep the path where a matching page exists.`,
    checklist: [
      "docs.fintranzact.com → /help (301)",
      "api-docs.fintranzact.com → /developers (301)",
      "Update DNS / Vercel project settings",
      "Check old links from search results land on the right page",
    ],
  },
];

/** A feature that is part of every plan (not a paid add-on). */
function feature(
  launchStage: RoadmapLaunchStage,
  priority: RoadmapPriority,
  category: string,
  title: string,
  description: string,
  checklist: string[],
): RoadmapSeedItem {
  return { title, category, status: "planned", priority, launchStage, phase: null, billing: "included", priceNote: null, description, checklist };
}

// ── Before launch ─────────────────────────────────────────────────────

const BEFORE_LAUNCH: RoadmapSeedItem[] = [
  feature(
    "before_launch",
    "high",
    "Accounting",
    "TDS & TCS on transactions",
    `Deduct and track income-tax TDS and TCS on everyday transactions, and produce the data for the quarterly returns. Sections, rates and thresholds are settings per financial year — verify yearly with CA.

### TDS on supplier payments
- Set a TDS section on each party / expense ledger: 194C (contractors), 194J (professional / technical fees), 194H (commission), 194I (rent), 194Q (purchase of goods above the yearly threshold) and others
- Threshold tracking per party per financial year (single-payment and aggregate limits), including 194Q's limit on purchases in the year
- Higher rate when the party has no valid PAN (s.206AA) and for specified non-filers where applicable
- TDS worked out on the bill or on the payment, whichever is earlier, and shown on the bill and payment

### TDS receivable (customers deduct from us)
- Record TDS deducted by customers against invoices and receipts, so the invoice is fully settled
- TDS receivable ledger, reconciled with Form 26AS / AIS

### TCS on sales (s.206C)
- TCS on specified goods and cases under s.206C, by item or party setting
- TCS on sale of goods (old s.206C(1H)) was removed from 1 April 2025; the Income-tax Act, 2025 renumbers sections from 1 April 2026 — confirm every section with the CA
- TCS shown on the invoice and collected with it

### Ledgers, challans and returns
- TDS payable and TCS payable ledgers per section
- Challan entry (ITNS 281 / challan number, BSR code, date) to mark tax as paid; due-date reminders (by the 7th of the next month, verify with CA)
- Form 26Q data (TDS on non-salary payments) and Form 27EQ data (TCS), quarterly
- Form 16A / 27D certificates to download and share (generated from the books, not TRACES-issued)
- Filing, certificates and PAN/TAN checks through Sandbox.co.in — see "TDS & TCS return filing and certificates through Sandbox.co.in"`,
    [
      "TDS section master with rates and thresholds per financial year",
      "TDS section on parties and expense ledgers",
      "Threshold tracking per party per year (single and aggregate)",
      "194Q purchase-of-goods threshold tracking",
      "No-PAN higher rate (s.206AA)",
      "TDS on purchase bills and expense entries",
      "TDS on supplier payments and advances",
      "TDS receivable when customers deduct (invoices and receipts)",
      "TDS receivable reconciliation with 26AS / AIS",
      "TCS on sales under s.206C by item/party",
      "TDS payable and TCS payable ledgers per section",
      "Challan entry (BSR code, challan no., date) and due-date reminders",
      "Form 26Q quarterly data export",
      "Form 27EQ quarterly data export",
      "Form 16A / 27D certificates",
      "TDS/TCS reports: deducted, paid, pending",
      "CA verification of sections, rates and thresholds",
    ],
  ),
  feature(
    "before_launch",
    "high",
    "Payments",
    "Payment reminders, Razorpay payment links and UPI QR on invoices",
    `Get paid faster: remind customers automatically and let them pay from the invoice.

### Reminders
- Automatic overdue reminders: a few days before the due date, on the due date, then weekly while unpaid
- Channels: email, SMS, and a ready-to-send WhatsApp link (until the WhatsApp Business API is in)
- Per-business on/off, schedule and message template; stop when paid or when the customer is marked "do not remind"
- Reminder history on the invoice

### Pay now
- Razorpay payment link on the invoice and on its public share page
- UPI QR code (UPI ID and amount) printed on the invoice PDF
- Razorpay webhook marks the invoice paid automatically and records the payment against it (with gateway charges)
- Partial payments supported; the link always asks for the balance due`,
    [
      "Reminder settings per business (schedule, channels, templates)",
      "Scheduler: before due, on due, weekly after due",
      "Email reminders",
      "SMS reminders",
      "WhatsApp click-to-send link",
      "Stop reminders on payment / do-not-remind flag",
      "Reminder history on the invoice",
      "Razorpay payment link on invoice and share page",
      "UPI QR with amount on invoice PDF",
      "Razorpay webhook: verify signature and mark invoice paid",
      "Record gateway charges on the payment",
      "Partial payments and balance-due links",
    ],
  ),
  feature(
    "before_launch",
    "high",
    "Security",
    "Two-factor authentication for owners and admins",
    `Protect accounts that can see and change the books with a second step at sign-in.

- Authenticator-app codes (TOTP — Google Authenticator, Microsoft Authenticator, Authy)
- One-time backup codes, shown once and downloadable; can be regenerated
- Owners can require 2FA for everyone (or for owners/admins) in their organisation
- Platform admin can reset a user's 2FA after identity checks
- Remember a trusted device for 30 days; audit log entries for setup, use and reset`,
    [
      "TOTP setup with QR code and verification",
      "2FA step at sign-in (web, mobile, desktop)",
      "Backup codes: generate, download, use once, regenerate",
      "Enforce 2FA per organisation (all users or owners/admins)",
      "Platform admin 2FA reset",
      "Trusted device for 30 days",
      "Audit log entries for 2FA events",
      "Rate-limit and lock out repeated wrong codes",
    ],
  ),
  feature(
    "before_launch",
    "high",
    "Accounting",
    "Year-end closing and period lock",
    `Close a financial year cleanly and stop changes to months that are already filed.

- Lock a period (up to a date) so entries in it cannot be added, edited or deleted
- Carry forward closing balances (ledgers, stock, outstanding) into the new financial year
- Audit lock for months whose GST returns are filed, set by the CA/accountant
- Clear messages when an edit is blocked, and an owner-only unlock that is recorded in the audit log
- Applies everywhere: web, mobile, API, CLI and imports`,
    [
      "Lock-till date per business",
      "Block create/edit/delete of entries in locked periods (all channels)",
      "Audit lock for GST-filed months",
      "Owner-only unlock with audit log entry",
      "Year-end: carry forward ledger balances",
      "Year-end: carry forward stock and outstanding",
      "Profit transfer to capital / reserves on closing",
      "Clear blocked-edit messages in the UI",
    ],
  ),
  feature(
    "before_launch",
    "high",
    "Mobile",
    "Batch fields in the mobile app",
    `The API already requires a batch on inward entries for batch-tracked items; the mobile app needs the matching fields.

- Inward (purchase, GRN, stock in): batch number, manufacturing date, expiry date
- Outward (sales, challans): batch picker showing available quantity and expiry, earliest expiry first
- Near-expiry and expired warnings`,
    [
      "Batch and expiry fields on mobile purchase/GRN lines",
      "Batch picker on mobile sales and challan lines (FEFO)",
      "Show available quantity per batch",
      "Near-expiry and expired warnings",
      "Remove matching parity exceptions",
    ],
  ),
  feature(
    "before_launch",
    "medium",
    "Platform",
    "Accountant (CA) access across clients",
    `Let a business invite its CA, and let a CA work across all their clients with one login.

- "Invite my CA" from team settings
- Accountant roles: read-only, and filing-only (GST returns, reports, exports — no editing of sales)
- One login, switching between client businesses/organisations
- The client can remove access at any time; access is logged`,
    [
      "Invite my CA flow",
      "Read-only accountant role",
      "Filing-only accountant role (returns, reports, exports)",
      "Client switcher for accountants with many organisations",
      "Remove access and audit log",
      "Link with the partner programme (CA partners)",
    ],
  ),
  feature(
    "before_launch",
    "medium",
    "GST",
    "GSTR-4 annual return for composition dealers",
    `Composition taxpayers file GSTR-4 once a year (and CMP-08 every quarter). Due dates and rates to be verified yearly with CA.

- Build GSTR-4 tables from the year's data: outward supplies, inward supplies (registered and unregistered, reverse charge), tax paid
- Use the quarterly CMP-08 figures already paid
- Download JSON for upload to the GST portal, plus a readable summary`,
    [
      "Composition dealer setting and rate per business type",
      "CMP-08 quarterly statement data",
      "GSTR-4 outward supply table",
      "GSTR-4 inward supplies (registered, unregistered, RCM)",
      "Tax paid summary against CMP-08",
      "GSTR-4 JSON export for the GST portal",
      "CA verification of tables and due dates",
    ],
  ),
];

// ── After launch ──────────────────────────────────────────────────────

const AFTER_LAUNCH: RoadmapSeedItem[] = [
  feature(
    "after_launch",
    "high",
    "Integrations",
    "WhatsApp Business API messaging",
    `Send documents and reminders on WhatsApp directly from Fintranzact, through the official WhatsApp Business (Cloud) API.

- Send invoices, quotations, payment reminders and receipts as WhatsApp messages with the PDF/link
- Approved message templates per use; business's own number or a shared Fintranzact sender
- Delivery status: sent, delivered, read, failed — shown on the document
- Opt-in / opt-out handling for customers; message costs passed on or included per plan`,
    [
      "Meta WhatsApp Cloud API setup (business verification, number)",
      "Message templates: invoice, reminder, receipt, quotation",
      "Send from invoice, receipt and reminder screens",
      "Delivery and read status via webhooks",
      "Opt-in/opt-out handling",
      "Per-business sender number option",
      "Message usage and cost tracking",
    ],
  ),
  feature(
    "after_launch",
    "high",
    "Sales",
    "Customer portal",
    `A self-service page for each customer of a business.

- See all their invoices, credit notes and receipts
- Ledger and outstanding balance with ageing
- Pay online (Razorpay / UPI) against one or more invoices
- Download statements for any period
- Secure access by magic link or OTP; no password needed`,
    [
      "Portal access by magic link / OTP",
      "Invoices, credit notes and receipts list",
      "Ledger and outstanding with ageing",
      "Pay online against selected invoices",
      "Statement download for a period",
      "Business branding on the portal",
      "Enable/disable portal per customer",
    ],
  ),
  feature(
    "after_launch",
    "high",
    "Platform",
    "Regional languages: Hindi and Gujarati first",
    `Make the app and documents usable in the owner's language.

- Hindi and Gujarati first: app screens and invoice PDFs (with correct fonts)
- Then Marathi, Tamil, Telugu, Kannada, Bengali and others
- Language per user for screens; language per customer/document for PDFs
- Item and party names stay as typed; amounts in words in the chosen language`,
    [
      "Translation framework and string extraction (web)",
      "Hindi translations for app screens",
      "Gujarati translations for app screens",
      "Invoice PDFs in Hindi and Gujarati (fonts, amounts in words)",
      "Language per user and per customer",
      "Mobile app translations",
      "Marathi, Tamil and more",
    ],
  ),
  feature(
    "after_launch",
    "medium",
    "Accounting",
    "Multi-currency and export invoices",
    `Bill foreign customers and account for exchange differences.

- Invoices in USD, EUR and other currencies with an exchange rate per invoice (daily reference rates)
- Realised exchange gain/loss on payment; unrealised at period end
- Export invoices under LUT / bond (without IGST) or with IGST paid (refund route)
- SEZ supplies with and without payment; shipping bill and port code details for GSTR-1`,
    [
      "Currency on parties and documents",
      "Exchange rates (daily reference rate, editable per invoice)",
      "Realised exchange gain/loss on receipts and payments",
      "Unrealised gain/loss at period end",
      "Export invoice under LUT/bond",
      "Export with IGST paid",
      "SEZ supplies with/without payment",
      "Shipping bill number, date and port code for GSTR-1",
    ],
  ),
  feature(
    "after_launch",
    "medium",
    "Sales",
    "Offline / low-internet mode for POS and shops",
    `Keep billing when the internet drops, and sync later.

- POS keeps working offline: items, prices and customers cached on the device
- Offline invoices get a device-reserved number series so there are no clashes
- Automatic sync when back online, with clear conflict handling (stock, prices)
- Status indicator showing pending sync`,
    [
      "Offline cache of items, prices, customers",
      "Device-reserved invoice number series",
      "Offline invoice queue with retry",
      "Sync and conflict handling",
      "Pending-sync indicator",
      "Mobile app offline mode",
    ],
  ),
  feature(
    "after_launch",
    "medium",
    "Accounting",
    "Fixed asset register with depreciation",
    `Track fixed assets and post depreciation under both laws. Rates and useful lives to be verified yearly with CA.

- Asset register: purchase date, cost, put-to-use date, location, block
- Companies Act (Schedule II useful lives) — SLM or WDV
- Income Tax — block of assets, WDV rates, half rate when used under 180 days in the year
- Disposal and sale with profit/loss (books) and block adjustment (income tax)
- Automatic monthly/yearly depreciation journal entries`,
    [
      "Asset register and asset categories",
      "Companies Act depreciation (SLM/WDV, useful lives)",
      "Income Tax depreciation by block (WDV, half-rate rule)",
      "Depreciation schedule reports (both laws)",
      "Asset disposal/sale with gain or loss",
      "Automatic depreciation journal entries",
      "CA verification of rates and lives",
    ],
  ),
  feature(
    "after_launch",
    "medium",
    "Accounting",
    "Cost centres and projects",
    `See profit by project, branch or department.

- Tag income and expense lines (invoices, bills, expenses, journals) with a cost centre / project
- Split one line across several cost centres by amount or percentage
- Profit & loss per project and cost-centre reports`,
    [
      "Cost centre / project master",
      "Tag on invoice, bill, expense and journal lines",
      "Split lines across cost centres",
      "P&L per project / cost centre",
      "Filter existing reports by cost centre",
    ],
  ),
  feature(
    "after_launch",
    "low",
    "Accounting",
    "Budgets vs actuals",
    `Set budgets and compare them with actual figures.

- Monthly budgets per ledger (and per cost centre when available)
- Budget vs actual report with variance and %`,
    [
      "Budget entry per ledger per month",
      "Copy last year's actuals as a starting budget",
      "Budget vs actual report with variance",
      "Budget by cost centre",
    ],
  ),
  feature(
    "after_launch",
    "medium",
    "Payments",
    "Cheque management",
    `Handle cheques the way Indian businesses use them.

- Post-dated cheque (PDC) register for cheques received and issued, with due-date alerts
- Deposit and clearing status; cheque bounce handling that reverses the receipt and can add bank charges / penalty to the customer
- Cheque printing on common bank cheque layouts (CTS-2010)`,
    [
      "PDC register (received and issued)",
      "Due-date alerts for PDCs",
      "Deposit and clearing status",
      "Cheque bounce: reverse receipt, add charges",
      "Cheque printing templates for major banks",
    ],
  ),
  feature(
    "after_launch",
    "medium",
    "Platform",
    "Approval workflows",
    `Let owners set rules that need a manager's approval before a document goes out.

- Rules such as: purchase order above an amount, discount above a %, sale below cost, credit limit exceeded
- Approve / reject with comments, notifications to approvers, and an audit trail`,
    [
      "Approval rules per business",
      "PO above amount needs approval",
      "Discount above limit needs approval",
      "Credit-limit override approval",
      "Approve/reject with comments and notifications",
      "Audit trail of approvals",
    ],
  ),
  feature(
    "after_launch",
    "medium",
    "Sales",
    "CRM basics",
    `Track sales opportunities before they become invoices.

- Leads with source, contact details and owner
- Follow-ups with reminders
- Quotation pipeline stages and won/lost with reason
- Convert a won lead to a customer and its quotation to an invoice`,
    [
      "Leads with source and owner",
      "Follow-up tasks and reminders",
      "Pipeline stages linked to quotations",
      "Won/lost with reason",
      "Convert lead to customer",
      "Pipeline and conversion reports",
    ],
  ),
  feature(
    "after_launch",
    "low",
    "Sales",
    "Loyalty points, coupons and gift vouchers",
    `Bring customers back, in the POS and online store.

- Loyalty points earned per ₹ spent and redeemed on later bills
- Coupons (percentage or flat, with limits and validity)
- Gift vouchers sold and redeemed, with correct GST treatment (verify with CA)`,
    [
      "Loyalty rules: earn and redeem",
      "Customer points balance and history",
      "Coupons with limits and validity",
      "Gift voucher sale and redemption",
      "GST treatment for vouchers (CA check)",
      "POS and online store support",
    ],
  ),
  feature(
    "after_launch",
    "low",
    "Sales",
    "Delivery management",
    `Run your own deliveries.

- Assign a delivery person to invoices/orders
- Route list for the day
- Proof of delivery with photo or customer OTP
- Cash-on-delivery collection recorded against the invoice and settled by the delivery person`,
    [
      "Delivery person role and assignment",
      "Daily route list",
      "Proof of delivery: photo and OTP",
      "COD collection and settlement",
      "Delivery status for customers",
    ],
  ),
  feature(
    "after_launch",
    "low",
    "Sales",
    "Service and AMC",
    `For businesses that service what they sell.

- Service tickets with status, engineer and parts used
- Warranty lookup by serial number
- AMC contracts with visit schedule and automatic renewal invoices`,
    [
      "Service tickets and engineer assignment",
      "Parts used on tickets (stock out)",
      "Warranty lookup by serial number",
      "AMC contracts and visit schedule",
      "Automatic AMC renewal invoices",
    ],
  ),
  feature(
    "after_launch",
    "low",
    "Payments",
    "Customer subscription billing",
    `For businesses that bill their own customers on a subscription.

- Plans with monthly/quarterly/yearly billing, plan changes with proration
- Automatic collection through UPI AutoPay, e-NACH or card e-mandates (RBI e-mandate rules: pre-debit notification, limits)
- Failed-payment retries and dunning`,
    [
      "Customer plans and billing cycles",
      "Plan changes with proration",
      "UPI AutoPay mandates",
      "e-NACH and card e-mandates",
      "Pre-debit notifications",
      "Failed payment retries and dunning",
    ],
  ),
  feature(
    "after_launch",
    "medium",
    "Integrations",
    "Bank feeds",
    `Pull bank transactions automatically instead of uploading CSV statements.

- Account Aggregator (RBI AA framework) with customer consent, and direct bank APIs where available
- Daily fetch into bank reconciliation with the existing matching rules`,
    [
      "Account Aggregator partner and consent flow",
      "Direct bank API connections (where offered)",
      "Scheduled fetch into bank reconciliation",
      "Consent renewal and revocation",
    ],
  ),
  feature(
    "after_launch",
    "medium",
    "Integrations",
    "Marketplace sync: Amazon, Flipkart, Meesho, Shopify",
    `Bring marketplace orders into the books automatically.

- Orders to invoices, returns to credit notes, stock updated both ways
- Settlement reports matched to payouts, with fees and commissions as expenses
- GST TCS collected by the marketplace (s.52) and income-tax TDS (s.194-O) recorded as receivable and claimed`,
    [
      "Amazon orders and returns",
      "Flipkart orders and returns",
      "Meesho orders and returns",
      "Shopify orders and returns",
      "Stock sync both ways",
      "Settlement reconciliation with fees",
      "GST TCS (s.52) and TDS (s.194-O) receivable",
    ],
  ),
  feature(
    "after_launch",
    "medium",
    "Integrations",
    "Tally two-way sync",
    `Export to Tally exists; add import and live sync so businesses can run both during a switch.

- Import masters and vouchers from Tally (XML)
- Live sync through Tally's ODBC/XML port with a small desktop connector
- Conflict handling and a sync log`,
    [
      "Import ledgers, items and parties from Tally",
      "Import vouchers from Tally",
      "Desktop connector for live sync",
      "Two-way sync with conflict handling",
      "Sync log and errors",
    ],
  ),
  feature(
    "after_launch",
    "low",
    "Platform",
    "Automatic backup to Google Drive and data residency",
    `Give customers their own copy of their data, and be clear about where it lives.

- Scheduled backup (daily/weekly) to the customer's own Google Drive
- Restore from a backup
- Data stored in India; data residency statement for customers`,
    [
      "Google Drive connection (OAuth)",
      "Scheduled backups with retention",
      "Restore from a Drive backup",
      "Data residency statement (India)",
    ],
  ),
  feature(
    "after_launch",
    "low",
    "Platform",
    "Usage analytics in admin",
    `See which features each organisation uses, to guide the roadmap and support.

- Feature usage per organisation (invoices, POS, GST returns, inventory, API…)
- Active users and last activity
- Trends over time; no business data shown`,
    [
      "Usage event collection (privacy-safe)",
      "Feature usage per organisation",
      "Active users and last activity",
      "Usage trends in the admin console",
    ],
  ),
  feature(
    "after_launch",
    "low",
    "Inventory",
    "Manufacturing with batch picking, quality check and scrap",
    `Extend manufacturing (bills of material and the manufacturing journal) for batch-tracked and quality-controlled production.

- Pick raw-material batches (FEFO) when producing
- Finished goods get their own batch and expiry
- Quality check step: accept, reject or rework
- Scrap and by-products recorded with value`,
    [
      "Raw-material batch picking in manufacturing",
      "Finished goods batch and expiry",
      "Quality check step (accept/reject/rework)",
      "Scrap and by-products",
      "Production cost report",
    ],
  ),
];

// ── Online store ──────────────────────────────────────────────────────

const ONLINE_STORE: RoadmapSeedItem[] = [
  feature(
    "before_launch",
    "high",
    "Online store",
    "Online payments at store checkout",
    `**Build order: 4** — part of Store Pro (payments, domain, themes).

Let shoppers pay online when they order from a business's store, with the money going straight to that business.

### Payments
- Razorpay on each business's own account, so money settles directly to them — either Razorpay Route (linked accounts) or the business's own API keys stored encrypted
- UPI, cards and netbanking, plus a Cash on Delivery option the business can switch on or off
- Order total, delivery charge and taxes shown clearly before paying

### After payment
- Razorpay webhook (signature verified) marks the order paid and its draft invoice paid, recording the payment and gateway charges
- Failed or abandoned payments leave the order unpaid, with a retry link
- Refunds through Razorpay when an order is cancelled, full or partial, with a credit note/refund entry in the books`,
    [
      "Decide: Razorpay Route vs per-merchant keys",
      "Store payment settings (connect Razorpay, keys encrypted)",
      "Checkout with UPI, card and netbanking",
      "Cash on Delivery on/off per store",
      "Webhook: verify signature, mark order and draft invoice paid",
      "Record payment with gateway charges",
      "Retry link for failed payments",
      "Refunds on cancel (full/partial) with credit note",
      "Order and payment emails to the shopper",
    ],
  ),
  feature(
    "before_launch",
    "high",
    "Online store",
    "Store policy pages",
    `Every store needs its policy pages — Razorpay checks for them before approving online payments.

- Terms & Conditions, Refund & Cancellation, Shipping & Delivery, Contact Us and Privacy Policy pages for each store
- Editable templates pre-filled from the business's details (name, address, GSTIN, phone, email, return window)
- Linked in the store footer and at checkout; each page has its own URL to give to Razorpay`,
    [
      "Policy templates: Terms, Refund, Shipping, Contact, Privacy",
      "Pre-fill from business details",
      "Editor for each policy page",
      "Footer and checkout links",
      "Public URLs per page for Razorpay review",
    ],
  ),
  feature(
    "after_launch",
    "high",
    "Online store",
    "Custom domain for stores",
    `**Build order: 4** — part of Store Pro (payments, domain, themes).

Let a business run its store on its own domain, e.g. shop.mybrand.com.

- Store settings → "Connect domain": enter the domain, then add a CNAME to stores.fintranzact.com and a TXT record for verification
- Automatic HTTPS certificates via the Vercel Domains API or Cloudflare custom hostnames
- Status shown to the owner: Pending → Verifying → Live, or Error with the reason
- Old address store.fintranzact.com/<slug> redirects to the custom domain
- Requests are matched to the right store by hostname`,
    [
      "Connect domain screen with DNS instructions",
      "CNAME and TXT verification checks",
      "HTTPS via Vercel Domains API or Cloudflare custom hostnames",
      "Status: Pending / Verifying / Live / Error",
      "Resolve store by hostname",
      "Redirect store.fintranzact.com/<slug> to the custom domain",
      "Remove / change domain",
    ],
  ),
  feature(
    "after_launch",
    "high",
    "Online store",
    "Store themes",
    `**Build order: 4** — part of Store Pro (payments, domain, themes).

Ready-made looks so a store feels right for its trade.

- 5–8 themes: Grocery, Fashion, Pharmacy, Electronics, Restaurant and more
- Theme colours, fonts, logo and banner images
- Live preview before publishing; mobile-first layouts`,
    [
      "Theme framework and settings",
      "Grocery theme",
      "Fashion theme",
      "Pharmacy theme",
      "Electronics theme",
      "Restaurant theme",
      "Colours, fonts, logo and banners",
      "Live preview and publish",
    ],
  ),
  feature(
    "after_launch",
    "medium",
    "Online store",
    "Store page builder",
    `Let owners arrange their store's pages without code.

- Drag-and-drop sections: banner, categories, featured items, offers, reviews, about, contact, map, WhatsApp button
- Custom pages (e.g. "Bulk orders", "Our story") added to the menu
- Works with every theme; mobile preview`,
    [
      "Section library (banner, categories, featured, offers, reviews, about, contact, map, WhatsApp)",
      "Drag-and-drop ordering",
      "Custom pages and menu",
      "Mobile preview",
      "Draft and publish",
    ],
  ),
  feature(
    "after_launch",
    "medium",
    "Online store",
    "Embed widget and public Store API",
    `"Bring your own website": sell from WordPress, Wix or a custom site using the Fintranzact catalogue and orders.

- Copy-paste snippet for a product grid or a Buy button
- Public catalogue and order APIs, using the existing API keys
- Order webhooks to the business's own systems`,
    [
      "Product grid embed snippet",
      "Buy button snippet",
      "Public catalogue API",
      "Public order API",
      "Order webhooks",
      "Docs on /developers",
    ],
  ),
  feature(
    "after_launch",
    "medium",
    "Online store",
    "Product SEO",
    `Help store products get found on Google and look good when shared.

- A page for each product with its own URL, title and description
- Store sitemap
- Share previews (Open Graph) for WhatsApp and social media
- Google Merchant Center / Shopping product feed`,
    [
      "Product pages with SEO title and description",
      "Store sitemap.xml",
      "Open Graph share previews",
      "Google Merchant / Shopping feed",
    ],
  ),
  feature(
    "after_launch",
    "medium",
    "Online store",
    "Delivery charges and shipping integrations",
    `Charge the right delivery fee and ship through couriers.

- Delivery charges by pincode and by weight
- Free-delivery threshold
- Serviceable pincodes
- Shiprocket and Delhivery integration: create shipments, labels and tracking from orders`,
    [
      "Delivery charges by pincode",
      "Delivery charges by weight",
      "Free-delivery threshold",
      "Serviceable pincode list",
      "Shiprocket integration",
      "Delhivery integration",
      "Tracking link for shoppers",
    ],
  ),
  {
    title: "Store Pro add-on billing",
    category: "Online store",
    status: "planned",
    priority: "high",
    launchStage: "after_launch",
    phase: null,
    billing: "paid_add_on",
    priceNote: "₹499/month or ₹4,999/year (ex-GST)",
    description: `**Build order: 4** — Store Pro (payments, domain, themes), after 1 Plans, trial & billing, 2 AI Assistant Phase 1 and 3 Payroll Phase 1.

The basic online store is included in the Growth and Business plans. Store Pro is a paid add-on for businesses that want more.

### Pricing (ex-18% GST, editable in admin)
- ₹499 per month, or ₹4,999 per year
- Included in the Full Access Trial (with domain connect)

### Store Pro includes
- Own custom domain
- Store themes and the page builder
- Online payments at checkout
- Product SEO
- Remove "Powered by Fintranzact"
- Optional: embed widget and public Store API on a higher tier

### Billing and control
- Enable / disable per organisation from the admin console; extend or grant it
- Billed monthly or yearly through Razorpay subscriptions, with the plan
- Pro features switch off cleanly when the add-on ends (store stays live on the basic look)`,
    checklist: [
      "Store Pro price editable in admin (₹499/month, ₹4,999/year)",
      "Add-on on/off per organisation in admin",
      "Included in the Full Access Trial",
      "Razorpay subscription billing monthly/yearly",
      "Gate Pro features (domain, themes, builder, payments, SEO, branding)",
      "Optional higher tier with widget/API",
      "Graceful fallback when the add-on ends",
    ],
  },
];

// ── AI ────────────────────────────────────────────────────────────────

const AI: RoadmapSeedItem[] = [
  {
    title: "AI business assistant — Phase 1: ask questions about your business",
    category: "AI",
    status: "planned",
    priority: "high",
    launchStage: "after_launch",
    phase: 1,
    billing: "paid_add_on",
    priceNote: "AI Assistant ₹399/month (150 questions); AI Plus ₹999/month (500); extra ₹199 per 100 (ex-GST)",
    description: `**Build order: 2** — first after 1 Plans, trial & billing.

"Ask Fintranzact AI": a chat panel that answers questions about the business from its live data.

### Pricing (per organisation, ex-18% GST, editable in admin)
- AI Assistant: ₹399/month including 150 questions
- AI Plus: ₹999/month including 500 questions
- Extra pack: ₹199 per 100 questions
- Full Access Trial: up to 50 questions

### Where and how
- Opens from the dashboard and the header: a right-hand panel on desktop, full screen on phones
- Questions in English, Hindi or Hinglish ("is mahine ki sales kitni hui?")
- Answers from live data: sales, dues, stock, expiring batches, GST payable, top customers, cash and bank, month-on-month comparisons
- Replies as text plus cards: small tables, mini charts, and links to the invoice, party or report
- Suggested questions to start with; answers stream in as they are written
- Conversation history per user

### How it works
- Claude via the Anthropic API, using the existing MCP tools as tool-use
- A cheaper model for simple questions, a stronger one for multi-step analysis
- Runs with the signed-in user's permissions and business only — never another business's data
- Actions are recorded in the audit log as "via AI assistant"
- The Anthropic API key is a server setting provided by the owner — never in code

### Control, limits and cost
- Owner can switch the assistant off for the organisation or for specific roles
- Question quotas per add-on tier; clear message and "buy more" when the quota runs out
- Admin console shows usage and cost per organisation
- Privacy policy note: business data is not used to train models`,
    checklist: [
      "Chat panel: right panel on desktop, full screen on phones",
      "Entry points on dashboard and header",
      "Anthropic API client with key from server settings (not in code)",
      "Expose existing MCP tools as tool-use",
      "Model routing: cheaper model for simple, stronger for multi-step",
      "Enforce the signed-in user's permissions and business scope",
      "English / Hindi / Hinglish questions",
      "Answer cards: tables, mini charts, links",
      "Streaming answers",
      "Suggested questions",
      "Conversation history per user",
      "Audit log entries “via AI assistant”",
      "Owner switch per organisation and per role",
      "Question quotas: AI Assistant 150, AI Plus 500, ₹199 packs of 100, trial 50",
      "Admin: usage and cost per organisation",
      "Privacy policy: data not used for training",
    ],
  },
  {
    title: "AI business assistant — Phase 2: actions with confirmation",
    category: "AI",
    status: "planned",
    priority: "medium",
    launchStage: "after_launch",
    phase: 2,
    billing: "paid_add_on",
    priceNote: "Part of the AI Assistant / AI Plus add-on",
    description: `Let the assistant prepare work, with the user always in control.

- Create an invoice, quotation or payment; add a party or item; send a payment reminder
- Every action is shown as a confirmation card with the details — nothing is saved until the user taps Confirm
- Page-aware: on an invoice, "send this invoice to the customer" knows which invoice
- Same permission checks as the normal screens; audit log "via AI assistant"`,
    checklist: [
      "Confirmation card component (review, edit, confirm, cancel)",
      "Create invoice / quotation from chat",
      "Record payment from chat",
      "Add party / item from chat",
      "Send reminder from chat",
      "Page context (current invoice, party, report)",
      "Permission checks and audit log for actions",
    ],
  },
  {
    title: "AI business assistant — Phase 3: voice, languages and proactive tips",
    category: "AI",
    status: "planned",
    priority: "medium",
    launchStage: "after_launch",
    phase: 3,
    billing: "paid_add_on",
    priceNote: "Part of the AI Assistant / AI Plus add-on",
    description: `Make the assistant easier for everyone and more useful without being asked.

- Voice input (speak the question) on web and mobile
- Replies in Hindi and Gujarati
- Proactive tips on the dashboard, e.g. "3 invoices went overdue today", "Stock of 5 items is below reorder level"
- Answers "how do I…" questions from the help centre, with links to the article`,
    checklist: [
      "Voice input on web and mobile",
      "Hindi replies",
      "Gujarati replies",
      "Proactive dashboard tips (overdue, low stock, expiring batches, GST due)",
      "Help-centre answers with article links",
      "Switch off tips per user",
    ],
  },
];


// ── Plans, trial and billing (build order 1) ──────────────────────────
// Owner decision: no free plan. Every new organisation gets a Full Access
// Trial and then chooses a paid plan.

const BUILD_ORDER_1 = "**Build order: 1** — Plans, trial & billing (P1–P5), before everything else.";

const PLANS_TRIAL_BILLING: RoadmapSeedItem[] = [
  feature(
    "before_launch",
    "high",
    "Platform",
    "P1. Plans & pricing: paid plans only",
    `${BUILD_ORDER_1}

No free plan. Three paid plans; prices are ex-18% GST, yearly = 2 months free, and every price, limit and feature is editable in the admin console (Plans).

### Starter — ₹299/month (₹2,999/year)
- 1 business, 3 users
- Invoices, quotations, payments, parties, items
- GST reports, e-way bills
- Basic inventory, recurring invoices, POS
- No PDF branding

### Growth — ₹699/month (₹6,999/year) — highlighted
- 3 businesses, 10 users
- Everything in Starter, plus e-invoicing, multi-warehouse, batches & expiry, bank reconciliation, basic online store, API access, data export

### Business — ₹1,499/month (₹14,999/year)
- Unlimited businesses and users
- Everything in Growth, plus manufacturing / BOM, full audit history, priority support, onboarding help
- Approvals are left out for now (owner decision, 3 Oct 2026): no approval workflow exists yet. They return with the "Approval workflows" item

### Changes
- Remove the free plan from the pricing page and the sign-up plan picker
- Migrate the current plan ids and limits (forever_free / free / pro / business / enterprise) to Starter / Growth / Business, including stored plan_settings and tenants.plan
- Add yearly prices to plan settings

### Owner decision (1 Oct 2026)
- Existing Forever Free organisations are grandfathered: they keep unlimited access. Only new sign-ups get the trial → paid flow`,
    [
      "Grandfather existing Forever Free organisations (decided: keep unlimited)",
      "New plan ids: starter, growth, business (enum + migration)",
      "Migrate tenants and plan_settings from forever_free/free/pro/business/enterprise",
      "Starter limits and features (1 business, 3 users, no PDF branding)",
      "Growth limits and features (3 businesses, 10 users, e-invoicing, warehouses, batches, bank rec, store, API, export)",
      "Business limits and features (unlimited, manufacturing, audit history, priority support)",
      "Monthly and yearly prices (2 months free) in plan settings",
      "All prices/limits editable in admin Plans",
      "Remove free plan from pricing page and sign-up plan picker",
      "Mark Growth as highlighted",
      "Update plan-limit tests and docs",
    ],
  ),
  feature(
    "before_launch",
    "high",
    "Platform",
    "P2. Full Access Trial",
    `${BUILD_ORDER_1}

Every new organisation starts on a Full Access Trial instead of a free plan.

### Trial
- 14 days (decided; length editable in admin)
- Unlocks the Business plan and all add-ons, with caps: AI 50 questions, Payroll up to 10 employees, Store Pro including domain connect
- No card needed to start
- Countdown banner in the app ("9 days left — choose a plan")
- Reminders on day 7, 12 and 14 by email and in-app (WhatsApp later)

### At expiry — no free fallback
- The account becomes **read-only** until a plan is purchased: view, search, download/export PDFs and data; no new documents or edits
- Data is never deleted
- Buying any plan unlocks it immediately

### Rules and admin
- One trial per business: checked by phone, email and GSTIN
- Admin can extend a trial or grant a custom trial
- Partner referrals get a 30-day trial (decided)`,
    [
      "Trial length 14 days (decided), editable in admin",
      "30-day trial for partner referral sign-ups (decided)",
      "Trial fields on organisations (start, end, source)",
      "Start trial on sign-up; trial length setting in admin",
      "Trial unlocks Business plan + add-ons with caps (AI 50, Payroll 10 employees, Store Pro)",
      "Countdown banner",
      "Reminders day 7 / 12 / 14 (email + in-app)",
      "Read-only mode at expiry (view, search, download, export only)",
      "One trial per business: phone / email / GSTIN check",
      "Admin: extend trial or grant custom trial",
      "Partner referral trial length",
    ],
  ),
  feature(
    "before_launch",
    "high",
    "Platform",
    "P3. Checkout & subscription billing",
    `${BUILD_ORDER_1}

Let organisations buy and manage their plan and add-ons themselves.

### Payments
- Razorpay subscriptions for the plan and each add-on (AI Assistant, Payroll, Store Pro), monthly or yearly
- Auto-renew; upgrade / downgrade with proration
- Failed-payment retries and a grace period, then read-only mode
- Cancel at the end of the period
- GST invoice for every payment from Finvera Solutions LLP (GSTIN when available), with the customer's GSTIN

### Billing page (for owners)
- Current plan and renewal date, add-ons, change plan, cancel
- Usage: AI questions, employee count (Payroll), invoices this month
- Invoices and payment history to download

### Admin
- All subscriptions with status, next renewal and failed payments
- MRR and plan / add-on mix`,
    [
      "Razorpay plans for each plan and add-on (monthly/yearly)",
      "Checkout from the plan picker and Billing page",
      "Subscription webhooks (activated, charged, failed, cancelled)",
      "Upgrade/downgrade with proration",
      "Failed-payment retries and grace period",
      "Cancel at period end",
      "GST invoices from Finvera Solutions LLP",
      "Billing page: plan, add-ons, usage, invoices, cancel",
      "Admin: subscriptions list and MRR",
    ],
  ),
  feature(
    "before_launch",
    "high",
    "Security",
    "P4. Plan & add-on access enforcement",
    `${BUILD_ORDER_1}

Plans, add-ons and trial status are enforced on the server, not only hidden in the UI.

- Every screen and API (web, mobile, CLI, MCP) checks plan limits, add-on status and trial status
- One shared entitlement check (plan + add-ons + trial + read-only) used by all routers
- Read-only mode after trial end or failed payment: reads, search, PDF downloads and exports allowed; creating or editing refused with a clear "Choose a plan" message
- Clear upgrade prompts in the apps when a limit or add-on blocks something`,
    [
      "Shared entitlement check (plan, add-ons, trial, read-only)",
      "Enforce in every tRPC router and REST endpoint",
      "Read-only middleware for writes after trial/expiry",
      "Mobile app: limits, add-ons and read-only handling",
      "CLI/MCP: same checks and clear errors",
      "Upgrade prompts in web and mobile",
      "Tests for each plan, add-on and read-only case",
    ],
  ),
  feature(
    "before_launch",
    "high",
    "Website",
    "P5. Pricing page update",
    `${BUILD_ORDER_1}

Update the public pricing page for the paid-only plans.

- Starter, Growth (highlighted) and Business with monthly/yearly toggle (2 months free)
- Add-ons: AI Assistant / AI Plus, Payroll, Store Pro with their prices
- "Start your 14-day Full Access Trial — no card needed" call to action
- FAQ: what happens after the trial (read-only, data kept), GST, cancellation, add-ons
- Note that prices are exclusive of 18% GST`,
    [
      "Plan cards from the admin plan catalogue",
      "Monthly/yearly toggle",
      "Add-ons section with prices",
      "Trial call to action",
      "FAQ (trial end, GST, cancel, add-ons)",
      "GST note",
      "Remove free-plan wording across the site and help centre",
    ],
  ),
];

// ── Added after the first seed ────────────────────────────────────────
// Boards seeded before a batch existed get it once (see lib/roadmap.ts);
// a new board gets these with the rest of the seed. Never rename a key.

const SANDBOX_NOTE = `### Provider: Sandbox.co.in (owner's choice)
- API platform by Quicko (Ahmedabad, Rainmatter-funded); connects to NIC and GSTN through licensed GSP partners, with primary / secondary / tertiary routes for fallback
- One subscription covers all 200+ APIs (GST, e-invoice, e-way bill, TDS, income tax, KYC); plans differ only in calls per month
- Plans (verify before signing): Startup ₹999/month for 1,000 calls; Growth ₹9,999 for 30,000; Unicorn ₹16,999 for 1,00,000; Enterprise on request
- Only successful (2xx) calls count; unused calls expire monthly; some APIs also charge per call from a prepaid wallet (wallet money never expires)
- Free test environment (test-api.sandbox.co.in, key_test_ keys, 25 calls/min); production 500 calls/min, more on request
- Start on test, Startup plan at launch, Growth as customers grow; revisit Adaequare (~₹0.25 per IRN) only at high e-invoice volume
- Keep the provider behind one adapter in our code so it can be switched

### Ask Sandbox before signing
1. Which APIs carry wallet charges, and how much per call
2. What happens past the monthly quota — billed per call, or blocked (a blocked e-invoice stops a customer's billing)
3. Is GST extra on plan prices
4. Is TCS (27EQ) return filing supported
5. Is there an ASP / partner plan for software serving many GSTINs`;

const GOVERNMENT_FILING: RoadmapSeedItem[] = [
  {
    title: "Connect e-invoice, e-way bill and GST returns through Sandbox.co.in",
    category: "GST",
    status: "planned",
    launchStage: "before_launch",
    priority: "high",
    phase: null,
    billing: "included",
    priceNote: "Customers pay ~₹2–3 per e-invoice / e-way bill, billed monthly after use (no advance). Our cost: Sandbox ₹999–₹16,999/month by volume (~₹0.35–₹2 per e-invoice); NIC and GSTN charge nothing",
    description: `Send e-invoices, e-way bills and GST returns to the government through Sandbox.co.in instead of calling NIC and GSTN directly.

### Why not direct
- **E-invoice (NIC IRP):** direct API access is for a taxpayer filing its **own** GSTIN (large-turnover taxpayers), GSPs and e-commerce operators. Fintranzact files for many businesses, so one direct login can't serve them. Becoming a GSP ourselves needs GSTN empanelment (~₹5 lakh plus yearly cost) — not worth it now.
- **E-way bill (NIC EWB):** same model — direct for the taxpayer's own GSTIN, otherwise through a GSP.
- **GST returns (GSTN):** the GST common portal's APIs are open only to GSPs.
- Sandbox handles NIC's RSA/AES encryption, so the NIC public key in irp-client.ts is no longer needed.

${SANDBOX_NOTE}

### How it works
1. Fintranzact signs in to Sandbox with our API key and secret (stored in env, never in code) → token valid 24 hours
2. Customer, one time: on the e-invoice portal create an API user and password; enter them in Fintranzact (stored encrypted, per GSTIN). The same login works for e-way bills
3. E-invoice: session per GSTIN → generate IRN → IRN, ack and signed QR back; cancel within the allowed window
4. E-way bill: generate from the IRN or standalone (challans, stock transfers), update vehicle, cancel
5. GST returns: taxpayer session with OTP from the GST portal → GSTR-1 sections saved → filed with EVC OTP; GSTR-3B prepared and filed; GSTR-2B pulled for ITC matching
6. GSTIN verification when a party is added

### Charging customers per document, no advance (owner's decision)
- Customers pay **per e-invoice / e-way bill they generate**, billed after the month ends with their plan — no prepaid credits, no advance
- Fintranzact pays Sandbox's monthly plan and keeps a small wallet balance, topped up automatically
- Usage page for the customer: documents this month, rate, amount so far
- Only successful generation is charged; failed calls are not`,
    checklist: [
      "Send Sandbox the 5 questions and get a written quote",
      "Sandbox test account; key_test_ keys in env (never in code)",
      "Provider adapter so Sandbox can be swapped later",
      "Replace direct NIC calls in irp-client.ts with Sandbox e-invoice APIs",
      "E-invoice: generate IRN, fetch, cancel through Sandbox",
      "E-way bill: generate (from IRN and standalone), update vehicle, cancel",
      "Per-GSTIN e-invoice API username and password, stored encrypted",
      "Customer setup guide: create API user on the e-invoice portal",
      "GSTR-1 save and file with EVC OTP",
      "GSTR-3B prepare and file",
      "GSTR-2B pull for ITC matching",
      "GSTIN verification on party create",
      "Quota and wallet balance alerts for our Sandbox account",
      "Per-document usage metering (successful calls only)",
      "Per-document charge on the customer's monthly bill (no advance)",
      "Customer usage page: count, rate, amount this month",
      "Test environment run, then Startup plan and production go-live",
    ],
  },
  feature(
    "after_launch",
    "high",
    "Accounting",
    "TDS & TCS return filing and certificates through Sandbox.co.in",
    `File the quarterly income-tax TDS/TCS returns from the data in "TDS & TCS on transactions", using Sandbox's TDS APIs — same Sandbox subscription as e-invoice and GST.

### Through Sandbox
- Prepare the return (24Q salary, 26Q non-salary, 27Q non-residents; 27EQ TCS to confirm with Sandbox) from our TDS/TCS data
- Download the CSI file, generate the Protean FVU file and Form 27A (job-based: submit, then poll)
- **E-file the return** through Sandbox's e-file API — no manual upload by the CA
- Form 16 / 16A (and 27D) certificates
- PAN and TAN verification before deducting, so the higher no-PAN rate is applied correctly
- Fallback if an API isn't available: produce the file and a step-by-step upload guide for the e-filing portal (TAN login, DSC/EVC)

### Law changes to check with the CA before building
- The Income-tax Act, 2025 replaces the 1961 Act from 1 April 2026 — section numbers and form names may change
- TCS on sale of goods (old s.206C(1H)) was removed from 1 April 2025; TDS on purchase of goods (old s.194Q) stays
- GST TDS/TCS (GSTR-7, GSTR-8) is separate from income-tax TDS/TCS — see "GST TDS & TCS credits"`,
    [
      "Prepare 24Q, 26Q and 27Q through Sandbox TDS APIs",
      "Confirm 27EQ (TCS) support with Sandbox",
      "CSI download and FVU + Form 27A generation (submit and poll job)",
      "E-file the return through Sandbox",
      "Form 16 / 16A / 27D certificates",
      "PAN and TAN verification before deduction",
      "Correction returns for earlier quarters",
      "Track filing status, token number and late-filing fee",
      "Fallback: return file and upload guide when an API is unavailable",
      "Check section numbers and forms under the Income-tax Act, 2025 with the CA",
    ],
  ),
  feature(
    "after_launch",
    "medium",
    "GST",
    "GST TDS & TCS credits (GSTR-2X)",
    `Account for GST deducted or collected by others when the business sells to them.

- **GST TDS:** government departments and notified bodies deduct 2% GST TDS (1% CGST + 1% SGST, or 2% IGST) on payments above the limit
- **GST TCS:** e-commerce operators (Amazon, Flipkart, etc.) collect GST TCS on the seller's net sales through them
- Both show in the seller's GSTR-2X; accepting them adds the amount to the electronic cash ledger
- Record the deduction on the receipt so the invoice is fully settled, and match it with GSTR-2X pulled through Sandbox.co.in (confirm the API with Sandbox)
- Rates and limits to verify with the CA before building`,
    [
      "Record GST TDS deducted by a customer on receipts",
      "Record GST TCS from marketplace settlements",
      "GST TDS / TCS receivable ledgers",
      "Pull GSTR-2X through Sandbox and match",
      "Report of credits to accept or reject",
    ],
  ),
];

const BANK_FEEDS: RoadmapSeedItem[] = [
  feature(
    "before_launch",
    "high",
    "Banking",
    "Bank statement import: Excel, OFX/QIF and PDF",
    `Bank reconciliation accepts CSV only today. Accept whatever net banking gives the customer, so reconciliation works with every bank from day one.

- Excel (.xlsx), OFX/QFX and QIF converted in the browser to the same rows as CSV, then the usual bank detection and column mapping
- PDF statements: text read page by page into rows; password-protected PDFs (DOB / customer ID) ask for the password; scanned image-only PDFs get a clear "download Excel or CSV instead" message
- Title and account-info rows above the real header are skipped automatically
- Same 10 MB limit; the customer still confirms the column mapping before import`,
    [
      "Excel (.xlsx) import",
      "OFX / QFX import",
      "QIF import",
      "PDF import with password support",
      "Skip title rows above the header",
      "Clear message for scanned PDFs",
      "Help pages list the formats",
      "Tests for each format",
    ],
  ),
  feature(
    "after_launch",
    "high",
    "Banking",
    "ICICI Connected Banking: daily statement feed and auto-reconciliation",
    `Fetch the customer's ICICI current-account statement and balance automatically, the way Zoho Books and Tally do — no file upload.

- ICICI Connected Banking is free for the business; Fintranzact must be listed as a partner in ICICI's connected-banking library (partnership agreement)
- Customer links the account once from Fintranzact (approved in ICICI's corporate net banking)
- Statement lines pulled daily (and on demand), then the existing auto-match and categorisation rules run
- Live balance on the bank account screen and dashboard
- Later on the same rails: vendor payments from Fintranzact, approved in ICICI

### Why not Account Aggregator
- RBI's Account Aggregator data can only be received by entities regulated by RBI, SEBI, IRDAI or PFRDA; software companies can't, without a licence or a regulated partner — see "Account Aggregator bank data"`,
    [
      "Apply for ICICI connected-banking partnership",
      "Sign agreement and get UAT access",
      "Link account flow (customer approves in ICICI net banking)",
      "Daily statement pull and manual refresh",
      "Run auto-match and rules on fetched lines",
      "Live balance on bank account and dashboard",
      "Disconnect / re-link and error states",
      "Go-live checklist with ICICI",
    ],
  ),
  feature(
    "after_launch",
    "medium",
    "Banking",
    "Direct bank feeds: Axis, Kotak, SBI, HDFC and Yes Bank",
    `Repeat the ICICI connected-banking pattern with the next banks, one partnership each — there is no single API for all Indian banks.

- Order by customer demand (count of linked bank accounts per bank)
- Axis first (Zoho Books already runs the same tie-up: feeds, balance, vendor payments), then Kotak, SBI, HDFC, Yes Bank
- One bank-feed adapter in our code so each bank plugs into the same import and matching flow
- Banks without a tie-up keep using statement import`,
    [
      "Rank banks by customer accounts",
      "Bank-feed adapter shared by all banks",
      "Axis Bank partnership and integration",
      "Kotak Bank partnership and integration",
      "SBI partnership and integration",
      "HDFC / Yes Bank partnership and integration",
    ],
  ),
  feature(
    "after_launch",
    "medium",
    "Banking",
    "Bank account verification (penny drop) and IFSC lookup through Sandbox.co.in",
    `Check that a vendor's or employee's bank account is real and in the right name before paying them — part of the same Sandbox.co.in subscription.

- Verify account number + IFSC; show the name the bank returns next to the name we have, with a match / mismatch flag
- IFSC lookup fills bank name and branch when an IFSC is typed
- Used on parties (vendors), employees (payroll) and our own bank accounts
- Each verification is one Sandbox call (may carry a wallet charge — confirm)`,
    [
      "IFSC lookup fills bank and branch",
      "Verify vendor bank accounts",
      "Verify employee bank accounts for payroll",
      "Name match / mismatch flag",
      "Store verification date and result",
    ],
  ),
  feature(
    "after_launch",
    "medium",
    "Banking",
    "Vendor and salary payouts through RazorpayX",
    `Pay vendors and salaries from inside Fintranzact.

- RazorpayX current account (partner banks ICICI, Axis, RBL, Yes) — free account, no minimum balance
- Payouts by IMPS / NEFT / RTGS / UPI at about ₹2–5 each, charged by RazorpayX (verify current rates)
- Pay a purchase bill or a payroll run; the payment is recorded and reconciled automatically
- Maker-checker approval for payouts; only to verified bank accounts`,
    [
      "Connect RazorpayX account",
      "Pay a purchase bill",
      "Bulk salary payout from a payroll run",
      "Maker-checker approval",
      "Record and reconcile payouts automatically",
      "Payout status and failure handling",
    ],
  ),
  feature(
    "after_launch",
    "low",
    "Banking",
    "Account Aggregator bank data (only with a regulated partner)",
    `RBI's Account Aggregator (Setu, Finvu, OneMoney, FinBox) shares bank data with the customer's consent — but only to Financial Information Users regulated by RBI, SEBI, IRDAI or PFRDA.

- Fintranzact is not regulated, so it can't receive AA data directly
- Possible only by partnering with a regulated entity (for example an NBFC) that acts as the FIU, with Fintranzact as its technology provider
- AA is built for consent-based pulls (lending, wealth), not daily accounting feeds — direct bank feeds fit better
- Revisit if lending or credit features are added`,
    [
      "Keep direct bank feeds as the main route",
      "Revisit if a lending partner (NBFC) is signed",
      "If pursued: FIU partner, AA provider, consent flow",
      "Legal review of data use",
    ],
  ),
];

// ── Invoice follow-ups (Oct 2026) ────────────────────────────────────

const INVOICE_FOLLOW_UPS: RoadmapSeedItem[] = [
  feature(
    "after_launch",
    "medium",
    "GST",
    "Compensation cess on items and invoices",
    `Items such as tobacco, aerated drinks and some vehicles carry GST compensation cess on top of GST. Invoices have no cess field today, so no invoice design prints a cess line.

- Cess rate on the item: percentage, amount per unit, or both
- Cess worked out on each invoice, purchase and note line, shown in the totals and the tax summary of every invoice design
- Cess in GSTR-1 (B2B, B2CL, B2CS, HSN summary), GSTR-3B and e-invoice / e-way bill payloads
- Cess input credit on purchases
- Rates and the items they apply to change often — verify with CA before building`,
    [
      "Cess rate fields on items (ad valorem and per unit)",
      "Cess on sales, purchase and note lines",
      "Cess line in totals and tax summary of every invoice design",
      "Cess in GSTR-1, GSTR-3B and HSN summary",
      "Cess in e-invoice and e-way bill payloads",
      "Cess input credit on purchases",
      "CA verification of rates",
    ],
  ),
  feature(
    "after_launch",
    "low",
    "Sales",
    "Order and dispatch details on invoices",
    `Tally-style invoices have boxes for the buyer's order and dispatch details. The "Tally" invoice design prints these boxes, but they stay empty because invoices don't store the details yet.

- Buyer's order number and date
- Delivery note number and date, dispatch document number
- Dispatched through, destination, terms of delivery
- Fill from the sales order or delivery challan the invoice was made from
- Printed in the Tally design and shown in the invoice details`,
    [
      "Fields on invoices: buyer's order no./date, delivery note no./date",
      "Fields on invoices: dispatch doc no., dispatched through, destination, terms of delivery",
      "Copy from sales order / delivery challan when converting",
      "Print in the Tally design and other designs that have room",
      "Show and edit in the invoice form and details",
    ],
  ),
  feature(
    "before_launch",
    "medium",
    "GST",
    "HSN / SAC verification through Sandbox.co.in",
    `Item HSN / SAC codes are checked today against the official CBIC list bundled with the app (12,604 HSN and 496 SAC codes). Once the Sandbox.co.in connection is live, check codes against Sandbox too, so new or withdrawn codes are caught without an app update.

- Look up the code on Sandbox when an item is saved, falling back to the bundled list if Sandbox is down
- Show Sandbox's description in the HSN details card
- Refresh the bundled list from Sandbox periodically
- Sandbox keys only in environment settings, never in code`,
    [
      "HSN lookup through the Sandbox provider adapter",
      "Fall back to the bundled CBIC list when Sandbox is unavailable",
      "Sandbox description in the HSN details card",
      "Periodic refresh of the bundled list",
      "Tests with a mocked Sandbox response",
    ],
  ),
];

/** Batches added after the first seed, each put on an older board once. */
export const ROADMAP_ADDITIONS: { key: string; items: RoadmapSeedItem[] }[] = [
  { key: "2026-10-government-filing", items: GOVERNMENT_FILING },
  { key: "2026-10-bank-feeds", items: BANK_FEEDS },
  { key: "2026-10-invoice-follow-ups", items: INVOICE_FOLLOW_UPS },
];

/** Progress on a board item: its new status and the checklist lines now done. */
export interface RoadmapProgress {
  title: string;
  status: RoadmapStatus;
  done: string[];
  /** Checklist lines whose wording changed: old text -> new text (applied before the ticks, so a renamed line can be ticked). */
  rename?: Record<string, string>;
  /** Wording fixes in the item's description: [old text, new text] pairs, replaced once each. */
  describe?: [string, string][];
}

/**
 * Progress made after the roadmap was written, applied once per board (each
 * batch by its key). A status moves only while the item is still "idea" or
 * "planned", so an admin's own change is never overwritten; checklist lines
 * are ticked by their exact text.
 */
export const ROADMAP_PROGRESS: { key: string; updates: RoadmapProgress[] }[] = [
  {
    key: "2026-10-01",
    updates: [
      {
        // Released in #42.
        title: "Bank statement import: Excel, OFX/QIF and PDF",
        status: "done",
        done: BANK_FEEDS[0]!.checklist,
      },
      {
        // The sign-up plan page opens a demo checkout (#49); real Razorpay
        // subscriptions are still to come.
        title: "P3. Checkout & subscription billing",
        status: "in_progress",
        done: [],
      },
      {
        // Export invoices print the LUT / IGST-paid endorsement (#50).
        title: "Multi-currency and export invoices",
        status: "in_progress",
        done: ["Export invoice under LUT/bond", "Export with IGST paid"],
      },
      {
        // The CMP-08 screen exists; the composition rate is still a fixed 1%.
        title: "GSTR-4 annual return for composition dealers",
        status: "in_progress",
        done: ["CMP-08 quarterly statement data"],
      },
      {
        // Invoice PDFs carry a UPI QR for the balance due.
        title: "Payment reminders, Razorpay payment links and UPI QR on invoices",
        status: "in_progress",
        done: ["UPI QR with amount on invoice PDF"],
      },
      {
        // The store footer has privacy and refund policies filled from the business.
        title: "Store policy pages",
        status: "in_progress",
        done: ["Pre-fill from business details"],
      },
    ],
  },
  {
    key: "2026-10-02",
    updates: [
      {
        // Subscription billing built end-to-end: billing_subscriptions /
        // billing_payments / billing_events in the control DB, a Razorpay
        // gateway adapter (demo mode until keys are set), the /webhooks/razorpay
        // endpoint, proration on upgrades, lazy grace→read-only state, GST
        // invoice PDFs from Finvera, the owners' Settings → Billing page and
        // the admin Subscriptions view with MRR. Still in progress: verify the
        // flow against live Razorpay keys, and P4 enforcement of read-only.
        title: "P3. Checkout & subscription billing",
        status: "in_progress",
        done: [
          "Razorpay plans for each plan and add-on (monthly/yearly)",
          "Checkout from the plan picker and Billing page",
          "Subscription webhooks (activated, charged, failed, cancelled)",
          "Upgrade/downgrade with proration",
          "Failed-payment retries and grace period",
          "Cancel at period end",
          "GST invoices from Finvera Solutions LLP",
          "Billing page: plan, add-ons, usage, invoices, cancel",
          "Admin: subscriptions list and MRR",
        ],
      },
    ],
  },
  {
    key: "2026-10-02-tds",
    updates: [
      {
        // Period locks and year-end close (TDS/TCS merge). The closing profit
        // is carried in the frozen opening balances (Retained Earnings).
        title: "Year-end closing and period lock",
        status: "done",
        done: [
          "Lock-till date per business",
          "Block create/edit/delete of entries in locked periods (all channels)",
          "Audit lock for GST-filed months",
          "Owner-only unlock with audit log entry",
          "Year-end: carry forward ledger balances",
          "Year-end: carry forward stock and outstanding",
          "Profit transfer to capital / reserves on closing",
          "Clear blocked-edit messages in the UI",
        ],
      },
      {
        // TDS on bills and payments, TDS receivable, TCS on sales, challans and
        // 26Q/27EQ data. Expenses, reminders, 26AS/AIS and certificates were
        // ticked by the "2026-10-02-tds-2" batch below.
        title: "TDS & TCS on transactions",
        status: "in_progress",
        done: [
          "TDS section master with rates and thresholds per financial year",
          "Threshold tracking per party per year (single and aggregate)",
          "194Q purchase-of-goods threshold tracking",
          "No-PAN higher rate (s.206AA)",
          "TDS on supplier payments and advances",
          "TDS receivable when customers deduct (invoices and receipts)",
          "TCS on sales under s.206C by item/party",
          "TDS payable and TCS payable ledgers per section",
          "Form 26Q quarterly data export",
          "Form 27EQ quarterly data export",
          "TDS/TCS reports: deducted, paid, pending",
        ],
      },
      {
        // Sandbox.co.in client and provider switch (GOV_API_PROVIDER); e-way
        // bill from an IRN and GST returns are still to come.
        title: "Connect e-invoice, e-way bill and GST returns through Sandbox.co.in",
        status: "in_progress",
        done: [
          "Provider adapter so Sandbox can be swapped later",
          "Replace direct NIC calls in irp-client.ts with Sandbox e-invoice APIs",
          "E-invoice: generate IRN, fetch, cancel through Sandbox",
          "Per-GSTIN e-invoice API username and password, stored encrypted",
          "GSTIN verification on party create",
        ],
      },
      {
        // The Payroll add-on can be bought (Razorpay, Finvera GST invoice);
        // the admin switch, editable price and employee counting are not built.
        title: "Payroll add-on billing",
        status: "in_progress",
        done: ["Razorpay billing monthly/yearly with the plan", "GST invoice from Finvera Solutions LLP"],
      },
      {
        // The Store Pro add-on can be bought; nothing is gated by it yet.
        title: "Store Pro add-on billing",
        status: "in_progress",
        done: ["Razorpay subscription billing monthly/yearly"],
      },
    ],
  },
  {
    key: "2026-10-02-tds-2",
    updates: [
      {
        // Built after the first TDS batch. Certificates are generated from the
        // books (not issued by TRACES). Left unticked on purpose: CA
        // verification; Sandbox filing/certificates are a separate item.
        title: "TDS & TCS on transactions",
        status: "in_progress",
        done: [
          "TDS section on parties and expense ledgers",
          "TDS on purchase bills and expense entries",
          "TDS receivable reconciliation with 26AS / AIS",
          "Challan entry (BSR code, challan no., date) and due-date reminders",
          "Form 16A / 27D certificates",
          "TDS/TCS reports: deducted, paid, pending",
        ],
      },
    ],
  },
  {
    key: "2026-10-02-gstr4",
    updates: [
      {
        // Built: composition category and editable rate per year, CMP-08 data,
        // GSTR-4 tables (outward, inward incl. RCM, tax paid against CMP-08), a
        // GSTR-4 tab with CSV/print and a JSON download. Left unticked: CA
        // verification of tables and due dates. The JSON is best effort, its
        // table keys are not verified against the portal schema (docs/GSTR-4.md).
        title: "GSTR-4 annual return for composition dealers",
        status: "in_progress",
        done: [
          "Composition dealer setting and rate per business type",
          "CMP-08 quarterly statement data",
          "GSTR-4 outward supply table",
          "GSTR-4 inward supplies (registered, unregistered, RCM)",
          "Tax paid summary against CMP-08",
          "GSTR-4 JSON export for the GST portal",
        ],
      },
    ],
  },
  {
    key: "2026-10-02-sandbox",
    updates: [
      {
        // Built after the first Sandbox batch: e-way bill, setup guide, alerts
        // (log + billing-events only), usage metering, the per-document charge
        // on a monthly "payment due" statement (closed by a platform admin, no
        // automatic collection) and the customer usage page. Left unticked on
        // purpose: GSTR-1 / GSTR-3B / GSTR-2B (code exists, but the GST-returns
        // endpoint paths are from memory and GSTR-1/3B are only partly mapped,
        // so they are not verified against Sandbox), the quote, the test
        // account and keys, and the test run / go-live.
        title: "Connect e-invoice, e-way bill and GST returns through Sandbox.co.in",
        status: "in_progress",
        done: [
          "E-way bill: generate (from IRN and standalone), update vehicle, cancel",
          "Customer setup guide: create API user on the e-invoice portal",
          "Quota and wallet balance alerts for our Sandbox account",
          "Per-document usage metering (successful calls only)",
          "Per-document charge on the customer's monthly bill (no advance)",
          "Customer usage page: count, rate, amount this month",
        ],
      },
    ],
  },
  {
    key: "2026-10-02-entitlements",
    updates: [
      {
        // P4 enforcement built: shared deriveAccess + getEntitlements, a tRPC
        // gate that refuses writes in read-only mode by default (explicit
        // allowlist), an explicit policy for every REST route, plan limits and
        // add-on flags enforced on the server, schedulers skipping read-only
        // tenants, web banner and prompts, mobile handler and banner, and CLI/MCP
        // plan_required errors with a billing status command. Tests are written
        // (unit tests pass); the integration tests had not run against Postgres
        // when this was written, so the tests line is left unticked until CI has
        // run them. Kept in progress for that and for live checks after the trial
        // start flow.
        title: "P4. Plan & add-on access enforcement",
        status: "in_progress",
        done: [
          "Shared entitlement check (plan, add-ons, trial, read-only)",
          "Enforce in every tRPC router and REST endpoint",
          "Read-only middleware for writes after trial/expiry",
          "Mobile app: limits, add-ons and read-only handling",
          "CLI/MCP: same checks and clear errors",
          "Upgrade prompts in web and mobile",
          // "Tests for each plan, add-on and read-only case" stays unticked until CI has
          // run the integration tests (read-only-gate, plan-enforcement, rest-entitlement).
        ],
      },
    ],
  },
  {
    key: "2026-10-02-2fa",
    updates: [
      {
        // All eight lines are built in code with unit tests (faked data layer):
        // TOTP enrolment, sign-in step on web/mobile/desktop/CLI, backup codes,
        // per-organisation policy with grace period and request-time gate,
        // platform-admin reset after identity checks, 30-day trusted devices,
        // the security_events trail with user and admin views, and lockout.
        // Kept in progress, not done: the integration tests (real Postgres)
        // and the web, mobile and desktop screens had not been run on a
        // database or a device when this was written.
        title: "Two-factor authentication for owners and admins",
        status: "in_progress",
        done: [
          "TOTP setup with QR code and verification",
          "2FA step at sign-in (web, mobile, desktop)",
          "Backup codes: generate, download, use once, regenerate",
          "Enforce 2FA per organisation (all users or owners/admins)",
          "Platform admin 2FA reset",
          "Trusted device for 30 days",
          "Audit log entries for 2FA events",
          "Rate-limit and lock out repeated wrong codes",
        ],
      },
    ],
  },
  {
    key: "2026-10-02-ca-access",
    updates: [
      {
        // All six lines are built in code with unit tests (faked data layer):
        // owner-only "Invite my CA" with two access levels, the read-only
        // (auditor) and filing-only (ca_filing) roles with a mutation backstop,
        // the client switcher with pins, recents and leaving a client, removal
        // that revokes keys and grants plus the access log, and the partner link
        // (badge, "Clients you manage", opt-in referral credit, no automatic
        // commission). Kept in progress, not done: the integration tests (real
        // Postgres) and the web, mobile and CLI screens had not been run on a
        // database or a device when this was written.
        title: "Accountant (CA) access across clients",
        status: "in_progress",
        done: [
          "Invite my CA flow",
          "Read-only accountant role",
          "Filing-only accountant role (returns, reports, exports)",
          "Client switcher for accountants with many organisations",
          "Remove access and audit log",
          "Link with the partner programme (CA partners)",
        ],
      },
    ],
  },
  {
    key: "2026-10-03-hsn-sandbox",
    updates: [
      {
        // All five lines are built in code with unit tests (mocked Sandbox
        // response, faked data layer): the Sandbox lookup adapter, the
        // fallback to the bundled CBIC list, the details card (Sandbox
        // description, rate, dates, "Verified with Sandbox", amber warnings,
        // save-time warning toast / alert), and a daily refresh of the codes
        // items use into a control-DB table that the resolver reads as a
        // middle layer. Sandbox has no known bulk list, so "refresh the
        // bundled list" is done as a re-check of codes in use. Kept in
        // progress, not done: the Sandbox endpoint and response fields are
        // unverified (see docs/SANDBOX-INTEGRATION.md), and the integration
        // tests (real Postgres) and the web and mobile screens had not been run
        // on a database or a device when this was written.
        title: "HSN / SAC verification through Sandbox.co.in",
        status: "in_progress",
        done: [
          "HSN lookup through the Sandbox provider adapter",
          "Fall back to the bundled CBIC list when Sandbox is unavailable",
          "Sandbox description in the HSN details card",
          "Periodic refresh of the bundled list",
          "Tests with a mocked Sandbox response",
        ],
      },
    ],
  },
  {
    key: "2026-10-03-old-docs-redirect",
    updates: [
      {
        // Done on the owner's word: the old docs hosts already send visitors to
        // the app. The 301 rules are also in apps/web/vercel.json (host-based,
        // path kept), so a project that serves the app answers them itself.
        title: "Redirect old docs and API docs domains",
        status: "done",
        done: [
          "docs.fintranzact.com → /help (301)",
          "api-docs.fintranzact.com → /developers (301)",
          "Update DNS / Vercel project settings",
          "Check old links from search results land on the right page",
        ],
      },
    ],
  },
  {
    key: "2026-10-03-ticks-after-merge",
    updates: [
      {
        // The enforcement integration tests (28 Postgres tests for the plan matrix,
        // trial, grandfathered, read-only and downgrade cases) and the full suite
        // are green in CI on main, so the tests line is ticked.
        title: "P4. Plan & add-on access enforcement",
        status: "in_progress",
        done: ["Tests for each plan, add-on and read-only case"],
      },
      {
        // The GSTR-1 and GSTR-3B filing wizards (web and mobile) are built on the
        // official Sandbox recipes and tested against mocked Sandbox responses.
        // Left unticked: GSTR-2B pull (no recipe yet), the quote, the test account
        // and keys, and the test run / go-live, none of which have happened.
        title: "Connect e-invoice, e-way bill and GST returns through Sandbox.co.in",
        status: "in_progress",
        done: ["GSTR-1 save and file with EVC OTP", "GSTR-3B prepare and file"],
      },
    ],
  },
  {
    key: "2026-10-05-p1-approvals-wording",
    updates: [
      {
        // Approvals left the Business plan until an approval workflow exists. Boards
        // seeded earlier still carry the old wording, so rename that line (the P1
        // batch above ticks the new wording on boards that get it fresh) and tick it.
        title: "P1. Plans & pricing: paid plans only",
        status: "in_progress",
        rename: {
          "Business limits and features (unlimited, manufacturing, approvals, audit history, priority support)":
            "Business limits and features (unlimited, manufacturing, audit history, priority support)",
        },
        describe: [
          [
            "- Everything in Growth, plus manufacturing / BOM, approvals, full audit history, priority support, onboarding help",
            "- Everything in Growth, plus manufacturing / BOM, full audit history, priority support, onboarding help\n- Approvals are left out for now (owner decision, 3 Oct 2026): no approval workflow exists yet. They return with the \"Approval workflows\" item",
          ],
        ],
        done: ["Business limits and features (unlimited, manufacturing, audit history, priority support)"],
      },
    ],
  },
  {
    key: "2026-10-03-plans-p1-p5",
    updates: [
      {
        // Built with unit and integration tests (real Postgres): the three paid
        // plans, the migration of old ids with Forever Free organisations
        // grandfathered, monthly and yearly prices, the admin Plans editor, the
        // pricing page and sign-up picker without a free plan, and server and
        // client enforcement of every flag that has a feature behind it
        // (packages/shared/src/feature-gates.ts). Approvals were taken off the
        // Business plan copy (owner decision, 3 Oct 2026) until an approval
        // workflow exists, so the Business line is ticked. Kept in progress: not
        // run on a device or against live Razorpay.
        title: "P1. Plans & pricing: paid plans only",
        status: "in_progress",
        done: [
          "Grandfather existing Forever Free organisations (decided: keep unlimited)",
          "New plan ids: starter, growth, business (enum + migration)",
          "Migrate tenants and plan_settings from forever_free/free/pro/business/enterprise",
          "Starter limits and features (1 business, 3 users, no PDF branding)",
          "Growth limits and features (3 businesses, 10 users, e-invoicing, warehouses, batches, bank rec, store, API, export)",
          "Business limits and features (unlimited, manufacturing, audit history, priority support)",
          "Monthly and yearly prices (2 months free) in plan settings",
          "All prices/limits editable in admin Plans",
          "Remove free plan from pricing page and sign-up plan picker",
          "Mark Growth as highlighted",
          "Update plan-limit tests and docs",
        ],
      },
      {
        // The pricing page reads the admin plan catalogue; toggle, add-ons,
        // trial call to action, FAQ and GST note are all on /pricing. Not yet
        // looked at in a browser against the deployed site.
        title: "P5. Pricing page update",
        status: "in_progress",
        done: [
          "Plan cards from the admin plan catalogue",
          "Monthly/yearly toggle",
          "Add-ons section with prices",
          "Trial call to action",
          "FAQ (trial end, GST, cancel, add-ons)",
          "GST note",
          "Remove free-plan wording across the site and help centre",
        ],
      },
    ],
  },
  {
    key: "2026-10-03-p2-trial",
    updates: [
      {
        // Built with unit and integration tests (real Postgres): trial fields
        // and settings, start at sign-up (14 days, 30 for a partner code), the
        // Business-level access during the trial, the countdown banner (web and
        // mobile), the 7 / 2 / 0 days-left reminders (email; in-app through the
        // banner and the bell), read-only at the end with exports still open,
        // email and GSTIN claims, and the admin controls. Kept in progress, with
        // two lines left unticked on purpose: (1) the add-on caps (AI 50 questions,
        // Payroll 10 employees) are in the entitlements payload but nothing can
        // enforce them until the AI assistant and Payroll exist; (2) the phone
        // check is not wired because sign-up does not collect a phone number.
        // Not run on a device, in a browser against the real API, or with a live
        // mail provider when this was written.
        title: "P2. Full Access Trial",
        status: "in_progress",
        done: [
          "Trial length 14 days (decided), editable in admin",
          "30-day trial for partner referral sign-ups (decided)",
          "Trial fields on organisations (start, end, source)",
          "Start trial on sign-up; trial length setting in admin",
          "Countdown banner",
          "Reminders day 7 / 12 / 14 (email + in-app)",
          "Read-only mode at expiry (view, search, download, export only)",
          "Admin: extend trial or grant custom trial",
          "Partner referral trial length",
        ],
      },
    ],
  },
  {
    key: "2026-10-05-mobile-batch",
    updates: [
      {
        // Built with jest tests for the helpers and components. Purchase
        // invoice lines take the batch number, manufacturing and expiry dates;
        // sales invoice and delivery challan lines get a batch picker (earliest
        // expiry first, quantity left, near-expiry and expired badges, no more
        // than the batch holds, expired stock only when allowed); all of it
        // follows the batchesExpiry plan flag. Kept in progress with two lines
        // unticked on purpose: the mobile app has no GRN screen (a GRN is still
        // a web screen) and the batch-wise stock report keeps its parity
        // exception. Not run on a device or emulator when this was written.
        title: "Batch fields in the mobile app",
        status: "in_progress",
        done: [
          "Batch picker on mobile sales and challan lines (FEFO)",
          "Show available quantity per batch",
          "Near-expiry and expired warnings",
        ],
      },
    ],
  },
  {
    key: "2026-10-05-store-policies",
    updates: [
      {
        // Built: five default templates with placeholders filled from the
        // business (unit tests), the Policies editor in Settings → Online Store
        // (component tests), a return window setting, and footer plus checkout
        // links in the storefront (rendered and checked). Left unticked on
        // purpose: "Public URLs per page for Razorpay review". The public
        // routes (/store/:slug/policies.json and the server-rendered
        // /store/:slug/policies/:kind), the storefront page and the copy-links
        // box are written and covered by an integration test that was not run
        // (no Postgres here), and nothing was opened in a browser or sent to
        // Razorpay. Tick it once those pass against a real database.
        title: "Store policy pages",
        status: "in_progress",
        done: [
          "Policy templates: Terms, Refund, Shipping, Contact, Privacy",
          "Pre-fill from business details",
          "Editor for each policy page",
          "Footer and checkout links",
        ],
      },
    ],
  },
  {
    key: "2026-10-05-trial-phone",
    updates: [
      {
        // Sign-up now collects a mobile number (web and mobile forms require
        // it; auth.register keeps it optional for API clients), stored on the
        // user as 10 digits and checked with email and GSTIN through a salted
        // hash in trial_claims. The add-on caps line stays unticked: the AI
        // assistant and Payroll do not exist yet.
        title: "P2. Full Access Trial",
        status: "in_progress",
        done: ["One trial per business: phone / email / GSTIN check"],
      },
    ],
  },
  {
    key: "2026-10-05-payment-links",
    updates: [
      {
        // Built on each business's OWN Razorpay account (keys pasted in
        // Settings, Online payments, encrypted; the platform's Razorpay keys
        // are never used for customer money). Tested against a real Postgres
        // with a mocked Razorpay HTTP layer: payment link for the balance due
        // (reused while unchanged, replaced when the balance moves) on the
        // invoice and a Pay now button on the public share page; the
        // per-business signed webhook records payments once per Razorpay
        // payment id, partial and over-payments included, and books the
        // gateway charge on a gateway account named Razorpay. Not run against
        // the real Razorpay (no account here), so test and live keys still
        // need one manual pass. The reminder lines belong to the reminders
        // work and are left unticked here.
        title: "Payment reminders, Razorpay payment links and UPI QR on invoices",
        status: "in_progress",
        done: [
          "Razorpay payment link on invoice and share page",
          "Razorpay webhook: verify signature and mark invoice paid",
          "Record gateway charges on the payment",
          "Partial payments and balance-due links",
        ],
      },
    ],
  },
  {
    key: "2026-10-05-payment-reminders",
    updates: [
      {
        // Reminders half built: per-business settings (off by default) in
        // Settings -> Payment reminders, an hourly job (before due, on due,
        // every N days, capped, 09:00-19:00 IST, idempotent per invoice +
        // channel + slot), stop on payment / do-not-remind, a wa.me link,
        // manual Send now with a 24h limit, and the history on the invoice
        // (web and mobile). Covered by unit tests and integration tests
        // against a real Postgres. Left unticked on purpose: "SMS reminders".
        // The MSG91 adapter and its request building are tested with a mocked
        // fetch only; no SMS was ever sent, and it needs the owner's MSG91
        // account and DLT-registered sender and template. Email goes through
        // the existing sender; no real email was sent either (the tests inject
        // the sender). The Razorpay payment-link lines belong to the other half.
        title: "Payment reminders, Razorpay payment links and UPI QR on invoices",
        status: "in_progress",
        done: [
          "Reminder settings per business (schedule, channels, templates)",
          "Scheduler: before due, on due, weekly after due",
          "Email reminders",
          "WhatsApp click-to-send link",
          "Stop reminders on payment / do-not-remind flag",
          "Reminder history on the invoice",
        ],
      },
    ],
  },
  {
    key: "2026-10-06-store-payments",
    updates: [
      {
        // Built: shoppers pay at store checkout through the business's OWN
        // Razorpay account (decision: its own API keys, not Razorpay Route;
        // the platform's RAZORPAY_KEY_ID never touches shopper money). The
        // connection from invoice payment links is reused and surfaced in
        // Settings -> Online Store with two switches (Pay online, Cash on
        // Delivery). Checkout makes a hosted Razorpay payment link on the
        // order's invoice for the amount worked out from the database; the
        // business webhook (signature verified, deduped by Razorpay payment
        // id) records the payment and gateway charge and marks the order and
        // invoice paid; an unpaid order keeps a Pay again link; paid orders
        // can be refunded through Razorpay in full or in part with a credit
        // note, idempotently, owner/admin only; shoppers get order, payment
        // received, payment failed and refund emails.
        // Tested: unit tests and integration tests against a real Postgres
        // with Razorpay's HTTP mocked, web component tests; the storefront
        // type-checks and builds. Still unverified: real Razorpay was never
        // called (no test or live keys), no browser run of the storefront or
        // the e2e journey, no real email sent. Not built: a delivery charge
        // at checkout (the order has items and GST only), so the status stays
        // in progress until a live test payment and refund have been made.
        title: "Online payments at store checkout",
        status: "in_progress",
        done: [
          "Decide: Razorpay Route vs per-merchant keys",
          "Store payment settings (connect Razorpay, keys encrypted)",
          "Checkout with UPI, card and netbanking",
          "Cash on Delivery on/off per store",
          "Webhook: verify signature, mark order and draft invoice paid",
          "Record payment with gateway charges",
          "Retry link for failed payments",
          "Refunds on cancel (full/partial) with credit note",
          "Order and payment emails to the shopper",
        ],
      },
    ],
  },
  {
    key: "2026-10-06-small-fixes",
    updates: [
      {
        // Reminders now carry the business's Razorpay payment link for the
        // current balance due ({{paymentLink}}): the active link is reused
        // for an unchanged balance, one is made only when a reminder is sent
        // (previews never create one), and a failure never blocks the
        // reminder. Tested against a real Postgres with a mocked Razorpay
        // HTTP layer. The checklist has no separate line for it (the Razorpay
        // payment link line covers the invoice and share page), so nothing
        // is ticked here.
        title: "Payment reminders, Razorpay payment links and UPI QR on invoices",
        status: "in_progress",
        done: [],
      },
    ],
  },
  {
    key: "2026-10-06-store-delivery",
    updates: [
      {
        // Built: one flat delivery fee per store with an optional free-delivery
        // threshold and the delivery note. The server prices it from the order
        // subtotal; it goes on the invoice as an additional charge (the GST
        // treatment invoice charges already have) and flows through the order
        // total, the payment link, refunds and the emails. Not built: charges
        // by pincode or weight, serviceable pincodes, courier integrations and
        // the shopper tracking link. The GST treatment of the charge is an open
        // question for a CA (docs/GST-RETURNS-CA-VERIFICATION.md).
        title: "Delivery charges and shipping integrations",
        status: "in_progress",
        done: ["Free-delivery threshold"],
      },
    ],
  },
  {
    key: "2026-10-07-mobile-grn-batches",
    updates: [
      {
        // Built on mobile: a Goods Receipts screen (More > Goods receipts) with a
        // list, a detail view (items with batch and expiry, mark sent, convert to
        // a purchase invoice) and a create form with supplier, receiving date and
        // item lines carrying the inward batch fields. Batch fields on invoice
        // edit (sale lines get the picker on the batch they were sold from,
        // purchase lines the saved batch number and dates) and on sales return
        // lines (the batch the goods were sold from, or one typed in). Everything
        // follows the batchesExpiry plan flag. Not built: purchase order link,
        // rejected and free quantities on a mobile GRN, batch MRP entry, and the
        // batch-wise stock report, so the inventoryReports.batchStock parity
        // exception stays and "Remove matching parity exceptions" is not ticked.
        // Not run on a device or emulator when this was written.
        title: "Batch fields in the mobile app",
        status: "in_progress",
        done: ["Batch and expiry fields on mobile purchase/GRN lines"],
      },
    ],
  },
  {
    key: "2026-10-07-payroll-phase-1",
    updates: [
      {
        // Built and tested (shared unit tests, API integration tests against Postgres, web component
        // tests): the employee master with exit and full and final link; salary components, templates
        // and annual CTC to monthly amounts with the 50% wage rule warning; attendance (daily status,
        // check-in/out, shifts, weekly offs, holidays by state and branch), leave types with accrual,
        // carry-forward and encashment, overtime; the payroll run (lock attendance, calculate,
        // approve with maker-checker, post one balanced journal entry, mark paid against a bank or cash
        // account); payslip PDFs with email; a generic bank payment file. All gated by the Payroll
        // add-on (ADDON_FEATURES.payroll.implemented stays false). NOT ticked: "Payslip PDF with email
        // and share link" (email and download are built; a public share link for salary data is
        // deliberately not), "Accounting entries: salary expense, PF/ESI/TDS/PT payable, salary payable"
        // (the expense, deductions payable and salaries payable entries are built; PF, ESI, TDS and PT
        // payable are Phase 2), and "CA review of rules and figures before go-live" (open: the Labour
        // Codes points, the overtime rate and the rounding rule need the CA). No mobile, CLI or MCP
        // screens (parity exceptions). Not run in a browser or on a device when this was written.
        title: "Payroll — Phase 1: employees, attendance, salary and payroll run",
        status: "in_progress",
        done: [
          "Employee master: personal details and photo",
          "Employee master: PAN, Aadhaar, UAN, ESIC IP number",
          "Employee master: code, joining date, department, designation, branch, manager, type",
          "Employee master: bank account, IFSC, name as per bank",
          "Employee master: tax regime choice (new/old)",
          "Employee exit: last working day, reason, link to full & final",
          "Attendance: daily present/absent/half-day/week-off with check-in/out",
          "Shifts, weekly offs and holiday calendar per state/branch + national holidays",
          "Leave types CL/SL/EL-PL/LOP with accrual, carry-forward and encashment",
          "Overtime at the configured rate (default 2x ordinary wage)",
          "Monthly paid days and LOP days summary for payroll",
          "Salary components: Basic, DA, HRA, conveyance, special, bonus, incentives, overtime",
          "50% wage rule check (Basic + DA + retaining allowance ≥ 50% of remuneration)",
          "Salary structure templates",
          "Monthly salary derived from annual CTC",
          "Payroll run: lock attendance",
          "Payroll run: calculate earnings − LOP − deductions = net pay",
          "Payroll run: review and approve (maker-checker)",
          "Bank bulk-payment file",
          "Pay salaries through existing bank and journal screens",
        ],
      },
    ],
  },
  {
    key: "2026-10-08-payroll-phase-2",
    updates: [
      {
        // Built and tested (shared unit tests with boundary values, API integration tests against
        // Postgres, web component tests): statutory settings per financial year (every rate, ceiling,
        // slab and due date is data, with a last-verified note and a "Verify with your CA" label);
        // business registrations (PF + establishment code, ESI + code, PT states, LWF state, TDS);
        // PF, VPF, EPS, ESI, professional tax, LWF and TDS on salary computed in the payroll run from
        // the settings and the employee's flags, with PF/EPS hidden everywhere when PF is off; payable
        // accounts per authority and recording statutory payments with challan details; the PF ECR
        // text file, the ESIC contribution file, PT and LWF sheets, Form 24Q working data, a Form 16
        // working copy (labelled for CA review) and the wages, attendance, leave, bonus and gratuity
        // registers. NOT ticked: "Professional Tax slabs by state (Maharashtra, Karnataka, Gujarat,
        // West Bengal…)" (the editable per-state slabs are built, but only Maharashtra is seeded and
        // the other states ship empty on purpose until a CA supplies the figures), "Other deductions:
        // advances, loan EMIs, penalties" (loans and recurring deductions as records belong to a later
        // phase; Phase 1 adjustments cover one-offs) and "CA verification of all rates and limits
        // before go-live" (open: see docs/PAYROLL-CA-VERIFICATION.md). The income-tax slabs also ship
        // empty. No mobile, CLI or MCP screens (parity exceptions). Not run in a browser; no portal
        // has validated any file layout.
        title: "Payroll — Phase 2: PF, ESI, PT, TDS and statutory filings",
        status: "in_progress",
        done: [
          "Statutory rates and limits as settings per financial year",
          "Business settings: PF registered + establishment code",
          "Business settings: ESI registered + code",
          "Business settings: PT state(s) and LWF state",
          "Hide PF/EPS everywhere when the business has no PF",
          "Employee settings: PF applicable yes/no",
          "Employee settings: EPS eligible, with auto-suggest (post-Sep-2014 > ₹15,000, age 58, international workers)",
          "Employee settings: excluded employee (opted out, never a PF member)",
          "PF on actual wages or capped at ₹15,000",
          "VPF percentage",
          "PF/EPF calculation: 12% + 12%, EPS 8.33% capped; full 12% to EPF without EPS",
          "ESI calculation (0.75% / 3.25%, ≤ ₹21,000) with auto-off and contribution-period rules",
          "TDS on salary (s.192) for new and old regime, standard deduction and 87A rebate",
          "Labour Welfare Fund by state (half-yearly/yearly)",
          "PF ECR file (PF members only; zero pension without EPS)",
          "ESIC monthly contribution file",
          "TDS Form 24Q quarterly data",
          "Form 16 yearly",
          "PT returns per state",
          "Registers: wages, attendance, leave, bonus, gratuity",
        ],
      },
    ],
  },
  {
    key: "2026-10-12-payroll-phase-3",
    updates: [
      {
        // Built and tested (shared unit tests, API integration tests against Postgres, web component tests
        // and mobile jest tests with the camera, location and server injected). NOT run on a real device
        // (no camera, GPS or biometric hardware) and not run in a browser: see docs/PENDING-OWNER-TASKS.md
        // section 17 (mobile build and device test, store review for camera and location, privacy policy
        // wording, CA/legal review of the attendance-photo consent). Built: employee and HR roles (HR
        // cannot approve or post; an employee reaches only payrollSelf and sign-in/out, enforced for every
        // procedure by a backstop in the authenticated middleware); invitation by single-use emailed link
        // and revoke; employee logins use no paid seat; server-clock punches with a selfie, one foreground
        // location reading, versioned consent, allowed work locations with the off/record/warn/block rules
        // and HR review of flagged punches; rollup of punches into attendance that never overwrites manual,
        // leave or locked days; selfie retention (default 90 days) with a scheduled purge; employee
        // self-service for attendance, payslips, leave and released Form 16; biometric file import with
        // undo and a device-key REST push. Mobile screens exist for the employee side. Not built: live
        // tracking, vendor SDKs, detection of a faked location, per-shift locations, phone-only invites.
        // Phase 4 lines are not touched. The AI assistant never sees selfies, locations or punches.
        title: "Payroll — Phase 3: mobile attendance, self-service and biometric import",
        status: "in_progress",
        done: [
          "Mobile check-in/out with selfie",
          "Geo-location capture (and allowed-location rules)",
          "Employee login and invitation flow",
          "Self-service: payslips",
          "Self-service: leave application and approval",
          "Self-service: attendance view",
          "Self-service: Form 16 download",
          "Biometric device attendance import",
          "HR / Payroll manager role and permissions",
          "Employee role limited to own records",
        ],
      },
    ],
  },
  {
    key: "2026-10-09-ai-phase-1",
    updates: [
      {
        // Built and tested (shared unit tests, API unit and integration tests against Postgres with a
        // scripted fake provider, web component tests). The real Anthropic API was never called and no
        // browser was run when this was written. Gated by the AI add-on (ADDON_FEATURES.ai_assistant and
        // ai_plus `implemented` stay false). Notes on specific lines: "Expose existing MCP tools as
        // tool-use" is a curated read-only allowlist of 19 tools that call the existing tRPC procedures
        // (the same capabilities the MCP server exposes) through a server-side caller built from the
        // user's own context; the MCP package's own tool definitions are not reused. "English / Hindi /
        // Hinglish questions": the prompt, the model router and the starter questions handle all three;
        // the language of the live model's replies is not verified. "Question quotas ...": included
        // 150 / 500 per IST month, the trial cap of 50, atomic consume and refund, and the extra-pack
        // credit ledger with an admin grant are built; the purchase of the packs is the separate "AI
        // add-on billing" work. "Privacy policy: data not used for training": the page text is added;
        // the owner still has to confirm the provider's data-use terms and the wording
        // (docs/PENDING-OWNER-TASKS.md, section 15). No mobile, CLI or MCP screens (parity exceptions).
        title: "AI business assistant — Phase 1: ask questions about your business",
        status: "in_progress",
        done: [
          "Chat panel: right panel on desktop, full screen on phones",
          "Entry points on dashboard and header",
          "Anthropic API client with key from server settings (not in code)",
          "Expose existing MCP tools as tool-use",
          "Model routing: cheaper model for simple, stronger for multi-step",
          "Enforce the signed-in user's permissions and business scope",
          "English / Hindi / Hinglish questions",
          "Answer cards: tables, mini charts, links",
          "Streaming answers",
          "Suggested questions",
          "Conversation history per user",
          "Audit log entries “via AI assistant”",
          "Owner switch per organisation and per role",
          "Question quotas: AI Assistant 150, AI Plus 500, ₹199 packs of 100, trial 50",
          "Admin: usage and cost per organisation",
          "Privacy policy: data not used for training",
        ],
      },
    ],
  },
  {
    key: "2026-10-11-ai-phase-2",
    updates: [
      {
        // Built and tested (shared unit tests, API unit and integration tests against Postgres with a scripted
        // fake provider, web component tests). The real Anthropic API was never called and no browser was run
        // when this was written. Gated by the AI add-on (ADDON_FEATURES.ai_assistant and ai_plus `implemented`
        // stay false). The model only proposes: six propose_* tools store a validated pending action
        // (ai_pending_actions) and the person's Confirm (ai.confirmAction, not a tool) runs the real procedure
        // as them, once, with every normal rule. "Send reminder from chat" does exactly what Send reminder on the
        // invoice does: email and SMS are sent by the existing machinery when confirmed (only the WhatsApp path,
        // which records the reminder and returns a wa.me link, and the card preview are covered end to end in
        // tests; no real email or SMS was sent), no new channel. "Page context": invoice, quotation, party, item,
        // report and a fixed list of pages, verified through the person's permissions; a report sends its id
        // (a period only when it is in the URL, which the reports page does not do yet). No native mobile app,
        // CLI or MCP surface (parity exceptions). Still to do for the item: a real-provider check of how
        // well the model follows the action rules, and the owner's release decision.
        title: "AI business assistant — Phase 2: actions with confirmation",
        status: "in_progress",
        done: [
          "Confirmation card component (review, edit, confirm, cancel)",
          "Create invoice / quotation from chat",
          "Record payment from chat",
          "Add party / item from chat",
          "Send reminder from chat",
          "Page context (current invoice, party, report)",
          "Permission checks and audit log for actions",
        ],
      },
    ],
  },
  {
    key: "2026-10-13-payroll-phase-4",
    updates: [
      {
        // Built and tested (shared unit tests with boundary values, API integration tests against Postgres,
        // web component tests); not run in a browser. NOT ticked: "CA verification of bonus and gratuity
        // rules" (nobody has confirmed them: docs/PAYROLL-CA-VERIFICATION.md, Phase 4, lists every
        // assumption and docs/PENDING-OWNER-TASKS.md has the owner item). Notes on specific lines: the bonus
        // percentage range (8.33 to 20) and 30 days are seeded but the eligibility ceiling, calculation
        // ceiling and minimum wage ship EMPTY and a bonus run refuses to calculate until they are set;
        // set-on / set-off is not built. "Full & final: pending salary" is built as a link: the last month's
        // salary is paid by the exit month's payroll run (with PF, ESI, TDS and the payslip), the
        // settlement shows it and cannot be submitted until that run is approved, so it is neither missed
        // nor paid twice. TDS on a settlement is NOT calculated (a manual amount line and a warning). Tax on
        // gratuity is not calculated. The relieving letter is not digitally signed. "Labour-law registers":
        // the Phase 2 registers plus employees, deductions and advances, overtime and settlements, as working
        // copies for CA or legal review (formats differ by state); no claim of statutory compliance. The
        // employee-side loan view was not built. No mobile, CLI or MCP surfaces (parity exceptions).
        title: "Payroll — Phase 4: bonus, gratuity, full & final, loans and registers",
        status: "in_progress",
        done: [
          "Bonus eligibility and calculation (8.33%–20%)",
          "Gratuity calculation (15 days per year; 1 year fixed-term / 5 years others)",
          "Full & final: pending salary",
          "Full & final: leave encashment",
          "Full & final: gratuity and recoveries",
          "Relieving letter",
          "Loans/advances: issue, EMI recovery, balance",
          "Labour-law registers",
        ],
      },
      {
        // The Phase 2 line about advances and loan EMIs: loans and advances are now records with an EMI
        // schedule, recovered by the payroll run as a payslip line (Phase 4). Penalties and fines remain one-off
        // adjustments (Phase 1) and are listed in the deductions register.
        title: "Payroll — Phase 2: PF, ESI, PT, TDS and statutory filings",
        status: "in_progress",
        done: ["Other deductions: advances, loan EMIs, penalties"],
      },
    ],
  },
  {
    key: "2026-10-15-ai-phase-3",
    updates: [
      {
        // Built and tested on the WEB (shared unit tests, API unit and integration tests against Postgres with a
        // scripted fake provider, web component tests with a mock SpeechRecognition). The real Anthropic API, a real
        // microphone, a real speech engine and a real browser were never used when this was written. Gated by the AI
        // add-on (ADDON_FEATURES.ai_assistant and ai_plus `implemented` stay false).
        // NOT ticked: "Voice input on web and mobile". Web voice input is built (the browser's own Web Speech
        // API, nothing recorded or sent by us, the transcript only fills the box), but the native app has no
        // assistant screen at all, so there is no mobile half: it needs an SSE client for React Native, the card
        // components and an on-device speech module (a new native build), which is a separate piece of work.
        // "Hindi replies" and "Gujarati replies": built are the reply-language rule in the system prompt (script,
        // Indian grouping, names and figures copied, legal terms kept), the per-person language preference, localised
        // starter questions, the model-router keywords and the speech recognition language (hi-IN, gu-IN). How well
        // the LIVE model writes Hindi and Gujarati is NOT verified; that needs real users once the key is set (owner
        // tasks, section 21). "Proactive dashboard tips": a deterministic ai.tips query (no model, no question used)
        // for overdue invoices, items below reorder level, expiring or expired batches and GST returns near the
        // 11th and 20th, through the person's own permissions, cached 5 minutes, on the web dashboard only (no mobile
        // dashboard card). The business records no filing frequency, so GST tips assume monthly filing.
        // "Help-centre answers with article links": a read-only search_help tool over a generated help index and a
        // validated `help` link kind. "Switch off tips per user": a per-person switch beside the owner's
        // organisation and role switches.
        title: "AI business assistant — Phase 3: voice, languages and proactive tips",
        status: "in_progress",
        done: [
          "Hindi replies",
          "Gujarati replies",
          "Proactive dashboard tips (overdue, low stock, expiring batches, GST due)",
          "Help-centre answers with article links",
          "Switch off tips per user",
        ],
      },
    ],
  },
];

/** Titles pulled to the front of their stage/priority group, in build order. */
const BUILD_ORDER_TITLES = [
  "AI business assistant — Phase 1",
  "Payroll — Phase 1",
  "Payroll add-on billing",
  "Store Pro add-on billing",
  "Online payments at store checkout",
  "Custom domain for stores",
  "Store themes",
];

const REST = [
  ...BEFORE_LAUNCH,
  ...PAYROLL_INVENTORY_AND_DOMAINS,
  ...AFTER_LAUNCH,
  ...ONLINE_STORE,
  ...AI,
  ...ROADMAP_ADDITIONS.flatMap((batch) => batch.items),
];
const buildOrderIndex = (item: RoadmapSeedItem) => {
  const i = BUILD_ORDER_TITLES.findIndex((t) => item.title.startsWith(t));
  return i < 0 ? BUILD_ORDER_TITLES.length : i;
};

/**
 * The board sorts by launch stage and priority first, then by this order:
 * plans/trial/billing, then the build-order items, then everything else.
 */
export const ROADMAP_SEED: RoadmapSeedItem[] = [
  ...PLANS_TRIAL_BILLING,
  ...[...REST].sort((a, b) => buildOrderIndex(a) - buildOrderIndex(b)),
];
