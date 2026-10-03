import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Alert02Icon,
  Calendar03Icon,
  Notification03Icon,
  PackageIcon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDateShort, cn } from "@/lib/utils";
import { Icon, type IconSvgElement } from "@/components/ui/Icon";

type Alert = {
  /** Stable per occurrence, so "seen" survives reloads until something new happens. */
  id: string;
  icon: IconSvgElement;
  tone: "danger" | "warning" | "info";
  title: string;
  body: string;
  to?: "/invoices" | "/items" | "/gst" | "/tds" | "/settings";
};

const SEEN_KEY = "fintranzact:seen-alerts";

function readSeen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
  } catch {
    return [];
  }
}

const TONES: Record<Alert["tone"], string> = {
  danger: "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300",
  warning: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  info: "bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300",
};

/** GST return due dates (day of month) and the look-ahead that triggers a reminder. */
const GST_DUE = [
  { form: "GSTR-1", day: 11 },
  { form: "GSTR-3B", day: 20 },
];
const REMIND_DAYS = 7;

/**
 * Header bell. There is no notification store on the server, so alerts are
 * derived from data the app already has: overdue invoices, low stock, GST due
 * dates and scheduled maintenance.
 */
export function NotificationsBell({
  businessId,
  canSeeInvoices,
  canSeeItems,
  canSeeTds = false,
  isGstRegistered,
}: {
  businessId: string | null;
  canSeeInvoices: boolean;
  canSeeItems: boolean;
  canSeeTds?: boolean;
  isGstRegistered: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string[]>(readSeen);
  const ref = useRef<HTMLDivElement>(null);

  const { data: status } = trpc.dashboard.invoiceStatusBreakdown.useQuery(
    {},
    { enabled: !!businessId && canSeeInvoices, staleTime: 5 * 60 * 1000, retry: false },
  );
  const { data: lowStock } = trpc.item.lowStockCount.useQuery(undefined, {
    enabled: !!businessId && canSeeItems,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const { data: tdsDue } = trpc.tds.reminders.useQuery(undefined, {
    enabled: !!businessId && canSeeTds,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const { data: maintenance } = trpc.system.maintenanceStatus.useQuery(undefined, { staleTime: 60_000 });
  // The same query the countdown banner uses (one shared cache entry).
  const { data: billing } = trpc.billing.status.useQuery(undefined, { staleTime: 60_000, retry: 1 });

  const alerts = useMemo<Alert[]>(() => {
    const list: Alert[] = [];
    const overdue = status?.find((s) => s.status === "overdue");
    if (overdue && overdue.count > 0) {
      list.push({
        id: `overdue:${businessId}:${overdue.count}`,
        icon: Alert02Icon,
        tone: "danger",
        title: `${overdue.count} overdue invoice${overdue.count > 1 ? "s" : ""}`,
        body: `${formatCurrency(overdue.total)} is past the due date.`,
        to: "/invoices",
      });
    }
    if (lowStock && lowStock > 0) {
      list.push({
        id: `lowstock:${businessId}:${lowStock}`,
        icon: PackageIcon,
        tone: "warning",
        title: `${lowStock} item${lowStock > 1 ? "s" : ""} low on stock`,
        body: "At or below the low-stock level you set.",
        to: "/items",
      });
    }
    if (isGstRegistered) {
      const now = new Date();
      for (const { form, day } of GST_DUE) {
        // Returns for last month fall due this month.
        const due = new Date(now.getFullYear(), now.getMonth(), day);
        const daysLeft = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
        if (daysLeft >= 0 && daysLeft <= REMIND_DAYS) {
          list.push({
            id: `gst:${businessId}:${form}:${due.toISOString().slice(0, 10)}`,
            icon: Calendar03Icon,
            tone: "info",
            title: `${form} due ${daysLeft === 0 ? "today" : `in ${daysLeft} day${daysLeft > 1 ? "s" : ""}`}`,
            body: `For last month's returns, due ${formatDateShort(due)}.`,
            to: "/gst",
          });
        }
      }
    }
    // TDS/TCS deposits and returns due within a week or overdue. Dates follow current rules.
    for (const item of tdsDue?.items ?? []) {
      if (item.daysUntil > REMIND_DAYS) continue;
      const due = new Date(item.dueDate);
      const when = item.daysUntil < 0
        ? `overdue by ${-item.daysUntil} day${item.daysUntil === -1 ? "" : "s"}`
        : item.daysUntil === 0 ? "due today" : `due in ${item.daysUntil} day${item.daysUntil > 1 ? "s" : ""}`;
      list.push({
        id: `tds:${businessId}:${item.key}:${item.daysUntil < 0 ? "overdue" : item.daysUntil === 0 ? "today" : "soon"}`,
        icon: Calendar03Icon,
        tone: item.overdue ? "danger" : "warning",
        title: `${item.title} ${when}`,
        body: `${formatCurrency(item.amount)} by ${formatDateShort(due)}. Verify due dates with your CA.`,
        to: "/tds",
      });
    }
    // Full Access Trial reminders: the in-app side of the 7 / 2 / 0 days-left emails.
    // Derived from billing.status like every other alert here (there is no server-side inbox).
    if (billing?.state === "trialing" && billing.trial?.active && billing.trial.daysLeft <= 7) {
      const left = billing.trial.daysLeft;
      list.push({
        id: `trial:${left <= 2 ? 2 : 7}`,
        icon: Alert02Icon,
        tone: left <= 3 ? "warning" : "info",
        title: `${left} day${left === 1 ? "" : "s"} left in your Full Access Trial`,
        body: "Choose a plan to keep creating and editing after it ends.",
        to: "/settings",
      });
    } else if (billing?.state === "trial_expired") {
      list.push({
        id: "trial:0",
        icon: Alert02Icon,
        tone: "danger",
        title: "Trial ended: read-only",
        body: "Choose a plan to continue. Your data is safe and you can still view, search and export.",
        to: "/settings",
      });
    }
    if (maintenance?.startsAt && !maintenance.enabled && new Date(maintenance.startsAt) > new Date()) {
      list.push({
        id: `maintenance:${maintenance.startsAt}`,
        icon: Settings02Icon,
        tone: "info",
        title: "Scheduled maintenance",
        body: maintenance.message || `Starts ${formatDateShort(new Date(maintenance.startsAt))}.`,
      });
    }
    return list;
  }, [status, lowStock, tdsDue, maintenance, billing, isGstRegistered, businessId]);

  const unseen = alerts.filter((a) => !seen.includes(a.id)).length;

  function toggle() {
    setOpen((o) => {
      if (!o && alerts.length) {
        // Opening the panel marks everything in it as seen.
        const next = Array.from(new Set([...seen, ...alerts.map((a) => a.id)])).slice(-100);
        setSeen(next);
        try {
          localStorage.setItem(SEEN_KEY, JSON.stringify(next));
        } catch {
          // storage unavailable: the badge just reappears next visit
        }
      }
      return !o;
    });
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unseen ? `Notifications, ${unseen} new` : "Notifications"}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-border-light text-text-secondary transition-colors hover:bg-surface-1 hover:text-text-primary"
      >
        <Icon icon={Notification03Icon} size={19} />
        {unseen > 0 && (
          <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-red-600 px-1 text-2xs font-bold text-white ring-2 ring-surface-0">
            {unseen}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-full z-50 mt-2 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border-light bg-surface-0 shadow-dropdown animate-scale-in"
        >
          <div className="flex items-center justify-between border-b border-border-light px-4 py-3">
            <p className="text-sm font-bold text-text-primary">Notifications</p>
            <span className="text-xs text-text-tertiary">{alerts.length || "No"} alert{alerts.length === 1 ? "" : "s"}</span>
          </div>
          {alerts.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-text-tertiary">You're all caught up.</p>
          ) : (
            <ul className="max-h-[360px] overflow-y-auto py-1">
              {alerts.map((a) => {
                const content = (
                  <>
                    <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", TONES[a.tone])}>
                      <Icon icon={a.icon} size={18} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-text-primary">{a.title}</span>
                      <span className="block text-xs leading-relaxed text-text-tertiary">{a.body}</span>
                    </span>
                  </>
                );
                return (
                  <li key={a.id}>
                    {a.to ? (
                      <Link
                        to={a.to}
                        search={a.to === "/settings" ? { tab: "billing" } : undefined}
                        onClick={() => setOpen(false)}
                        className="flex gap-3 px-4 py-3 transition-colors hover:bg-surface-1"
                      >
                        {content}
                      </Link>
                    ) : (
                      <div className="flex gap-3 px-4 py-3">{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
