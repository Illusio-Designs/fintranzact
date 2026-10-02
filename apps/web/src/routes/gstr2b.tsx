import { TableSkeleton } from "@/components/ui/Skeleton";
import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useState, useRef, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { badgeColor } from "@/lib/badge-colors";
import { StatCard } from "@/components/ui/StatCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { PillTabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/hooks/useToast";
import { Spinner } from "@/components/ui/Spinner";
import { Icon } from "@/components/ui/Icon";
import { Upload04Icon } from "@hugeicons/core-free-icons";
import { Select } from "@/components/ui/Select";
import { usePageSize } from "@/hooks/usePageSize";
import { Pagination } from "@/components/ui/Pagination";
import { TableScroll } from "@/components/ui/Table";
import { RowActions, tidyMenu } from "@/components/ui/Menu";

export const Route = createFileRoute("/gstr2b")({
  component: GSTR2BPage,
});

// ── Constants ─────────────────────────────────────────────────

const months = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type G2BTab = "upload" | "reconciliation" | "missing-books" | "missing-2b" | "history";

// ── Helpers ───────────────────────────────────────────────────

function returnPeriod(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function fmt(v: string | number | null | undefined): string {
  if (v == null) return "—";
  return formatCurrency(typeof v === "string" ? parseFloat(v) || 0 : v);
}

function matchBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case "matched":
      return { label: "Matched", cls: badgeColor("emerald") };
    case "mismatched":
      return { label: "Mismatch", cls: badgeColor("amber") };
    case "missing_in_books":
      return { label: "Not in Books", cls: badgeColor("red") };
    case "ignored":
      return { label: "Ignored", cls: "bg-surface-2 text-text-tertiary" };
    case "pending":
    default:
      return { label: "Pending", cls: badgeColor("blue") };
  }
}

function mismatchLabel(reason: string): string {
  switch (reason) {
    case "taxable_value_difference": return "Taxable value differs";
    case "cgst_difference":          return "CGST differs";
    case "sgst_difference":          return "SGST differs";
    case "igst_difference":          return "IGST differs";
    case "date_difference":          return "Invoice date mismatch";
    default:                         return reason;
  }
}

/**
 * Page state for one server-paged table: back to page 1 when `resetKey`
 * changes (period, filter) or rows per page change, and each new page starts
 * at its first row. Pair with `useTotalPages` once the query has a total.
 */
function usePagedTable(list: string, resetKey: string) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(list, 25);
  const tableRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setPage(1);
  }, [resetKey, pageSize]);
  useEffect(() => { tableRef.current?.scrollTo({ top: 0 }); }, [page]);
  return { page, setPage, pageSize, setPageSize, tableRef };
}

/** Page count for `total` rows; steps back a page when the current one no longer exists. */
function useTotalPages(total: number, pageSize: number, page: number, setPage: (p: number) => void) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages, setPage]);
  return totalPages;
}

// ── Upload Section ────────────────────────────────────────────

function UploadSection({
  year, month,
  onUploadSuccess,
}: {
  year: number;
  month: number;
  onUploadSuccess: (uploadId: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const uploadMutation = trpc.gstr2b.upload.useMutation({
    onSuccess: (data) => {
      toast({
        title: "Upload successful",
        description: `${data.totalRecords} records processed — ${data.matchedRecords} matched, ${data.missingInBooks} missing in books.`,
      });
      utils.gstr2b.uploads.invalidate();
      utils.gstr2b.summary.invalidate();
      onUploadSuccess(data.uploadId);
    },
    onError: (err) => {
      toast({ title: "Upload failed", description: err.message, variant: "error" });
    },
  });

  const processFile = useCallback(
    (file: File) => {
      if (!file) return;
      const ext = file.name.split(".").pop()?.toLowerCase();
      const format = ext === "csv" ? "csv" : "json";

      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        uploadMutation.mutate({
          returnPeriod: returnPeriod(year, month),
          content,
          fileName: file.name,
          format,
        });
      };
      reader.readAsText(file);
    },
    [uploadMutation, year, month],
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  };

  return (
    <div className="max-w-xl">
      <div className="mb-4">
        <p className="text-sm text-text-secondary">
          Upload the GSTR-2B JSON or CSV file downloaded from the GST portal for{" "}
          <strong>{months[month - 1]} {year}</strong>. Records will be auto-reconciled
          against your purchase invoices.
        </p>
      </div>

      <div
        className={cn(
          "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors",
          dragOver
            ? "border-brand-500 bg-brand-50 dark:bg-brand-950/30"
            : "border-border-medium hover:border-brand-400 hover:bg-surface-1",
        )}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
        aria-label="Upload GSTR-2B file"
      >
        <input
          ref={fileRef}
          type="file"
          accept=".json,.csv"
          className="hidden"
          onChange={handleFileChange}
        />

        {uploadMutation.isPending ? (
          <div className="flex flex-col items-center gap-3">
            <Spinner className="w-8 h-8" />
            <p className="text-sm text-text-secondary">Processing file…</p>
          </div>
        ) : (
          <>
            <div className="w-10 h-10 rounded-xl bg-surface-2 flex items-center justify-center mx-auto mb-3">
              <Icon icon={Upload04Icon} size={20} className="text-text-tertiary" />
            </div>
            <p className="text-sm font-medium text-text-primary mb-1">
              Drop your GSTR-2B file here
            </p>
            <p className="text-xs text-text-tertiary">JSON or CSV · Max 50 MB</p>
          </>
        )}
      </div>

    </div>
  );
}

// ── Upload History ────────────────────────────────────────────

// The server caps this list at 50 rows a page.
const UPLOAD_PAGE_SIZES = [10, 25, 50];

function UploadHistorySection({ onSelectUpload }: { onSelectUpload: (returnPeriod: string) => void }) {
  const { page, setPage, pageSize: savedSize, setPageSize, tableRef } = usePagedTable("gstr2b-uploads", "");
  // A size saved before the cap (or set elsewhere) can't exceed what the server allows.
  const pageSize = Math.min(savedSize, 50);
  const { data, isLoading, isFetching } = trpc.gstr2b.uploads.useQuery(
    { page, limit: pageSize },
    // Keep the current page on screen while the next one loads.
    { placeholderData: (prev) => prev },
  );
  const totalPages = useTotalPages(data?.total ?? 0, pageSize, page, setPage);

  if (isLoading) return <TableSkeleton rows={6} columns={[{ label: "Period" }, { label: "File" }, { label: "Total", align: "right" }, { label: "Matched", align: "right" }, { label: "Mismatch", align: "right" }, { label: "Not in Books", align: "right" }, { label: "Uploaded" }, { align: "right", kind: "button" }]} />;

  if (!data?.uploads.length) {
    return (
      <EmptyState
        title="No uploads yet"
        description="Upload a GSTR-2B file to get started with reconciliation."
      />
    );
  }

  return (
    <div className={cn("card overflow-clip transition-opacity", isFetching && "opacity-60")}>
      <Pagination
        placement="top"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        total={data.total}
        pageSize={pageSize}
      />
      <TableScroll ref={tableRef}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>File</th>
              <th className="text-right">Total</th>
              <th className="text-right">Matched</th>
              <th className="text-right">Mismatch</th>
              <th className="text-right">Not in Books</th>
              <th>Uploaded</th>
              <th className="text-right"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {data.uploads.map((u) => (
              <tr key={u.id} className="cursor-pointer" onClick={() => onSelectUpload(u.returnPeriod)}>
                <td className="font-medium text-text-primary">{u.returnPeriod}</td>
                <td className="text-text-secondary max-w-[180px] truncate">{u.fileName}</td>
                <td className="text-right text-text-primary">{u.totalRecords}</td>
                <td className="text-right text-emerald-700 dark:text-emerald-400">{u.matchedRecords}</td>
                <td className="text-right text-amber-700 dark:text-amber-400">{u.unmatchedRecords}</td>
                <td className="text-right text-red-700 dark:text-red-400">{u.newRecords}</td>
                <td className="text-text-tertiary text-xs">{u.uploadedAt ? formatDate(u.uploadedAt) : "—"}</td>
                <td className="text-right" onClick={(e) => e.stopPropagation()}>
                  <RowActions
                    label={`${u.returnPeriod} upload`}
                    items={tidyMenu([
                      { label: "Open", hint: "Enter", onSelect: () => onSelectUpload(u.returnPeriod) },
                    ])}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <Pagination
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        total={data.total}
        pageSize={pageSize}
        onPageSizeChange={setPageSize}
        pageSizeOptions={UPLOAD_PAGE_SIZES}
      />
    </div>
  );
}

// ── Reconciliation Records Table ───────────────────────────────

function ReconciliationSection({
  year, month,
}: {
  year: number;
  month: number;
}) {
  const period = returnPeriod(year, month);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const { page, setPage, pageSize, setPageSize, tableRef } = usePagedTable("gstr2b-records", `${period}|${statusFilter}`);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: summary } = trpc.gstr2b.summary.useQuery({ returnPeriod: period });

  // Find latest upload for this period to show records
  const [uploadId] = useState<string | null>(null);

  // Use summary to get the upload ID
  const resolvedUploadId = uploadId ?? summary?.uploadId ?? null;

  const { data: records, isLoading, isFetching } = trpc.gstr2b.records.useQuery(
    {
      uploadId: resolvedUploadId!,
      matchStatus: statusFilter as "matched" | "mismatched" | "missing_in_books" | "pending" | "ignored" | undefined || undefined,
      page,
      limit: pageSize,
    },
    {
      enabled: !!resolvedUploadId,
      // Keep the current page on screen while the next one loads.
      placeholderData: (prev) => prev,
    },
  );
  const totalPages = useTotalPages(records?.total ?? 0, pageSize, page, setPage);

  const utils = trpc.useUtils();

  const ignoreMutation = trpc.gstr2b.ignoreRecord.useMutation({
    onSuccess: () => {
      toast({ title: "Record ignored" });
      utils.gstr2b.records.invalidate();
      utils.gstr2b.summary.invalidate();
    },
  });

  if (!summary?.hasData) {
    return (
      <EmptyState
        title="No GSTR-2B data for this period"
        description={`Upload a GSTR-2B file for ${months[month - 1]} ${year} to begin reconciliation.`}
      />
    );
  }

  const STATUS_OPTIONS = [
    { value: "", label: "All records" },
    { value: "matched", label: "Matched" },
    { value: "mismatched", label: "Mismatched" },
    { value: "missing_in_books", label: "Not in Books" },
    { value: "pending", label: "Pending" },
    { value: "ignored", label: "Ignored" },
  ];

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard
          size="lg"
          label="Matched"
          value={summary.matched}
          labelColor="text-emerald-700 dark:text-emerald-400"
          className="bg-surface-0 border-border-light"
        />
        <StatCard
          size="lg"
          label="Mismatched"
          value={summary.mismatched}
          labelColor="text-amber-700 dark:text-amber-400"
          className="bg-surface-0 border-border-light"
        />
        <StatCard
          size="lg"
          label="Not in Books"
          value={summary.missingInBooks}
          labelColor="text-red-700 dark:text-red-400"
          note={summary.itcAtRisk?.total ? `ITC at risk: ${fmt(summary.itcAtRisk.total)}` : undefined}
          className="bg-surface-0 border-border-light"
        />
        <StatCard
          size="lg"
          label="ITC Available"
          value={summary.matched + summary.pending}
          labelColor="text-blue-700 dark:text-blue-400"
          note={summary.itcAvailable?.total ? fmt(summary.itcAvailable.total) : undefined}
          className="bg-surface-0 border-border-light"
        />
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3 mb-4">
        <Select
          className="input w-44 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by match status"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </div>

      {isLoading && <TableSkeleton rows={6} columns={[{ label: "Supplier GSTIN" }, { label: "Supplier" }, { label: "Invoice #", kind: "mono" }, { label: "Date" }, { label: "Taxable", align: "right" }, { label: "CGST", align: "right" }, { label: "SGST", align: "right" }, { label: "IGST", align: "right" }, { label: "ITC", align: "center" }, { label: "Status", align: "center", kind: "badge" }, { align: "right", kind: "button" }]} />}

      {!isLoading && !records?.records.length && (
        <EmptyState title="No records" description="No records match the current filter." />
      )}

      {!isLoading && !!records?.records.length && (
        <div className={cn("card overflow-clip transition-opacity", isFetching && "opacity-60")}>
          <Pagination
            placement="top"
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            total={records.total}
            pageSize={pageSize}
          />
          <TableScroll ref={tableRef}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Supplier GSTIN</th>
                  <th>Supplier</th>
                  <th>Invoice #</th>
                  <th>Date</th>
                  <th className="text-right">Taxable</th>
                  <th className="text-right">CGST</th>
                  <th className="text-right">SGST</th>
                  <th className="text-right">IGST</th>
                  <th className="text-center">ITC</th>
                  <th className="text-center">Status</th>
                  <th className="text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {records.records.map((r) => {
                  const badge = matchBadge(r.matchStatus);
                  const expanded = expandedId === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr className={cn(expanded && "bg-surface-1")}>
                        <td className="font-mono text-xs text-text-secondary">{r.supplierGstin}</td>
                        <td className="text-text-primary max-w-[140px] truncate">{r.supplierName ?? "—"}</td>
                        <td className="text-text-primary font-medium">{r.invoiceNumber}</td>
                        <td className="text-text-secondary text-xs">
                          {r.invoiceDate ? formatDate(r.invoiceDate) : "—"}
                        </td>
                        <td className="text-right text-text-primary">{fmt(r.taxableValue)}</td>
                        <td className="text-right text-text-secondary">{fmt(r.cgst)}</td>
                        <td className="text-right text-text-secondary">{fmt(r.sgst)}</td>
                        <td className="text-right text-text-secondary">{fmt(r.igst)}</td>
                        <td className="text-center">
                          <span className={cn(
                            "px-1.5 py-0.5 rounded text-xs font-medium",
                            r.itcAvailable === "Y"
                              ? "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400"
                              : "bg-surface-2 text-text-tertiary",
                          )}>
                            {r.itcAvailable === "Y" ? "Yes" : r.itcAvailable === "N" ? "No" : "—"}
                          </span>
                        </td>
                        <td className="text-center">
                          <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", badge.cls)}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="text-right" onClick={(e) => e.stopPropagation()}>
                          <RowActions
                            label={r.invoiceNumber}
                            items={tidyMenu([
                              (r.matchStatus === "mismatched" || !!r.mismatchReasons) && {
                                label: expanded ? "Hide details" : "Show details",
                                onSelect: () => setExpandedId(expanded ? null : r.id),
                              },
                              { kind: "separator" },
                              r.matchStatus !== "ignored" && {
                                label: "Ignore record",
                                disabled: ignoreMutation.isPending,
                                onSelect: () => ignoreMutation.mutate({ recordId: r.id }),
                              },
                            ])}
                          />
                        </td>
                      </tr>

                      {/* Mismatch detail expansion */}
                      {expanded && r.mismatchReasons && r.mismatchReasons.length > 0 && (
                        <tr className="bg-amber-50/40 dark:bg-amber-950/20">
                          <td colSpan={11}>
                            <div className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">
                              Mismatch details:
                            </div>
                            <ul className="list-disc list-inside space-y-0.5">
                              {r.mismatchReasons.map((reason) => (
                                <li key={reason} className="text-xs text-amber-700 dark:text-amber-400">
                                  {mismatchLabel(reason)}
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            total={records.total}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
          />
        </div>
      )}
    </div>
  );
}

// ── Missing in Books ──────────────────────────────────────────

function MissingInBooksSection({ year, month }: { year: number; month: number }) {
  const period = returnPeriod(year, month);
  const { page, setPage, pageSize, setPageSize, tableRef } = usePagedTable("gstr2b-missing-books", period);

  const { data: summary } = trpc.gstr2b.summary.useQuery({ returnPeriod: period });
  const resolvedUploadId = summary?.uploadId ?? null;

  const { data, isLoading, isFetching } = trpc.gstr2b.missingInBooks.useQuery(
    { uploadId: resolvedUploadId!, page, limit: pageSize },
    {
      enabled: !!resolvedUploadId,
      // Keep the current page on screen while the next one loads.
      placeholderData: (prev) => prev,
    },
  );
  const totalPages = useTotalPages(data?.total ?? 0, pageSize, page, setPage);

  if (!summary?.hasData) {
    return (
      <EmptyState
        title="No GSTR-2B data for this period"
        description="Upload a GSTR-2B file first."
      />
    );
  }

  if (isLoading) return <TableSkeleton rows={6} columns={[{ label: "Supplier GSTIN" }, { label: "Supplier" }, { label: "Invoice #", kind: "mono" }, { label: "Date" }, { label: "Taxable", align: "right" }, { label: "CGST", align: "right" }, { label: "SGST", align: "right" }, { label: "IGST", align: "right" }, { label: "ITC", align: "center" }]} />;

  if (!data?.records.length) {
    return (
      <EmptyState
        title="All suppliers accounted for"
        description="No invoices found in GSTR-2B that are missing from your purchase records."
      />
    );
  }

  return (
    <div>
      <p className="text-sm text-text-secondary mb-4">
        These invoices are reported in the GSTR-2B by your suppliers but are absent from your purchase records.
        Create a purchase invoice to claim the ITC.
      </p>

      <div className={cn("card overflow-clip transition-opacity", isFetching && "opacity-60")}>
        <Pagination
          placement="top"
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          total={data.total}
          pageSize={pageSize}
        />
        <TableScroll ref={tableRef}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Supplier GSTIN</th>
                <th>Supplier</th>
                <th>Invoice #</th>
                <th>Date</th>
                <th className="text-right">Taxable</th>
                <th className="text-right">CGST</th>
                <th className="text-right">SGST</th>
                <th className="text-right">IGST</th>
                <th className="text-center">ITC</th>
              </tr>
            </thead>
            <tbody>
              {data.records.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-xs text-text-secondary">{r.supplierGstin}</td>
                  <td className="text-text-primary">{r.supplierName ?? "—"}</td>
                  <td className="font-medium text-text-primary">{r.invoiceNumber}</td>
                  <td className="text-text-secondary text-xs">
                    {r.invoiceDate ? formatDate(r.invoiceDate) : "—"}
                  </td>
                  <td className="text-right text-text-primary">{fmt(r.taxableValue)}</td>
                  <td className="text-right text-text-secondary">{fmt(r.cgst)}</td>
                  <td className="text-right text-text-secondary">{fmt(r.sgst)}</td>
                  <td className="text-right text-text-secondary">{fmt(r.igst)}</td>
                  <td className="text-center">
                    <span className={cn(
                      "px-1.5 py-0.5 rounded text-xs font-medium",
                      r.itcAvailable === "Y"
                        ? "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400"
                        : "bg-surface-2 text-text-tertiary",
                    )}>
                      {r.itcAvailable === "Y" ? "Available" : r.itcAvailable === "N" ? "Blocked" : "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          total={data.total}
          pageSize={pageSize}
          onPageSizeChange={setPageSize}
        />
      </div>
    </div>
  );
}

// ── Missing in 2B ─────────────────────────────────────────────

function MissingIn2BSection({ year, month }: { year: number; month: number }) {
  const period = returnPeriod(year, month);
  const { page, setPage, pageSize, setPageSize, tableRef } = usePagedTable("gstr2b-missing-2b", period);

  const { data, isLoading, isFetching } = trpc.gstr2b.missingIn2B.useQuery(
    { returnPeriod: period, page, limit: pageSize },
    // Keep the current page on screen while the next one loads.
    { placeholderData: (prev) => prev },
  );
  const totalPages = useTotalPages(data?.total ?? 0, pageSize, page, setPage);

  if (isLoading) return <TableSkeleton rows={6} columns={[{ label: "Supplier GSTIN" }, { label: "Supplier" }, { label: "Invoice #", kind: "mono" }, { label: "Date" }, { label: "Amount", align: "right" }]} />;

  if (!data?.records.length) {
    return (
      <EmptyState
        title="All purchase invoices accounted for"
        description="All your purchase invoices with a supplier GSTIN appear in the GSTR-2B."
      />
    );
  }

  return (
    <div>
      <p className="text-sm text-text-secondary mb-4">
        These purchase invoices are in your books but not in the GSTR-2B. Follow up with the
        supplier to ensure they file their return correctly.
      </p>

      <div className={cn("card overflow-clip transition-opacity", isFetching && "opacity-60")}>
        <Pagination
          placement="top"
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          total={data.total}
          pageSize={pageSize}
        />
        <TableScroll ref={tableRef}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Supplier GSTIN</th>
                <th>Supplier</th>
                <th>Invoice #</th>
                <th>Date</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.records.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-xs text-text-secondary">{r.partyGstin ?? "—"}</td>
                  <td className="text-text-primary">{r.partyName ?? "—"}</td>
                  <td className="font-medium text-text-primary">
                    {r.supplierInvoiceNumber ?? r.invoiceNumber}
                    {r.supplierInvoiceNumber && (
                      <span className="block text-xs font-normal text-text-tertiary">{r.invoiceNumber}</span>
                    )}
                  </td>
                  <td className="text-text-secondary text-xs">
                    {r.invoiceDate ? formatDate(r.invoiceDate) : "—"}
                  </td>
                  <td className="text-right text-text-primary">{fmt(r.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          total={data.total}
          pageSize={pageSize}
          onPageSizeChange={setPageSize}
        />
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────

export function GSTR2BPage() {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [activeTab, setActiveTabRaw] = useState<G2BTab>(
    () => (localStorage.getItem("fintranzact_gstr2b_tab") as G2BTab) || "upload",
  );

  const setActiveTab = (tab: G2BTab) => {
    setActiveTabRaw(tab);
    localStorage.setItem("fintranzact_gstr2b_tab", tab);
  };

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  const tabs: Array<{ value: G2BTab; label: string }> = [
    { value: "upload",         label: "Upload" },
    { value: "reconciliation", label: "Reconciliation" },
    { value: "missing-books",  label: "Not in Books" },
    { value: "missing-2b",     label: "Not in 2B" },
    { value: "history",        label: "Upload History" },
  ];

  return (
    <div>
      <PageHeader
        title="GSTR-2B Reconciliation"
        description="Reconcile supplier-reported inward supplies against your purchase records to verify ITC"
      />

      {/* Tab bar — five tabs don't fit a phone: the bar scrolls sideways on
          its own instead of the page. */}
      <div className="mb-6 min-w-0 max-w-full overflow-x-auto" data-testid="gstr2b-tabs">
        <PillTabs
          tabs={tabs}
          value={activeTab}
          onChange={(v) => setActiveTab(v as G2BTab)}
          className="w-max"
        />
      </div>

      {/* Period selector */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Select
          className="input w-40"
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          aria-label="Select month"
        >
          {months.map((m, i) => (
            <option key={i} value={i + 1}>{m}</option>
          ))}
        </Select>
        <Select
          className="input w-28"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          aria-label="Select year"
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </Select>
        <span className="text-xs text-text-tertiary ml-2">
          Return period: {months[month - 1]} {year}
        </span>
      </div>

      {activeTab === "upload" && (
        <UploadSection
          year={year}
          month={month}
          onUploadSuccess={() => setActiveTab("reconciliation")}
        />
      )}
      {activeTab === "reconciliation" && (
        <ReconciliationSection year={year} month={month} />
      )}
      {activeTab === "missing-books" && (
        <MissingInBooksSection year={year} month={month} />
      )}
      {activeTab === "missing-2b" && (
        <MissingIn2BSection year={year} month={month} />
      )}
      {activeTab === "history" && (
        <UploadHistorySection
          onSelectUpload={(period) => {
            // Open the reconciliation for that upload's own month, not whatever month is picked above.
            const [y, m] = period.split("-").map(Number);
            if (y && m) {
              setYear(y);
              setMonth(m);
            }
            setActiveTab("reconciliation");
          }}
        />
      )}
    </div>
  );
}
