import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { z } from "zod";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { BusinessTab, BusinessForm } from "@/components/settings/BusinessTab";
import { DocumentsTab } from "@/components/settings/DocumentsTab";
import { TeamTab } from "@/components/settings/TeamTab";
import { SalesTargetsTab } from "@/components/settings/SalesTargetsTab";
import { PeriodLocksTab } from "@/components/settings/PeriodLocksTab";
import { DataTab } from "@/components/settings/DataTab";
import { AccountTab } from "@/components/settings/AccountTab";
import { BillingTab } from "@/components/settings/BillingTab";
import { StoreTab } from "@/components/settings/StoreTab";
import { POSTab } from "@/components/settings/POSTab";
import { BarcodesTab } from "@/components/settings/BarcodesTab";
import { ShippingTab } from "@/components/settings/ShippingTab";
import { useTwoFactorRequirement } from "@/hooks/useTwoFactorRequirement";
import { WhatsNextModal } from "@/components/settings/WhatsNextModal";
import { ImportWizard } from "@/components/ImportWizard";
import { RestoreOnboarding } from "@/components/settings/RestoreOnboarding";
import { Icon } from "@/components/ui/Icon";
import { Add01Icon, Upload04Icon } from "@hugeicons/core-free-icons";

export const Route = createFileRoute("/settings")({
  // ?tab=pos opens a section directly, e.g. from the POS "turned off" screen.
  validateSearch: z.object({ tab: z.string().optional(), pane: z.string().optional() }),
  component: SettingsPage,
});

function SettingsPage() {
  const navigate = useNavigate();
  const { tab: linkedTab, pane: linkedPane } = Route.useSearch();
  // A member blocked by the organisation's two-factor policy can only use the
  // Account tab (Security pane), where they set it up.
  const { requirement: twoFactor } = useTwoFactorRequirement();
  const [tab, setTab] = useState(() => linkedTab || sessionStorage.getItem("settings-tab") || "business");
  // A link to ?tab=billing while Settings is already open (banner, toast action).
  useEffect(() => { if (linkedTab) setTab(linkedTab); }, [linkedTab]);
  const handleTabChange = (t: string) => { setTab(t); sessionStorage.setItem("settings-tab", t); };
  // Always refetched on opening Settings: the document counters ("Next #")
  // move with every invoice, payment or order saved elsewhere in the app.
  const { data: businesses, isLoading, isError: businessesFailed } = trpc.business.list.useQuery(undefined, { refetchOnMount: "always" });
  const { data: session } = trpc.auth.me.useQuery();
  const [showWhatsNext, setShowWhatsNext] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [newBizName, setNewBizName] = useState("");
  const [showCreateBusiness, setShowCreateBusiness] = useState(
    () => new URLSearchParams(window.location.search).get("action") === "create-business",
  );
  // "create" = show BusinessForm, "restore" = show RestoreOnboarding
  const [onboardingPath, setOnboardingPath] = useState<"choose" | "create" | "restore">("choose");
  const biz = businesses?.[0];
  const hasRole = ["owner", "admin", "superadmin"].includes(session?.role ?? "");
  const { data: canCreateBizPlan } = trpc.business.canCreate.useQuery(undefined, {
    enabled: !!session?.tenantId && hasRole,
  });
  const canCreateBusiness = hasRole && (canCreateBizPlan ?? true);
  const isOwner = session?.role === "owner" || session?.role === "superadmin";

  // Listen for "create-business" event from BusinessSwitcher (when already on settings)
  useEffect(() => {
    const handler = () => setShowCreateBusiness(true);
    window.addEventListener("create-business", handler);
    return () => window.removeEventListener("create-business", handler);
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-32" />
        <div className="skeleton h-64 rounded-xl" />
      </div>
    );
  }

  // First-run: no business yet. A failed list (e.g. a blocked member) is not "no business".
  if (!biz && !businessesFailed && !showWhatsNext) {
    if (!canCreateBusiness) {
      // Invited user (seller, accountant, etc.) — they can't create businesses.
      // Show a waiting message instead of the creation form.
      return (
        <div>
          <PageHeader title="Welcome!" description="" />
          <div className="card px-6 py-8 text-center">
            <p className="text-sm text-text-primary font-medium mb-1">
              No business has been set up yet.
            </p>
            <p className="text-sm text-text-tertiary">
              Your organization admin needs to create a business first. You'll see it here once it's ready.
            </p>
          </div>
        </div>
      );
    }

    // Restore path — owner is restoring from a previous backup
    if (onboardingPath === "restore" && isOwner && session?.tenantId) {
      return (
        <div>
          <PageHeader title="Restore from backup" description="Import a previously exported Fintranzact backup" />
          <RestoreOnboarding
            tenantId={session.tenantId}
            onBack={() => setOnboardingPath("choose")}
          />
        </div>
      );
    }

    // Create path — standard new business form
    if (onboardingPath === "create") {
      return (
        <div>
          <PageHeader title="Almost there!" description="Set up your business to start creating invoices" />
          {isOwner && (
            <button
              className="btn-ghost text-xs mb-4"
              onClick={() => setOnboardingPath("choose")}
            >
              &larr; Back to options
            </button>
          )}
          <BusinessForm
            onboardingMode
            onDone={(name) => {
              if (name) setNewBizName(name);
              navigate({ to: "/auth/plan-selection" });
            }}
          />
        </div>
      );
    }

    // Choice screen — owners can choose between creating fresh or restoring
    // Non-owners go straight to create (they can't restore)
    if (!isOwner) {
      return (
        <div>
          <PageHeader title="Almost there!" description="Set up your business to start creating invoices" />
          <BusinessForm
            onboardingMode
            onDone={(name) => {
              if (name) setNewBizName(name);
              navigate({ to: "/auth/plan-selection" });
            }}
          />
        </div>
      );
    }

    return (
      <div>
        <PageHeader title="Get started" description="Set up your organization" />
        <div className="max-w-lg space-y-3">
          <button
            onClick={() => setOnboardingPath("create")}
            className="w-full flex items-start gap-3 px-5 py-4 rounded-xl border border-border-light hover:border-brand-400 hover:bg-brand-600/[0.03] transition-colors text-left group card"
          >
            <span className="w-9 h-9 shrink-0 rounded-lg bg-surface-2 group-hover:bg-brand-600/10 flex items-center justify-center text-text-tertiary group-hover:text-brand-600 transition-colors mt-0.5">
              <Icon icon={Add01Icon} size={20} />
            </span>
            <div>
              <p className="text-sm font-medium text-text-primary">Create a new business</p>
              <p className="text-xs text-text-tertiary mt-0.5">Start fresh — set up your business profile and begin invoicing</p>
            </div>
          </button>

          <button
            onClick={() => setOnboardingPath("restore")}
            className="w-full flex items-start gap-3 px-5 py-4 rounded-xl border border-border-light hover:border-brand-400 hover:bg-brand-600/[0.03] transition-colors text-left group card"
          >
            <span className="w-9 h-9 shrink-0 rounded-lg bg-surface-2 group-hover:bg-brand-600/10 flex items-center justify-center text-text-tertiary group-hover:text-brand-600 transition-colors mt-0.5">
              <Icon icon={Upload04Icon} size={20} />
            </span>
            <div>
              <p className="text-sm font-medium text-text-primary">Restore from a backup</p>
              <p className="text-xs text-text-tertiary mt-0.5">Import a previously exported Fintranzact backup to restore all your data</p>
            </div>
          </button>
        </div>
      </div>
    );
  }

  // Create additional business (triggered from BusinessSwitcher)
  if (showCreateBusiness && biz) {
    if (!canCreateBusiness) {
      return (
        <div>
          <PageHeader title="Cannot create business" description="" />
          <div className="card px-6 py-8 text-center">
            <p className="text-sm text-text-primary font-medium mb-1">
              Your role in this organization doesn't allow creating businesses.
            </p>
            <p className="text-sm text-text-tertiary mb-4">
              To create your own business, sign out and create a new organization at login.
            </p>
            <button
              className="btn-ghost text-sm"
              onClick={() => {
                window.history.replaceState({}, "", "/settings");
                setShowCreateBusiness(false);
              }}
            >
              Back to settings
            </button>
          </div>
        </div>
      );
    }
    return (
      <div>
        <button
          className="btn-ghost text-xs mb-4"
          onClick={() => {
            window.history.replaceState({}, "", "/settings");
            setShowCreateBusiness(false);
          }}
        >
          &larr; Back to settings
        </button>
        <PageHeader title="Create New Business" description="Add another business to your organization" />
        <BusinessForm
          onboardingMode
          onDone={(name) => {
            window.history.replaceState({}, "", "/settings");
            if (name) setNewBizName(name);
            setShowCreateBusiness(false);
            navigate({ to: "/auth/plan-selection" });
          }}
        />
      </div>
    );
  }

  // WhatsNext modal shown after business creation (survives the biz refetch)
  if (showWhatsNext) {
    return (
      <>
        <WhatsNextModal
          open
          businessName={newBizName}
          onImport={() => {
            setShowWhatsNext(false);
            setShowImport(true);
          }}
        />
        <ImportWizard open={showImport} onClose={() => setShowImport(false)} />
      </>
    );
  }

  // Import launched from WhatsNext
  if (showImport) {
    return <ImportWizard open onClose={() => setShowImport(false)} />;
  }

  const shownTab = twoFactor.blocked ? "account" : tab;
  return (
    <div>
      <PageHeader title="Settings" description="Manage your business and preferences" />
      <div className="flex flex-col gap-2 mt-2 md:flex-row md:gap-8">
        <SettingsNav value={shownTab} onChange={(t) => handleTabChange(twoFactor.blocked ? "account" : t)} role={session?.role} />
        <div className="flex-1 min-w-0">
          {shownTab === "business" && <BusinessTab biz={biz} />}
          {shownTab === "documents" && <DocumentsTab biz={biz} />}
          {shownTab === "shipping" && biz && <ShippingTab biz={biz} />}
          {shownTab === "team" && <TeamTab />}
          {shownTab === "targets" && <SalesTargetsTab />}
          {shownTab === "locks" && <PeriodLocksTab />}
          {shownTab === "data" && <DataTab />}
          {shownTab === "account" && <AccountTab initialPane={twoFactor.blocked ? "security" : linkedPane} />}
          {shownTab === "billing" && isOwner && <BillingTab />}
          {shownTab === "store" && <StoreTab />}
          {shownTab === "pos" && biz && <POSTab biz={biz} />}
          {shownTab === "barcodes" && <BarcodesTab />}
        </div>
      </div>
    </div>
  );
}
