import {
  createRootRoute,
  Link,
  Outlet,
  useNavigate,
  useLocation,
} from "@tanstack/react-router";
import React, { useState, useEffect } from "react";
import { trpc, setBusinessId, queryClient } from "@/lib/trpc";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useTheme } from "@/hooks/useTheme";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { KbdShortcut } from "@/components/ui/KbdShortcut";
import { ShortcutIndicator } from "@/components/ui/ShortcutIndicator";
import { Modal } from "@/components/ui/Modal";
import { BusinessSwitcher } from "@/components/ui/BusinessSwitcher";
import { Logo } from "@/components/ui/Logo";
import { Icon } from "@/components/ui/Icon";
import {
  Add01Icon,
  Alert02Icon,
  BankIcon,
  ChartLineData01Icon,
  ComputerIcon,
  CreditCardIcon,
  DashboardSquare01Icon,
  DeliveryTruck01Icon,
  FileEditIcon,
  FileSyncIcon,
  FileValidationIcon,
  Invoice01Icon,
  Logout01Icon,
  Menu01Icon,
  Moon02Icon,
  NoteRemoveIcon,
  PackageIcon,
  ReceiptDollarIcon,
  ReturnRequestIcon,
  Settings01Icon,
  ShippingTruck01Icon,
  ShoppingCart01Icon,
  Sun03Icon,
  TaxesIcon,
  UnfoldMoreIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { getRegisteredHotkeys } from "@/hooks/useHotkeys";
import { cn } from "@/lib/utils";
import { formatRole } from "@/lib/roles";
import { MaintenanceBanner } from "@/components/MaintenanceBanner";
import { LandingPage } from "@/components/LandingPage";
import { isMarketingPath } from "@/components/marketing/MarketingLayout";
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

// ── Sidebar nav structure ──────────────────────────────────────

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
    label: "SALES",
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
        to: "/delivery-challans",
        label: "Delivery Challans",
        icon: DeliveryTruck01Icon,
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
    label: "CONTACTS",
    items: [
      {
        to: "/parties",
        label: "Parties",
        icon: UserIcon,
        resource: "Party",
        action: "read",
      },
    ],
  },
  {
    label: "INVENTORY",
    items: [
      {
        to: "/items",
        label: "Items",
        icon: PackageIcon,
        resource: "Item",
        action: "read",
      },
    ],
  },
  {
    label: "MONEY",
    items: [
      {
        to: "/payments",
        label: "Payments",
        icon: CreditCardIcon,
        resource: "Payment",
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
        to: "/expenses",
        label: "Expenses",
        icon: ReceiptDollarIcon,
        resource: "Expense",
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
    label: "COMPLIANCE",
    items: [
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
        icon: ChartLineData01Icon,
        resource: "GstReport",
        action: "read",
        gstOnly: true,
      },
      {
        to: "/itc",
        label: "Input Tax Credit",
        icon: ChartLineData01Icon,
        resource: "ITC",
        action: "read",
        gstOnly: true,
      },
      {
        to: "/eway-bills",
        label: "E-Way Bills",
        icon: ChartLineData01Icon,
        resource: "EWayBill",
        action: "read",
        gstOnly: true,
      },
      {
        to: "/reports",
        label: "Reports",
        icon: ChartLineData01Icon,
        resource: "Report",
        action: "read",
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
  } = trpc.auth.me.useQuery();
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
  useTheme();
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
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
    // ── Navigation shortcuts (Alt+Shift+Key) ──
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
  const publicPaths = [
    "/login",
    "/auth/verify",
    "/auth/complete-profile",
    "/auth/verify-email-change",
    "/invite",
  ];
  // Logged-out visitors to "/" on the web see the public landing page; the
  // desktop app has no marketing page and goes straight to login.
  const showsLandingPage = pathname === "/" && !isDesktop();
  // Marketing pages (/pricing, /about, …) are public for everyone, signed in
  // or not, and render outside the app shell.
  const showsMarketingPage = isMarketingPath(pathname) && !isDesktop();

  useEffect(() => {
    if (showsMarketingPage) return;
    if (sessionLoading || sessionFetching) return;

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

  // Loading session
  if (sessionLoading) return loadingSpinner;

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
      <div className="min-h-screen bg-surface-1 px-4 py-10 md:px-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex items-center gap-3">
            <Logo className="w-10 h-10" />
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-text-tertiary">
                Welcome back
              </p>
              <h1 className="text-2xl font-semibold text-text-primary">
                Choose a company
              </h1>
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {businesses.map((business) => {
              const initials = business.name
                .split(" ")
                .map((word: string) => word[0])
                .slice(0, 2)
                .join("")
                .toUpperCase();

              return (
                <button
                  key={business.id}
                  type="button"
                  onClick={() => {
                    setBusinessId(business.id);
                    setCurrentBusinessId(business.id);
                    sessionStorage.setItem("selectedBusinessId", business.id);
                    queryClient.invalidateQueries();
                  }}
                  className="group rounded-2xl border border-border-light bg-surface-0 p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-100 text-sm font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                        {initials}
                      </div>
                      <div>
                        <p className="text-base font-semibold text-text-primary">
                          {business.name}
                        </p>
                        <p className="text-xs text-text-tertiary">
                          {business.gstRegistrationType === "unregistered"
                            ? "Unregistered"
                            : "GST enabled"}
                        </p>
                      </div>
                    </div>
                    <span className="rounded-full border border-border-light bg-surface-1 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                      Open
                    </span>
                  </div>

                  <div className="space-y-2 text-sm text-text-secondary">
                    <p>{business.city || "Location not set"}</p>
                    <p>
                      {business.phone ||
                        business.email ||
                        "No contact details yet"}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
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
              "w-56 shrink-0 border-r border-border-light flex flex-col bg-surface-0 overflow-hidden",
              // On mobile: fixed drawer that slides in/out
              "fixed inset-y-0 left-0 z-50 transition-transform duration-200 md:relative md:translate-x-0",
              sidebarOpen ? "translate-x-0" : "-translate-x-full",
            )}
          >
            {/* Logo + Org switcher */}
            <div className="px-4 py-4 shrink-0">
              <div className="flex items-center gap-2.5">
                <Logo className="w-8 h-8" />
                <span className="font-semibold text-[15px] tracking-tight text-text-primary">
                  Fintranzact
                </span>
              </div>
            </div>

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
                const sectionLabel =
                  section.label === "COMPLIANCE" && !isGstRegistered
                    ? "REPORTS"
                    : section.label;
                return (
                  <div key={section.label}>
                    <p className="px-3 pt-5 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                      {sectionLabel}
                    </p>
                    {visibleItems.map((item) => (
                      <Link
                        key={item.to}
                        to={item.to}
                        className="flex items-center gap-2.5 mx-2 px-3 py-[7px] rounded-lg text-[13px] transition-colors"
                        activeProps={{
                          className:
                            "flex items-center gap-2.5 mx-2 px-3 py-[7px] rounded-lg text-[13px] transition-colors bg-brand-600/10 text-brand-700 font-medium",
                        }}
                        inactiveProps={{
                          className:
                            "flex items-center gap-2.5 mx-2 px-3 py-[7px] rounded-lg text-[13px] transition-colors text-text-secondary hover:bg-surface-2 hover:text-text-primary",
                        }}
                        activeOptions={{
                          exact:
                            "exact" in item ? (item.exact as boolean) : false,
                        }}
                      >
                        <Icon icon={item.icon} size={16} />
                        {item.label}
                      </Link>
                    ))}
                  </div>
                );
              })}
            </nav>

            {/* Sidebar footer: org name + version */}
            <div className="shrink-0 border-t border-border-light">
              {hasMultipleTenants ? (
                <button
                  type="button"
                  onClick={() => setShowTenantPicker(true)}
                  className="w-full px-4 py-2.5 text-left group"
                >
                  <p className="flex items-center gap-1.5 text-[11px] font-medium text-text-tertiary/60 group-hover:text-text-secondary transition-colors">
                    <span className="truncate">{tenantName}</span>
                    <Icon
                      icon={UnfoldMoreIcon}
                      size={10}
                      className="text-text-tertiary/40 group-hover:text-text-secondary transition-colors"
                    />
                  </p>
                  <p className="text-[10px] text-text-tertiary/30 mt-0.5 tabular-nums">
                    v{__APP_VERSION__}
                  </p>
                </button>
              ) : (
                <div className="px-4 py-2.5">
                  <p className="text-[11px] text-text-tertiary/50 truncate select-none">
                    {tenantName}
                  </p>
                  <p className="text-[10px] text-text-tertiary/30 mt-0.5 select-none tabular-nums">
                    v{__APP_VERSION__}
                  </p>
                </div>
              )}
            </div>
          </aside>
        )}

        {/* Main content */}
        <main className="flex-1 flex flex-col bg-surface-1 md:ml-0">
          {/* Top bar */}
          <div className="h-14 border-b border-border-light flex items-center gap-2 px-4 md:px-6 shrink-0 bg-surface-0">
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

            {/* Theme + shortcuts */}
            <ThemeToggle />
            <button
              onClick={() => setShowShortcuts(true)}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-sm text-text-tertiary hover:bg-surface-1 transition-colors border border-border-light shrink-0"
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
            >
              <span className="font-mono text-xs">?</span>
            </button>

            {/* Settings gear */}
            <button
              onClick={() => navigate({ to: "/settings" })}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-surface-1 transition-colors border border-border-light shrink-0"
              aria-label="Settings"
              title="Settings"
            >
              <Icon icon={Settings01Icon} size={15} />
            </button>

            {/* Business switcher + User info — pushed to the right */}
            <div className="ml-auto flex items-center gap-3 min-w-0">
              {/* Business switcher */}
              {businesses && businesses.length > 0 && (
                <BusinessSwitcher
                  businesses={businesses.map((b) => ({
                    id: b.id,
                    name: b.name,
                  }))}
                  activeBusinessId={currentBusinessId ?? businesses[0].id}
                  onSwitch={handleBusinessSwitch}
                  onCreateNew={
                    canCreateBiz &&
                      canAccess(session?.role, "Business", "manage")
                      ? () => {
                        navigate({ to: "/business/create" });
                      }
                      : undefined
                  }
                />
              )}

              {/* Avatar + name + role */}
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-full bg-brand-100 dark:bg-brand-900 flex items-center justify-center text-brand-700 dark:text-brand-300 text-[10px] font-semibold shrink-0">
                  {initials}
                </div>
                <span className="hidden sm:block text-sm font-medium text-text-primary truncate max-w-[120px]">
                  {displayName}
                </span>
                {session.role && (
                  <span className="hidden sm:block shrink-0">
                    <RoleBadge role={session.role} />
                  </span>
                )}
              </div>

              {/* Logout */}
              <button
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
                className="flex items-center justify-center w-7 h-7 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-surface-1 transition-colors border border-border-light shrink-0"
                aria-label="Sign out"
                title="Sign out"
              >
                <Icon icon={Logout01Icon} size={14} />
              </button>
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

// ── Theme Toggle ───────────────────────────────────────────────

type Theme = "light" | "dark" | "system";

function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const next: Record<Theme, Theme> = {
    system: "light",
    light: "dark",
    dark: "system",
  };
  const icons: Record<Theme, React.ReactNode> = {
    system: <Icon icon={ComputerIcon} size={16} />,
    light: <Icon icon={Sun03Icon} size={16} />,
    dark: <Icon icon={Moon02Icon} size={16} />,
  };
  const labels: Record<Theme, string> = {
    system: "System theme",
    light: "Light mode",
    dark: "Dark mode",
  };

  return (
    <button
      onClick={() => setTheme(next[theme])}
      className="flex items-center justify-center w-8 h-8 rounded-lg text-text-tertiary hover:bg-surface-1 transition-colors border border-border-light"
      aria-label={labels[theme]}
      title={labels[theme]}
    >
      {icons[theme]}
    </button>
  );
}

// ── Role Badge ────────────────────────────────────────────────

const roleStyles: Record<string, string> = {
  owner: "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300",
  admin:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  member: "bg-surface-2 text-text-secondary",
  seller: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  accountant:
    "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
};

function RoleBadge({ role }: { role: string }) {
  const style = roleStyles[role] ?? "bg-surface-2 text-text-secondary";
  const label = formatRole(role);
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 leading-none",
        style,
      )}
    >
      {label}
    </span>
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
    if (h.ctrl) keys.push("⌘");
    if (h.alt) keys.push("Alt");
    if (h.shift) keys.push("⇧");
    keys.push(h.key.length === 1 ? h.key.toUpperCase() : h.key);
    return keys;
  }

  const scopeLabels: Record<string, string> = {
    global: "Global",
    navigation: "Navigation (Alt+Shift + Key)",
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
