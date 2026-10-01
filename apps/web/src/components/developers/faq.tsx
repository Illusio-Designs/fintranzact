import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Add01Icon, ArrowRight01Icon, MinusSignIcon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import { groupById } from "@/content/developers";
import type { DeveloperGroupSlug } from "@/lib/developer-paths";
import { PERSONAS, usePersona, type PersonaId } from "./persona";
import { RichText } from "./ui";

export interface FaqItem {
  question: string;
  answer: string;
  /** Endpoint groups the answer refers to. */
  relatedGroups: DeveloperGroupSlug[];
  /** Readers this question is most useful to. */
  personas: PersonaId[];
}

export const FAQ_ITEMS: FaqItem[] = [
  // --- Everyone ---
  {
    question: "How does authentication work?",
    answer:
      "Fintranzact uses session-based auth. Call `auth.login` or `auth.register` to get a session. Web clients receive an HttpOnly `session_id` cookie (30-day expiry, SameSite=Lax) that the browser sends automatically. Mobile and server clients send the returned `sessionToken` as a Bearer token in the `Authorization` header. There are no JWTs: sessions are stored on the server and can be revoked at once.",
    relatedGroups: ["auth"],
    personas: ["developer", "agent-builder"],
  },
  {
    question: "What is the x-business-id header?",
    answer:
      "Every business-scoped endpoint needs an `x-business-id` header with the UUID of the active business. One organisation can hold many businesses (for example a CA firm with 30 clients). Call `business.list` to get your business IDs, then send the chosen ID with every request.",
    relatedGroups: ["businesses"],
    personas: ["developer", "agent-builder", "ca-accountant"],
  },
  {
    question: "How are money values sent?",
    answer:
      "All money values are strings such as `\"12500.00\"`, stored as PostgreSQL `NUMERIC(15,2)`. Never do arithmetic with JavaScript `parseFloat` or `Number()`: you will lose precision. The `@fintranzact/shared` package has a `money` module with safe arithmetic. When sending values, always use strings: `\"1250.00\"`, not `1250`.",
    relatedGroups: [],
    personas: ["developer", "agent-builder"],
  },
  {
    question: "What roles and permissions are there?",
    answer:
      "Six roles, from most to least access: `superadmin`, `owner`, `admin` (full business access), `seller_manager` (invoices, parties and items, with limited delete), `seller` (create invoices and payments only) and `accountant` (payments, expenses, bank, reports and GST). Roles are given per organisation with `tenant.inviteMember`, and each endpoint lists the minimum role it needs.",
    relatedGroups: ["tenant"],
    personas: ["developer", "ca-accountant", "business-owner"],
  },

  // --- Developers ---
  {
    question: "How do I page through results?",
    answer:
      "List endpoints accept `page` (starting at 1) and `limit` (1 to 100, default 20). Responses include a `total` count with the current page, for example `{ data: [...], total: 156, page: 1, limit: 20 }`.",
    relatedGroups: ["invoices", "parties"],
    personas: ["developer"],
  },
  {
    question: "Can I batch several tRPC calls?",
    answer:
      "Yes. The API supports `httpBatchLink`, so the tRPC client sends calls made at the same time as one HTTP request. If your screen calls `dashboard.summary`, `dashboard.salesTrend` and `dashboard.topCustomers` together, they go out as a single batched request with no extra setup.",
    relatedGroups: ["dashboard"],
    personas: ["developer"],
  },
  {
    question: "How do I create an invoice from code?",
    answer:
      "Call `invoice.create` with `partyId`, `type` (\"sale\" or \"purchase\") and at least one line in `lineItems`. Each line needs `itemName`, `quantity` (string) and `unitPrice` (string), and can carry `taxPercent` and `itemId`. The API assigns the invoice number, works out totals with the right GST split (CGST + SGST or IGST from the state codes) and moves stock when `itemId` is set. New invoices start as `draft`.",
    relatedGroups: ["invoices"],
    personas: ["developer", "agent-builder"],
  },
  {
    question: "What are the rate limits?",
    answer:
      "Limits are per IP address, per minute: 120 for signed-in requests from a Fintranzact site, 60 for signed-out requests from a Fintranzact site, 60 for signed-in requests from elsewhere and 10 for signed-out requests from elsewhere. Going over returns `429 Too Many Requests` with `Retry-After: 60`.",
    relatedGroups: [],
    personas: ["developer", "agent-builder"],
  },

  // --- AI agent builders ---
  {
    question: "How do I connect an AI agent through MCP?",
    answer:
      "Install `@fintranzact/mcp` and add it to your Claude Desktop `claude_desktop_config.json` with `FINTRANZACT_API_URL`, `FINTRANZACT_API_KEY`, `FINTRANZACT_TENANT_ID` and `FINTRANZACT_BUSINESS_ID`. The MCP server exposes the API as tools, plus six ready-made prompts: morning_briefing, party_deep_dive, gst_filing_prep, collection_follow_up, inventory_health and month_close.",
    relatedGroups: ["api-keys"],
    personas: ["agent-builder"],
  },
  {
    question: "Can an AI agent do anything a person cannot?",
    answer:
      "No, and that is the point. An agent calls the same `invoice.create`, `payment.create` and `reports.trialBalance` endpoints the web app uses, with the same checks, permissions and audit trail. The difference is speed: an agent can work through hundreds of bank lines or prepare GSTR-1 data in seconds, and every step can be traced.",
    relatedGroups: [],
    personas: ["agent-builder"],
  },
  {
    question: "How do I create API keys for an agent?",
    answer:
      "Call `apiKey.create` with a clear name. The key is shown only once, so store it safely. Send it as `Authorization: Bearer <key>` or give it to the MCP server as `FINTRANZACT_API_KEY`. Keys belong to one organisation and can be revoked at once with `apiKey.revoke`.",
    relatedGroups: ["api-keys"],
    personas: ["agent-builder", "developer"],
  },

  // --- CAs and accountants ---
  {
    question: "How do I set up a new client?",
    answer:
      "1) Create a business with `business.create`, including the client's GST details and state code; a standard Indian chart of accounts is created for it. 2) Invite the client with `tenant.inviteMember` as `seller` or `admin` so they can bill from their phone. 3) If you are moving over mid-year, bring in opening balances with `journal.create`.",
    relatedGroups: ["businesses", "tenant", "journals"],
    personas: ["ca-accountant"],
  },
  {
    question: "How do I get GSTR-1 and GSTR-3B data?",
    answer:
      "Call `gst.gstr1` with `{year, month}` for GSTR-1 data (B2B, B2C large, B2C small, HSN summary, credit and debit notes) and `gst.gstr3b` for the summary return (outward supplies, ITC, reverse charge, net payable). Both are built from your invoices with no manual entry. Download the portal JSON with `gst.gstr1Json` or a CSV with `gst.gstr1CSV`.",
    relatedGroups: ["gst"],
    personas: ["ca-accountant"],
  },
  {
    question: "How do I reconcile a bank statement?",
    answer:
      "1) Upload the CSV with `bankRecon.uploadCSV`; the bank's format is detected for 10 Indian banks. 2) Confirm the column mapping with `bankRecon.confirmMapping`. 3) Lines are matched automatically in four passes: exact (amount, date and reference), strong (amount within two days), narration (UPI ID or cheque number) and partial (amount within seven days). 4) Review what is left and `confirmMatch`, `createExpense` or `ignoreLine`.",
    relatedGroups: ["bank-recon"],
    personas: ["ca-accountant"],
  },
  {
    question: "How do I produce year-end statements?",
    answer:
      "Statements are always live, with no closing step. Call `reports.trialBalance`, `reports.balanceSheet`, `reports.profitAndLoss` and `reports.cashFlowStatement` for your date range. At year end, post depreciation and provisions with `journal.create`, compare years with `reports.comparativeProfitAndLoss`, and export to Tally with `reports.tallyExport`.",
    relatedGroups: ["reports", "journals"],
    personas: ["ca-accountant"],
  },
  {
    question: "How does ITC tracking work?",
    answer:
      "ITC entries come from purchase invoices. `itc.dashboard` shows available, used and blocked credit. `itc.agingAlerts` flags credit nearing the Section 16(4) time limit. Mark Section 17(5) credit as blocked with `itc.markBlocked`, record use in the set order (IGST, then CGST, then SGST) with `itc.recordUtilization`, and get GSTR-3B Table 4 data from `itc.gstr3bTable4`.",
    relatedGroups: ["itc"],
    personas: ["ca-accountant"],
  },

  // --- Business owners ---
  {
    question: "How do I create my first invoice?",
    answer:
      "1) Add the customer with `party.create` (name, phone and GSTIN if they have one). 2) Add products or services with `item.create` (name, price, unit and HSN code). 3) Create the invoice with `invoice.create`, linking the party and items. GST is worked out for you (CGST + SGST within your state, IGST for other states), the invoice gets its number and stock is updated.",
    relatedGroups: ["invoices", "parties", "items"],
    personas: ["business-owner"],
  },
  {
    question: "How do I see who owes me money?",
    answer:
      "Call `dashboard.topOutstanding` for your largest dues. For ageing, `dashboard.receivablesAging` groups what is owed by age (0-30, 31-60, 61-90 and over 90 days). For one customer, `party.ledger` shows every invoice and payment with a running balance.",
    relatedGroups: ["dashboard", "parties"],
    personas: ["business-owner"],
  },
  {
    question: "How do I give my CA access?",
    answer:
      "Invite your CA with `tenant.inviteMember` and the `accountant` role. They get the money side (payments, expenses, bank accounts, reports and GST) and read-only access to invoices, parties and items, using their own login. Remove access at any time with `tenant.removeMember`.",
    relatedGroups: ["tenant"],
    personas: ["business-owner"],
  },
  {
    question: "How do I run my online store?",
    answer:
      "Set up the store with `store.updateSettings` (logo, colours, minimum order value and delivery options). Choose which items appear with `store.bulkToggleItems` and set store prices with `store.updateItemStoreSettings`. Orders arrive after phone verification; `store.confirmOrder` confirms one and creates its invoice.",
    relatedGroups: ["store"],
    personas: ["business-owner"],
  },
  {
    question: "How do I record a payment?",
    answer:
      "Call `payment.create` with `partyId`, `amount` (string) and `mode` (cash, bank, UPI, cheque or other). Link it to one invoice with `invoiceId` or spread it over several with `allocations`. Each invoice's paid amount and status (partly paid or paid) are updated together, and settlement discounts are supported.",
    relatedGroups: ["payments"],
    personas: ["business-owner"],
  },
];

/** All FAQs with a persona filter; defaults to the reader's chosen persona. */
export function DeveloperFaq() {
  const { persona } = usePersona();
  const [filter, setFilter] = useState<PersonaId | "all" | null>(null);
  const active = filter ?? persona ?? "all";
  const items = active === "all" ? FAQ_ITEMS : FAQ_ITEMS.filter((item) => item.personas.includes(active));
  const [open, setOpen] = useState<string | null>(items[0]?.question ?? null);

  const tabs: Array<{ id: PersonaId | "all"; label: string }> = [
    { id: "all", label: "All" },
    ...PERSONAS.map((p) => ({ id: p.id, label: p.title })),
  ];

  return (
    <div>
      <div role="group" aria-label="Show questions for" className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={active === tab.id}
            onClick={() => setFilter(tab.id)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm font-semibold transition",
              active === tab.id
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-border-light text-text-secondary hover:border-brand-300",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {items.map((item, i) => {
          const isOpen = open === item.question;
          const id = `api-faq-${i}`;
          return (
            <div key={item.question} className="border-b border-border-light">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={id}
                onClick={() => setOpen(isOpen ? null : item.question)}
                className="flex w-full items-center justify-between gap-4 py-5 text-left text-[17px] font-bold text-text-primary"
              >
                {item.question}
                <span
                  className={cn(
                    "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full transition",
                    isOpen ? "bg-brand-600 text-white" : "bg-surface-2 text-text-primary",
                  )}
                >
                  <Icon icon={isOpen ? MinusSignIcon : Add01Icon} size={16} strokeWidth={2} />
                </span>
              </button>
              {isOpen && (
                <div id={id} className="pb-6 sm:pr-14">
                  <p className="text-[15px] leading-relaxed text-text-secondary [overflow-wrap:anywhere]">
                    <RichText text={item.answer} />
                  </p>
                  {item.relatedGroups.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {item.relatedGroups.map((groupId) => (
                        <Link
                          key={groupId}
                          to="/developers/$section"
                          params={{ section: groupId }}
                          className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 transition hover:bg-brand-100 dark:bg-white/5 dark:text-brand-200 dark:hover:bg-white/10"
                        >
                          {groupById.get(groupId)?.title ?? groupId} endpoints
                          <Icon icon={ArrowRight01Icon} size={13} />
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {items.length === 0 && <p className="py-8 text-center text-sm text-text-tertiary">No questions match this filter.</p>}
      </div>
    </div>
  );
}
