import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { usePageSearch } from "@/lib/page-search";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, getInitials, cn, downloadCSV, toISOString } from "@/lib/utils";
import { useSaveTick } from "@/hooks/useSaveTick";
import { SavedTick } from "@/components/ui/SavedTick";
import { useFlashRows } from "@/hooks/useFlashRows";
import { toast } from "@/hooks/useToast";
import { useDebounce } from "@/hooks/useDebounce";
import { useHotkeys } from "@/hooks/useHotkeys";
import { usePageSize } from "@/hooks/usePageSize";
import { useDeleteConfirmation } from "@/hooks/useDeleteConfirmation";
import {
  GSTIN_REGEX,
  PAN_REGEX,
  IFSC_REGEX,
  UDYAM_REGEX,
  panFromGstin,
  stateCodeFromGstin,
  constitutionFromPan,
  partyGstTypes,
  partyGstTypeLabels,
  partyConstitutions,
  partyConstitutionLabels,
  msmeCategories,
  tdsSections,
  tdsRateFor,
  partyComplianceWarnings,
  type PartyType,
  type PartyGstType,
  type PartyConstitution,
  type MsmeCategory,
  type GstinStatus,
} from "@fintranzact/shared";
import type { GstinFormValues } from "@fintranzact/shared";
import { PartyPriceLevel, PriceLevelSelect } from "@/components/pricing/PriceLevelSelect";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { InputField, TextareaField } from "@/components/ui/FormField";
import { SegmentedControl, PillTabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeleteConfirmDialog } from "@/components/ui/DeleteConfirmDialog";
import { LinkButton } from "@/components/ui/LinkButton";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { Disclosure } from "@/components/ui/Disclosure";
import { KbdShortcut } from "@/components/ui/KbdShortcut";
import { ListCard, FilterField } from "@/components/ui/ListCard";
import { SortableTh, type SortOption, type SortState } from "@/components/ui/Table";
import { RowActions, tidyMenu } from "@/components/ui/Menu";
import { SlideOver } from "@/components/ui/SlideOver";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Icon } from "@/components/ui/Icon";
import { Alert02Icon, ArrowRight01Icon, ArrowRight02Icon, Cancel01Icon, Download04Icon } from "@hugeicons/core-free-icons";

import { Spinner } from "@/components/ui/Spinner";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { GstinInput } from "@/components/settings/GstinInput";
import { GstinSearch } from "@/components/parties/GstinSearch";
import { Select } from "@/components/ui/Select";
import { INDIAN_STATES } from "@/lib/indian-states";
import {
  PartyShippingAddresses,
  shippingAddressesPayload,
  type ShippingAddressDraft,
} from "@/components/PartyShippingAddresses";
export const Route = createFileRoute("/parties")({
  component: PartiesPage,
});

type PartyStatus = "all" | "outstanding" | "overdue";

type PartySortKey = "name" | "balance";

const SORT_OPTIONS: SortOption<PartySortKey>[] = [
  { key: "name", dir: "asc", label: "Name A to Z" },
  { key: "name", dir: "desc", label: "Name Z to A" },
  { key: "balance", dir: "desc", label: "Balance high to low" },
  { key: "balance", dir: "asc", label: "Balance low to high" },
];

function countFilled(...values: string[]): number {
  return values.filter((v) => v.trim() !== "").length;
}

function PartiesPage() {
  const [search] = usePageSearch("Search by name…");
  const [typeFilter, setTypeFilter] = useState<"all" | "customer" | "supplier">("all");
  const [statusFilter, setStatusFilter] = useState<PartyStatus>("all");
  const [sort, setSort] = useState<SortState<PartySortKey>>({ key: "name", dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("parties", 25);
  const tableRef = useRef<HTMLDivElement>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const deleteConfirm = useDeleteConfirmation();
  const [selectedPartyId, setSelectedPartyId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const debouncedSearch = useDebounce(search, 300);

  // Back to page 1 whenever search, filter, sort or rows per page change
  useEffect(() => { setPage(1); }, [debouncedSearch, typeFilter, statusFilter, sort.key, sort.dir, pageSize]);
  // A new page starts at its first row.
  useEffect(() => { tableRef.current?.scrollTo({ top: 0 }); }, [page]);

  const listInput = {
    search: debouncedSearch || undefined,
    type: typeFilter === "all" ? undefined : typeFilter,
    filter: statusFilter === "all" ? undefined : statusFilter,
    sortBy: sort.key,
    sortDir: sort.dir,
    page,
    limit: pageSize,
  };
  const { data, isFetching, isLoading, isPlaceholderData } = trpc.party.list.useQuery(listInput, {
    // Keep the current page on screen while the next one loads.
    placeholderData: (prev) => prev,
  });
  // Rows just added or saved glow green for a moment.
  const flash = useFlashRows(isPlaceholderData ? undefined : data?.data, JSON.stringify(listInput));

  // Tab counts ignore search and the balance filter, so they show what each tab holds.
  const { data: allCount } = trpc.party.list.useQuery({ page: 1, limit: 1 });
  const { data: customerCount } = trpc.party.list.useQuery({ type: "customer", page: 1, limit: 1 });
  const { data: supplierCount } = trpc.party.list.useQuery({ type: "supplier", page: 1, limit: 1 });
  const typeTabs = [
    { value: "all", label: "All", count: allCount?.total },
    { value: "customer", label: "Customers", count: customerCount?.total },
    { value: "supplier", label: "Suppliers", count: supplierCount?.total },
  ];
  const hasFilters = typeFilter !== "all" || statusFilter !== "all" || debouncedSearch !== "";

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Deleting the last row of the last page: step back a page.
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const utils = trpc.useUtils();

  async function exportPartiesCSV() {
    setExporting(true);
    try {
      let allData: any[] = [];
      let pg = 1;
      let hasMore = true;
      while (hasMore) {
        const result = await utils.party.list.fetch({
          search: debouncedSearch || undefined,
          type: typeFilter === "all" ? undefined : typeFilter,
          filter: statusFilter === "all" ? undefined : statusFilter,
          page: pg,
          limit: 100,
        });
        allData = [...allData, ...result.data];
        hasMore = allData.length < result.total;
        pg++;
      }

      const headers = ["Name", "Type", "Phone", "Email", "GSTIN", "Balance"];
      const rows = allData.map((p: any) => [
        p.name,
        p.type,
        p.phone || "",
        p.email || "",
        p.gstin || "",
        p.balance || "0",
      ]);

      downloadCSV(`parties_${typeFilter}${statusFilter === "all" ? "" : `_${statusFilter}`}`, headers, rows);
    } finally {
      setExporting(false);
    }
  }

  const deleteMutation = trpc.party.delete.useMutation({
    onSuccess: () => {
      utils.party.list.invalidate();
      deleteConfirm.cancelDelete();
      toast.success("Party deleted");
    },
    onError: (err) => {
      toast.error(err.message);
      // Close the confirmation: the refusal is the answer, not a retry prompt.
      deleteConfirm.cancelDelete();
    },
  });

  useHotkeys([
    {
      key: "n",
      handler: () => setShowAddModal(true),
      description: "New party",
      scope: "parties",
    },
  ]);

  function confirmDelete(id: string, name: string) {
    deleteConfirm.requestDelete(id, name);
  }

  return (
    <div>
      <PageHeader
        title="Parties"
        description="Manage your customers and suppliers"
        actions={
          <button
            className="btn-primary inline-flex items-center gap-2"
            onClick={() => setShowAddModal(true)}
          >
            + Add Party
            <KbdShortcut keys={["N"]} className="opacity-60" />
          </button>
        }
      />

      {isLoading ? (
        <SkeletonRows count={5} height="h-12" />
      ) : !data?.total && !isFetching && !hasFilters ? (
        <EmptyState
          title="No parties found"
          description="Add your first customer or supplier to get started."
          encouragement="No customers yet? Add your first customer to create an invoice."
          action={
            <button className="btn-primary" onClick={() => setShowAddModal(true)}>
              + Add Party
            </button>
          }
        />
      ) : (
        <ListCard
          tabs={{ tabs: typeTabs, value: typeFilter, onChange: (v) => setTypeFilter(v as typeof typeFilter), label: "Party type" }}
          filters={
            <FilterField label="Balance" value={statusFilter} onChange={(v) => setStatusFilter(v as PartyStatus)}>
              <option value="all">All balances</option>
              <option value="outstanding">Outstanding</option>
              <option value="overdue">Has overdue invoices</option>
            </FilterField>
          }
          sort={{ options: SORT_OPTIONS, value: sort, onChange: setSort }}
          onClearFilters={hasFilters ? () => { setTypeFilter("all"); setStatusFilter("all"); } : undefined}
          actions={
            data && data.total > 0 ? (
              <button
                onClick={exportPartiesCSV}
                disabled={exporting}
                className="btn-secondary inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs"
              >
                {exporting ? (
                  <>
                    <Spinner size="xs" />
                    Preparing…
                  </>
                ) : (
                  <>
                    <Icon icon={Download04Icon} size={14} />
                    Export CSV
                  </>
                )}
              </button>
            ) : undefined
          }
          pagination={{ page, totalPages, onPageChange: setPage, total, pageSize, onPageSizeChange: setPageSize }}
          fetching={isFetching}
          tableRef={tableRef}
          empty={
            !rows.length ? (
              <div className="px-4 py-14 text-center">
                <p className="text-sm font-semibold text-text-primary">No parties match these filters</p>
                <p className="mt-1 text-xs text-text-tertiary">Try another tab or search, or clear the filters.</p>
              </div>
            ) : undefined
          }
        >
          <table className="data-table w-full">
            <thead>
              <tr>
                <SortableTh sortKey="name" sort={sort} onSort={setSort}>Name</SortableTh>
                <th>Type</th>
                <th>Phone</th>
                <th>GSTIN</th>
                <SortableTh sortKey="balance" sort={sort} onSort={setSort} firstDir="desc" align="right">Balance</SortableTh>
                <th className="text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((party) => (
                <tr
                  key={party.id}
                  className={cn("cursor-pointer", flash.has(party.id) && "animate-row-flash")}
                  onClick={() => setSelectedPartyId(party.id)}
                >
                  <td>
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium text-white ${party.type === "customer" ? "bg-emerald-500" : "bg-blue-500"}`}
                      >
                        {getInitials(party.name)}
                      </div>
                      <span className="font-medium">{party.name}</span>
                    </div>
                  </td>
                  <td className="capitalize text-text-secondary">{party.type}</td>
                  <td className="text-text-secondary">{party.phone || "—"}</td>
                  <td className="font-mono text-ui text-text-secondary">
                    {party.gstin || "—"}
                  </td>
                  <td className="text-right tabular-nums font-medium">
                    {party.balance && party.balance !== "0"
                      ? formatCurrency(party.balance)
                      : "—"}
                  </td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    <RowActions
                      label={party.name}
                      items={tidyMenu([
                        { label: "Open", hint: "Enter", onSelect: () => setSelectedPartyId(party.id) },
                        { kind: "separator" },
                        { label: "Delete party", danger: true, onSelect: () => confirmDelete(party.id, party.name) },
                      ])}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ListCard>
      )}

      {/* Add Party Modal */}
      <AddPartyModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
      />

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        target={deleteConfirm.deleteTarget}
        entityName="Party"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteConfirm.deleteTarget) deleteMutation.mutate({ id: deleteConfirm.deleteTarget.id });
        }}
        onCancel={deleteConfirm.cancelDelete}
      />

      {/* Party Detail SlideOver */}
      {selectedPartyId && (
        <PartyDetailPanel
          partyId={selectedPartyId}
          onClose={() => setSelectedPartyId(null)}
        />
      )}
    </div>
  );
}

// ── Party Detail Panel ──────────────────────────────────────────────

const PARTY_DETAIL_TABS = [
  { value: "overview", label: "Overview" },
  { value: "ledger", label: "Ledger" },
  { value: "invoices", label: "Invoices" },
  { value: "payments", label: "Payments" },
  { value: "top-items", label: "Top Items" },
];

function PartyDetailPanel({ partyId, onClose }: { partyId: string; onClose: () => void }) {
  const [tab, setTab] = useState("overview");
  const [showMerge, setShowMerge] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const navigate = useNavigate();

  const { data: party } = trpc.party.getById.useQuery({ id: partyId });

  const { data: ledger } = trpc.party.ledger.useQuery(
    { partyId, page: 1, limit: 30 },
    { enabled: tab === "ledger" || tab === "overview" }
  );

  const { data: invoiceList } = trpc.invoice.list.useQuery(
    { partyId, page: 1, limit: 20 },
    { enabled: tab === "invoices" }
  );

  const { data: paymentList } = trpc.payment.list.useQuery(
    { partyId, page: 1, limit: 30 },
    { enabled: tab === "payments" }
  );

  const { data: topItems } = trpc.party.topItems.useQuery(
    { partyId },
    { enabled: tab === "top-items" || tab === "overview" }
  );

  const [verifyPan, setVerifyPan] = useState(false);
  const panCheck = trpc.tds.verifyDeductee.useQuery(
    { partyId },
    { enabled: verifyPan && !!party?.pan, staleTime: 5 * 60_000, retry: false },
  );

  if (!party) return null;

  const balanceNum = parseFloat(party.balance);
  const isPositiveBalance = balanceNum > 0;

  return (
    <>
    <SlideOver
      open={true}
      onClose={onClose}
      title={party.name}
      description={[
        party.type === "customer" ? "Customer" : "Supplier",
        party.phone,
        party.gstin,
      ].filter(Boolean).join(" · ")}
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setShowEdit(true)}
            className="btn-secondary text-xs px-3 py-1.5"
          >
            Edit
          </button>
          <button
            onClick={() => setShowMerge(true)}
            className="text-xs px-3 py-1.5 rounded-lg font-medium text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/50 border border-amber-200 dark:border-amber-800 transition-colors"
          >
            Merge
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Tabs */}
        <PillTabs tabs={PARTY_DETAIL_TABS} value={tab} onChange={setTab} />

        {/* ── Overview ─────────────────────────────────── */}
        {tab === "overview" && (
          <div className="space-y-4">
            {/* Party info + Balance cards */}
            <div className="grid grid-cols-2 gap-3">
              {/* Party Info */}
              <div className="rounded-xl bg-surface-1 border border-border-light p-4 space-y-2">
                <p className="text-2xs font-semibold uppercase tracking-wider text-text-tertiary">
                  Party Info
                </p>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-medium",
                        party.type === "customer"
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                          : "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
                      )}
                    >
                      {party.type === "customer" ? "Customer" : "Supplier"}
                    </span>
                  </div>
                  {party.phone && (
                    <p className="text-sm text-text-secondary">{party.phone}</p>
                  )}
                  {party.email && (
                    <p className="text-sm text-text-secondary">{party.email}</p>
                  )}
                  {party.gstin && (
                    <p className="font-mono text-ui text-text-secondary">{party.gstin}</p>
                  )}
                  {party.pan && (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-ui text-text-secondary">PAN: {party.pan}</p>
                      <button
                        type="button"
                        className="text-2xs font-medium text-primary hover:underline disabled:opacity-50"
                        disabled={panCheck.isFetching}
                        onClick={() => (verifyPan ? panCheck.refetch() : setVerifyPan(true))}
                      >
                        {panCheck.isFetching ? "Checking…" : "Verify PAN"}
                      </button>
                      {panCheck.data && !panCheck.data.available && (
                        <span className="text-2xs text-text-tertiary">Verification is not enabled on this server.</span>
                      )}
                      {panCheck.data?.available && !panCheck.data.checked && (
                        <span className="text-2xs text-text-tertiary">{panCheck.data.reason}</span>
                      )}
                      {panCheck.data?.available && panCheck.data.checked && panCheck.data.valid && (
                        <span className="text-2xs text-emerald-600">
                          PAN is valid{panCheck.data.nameMatch === false ? ", but the name does not match" : panCheck.data.nameMatch ? ", name matches" : ""}.
                        </span>
                      )}
                      {panCheck.data?.available && panCheck.data.checked && !panCheck.data.valid && (
                        <span className="text-2xs text-amber-600">
                          PAN could not be validated ({panCheck.data.status}). TDS is still deducted at the section rate; the no-PAN rate (s.206AA) applies only if the party is marked as having no PAN.
                        </span>
                      )}
                    </div>
                  )}
                  {party.legalName && party.legalName !== party.name && (
                    <p className="text-ui text-text-secondary">Legal name: {party.legalName}</p>
                  )}
                  {party.tradeName && party.tradeName !== party.name && (
                    <p className="text-ui text-text-secondary">Trade name: {party.tradeName}</p>
                  )}
                  {party.gstRegistrationType && (
                    <p className="text-ui text-text-secondary">
                      {partyGstTypeLabels[party.gstRegistrationType as PartyGstType] ?? party.gstRegistrationType}
                      {party.constitution && ` · ${partyConstitutionLabels[party.constitution as PartyConstitution] ?? party.constitution}`}
                    </p>
                  )}
                  {party.gstinStatus && (
                    <p className={cn("text-ui", party.gstinStatus === "active" ? "text-green-600" : "text-red-600")}>
                      GSTIN {party.gstinStatus}
                      {party.gstinVerifiedAt && ` (checked ${formatDate(party.gstinVerifiedAt)})`}
                    </p>
                  )}
                  {party.isMsme && (
                    <p className="text-ui text-text-secondary">
                      MSME{party.msmeCategory ? ` (${party.msmeCategory})` : ""}{party.udyamNumber ? ` · ${party.udyamNumber}` : ""}
                    </p>
                  )}
                  {party.tdsSection && (
                    <p className="text-ui text-text-secondary">
                      TDS: {tdsSections.find((t) => t.code === party.tdsSection)?.label ?? party.tdsSection} @ {tdsRateFor(party)}%
                    </p>
                  )}
                  {party.type === "customer" && <PartyPriceLevel partyId={party.id} priceLevelId={party.priceLevelId ?? null} />}
                </div>
              </div>

              {/* Balance */}
              <div className="rounded-xl bg-surface-1 border border-border-light p-4 space-y-2">
                <p className="text-2xs font-semibold uppercase tracking-wider text-text-tertiary">
                  Balance
                </p>
                <p
                  className={cn(
                    "text-2xl font-bold tabular-nums",
                    isPositiveBalance ? "text-emerald-600" : balanceNum < 0 ? "text-red-600" : "text-text-primary"
                  )}
                >
                  {formatCurrency(party.balance)}
                </p>
                {isPositiveBalance && (
                  <p className="text-xs font-medium text-emerald-600">Receivable</p>
                )}
                {balanceNum < 0 && (
                  <p className="text-xs font-medium text-red-600">Payable</p>
                )}
                <p className="text-xs text-text-tertiary">
                  Opening: {formatCurrency(party.openingBalance)}
                </p>
                {(party.creditPeriodDays || party.creditLimit) && (
                  <div className="pt-1 border-t border-border-light space-y-0.5">
                    {party.creditPeriodDays && (
                      <p className="text-xs text-text-secondary">
                        Credit period: <span className="font-medium">{party.creditPeriodDays} days</span>
                      </p>
                    )}
                    {party.creditLimit && (
                      <p className="text-xs text-text-secondary">
                        Credit limit: <span className="font-medium">{formatCurrency(party.creditLimit)}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {(() => {
              const partyWarnings = partyComplianceWarnings(party);
              return partyWarnings.length > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" role="status">
                  <ul className="list-disc pl-4 space-y-1">
                    {partyWarnings.map((w) => <li key={w}>{w}</li>)}
                  </ul>
                </div>
              );
            })()}

            {party.additionalShippingAddresses && party.additionalShippingAddresses.length > 0 && (
              <div className="rounded-xl border border-border-light p-4 space-y-2">
                <p className="text-2xs font-semibold uppercase tracking-wider text-text-tertiary">
                  Shipping addresses
                </p>
                {party.shippingAddress && (
                  <p className="text-ui text-text-secondary">{party.shippingAddress}</p>
                )}
                {party.additionalShippingAddresses.map((a, i) => (
                  <p key={i} className="text-ui text-text-secondary">
                    {a.label && <span className="font-medium text-text-primary">{a.label}: </span>}
                    {[a.address, a.city, a.state, a.pincode].filter(Boolean).join(", ")}
                  </p>
                ))}
              </div>
            )}

            {/* Top Items preview */}
            {topItems && topItems.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-text-secondary">
                    {party.type === "customer" ? "Items purchased by" : "Items supplied by"} {party.name}
                  </p>
                  <LinkButton
                    className="text-xs"
                    onClick={() => setTab("top-items")}
                  >
                    View all
                  </LinkButton>
                </div>
                <div className="rounded-2xl border border-border-light bg-surface-0 overflow-hidden">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Item</th>
                        <th className="text-right">Qty</th>
                        <th className="text-right">Amount</th>
                        <th className="text-right">Invoices</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topItems.map((item, i) => (
                        <tr key={item.itemId ?? i}>
                          <td>
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface-2 text-2xs font-semibold text-text-tertiary">
                              {i + 1}
                            </span>
                          </td>
                          <td className="font-medium">{item.itemName}</td>
                          <td className="text-right tabular-nums text-text-secondary">
                            {parseFloat(item.totalQuantity).toLocaleString("en-IN")}
                          </td>
                          <td className="text-right tabular-nums font-medium">
                            {formatCurrency(item.totalAmount)}
                          </td>
                          <td className="text-right">
                            <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-2xs font-medium bg-surface-2 text-text-secondary">
                              {item.invoiceCount}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Recent ledger preview */}
            {ledger && ledger.data.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-text-secondary">Recent Activity</p>
                  <LinkButton
                    className="text-xs"
                    onClick={() => setTab("ledger")}
                  >
                    View all
                  </LinkButton>
                </div>
                <div className="rounded-2xl border border-border-light bg-surface-0 overflow-hidden">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Document</th>
                        <th className="text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.data.slice(-5).map((row, i) => (
                        <tr key={i}>
                          <td className="text-text-secondary text-xs">{formatDate(row.date)}</td>
                          <td>
                            <span
                              className={cn(
                                "inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium",
                                row.type === "payment"
                                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                                  : row.type === "credit_note" || row.type === "sales_return"
                                    ? "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-400"
                                    : "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
                              )}
                            >
                              {{ payment: "Payment", purchase: "Purchase", invoice: "Invoice", credit_note: "Credit Note", sales_return: "Sales Return", purchase_return: "Purchase Return", debit_note: "Debit Note" }[row.type] ?? row.type}
                            </span>
                          </td>
                          <td className="font-mono text-ui text-text-secondary">{row.documentNumber}</td>
                          <td className="text-right tabular-nums font-medium text-text-primary">
                            {formatCurrency(row.runningBalance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Ledger ──────────────────────────────────────── */}
        {tab === "ledger" && (
          <div>
            {!ledger?.data.length ? (
              <EmptyState
                title="No ledger entries"
                description="Invoices and payments for this party will appear here."
              />
            ) : (
              <div className="rounded-2xl border border-border-light bg-surface-0 overflow-hidden">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Document #</th>
                      <th className="text-right">Debit</th>
                      <th className="text-right">Credit</th>
                      <th className="text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.data.map((row, i) => {
                      const debitNum = parseFloat(row.debit);
                      const creditNum = parseFloat(row.credit);
                      return (
                        <tr key={i}>
                          <td className="text-text-secondary text-xs">{formatDate(row.date)}</td>
                          <td>
                            <span
                              className={cn(
                                "inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium",
                                row.type === "payment"
                                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                                  : row.type === "credit_note" || row.type === "sales_return"
                                    ? "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-400"
                                    : "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
                              )}
                            >
                              {{ payment: "Payment", purchase: "Purchase", invoice: "Invoice", credit_note: "Credit Note", sales_return: "Sales Return", purchase_return: "Purchase Return", debit_note: "Debit Note" }[row.type] ?? row.type}
                            </span>
                          </td>
                          <td>
                            <LinkButton
                              className="font-mono text-ui"
                              onClick={() => {
                                const routes: Record<string, string> = {
                                  payment: "/payments",
                                  invoice: "/invoices",
                                  purchase: "/invoices",
                                  credit_note: "/credit-notes",
                                  sales_return: "/sales-returns",
                                  purchase_return: "/purchase-returns",
                                  debit_note: "/invoices",
                                };
                                onClose();
                                navigate({ to: routes[row.type] ?? "/invoices", search: { id: row.documentId } });
                              }}
                            >
                              {row.documentNumber}
                            </LinkButton>
                          </td>
                          <td className="text-right tabular-nums text-text-secondary">
                            {debitNum > 0 ? formatCurrency(row.debit) : "—"}
                          </td>
                          <td className="text-right tabular-nums text-text-secondary">
                            {creditNum > 0 ? formatCurrency(row.credit) : "—"}
                          </td>
                          <td className="text-right tabular-nums font-bold text-text-primary">
                            {formatCurrency(row.runningBalance)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {ledger.total > ledger.data.length && (
                  <div className="px-4 py-2 text-center text-xs text-text-tertiary bg-surface-1">
                    Showing {ledger.data.length} of {ledger.total}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Invoices ─────────────────────────────────────── */}
        {tab === "invoices" && (
          <div>
            {!invoiceList?.data.length ? (
              <EmptyState
                title="No invoices"
                description="Invoices for this party will appear here."
              />
            ) : (
              <div className="rounded-2xl border border-border-light bg-surface-0 overflow-hidden">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Invoice #</th>
                      <th>Date</th>
                      <th>Status</th>
                      <th className="text-right">Total</th>
                      <th className="text-right">Balance Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceList.data.map((inv) => {
                      const balanceDue = parseFloat(inv.totalAmount) - parseFloat(inv.amountPaid);
                      return (
                        <tr
                          key={inv.id}
                          className="cursor-pointer"
                          onClick={() => {
                            onClose();
                            navigate({ to: "/invoices", search: { id: inv.id } });
                          }}
                        >
                          <td className="font-mono text-ui text-brand-600 hover:underline">
                            {inv.invoiceNumber}
                          </td>
                          <td className="text-text-secondary text-xs">{formatDate(inv.invoiceDate)}</td>
                          <td><StatusBadge status={inv.status} size="sm" /></td>
                          <td className="text-right tabular-nums font-medium">
                            {formatCurrency(inv.totalAmount)}
                          </td>
                          <td className={cn(
                            "text-right tabular-nums font-medium",
                            balanceDue > 0 ? "text-amber-600" : "text-text-secondary"
                          )}>
                            {balanceDue > 0 ? formatCurrency(balanceDue.toFixed(2)) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {invoiceList.total > invoiceList.data.length && (
                  <div className="px-4 py-2 text-center text-xs text-text-tertiary bg-surface-1">
                    Showing {invoiceList.data.length} of {invoiceList.total}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Payments ────────────────────────────────────── */}
        {tab === "payments" && (
          <div className="space-y-3">
            {!paymentList?.data?.length ? (
              <p className="text-sm text-text-tertiary text-center py-6">No payments recorded</p>
            ) : (
              <div className="rounded-2xl border border-border-light bg-surface-0 overflow-hidden">
                <table className="data-table w-full text-sm">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Number</th>
                      <th>Mode</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentList.data.map((pmt: any) => (
                      <tr
                        key={pmt.id}
                        className="cursor-pointer hover:bg-surface-1 transition-colors"
                        onClick={() => navigate({ to: "/payments", search: { id: pmt.id } })}
                      >
                        <td className="text-text-secondary whitespace-nowrap">
                          {formatDate(pmt.paymentDate)}
                        </td>
                        <td className="font-mono text-ui text-text-secondary">
                          {pmt.paymentNumber || "—"}
                        </td>
                        <td>
                          <span className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-medium",
                            pmt.mode === "cash" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                              : pmt.mode === "upi" ? "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-400"
                              : pmt.mode === "bank" ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
                              : "bg-surface-2 text-text-secondary"
                          )}>
                            {pmt.mode === "upi" ? "UPI" : pmt.mode?.charAt(0).toUpperCase() + pmt.mode?.slice(1)}
                          </span>
                        </td>
                        <td className="text-right tabular-nums font-medium whitespace-nowrap">
                          {formatCurrency(pmt.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Top Items ────────────────────────────────────── */}
        {tab === "top-items" && (
          <div>
            {!topItems?.length ? (
              <EmptyState
                title="No items found"
                description="Items will appear here as invoices are created for this party."
              />
            ) : (
              <div>
                <p className="text-xs text-text-tertiary mb-3">
                  {party.type === "customer" ? "Items purchased by" : "Items supplied by"}{" "}
                  <span className="font-medium text-text-secondary">{party.name}</span>
                </p>
                <div className="rounded-2xl border border-border-light bg-surface-0 overflow-hidden">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Item Name</th>
                        <th className="text-right">Total Qty</th>
                        <th className="text-right">Total Amount</th>
                        <th className="text-right">Invoices</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topItems.map((item, i) => (
                        <tr key={item.itemId ?? i}>
                          <td>
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface-2 text-2xs font-semibold text-text-tertiary">
                              {i + 1}
                            </span>
                          </td>
                          <td className="font-medium">{item.itemName}</td>
                          <td className="text-right tabular-nums text-text-secondary">
                            {parseFloat(item.totalQuantity).toLocaleString("en-IN")}
                          </td>
                          <td className="text-right tabular-nums font-medium">
                            {formatCurrency(item.totalAmount)}
                          </td>
                          <td className="text-right">
                            <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-2xs font-medium bg-surface-2 text-text-secondary">
                              {item.invoiceCount}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </SlideOver>
    {showEdit && (
      <AddPartyModal open existing={party} onClose={() => setShowEdit(false)} />
    )}
    {showMerge && (
      <MergePartyModal
        sourceId={partyId}
        sourceName={party.name}
        onClose={() => {
          setShowMerge(false);
          onClose();
        }}
      />
    )}
    </>
  );
}

function MergePartyModal({
  sourceId,
  sourceName,
  onClose,
}: {
  sourceId: string;
  sourceName: string;
  onClose: () => void;
}) {
  const [targetId, setTargetId] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const debouncedTargetSearch = useDebounce(targetSearch, 300);

  const { data: partiesData, isLoading: partiesLoading } = trpc.party.list.useQuery({
    page: 1,
    limit: 100,
    filter: "all",
    search: debouncedTargetSearch || undefined,
  });
  const { data: sourceStats } = trpc.party.getStats.useQuery({ id: sourceId });
  const { data: targetStats } = trpc.party.getStats.useQuery(
    { id: targetId },
    { enabled: !!targetId }
  );

  const utils = trpc.useUtils();

  const mergeMutation = trpc.party.merge.useMutation({
    onSuccess: () => {
      utils.party.list.invalidate();
      // The target now has the source's balance, addresses and documents; a
      // cached copy would show (and an edit would save back) the old ones.
      utils.party.getById.invalidate();
      utils.party.ledger.invalidate();
      toast.success(`"${sourceName}" merged successfully`);
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  // Server-side search filters results; exclude only the source party client-side
  const allParties = (partiesData?.data || []).filter((p) => p.id !== sourceId);

  // Keep a stable reference to the selected target — don't lose it when search results change
  const [selectedTargetCache, setSelectedTargetCache] = useState<{ id: string; name: string; type: string } | null>(null);
  const selectedTarget = selectedTargetCache && targetId === selectedTargetCache.id
    ? selectedTargetCache
    : allParties.find((p) => p.id === targetId) || null;

  function handleSelectTarget(id: string) {
    const party = allParties.find((p) => p.id === id);
    if (party) setSelectedTargetCache({ id: party.id, name: party.name, type: party.type });
    setTargetId(id);
    setConfirmed(false);
  }

  return (
    <Modal open={true} onClose={onClose} title="Merge Parties" className="max-w-lg">
      <div className="space-y-5">

        {/* Two-column direction layout */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-start">
          {/* Source column */}
          <div className="rounded-xl border-2 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-3 space-y-1">
            <p className="text-2xs font-bold uppercase tracking-wider text-red-500 dark:text-red-400">
              Merge FROM
            </p>
            <p className="font-semibold text-sm text-text-primary truncate" title={sourceName}>
              {sourceName}
            </p>
            {sourceStats && (
              <p className="text-2xs text-text-tertiary">
                {sourceStats.invoiceCount} invoice{sourceStats.invoiceCount !== 1 ? "s" : ""}
                {" · "}
                {sourceStats.paymentCount} payment{sourceStats.paymentCount !== 1 ? "s" : ""}
              </p>
            )}
            <p className="text-2xs text-red-500 dark:text-red-400 font-medium mt-1">
              Will be removed
            </p>
          </div>

          {/* Arrow */}
          <div className="flex items-center justify-center pt-6">
            <Icon icon={ArrowRight02Icon} size={20} className="text-text-tertiary" />
          </div>

          {/* Target column */}
          <div className={cn(
            "rounded-xl border-2 p-3 space-y-1 transition-colors",
            selectedTarget
              ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30"
              : "border-dashed border-border-light bg-surface-1"
          )}>
            <p className={cn(
              "text-2xs font-bold uppercase tracking-wider",
              selectedTarget ? "text-emerald-600 dark:text-emerald-400" : "text-text-tertiary"
            )}>
              Merge INTO
            </p>
            {selectedTarget ? (
              <>
                <p className="font-semibold text-sm text-text-primary truncate" title={selectedTarget.name}>
                  {selectedTarget.name}
                </p>
                {targetStats && (
                  <p className="text-2xs text-text-tertiary">
                    {targetStats.invoiceCount} invoice{targetStats.invoiceCount !== 1 ? "s" : ""}
                    {" · "}
                    {targetStats.paymentCount} payment{targetStats.paymentCount !== 1 ? "s" : ""}
                  </p>
                )}
                <p className="text-2xs text-emerald-600 dark:text-emerald-400 font-medium mt-1">
                  Will be kept
                </p>
              </>
            ) : (
              <p className="text-2xs text-text-tertiary italic">Select a party below</p>
            )}
          </div>
        </div>

        {/* Target party selector */}
        <div>
          {selectedTarget ? (
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-text-primary">
                Target: <span className="text-emerald-600">{selectedTarget.name}</span>
              </label>
              <button
                type="button"
                className="text-xs text-brand-600 hover:text-brand-700"
                onClick={() => { setTargetId(""); setSelectedTargetCache(null); setConfirmed(false); }}
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <label className="text-sm font-medium text-text-primary block mb-1.5">
                Select target party <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                className="input w-full mb-2"
                placeholder="Search parties…"
                value={targetSearch}
                onChange={(e) => setTargetSearch(e.target.value)}
                autoFocus
              />
            </>
          )}
          {!selectedTarget && (
          <div className="border border-border-light rounded-lg overflow-hidden max-h-40 overflow-y-auto bg-surface-0">
            {partiesLoading ? (
              <p className="text-sm text-text-tertiary px-3 py-2">Loading parties…</p>
            ) : allParties.length === 0 ? (
              <p className="text-sm text-text-tertiary px-3 py-2 italic">No parties found</p>
            ) : (
              allParties.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectTarget(p.id)}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm transition-colors flex items-center justify-between gap-2",
                    targetId === p.id
                      ? "bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 font-medium"
                      : "hover:bg-surface-2 text-text-primary"
                  )}
                >
                  <span className="truncate">{p.name}</span>
                  <span className="text-2xs text-text-tertiary capitalize shrink-0">{p.type}</span>
                </button>
              ))
            )}
          </div>
          )}
        </div>

        {/* Preview: what will happen */}
        {selectedTarget && (
          <div className="rounded-xl bg-surface-1 border border-border-light p-3 space-y-2">
            <p className="text-xs font-semibold text-text-secondary">What will happen</p>
            <ul className="space-y-1 text-xs text-text-secondary">
              <li className="flex items-start gap-1.5">
                <Icon icon={ArrowRight01Icon} size={14} className="text-brand-500 mt-0.5" />
                <span>
                  Merging <span className="font-medium text-text-primary">{sourceName}</span>
                  {" "}into{" "}
                  <span className="font-medium text-text-primary">{selectedTarget.name}</span>
                </span>
              </li>
              <li className="flex items-start gap-1.5">
                <Icon icon={ArrowRight01Icon} size={14} className="text-brand-500 mt-0.5" />
                <span>
                  The merged party will keep <span className="font-medium text-text-primary">{selectedTarget.name}</span>'s
                  details (address, phone, GSTIN)
                </span>
              </li>
              {sourceStats && (
                <li className="flex items-start gap-1.5">
                  <Icon icon={ArrowRight01Icon} size={14} className="text-brand-500 mt-0.5" />
                  <span>
                    <span className="font-medium text-text-primary">{sourceStats.invoiceCount} invoice{sourceStats.invoiceCount !== 1 ? "s" : ""}</span>
                    {" and "}
                    <span className="font-medium text-text-primary">{sourceStats.paymentCount} payment{sourceStats.paymentCount !== 1 ? "s" : ""}</span>
                    {" from "}
                    <span className="font-medium text-text-primary">{sourceName}</span>
                    {" will be moved to "}
                    <span className="font-medium text-text-primary">{selectedTarget.name}</span>
                  </span>
                </li>
              )}
              {targetStats && (
                <li className="flex items-start gap-1.5">
                  <span className="text-text-tertiary mt-0.5">•</span>
                  <span>
                    <span className="font-medium text-text-primary">{selectedTarget.name}</span>
                    {" already has "}
                    {targetStats.invoiceCount} invoice{targetStats.invoiceCount !== 1 ? "s" : ""}
                    {" and "}
                    {targetStats.paymentCount} payment{targetStats.paymentCount !== 1 ? "s" : ""}
                  </span>
                </li>
              )}
              <li className="flex items-start gap-1.5">
                <Icon icon={ArrowRight01Icon} size={14} className="text-brand-500 mt-0.5" />
                <span>Opening balances will be combined</span>
              </li>
              <li className="flex items-start gap-1.5">
                <Icon icon={Cancel01Icon} size={14} className="text-red-500 mt-0.5" />
                <span>
                  <span className="font-medium text-text-primary">{sourceName}</span> will be permanently deleted
                </span>
              </li>
            </ul>
          </div>
        )}

        {/* Irreversibility warning */}
        {selectedTarget && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3">
            <div className="flex items-start gap-2">
              <Icon icon={Alert02Icon} size={16} className="text-amber-500" />
              <p className="text-xs text-amber-800 dark:text-amber-300">
                <span className="font-semibold">This action is irreversible.</span>{" "}
                All invoices, payments, and credit notes from{" "}
                <span className="font-semibold">{sourceName}</span>{" "}
                will be permanently moved to{" "}
                <span className="font-semibold">{selectedTarget.name}</span>.
              </p>
            </div>
            <label className="flex items-center gap-2 mt-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
              />
              <span className="text-xs text-amber-800 dark:text-amber-300 font-medium">
                I understand this cannot be undone
              </span>
            </label>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-3 border-t border-border-light">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-danger"
            onClick={() => mergeMutation.mutate({ sourceId, targetId })}
            disabled={!targetId || !confirmed || mergeMutation.isPending}
          >
            {mergeMutation.isPending ? "Merging…" : "Merge & Delete"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** The saved party an edit starts from (the fields the form shows). */
type EditableParty = {
  id: string;
  type: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  openingBalance?: string | null;
  gstin?: string | null;
  pan?: string | null;
  category?: string | null;
  billingAddress?: string | null;
  shippingAddress?: string | null;
  additionalShippingAddresses?: Array<{ label?: string; address: string; city?: string; stateCode?: string; pincode?: string }> | null;
  city?: string | null;
  state?: string | null;
  stateCode?: string | null;
  pincode?: string | null;
  creditPeriodDays?: number | null;
  creditLimit?: string | null;
  contactPersonName?: string | null;
  contactPersonDob?: string | Date | null;
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
  bankName?: string | null;
  legalName?: string | null;
  tradeName?: string | null;
  gstRegistrationType?: string | null;
  constitution?: string | null;
  isMsme?: boolean | null;
  udyamNumber?: string | null;
  msmeCategory?: string | null;
  tdsSection?: string | null;
  priceLevelId?: string | null;
};

function AddPartyModal({ open, onClose, existing }: { open: boolean; onClose: () => void; existing?: EditableParty }) {
  const e0 = existing;
  const [partyType, setPartyType] = useState<PartyType>((e0?.type as PartyType) ?? "customer");
  const [name, setName] = useState(e0?.name ?? "");
  const [phone, setPhone] = useState(e0?.phone ?? "");
  const [email, setEmail] = useState(e0?.email ?? "");
  const [openingBalance, setOpeningBalance] = useState(e0?.openingBalance ?? "");
  const [gstin, setGstin] = useState(e0?.gstin ?? "");
  const [pan, setPan] = useState(e0?.pan ?? "");
  // PAN last auto-filled from the GSTIN, so a corrected GSTIN can update it
  // without overwriting a PAN the user typed by hand.
  const [autoPan, setAutoPan] = useState<string | null>(null);
  const [category, setCategory] = useState(e0?.category ?? "");
  const [billingAddress, setBillingAddress] = useState(e0?.billingAddress ?? "");
  const [shippingAddress, setShippingAddress] = useState(e0?.shippingAddress ?? "");
  const [sameAsBilling, setSameAsBilling] = useState(false);
  const [city, setCity] = useState(e0?.city ?? "");
  const [state, setState] = useState(e0?.state ?? "");
  const [pincode, setPincode] = useState(e0?.pincode ?? "");
  const [creditPeriodDays, setCreditPeriodDays] = useState(e0?.creditPeriodDays != null ? String(e0.creditPeriodDays) : "");
  const [creditLimit, setCreditLimit] = useState(e0?.creditLimit ?? "");
  const [contactPersonName, setContactPersonName] = useState(e0?.contactPersonName ?? "");
  const [contactPersonDob, setContactPersonDob] = useState(e0?.contactPersonDob ? new Date(e0.contactPersonDob).toISOString().slice(0, 10) : "");
  const [bankAccountNumber, setBankAccountNumber] = useState(e0?.bankAccountNumber ?? "");
  const [bankIfsc, setBankIfsc] = useState(e0?.bankIfsc ?? "");
  const [bankName, setBankName] = useState(e0?.bankName ?? "");
  const [stateCode, setStateCode] = useState(e0?.stateCode ?? "");
  const [legalName, setLegalName] = useState(e0?.legalName ?? "");
  const [tradeName, setTradeName] = useState(e0?.tradeName ?? "");
  const [gstType, setGstType] = useState<PartyGstType | "">((e0?.gstRegistrationType as PartyGstType) ?? "");
  const [constitution, setConstitution] = useState<PartyConstitution | "">((e0?.constitution as PartyConstitution) ?? "");
  const [gstinStatus, setGstinStatus] = useState<GstinStatus | null>(null);
  const [gstinVerifiedAt, setGstinVerifiedAt] = useState<string | null>(null);
  // Values the form filled in by itself from the GSTIN, so a GST search can
  // replace them without asking (the user never typed them).
  const [autoGstType, setAutoGstType] = useState<PartyGstType | "">("");
  const [autoConstitution, setAutoConstitution] = useState<PartyConstitution | "">("");
  const [gstinBlur, setGstinBlur] = useState(0);
  const [isMsme, setIsMsme] = useState(e0?.isMsme ?? false);
  const [udyamNumber, setUdyamNumber] = useState(e0?.udyamNumber ?? "");
  const [msmeCategory, setMsmeCategory] = useState<MsmeCategory | "">((e0?.msmeCategory as MsmeCategory) ?? "");
  const [tdsSection, setTdsSection] = useState(e0?.tdsSection ?? "");
  const [priceLevelId, setPriceLevelId] = useState(e0?.priceLevelId ?? "");
  const [extraShipping, setExtraShipping] = useState<ShippingAddressDraft[]>(
    () => (e0?.additionalShippingAddresses ?? []).map((a) => ({
      label: a.label ?? "",
      address: a.address,
      city: a.city ?? "",
      stateCode: a.stateCode ?? "",
      pincode: a.pincode ?? "",
    })),
  );

  const utils = trpc.useUtils();

  // Fill PAN, state and business type from a GSTIN without overwriting
  // anything the user has typed themselves.
  function applyGstinDerived(value: string) {
    const derivedPan = panFromGstin(value);
    if (derivedPan && (!pan || pan === autoPan)) {
      setPan(derivedPan);
      setAutoPan(derivedPan);
    }
    const derivedState = stateCodeFromGstin(value);
    if (derivedState) {
      // Code and name move together (the State picker shows the code), so
      // they can never disagree.
      setStateCode(derivedState);
      const stateName = INDIAN_STATES.find((st) => st.code === derivedState)?.name;
      if (stateName) setState(stateName);
    }
    const derivedConstitution = constitutionFromPan(derivedPan);
    if (derivedConstitution && !constitution) {
      setConstitution(derivedConstitution);
      setAutoConstitution(derivedConstitution);
    }
    if (derivedState && !gstType) {
      setGstType("regular");
      setAutoGstType("regular");
    }
  }

  // A GST search fills empty fields; the ones that already hold a value come
  // back through its "Use these details" panel and are applied when confirmed.
  function applyGstinFill(patch: Partial<GstinFormValues>) {
    if (patch.name !== undefined) setName(patch.name);
    if (patch.legalName !== undefined) setLegalName(patch.legalName);
    if (patch.tradeName !== undefined) setTradeName(patch.tradeName);
    if (patch.billingAddress !== undefined) setBillingAddress(patch.billingAddress);
    if (patch.city !== undefined) setCity(patch.city);
    if (patch.state !== undefined) setState(patch.state);
    if (patch.stateCode !== undefined) setStateCode(patch.stateCode);
    if (patch.pincode !== undefined) setPincode(patch.pincode);
    if (patch.gstType !== undefined) {
      setGstType(patch.gstType);
      setAutoGstType("");
    }
    if (patch.constitution !== undefined) {
      setConstitution(patch.constitution);
      setAutoConstitution("");
    }
  }

  // The save button shows a tick before the panel closes.
  const tick = useSaveTick();
  const createMutation = trpc.party.create.useMutation({
    onSuccess: (created) => {
      utils.party.list.invalidate();
      toast.success("Party created");
      if (created.gstinCheck?.warning && created.gstinCheck.status !== "not_configured") toast.warning("GSTIN note", created.gstinCheck.warning);
      // The panel stays mounted: start the next party from a blank form, not
      // with this one's phone, addresses and credit terms.
      tick.finish(() => {
        resetForm();
        onClose();
      });
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const updateMutation = trpc.party.update.useMutation({
    onSuccess: (updated) => {
      utils.party.list.invalidate();
      if (existing) utils.party.getById.invalidate({ id: existing.id });
      toast.success("Party updated");
      if (updated.gstinCheck?.warning && updated.gstinCheck.status !== "not_configured") toast.warning("GSTIN note", updated.gstinCheck.warning);
      tick.finish(onClose);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });
  const saving = createMutation.isPending || updateMutation.isPending;

  function resetForm() {
    setPartyType("customer");
    setName("");
    setPhone("");
    setEmail("");
    setOpeningBalance("");
    setGstin("");
    setPan("");
    setAutoPan(null);
    setCategory("");
    setBillingAddress("");
    setShippingAddress("");
    setSameAsBilling(false);
    setCity("");
    setState("");
    setPincode("");
    setCreditPeriodDays("");
    setCreditLimit("");
    setContactPersonName("");
    setContactPersonDob("");
    setBankAccountNumber("");
    setBankIfsc("");
    setBankName("");
    setStateCode("");
    setLegalName("");
    setTradeName("");
    setGstType("");
    setConstitution("");
    setGstinStatus(null);
    setGstinVerifiedAt(null);
    setAutoGstType("");
    setAutoConstitution("");
    setGstinBlur(0);
    setIsMsme(false);
    setUdyamNumber("");
    setMsmeCategory("");
    setTdsSection("");
    setPriceLevelId("");
    setExtraShipping([]);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function handleCreate() {
    if (gstin && !GSTIN_REGEX.test(gstin)) {
      toast.error("Invalid GSTIN format");
      return;
    }
    if (pan && !PAN_REGEX.test(pan)) {
      toast.error("Invalid PAN format");
      return;
    }
    if (bankIfsc && !IFSC_REGEX.test(bankIfsc)) {
      toast.error("Invalid IFSC (e.g. HDFC0001234)");
      return;
    }
    if (udyamNumber && !UDYAM_REGEX.test(udyamNumber)) {
      toast.error("Invalid Udyam number (e.g. UDYAM-MH-26-0012345)");
      return;
    }
    const payload = {
      type: partyType,
      name,
      phone: phone || undefined,
      email: email || undefined,
      openingBalance: openingBalance || "0",
      gstin: gstin || undefined,
      pan: pan || undefined,
      category: category || undefined,
      billingAddress: billingAddress || undefined,
      shippingAddress: sameAsBilling ? billingAddress || undefined : shippingAddress || undefined,
      city: city || undefined,
      state: state || undefined,
      pincode: pincode || undefined,
      creditPeriodDays: creditPeriodDays ? parseInt(creditPeriodDays, 10) : undefined,
      creditLimit: creditLimit || undefined,
      contactPersonName: contactPersonName || undefined,
      contactPersonDob: toISOString(contactPersonDob),
      bankAccountNumber: bankAccountNumber || undefined,
      bankIfsc: bankIfsc || undefined,
      bankName: bankName || undefined,
      stateCode: stateCode || undefined,
      additionalShippingAddresses: shippingAddressesPayload(extraShipping),
      legalName: legalName.trim() || undefined,
      tradeName: tradeName.trim() || undefined,
      gstRegistrationType: gstType || undefined,
      constitution: constitution || undefined,
      gstinStatus: gstinStatus ?? undefined,
      gstinVerifiedAt: gstinVerifiedAt ?? undefined,
      isMsme,
      udyamNumber: isMsme ? udyamNumber || undefined : undefined,
      msmeCategory: isMsme ? msmeCategory || undefined : undefined,
      tdsSection: tdsSection || undefined,
      priceLevelId: partyType === "customer" && priceLevelId ? priceLevelId : undefined,
    };
    if (existing) {
      // An edit sends what is on screen, so a cleared text field is saved
      // empty and removed shipping addresses go away.
      const { type: _type, ...data } = payload;
      updateMutation.mutate({
        id: existing.id,
        data: {
          ...data,
          phone,
          email,
          pan,
          category,
          billingAddress,
          shippingAddress: sameAsBilling ? billingAddress : shippingAddress,
          city,
          state,
          pincode,
          contactPersonName,
          bankAccountNumber,
          bankName,
          legalName: legalName.trim(),
          tradeName: tradeName.trim(),
          additionalShippingAddresses: shippingAddressesPayload(extraShipping) ?? [],
          priceLevelId: partyType === "customer" ? priceLevelId || null : undefined,
        },
      });
    } else {
      createMutation.mutate(payload);
    }
  }

  const warnings = partyComplianceWarnings({
    type: partyType,
    gstin,
    pan,
    stateCode,
    gstRegistrationType: gstType,
    gstinStatus,
    isMsme,
    udyamNumber,
    tdsSection,
  });
  const tdsRate = tdsRateFor({ tdsSection, pan, gstin, constitution });

  const _effectiveShipping = sameAsBilling ? billingAddress : shippingAddress;

  return (
    <SlideOver
      open={open}
      onClose={handleClose}
      title={existing ? "Edit Party" : "Add Party"}
      description={existing ? "Change this customer's or supplier's details" : "Create a new customer or supplier"}
      footer={
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={handleClose} disabled={saving}>
            Cancel
          </button>
          <button
            className={cn("btn-primary", tick.saved && "!bg-emerald-600 disabled:!opacity-100")}
            onClick={handleCreate}
            disabled={saving || tick.saved || !name.trim()}
          >
            {tick.saved ? <SavedTick label={existing ? "Saved" : "Created"} /> : existing
              ? updateMutation.isPending ? "Saving…" : "Save Changes"
              : createMutation.isPending ? "Creating…" : "Create Party"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Party Type toggle (a saved party keeps its type) */}
        {!existing && <SegmentedControl
          tabs={[
            { value: "customer", label: "Customer" },
            { value: "supplier", label: "Supplier" },
          ]}
          value={partyType}
          onChange={(v) => setPartyType(v as PartyType)}
        />}

        {/* Base fields — 2 column */}
        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="Party Name"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name or business name"
          />
          <PhoneInput label="Phone" value={phone} onChange={setPhone} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
          />
          <InputField
            label="Opening Balance"
            type="number"
            step="0.01"
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <GstinSearch
          gstin={gstin}
          initialGstin={e0?.gstin ?? ""}
          values={{ name, legalName, tradeName, billingAddress, city, state, stateCode, pincode, gstType, constitution }}
          auto={{ gstType: autoGstType, constitution: autoConstitution }}
          blurSignal={gstinBlur}
          shippingCount={extraShipping.length}
          onFill={applyGstinFill}
          onMeta={(m) => {
            setGstinStatus(m.gstinStatus);
            setGstinVerifiedAt(m.verifiedAt);
          }}
          onUseAsShipping={(entry) => setExtraShipping((list) => [...list, entry])}
          input={
            <GstinInput
              value={gstin}
              onBlur={() => setGstinBlur((n) => n + 1)}
              onChange={(value) => {
                setGstin(value);
                if (gstinStatus) {
                  setGstinStatus(null);
                  setGstinVerifiedAt(null);
                }
                if (GSTIN_REGEX.test(value)) applyGstinDerived(value);
              }}
            />
          }
        />

        {warnings.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" role="status">
            <ul className="list-disc pl-4 space-y-1">
              {warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          </div>
        )}

        {/* Section divider */}
        <div className="flex items-center gap-3 pt-2">
          <span className="text-2xs font-semibold uppercase tracking-wider text-text-tertiary whitespace-nowrap">
            Additional Details
          </span>
          <div className="flex-1 h-px bg-border-light" />
        </div>

        {/* Disclosure sections */}
        <div className="space-y-1">
          <Disclosure
            label="GST Registration"
            count={countFilled(legalName, tradeName, gstType, constitution)}
          >
            <div className="grid grid-cols-2 gap-4">
              <InputField
                label="Legal Name"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="As registered for GST"
              />
              <InputField
                label="Trade Name"
                value={tradeName}
                onChange={(e) => setTradeName(e.target.value)}
                placeholder="Name they do business under"
              />
              <div>
                <label className="label">GST Type</label>
                <Select className="input w-full" value={gstType} onChange={(e) => setGstType(e.target.value as PartyGstType | "")} aria-label="GST type">
                  <option value="">Select</option>
                  {partyGstTypes.map((t) => <option key={t} value={t}>{partyGstTypeLabels[t]}</option>)}
                </Select>
              </div>
              <div>
                <label className="label">Business Type</label>
                <Select className="input w-full" value={constitution} onChange={(e) => setConstitution(e.target.value as PartyConstitution | "")} aria-label="Business type">
                  <option value="">Select</option>
                  {partyConstitutions.map((c) => <option key={c} value={c}>{partyConstitutionLabels[c]}</option>)}
                </Select>
              </div>
            </div>
          </Disclosure>

          <Disclosure
            label="Tax & Identity"
            count={countFilled(pan, category)}
          >
            <div className="grid grid-cols-2 gap-4">
              <InputField
                label="PAN"
                value={pan}
                onChange={(e) => setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                maxLength={10}
                placeholder="AAAAA0000A"
              />
              <InputField
                label="Category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Retail, Wholesale"
              />
            </div>
          </Disclosure>

          <Disclosure
            label="Address"
            count={countFilled(billingAddress, city, state, pincode) + extraShipping.length}
          >
            <div className="grid grid-cols-2 gap-4">
              <TextareaField
                label="Billing Address"
                rows={3}
                value={billingAddress}
                onChange={(e) => setBillingAddress(e.target.value)}
                placeholder="Street, Area…"
              />
              <div className="flex flex-col gap-1">
                <TextareaField
                  label="Shipping Address"
                  rows={3}
                  value={sameAsBilling ? billingAddress : shippingAddress}
                  onChange={(e) => setShippingAddress(e.target.value)}
                  placeholder="Leave empty to use billing"
                  disabled={sameAsBilling}
                />
                <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer mt-1">
                  <input
                    type="checkbox"
                    checked={sameAsBilling}
                    onChange={(e) => setSameAsBilling(e.target.checked)}
                    className="rounded"
                  />
                  Same as billing
                </label>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 mt-3">
              <InputField
                label="City"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
              <div>
                <label className="label">State</label>
                <Select
                  className="input w-full"
                  value={stateCode}
                  onChange={(e) => {
                    setStateCode(e.target.value);
                    setState(INDIAN_STATES.find((st) => st.code === e.target.value)?.name ?? "");
                  }}
                  aria-label="State"
                >
                  <option value="">Select state</option>
                  {INDIAN_STATES.map((st) => <option key={st.code} value={st.code}>{st.name}</option>)}
                </Select>
              </div>
              <InputField
                label="Pincode"
                value={pincode}
                onChange={(e) => setPincode(e.target.value)}
              />
            </div>
            <div className="mt-4">
              <PartyShippingAddresses value={extraShipping} onChange={setExtraShipping} />
            </div>
          </Disclosure>

          <Disclosure
            label="MSME (Udyam)"
            count={isMsme ? 1 + countFilled(udyamNumber, msmeCategory) : 0}
          >
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="rounded" checked={isMsme} onChange={(e) => setIsMsme(e.target.checked)} />
              Registered MSME (Udyam)
            </label>
            {isMsme && (
              <div className="grid grid-cols-2 gap-4 mt-3">
                <InputField
                  label="Udyam Number"
                  value={udyamNumber}
                  onChange={(e) => setUdyamNumber(e.target.value.toUpperCase())}
                  placeholder="UDYAM-MH-26-0012345"
                />
                <div>
                  <label className="label">Category</label>
                  <Select className="input w-full" value={msmeCategory} onChange={(e) => setMsmeCategory(e.target.value as MsmeCategory | "")} aria-label="MSME category">
                    <option value="">Select</option>
                    {msmeCategories.map((c) => <option key={c} value={c}>{c[0]!.toUpperCase() + c.slice(1)}</option>)}
                  </Select>
                </div>
                {msmeCategory !== "medium" && (
                  <p className="col-span-2 text-xs text-text-tertiary">
                    Pay micro and small suppliers within 45 days (15 without a written credit period) to deduct the expense this year — Section 43B(h).
                  </p>
                )}
              </div>
            )}
          </Disclosure>

          <Disclosure
            label="TDS"
            count={countFilled(tdsSection)}
          >
            <div className="grid grid-cols-2 gap-4 items-end">
              <div>
                <label className="label">TDS Section</label>
                <Select className="input w-full" value={tdsSection} onChange={(e) => setTdsSection(e.target.value)} aria-label="TDS section">
                  <option value="">No TDS</option>
                  {tdsSections.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
                </Select>
              </div>
              {tdsRate && (
                <p className="text-sm pb-2">
                  Rate: <span className="font-semibold">{tdsRate}%</span>
                  {!pan && !panFromGstin(gstin) && <span className="text-red-600"> (no PAN)</span>}
                </p>
              )}
            </div>
            {tdsSection && (
              <p className="text-xs text-text-tertiary mt-2">
                {tdsSections.find((t) => t.code === tdsSection)?.note}
              </p>
            )}
          </Disclosure>

          <Disclosure
            label="Credit Terms"
            count={countFilled(creditPeriodDays, creditLimit)}
          >
            <div className="grid grid-cols-2 gap-4">
              <InputField
                label="Credit Period (Days)"
                type="number"
                min="0"
                max="365"
                value={creditPeriodDays}
                onChange={(e) => setCreditPeriodDays(e.target.value)}
                placeholder="e.g. 30"
              />
              <InputField
                label="Credit Limit (₹)"
                type="number"
                step="0.01"
                value={creditLimit}
                onChange={(e) => setCreditLimit(e.target.value)}
                placeholder="0.00"
              />
            </div>
            {partyType === "customer" && (
              <div className="mt-4 max-w-[50%]">
                <PriceLevelSelect value={priceLevelId} onChange={setPriceLevelId} />
              </div>
            )}
          </Disclosure>

          <Disclosure
            label="Contact Person"
            count={countFilled(contactPersonName, contactPersonDob)}
          >
            <div className="grid grid-cols-2 gap-4">
              <InputField
                label="Contact Name"
                value={contactPersonName}
                onChange={(e) => setContactPersonName(e.target.value)}
                placeholder="Contact person name"
              />
              <InputField
                label="Date of Birth"
                type="date"
                value={contactPersonDob}
                onChange={(e) => setContactPersonDob(e.target.value)}
              />
            </div>
          </Disclosure>

          <Disclosure
            label="Bank Details"
            count={countFilled(bankAccountNumber, bankIfsc, bankName)}
          >
            <div className="grid grid-cols-3 gap-4">
              <InputField
                label="Account Number"
                value={bankAccountNumber}
                onChange={(e) => setBankAccountNumber(e.target.value)}
                placeholder="Account number"
              />
              <InputField
                label="IFSC"
                value={bankIfsc}
                onChange={(e) => setBankIfsc(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11))}
                placeholder="SBIN0001234"
              />
              <InputField
                label="Bank Name"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="Bank name"
              />
            </div>
          </Disclosure>
        </div>

      </div>
    </SlideOver>
  );
}
