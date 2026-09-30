import {
  createRootRoute,
  Link,
  Outlet,
  useNavigate,
  useLocation,
} from "@tanstack/react-router";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { trpc, setBusinessId, queryClient } from "@/lib/trpc";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useIndiaTimeTheme } from "@/hooks/useTheme";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { KbdShortcut } from "@/components/ui/KbdShortcut";
import { ShortcutIndicator } from "@/components/ui/ShortcutIndicator";
import { Modal } from "@/components/ui/Modal";
import { BusinessSwitcher } from "@/components/ui/BusinessSwitcher";
import { Logo } from "@/components/ui/Logo";
import { Icon } from "@/components/ui/Icon";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  Add01Icon,
  Alert02Icon,
  BankIcon,
  CreditCardIcon,
  DashboardSquare01Icon,
  DeliveryTruck01Icon,
  FileEditIcon,
  FileSyncIcon,
  FileValidationIcon,
  Invoice01Icon,
  Logout01Icon,
  Menu01Icon,
  ArrowDown01Icon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  NoteRemoveIcon,
  PackageIcon,
  ReceiptDollarIcon,
  ReturnRequestIcon,
  Settings01Icon,
  ShippingTruck01Icon,
  ShoppingCart01Icon,
  TaxesIcon,
  UnfoldMoreIcon,
  UserIcon,
  Search01Icon,
  File01Icon,
  Location01Icon,
  Call02Icon,
  PlusSignIcon,
  BookOpen01Icon,
  QrCodeIcon,
  Route01Icon,
  DocumentValidationIcon,
  Analytics01Icon,
  Coins01Icon,
  CheckListIcon,
  Building03Icon,
  ArrowDataTransferHorizontalIcon,
  SlidersHorizontalIcon,
  TaskDone01Icon,
} from "@hugeicons/core-free-icons";
import { getRegisteredHotkeys } from "@/hooks/useHotkeys";
import { cn } from "@/lib/utils";
import { formatRole } from "@/lib/roles";
import { NotificationsBell } from "@/components/NotificationsBell";
import { MaintenanceBanner } from "@/components/MaintenanceBanner";
import { LandingPage } from "@/components/LandingPage";
import { AUTH_PUBLIC_PATHS, isMarketingPath } from "@/lib/public-paths";
import { isDesktop } from "@/lib/isDesktop";
import { clearDesktopToken } from "@/lib/desktop-session";

import { Spinner } from "@/components/ui/Spinner";
export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: RootError,
});

function RootError({ error }: { error: Error }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-1 p-8">
      <div className="max-w-md text-center">
        <div className="w-12 h-12 rounded-xl bg-red-100 dark:bg-red-950 flex items-center justify-center mx-auto mb-4">
          <Icon icon={Alert02Icon} size={24} className="text-red-600" />
        </div>
        <h1 className="text-lg font-semibold text-text-primary mb-2">
          Something went wrong
        </h1>
        <p className="text-sm text-text-tertiary mb-6">
          {error?.message || "An unexpected error occurred. Please try again."}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="btn-primary"
        >
          Reload Page
        </button>
      </div>
    </div>
  );
}

// ── Role-based access control ──────────────────────────────────

const ROLE_ABILITIES: Record<string, Set<string>> = {
  owner: new Set(["*"]),
  admin: new Set(["*"]),
  seller_manager: new Set([
    "Invoice:read",
    "Invoice:create",
    "Party:read",
    "Item:read",
    "Payment:read",
    "Store:read",
    "RecurringInvoice:read",
    "Business:read",
  ]),
  seller: new Set([
    "Invoice:read",
    "Invoice:create",
    "Party:read",
    "Item:read",
    "Payment:read",
    "Store:read",
    "Business:read",
    "RecurringInvoice:read",
  ]),
  accountant: new Set([
    "Payment:read",
    "Expense:read",
    "BankAccount:read",
    "Invoice:read",
    "Party:read",
    "Item:read",
    "Store:read",
    "RecurringInvoice:read",
    "Report:read",
    "GstReport:read",
    "Business:read",
    // Mirrors the API: accountants manage the books and read compliance docs
    "Account:read",
    "BankReconciliation:read",
    "ITC:read",
    "EInvoice:read",
    "EWayBill:read",
  ]),
};

function canAccess(
  role: string | null | undefined,
  resource: string,
  action: string,
): boolean {
  if (!role) return true; // graceful degradation while loading
  const abilities = ROLE_ABILITIES[role];
  if (!abilities) return true; // unknown role — show all
  if (abilities.has("*")) return true;
  return abilities.has(`${resource}:${action}`);
}

const NAV_COLLAPSED_KEY = "fintranzact:nav-collapsed";
const NAV_SECTIONS_KEY = "fintranzact:nav-sections";

// ── Sidebar nav structure ──────────────────────────────────────

/**
 * Sidebar menu, grouped the way accountants think about their books
 * (Tally-style): masters under Accounts and Inventory, every transaction
 * under Vouchers, and read-outs under Reports.
 */
const navSections = [
  {
    label: "OVERVIEW",
    items: [
      {
        to: "/",
        label: "Dashboard",
        icon: DashboardSquare01Icon,
        exact: true,
        resource: "Report",
        action: "read",
      },
    ],
  },
  {
    label: "ACCOUNTS",
    items: [
      {
        to: "/parties",
        label: "Parties",
        icon: UserIcon,
        resource: "Party",
        action: "read",
      },
      {
        to: "/cash-and-bank",
        label: "Cash & Bank",
        icon: BankIcon,
        resource: "BankAccount",
        action: "read",
      },
      {
        to: "/bank-reconciliation",
        label: "Bank Reconciliation",
        icon: CheckListIcon,
        resource: "BankReconciliation",
        action: "read",
      },
    ],
  },
  {
    label: "INVENTORY",
    items: [
      {
        to: "/items",
        label: "Stock Items",
        icon: PackageIcon,
        resource: "Item",
        action: "read",
      },
      {
        to: "/warehouses",
        label: "Warehouses",
        icon: Building03Icon,
        resource: "Item",
        action: "read",
      },
      {
        to: "/stock-transfers",
        label: "Stock Transfers",
        icon: ArrowDataTransferHorizontalIcon,
        resource: "Item",
        action: "read",
      },
      {
        to: "/stock-adjustments",
        label: "Stock Adjustments",
        icon: SlidersHorizontalIcon,
        resource: "Item",
        action: "read",
      },
      {
        to: "/physical-stock",
        label: "Physical Stock",
        icon: TaskDone01Icon,
        resource: "Item",
        action: "read",
      },
      {
        to: "/shipments",
        label: "Shipments",
        icon: ShippingTruck01Icon,
        resource: "Invoice",
        action: "read",
      },
    ],
  },
  {
    label: "VOUCHERS",
    items: [
      {
        to: "/invoices",
        label: "Invoices",
        icon: Invoice01Icon,
        resource: "Invoice",
        action: "read",
      },
      {
        to: "/quotations",
        label: "Quotations",
        icon: FileEditIcon,
        resource: "Invoice",
        action: "read",
      },
      {
        to: "/proforma-invoices",
        label: "Proforma Invoices",
        icon: FileValidationIcon,
        resource: "Invoice",
        action: "read",
      },
      {
        to: "/delivery-challans",
        label: "Delivery Challans",
        icon: DeliveryTruck01Icon,
        resource: "Invoice",
        action: "read",
      },
      {
        to: "/sales-returns",
        label: "Sales Returns",
        icon: ReturnRequestIcon,
        resource: "Invoice",
        action: "read",
      },
      {
        to: "/credit-notes",
        label: "Credit Notes",
        icon: NoteRemoveIcon,
        resource: "Invoice",
        action: "read",
      },
      {
        to: "/payments",
        label: "Payments",
        icon: CreditCardIcon,
        resource: "Payment",
        action: "read",
      },
      {
        to: "/expenses",
        label: "Expenses",
        icon: ReceiptDollarIcon,
        resource: "Expense",
        action: "read",
      },
      {
        to: "/journal-entries",
        label: "Journal Entries",
        icon: BookOpen01Icon,
        resource: "Account",
        action: "read",
      },
      {
        to: "/store-orders",
        label: "Store Orders",
        icon: ShoppingCart01Icon,
        resource: "Store",
        action: "read",
      },
      {
        to: "/automated-invoices",
        label: "Recurring Invoices",
        icon: FileSyncIcon,
        resource: "RecurringInvoice",
        action: "read",
      },
    ],
  },
  {
    label: "REPORTS",
    items: [
      {
        to: "/reports",
        label: "Reports",
        icon: Analytics01Icon,
        resource: "Report",
        action: "read",
      },
      {
        to: "/gst",
        label: "__REPORTS__",
        icon: TaxesIcon,
        resource: "GstReport",
        action: "read",
      }, // label set dynamically based on GST status
      {
        to: "/gstr2b",
        label: "GSTR-2B Recon",
        icon: DocumentValidationIcon,
        resource: "GstReport",
        action: "read",
        gstOnly: true,
      },
      {
        to: "/itc",
        label: "Input Tax Credit",
        icon: Coins01Icon,
        resource: "ITC",
        action: "read",
        gstOnly: true,
      },
      {
        to: "/e-invoicing",
        label: "e-Invoicing",
        icon: QrCodeIcon,
        resource: "EInvoice",
        action: "read",
        gstOnly: true,
      },
      {
        to: "/eway-bills",
        label: "E-Way Bills",
        icon: Route01Icon,
        resource: "EWayBill",
        action: "read",
        gstOnly: true,
      },
    ],
  },
];

// ── NoOrgScreen — shown when user has zero memberships ─────────

function NoOrgScreen() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { data: pendingInvites, isLoading: invitesLoading } =
    trpc.tenant.myInvitations.useQuery();
  const { data: canCreateOrg } = trpc.tenant.canCreateOrg.useQuery();

  const acceptByIdMutation = trpc.tenant.acceptById.useMutation({
    onSuccess: async (data) => {
      await utils.auth.me.refetch();
      await utils.tenant.list.refetch();
      await utils.business.list.refetch();
      navigate({ to: "/", search: { joined: data.tenantName } });
    },
  });

  const createOrgMutation = trpc.tenant.create.useMutation({
    onSuccess: async () => {
      await utils.auth.me.refetch();
      await utils.tenant.list.refetch();
      await utils.business.list.refetch();
    },
  });

  const isActing = acceptByIdMutation.isPending || createOrgMutation.isPending;
  const error =
    acceptByIdMutation.error?.message ?? createOrgMutation.error?.message;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-surface-1">
      <div className="w-full max-w-[400px] rounded-2xl p-8 shadow-elevated bg-surface-0 border border-border-light">
        <div className="flex items-center justify-center gap-2.5 mb-6">
          <Logo className="w-9 h-9" />
          <span className="font-semibold text-lg tracking-tight text-text-primary">
            Fintranzact
          </span>
        </div>

        {invitesLoading ? (
          <div className="text-center py-4">
            <Spinner size="md" className="text-brand-600 mx-auto" />
          </div>
        ) : pendingInvites && pendingInvites.length > 0 ? (
          <>
            <h2 className="text-lg font-semibold text-text-primary mb-1 text-center">
              You've been invited!
            </h2>
            <p className="text-sm text-text-tertiary mb-5 text-center">
              Pick an organization to get started.
            </p>

            {error && (
              <div className="mb-4 px-3 py-2 rounded-lg text-sm bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="space-y-2 mb-4">
              {pendingInvites.map((inv) => (
                <button
                  key={inv.id}
                  onClick={() =>
                    acceptByIdMutation.mutate({ invitationId: inv.id })
                  }
                  disabled={isActing}
                  className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border-2 border-brand-200 bg-brand-50/50 hover:border-brand-400 hover:bg-brand-50 transition-colors text-left group dark:border-brand-600/30 dark:bg-brand-600/10 dark:hover:border-brand-500"
                >
                  <div className="w-10 h-10 rounded-lg bg-brand-600 flex items-center justify-center text-white font-semibold text-lg shrink-0">
                    {inv.tenantName.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-primary group-hover:text-brand-700 dark:group-hover:text-brand-400 truncate">
                      Join {inv.tenantName}
                    </p>
                    <p className="text-xs text-text-tertiary">
                      as {formatRole(inv.role)}
                    </p>
                  </div>
                  {acceptByIdMutation.isPending &&
                    acceptByIdMutation.variables?.invitationId === inv.id && (
                      <Spinner size="sm" className="text-brand-600 shrink-0" />
                    )}
                </button>
              ))}
            </div>

            {canCreateOrg && (
              <>
                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border-light" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-surface-0 px-3 text-xs text-text-tertiary">
                      or
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => createOrgMutation.mutate()}
                  disabled={isActing}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-border-light hover:border-border-medium hover:bg-surface-1 transition-colors text-sm font-medium text-text-secondary"
                >
                  {createOrgMutation.isPending
                    ? "Creating..."
                    : "I want my own organization instead"}
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-text-primary mb-1 text-center">
              No organization found
            </h2>
            <p className="text-sm text-text-tertiary mb-6 text-center">
              {canCreateOrg
                ? "Create an organization to get started, or ask your team admin to send you an invitation."
                : "Ask your team admin to send you an invitation to join their organization."}
            </p>

            {error && (
              <div className="mb-4 px-3 py-2 rounded-lg text-sm bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400">
                {error}
              </div>
            )}

            {canCreateOrg && (
              <button
                onClick={() => createOrgMutation.mutate()}
                disabled={createOrgMutation.isPending}
                className="btn-primary w-full py-2.5"
              >
                {createOrgMutation.isPending
                  ? "Creating..."
                  : "Create Organization"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── TenantPicker ───────────────────────────────────────────────

type TenantMembership = {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: string;
};

function TenantPicker({
  tenants,
  onSelect,
  onCreateNew,
  onClose,
}: {
  tenants: TenantMembership[];
  onSelect: (tenantId: string) => void;
  onCreateNew?: () => void;
  onClose?: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-surface-0 border border-border-light shadow-modal p-6 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-text-primary mb-1">
          Select Organization
        </h2>
        <p className="text-xs text-text-tertiary mb-5">
          Choose which organization to work in
        </p>
        <div className="space-y-2">
          {tenants.map((t) => (
            <button
              key={t.tenantId}
              onClick={() => onSelect(t.tenantId)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-border-light hover:border-brand-400 hover:bg-brand-600/5 transition-colors text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 text-sm font-semibold shrink-0">
                  {t.tenantName.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm font-medium text-text-primary group-hover:text-brand-700 transition-colors">
                  {t.tenantName}
                </span>
              </div>
              <span
                className={cn(
                  "text-[11px] font-medium px-2 py-0.5 rounded",
                  t.role === "owner"
                    ? "bg-brand-50 text-brand-700"
                    : t.role === "admin"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-surface-2 text-text-secondary",
                )}
              >
                {formatRole(t.role)}
              </span>
            </button>
          ))}

          {onCreateNew && (
            <button
              onClick={onCreateNew}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-dashed border-border-medium hover:border-brand-400 hover:bg-brand-600/5 transition-colors text-left group"
            >
              <div className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center text-text-secondary group-hover:text-brand-600 shrink-0">
                <Icon icon={Add01Icon} size={16} />
              </div>
              <span className="text-sm font-medium text-text-secondary group-hover:text-brand-700 transition-colors">
                Create new organization
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── RootLayout ─────────────────────────────────────────────────

function RootLayout() {
  const utils = trpc.useUtils();
  const {
    data: session,
    isLoading: sessionLoading,
    isFetching: sessionFetching,
    isError: sessionCheckFailed,
    refetch: refetchSession,
  } = trpc.auth.me.useQuery(undefined, {
    // A failed check (network blip, cold start, 429/5xx) is not the same as
    // being signed out, so retry a few times before giving up.
    retry: (failureCount, error) => {
      const code = (error as { data?: { code?: string } })?.data?.code;
      return code !== "UNAUTHORIZED" && failureCount < 3;
    },
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });
  // We could not find out whether the visitor is signed in. Never treat that
  // as "signed out" (that is what used to bounce people to /login at random).
  const sessionUnknown = !session && sessionCheckFailed;
  const {
    data: tenantList,
    isLoading: tenantListLoading,
    isFetching: tenantListFetching,
  } = trpc.tenant.list.useQuery(undefined, {
    enabled: !!session?.user,
  });
  const {
    data: businesses,
    isLoading: businessesLoading,
    isFetching: businessesFetching,
  } = trpc.business.list.useQuery(undefined, {
    enabled: !!session?.user && !!session?.tenantId,
  });

  const { data: canCreateOrg } = trpc.tenant.canCreateOrg.useQuery(undefined, {
    enabled: !!session?.user,
  });
  const { data: canCreateBiz } = trpc.business.canCreate.useQuery(undefined, {
    enabled: !!session?.user && !!session?.tenantId,
  });

  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [showPalette, setShowPalette] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showTenantPicker, setShowTenantPicker] = useState(false);

  const createOrgMutation = trpc.tenant.create.useMutation();
  const [currentBusinessId, setCurrentBusinessId] = useState<string | null>(
    () => {
      if (typeof window === "undefined") return null;
      return sessionStorage.getItem("selectedBusinessId");
    },
  );
  // Keep the tRPC client's x-business-id in step with the selection during
  // render, so a business restored from sessionStorage after a reload is
  // already attached to the first requests child routes fire (their effects
  // run before any effect here would).
  setBusinessId(currentBusinessId);
  // Light or dark follows the clock in India rather than a manual toggle, so
  // every surface — app and public pages alike — matches the working day of
  // the businesses using it.
  useIndiaTimeTheme();

  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Desktop rail state. Persisted because a collapsed sidebar is a workspace
  // preference — having it spring back open on every reload would defeat it.
  // Mobile ignores this entirely and keeps using the slide-in drawer.
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem(NAV_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(NAV_COLLAPSED_KEY, navCollapsed ? "1" : "0");
    } catch {
      // Private mode / storage disabled — the rail still works, just per-session.
    }
  }, [navCollapsed]);

  // Which nav groups are expanded. Absent from the map means open, so a fresh
  // install shows the full menu and collapsing is an explicit choice.
  const [closedSections, setClosedSections] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(NAV_SECTIONS_KEY) || "{}");
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(NAV_SECTIONS_KEY, JSON.stringify(closedSections));
    } catch {
      // Non-fatal: groups just reset next session.
    }
  }, [closedSections]);

  const activeSection = useMemo(() => {
    for (const section of navSections) {
      for (const item of section.items) {
        const hit =
          "exact" in item && item.exact
            ? pathname === item.to
            : pathname === item.to || pathname.startsWith(`${item.to}/`);
        if (hit) return section.label;
      }
    }
    return null;
  }, [pathname]);

  useEffect(() => {
    if (!activeSection) return;
    setClosedSections((prev) =>
      prev[activeSection] ? { ...prev, [activeSection]: false } : prev,
    );
  }, [activeSection]);

  const toggleSection = useCallback((label: string) => {
    setClosedSections((prev) => ({ ...prev, [label]: !prev[label] }));
  }, []);

  const selectTenantMutation = trpc.tenant.select.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      queryClient.invalidateQueries();
    },
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      // Clear the Bearer token from the OS keychain on desktop so a fresh
      // launch doesn't silently re-authenticate. No-op on web (the server
      // already cleared the cookie via Set-Cookie on the response).
      await clearDesktopToken();
      sessionStorage.removeItem("planSelectionDone");
      sessionStorage.removeItem("selectedBusinessId");
      setBusinessId(null);
      setCurrentBusinessId(null);
      queryClient.clear();
      navigate({ to: "/login" });
    },
  });

  useHotkeys([
    {
      key: "k",
      ctrl: true,
      handler: () => setShowPalette(true),
      description: "Command palette",
      scope: "global",
    },
    {
      key: "/",
      handler: () => setShowPalette(true),
      description: "Search",
      scope: "global",
    },
    {
      key: "?",
      shift: true,
      handler: () => setShowShortcuts((v) => !v),
      description: "Keyboard shortcuts",
      scope: "global",
    },
    // ── Navigation: press G, then the key ──
    //
    // Sequences rather than Alt+Shift chords: Alt+Shift is the Windows
    // input-language switcher, so on any machine with a second keyboard
    // layout installed those chords never reach the page. The Alt+Shift
    // bindings below are kept as aliases for anyone already using them; the
    // shortcuts dialog dedupes by description and shows the sequence.
    {
      key: "d",
      leader: "g",
      handler: () => navigate({ to: "/" }),
      description: "Dashboard",
      scope: "navigation",
    },
    {
      key: "i",
      leader: "g",
      handler: () => navigate({ to: "/invoices" }),
      description: "Invoices",
      scope: "navigation",
    },
    {
      key: "q",
      leader: "g",
      handler: () => navigate({ to: "/quotations" }),
      description: "Quotations",
      scope: "navigation",
    },
    {
      key: "c",
      leader: "g",
      handler: () => navigate({ to: "/credit-notes" }),
      description: "Credit Notes",
      scope: "navigation",
    },
    {
      key: "p",
      leader: "g",
      handler: () => navigate({ to: "/parties" }),
      description: "Parties",
      scope: "navigation",
    },
    {
      key: "t",
      leader: "g",
      handler: () => navigate({ to: "/items" }),
      description: "Items",
      scope: "navigation",
    },
    {
      key: "m",
      leader: "g",
      handler: () => navigate({ to: "/payments" }),
      description: "Payments",
      scope: "navigation",
    },
    {
      key: "b",
      leader: "g",
      handler: () => navigate({ to: "/cash-and-bank" }),
      description: "Cash & Bank",
      scope: "navigation",
    },
    {
      key: "e",
      leader: "g",
      handler: () => navigate({ to: "/expenses" }),
      description: "Expenses",
      scope: "navigation",
    },
    {
      key: "g",
      leader: "g",
      handler: () => navigate({ to: "/gst" }),
      description: "GST Returns",
      scope: "navigation",
    },
    {
      key: "r",
      leader: "g",
      handler: () => navigate({ to: "/reports" }),
      description: "Business Reports",
      scope: "navigation",
    },
    {
      key: "s",
      leader: "g",
      handler: () => navigate({ to: "/settings" }),
      description: "Settings",
      scope: "navigation",
    },

    // ── Aliases: Alt+Shift+Key ──
    {
      key: "d",
      alt: true,
      shift: true,
      handler: () => navigate({ to: "/" }),
      description: "Dashboard",
      scope: "navigation",
    },
    {
      key: "i",
      alt: true,
      shift: true,
      handler: () => navigate({ to: "/invoices" }),
      description: "Invoices",
      scope: "navigation",
    },
    {
      key: "q",
      alt: true,
      shift: true,
      handler: () => navigate({ to: "/quotations" }),
      description: "Quotations",
      scope: "navigation",
    },
    {
      key: "c",
      alt: true,
      shift: true,
      handler: () => navigate({ to: "/credit-notes" }),
      description: "Credit Notes",
      scope: "navigation",
    },
    {
      key: "p",
      alt: true,
      shift: true,
      handler: () => navigate({ to: "/parties" }),
      description: "Parties",
      scope: "navigation",
    },
    {
      key: "t",
      alt: true,
      shift: true,
      handler: () => navigate({ to: "/items" }),
      description: "Items",
      scope: "navigation",
    },
    {
      key: "m",
      alt: true,
      shift: true,
      handler: () => navigate({ to: "/payments" }),
      description: "Payments",
      scope: "navigation",
    },
    {
      key: "b",
      alt: true,
      shift: true,
      handler: () => navigate({ to: "/cash-and-bank" }),
      description: "Cash & Bank",
      scope: "navigation",
    },
    {
      key: "e",
      alt: true,
      shift: true,
      handler: () => navigate({ to: "/expenses" }),
      description: "Expenses",
      scope: "navigation",
    },
    {
      key: "g",
      alt: true,
      shift: true,
      handler: () => navigate({ to: "/gst" }),
      description: "GST Returns",
      scope: "navigation",
    },
    {
      key: "r",
      alt: true,
      shift: true,
      handler: () => navigate({ to: "/reports" }),
      description: "Business Reports",
      scope: "navigation",
    },
    {
      key: "s",
      alt: true,
      shift: true,
      handler: () => navigate({ to: "/settings" }),
      description: "Settings",
      scope: "navigation",
    },
  ]);

  // Set business ID when businesses load. Auto-select only when there is a
  // single business; if the user has multiple businesses, show a picker first.
  useEffect(() => {
    if (
      businesses &&
      businesses.length > 0 &&
      currentBusinessId &&
      !businesses.some((b) => b.id === currentBusinessId)
    ) {
      setCurrentBusinessId(null);
      sessionStorage.removeItem("selectedBusinessId");
    }
  }, [businesses, currentBusinessId]);

  useEffect(() => {
    if (currentBusinessId) {
      sessionStorage.setItem("selectedBusinessId", currentBusinessId);
    }
  }, [currentBusinessId]);

  const selectedTenantPlan = session?.tenantId
    ? (tenantList?.find((tenant) => tenant.tenantId === session.tenantId)
      ?.tenantPlan ?? null)
    : null;

  const hasCompletedPlanSelection =
    selectedTenantPlan !== null && selectedTenantPlan !== undefined;

  // Single consolidated redirect — priority order matters
  const publicPaths = AUTH_PUBLIC_PATHS;
  // Logged-out visitors to "/" on the web see the public landing page; the
  // desktop app has no marketing page and goes straight to login.
  const showsLandingPage = pathname === "/" && !isDesktop();
  // Marketing pages (/pricing, /about, …) are public for everyone, signed in
  // or not, and render outside the app shell.
  const showsMarketingPage = isMarketingPath(pathname) && !isDesktop();

  useEffect(() => {
    if (showsMarketingPage) return;
    if (sessionLoading || sessionFetching) return;
    if (sessionUnknown) return;

    // Priority 1: Not authenticated → login
    // (the web root shows the public landing page instead).
    if (!session?.user) {
      if (showsLandingPage) return;
      if (!publicPaths.some((p) => pathname.startsWith(p))) {
        navigate({ to: "/login" });
      }
      return;
    }

    // Priority 2: No name → complete profile
    if ((session as any)?.needsProfile) {
      if (pathname !== "/auth/complete-profile") {
        navigate({ to: "/auth/complete-profile" });
      }
      return;
    }

    // Already signed in: the login and register pages have nothing to do.
    if (pathname === "/login" || pathname === "/register") {
      navigate({ to: "/", replace: true });
      return;
    }

    // Priority 2.5: Pending invite token in localStorage → accept it
    // This handles the case where an existing user (has name) clicked an
    // invite link, was redirected to login, and is now back. The invite
    // page stored the token before redirecting; we pick it up here.
    if (!session.tenantId) {
      const pendingToken = sessionStorage.getItem("pendingInviteToken");
      if (pendingToken && !pathname.startsWith("/invite")) {
        navigate({ to: `/invite/${pendingToken}` });
        return;
      }
    }

    // Plan is tenant-level.
    // DB is the single source of truth.
    const planGateAllowed = [
      "/auth/plan-selection",
      "/onboarding",
      "/business/create",
      "/login",
      "/register",
      "/auth/verify",
    ].some((p) => pathname.startsWith(p));

    if (
      session?.tenantId &&
      !tenantListLoading &&
      !tenantListFetching &&
      !hasCompletedPlanSelection &&
      !planGateAllowed
    ) {
      navigate({ to: "/auth/plan-selection" });
      return;
    }

    // Company selection happens only after the tenant has a plan.
    const needsCompanySelection =
      session?.tenantId &&
      Array.isArray(businesses) &&
      businesses.length > 0 &&
      !currentBusinessId;

    if (needsCompanySelection && !pathname.startsWith("/auth/")) {
      return;
    }

    // Priority 4: Authenticated with name but no business → settings
    // Guard: only redirect AFTER businesses query has completed its initial load.
    // businessesLoading is true when the query is enabled but has no data yet.
    // This prevents redirecting to /settings before we know if businesses exist.
    if (
      session?.tenantId &&
      !businessesLoading &&
      !businessesFetching &&
      Array.isArray(businesses) &&
      businesses.length === 0
    ) {
      if (
        pathname !== "/onboarding" &&
        !pathname.startsWith("/auth/plan-selection") &&
        !pathname.startsWith("/business/create")
      ) {
        navigate({ to: "/onboarding" });
      }
      return;
    }

    // Priority 5: On dashboard but role can't access it → first accessible page
    if (
      pathname === "/" &&
      session?.role &&
      !canAccess(session.role, "Report", "read")
    ) {
      navigate({ to: "/invoices" });
      return;
    }
  }, [
    sessionLoading,
    sessionFetching,
    sessionUnknown,
    session,
    businesses,
    navigate,
    pathname,
    currentBusinessId,
    tenantList,
    tenantListLoading,
    tenantListFetching,
    hasCompletedPlanSelection,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select single tenant
  const shouldAutoSelectTenant = !!(
    session?.user &&
    !session?.tenantId &&
    tenantList?.length === 1 &&
    !selectTenantMutation.isPending &&
    !selectTenantMutation.isSuccess
  );
  useEffect(() => {
    if (shouldAutoSelectTenant && tenantList) {
      selectTenantMutation.mutate({ tenantId: tenantList[0].tenantId });
    }
  }, [shouldAutoSelectTenant]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render logic (NO early returns before here — all hooks are above) ──

  const loadingSpinner = (
    <div className="min-h-screen flex items-center justify-center bg-surface-0">
      <div className="flex flex-col items-center gap-3">
        <Logo className="w-10 h-10" />
        <Spinner size="md" className="text-brand-600" />
      </div>
    </div>
  );

  if (showsMarketingPage) return <Outlet />;

  // Loading session. Sign-in pages don't need the answer to render; if the
  // visitor turns out to be signed in, the effect above moves them on.
  if (sessionLoading) {
    return publicPaths.some((p) => pathname.startsWith(p)) ? <Outlet /> : loadingSpinner;
  }

  // Couldn't check the session (server unreachable): offer a retry instead
  // of pretending the visitor is signed out.
  if (sessionUnknown) {
    if (showsLandingPage) return <LandingPage />;
    if (publicPaths.some((p) => pathname.startsWith(p))) return <Outlet />;
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-0 px-4">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <Logo className="w-10 h-10" />
          <p className="text-base font-semibold text-text-primary">We couldn't reach Fintranzact</p>
          <p className="text-sm text-text-tertiary">Check your internet connection and try again.</p>
          <button type="button" className="btn-primary mt-2" onClick={() => refetchSession()} disabled={sessionFetching}>
            {sessionFetching ? "Retrying…" : "Try again"}
          </button>
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!session?.user) {
    if (showsLandingPage) return <LandingPage />;
    const isPublic = publicPaths.some((p) => pathname.startsWith(p));
    if (!isPublic) return null; // redirect in flight
    return <Outlet />;
  }

  // Authenticated but no tenant selected
  if (!session.tenantId) {
    // Auth flow pages (complete-profile, invite) handle tenant resolution
    // themselves — let them render even with zero memberships.
    const authFlowPaths = ["/auth/complete-profile", "/invite"];
    const isAuthFlow = authFlowPaths.some((p) => pathname.startsWith(p));
    if (isAuthFlow) return <Outlet />;

    if (!tenantList) return loadingSpinner;

    if (tenantList.length === 0) {
      // If a pending invite token exists, show spinner — the redirect useEffect
      // will navigate to /invite/$token momentarily.
      const hasPendingInvite = !!sessionStorage.getItem("pendingInviteToken");
      if (hasPendingInvite) return loadingSpinner;

      return <NoOrgScreen />;
    }

    if (tenantList.length === 1) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-surface-0">
          <div className="flex flex-col items-center gap-3">
            <Logo className="w-10 h-10" />
            <Spinner size="md" className="text-brand-600" />
          </div>
        </div>
      );
    }

    // Multiple tenants — show picker
    return (
      <TenantPicker
        tenants={tenantList}
        onSelect={(tenantId) => selectTenantMutation.mutate({ tenantId })}
        onCreateNew={
          canCreateOrg
            ? async () => {
              await createOrgMutation.mutateAsync();
              await utils.auth.me.refetch();
              await utils.tenant.list.refetch();
            }
            : undefined
        }
      />
    );
  }

  // Tenant selected but businesses still loading — show spinner, don't render
  // the main layout yet (prevents flash of /settings "Set up your business")
  if (session.tenantId && businessesLoading) return loadingSpinner;

  // Tenant-level routes are independent of business context.
  // They must render without waiting for the business list and
  // must not use the business dashboard shell.
  if (
    pathname.startsWith("/auth/plan-selection") ||
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/business/create")
  ) {
    return <Outlet />;
  }

  // Business-level routes require business context.
  if (session.tenantId && businessesLoading) {
    return loadingSpinner;
  }

  const shouldShowBusinessPicker =
    !!session.tenantId &&
    Array.isArray(businesses) &&
    businesses.length > 0 &&
    !currentBusinessId;

  if (shouldShowBusinessPicker) {
    return (
      <BusinessPicker
        businesses={businesses}
        userName={session.user.name || session.user.email.split("@")[0]}
        role={session.role ?? null}
        tenantName={session.tenantName ?? "Organization"}
        canSwitchTenant={(tenantList?.length ?? 0) > 1 || !!canCreateOrg}
        onSwitchTenant={() => setShowTenantPicker(true)}
        canCreate={!!canCreateBiz && canAccess(session.role, "Business", "manage")}
        onCreate={() => navigate({ to: "/business/create" })}
        onSelect={(id) => {
          setBusinessId(id);
          setCurrentBusinessId(id);
          sessionStorage.setItem("selectedBusinessId", id);
          queryClient.invalidateQueries();
        }}
        onSignOut={() => logoutMutation.mutate()}
        signingOut={logoutMutation.isPending}
        tenantPicker={
          showTenantPicker ? (
            <TenantPicker
              tenants={tenantList ?? []}
              onSelect={(tenantId) => {
                setShowTenantPicker(false);
                selectTenantMutation.mutate({ tenantId });
              }}
              onCreateNew={
                canCreateOrg
                  ? async () => {
                    setShowTenantPicker(false);
                    await createOrgMutation.mutateAsync();
                    await utils.auth.me.refetch();
                    await utils.tenant.list.refetch();
                    await utils.business.list.refetch();
                  }
                  : undefined
              }
              onClose={() => setShowTenantPicker(false)}
            />
          ) : null
        }
      />
    );
  }

  const displayName = session.user.name || session.user.email.split("@")[0];
  const initials = displayName
    .split(" ")
    .map((w: string) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const hasMultipleTenants = (tenantList?.length ?? 0) > 1;
  const tenantName = session.tenantName ?? "Organization";

  function handleBusinessSwitch(id: string) {
    setBusinessId(id);
    setCurrentBusinessId(id);
    sessionStorage.setItem("selectedBusinessId", id);
    queryClient.invalidateQueries();
  }

  const activeBusiness =
    businesses?.find(
      (b) => b.id === (currentBusinessId ?? businesses?.[0]?.id),
    ) ?? businesses?.[0];
  const isGstRegistered =
    activeBusiness?.gstRegistrationType !== "unregistered" ||
    !!activeBusiness?.gstin;

  // No businesses yet — user is in the onboarding flow. Hide the sidebar
  // since nav items are meaningless without a business context.
  const isOnboarding = Array.isArray(businesses) && businesses.length === 0;

  // POS runs in a dedicated fullscreen register surface — no sidebar, no
  // topbar, no chrome of any kind. Every pixel goes to the cashier.
  // Matches the approach taken by Square / Lightspeed / Vyapaar POS where
  // the register is a station, not a page.
  const isPosMode = pathname === "/pos" || pathname.startsWith("/pos/");
  if (isPosMode) {
    return (
      <>
        <MaintenanceBanner />
        <Outlet />
      </>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-surface-0">
      <MaintenanceBanner />
      <div className="flex flex-1 overflow-hidden">
        {/* Mobile sidebar backdrop */}
        {!isOnboarding && sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Sidebar — hidden during onboarding (no business context yet) */}
        {!isOnboarding && (
          <aside
            className={cn(
              // Navy brand sidebar in both themes (light text on #0f1b3d).
              "w-60 shrink-0 border-r border-white/5 flex flex-col overflow-hidden bg-[#0f1b3d] text-[#c3cee6] dark:border-white/10",
              // On mobile: fixed drawer that slides in/out
              "fixed inset-y-0 left-0 z-50 transition-transform duration-200 md:relative md:translate-x-0",
              // Desktop only: collapse to an icon rail. The drawer keeps its
              // full width on mobile, where there is no room for a rail.
              "md:transition-[width] md:duration-200",
              navCollapsed ? "md:w-[64px]" : "md:w-60",
              sidebarOpen ? "translate-x-0" : "-translate-x-full",
            )}
          >
            {/* Brand + rail toggle. Collapsed, the two stack so neither needs
                absolute positioning inside the scroll container. */}
            <div
              className={cn(
                "py-4 shrink-0 flex gap-2",
                navCollapsed
                  ? "px-4 justify-between md:px-0 md:flex-col md:items-center md:gap-3"
                  : "px-4 items-center justify-between",
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Logo variant="light" className="w-8 h-8 shrink-0" />
                <span
                  className={cn(
                    "font-display font-extrabold text-[17px] tracking-tight text-white truncate",
                    navCollapsed && "md:hidden",
                  )}
                >
                  Fintranzact
                </span>
              </div>

              {/* Desktop only — the mobile drawer closes by tapping the backdrop */}
              <Tooltip label="Expand sidebar" disabled={!navCollapsed}>
                <button
                  type="button"
                  onClick={() => setNavCollapsed((v) => !v)}
                  className={cn(
                    "hidden md:flex items-center justify-center w-7 h-7 rounded-lg shrink-0",
                    "text-[#9fb0d6] hover:text-white hover:bg-white/10 transition-colors",
                  )}
                  aria-label={navCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                  aria-expanded={!navCollapsed}
                >
                  <Icon
                    icon={navCollapsed ? PanelLeftOpenIcon : PanelLeftCloseIcon}
                    size={16}
                  />
                </button>
              </Tooltip>
            </div>

            {/* Business switcher — the company this workspace is showing */}
            {businesses && businesses.length > 0 && (
              <div className={cn("shrink-0 pb-2", navCollapsed ? "px-3 md:px-2" : "px-3")}>
                <div className={cn(navCollapsed && "md:hidden")}>
                  <BusinessSwitcher
                    variant="sidebar"
                    businesses={businesses.map((b) => ({ id: b.id, name: b.name }))}
                    activeBusinessId={currentBusinessId ?? businesses[0].id}
                    subtitle={
                      activeBusiness?.gstin
                        ? `GSTIN ${activeBusiness.gstin}`
                        : activeBusiness?.city || "Not GST registered"
                    }
                    onSwitch={handleBusinessSwitch}
                    onCreateNew={
                      canCreateBiz && canAccess(session?.role, "Business", "manage")
                        ? () => navigate({ to: "/business/create" })
                        : undefined
                    }
                  />
                </div>
                {/* Collapsed rail: the tile expands the sidebar to switch */}
                {navCollapsed && (
                  <Tooltip label={activeBusiness?.name ?? "Business"}>
                    <button
                      type="button"
                      onClick={() => setNavCollapsed(false)}
                      className="mx-auto hidden h-9 w-9 place-items-center rounded-[9px] bg-brand-600 text-[13px] font-extrabold text-white md:grid"
                      aria-label={`Business: ${activeBusiness?.name ?? ""}. Expand sidebar to switch`}
                    >
                      {(activeBusiness?.name ?? "B").charAt(0).toUpperCase()}
                    </button>
                  </Tooltip>
                )}
              </div>
            )}

            {/* Nav sections */}
            <nav
              className="flex-1 overflow-y-auto pb-2"
              onClick={() => setSidebarOpen(false)}
            >
              {navSections.map((section) => {
                const visibleItems = section.items
                  .filter(
                    (item) =>
                      canAccess(session?.role, item.resource, item.action) &&
                      (!("gstOnly" in item && item.gstOnly) || isGstRegistered),
                  )
                  .map((item) => {
                    // Rename reports label based on GST status (always visible)
                    if (item.to === "/gst") {
                      return {
                        ...item,
                        label: isGstRegistered ? "GST Returns" : "Tax Reports",
                      };
                    }
                    if (item.to === "/reports") {
                      return { ...item, label: "Business Reports" };
                    }
                    return item;
                  });
                if (visibleItems.length === 0) return null;
                const sectionLabel = section.label;
                // Collapsed, the rail is too narrow for a text heading, so
                // groups read as a hairline rule instead of disappearing.
                const base = cn(
                  "flex items-center rounded-[9px] text-[13.5px] transition-colors",
                  navCollapsed
                    ? "mx-2 px-0 py-2 md:justify-center gap-2.5 md:gap-0"
                    : "mx-2 px-3 py-[7px] gap-2.5",
                );

                // A collapsed rail has no room for headings or disclosure
                // arrows, so there the group is just a rule and every item
                // stays reachable.
                const isRail = navCollapsed;
                const closed = !isRail && !!closedSections[section.label];
                const panelId = `nav-section-${section.label.toLowerCase()}`;

                return (
                  <div key={section.label}>
                    {isRail ? (
                      <div
                        className="mx-3 my-2 border-t border-white/10 md:block hidden"
                        role="separator"
                        aria-label={sectionLabel}
                      />
                    ) : null}

                    <button
                      type="button"
                      onClick={(e) => {
                        // The <nav> closes the mobile drawer on click; opening
                        // a group is navigation *within* the menu, not a
                        // destination, so it must not dismiss it.
                        e.stopPropagation();
                        toggleSection(section.label);
                      }}
                      aria-expanded={!closed}
                      aria-controls={panelId}
                      className={cn(
                        "w-full flex items-center justify-between gap-2 px-3 pt-5 pb-1.5",
                        "text-[10px] font-bold uppercase tracking-widest text-[#7f90b5]",
                        "hover:text-[#c3cee6] transition-colors",
                        isRail && "md:hidden",
                      )}
                    >
                      <span className="truncate">{sectionLabel}</span>
                      <Icon
                        icon={ArrowDown01Icon}
                        size={12}
                        className={cn(
                          "shrink-0 transition-transform duration-150",
                          closed && "-rotate-90",
                        )}
                      />
                    </button>

                    <div id={panelId} hidden={closed}>
                    {visibleItems.map((item) => (
                      <Tooltip
                        key={item.to}
                        label={item.label}
                        disabled={!navCollapsed}
                      >
                        <Link
                          to={item.to}
                          className={base}
                          activeProps={{
                            className: cn(
                              base,
                              "bg-brand-600 text-white font-semibold shadow-[0_4px_12px_-6px_rgba(59,94,170,.9)]",
                            ),
                          }}
                          inactiveProps={{
                            className: cn(
                              base,
                              "text-[#c3cee6] hover:bg-white/[.07] hover:text-white",
                            ),
                          }}
                          activeOptions={{
                            exact:
                              "exact" in item ? (item.exact as boolean) : false,
                          }}
                        >
                          <Icon icon={item.icon} size={16} className="shrink-0" />
                          <span className={cn("truncate", navCollapsed && "md:hidden")}>
                            {item.label}
                          </span>
                        </Link>
                      </Tooltip>
                    ))}
                    </div>
                  </div>
                );
              })}
            </nav>

            {/* Sidebar footer: settings, then the signed-in user */}
            <div className="shrink-0 border-t border-white/10 px-2 py-2">
              <Tooltip label="Settings" disabled={!navCollapsed}>
                <Link
                  to="/settings"
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-[9px] py-2 text-[13.5px] transition-colors",
                    navCollapsed ? "px-3 md:justify-center md:px-0" : "px-3",
                  )}
                  activeProps={{ className: "bg-brand-600 text-white font-semibold" }}
                  inactiveProps={{ className: "text-[#c3cee6] hover:bg-white/[.07] hover:text-white" }}
                >
                  <Icon icon={Settings01Icon} size={16} className="shrink-0" />
                  <span className={cn(navCollapsed && "md:hidden")}>Settings</span>
                </Link>
              </Tooltip>

              <div
                className={cn(
                  "mt-1 flex items-center gap-2.5 rounded-[9px] px-2 py-2",
                  navCollapsed && "md:flex-col md:px-0",
                )}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#243c77] text-[11px] font-bold text-white">
                  {initials}
                </span>
                <div className={cn("min-w-0 flex-1", navCollapsed && "md:hidden")}>
                  <p className="truncate text-[13px] font-semibold text-white">{displayName}</p>
                  {hasMultipleTenants || canCreateOrg ? (
                    <button
                      type="button"
                      onClick={() => setShowTenantPicker(true)}
                      className="flex max-w-full items-center gap-1 text-[11px] text-[#9fb0d6] hover:text-white"
                      aria-label={`Switch organization — currently ${tenantName}`}
                    >
                      <span className="truncate">
                        {session.role ? `${formatRole(session.role)} · ` : ""}
                        {tenantName}
                      </span>
                      <Icon icon={UnfoldMoreIcon} size={11} className="shrink-0" />
                    </button>
                  ) : (
                    <p className="truncate text-[11px] text-[#9fb0d6]">
                      {session.role ? `${formatRole(session.role)} · ` : ""}
                      {tenantName}
                    </p>
                  )}
                </div>
                <Tooltip label="Sign out">
                  <button
                    type="button"
                    onClick={() => logoutMutation.mutate()}
                    disabled={logoutMutation.isPending}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#9fb0d6] transition-colors hover:bg-white/10 hover:text-white"
                    aria-label="Sign out"
                  >
                    <Icon icon={Logout01Icon} size={15} />
                  </button>
                </Tooltip>
              </div>
              <p className={cn("px-2 text-[10px] tabular-nums text-[#7f90b5]", navCollapsed && "md:text-center md:px-0")}>
                v{__APP_VERSION__}
              </p>
            </div>
          </aside>
        )}

        {/* Main content */}
        <main className="flex-1 min-w-0 flex flex-col bg-surface-1 md:ml-0">
          {/* Top bar */}
          <div className="h-16 border-b border-border-light flex items-center gap-2 px-4 md:px-6 shrink-0 bg-surface-0">
            {/* Hamburger — mobile only, hidden during onboarding */}
            {!isOnboarding && (
              <button
                type="button"
                className="md:hidden flex items-center justify-center w-8 h-8 rounded-lg text-text-secondary hover:bg-surface-1 transition-colors shrink-0"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open navigation menu"
              >
                <Icon icon={Menu01Icon} size={18} />
              </button>
            )}

            {/* Logo in top bar during onboarding (sidebar is hidden) */}
            {isOnboarding && (
              <div className="flex items-center gap-2.5 mr-2">
                <Logo className="w-7 h-7" />
                <span className="font-semibold text-[15px] tracking-tight text-text-primary">
                  Fintranzact
                </span>
              </div>
            )}

            {/* Search — opens the command palette (also ⌘K / Ctrl+K) */}
            {!isOnboarding && (
              <button
                type="button"
                onClick={() => setShowPalette(true)}
                className="flex h-10 min-w-0 items-center gap-2.5 rounded-xl border border-border-light bg-surface-1 px-3 text-sm text-text-tertiary transition-colors hover:border-border-color sm:w-72 lg:w-96"
                aria-label="Search and jump to"
              >
                <Icon icon={Search01Icon} size={17} className="shrink-0" />
                <span className="hidden flex-1 truncate text-left sm:block">Search or jump to…</span>
                <kbd className="hidden rounded-md border border-border-light px-1.5 py-0.5 font-sans text-[11px] font-semibold sm:block">
                  ⌘K
                </kbd>
              </button>
            )}

            {/* Shortcuts */}
            <button
              onClick={() => setShowShortcuts(true)}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-sm text-text-tertiary hover:bg-surface-1 transition-colors border border-border-light shrink-0"
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
            >
              <span className="font-mono text-xs">?</span>
            </button>

            <div className="ml-auto flex items-center gap-2 sm:gap-3 min-w-0">
              {!isOnboarding && (
                <NotificationsBell
                  businessId={currentBusinessId ?? businesses?.[0]?.id ?? null}
                  canSeeInvoices={canAccess(session?.role, "Invoice", "read")}
                  canSeeItems={canAccess(session?.role, "Item", "read")}
                  isGstRegistered={isGstRegistered}
                />
              )}
              {!isOnboarding && canAccess(session?.role, "Invoice", "create") && (
                <Link
                  to="/invoices"
                  search={{ create: "1" }}
                  className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-brand-600 px-3 text-sm font-bold text-white shadow-[0_8px_18px_-8px_rgba(59,94,170,.7)] transition hover:bg-brand-700 sm:px-4"
                  aria-label="New invoice"
                >
                  <Icon icon={Add01Icon} size={16} strokeWidth={2.2} />
                  <span className="hidden sm:inline">New invoice</span>
                </Link>
              )}

              {/* No sidebar during onboarding, so the account controls live here */}
              {isOnboarding && (
                <>
                  <span className="hidden sm:block text-sm font-medium text-text-primary truncate max-w-[160px]">
                    {displayName}
                  </span>
                  <button
                    onClick={() => logoutMutation.mutate()}
                    disabled={logoutMutation.isPending}
                    className="flex items-center justify-center w-8 h-8 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-surface-1 transition-colors border border-border-light shrink-0"
                    aria-label="Sign out"
                    title="Sign out"
                  >
                    <Icon icon={Logout01Icon} size={14} />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-[1400px] mx-auto px-6 py-6">
              <Outlet />
            </div>
          </div>
        </main>

        <CommandPalette
          open={showPalette}
          onClose={() => setShowPalette(false)}
        />
        <ShortcutsDialog
          open={showShortcuts}
          onClose={() => setShowShortcuts(false)}
        />
        <ShortcutIndicator />

        {/* Tenant picker overlay — shown when user clicks the tenant name */}
        {showTenantPicker && (
          <TenantPicker
            tenants={tenantList ?? []}
            onSelect={(tenantId) => {
              setShowTenantPicker(false);
              selectTenantMutation.mutate({ tenantId });
            }}
            onCreateNew={
              canCreateOrg
                ? async () => {
                  setShowTenantPicker(false);
                  await createOrgMutation.mutateAsync();
                  await utils.auth.me.refetch();
                  await utils.tenant.list.refetch();
                  await utils.business.list.refetch();
                }
                : undefined
            }
            onClose={() => setShowTenantPicker(false)}
          />
        )}
      </div>
    </div>
  );
}

// ── Business picker ───────────────────────────────────────────

type PickerBusiness = {
  id: string;
  name: string;
  gstin?: string | null;
  gstRegistrationType?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  email?: string | null;
};

const REGISTRATION_LABELS: Record<string, string> = {
  regular: "Regular taxpayer",
  composition: "Composition scheme",
  unregistered: "Unregistered",
  sez: "SEZ unit",
  casual: "Casual taxpayer",
};

const TILE_TONES = [
  "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300",
  "bg-orange-50 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
];

function businessInitials(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => /[A-Za-z0-9]/.test(w[0] ?? ""))
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/** Full-page "Choose a company" screen shown when no business is selected. */
function BusinessPicker({
  businesses,
  userName,
  role,
  tenantName,
  canSwitchTenant,
  onSwitchTenant,
  canCreate,
  onCreate,
  onSelect,
  onSignOut,
  signingOut,
  tenantPicker,
}: {
  businesses: PickerBusiness[];
  userName: string;
  role: string | null;
  tenantName: string;
  canSwitchTenant: boolean;
  onSwitchTenant: () => void;
  canCreate: boolean;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onSignOut: () => void;
  signingOut: boolean;
  tenantPicker: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = businesses.filter(
    (b) => !q || [b.name, b.gstin, b.city, b.state].filter(Boolean).join(" ").toLowerCase().includes(q),
  );
  const firstName = userName.trim().split(/\s+/)[0];
  const userInitials = businessInitials(userName) || "U";

  return (
    <div className="min-h-screen bg-surface-1">
      <header className="bg-[#0f1b3d] text-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 md:px-8">
          <Logo variant="light" className="h-8 w-8 shrink-0" />
          <span className="hidden font-display text-lg font-extrabold sm:block">Fintranzact</span>
          {canSwitchTenant ? (
            <button
              type="button"
              onClick={onSwitchTenant}
              className="ml-2 flex h-9 min-w-0 items-center gap-2 rounded-[10px] border border-white/15 bg-white/5 px-3 text-[13.5px] font-semibold transition hover:bg-white/10 sm:ml-4"
              aria-label={`Switch organization — currently ${tenantName}`}
            >
              <span className="hidden font-medium text-[#9fb0d6] md:inline">Organization</span>
              <span className="truncate">{tenantName}</span>
              <Icon icon={UnfoldMoreIcon} size={14} className="shrink-0" />
            </button>
          ) : (
            <span className="ml-2 truncate text-[13.5px] font-semibold text-[#c3cee6] sm:ml-4">{tenantName}</span>
          )}
          <div className="ml-auto flex items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold">
              {userInitials}
            </span>
            <span className="hidden leading-tight sm:block">
              <span className="block text-[13.5px] font-semibold">{userName}</span>
              {role && <span className="block text-[11.5px] text-[#9fb0d6]">{formatRole(role)}</span>}
            </span>
            <button
              type="button"
              onClick={onSignOut}
              disabled={signingOut}
              className="flex h-9 items-center gap-1.5 rounded-[9px] border border-white/15 px-3 text-[13px] font-semibold text-[#c3cee6] transition hover:bg-white/10 hover:text-white disabled:opacity-60"
            >
              <Icon icon={Logout01Icon} size={15} />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10 md:px-8 md:py-12">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[13px] font-bold uppercase tracking-[0.14em] text-brand-600 dark:text-brand-300">
              Welcome back{firstName ? `, ${firstName}` : ""}
            </p>
            <h1 className="mt-2 font-display text-3xl font-extrabold tracking-[-0.025em] text-[#0f1b3d] dark:text-white md:text-[34px]">
              Choose a company
            </h1>
            <p className="mt-1.5 text-[15px] text-text-tertiary">
              {businesses.length} {businesses.length === 1 ? "company" : "companies"} in {tenantName}. Pick one to open its books.
            </p>
          </div>
          {businesses.length > 3 && (
            <label className="flex h-11 w-full items-center gap-2.5 rounded-xl border border-border-color bg-surface-0 px-3.5 text-text-tertiary focus-within:border-brand-500 focus-within:ring-[3px] focus-within:ring-brand-500/20 md:w-[340px]">
              <Icon icon={Search01Icon} size={18} className="shrink-0" />
              <span className="sr-only">Search companies</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, GSTIN or city"
                className="h-full min-w-0 flex-1 bg-transparent text-[14.5px] text-text-primary outline-none placeholder:text-text-tertiary"
              />
            </label>
          )}
        </div>

        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((b) => {
            const gst = b.gstRegistrationType !== "unregistered" && !!b.gstin;
            const place = [b.city, b.state].filter(Boolean).join(", ") || "Location not set";
            const contact = b.phone || b.email || "No contact details yet";
            const tone = TILE_TONES[businesses.indexOf(b) % TILE_TONES.length];
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => onSelect(b.id)}
                aria-label={`Open ${b.name}`}
                className="group flex min-w-0 flex-col gap-4 rounded-[18px] border border-border-light bg-surface-0 p-5 text-left transition hover:-translate-y-0.5 hover:border-brand-500 hover:shadow-[0_18px_36px_-22px_rgba(15,27,61,.45)] focus-visible:border-brand-500"
              >
                <div className="flex items-center gap-3.5">
                  <span className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-[14px] font-display text-base font-extrabold", tone)}>
                    {businessInitials(b.name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[17px] font-bold text-text-primary">{b.name}</span>
                    <span
                      className={cn(
                        "mt-1 inline-flex rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold",
                        gst
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                          : "bg-surface-2 text-text-secondary",
                      )}
                    >
                      {gst ? "GST registered" : "Not GST registered"}
                    </span>
                  </span>
                </div>
                <div className="space-y-2 text-[13.5px] text-text-secondary">
                  <p className="flex items-center gap-2">
                    <Icon icon={File01Icon} size={16} className="shrink-0 text-text-tertiary" />
                    <span className="truncate">{b.gstin ? `GSTIN ${b.gstin}` : "No GSTIN"}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <Icon icon={Location01Icon} size={16} className="shrink-0 text-text-tertiary" />
                    <span className="truncate">{place}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <Icon icon={Call02Icon} size={16} className="shrink-0 text-text-tertiary" />
                    <span className="truncate">{contact}</span>
                  </p>
                </div>
                <span className="mt-auto flex items-center justify-between border-t border-border-light pt-3.5">
                  <span className="text-[12.5px] text-text-tertiary">
                    {REGISTRATION_LABELS[b.gstRegistrationType ?? ""] ?? (gst ? "GST registered" : "Unregistered")}
                  </span>
                  <span className="inline-flex h-8 items-center rounded-[9px] bg-brand-50 px-3.5 text-[13.5px] font-bold text-brand-700 transition group-hover:bg-brand-600 group-hover:text-white dark:bg-brand-950 dark:text-brand-300">
                    Open →
                  </span>
                </span>
              </button>
            );
          })}

          {canCreate && !q && (
            <button
              type="button"
              onClick={onCreate}
              className="flex min-h-[232px] flex-col items-center justify-center gap-2.5 rounded-[18px] border-[1.5px] border-dashed border-border-color p-5 text-center text-text-secondary transition hover:border-brand-500 hover:text-brand-700"
            >
              <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
                <Icon icon={PlusSignIcon} size={22} />
              </span>
              <span className="text-base font-bold text-text-primary">Add a business</span>
              <span className="text-[13px] text-text-tertiary">Another GSTIN, branch or company</span>
            </button>
          )}
        </div>

        {visible.length === 0 && (
          <p className="mt-6 text-sm text-text-tertiary">No company matches “{query}”.</p>
        )}
      </main>
      {tenantPicker}
    </div>
  );
}

// ── Keyboard Shortcuts Dialog ──────────────────────────────────

function ShortcutsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const hotkeys = open ? getRegisteredHotkeys() : [];

  // Group by scope
  const grouped: Record<string, typeof hotkeys> = {};
  for (const h of hotkeys) {
    const scope = h.scope || "general";
    if (!grouped[scope]) grouped[scope] = [];
    grouped[scope].push(h);
  }

  // Deduplicate by description (some shortcuts register twice across re-renders)
  for (const scope of Object.keys(grouped)) {
    const seen = new Set<string>();
    grouped[scope] = grouped[scope].filter((h) => {
      if (seen.has(h.description)) return false;
      seen.add(h.description);
      return true;
    });
  }

  function formatKey(h: (typeof hotkeys)[0]): string[] {
    const keys: string[] = [];
    // A sequence reads "G then D", not a simultaneous chord.
    if (h.leader) keys.push(h.leader.toUpperCase(), "then");
    if (h.ctrl) keys.push("⌘");
    if (h.alt) keys.push("Alt");
    if (h.shift) keys.push("⇧");
    keys.push(h.key.length === 1 ? h.key.toUpperCase() : h.key);
    return keys;
  }

  const scopeLabels: Record<string, string> = {
    global: "Global",
    navigation: "Navigation (press G, then the key)",
    parties: "Parties",
    items: "Items",
    payments: "Payments",
    invoices: "Invoices",
    expenses: "Expenses",
    general: "General",
  };

  // Sort scopes: global first, navigation second, then page-specific
  const scopeOrder = [
    "global",
    "navigation",
    "parties",
    "items",
    "payments",
    "invoices",
    "expenses",
    "general",
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Keyboard Shortcuts"
      className="max-w-md"
    >
      <div className="space-y-4">
        {scopeOrder
          .filter((s) => grouped[s]?.length)
          .map((scope) => ({ scope, defs: grouped[scope] }))
          .concat(
            Object.entries(grouped)
              .filter(([s]) => !scopeOrder.includes(s))
              .map(([scope, defs]) => ({ scope, defs })),
          )
          .map(({ scope, defs }) => (
            <div key={scope}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">
                {scopeLabels[scope] || scope}
              </p>
              <div className="space-y-0.5">
                {defs.map((h) => (
                  <div
                    key={h.description}
                    className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-surface-1"
                  >
                    <span className="text-sm text-text-secondary">
                      {h.description}
                    </span>
                    <KbdShortcut keys={formatKey(h)} />
                  </div>
                ))}
              </div>
            </div>
          ))}
      </div>
    </Modal>
  );
}
