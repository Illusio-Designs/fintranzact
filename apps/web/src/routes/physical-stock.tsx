import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { invalidateStockViews } from "@/lib/stock-cache";
import { toast } from "@/hooks/useToast";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { InputField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListCard } from "@/components/ui/ListCard";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { usePageSize } from "@/hooks/usePageSize";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { WarehouseSelect, formatQty, unitKey, useWarehouses } from "@/components/inventory/shared";
import { useBarcodeSetup } from "@/components/barcodes/BarcodeSymbol";

export const Route = createFileRoute("/physical-stock")({
  component: PhysicalStockPage,
});

type View =
  | { name: "home" }
  | { name: "scan"; warehouseId: string; startedAt: string }
  | { name: "report"; warehouseId: string; startedAt: string }
  | { name: "saved"; id: string };

/** One scanned code and how many times it was scanned. */
type Scans = Array<{ code: string; count: number }>;

function draftKey(warehouseId: string) {
  return `physical-scan:${warehouseId}`;
}

/** Scans survive a page reload until the count is finished or cancelled. */
function loadDraft(warehouseId: string): { startedAt: string; history: string[] } | null {
  try {
    const raw = localStorage.getItem(draftKey(warehouseId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveDraft(warehouseId: string, draft: { startedAt: string; history: string[] } | null) {
  try {
    if (draft) localStorage.setItem(draftKey(warehouseId), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(warehouseId));
  } catch {
    // Storage can be unavailable (private mode); the scan still works.
  }
}

function groupScans(history: string[]): Scans {
  const counts = new Map<string, number>();
  for (const code of history) counts.set(code, (counts.get(code) ?? 0) + 1);
  return [...counts.entries()].map(([code, count]) => ({ code, count }));
}

/**
 * Physical stock by barcode: pick the store or godown, scan everything on the
 * shelves, press End scan. The report shows what matched the books, what is
 * short or extra, what was never scanned (missing) and codes the system
 * doesn't know; posting turns the differences into stock adjustments.
 */
function PhysicalStockPage() {
  const { data: setup, isLoading } = useBarcodeSetup();
  const [view, setView] = useState<View>({ name: "home" });
  const [history, setHistory] = useState<string[]>([]);

  if (isLoading) return <SkeletonRows />;

  if (!setup?.enabled) {
    return (
      <div>
        <PageHeader title="Physical Stock" description="Count stock by scanning barcodes." />
        <EmptyState
          title="Barcodes are switched off"
          description="Physical stock works by scanning barcodes. Switch barcodes on in Settings → Barcodes to use it."
          action={
            <Link
              to="/settings"
              className="btn-primary"
              onClick={() => {
                try {
                  sessionStorage.setItem("settings-tab", "barcodes");
                } catch {
                  // Settings opens on its first tab instead.
                }
              }}
            >
              Open barcode settings
            </Link>
          }
        />
      </div>
    );
  }

  if (view.name === "scan") {
    return (
      <ScanScreen
        warehouseId={view.warehouseId}
        startedAt={view.startedAt}
        history={history}
        onHistory={(next) => {
          setHistory(next);
          saveDraft(view.warehouseId, { startedAt: view.startedAt, history: next });
        }}
        onCancel={() => {
          saveDraft(view.warehouseId, null);
          setHistory([]);
          setView({ name: "home" });
        }}
        onEnd={() => setView({ name: "report", warehouseId: view.warehouseId, startedAt: view.startedAt })}
      />
    );
  }

  if (view.name === "report") {
    return (
      <LiveReport
        warehouseId={view.warehouseId}
        startedAt={view.startedAt}
        scans={groupScans(history)}
        scanCount={history.length}
        onBack={() => setView({ name: "scan", warehouseId: view.warehouseId, startedAt: view.startedAt })}
        onDone={(id) => {
          saveDraft(view.warehouseId, null);
          setHistory([]);
          setView({ name: "saved", id });
        }}
      />
    );
  }

  if (view.name === "saved") {
    return <SavedReport id={view.id} onBack={() => setView({ name: "home" })} />;
  }

  return (
    <HomeScreen
      onStart={(warehouseId) => {
        const draft = loadDraft(warehouseId);
        const startedAt = draft?.startedAt ?? new Date().toISOString();
        setHistory(draft?.history ?? []);
        if (draft?.history.length) {
          toast({ title: "Scan resumed", description: `${draft.history.length} scans from before were kept.` });
        }
        setView({ name: "scan", warehouseId, startedAt });
      }}
      onOpen={(id) => setView({ name: "saved", id })}
    />
  );
}

function HomeScreen({ onStart, onOpen }: { onStart: (warehouseId: string) => void; onOpen: (id: string) => void }) {
  const { data: warehouses } = useWarehouses();
  const [warehouseId, setWarehouseId] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("physical-counts", 25);
  const tableRef = useRef<HTMLDivElement>(null);
  // Back to page 1 when rows per page change.
  useEffect(() => setPage(1), [pageSize]);
  // A new page starts at its first row.
  useEffect(() => { tableRef.current?.scrollTo({ top: 0 }); }, [page]);
  const { data, isFetching } = trpc.stock.counts.useQuery(
    { page, limit: pageSize },
    // Keep the current page on screen while the next one loads.
    { placeholderData: (prev) => prev },
  );

  useEffect(() => {
    if (!warehouseId && warehouses?.length) {
      setWarehouseId((warehouses.find((w) => w.isDefault) ?? warehouses[0])!.id);
    }
  }, [warehouses, warehouseId]);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // The last page emptied out (or rows per page grew): step back.
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  return (
    <div>
      <PageHeader title="Physical Stock" description="Scan every barcode in a store or godown. After End scan you get a report of what's missing." />

      <div className="card mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-end">
        <div className="flex-1">
          <WarehouseSelect label="Count stock at" value={warehouseId} onChange={setWarehouseId} />
        </div>
        <button className="btn-primary" disabled={!warehouseId} onClick={() => onStart(warehouseId)}>
          Start scanning
        </button>
      </div>

      <ListCard
        title="Past counts" titleCount={total}
        pagination={{ page, totalPages, onPageChange: setPage, total, pageSize, onPageSizeChange: setPageSize }}
        loading={!data}
        fetching={isFetching}
        tableRef={tableRef}
        empty={
          data && data.data.length === 0 ? (
            <EmptyState title="No counts yet" description="Finished scans and their reports are listed here." />
          ) : undefined
        }
      >
              <table className="data-table w-full">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Warehouse</th>
                    <th className="text-right">Scans</th>
                    <th className="text-right">Items checked</th>
                    <th className="text-right">Differences</th>
                    <th>Status</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.data ?? []).map((c) => (
                    <tr key={c.id} className="cursor-pointer" onClick={() => onOpen(c.id)}>
                      <td>{formatDate(c.endedAt)}</td>
                      <td className="font-medium text-text-primary">{c.warehouseName}</td>
                      <td className="text-right tabular-nums">{c.scanCount}</td>
                      <td className="text-right tabular-nums">{c.itemsChecked}</td>
                      <td className="text-right tabular-nums">{c.differences}</td>
                      <td>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-semibold",
                            c.status === "posted"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                              : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
                          )}
                        >
                          {c.status === "posted" ? `Posted · ${c.adjustedCount} adjusted` : "Saved, not posted"}
                        </span>
                      </td>
                      <td className="text-text-tertiary">{c.createdByName ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
      </ListCard>
    </div>
  );
}

function ScanScreen({
  warehouseId,
  startedAt,
  history,
  onHistory,
  onCancel,
  onEnd,
}: {
  warehouseId: string;
  startedAt: string;
  history: string[];
  onHistory: (next: string[]) => void;
  onCancel: () => void;
  onEnd: () => void;
}) {
  const { data: warehouses } = useWarehouses();
  const { data: sheet, isLoading } = trpc.stock.countSheet.useQuery({ warehouseId }, { staleTime: 60_000 });
  const [input, setInput] = useState("");
  const [filter, setFilter] = useState<"all" | "left">("left");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const warehouseName = warehouses?.find((w) => w.id === warehouseId)?.name ?? "Warehouse";

  // code → which unit it counts and how many pieces one scan stands for.
  const codeMap = useMemo(() => {
    const map = new Map<string, { key: string; name: string; packQty: number }>();
    for (const u of sheet?.units ?? []) {
      for (const c of u.codes) map.set(c.code, { key: unitKey(u.itemId, u.variantId), name: u.name, packQty: c.packQty });
    }
    return map;
  }, [sheet]);

  const { counted, unknown } = useMemo(() => {
    const counted = new Map<string, number>();
    let unknown = 0;
    for (const code of history) {
      const hit = codeMap.get(code);
      if (!hit) unknown++;
      else counted.set(hit.key, (counted.get(hit.key) ?? 0) + hit.packQty);
    }
    return { counted, unknown };
  }, [history, codeMap]);

  const last = history.length ? history[history.length - 1]! : null;
  const lastHit = last ? codeMap.get(last) : null;

  const expected = (sheet?.units ?? []).filter((u) => parseFloat(u.books) !== 0 || counted.has(unitKey(u.itemId, u.variantId)));
  const left = expected.filter((u) => !counted.has(unitKey(u.itemId, u.variantId)));
  const shown = filter === "left" ? left : expected;

  function addScan(raw: string) {
    const code = raw.trim();
    if (!code) return;
    onHistory([...history, code]);
    setInput("");
  }

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div>
      <PageHeader
        title={`Scanning · ${warehouseName}`}
        description={`Started ${new Date(startedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}. Scan every barcode on the shelves, then press End scan.`}
        actions={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setConfirmCancel(true)}>
              Cancel count
            </button>
            <button className="btn-primary" disabled={history.length === 0} onClick={onEnd}>
              End scan
            </button>
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-5 min-w-0">
          <div className="card p-5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addScan(input);
              }}
            >
              <label htmlFor="scan-input" className="mb-1.5 block text-sm font-medium text-text-secondary">
                Scan or type a barcode
              </label>
              <input
                id="scan-input"
                ref={inputRef}
                className="input h-12 w-full font-mono text-lg"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Point the scanner here and scan"
                autoComplete="off"
                spellCheck={false}
              />
            </form>
            <div
              role="status"
              aria-live="polite"
              className={cn(
                "mt-4 rounded-xl px-4 py-3 text-sm font-medium",
                !last && "bg-surface-2 text-text-tertiary",
                last && lastHit && "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200",
                last && !lastHit && "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300",
              )}
            >
              {!last
                ? "Waiting for the first scan…"
                : lastHit
                  ? `${last} → ${lastHit.name} +${formatQty(lastHit.packQty)}`
                  : `${last} → not in the system. It will be listed as an unknown code.`}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-text-tertiary">
              <span>
                {history.length} scans · {counted.size} items found · {unknown} unknown
              </span>
              <button
                type="button"
                className="font-semibold text-brand-600 disabled:opacity-40 dark:text-brand-300"
                disabled={history.length === 0}
                onClick={() => {
                  onHistory(history.slice(0, -1));
                  inputRef.current?.focus();
                }}
              >
                Undo last scan
              </button>
            </div>
          </div>

          {(sheet?.noBarcode.length ?? 0) > 0 && (
            <div className="card p-5 text-sm text-text-secondary">
              <p className="font-semibold text-text-primary">
                {sheet!.noBarcode.length} item{sheet!.noBarcode.length === 1 ? " has" : "s have"} no barcode
              </p>
              <p className="mt-1">They can't be counted by scanning and will be listed at the end. Give them a code on the Stock items page.</p>
            </div>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border-light px-4 py-3">
            <h2 className="text-sm font-semibold text-text-primary">Expected here</h2>
            <div className="inline-flex rounded-lg bg-surface-2 p-0.5 text-xs font-semibold">
              {(["left", "all"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn("rounded-md px-2.5 py-1", filter === f ? "bg-surface-0 text-text-primary shadow-sm" : "text-text-tertiary")}
                >
                  {f === "left" ? `Not scanned (${left.length})` : `All (${expected.length})`}
                </button>
              ))}
            </div>
          </div>
          {isLoading ? (
            <SkeletonRows />
          ) : shown.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-text-tertiary">
              {filter === "left" ? "Everything expected here has been scanned." : "No barcoded stock expected here."}
            </p>
          ) : (
            <ul className="max-h-[520px] divide-y divide-border-light overflow-y-auto">
              {shown.map((u) => {
                const got = counted.get(unitKey(u.itemId, u.variantId)) ?? 0;
                const books = parseFloat(u.books);
                return (
                  <li key={unitKey(u.itemId, u.variantId)} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-text-primary">{u.name}</span>
                      <span className="block truncate font-mono text-xs text-text-tertiary">{u.codes.map((c) => c.code).join(" · ")}</span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 tabular-nums font-semibold",
                        got === 0 ? "text-text-tertiary" : Math.abs(got - books) < 0.0005 ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300",
                      )}
                    >
                      {formatQty(got)} / {formatQty(books)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={onCancel}
        variant="danger"
        title="Cancel this count?"
        description={`${history.length} scans will be thrown away. Stock doesn't change.`}
        confirmLabel="Cancel count"
      />
    </div>
  );
}

type ReportData = {
  lines: Array<{ itemId: string; variantId: string | null; name: string; books: string; scanned: string; unitCost: string | null }>;
  unknownCodes: Array<{ code: string; count: number }>;
  notCounted: Array<{ itemId: string; variantId: string | null; name: string; books: string }>;
};

function ReportBody({ report }: { report: ReportData }) {
  const rows = report.lines.map((l) => {
    const books = parseFloat(l.books);
    const scanned = parseFloat(l.scanned);
    const diff = scanned - books;
    const kind = Math.abs(diff) < 0.0005 ? "Matched" : scanned === 0 ? "Missing" : diff < 0 ? "Short" : "Extra";
    return { ...l, booksN: books, scannedN: scanned, diff, kind, value: diff * parseFloat(l.unitCost ?? "0") };
  });
  const differences = rows.filter((r) => r.kind !== "Matched").sort((a, b) => a.value - b.value);
  const matched = rows.length - differences.length;
  const missing = rows.filter((r) => r.kind === "Missing").length;
  const net = differences.reduce((s, r) => s + r.value, 0);

  const kindStyle: Record<string, string> = {
    Missing: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300",
    Short: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
    Extra: "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300",
  };

  const summary = [
    { label: "Expected items", value: String(rows.length), note: "barcoded, in books or scanned", tone: "text-text-primary" },
    { label: "Matched", value: String(matched), note: "scanned = books", tone: "text-emerald-700 dark:text-emerald-300" },
    { label: "Missing", value: String(missing), note: "in books, never scanned", tone: "text-red-600 dark:text-red-400" },
    { label: "Short / extra", value: String(differences.length - missing), note: "count differs", tone: "text-amber-700 dark:text-amber-300" },
    {
      label: "Stock value change",
      value: formatCurrency(net),
      note: "at purchase price",
      tone: net < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-300",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {summary.map((s) => (
          <div key={s.label} className="card p-4">
            <p className="text-xs text-text-tertiary">{s.label}</p>
            <p className={cn("mt-1 text-2xl font-extrabold tabular-nums", s.tone)}>{s.value}</p>
            <p className="text-xs text-text-tertiary">{s.note}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border-light px-4 py-3">
            <h2 className="text-sm font-semibold text-text-primary">Differences</h2>
            <span className="text-xs text-text-tertiary">These become adjustments when posted</span>
          </div>
          {differences.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-text-tertiary">Everything scanned matches the books.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="text-right">Books</th>
                    <th className="text-right">Scanned</th>
                    <th className="text-right">Diff</th>
                    <th className="text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {differences.map((r) => (
                    <tr key={unitKey(r.itemId, r.variantId)}>
                      <td>
                        <p className="font-medium text-text-primary">{r.name}</p>
                        <span className={cn("mt-1 inline-block rounded-full px-2 py-0.5 text-2xs font-bold", kindStyle[r.kind])}>{r.kind}</span>
                      </td>
                      <td className="text-right tabular-nums">{formatQty(r.booksN)}</td>
                      <td className="text-right tabular-nums">{formatQty(r.scannedN)}</td>
                      <td className={cn("text-right font-bold tabular-nums", r.diff < 0 ? "text-red-600 dark:text-red-400" : "text-brand-700 dark:text-brand-300")}>
                        {r.diff > 0 ? "+" : ""}
                        {formatQty(r.diff)}
                      </td>
                      <td className="text-right tabular-nums">{formatCurrency(r.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div className="card overflow-hidden">
            <div className="border-b border-border-light px-4 py-3 text-sm font-semibold text-text-primary">
              Unknown barcodes ({report.unknownCodes.length})
            </div>
            {report.unknownCodes.length === 0 ? (
              <p className="px-4 py-4 text-sm text-text-tertiary">Every scanned code was found.</p>
            ) : (
              <ul className="divide-y divide-border-light">
                {report.unknownCodes.map((u) => (
                  <li key={u.code} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="font-mono text-text-primary">
                      {u.code} <span className="text-text-tertiary">× {u.count}</span>
                    </span>
                    <Link to="/items" className="text-xs font-semibold text-brand-600 dark:text-brand-300">
                      Add as item
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t border-border-light px-4 py-2.5 text-xs text-text-tertiary">Not adjusted. Create the item or attach the code to an existing one.</p>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-border-light px-4 py-3 text-sm font-semibold text-text-primary">
              Not counted — no barcode ({report.notCounted.length})
            </div>
            {report.notCounted.length === 0 ? (
              <p className="px-4 py-4 text-sm text-text-tertiary">Every item in stock here has a barcode.</p>
            ) : (
              <ul className="divide-y divide-border-light">
                {report.notCounted.map((n) => (
                  <li key={unitKey(n.itemId, n.variantId)} className="flex justify-between px-4 py-2.5 text-sm">
                    <span className="text-text-primary">{n.name}</span>
                    <span className="text-text-tertiary">{formatQty(n.books)} in books</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function adjustmentCount(report: ReportData) {
  return report.lines.filter((l) => Math.abs(parseFloat(l.scanned) - parseFloat(l.books)) >= 0.0005).length;
}

function LiveReport({
  warehouseId,
  startedAt,
  scans,
  scanCount,
  onBack,
  onDone,
}: {
  warehouseId: string;
  startedAt: string;
  scans: Scans;
  scanCount: number;
  onBack: () => void;
  onDone: (id: string) => void;
}) {
  const utils = trpc.useUtils();
  const { data: warehouses } = useWarehouses();
  const [note, setNote] = useState("");
  const [confirmPost, setConfirmPost] = useState(false);
  const { data: report, isLoading } = trpc.stock.countPreview.useQuery({ warehouseId, scans });
  const warehouseName = warehouses?.find((w) => w.id === warehouseId)?.name ?? "Warehouse";

  const finish = trpc.stock.countFinish.useMutation({
    onSuccess: async (res, vars) => {
      // Counts, adjustments, balances: all of stock.
      await invalidateStockViews(utils);
      toast({
        title: vars.post ? "Count posted" : "Report saved",
        description: vars.post ? `${res.adjusted} adjustments made at ${warehouseName}.` : "No stock was changed.",
        variant: "success",
      });
      onDone(res.id);
    },
    onError: (e) => {
      setConfirmPost(false);
      toast({ title: "Couldn't finish the count", description: e.message, variant: "error" });
    },
  });

  const toAdjust = report ? adjustmentCount(report) : 0;

  return (
    <div>
      <PageHeader
        title="Physical stock report"
        description={`${warehouseName} · ${scanCount} scans · started ${new Date(startedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={onBack}>
              Back to scanning
            </button>
            <button
              className="btn-secondary"
              disabled={!report || finish.isPending}
              onClick={() => finish.mutate({ warehouseId, startedAt, scans, note: note.trim() || undefined, post: false })}
            >
              Save report only
            </button>
            <button className="btn-primary" disabled={!report || finish.isPending} onClick={() => setConfirmPost(true)}>
              {toAdjust ? `Post ${toAdjust} adjustment${toAdjust === 1 ? "" : "s"}` : "Post count"}
            </button>
          </div>
        }
      />
      <div className="card mb-5 p-4">
        <InputField label="Note (optional)" placeholder="e.g. Month-end count" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {isLoading || !report ? <SkeletonRows /> : <ReportBody report={report} />}

      <ConfirmDialog
        open={confirmPost}
        onCancel={() => setConfirmPost(false)}
        loading={finish.isPending}
        onConfirm={() => finish.mutate({ warehouseId, startedAt, scans, note: note.trim() || undefined, post: true })}
        title="Post this count?"
        description={
          toAdjust
            ? `${toAdjust} item${toAdjust === 1 ? "" : "s"} at ${warehouseName} will be set to what was scanned. Missing items go to 0.`
            : "Everything scanned matches the books. The report is saved and nothing changes."
        }
        confirmLabel="Post count"
      />
    </div>
  );
}

function SavedReport({ id, onBack }: { id: string; onBack: () => void }) {
  const utils = trpc.useUtils();
  const { data } = trpc.stock.count.useQuery({ id });
  const [confirmPost, setConfirmPost] = useState(false);
  const post = trpc.stock.countPost.useMutation({
    onSuccess: async (res) => {
      setConfirmPost(false);
      await Promise.all([
        utils.stock.count.invalidate({ id }),
        invalidateStockViews(utils),
      ]);
      toast({ title: "Count posted", description: `${res.adjusted} adjustments made.`, variant: "success" });
    },
    onError: (e) => {
      setConfirmPost(false);
      toast({ title: "Couldn't post the count", description: e.message, variant: "error" });
    },
  });

  if (!data) return <SkeletonRows />;
  const toAdjust = adjustmentCount(data);

  return (
    <div>
      <PageHeader
        title="Physical stock report"
        description={`${data.warehouseName} · ${formatDate(data.endedAt)} · ${data.scanCount} scans${data.createdByName ? ` by ${data.createdByName}` : ""}${data.note ? ` · ${data.note}` : ""}`}
        actions={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onBack}>
              All counts
            </button>
            {data.status === "saved" && (
              <button className="btn-primary" onClick={() => setConfirmPost(true)}>
                Post adjustments
              </button>
            )}
          </div>
        }
      />
      <div
        role="status"
        className={cn(
          "mb-5 rounded-xl px-4 py-3 text-sm font-medium",
          data.status === "posted"
            ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200"
            : "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200",
        )}
      >
        {data.status === "posted"
          ? `Posted${data.postedAt ? ` on ${formatDate(data.postedAt)}` : ""}: ${data.adjustedCount} adjustments. They're in Stock adjustments.`
          : "Saved only — stock hasn't changed. Posting sets each item to what was scanned, against today's stock."}
      </div>
      <ReportBody report={data} />
      <ConfirmDialog
        open={confirmPost}
        onCancel={() => setConfirmPost(false)}
        loading={post.isPending}
        onConfirm={() => post.mutate({ id })}
        title="Post this count?"
        description={`Up to ${toAdjust} item${toAdjust === 1 ? "" : "s"} will be set to what was scanned.`}
        confirmLabel="Post count"
      />
    </div>
  );
}
