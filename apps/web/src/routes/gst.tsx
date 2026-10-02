import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useEmbeddedReport } from "@/lib/embedded-report";
import { trpc, getBusinessId } from "@/lib/trpc";
import { formatDate } from "@/lib/utils";

import { StatCard } from "@/components/ui/StatCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedControl, PillTabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/hooks/useToast";
import { Icon } from "@/components/ui/Icon";
import { Download04Icon } from "@hugeicons/core-free-icons";
import { Select } from "@/components/ui/Select";

import { Spinner } from "@/components/ui/Spinner";
import { fmt, fmtN, fmtStr, fyLabel, ReportSkeleton } from "@/components/reports/report-format";
export const Route = createFileRoute("/gst")({
  component: GSTReportsPage,
});

const months = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type ReportTab = "gstr1" | "gstr3b" | "gstr9" | "cmp08";
const REPORT_TABS: ReportTab[] = ["gstr1", "gstr3b", "gstr9", "cmp08"];

export function GSTReportsPage() {
  const embedded = useEmbeddedReport();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  // A tab saved before P&L and the other statements moved to Reports falls back to GSTR-1.
  const [savedTab, setActiveTabRaw] = useState<ReportTab>(() => {
    const saved = localStorage.getItem("fintranzact_gst_tab") as ReportTab | null;
    return saved && REPORT_TABS.includes(saved) ? saved : "gstr1";
  });
  // In the Reports Centre each return is its own report, so the tab is fixed.
  const activeTab = embedded?.gstTab ?? savedTab;
  const navigate = useNavigate();
  const setActiveTab = (tab: ReportTab) => {
    // Inside the Centre each return is its own report: the tabs move between them.
    if (embedded) return void navigate({ to: "/reports", search: { report: tab } });
    setActiveTabRaw(tab);
    localStorage.setItem("fintranzact_gst_tab", tab);
  };

  const { data: businesses } = trpc.business.list.useQuery();
  // The business the reports are for (not simply the first one listed)
  const biz = businesses?.find((b) => b.id === getBusinessId()) ?? businesses?.[0];
  const isComposition = biz?.gstRegistrationType === "composition";

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  const isGstRegistered = biz?.gstRegistrationType !== "unregistered" || !!biz?.gstin;

  // Report labels adapt based on GST status
  const reportTitle = isGstRegistered ? "GST Returns" : "Tax Reports";
  const reportDesc = isGstRegistered
    ? "Generate GSTR-1, GSTR-3B and GSTR-9"
    : "Sales summary and tax reports";
  const tab1Label = isGstRegistered ? "GSTR-1" : "Sales Report";
  const tab2Label = isGstRegistered ? "GSTR-3B" : "Tax Summary";

  const tabs: Array<{ value: ReportTab; label: string }> = [
    { value: "gstr1", label: tab1Label },
    { value: "gstr3b", label: tab2Label },
    { value: "gstr9", label: "GSTR-9" },
    // Composition dealers pay tax quarterly on CMP-08
    ...(isComposition ? [{ value: "cmp08" as const, label: "CMP-08" }] : []),
  ];

  return (
    <div>
      <PageHeader
        title={reportTitle}
        description={reportDesc}
      />

      {/* Tab bar — scrolls sideways on its own on a phone instead of the page. */}
      <div className={embedded ? "mb-5 overflow-x-auto" : "mb-2 overflow-x-auto"} data-testid="gst-report-tabs">
        <PillTabs
          tabs={tabs}
          value={activeTab}
          onChange={(v) => setActiveTab(v as ReportTab)}
          className="w-max"
        />
      </div>
      {!embedded && (
      <>
      <p className="mb-6 text-xs text-text-tertiary">
        Profit &amp; Loss, Balance Sheet, Trial Balance, Ageing, Party Ledger and Tally Export are now in{" "}
        <Link to="/reports" search={{ report: "pnl" }} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
          Reports
        </Link>
        .
      </p>
      </>
      )}

      {/* Period selector — only shown for GST tabs */}
      {(activeTab === "gstr1" || activeTab === "gstr3b") && (
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <Select
            className="input w-40"
            aria-label="Month"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            {months.map((m, i) => (
              <option key={i} value={i + 1}>{m}</option>
            ))}
          </Select>
          <Select
            className="input w-28"
            aria-label="Year"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </Select>

          {!embedded && <div className="sm:ml-4">
            <SegmentedControl
              tabs={[
                { value: "gstr1", label: tab1Label },
                { value: "gstr3b", label: tab2Label },
              ]}
              value={activeTab}
              onChange={(v) => setActiveTab(v as ReportTab)}
            />
          </div>}
        </div>
      )}

      {activeTab === "gstr1" && <GSTR1View year={year} month={month} />}
      {activeTab === "gstr3b" && <GSTR3BView year={year} month={month} />}
      {activeTab === "gstr9" && <GSTR9View />}
      {activeTab === "cmp08" && isComposition && <CMP08View />}
    </div>
  );
}

// ── GSTR-1 View ────────────────────────────────────────────────

function GSTR1View({ year, month }: { year: number; month: number }) {
  const { data, isLoading, error } = trpc.gst.gstr1.useQuery({ year, month });
  const { data: csvData } = trpc.gst.gstr1CSV.useQuery({ year, month });
  const utils = trpc.useUtils();
  const [downloadingJson, setDownloadingJson] = useState(false);

  function handleExport() {
    if (!csvData) return;
    const blob = new Blob([csvData.csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = csvData.filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("GSTR-1 CSV exported");
  }

  // The JSON the GST portal's offline tool takes (b2b, b2cl, b2cs, nil,
  // cdnr, cdnur, hsn), ready to upload on gst.gov.in.
  async function handleDownloadJson() {
    setDownloadingJson(true);
    try {
      const result = await utils.gst.gstr1Json.fetch({ year, month });
      const blob = new Blob([JSON.stringify(result.json, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("GSTR-1 portal JSON downloaded");
    } catch {
      toast.error("Download failed");
    } finally {
      setDownloadingJson(false);
    }
  }

  if (isLoading) return <ReportSkeleton columns={[{ label: "Party GSTIN" }, { label: "Name" }, { label: "Invoice #", kind: "mono" }, { label: "Taxable", align: "right" }, { label: "CGST", align: "right" }, { label: "SGST", align: "right" }, { label: "IGST", align: "right" }, { label: "Total", align: "right" }]} />;
  if (error) return (
    <div className="card px-5 py-4 border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800">
      <p className="text-sm text-red-700 dark:text-red-400">Failed to load report: {error.message}</p>
    </div>
  );
  if (!data) return (
    <EmptyState
      title="GST not applicable"
      description="Your business is not registered under GST. GST reports are only available for GST-registered businesses."
    />
  );

  const b2clInvoices = data.b2cLarge.flatMap((s) => (s.invoices ?? []).map((inv) => ({ ...inv, state: s.state })));
  const notes = [
    ...data.creditNotes.map((n) => ({ ...n, kind: "Credit" as const })),
    ...data.debitNotes.map((n) => ({ ...n, kind: "Debit" as const })),
  ];
  const sectionLabel = (s?: string) => (s === "cdnr" ? "CDNR" : s === "cdnur" ? "CDNUR" : "B2CS");

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Invoice Count" value={data.invoiceCount} />
        <StatCard label="Taxable Value" value={fmt(data.totalTaxableValue)} />
        <StatCard label="Total Tax" value={fmt(data.totalTax)} valueColor="text-amber-600" />
        <StatCard label="Total Value" value={fmt(data.totalInvoiceValue)} valueColor="text-emerald-600" />
      </div>

      {/* Tax split cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="CGST" value={fmt(data.totalCgst)} />
        <StatCard label="SGST" value={fmt(data.totalSgst)} />
        <StatCard label="IGST" value={fmt(data.totalIgst)} />
      </div>

      {/* B2B Table */}
      {data.b2b.length > 0 && (
        <div className="card overflow-hidden mb-6" data-testid="gstr1-b2b">
          <div className="px-4 py-3 border-b border-border-light">
            <h3 className="text-sm font-semibold text-text-primary">B2B — Outward supplies to registered persons</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Party GSTIN</th>
                  <th>Name</th>
                  <th>Invoice #</th>
                  <th className="text-right">Taxable</th>
                  <th className="text-right">CGST</th>
                  <th className="text-right">SGST</th>
                  <th className="text-right">IGST</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.b2b.map((row, i) => (
                  <tr key={i}>
                    <td className="font-mono text-ui text-text-secondary">{row.partyGstin}</td>
                    <td className="text-text-primary">{row.partyName}</td>
                    <td className="font-mono text-ui text-text-secondary">{row.invoiceNumber}</td>
                    <td className="text-right tabular-nums">{fmt(row.taxableValue)}</td>
                    <td className="text-right tabular-nums text-text-secondary">{fmt(row.cgst)}</td>
                    <td className="text-right tabular-nums text-text-secondary">{fmt(row.sgst)}</td>
                    <td className="text-right tabular-nums text-text-secondary">{fmt(row.igst)}</td>
                    <td className="text-right tabular-nums font-medium">{fmt(row.totalInvoiceValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* B2CL Table */}
      {b2clInvoices.length > 0 && (
        <div className="card overflow-hidden mb-6" data-testid="gstr1-b2cl">
          <div className="px-4 py-3 border-b border-border-light">
            <h3 className="text-sm font-semibold text-text-primary">B2CL — Inter-state supplies to unregistered persons above ₹1 lakh</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Place of supply</th>
                  <th>Invoice #</th>
                  <th>Date</th>
                  <th className="text-right">Taxable</th>
                  <th className="text-right">IGST</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {b2clInvoices.map((row) => (
                  <tr key={row.invoiceNumber}>
                    <td className="text-text-primary">{row.state}</td>
                    <td className="font-mono text-ui text-text-secondary">{row.invoiceNumber}</td>
                    <td className="text-text-secondary">{formatDate(row.invoiceDate)}</td>
                    <td className="text-right tabular-nums">{fmt(row.taxableValue)}</td>
                    <td className="text-right tabular-nums text-text-secondary">{fmt(row.igst)}</td>
                    <td className="text-right tabular-nums font-medium">{fmt(row.totalInvoiceValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* B2CS Table */}
      {data.b2cSmall.length > 0 && (
        <div className="card overflow-hidden mb-6" data-testid="gstr1-b2cs">
          <div className="px-4 py-3 border-b border-border-light">
            <h3 className="text-sm font-semibold text-text-primary">B2CS — Outward supplies to unregistered persons</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tax Rate</th>
                  <th>Supply</th>
                  <th>Place of supply</th>
                  <th className="text-right">Taxable Value</th>
                  <th className="text-right">CGST</th>
                  <th className="text-right">SGST</th>
                  <th className="text-right">IGST</th>
                </tr>
              </thead>
              <tbody>
                {data.b2cSmall.map((row, i) => (
                  <tr key={i}>
                    <td className="text-text-primary">{row.taxRate}%{row.taxRate === 0 ? " (nil / exempt)" : ""}</td>
                    <td className="text-text-secondary">{row.supplyType === "INTER" ? "Inter-state" : "Intra-state"}</td>
                    <td className="text-text-secondary">{row.pos ?? "—"}</td>
                    <td className="text-right tabular-nums">{fmt(row.taxableValue)}</td>
                    <td className="text-right tabular-nums text-text-secondary">{fmt(row.cgst)}</td>
                    <td className="text-right tabular-nums text-text-secondary">{fmt(row.sgst)}</td>
                    <td className="text-right tabular-nums text-text-secondary">{fmt(row.igst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Credit / debit notes */}
      {notes.length > 0 && (
        <div className="card overflow-hidden mb-6" data-testid="gstr1-notes">
          <div className="px-4 py-3 border-b border-border-light">
            <h3 className="text-sm font-semibold text-text-primary">CDNR / CDNUR — Credit and debit notes</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Table</th>
                  <th>Note #</th>
                  <th>Type</th>
                  <th>Against</th>
                  <th>Party</th>
                  <th className="text-right">Taxable</th>
                  <th className="text-right">CGST</th>
                  <th className="text-right">SGST</th>
                  <th className="text-right">IGST</th>
                  <th className="text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {notes.map((n) => (
                  <tr key={n.invoiceNumber}>
                    <td className="text-text-primary">{sectionLabel(n.section)}</td>
                    <td className="font-mono text-ui text-text-secondary">{n.invoiceNumber}</td>
                    <td className="text-text-secondary">{n.kind}</td>
                    <td className="font-mono text-ui text-text-secondary">{n.originalInvoiceNumber ?? "—"}</td>
                    <td className="text-text-primary">{n.partyName}</td>
                    <td className="text-right tabular-nums">{fmtStr(n.taxableAmount)}</td>
                    <td className="text-right tabular-nums text-text-secondary">{fmt(n.cgst ?? 0)}</td>
                    <td className="text-right tabular-nums text-text-secondary">{fmt(n.sgst ?? 0)}</td>
                    <td className="text-right tabular-nums text-text-secondary">{fmt(n.igst ?? 0)}</td>
                    <td className="text-right tabular-nums font-medium">{fmtStr(n.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* HSN summary */}
      {data.hsn.length > 0 && (
        <div className="card overflow-hidden mb-6" data-testid="gstr1-hsn">
          <div className="px-4 py-3 border-b border-border-light">
            <h3 className="text-sm font-semibold text-text-primary">HSN — Summary of outward supplies (net of notes)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>HSN / SAC</th>
                  <th>UQC</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Rate</th>
                  <th className="text-right">Taxable</th>
                  <th className="text-right">CGST</th>
                  <th className="text-right">SGST</th>
                  <th className="text-right">IGST</th>
                </tr>
              </thead>
              <tbody>
                {data.hsn.map((row) => (
                  <tr key={`${row.hsn}-${row.rate}-${row.uqc}`}>
                    <td className="font-mono text-ui text-text-primary">{row.hsn}</td>
                    <td className="text-text-secondary">{row.uqc ?? "OTH"}</td>
                    <td className="text-right tabular-nums">{row.quantity}</td>
                    <td className="text-right tabular-nums">{row.rate ?? 0}%</td>
                    <td className="text-right tabular-nums">{fmt(row.taxableValue)}</td>
                    <td className="text-right tabular-nums text-text-secondary">{fmt(row.cgst)}</td>
                    <td className="text-right tabular-nums text-text-secondary">{fmt(row.sgst)}</td>
                    <td className="text-right tabular-nums text-text-secondary">{fmt(row.igst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Export */}
      <div className="flex flex-wrap justify-end gap-3">
        <button onClick={handleExport} className="btn-secondary">
          Export GSTR-1 CSV
        </button>
        <button onClick={handleDownloadJson} disabled={downloadingJson} className="btn-primary inline-flex items-center gap-2">
          {downloadingJson ? <Spinner size="sm" className="text-white" /> : <Icon icon={Download04Icon} size={16} />}
          Download Portal JSON (GSTN)
        </button>
      </div>
    </div>
  );
}

// ── GSTR-3B View ───────────────────────────────────────────────

function GSTR3BView({ year, month }: { year: number; month: number }) {
  const { data, isLoading, error } = trpc.gst.gstr3b.useQuery({ year, month });

  if (isLoading) return <ReportSkeleton columns={[{ label: "Nature of supplies" }, { label: "Taxable value", align: "right" }, { label: "IGST", align: "right" }, { label: "CGST", align: "right" }, { label: "SGST", align: "right" }]} />;
  if (error) return (
    <div className="card px-5 py-4 border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800">
      <p className="text-sm text-red-700 dark:text-red-400">Failed to load report: {error.message}</p>
    </div>
  );
  if (!data) return (
    <EmptyState
      title="GST not applicable"
      description="Your business is not registered under GST. GST reports are only available for GST-registered businesses."
    />
  );

  const rows: Array<{ id: string; label: string; row: { taxableValue: number; igst: number; cgst: number; sgst: number }; muted?: boolean }> = [
    { id: "a", label: "(a) Outward taxable supplies (other than zero rated, nil rated and exempted)", row: data.outwardSupplies.taxable },
    { id: "b", label: "(b) Outward taxable supplies (zero rated)", row: data.outwardSupplies.zeroRated, muted: true },
    { id: "c", label: "(c) Other outward supplies (nil rated, exempted)", row: data.outwardSupplies.exempt, muted: true },
    {
      id: "d",
      label: "(d) Inward supplies (liable to reverse charge)",
      row: {
        taxableValue: parseFloat(data.rcmSupplies.taxableValue),
        igst: parseFloat(data.rcmSupplies.igst),
        cgst: parseFloat(data.rcmSupplies.cgst),
        sgst: parseFloat(data.rcmSupplies.sgst),
      },
      muted: true,
    },
  ];

  return (
    <div className="space-y-5">
      {/* 3.1 Outward supplies */}
      <div className="card overflow-hidden mb-6" data-testid="gstr3b-3-1">
        <div className="px-4 py-3 border-b border-border-light">
          <h3 className="text-sm font-semibold text-text-primary">3.1 — Outward supplies and inward supplies liable to reverse charge</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nature of supplies</th>
                <th className="text-right">Taxable value</th>
                <th className="text-right">IGST</th>
                <th className="text-right">CGST</th>
                <th className="text-right">SGST</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ id, label, row, muted }) => (
                <tr key={id}>
                  <td className={muted ? "text-text-secondary" : "text-text-primary"}>{label}</td>
                  <td className="text-right tabular-nums">{fmt(row.taxableValue)}</td>
                  <td className="text-right tabular-nums">{fmt(row.igst)}</td>
                  <td className="text-right tabular-nums">{fmt(row.cgst)}</td>
                  <td className="text-right tabular-nums">{fmt(row.sgst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. ITC */}
      <div className="card overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-border-light">
          <h3 className="text-sm font-semibold text-text-primary">4 — Eligible input tax credit</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4">
          <StatCard label="ITC — IGST" value={fmt(data.itc.igst)} />
          <StatCard label="ITC — CGST" value={fmt(data.itc.cgst)} />
          <StatCard label="ITC — SGST" value={fmt(data.itc.sgst)} />
        </div>
        <div className="px-4 pb-4">
          <StatCard label="Total ITC available" value={fmt(data.itc.total)} valueColor="text-emerald-600" />
        </div>
      </div>

      {/* Output tax (3.1 tax heads) */}
      <div className="card overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-border-light">
          <h3 className="text-sm font-semibold text-text-primary">Output tax payable</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4">
          <StatCard label="Output IGST" value={fmt(data.taxPayable.igst)} />
          <StatCard label="Output CGST" value={fmt(data.taxPayable.cgst)} />
          <StatCard label="Output SGST" value={fmt(data.taxPayable.sgst)} />
        </div>
      </div>

      {/* Net tax liability */}
      <div className="card overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-border-light">
          <h3 className="text-sm font-semibold text-text-primary">Net tax liability (after ITC)</h3>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-4">
          <StatCard label="Net IGST" value={fmt(data.netTax.igst)} valueColor="text-amber-600" />
          <StatCard label="Net CGST" value={fmt(data.netTax.cgst)} valueColor="text-amber-600" />
          <StatCard label="Net SGST" value={fmt(data.netTax.sgst)} valueColor="text-amber-600" />
          <div className="card px-4 py-3 border-2 border-border-color">
            <p className="text-xs text-text-tertiary mb-1 font-medium">Total payable</p>
            <p className="text-xl font-bold tabular-nums text-red-600">{fmt(data.netTax.total)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── CMP-08 View (composition scheme) ───────────────────────────

const quarterLabels = ["Q1 (Apr–Jun)", "Q2 (Jul–Sep)", "Q3 (Oct–Dec)", "Q4 (Jan–Mar)"];

function CMP08View() {
  const now = new Date();
  const thisFy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const thisQuarter = now.getMonth() >= 3 ? Math.floor((now.getMonth() - 3) / 3) + 1 : 4;
  // Default to the quarter just ended: the one due for filing
  const [fy, setFy] = useState(thisQuarter === 1 ? thisFy - 1 : thisFy);
  const [quarter, setQuarter] = useState(thisQuarter === 1 ? 4 : thisQuarter - 1);
  const { data, isLoading, error } = trpc.gst.cmp08.useQuery({ year: fy, quarter });
  const fyOptions = Array.from({ length: 5 }, (_, i) => thisFy - i);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Select className="input w-36" aria-label="Financial year" value={fy} onChange={(e) => setFy(Number(e.target.value))}>
          {fyOptions.map((y) => (
            <option key={y} value={y}>{fyLabel(y)}</option>
          ))}
        </Select>
        <Select className="input w-40" aria-label="Quarter" value={quarter} onChange={(e) => setQuarter(Number(e.target.value))}>
          {quarterLabels.map((label, i) => (
            <option key={label} value={i + 1}>{label}</option>
          ))}
        </Select>
      </div>

      {isLoading && <ReportSkeleton />}
      {error && (
        <div className="card px-5 py-4 border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800">
          <p className="text-sm text-red-700 dark:text-red-400">Failed to load CMP-08: {error.message}</p>
        </div>
      )}
      {data && (
        <div className="card overflow-hidden" data-testid="cmp08">
          <div className="px-4 py-3 border-b border-border-light">
            <h3 className="text-sm font-semibold text-text-primary">CMP-08 — Statement for payment of self-assessed tax</h3>
            <p className="text-xs text-text-tertiary mt-0.5">
              {formatDate(data.quarterStart)} — {formatDate(data.quarterEnd)} · outward supplies net of credit notes, at the 1% composition rate for traders
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4">
            <StatCard label="Outward supplies (turnover)" value={fmtStr(data.taxableValue)} />
            <StatCard label="Composition tax payable" value={fmtStr(data.taxPayable)} valueColor="text-amber-600" />
          </div>
        </div>
      )}
    </div>
  );
}
// ── GSTR-9 View ────────────────────────────────────────────────

const currentFYStart = (() => {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
})();

function GSTR9View() {
  const [financialYear, setFinancialYear] = useState(currentFYStart - 1); // Default to last completed FY
  const [downloading, setDownloading] = useState(false);

  const { data, isLoading, error } = trpc.gst.gstr9.useQuery({ financialYear });
  const utils = trpc.useUtils();

  // FY selector options — the year in progress (to review before it closes)
  // and the last 5 completed financial years
  const fyOptions = Array.from({ length: 6 }, (_, i) => {
    const startYear = currentFYStart - i;
    return {
      value: startYear,
      label: `FY ${startYear}-${String(startYear + 1).slice(2)}${i === 0 ? " (to date)" : ""}`,
    };
  });

  async function handleDownloadJson() {
    setDownloading(true);
    try {
      const result = await utils.gst.gstr9Json.fetch({ financialYear });
      if (!result) return;
      const blob = new Blob([JSON.stringify(result.json, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("GSTR-9 portal JSON downloaded");
    } catch {
      toast.error("Download failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* FY selector + info */}
      <div className="card px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
        <div>
          <p className="text-xs text-text-tertiary mb-1 font-medium uppercase tracking-wide">Financial Year</p>
          <Select
            className="input w-52"
            aria-label="Financial year"
            value={financialYear}
            onChange={(e) => setFinancialYear(Number(e.target.value))}
          >
            {fyOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </Select>
        </div>
        <div className="sm:ml-auto">
          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 px-4 py-2">
            <p className="text-xs text-blue-700 dark:text-blue-400">
              Annual return — April to March. Aggregates 12 months of GSTR-1 and GSTR-3B data.
            </p>
          </div>
        </div>
      </div>

      {isLoading && <ReportSkeleton />}

      {error && (
        <div className="card px-5 py-4 border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800">
          <p className="text-sm text-red-700 dark:text-red-400">Failed to load GSTR-9: {error.message}</p>
        </div>
      )}

      {data && (
        <>
          {/* Business + period header */}
          <div className="card px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2">
            <div>
              <p className="text-sm font-semibold text-text-primary">{data.businessName}</p>
              <p className="text-xs text-text-secondary font-mono">{data.businessGstin || "GSTIN not set"}</p>
            </div>
            <div className="sm:ml-auto text-right">
              <p className="text-sm font-semibold text-text-primary">FY {data.financialYear}</p>
              <p className="text-xs text-text-tertiary">{data.periodStart} — {data.periodEnd}</p>
            </div>
          </div>

          {/* ── Part II: Outward Supplies ── */}
          <div>
            <h2 className="text-sm font-bold text-text-primary uppercase tracking-wide mb-3">
              Part II — Outward Supplies
            </h2>

            {/* Table 4 */}
            <div className="card overflow-hidden mb-4">
              <div className="px-4 py-3 border-b border-border-light bg-surface-1">
                <h3 className="text-sm font-semibold text-text-primary">Table 4 — Taxable outward supplies</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="w-8">Sl.</th>
                      <th>Description</th>
                      <th className="text-right">Taxable Value</th>
                      <th className="text-right">CGST</th>
                      <th className="text-right">SGST</th>
                      <th className="text-right">IGST</th>
                      <th className="text-right">Cess</th>
                    </tr>
                  </thead>
                  <tbody>
                    <GSTR9TableRow label="4A" desc="Taxable outward supplies to registered (B2B)" row={data.table4.taxableSuppliesB2B} />
                    <GSTR9TableRow label="4B" desc="Taxable outward supplies to unregistered (B2C)" row={data.table4.taxableSuppliesB2C} />
                    <GSTR9TableRow label="4C" desc="Zero-rated supplies (with payment of tax)" row={data.table4.zeroRatedWithTax} />
                    <GSTR9TableRow label="4D" desc="Exempted supplies" row={data.table4.exempted} />
                    <GSTR9TableRow label="4I" desc="Credit notes issued" row={data.table4.creditNotes} muted />
                    <GSTR9TableRow label="4J" desc="Debit notes issued" row={data.table4.debitNotes} />
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-1 border-t-2 border-border-color font-semibold">
                      <td className="px-4 py-2 text-xs text-text-tertiary font-medium">—</td>
                      <td className="px-4 py-2 text-sm font-bold text-text-primary">Net Outward Supplies (Part II)</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold">{fmtN(data.partIITotals.taxableValue)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold">{fmtN(data.partIITotals.cgst)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold">{fmtN(data.partIITotals.sgst)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold">{fmtN(data.partIITotals.igst)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold">{fmtN(data.partIITotals.cess)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Table 5 */}
            <div className="card overflow-hidden mb-4">
              <div className="px-4 py-3 border-b border-border-light bg-surface-1">
                <h3 className="text-sm font-semibold text-text-primary">Table 5 — Outward supplies on which tax is NOT payable</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="w-8">Sl.</th>
                      <th>Description</th>
                      <th className="text-right">Taxable Value</th>
                      <th className="text-right">CGST</th>
                      <th className="text-right">SGST</th>
                      <th className="text-right">IGST</th>
                      <th className="text-right">Cess</th>
                    </tr>
                  </thead>
                  <tbody>
                    <GSTR9TableRow label="5A" desc="Zero-rated (without payment of tax)" row={data.table5.zeroRatedWithoutTax} muted />
                    <GSTR9TableRow label="5B" desc="Nil-rated supplies" row={data.table5.nilRated} muted />
                    <GSTR9TableRow label="5D" desc="Non-GST outward supplies" row={data.table5.nonGst} muted />
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── Part III: ITC ── */}
          <div>
            <h2 className="text-sm font-bold text-text-primary uppercase tracking-wide mb-3">
              Part III — Input Tax Credit (ITC)
            </h2>

            {/* Table 6 */}
            <div className="card overflow-hidden mb-4">
              <div className="px-4 py-3 border-b border-border-light bg-surface-1">
                <h3 className="text-sm font-semibold text-text-primary">Table 6 — ITC availed during the year</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="w-8">Sl.</th>
                      <th>Description</th>
                      <th className="text-right">IGST</th>
                      <th className="text-right">CGST</th>
                      <th className="text-right">SGST</th>
                      <th className="text-right">Cess</th>
                    </tr>
                  </thead>
                  <tbody>
                    <GSTR9ITCRow label="6A" desc="Total ITC as per auto-populated GSTR-3B" row={data.table6.totalItcGstr3B} />
                    <GSTR9ITCRow label="6B" desc="ITC on imports of goods" row={data.table6.itcImports} muted />
                    <GSTR9ITCRow label="6C" desc="ITC on inward supplies from ISD" row={data.table6.itcIsd} muted />
                    <GSTR9ITCRow label="6D" desc="ITC on all other inward supplies (purchases)" row={data.table6.itcOtherInward} />
                    <GSTR9ITCRow label="6E" desc="ITC on inward supplies under reverse charge" row={data.table6.itcReverseCharge} />
                    <GSTR9ITCRow label="6H" desc="ITC reversed (Rules 42/43, Section 17(5))" row={data.table6.itcReversed} muted />
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-1 border-t-2 border-border-color font-semibold">
                      <td className="px-4 py-2 text-xs text-text-tertiary font-medium">6J</td>
                      <td className="px-4 py-2 text-sm font-bold text-text-primary">Net ITC available (6A minus 6H)</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold text-emerald-600">{fmtN(data.table6.netItc.igst)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold text-emerald-600">{fmtN(data.table6.netItc.cgst)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold text-emerald-600">{fmtN(data.table6.netItc.sgst)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold text-emerald-600">{fmtN(data.table6.netItc.cess)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Table 7 */}
            <div className="card overflow-hidden mb-4">
              <div className="px-4 py-3 border-b border-border-light bg-surface-1">
                <h3 className="text-sm font-semibold text-text-primary">Table 7 — ITC reversed and ineligible</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="w-8">Sl.</th>
                      <th>Description</th>
                      <th className="text-right">IGST</th>
                      <th className="text-right">CGST</th>
                      <th className="text-right">SGST</th>
                      <th className="text-right">Cess</th>
                    </tr>
                  </thead>
                  <tbody>
                    <GSTR9ITCRow label="7A" desc="As per Rule 42" row={data.table7.rule42} muted />
                    <GSTR9ITCRow label="7B" desc="As per Rule 43" row={data.table7.rule43} muted />
                    <GSTR9ITCRow label="7H" desc="Other reversals" row={data.table7.other} muted />
                    <GSTR9ITCRow label="—" desc="Total ITC reversed" row={data.table7.total} />
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── Part IV: Tax Paid ── */}
          <div>
            <h2 className="text-sm font-bold text-text-primary uppercase tracking-wide mb-3">
              Part IV — Tax Paid (Table 9)
            </h2>
            <div className="card overflow-hidden mb-4">
              <div className="px-4 py-3 border-b border-border-light bg-surface-1">
                <h3 className="text-sm font-semibold text-text-primary">Table 9 — Tax paid as declared in returns during the financial year</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Tax Type</th>
                      <th className="text-right">Paid through ITC</th>
                      <th className="text-right">Paid through Cash</th>
                      <th className="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="text-text-primary font-medium">IGST</td>
                      <td className="text-right tabular-nums text-emerald-600">{fmtN(data.table9.igstThroughITC)}</td>
                      <td className="text-right tabular-nums text-amber-600">{fmtN(data.table9.igstThroughCash)}</td>
                      <td className="text-right tabular-nums font-semibold">{fmtN(data.table9.igstThroughITC + data.table9.igstThroughCash)}</td>
                    </tr>
                    <tr>
                      <td className="text-text-primary font-medium">CGST</td>
                      <td className="text-right tabular-nums text-emerald-600">{fmtN(data.table9.cgstThroughITC)}</td>
                      <td className="text-right tabular-nums text-amber-600">{fmtN(data.table9.cgstThroughCash)}</td>
                      <td className="text-right tabular-nums font-semibold">{fmtN(data.table9.cgstThroughITC + data.table9.cgstThroughCash)}</td>
                    </tr>
                    <tr>
                      <td className="text-text-primary font-medium">SGST</td>
                      <td className="text-right tabular-nums text-emerald-600">{fmtN(data.table9.sgstThroughITC)}</td>
                      <td className="text-right tabular-nums text-amber-600">{fmtN(data.table9.sgstThroughCash)}</td>
                      <td className="text-right tabular-nums font-semibold">{fmtN(data.table9.sgstThroughITC + data.table9.sgstThroughCash)}</td>
                    </tr>
                    <tr>
                      <td className="text-text-secondary">Cess</td>
                      <td className="text-right tabular-nums text-text-tertiary">{fmtN(data.table9.cessThroughITC)}</td>
                      <td className="text-right tabular-nums text-text-tertiary">{fmtN(data.table9.cessThroughCash)}</td>
                      <td className="text-right tabular-nums text-text-tertiary">{fmtN(data.table9.cessThroughITC + data.table9.cessThroughCash)}</td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-1 border-t-2 border-border-color">
                      <td className="px-4 py-2 font-bold text-text-primary">Total Tax</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold text-emerald-600">
                        {fmtN(data.table9.igstThroughITC + data.table9.cgstThroughITC + data.table9.sgstThroughITC)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold text-amber-600">
                        {fmtN(data.table9.igstThroughCash + data.table9.cgstThroughCash + data.table9.sgstThroughCash)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold text-text-primary">
                        {fmtN(
                          data.table9.igstThroughITC + data.table9.igstThroughCash +
                          data.table9.cgstThroughITC + data.table9.cgstThroughCash +
                          data.table9.sgstThroughITC + data.table9.sgstThroughCash
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>

          {/* Download JSON */}
          <div className="flex justify-end">
            <button
              onClick={handleDownloadJson}
              disabled={downloading}
              className="btn-primary inline-flex items-center gap-2"
            >
              {downloading ? (
                <>
                  <Spinner size="sm" className="text-white" />
                  Preparing…
                </>
              ) : (
                <>
                  <Icon icon={Download04Icon} size={16} />
                  Download Portal JSON (GSTN)
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── GSTR-9 row sub-components ──────────────────────────────────

interface TaxRowData {
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
}

function GSTR9TableRow({
  label,
  desc,
  row,
  muted = false,
}: {
  label: string;
  desc: string;
  row: TaxRowData;
  muted?: boolean;
}) {
  const cls = muted ? "text-text-secondary" : "text-text-primary";
  return (
    <tr>
      <td className="px-4 py-2 text-xs text-text-tertiary font-medium">{label}</td>
      <td className={`px-4 py-2 text-sm ${cls}`}>{desc}</td>
      <td className={`px-4 py-2 text-right tabular-nums ${muted ? "text-text-tertiary" : ""}`}>{fmtN(row.taxableValue)}</td>
      <td className={`px-4 py-2 text-right tabular-nums ${muted ? "text-text-tertiary" : "text-text-secondary"}`}>{fmtN(row.cgst)}</td>
      <td className={`px-4 py-2 text-right tabular-nums ${muted ? "text-text-tertiary" : "text-text-secondary"}`}>{fmtN(row.sgst)}</td>
      <td className={`px-4 py-2 text-right tabular-nums ${muted ? "text-text-tertiary" : "text-text-secondary"}`}>{fmtN(row.igst)}</td>
      <td className="px-4 py-2 text-right tabular-nums text-text-tertiary">{fmtN(row.cess)}</td>
    </tr>
  );
}

function GSTR9ITCRow({
  label,
  desc,
  row,
  muted = false,
}: {
  label: string;
  desc: string;
  row: TaxRowData;
  muted?: boolean;
}) {
  const cls = muted ? "text-text-secondary" : "text-text-primary";
  return (
    <tr>
      <td className="px-4 py-2 text-xs text-text-tertiary font-medium">{label}</td>
      <td className={`px-4 py-2 text-sm ${cls}`}>{desc}</td>
      <td className={`px-4 py-2 text-right tabular-nums ${muted ? "text-text-tertiary" : "text-emerald-600"}`}>{fmtN(row.igst)}</td>
      <td className={`px-4 py-2 text-right tabular-nums ${muted ? "text-text-tertiary" : "text-emerald-700 dark:text-emerald-400"}`}>{fmtN(row.cgst)}</td>
      <td className={`px-4 py-2 text-right tabular-nums ${muted ? "text-text-tertiary" : "text-emerald-700 dark:text-emerald-400"}`}>{fmtN(row.sgst)}</td>
      <td className="px-4 py-2 text-right tabular-nums text-text-tertiary">{fmtN(row.cess)}</td>
    </tr>
  );
}

