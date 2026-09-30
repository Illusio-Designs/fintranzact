import { useState } from "react";
import JSZip from "jszip";
import { ImportWizard } from "@/components/ImportWizard";
import { trpc } from "@/lib/trpc";
import { apiUrl } from "@/lib/api-url";
import { toast } from "@/hooks/useToast";
import { Spinner } from "@/components/ui/Spinner";
import { Icon } from "@/components/ui/Icon";
import {
  Archive01Icon,
  Download04Icon,
  InformationCircleIcon,
  Table01Icon,
  Upload04Icon,
} from "@hugeicons/core-free-icons";
import { todayISODate } from "@/lib/utils";
import dayjs from "dayjs";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  const d = dayjs(iso);
  if (!d.isValid()) return "—";
  return d.format("D MMM YYYY, h:mm A");
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function SectionCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card px-6 py-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-brand-50 dark:bg-brand-950 flex items-center justify-center text-brand-600 shrink-0 mt-0.5">
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          <p className="text-sm text-text-tertiary mt-0.5">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

// ── Import Section ────────────────────────────────────────────────────────────

function ImportSection({ onOpen }: { onOpen: () => void }) {
  return (
    <SectionCard
      icon={<Icon icon={Upload04Icon} size={20} />}
      title="Import data"
      description="Migrate from myBillBook, Tally, or upload CSV files into the current business."
    >
      <button className="btn-secondary" onClick={onOpen}>
        Start import
      </button>
    </SectionCard>
  );
}

// ── CSV Export Section (current business, spreadsheet-friendly) ──────────────

function CsvExportSection() {
  const exportMut = trpc.business.exportData.useMutation({
    onSuccess: async (data) => {
      const zip = new JSZip();
      zip.file("parties.csv", data.parties);
      zip.file("items.csv", data.items);
      zip.file("invoices.csv", data.invoices);
      zip.file("invoice_line_items.csv", data.lineItems);
      zip.file("payments.csv", data.payments);
      zip.file("expenses.csv", data.expenses);

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fintranzact-export-${todayISODate()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Data exported successfully");
    },
    onError: (err) => toast.error("Export failed", err.message),
  });

  return (
    <SectionCard
      icon={<Icon icon={Table01Icon} size={20} />}
      title="Export as CSV"
      description="Download the current business as CSV files in a ZIP bundle — ideal for spreadsheets and external tools. Not used for restoring."
    >
      <button
        className="btn-secondary"
        onClick={() => exportMut.mutate()}
        disabled={exportMut.isPending}
      >
        {exportMut.isPending ? "Exporting…" : "Export CSV bundle"}
      </button>
    </SectionCard>
  );
}

// ── Full Backup Section (tenant-wide, restorable) ────────────────────────────

function FullBackupSection({ tenantId }: { tenantId: string }) {
  const exportMut = trpc.selfExport.request.useMutation({
    onSuccess: (data) => {
      // Resolve the URL against API_URL when the server returns a
      // relative path (split-host deploys: app.fintranzact.com + api.fintranzact.com).
      // Falls through unchanged when the server returns an absolute URL.
      const href = data.url.startsWith("http") ? data.url : apiUrl(data.url);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = "";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      toast.success("Download started", `Token valid until ${formatDateTime(data.expiresAt)}`);
    },
    onError: (err) => {
      const code = (err as { data?: { code?: string } }).data?.code;
      if (code === "FORBIDDEN") {
        toast.error("You must be a tenant owner to export data.");
      } else if (code === "TOO_MANY_REQUESTS") {
        toast.error("Export limit reached", "You've reached the 2-per-day export limit. Try again tomorrow.");
      } else {
        toast.error("Failed to start export. Please try again.", err.message);
      }
    },
  });

  return (
    <SectionCard
      icon={<Icon icon={Archive01Icon} size={20} />}
      title="Full backup (restorable)"
      description="Download a complete snapshot of your organization — all businesses, parties, items, invoices, payments, and other records. Re-import into an empty organization to restore."
    >
      <div className="flex items-center gap-2 text-xs text-text-tertiary mb-4 px-0.5">
        <Icon icon={InformationCircleIcon} size={16} />
        <span>Limit: 2 exports per day. Restore from the onboarding screen of a new organization.</span>
      </div>
      <button
        className="btn-primary flex items-center gap-2"
        onClick={() => exportMut.mutate({ tenantId })}
        disabled={exportMut.isPending}
        aria-label="Export tenant data"
      >
        {exportMut.isPending ? <Spinner size="sm" /> : <Icon icon={Download04Icon} size={20} />}
        {exportMut.isPending ? "Preparing backup…" : "Download backup"}
      </button>
    </SectionCard>
  );
}

// ── Main DataTab ──────────────────────────────────────────────────────────────

export function DataTab() {
  const [showImport, setShowImport] = useState(false);
  const { data: session } = trpc.auth.me.useQuery();
  const isOwner = session?.role === "owner" || session?.role === "superadmin";

  return (
    <>
      <div className="space-y-4">
        <ImportSection onOpen={() => setShowImport(true)} />
        <CsvExportSection />
        {isOwner && session?.tenantId && <FullBackupSection tenantId={session.tenantId} />}
      </div>
      <ImportWizard open={showImport} onClose={() => setShowImport(false)} />
    </>
  );
}
