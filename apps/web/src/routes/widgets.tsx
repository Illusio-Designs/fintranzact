import { useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Add01Icon,
  Cancel01Icon,
  Analytics01Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Award01Icon,
  Building03Icon,
  ChartBarLineIcon,
  ChartLineData01Icon,
  Coins01Icon,
  ComputerIcon,
  CreditCardIcon,
  Cursor01Icon,
  DashboardSquare01Icon,
  Delete02Icon,
  Download04Icon,
  InputShortTextIcon,
  Invoice01Icon,
  Invoice03Icon,
  Mail01Icon,
  Menu01Icon,
  MoneyReceive01Icon,
  MoneySend01Icon,
  Moon02Icon,
  Notification01Icon,
  PackageIcon,
  PieChartIcon,
  Settings01Icon,
  ShoppingCart01Icon,
  Sun03Icon,
  Table01Icon,
  Target02Icon,
  UserGroupIcon,
  Wallet01Icon,
  FileEmpty01Icon,
} from "@hugeicons/core-free-icons";
import { CtaBand, MarketingLayout, PageHero } from "@/components/marketing/MarketingLayout";
import { Icon, IconCircle, type IconCircleTone, type IconSvgElement } from "@/components/ui/Icon";
import { WidgetHeader } from "@/components/ui/WidgetHeader";
import { InputField, SelectField, TextareaField, FormField } from "@/components/ui/FormField";
import { Select } from "@/components/ui/Select";
import { DateInput } from "@/components/ui/DateInput";
import { Combobox } from "@/components/ui/Combobox";
import { Listbox } from "@/components/ui/Listbox";
import { SearchInput } from "@/components/ui/SearchInput";
import { PillTabs, SegmentedControl } from "@/components/ui/Tabs";
import { Pagination } from "@/components/ui/Pagination";
import { Disclosure } from "@/components/ui/Disclosure";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { EmptyState } from "@/components/ui/EmptyState";
import { KbdShortcut } from "@/components/ui/KbdShortcut";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { SlideOver } from "@/components/ui/SlideOver";
import { StatCard } from "@/components/ui/StatCard";
import { DetailField } from "@/components/ui/DetailField";
import { toast } from "@/hooks/useToast";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

/**
 * Public component & widget gallery at /widgets.
 *
 * Renders the app's real UI components and dashboard widget layouts with
 * sample data, so anyone can try every control in light and dark mode
 * without an account. Nothing here talks to the API.
 */
export const Route = createFileRoute("/widgets")({
  component: WidgetsPage,
});

// ─── Sample data ──────────────────────────────────────────────────────────────

const PARTIES = [
  { value: "sharma", label: "Sharma Traders", description: "Mumbai" },
  { value: "mehta", label: "Mehta & Sons", description: "Pune" },
  { value: "patel", label: "Patel Retail", description: "Ahmedabad" },
  { value: "kiran", label: "Kiran Stores", description: "Nashik" },
  { value: "walkin", label: "Walk-in Customer", description: "Counter sale" },
];

const GST_RATES = [
  { value: "0", label: "0% — Exempt" },
  { value: "5", label: "5%", description: "Essential goods" },
  { value: "12", label: "12%" },
  { value: "18", label: "18%", description: "Most goods & services" },
  { value: "28", label: "28%", description: "Luxury items" },
];

const INVOICES = [
  { no: "INV-0045", party: "Sharma Traders", amount: "₹1,18,000", status: "paid" },
  { no: "INV-0044", party: "Mehta & Sons", amount: "₹42,480", status: "partial" },
  { no: "INV-0043", party: "Patel Retail", amount: "₹76,700", status: "overdue" },
  { no: "INV-0042", party: "Kiran Stores", amount: "₹12,980", status: "draft" },
];

const TREND = [
  { period: "May", sales: 820000, collections: 660000 },
  { period: "Jun", sales: 970000, collections: 770000 },
  { period: "Jul", sales: 890000, collections: 830000 },
  { period: "Aug", sales: 1110000, collections: 880000 },
  { period: "Sep", sales: 1240000, collections: 1030000 },
  { period: "Oct", sales: 1330000, collections: 1110000 },
];

const INVOICE_STATUS = [
  { name: "Paid", value: 74, color: "#10b981" },
  { name: "Partial", value: 33, color: "#f59e0b" },
  { name: "Overdue", value: 11, color: "#ef4444" },
  { name: "Draft", value: 10, color: "#94a3b8" },
];

const TOP_ITEMS = [
  { name: "Cotton shirts", amount: 240000 },
  { name: "Denim jeans", amount: 186000 },
  { name: "Kurta sets", amount: 132000 },
  { name: "Silk sarees", amount: 96000 },
  { name: "Accessories", amount: 48000 },
];

const TOP_CUSTOMERS = [
  { name: "Sharma Traders", amount: 310000 },
  { name: "Mehta & Sons", amount: 205000 },
  { name: "Patel Retail", amount: 162000 },
  { name: "Kiran Stores", amount: 101000 },
  { name: "Walk-in Customer", amount: 74000 },
];

const PAYMENT_MODES = [
  { name: "UPI", value: 452000, color: "#f59e0b" },
  { name: "Bank Transfer", value: 276000, color: "#3b5eaa" },
  { name: "Cash", value: 158000, color: "#10b981" },
  { name: "Cheque", value: 98000, color: "#8b5cf6" },
];

const EXPENSES = [
  { name: "Rent", amount: 42700 },
  { name: "Salaries", amount: 27000 },
  { name: "Utilities", amount: 20200 },
  { name: "Travel", amount: 13500 },
  { name: "Other", amount: 9000 },
];
const EXPENSE_COLORS = ["#3b5eaa", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

const SUMMARY: Array<{ label: string; value: string; color: string; icon: IconSvgElement; tone: IconCircleTone }> = [
  { label: "Sales", value: "₹12,00,000", color: "text-emerald-600", icon: ChartLineData01Icon, tone: "success" },
  { label: "Purchases", value: "₹7,45,000", color: "text-blue-600", icon: ShoppingCart01Icon, tone: "info" },
  { label: "Receivable", value: "₹2,16,000", color: "text-amber-600", icon: MoneyReceive01Icon, tone: "warning" },
  { label: "Payable", value: "₹1,38,000", color: "text-red-600", icon: MoneySend01Icon, tone: "danger" },
  { label: "Cash Position", value: "₹4,02,500", color: "text-emerald-600", icon: Wallet01Icon, tone: "cyan" },
  { label: "Expenses", value: "₹1,12,400", color: "text-text-primary", icon: Invoice01Icon, tone: "purple" },
];

const inr = (v: number) => "₹" + v.toLocaleString("en-IN");
const compact = (v: number) =>
  v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v);

const tooltipStyle = {
  contentStyle: {
    background: "var(--surface-0)",
    border: "1px solid var(--border-light)",
    borderRadius: "8px",
    fontSize: "12px",
  },
};

// ─── Layout helpers ───────────────────────────────────────────────────────────

function Section({
  id,
  title,
  icon,
  description,
  children,
}: {
  id: string;
  title: string;
  icon: IconSvgElement;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="card rounded-2xl p-5 md:p-6">
      <div className="mb-5 flex items-center gap-3">
        <IconCircle icon={icon} />
        <div>
          <h2 id={id} className="text-lg font-semibold text-text-primary">
            {title}
          </h2>
          {description && <p className="text-xs text-text-tertiary">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-xs font-semibold text-text-tertiary">{children}</p>;
}

function ChartBox({ children, height = 240 }: { children: ReactNode; height?: number }) {
  return (
    <div className="px-4 py-4" style={{ height }}>
      {children}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const options: Array<{ value: "light" | "dark" | "system"; label: string; icon: IconSvgElement }> = [
    { value: "light", label: "Light", icon: Sun03Icon },
    { value: "dark", label: "Dark", icon: Moon02Icon },
    { value: "system", label: "System", icon: ComputerIcon },
  ];
  return (
    <div role="group" aria-label="Colour theme" className="inline-flex gap-0.5 rounded-full bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={theme === o.value}
          onClick={() => setTheme(o.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors",
            theme === o.value ? "bg-brand-600 text-white shadow-sm" : "text-text-secondary hover:text-text-primary",
          )}
        >
          <Icon icon={o.icon} size={16} />
          {o.label}
        </button>
      ))}
    </div>
  );
}

function WidgetsPage() {
  return (
    <MarketingLayout title="Widgets">
      <PageHero
        eyebrow="Component & widget gallery"
        title="Every control and dashboard widget, live"
        subtitle="Type in the fields, click the controls and switch between light and dark to see how each part of Fintranzact looks and behaves. All figures are sample data."
      />
      <div className="sticky top-16 z-30 border-b border-border-light bg-surface-0/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 md:px-6">
          <span className="text-sm font-medium text-text-secondary">Theme</span>
          <ThemeSwitch />
        </div>
      </div>
      <div className="bg-surface-1">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 md:px-6">
          <ButtonsSection />
          <FormsSection />
          <div className="grid gap-6 lg:grid-cols-2">
            <NavigationSection />
            <FeedbackSection />
          </div>
          <DataSection />
          <DashboardWidgets />
        </div>
      </div>
      <CtaBand />
    </MarketingLayout>
  );
}

// ─── Buttons ──────────────────────────────────────────────────────────────────

function ButtonsSection() {
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <Section id="w-buttons" title="Buttons" icon={Cursor01Icon} description="“New invoice” shows a goey toast, “Delete” opens a confirm dialog.">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" onClick={() => toast({ title: "Invoice saved", variant: "success" })}>
          <Icon icon={Add01Icon} size={18} />
          New invoice
        </button>
        <button type="button" className="btn-secondary">
          <Icon icon={Download04Icon} size={18} />
          Secondary
        </button>
        <button type="button" className="btn-ghost">Ghost</button>
        <button type="button" className="btn-danger" onClick={() => setConfirmOpen(true)}>
          <Icon icon={Delete02Icon} size={18} />
          Delete
        </button>
        <button type="button" className="btn-primary" disabled>
          Disabled
        </button>
        <button
          type="button"
          className="btn-primary min-w-[9rem]"
          onClick={() => {
            setLoading(true);
            setTimeout(() => setLoading(false), 2000);
          }}
          disabled={loading}
        >
          {loading && <Spinner size="sm" />}
          {loading ? "Saving…" : "Loading state"}
        </button>
        <button type="button" className="btn-icon rounded-full bg-surface-2" aria-label="Settings">
          <Icon icon={Settings01Icon} size={20} />
        </button>
        <button type="button" className="btn-icon relative rounded-full bg-surface-2" aria-label="Notifications">
          <Icon icon={Notification01Icon} size={20} />
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500 ring-2 ring-surface-2" />
        </button>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Delete invoice INV-0042?"
        description="This removes the invoice and its payments. This can’t be undone."
        confirmLabel="Delete"
        variant="danger"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          toast({ title: "Invoice INV-0042 deleted", variant: "success" });
        }}
      />
    </Section>
  );
}

// ─── Forms ────────────────────────────────────────────────────────────────────

function FormsSection() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("billing@acme");
  const [gstType, setGstType] = useState("regular");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [party, setParty] = useState("");
  const [rate, setRate] = useState("18");
  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState("10000");
  const [notes, setNotes] = useState("Payment due within 15 days.");
  const [roundOff, setRoundOff] = useState(true);
  const [einv, setEinv] = useState(false);
  const [mode, setMode] = useState("upi");
  const [unit, setUnit] = useState("pcs");

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const amt = parseFloat(amount.replace(/,/g, "")) || 0;

  return (
    <Section id="w-forms" title="Form fields" icon={InputShortTextIcon} description="Custom select, calendar, combobox, checkbox, switch and radio — no native browser pop-ups.">
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        <InputField label="Business name" required placeholder="Acme Trading Co" value={name} onChange={(e) => setName(e.target.value)} />
        <InputField
          label="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={emailOk ? undefined : "Enter a valid email address"}
          aria-invalid={!emailOk}
        />
        <SelectField label="GST registration (SelectField)" value={gstType} onChange={(e) => setGstType(e.target.value)}>
          <option value="regular">Regular</option>
          <option value="composition">Composition</option>
          <option value="unregistered">Not GST registered</option>
        </SelectField>
        <InputField label="Invoice date (calendar)" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <FormField label="Party (Combobox — type to filter)">
          <Combobox value={party} onChange={setParty} options={PARTIES} placeholder="Search customers…" />
        </FormField>
        <Listbox label="GST rate (Listbox)" value={rate} onChange={setRate} options={GST_RATES} />
        <FormField label="Search input">
          <SearchInput value={search} onChange={setSearch} placeholder="Search invoices…" />
        </FormField>
        <InputField label="Amount (₹)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ""))} className="text-right tabular-nums" />
        <InputField label="State code (disabled)" value="27 — Maharashtra" disabled />
        <FormField label="Unit (inline Select)" className="sm:col-span-1">
          <Select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Unit">
            <optgroup label="Count">
              <option value="pcs">Pieces (pcs)</option>
              <option value="box">Box</option>
            </optgroup>
            <optgroup label="Weight">
              <option value="kg">Kilogram (kg)</option>
              <option value="g">Gram (g)</option>
            </optgroup>
          </Select>
        </FormField>
        <FormField label="Due date (DateInput, optional)">
          <DateInput aria-label="Due date" defaultValue="" placeholder="No due date" />
        </FormField>
        <p className="self-end pb-2 text-xs text-text-tertiary">
          With 18% GST: <span className="font-semibold text-text-primary tabular-nums">{inr(Math.round(amt * 1.18))}</span>
        </p>
        <TextareaField
          label={`Terms & conditions (${notes.length} / 2000)`}
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 2000))}
          className="sm:col-span-2"
        />
        <div className="flex flex-col justify-center gap-4">
          <label className="flex cursor-pointer items-center gap-3 text-sm text-text-primary">
            <input type="checkbox" checked={roundOff} onChange={(e) => setRoundOff(e.target.checked)} />
            Round off totals (checkbox)
          </label>
          <label className="flex cursor-pointer items-center gap-3 text-sm text-text-primary">
            <input type="checkbox" role="switch" className="switch" checked={einv} onChange={(e) => setEinv(e.target.checked)} />
            e-Invoicing {einv ? "on" : "off"} (switch)
          </label>
        </div>
      </div>
      <fieldset className="mt-6">
        <legend className="label">Payment mode (radio)</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { value: "upi", label: "UPI", icon: Coins01Icon },
            { value: "bank", label: "Bank transfer", icon: Building03Icon },
            { value: "cash", label: "Cash", icon: Wallet01Icon },
            { value: "card", label: "Card", icon: CreditCardIcon },
          ].map((o) => (
            <label
              key={o.value}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-xl border-[1.5px] p-3 transition-colors",
                mode === o.value ? "border-brand-600 bg-brand-50 dark:bg-brand-950/40" : "border-border hover:border-brand-300",
              )}
            >
              <IconCircle icon={o.icon} size="sm" />
              <span className="flex-1 text-sm font-semibold text-text-primary">{o.label}</span>
              <input type="radio" name="w-mode" value={o.value} checked={mode === o.value} onChange={() => setMode(o.value)} />
            </label>
          ))}
        </div>
      </fieldset>
    </Section>
  );
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function NavigationSection() {
  const [pill, setPill] = useState("all");
  const [seg, setSeg] = useState("month");
  const [page, setPage] = useState(1);
  return (
    <Section id="w-nav" title="Navigation" icon={Menu01Icon}>
      <div className="flex flex-col gap-6">
        <div>
          <Label>Pill tabs</Label>
          <PillTabs
            value={pill}
            onChange={setPill}
            tabs={[
              { value: "all", label: "All", count: 124 },
              { value: "sale", label: "Sales", count: 86 },
              { value: "purchase", label: "Purchases", count: 27 },
              { value: "overdue", label: "Overdue", count: 11 },
            ]}
          />
        </div>
        <div>
          <Label>Segmented control</Label>
          <SegmentedControl
            value={seg}
            onChange={setSeg}
            tabs={[
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
              { value: "fy", label: "FY" },
            ]}
          />
        </div>
        <div>
          <Label>Pagination</Label>
          <div className="overflow-hidden rounded-xl border border-border-light">
            <Pagination page={page} totalPages={7} total={124} pageSize={20} onPageChange={setPage} />
          </div>
        </div>
        <div>
          <Label>Disclosure</Label>
          <Disclosure label="Advanced GST settings" icon={<Icon icon={Settings01Icon} size={16} />}>
            <p className="text-sm text-text-secondary">
              GST return periodicity, e-way bill threshold and assessee of other territory live here, hidden until needed.
            </p>
          </Disclosure>
        </div>
      </div>
    </Section>
  );
}

// ─── Feedback ─────────────────────────────────────────────────────────────────

function FeedbackSection() {
  const [modalOpen, setModalOpen] = useState(false);
  const [slideOpen, setSlideOpen] = useState(false);
  return (
    <Section id="w-feedback" title="Status & feedback" icon={Notification01Icon}>
      <div className="flex flex-col gap-6">
        <div>
          <Label>Status badges</Label>
          <div className="flex flex-wrap gap-2">
            {["paid", "sent", "draft", "unfulfilled", "partial", "overdue", "cancelled", "adjusted"].map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge size="md" color="bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300">Badge</Badge>
            <Badge color="bg-surface-2 text-text-secondary">Small badge</Badge>
          </div>
        </div>
        <div>
          <Label>Toasts, dialogs and panels</Label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={() => toast({ title: "Invoice saved", description: "INV-0046 is ready to share.", variant: "success" })}>
              Success toast
            </button>
            <button type="button" className="btn-secondary" onClick={() => toast({ title: "Could not save", description: "Check the GSTIN and try again.", variant: "error" })}>
              Error toast
            </button>
            <button type="button" className="btn-secondary" onClick={() => toast({ title: "Syncing with GST portal…" })}>
              Info toast
            </button>
            <button type="button" className="btn-secondary" onClick={() => toast.warning("GSTIN not verified", "Invoices will be marked unverified.")}>
              Warning toast
            </button>
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(true)}>
              Modal
            </button>
            <button type="button" className="btn-secondary" onClick={() => setSlideOpen(true)}>
              Slide-over
            </button>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Loading</Label>
            <div className="mb-3 flex items-center gap-2 text-sm text-text-secondary">
              <Spinner className="text-brand-600" /> Spinner
            </div>
            <SkeletonRows count={3} height="h-3" />
          </div>
          <div className="rounded-xl border border-dashed border-border">
            <EmptyState icon={<Icon icon={FileEmpty01Icon} size={26} />} title="No invoices yet" description="Empty state" />
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          Command palette <KbdShortcut keys={["Ctrl", "K"]} />
        </div>
      </div>
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Share invoice">
        <div className="flex flex-col gap-4 pb-2">
          <InputField label="Send to" type="email" defaultValue="accounts@sharmatraders.in" />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)}>Cancel</button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setModalOpen(false);
                toast({ title: "Invoice sent", variant: "success" });
              }}
            >
              <Icon icon={Mail01Icon} size={16} />
              Send
            </button>
          </div>
        </div>
      </Modal>
      <SlideOver
        open={slideOpen}
        onClose={() => setSlideOpen(false)}
        title="Add expense"
        description="Slide-over panels hold longer forms."
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setSlideOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={() => setSlideOpen(false)}>Save</button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <InputField label="Description" placeholder="Rent, utilities, travel…" />
          <InputField label="Amount (₹)" placeholder="0.00" inputMode="decimal" />
          <InputField label="Date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
          <SelectField label="Category" defaultValue="rent">
            <option value="rent">Rent</option>
            <option value="salaries">Salaries</option>
            <option value="utilities">Utilities</option>
          </SelectField>
        </div>
      </SlideOver>
    </Section>
  );
}

// ─── Data display ─────────────────────────────────────────────────────────────

function DataSection() {
  return (
    <Section id="w-data" title="Data display" icon={Table01Icon}>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="overflow-x-auto rounded-xl border border-border-light lg:col-span-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-1 text-left text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                <th scope="col" className="px-4 py-2.5">Invoice</th>
                <th scope="col" className="px-4 py-2.5">Party</th>
                <th scope="col" className="px-4 py-2.5 text-right">Amount</th>
                <th scope="col" className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {INVOICES.map((r) => (
                <tr key={r.no} className="border-t border-border-light">
                  <td className="px-4 py-3 font-mono text-xs">{r.no}</td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-[10px] font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
                        {r.party.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                      </span>
                      {r.party}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.amount}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} size="sm" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-2 content-start gap-4 rounded-xl border border-border-light p-4 lg:grid-cols-1">
          <DetailField label="GSTIN"><span className="font-mono">27AABCU9603R1ZM</span></DetailField>
          <DetailField label="PAN"><span className="font-mono">AABCU9603R</span></DetailField>
          <DetailField label="Place of supply">27 — Maharashtra</DetailField>
          <DetailField label="Credit period">15 days</DetailField>
        </div>
      </div>
    </Section>
  );
}

// ─── Dashboard widgets (sample data) ──────────────────────────────────────────

function Delta({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums", up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
      <Icon icon={up ? ArrowUp01Icon : ArrowDown01Icon} size={12} strokeWidth={2.25} />
      {Math.abs(pct)}%
    </span>
  );
}

function DashboardWidgets() {
  const [topTab, setTopTab] = useState("all");
  const [milestone, setMilestone] = useState(true);
  const statusTotal = INVOICE_STATUS.reduce((s, d) => s + d.value, 0);

  return (
    <section aria-labelledby="w-widgets" className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <IconCircle icon={DashboardSquare01Icon} tone="solid" size="lg" />
        <div>
          <h2 id="w-widgets" className="text-xl font-semibold text-text-primary">Dashboard widgets</h2>
          <p className="text-xs text-text-tertiary">The same widgets you see on your dashboard, filled with sample data.</p>
        </div>
      </div>

      {milestone && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 dark:border-brand-800/50 dark:bg-brand-950/20">
          <div className="flex items-center gap-2.5">
            <IconCircle icon={Award01Icon} tone="solid" size="sm" />
            <p className="text-sm text-brand-700 dark:text-brand-300">100 invoices. Your business is moving.</p>
          </div>
          <button type="button" onClick={() => setMilestone(false)} aria-label="Dismiss" className="rounded-full p-1.5 text-brand-500 hover:bg-brand-100 hover:text-brand-700 dark:hover:bg-brand-900/40">
            <Icon icon={Cancel01Icon} size={16} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {SUMMARY.map((c) => (
          <StatCard key={c.label} label={c.label} value={c.value} valueColor={c.color} icon={c.icon} iconTone={c.tone} className="truncate" />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card overflow-hidden lg:col-span-2">
          <WidgetHeader title="Sales & Collections" icon={ChartBarLineIcon} />
          <ChartBox>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={TREND} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 11, fill: "var(--text-tertiary)" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: "var(--text-tertiary)" }} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} formatter={(v) => inr(Number(v))} cursor={{ fill: "var(--surface-2)" }} />
                <Bar dataKey="sales" name="Sales" fill="#3b5eaa" radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar dataKey="collections" name="Collections" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </ChartBox>
        </div>

        <div className="card overflow-hidden">
          <WidgetHeader title="Invoice Status" icon={Invoice03Icon} />
          <ChartBox>
            <div className="flex h-full flex-col">
              <div className="relative flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={INVOICE_STATUS} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="90%" paddingAngle={2} strokeWidth={0}>
                      {INVOICE_STATUS.map((d) => <Cell key={d.name} fill={d.color} />)}
                    </Pie>
                    <Tooltip {...tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-bold text-text-primary">{statusTotal}</span>
                  <span className="text-[11px] text-text-tertiary">invoices</span>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs text-text-secondary">
                {INVOICE_STATUS.map((d) => (
                  <span key={d.name} className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                    {d.name} {d.value}
                  </span>
                ))}
              </div>
            </div>
          </ChartBox>
        </div>

        <div className="card overflow-hidden">
          <WidgetHeader title="Top Selling" icon={PackageIcon}>
            <PillTabs
              size="sm"
              value={topTab}
              onChange={setTopTab}
              tabs={[
                { value: "all", label: "All" },
                { value: "product", label: "Products" },
                { value: "service", label: "Services" },
              ]}
            />
          </WidgetHeader>
          <ChartBox>
            <HorizontalBars data={TOP_ITEMS} color={topTab === "service" ? "#8b5cf6" : "#6366f1"} />
          </ChartBox>
        </div>

        <div className="card overflow-hidden">
          <WidgetHeader title="Top Customers" icon={UserGroupIcon} />
          <ChartBox>
            <HorizontalBars data={TOP_CUSTOMERS} color="#3b5eaa" />
          </ChartBox>
        </div>

        <div className="card overflow-hidden">
          <WidgetHeader title="Payment Modes" icon={CreditCardIcon} />
          <ChartBox>
            <div className="flex h-full flex-col">
              <div className="flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={PAYMENT_MODES} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="88%" paddingAngle={2} strokeWidth={0}>
                      {PAYMENT_MODES.map((d) => <Cell key={d.name} fill={d.color} />)}
                    </Pie>
                    <Tooltip {...tooltipStyle} formatter={(v) => inr(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs text-text-secondary">
                {PAYMENT_MODES.map((d) => (
                  <span key={d.name} className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                    {d.name}
                  </span>
                ))}
              </div>
            </div>
          </ChartBox>
        </div>

        <div className="card flex flex-col gap-3 px-5 py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <IconCircle icon={Coins01Icon} tone="success" size="sm" />
              <p className="text-sm font-semibold text-text-primary">Collection Efficiency</p>
            </div>
            <Delta pct={6} />
          </div>
          <div>
            <span className="text-3xl font-bold tabular-nums text-emerald-600">82%</span>
            <span className="ml-1.5 text-xs text-text-tertiary">collected</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: "82%" }} />
          </div>
          <div className="flex justify-between text-[11px] text-text-tertiary">
            <span>₹9,84,000 collected</span>
            <span>₹12,00,000 invoiced</span>
          </div>
        </div>

        <div className="card overflow-hidden">
          <WidgetHeader title="Expenses by Category" icon={PieChartIcon}>
            <span className="text-[11px] tabular-nums text-text-tertiary">₹1,12,400 total</span>
          </WidgetHeader>
          <ChartBox>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={[...EXPENSES].reverse()} margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" horizontal={false} />
                <XAxis type="number" tickFormatter={compact} tick={{ fontSize: 11, fill: "var(--text-tertiary)" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 11, fill: "var(--text-secondary)" }} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} formatter={(v) => inr(Number(v))} cursor={{ fill: "var(--surface-2)" }} />
                <Bar dataKey="amount" name="Amount" radius={[0, 3, 3, 0]} maxBarSize={18}>
                  {EXPENSES.map((_, i) => <Cell key={i} fill={EXPENSE_COLORS[(EXPENSES.length - 1 - i) % EXPENSE_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartBox>
        </div>

        <div className="card overflow-hidden">
          <WidgetHeader title="Month on Month" icon={Analytics01Icon} />
          <div className="px-4 py-3">
            <div className="mb-2 grid grid-cols-4 gap-2 text-[11px] font-medium text-text-tertiary">
              <span />
              <span className="text-right">Aug</span>
              <span className="text-right">Sep</span>
              <span className="text-right">Change</span>
            </div>
            <div className="space-y-2">
              {[
                { label: "Sales", prev: "₹10.7L", curr: "₹12.0L", pct: 12, color: "text-emerald-600" },
                { label: "Purchases", prev: "₹7.9L", curr: "₹7.4L", pct: -6, color: "text-blue-600" },
                { label: "Expenses", prev: "₹1.0L", curr: "₹1.1L", pct: 9, color: "text-text-primary" },
              ].map((r) => (
                <div key={r.label} className="grid grid-cols-4 items-center gap-2">
                  <span className="truncate text-xs font-medium text-text-secondary">{r.label}</span>
                  <span className="text-right text-xs tabular-nums text-text-tertiary">{r.prev}</span>
                  <span className={cn("text-right text-xs font-semibold tabular-nums", r.color)}>{r.curr}</span>
                  <div className="flex justify-end"><Delta pct={r.pct} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card px-4 py-4">
          <div className="mb-4 flex items-center gap-2.5">
            <IconCircle icon={Target02Icon} size="sm" />
            <h3 className="text-sm font-semibold text-text-primary">Your Targets</h3>
          </div>
          <div className="space-y-4">
            {[
              { name: "Monthly sales", progress: "₹12L of ₹15L", pct: 80, bar: "bg-brand-600", msg: "On track — ₹3L to go · 9 days left", msgColor: "text-brand-600 dark:text-brand-300" },
              { name: "New customers", progress: "18 of 20", pct: 90, bar: "bg-emerald-500", msg: "Almost there · 9 days left", msgColor: "text-emerald-600 dark:text-emerald-400" },
              { name: "Invoices raised", progress: "42 of 80", pct: 52, bar: "bg-amber-500", msg: "Behind pace — 38 more needed", msgColor: "text-amber-600 dark:text-amber-400" },
            ].map((t) => (
              <div key={t.name}>
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="font-medium text-text-primary">{t.name}</span>
                  <span className="text-text-tertiary tabular-nums">{t.progress}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                  <div className={cn("h-full rounded-full", t.bar)} style={{ width: `${t.pct}%` }} />
                </div>
                <p className={cn("mt-1 text-[11px] font-medium", t.msgColor)}>{t.msg}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function HorizontalBars({ data, color }: { data: Array<{ name: string; amount: number }>; color: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart layout="vertical" data={[...data].reverse()} margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" horizontal={false} />
        <XAxis type="number" tickFormatter={compact} tick={{ fontSize: 11, fill: "var(--text-tertiary)" }} axisLine={false} tickLine={false} />
        <YAxis
          type="category"
          dataKey="name"
          width={96}
          tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
          tickFormatter={(v: string) => (v.length > 14 ? v.slice(0, 12) + "…" : v)}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip {...tooltipStyle} formatter={(v) => inr(Number(v))} cursor={{ fill: "var(--surface-2)" }} />
        <Bar dataKey="amount" name="Amount" fill={color} radius={[0, 3, 3, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}
