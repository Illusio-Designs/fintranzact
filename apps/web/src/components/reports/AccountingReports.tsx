/**
 * Accounting statements shown in Reports: Profit & Loss, Trial Balance,
 * Balance Sheet, Ageing, Party Ledger and Tally Export. They used to be tabs
 * on the GST page; each keeps its own period controls.
 */
import { useState } from "react";
import { trpc, getBusinessId } from "@/lib/trpc";
import { formatDate } from "@/lib/utils";

import { apiUrl } from "@/lib/api-url";
import { getCurrentFYBounds, getPreviousFYBounds } from "@/lib/fy-bounds";
import { EmptyState } from "@/components/ui/EmptyState";
import { Combobox } from "@/components/ui/Combobox";
import { DateRangeBar } from "@/components/ui/DateRangeBar";
import { toast } from "@/hooks/useToast";
import { useDateRange } from "@/hooks/useDateRange";
import { Icon } from "@/components/ui/Icon";
import { Download04Icon } from "@hugeicons/core-free-icons";

import { Spinner } from "@/components/ui/Spinner";
import { fmtStr, fyLabel, ReportSkeleton } from "./report-format";


// ── Profit & Loss View ─────────────────────────────────────────

export function ProfitAndLossView() {
  const [compareMode, setCompareMode] = useState(false);
  const { preset, setPreset, fromDate, toDate, customFrom, customTo, setCustomRange } =
    useDateRange("pnl-report", "this-fy");

  const curFY = getCurrentFYBounds();
  const prevFY = getPreviousFYBounds();

  const { data, isLoading, error } = trpc.dashboard.profitAndLoss.useQuery(
    { fromDate: fromDate || undefined, toDate: toDate || undefined },
    { enabled: !compareMode },
  );

  const { data: cmpData, isLoading: cmpLoading, error: cmpError } = trpc.reports.comparativeProfitAndLoss.useQuery(
    {
      currentFYStart: curFY.start,
      currentFYEnd: curFY.end,
      previousFYStart: prevFY.start,
      previousFYEnd: prevFY.end,
    },
    { enabled: compareMode },
  );

  const isLoading2 = compareMode ? cmpLoading : isLoading;
  const error2 = compareMode ? cmpError : error;

  return (
    <div className="space-y-5">
      {/* Period selector + compare toggle */}
      <div className="card px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-text-tertiary font-medium uppercase tracking-wide">Period</p>
          <CompareToggle enabled={compareMode} onToggle={() => setCompareMode((v) => !v)} />
        </div>
        {!compareMode ? (
          <DateRangeBar
            preset={preset}
            onPresetChange={setPreset}
            customFrom={customFrom}
            customTo={customTo}
            onCustomChange={setCustomRange}
          />
        ) : (
          <p className="text-xs text-text-tertiary">
            Comparing {fyLabel(curFY.year)} (current) vs {fyLabel(prevFY.year)} (previous)
          </p>
        )}
      </div>

      {isLoading2 && <ReportSkeleton summary={0} statement={[5, 4, 3]} />}

      {error2 && (
        <div className="card px-5 py-4 border-red-200 bg-red-50">
          <p className="text-sm text-red-700">Failed to load report: {error2.message}</p>
        </div>
      )}

      {/* Comparative P&L view */}
      {compareMode && cmpData && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border-light">
            <h3 className="text-sm font-semibold text-text-primary">
              Comparative Profit & Loss — {fyLabel(curFY.year)} vs {fyLabel(prevFY.year)}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="text-right">{fyLabel(curFY.year)}</th>
                  <th className="text-right">{fyLabel(prevFY.year)}</th>
                  <th className="text-right">Variance</th>
                </tr>
              </thead>
              <tbody>
                {cmpData.income.length > 0 && (
                  <tr className="bg-surface-1">
                    <td className="font-semibold text-text-primary" colSpan={4}>
                      Income
                    </td>
                  </tr>
                )}
                {cmpData.income.map((row) => (
                  <tr key={row.accountCode}>
                    <td className="pl-4 text-text-primary">{row.accountName}</td>
                    <td className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">{fmtStr(row.currentAmount)}</td>
                    <td className="text-right tabular-nums text-text-secondary">{fmtStr(row.previousAmount)}</td>
                    <VarianceCell variance={row.variance} variancePercent={row.variancePercent} positiveIsGood={true} />
                  </tr>
                ))}
                <tr className="border-t border-border-light bg-surface-1">
                  <td className="font-semibold text-text-primary">Total Income</td>
                  <td className="text-right tabular-nums font-semibold text-emerald-600">{fmtStr(cmpData.currentTotalIncome)}</td>
                  <td className="text-right tabular-nums font-semibold text-text-secondary">{fmtStr(cmpData.previousTotalIncome)}</td>
                  <VarianceCell
                    variance={computeVarianceDisplay(cmpData.currentTotalIncome, cmpData.previousTotalIncome).variance}
                    variancePercent={computeVarianceDisplay(cmpData.currentTotalIncome, cmpData.previousTotalIncome).variancePercent}
                    positiveIsGood={true}
                  />
                </tr>
                {cmpData.expenses.length > 0 && (
                  <tr className="bg-surface-1">
                    <td className="font-semibold text-text-primary" colSpan={4}>
                      Expenses
                    </td>
                  </tr>
                )}
                {cmpData.expenses.map((row) => (
                  <tr key={row.accountCode}>
                    <td className="pl-4 text-text-primary">{row.accountName}</td>
                    <td className="text-right tabular-nums text-amber-700 dark:text-amber-400">{fmtStr(row.currentAmount)}</td>
                    <td className="text-right tabular-nums text-text-secondary">{fmtStr(row.previousAmount)}</td>
                    <VarianceCell variance={row.variance} variancePercent={row.variancePercent} positiveIsGood={false} />
                  </tr>
                ))}
                <tr className="border-t border-border-light bg-surface-1">
                  <td className="font-semibold text-text-primary">Total Expenses</td>
                  <td className="text-right tabular-nums font-semibold text-amber-600">{fmtStr(cmpData.currentTotalExpenses)}</td>
                  <td className="text-right tabular-nums font-semibold text-text-secondary">{fmtStr(cmpData.previousTotalExpenses)}</td>
                  <VarianceCell
                    variance={computeVarianceDisplay(cmpData.currentTotalExpenses, cmpData.previousTotalExpenses).variance}
                    variancePercent={computeVarianceDisplay(cmpData.currentTotalExpenses, cmpData.previousTotalExpenses).variancePercent}
                    positiveIsGood={false}
                  />
                </tr>
                <tr className="border-t-2 border-border-color bg-surface-1">
                  <td className="font-bold text-text-primary">Net Profit / (Loss)</td>
                  <td
                    className={`text-right tabular-nums font-bold ${parseFloat(cmpData.currentNetProfit) >= 0 ? "text-emerald-600" : "text-red-600"}`}
                  >
                    {fmtStr(cmpData.currentNetProfit)}
                  </td>
                  <td
                    className={`text-right tabular-nums font-bold ${parseFloat(cmpData.previousNetProfit) >= 0 ? "text-text-secondary" : "text-red-600"}`}
                  >
                    {fmtStr(cmpData.previousNetProfit)}
                  </td>
                  <VarianceCell
                    variance={cmpData.netProfitVariance}
                    variancePercent={cmpData.netProfitVariancePercent}
                    positiveIsGood={true}
                  />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Standard (non-comparative) view */}
      {!compareMode && data && (
        <>
          {/* Top-line summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="card px-4 py-3">
              <p className="text-xs text-text-tertiary mb-1">Revenue</p>
              <p className="text-lg font-bold tabular-nums text-emerald-600">{fmtStr(data.revenue)}</p>
            </div>
            <div className="card px-4 py-3">
              <p className="text-xs text-text-tertiary mb-1">Cost of Goods Sold</p>
              <p className="text-lg font-bold tabular-nums text-blue-600">{fmtStr(data.cogs)}</p>
            </div>
            <div className="card px-4 py-3">
              <p className="text-xs text-text-tertiary mb-1">Gross Profit</p>
              <p className={`text-lg font-bold tabular-nums ${parseFloat(data.grossProfit) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {fmtStr(data.grossProfit)}
              </p>
              <p className="text-2xs text-text-tertiary mt-0.5">{data.grossMarginPercent}% margin</p>
            </div>
            <div className="card px-4 py-3">
              <p className="text-xs text-text-tertiary mb-1">Expenses</p>
              <p className="text-lg font-bold tabular-nums text-amber-600">{fmtStr(data.totalExpenses)}</p>
            </div>
            <div className="card px-4 py-3 border-2 border-border-color">
              <p className="text-xs text-text-tertiary mb-1 font-semibold">Net Profit</p>
              <p className={`text-xl font-bold tabular-nums ${parseFloat(data.netProfit) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {fmtStr(data.netProfit)}
              </p>
              <p className="text-2xs text-text-tertiary mt-0.5">{data.netMarginPercent}% margin</p>
            </div>
          </div>

          {/* P&L Statement table */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-border-light">
              <h3 className="text-sm font-semibold text-text-primary">Profit & Loss Statement</h3>
            </div>
            <table className="data-table">
              <tbody>
                <tr className="bg-surface-1">
                  <td className="font-semibold text-text-primary">Revenue (Sales)</td>
                  <td className="text-right tabular-nums font-semibold text-emerald-600">{fmtStr(data.revenue)}</td>
                </tr>
                <tr>
                  <td className="text-text-secondary pl-6">Opening stock</td>
                  <td className="text-right tabular-nums text-text-tertiary">{fmtStr(data.openingStock)}</td>
                </tr>
                <tr>
                  <td className="text-text-secondary pl-6">Add: Purchases</td>
                  <td className="text-right tabular-nums text-text-tertiary">{fmtStr(data.purchases)}</td>
                </tr>
                <tr>
                  <td className="text-text-secondary pl-6">
                    Less: Closing stock
                    <span className="ml-1 text-2xs text-text-tertiary">
                      ({data.valuationMethod === "fifo" ? "FIFO" : "average cost"})
                    </span>
                  </td>
                  <td className="text-right tabular-nums text-text-tertiary">({fmtStr(data.closingStock)})</td>
                </tr>
                <tr>
                  <td className="text-text-secondary pl-6">Less: Cost of Goods Sold</td>
                  <td className="text-right tabular-nums text-text-secondary">({fmtStr(data.cogs)})</td>
                </tr>
                <tr className="border-t border-border-light bg-surface-1">
                  <td className="font-semibold text-text-primary">Gross Profit</td>
                  <td className={`text-right tabular-nums font-semibold ${parseFloat(data.grossProfit) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {fmtStr(data.grossProfit)} <span className="text-2xs font-normal text-text-tertiary">({data.grossMarginPercent}%)</span>
                  </td>
                </tr>
                {data.expenses.length > 0 && (
                  <tr>
                    <td className="font-medium text-text-primary pt-3 pb-1" colSpan={2}>Operating Expenses</td>
                  </tr>
                )}
                {data.expenses.map((exp) => (
                  <tr key={exp.category}>
                    <td className="text-text-secondary pl-6">{exp.category}</td>
                    <td className="text-right tabular-nums text-text-secondary">({fmtStr(exp.total)})</td>
                  </tr>
                ))}
                <tr className="border-t border-border-light">
                  <td className="text-text-primary pl-6 font-medium">Total Operating Expenses</td>
                  <td className="text-right tabular-nums text-amber-600 font-medium">({fmtStr(data.totalExpenses)})</td>
                </tr>
                <tr className="border-t-2 border-border-color bg-surface-1">
                  <td className="font-bold text-text-primary">Net Profit / (Loss)</td>
                  <td className={`text-right tabular-nums font-bold text-lg ${parseFloat(data.netProfit) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {fmtStr(data.netProfit)} <span className="text-2xs font-normal text-text-tertiary">({data.netMarginPercent}%)</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Client-side variance helper ───────────────────────────────
function computeVarianceDisplay(current: string, previous: string): { variance: string; variancePercent: string } {
  const c = parseFloat(current) || 0;
  const p = parseFloat(previous) || 0;
  const v = c - p;
  const prevAbs = Math.abs(p);
  const pct = prevAbs === 0 ? "N/A" : ((v / prevAbs) * 100).toFixed(1);
  return { variance: v.toFixed(2), variancePercent: pct };
}

// ── Variance cell helper ───────────────────────────────────────
function VarianceCell({
  variance,
  variancePercent,
  positiveIsGood = true,
}: {
  variance: string;
  variancePercent: string;
  positiveIsGood?: boolean;
}) {
  const v = parseFloat(variance);
  const isGood = positiveIsGood ? v > 0 : v < 0;
  const isNeutral = v === 0;
  const colorClass = isNeutral
    ? "text-text-tertiary"
    : isGood
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400";
  const prefix = v > 0 ? "+" : "";
  return (
    <td className={`text-right tabular-nums ${colorClass}`}>
      {prefix}
      {fmtStr(variance)}
      {variancePercent !== "N/A" && (
        <span className="text-2xs ml-1 opacity-70">
          ({prefix}
          {variancePercent}%)
        </span>
      )}
    </td>
  );
}

// ── Compare toggle ─────────────────────────────────────────────
function CompareToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <span className="text-xs text-text-secondary">Compare with previous FY</span>
      <button
        role="switch"
        aria-checked={enabled}
        onClick={onToggle}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? "bg-primary" : "bg-border-color"}`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${enabled ? "translate-x-4" : "translate-x-0.5"}`}
        />
      </button>
    </label>
  );
}

// ── Trial Balance View ─────────────────────────────────────────

export function TrialBalanceView() {
  const [compareMode, setCompareMode] = useState(false);
  const curFY = getCurrentFYBounds();
  const prevFY = getPreviousFYBounds();

  const { data, isLoading, error } = trpc.reports.trialBalance.useQuery(
    { asOfDate: curFY.end },
    { enabled: !compareMode },
  );

  const { data: cmpData, isLoading: cmpLoading, error: cmpError } = trpc.reports.comparativeTrialBalance.useQuery(
    {
      currentFYStart: curFY.start,
      currentFYEnd: curFY.end,
      previousFYStart: prevFY.start,
      previousFYEnd: prevFY.end,
    },
    { enabled: compareMode },
  );

  const loading = compareMode ? cmpLoading : isLoading;
  const err = compareMode ? cmpError : error;

  return (
    <div className="space-y-5">
      <div className="card px-4 py-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-text-primary">Trial Balance</p>
          <p className="text-xs text-text-tertiary mt-0.5">
            {compareMode ? `${fyLabel(curFY.year)} vs ${fyLabel(prevFY.year)}` : `${fyLabel(curFY.year)} — year to date`}
          </p>
        </div>
        <CompareToggle enabled={compareMode} onToggle={() => setCompareMode((v) => !v)} />
      </div>

      {loading && <ReportSkeleton columns={[{ label: "Code", kind: "mono" }, { label: "Account" }, { label: "Type", kind: "badge" }, { label: "Debit", align: "right" }, { label: "Credit", align: "right" }, { label: "Balance", align: "right" }]} />}
      {err && (
        <div className="card px-5 py-4 border-red-200 bg-red-50">
          <p className="text-sm text-red-700">Failed to load trial balance: {err.message}</p>
        </div>
      )}

      {!compareMode && data && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Account</th>
                  <th>Type</th>
                  <th className="text-right">Debit</th>
                  <th className="text-right">Credit</th>
                  <th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.accounts.map((a) => (
                  <tr key={a.accountCode}>
                    <td className="font-mono text-ui text-text-secondary">{a.accountCode}</td>
                    <td className="text-text-primary">{a.accountName}</td>
                    <td className="text-ui text-text-secondary capitalize">{a.accountType}</td>
                    <td className="text-right tabular-nums">
                      {parseFloat(a.debit) > 0 ? fmtStr(a.debit) : <span className="text-text-tertiary">—</span>}
                    </td>
                    <td className="text-right tabular-nums">
                      {parseFloat(a.credit) > 0 ? fmtStr(a.credit) : <span className="text-text-tertiary">—</span>}
                    </td>
                    <td className="text-right tabular-nums font-medium">{fmtStr(a.balance)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border-color bg-surface-1 font-semibold">
                  <td colSpan={3} className="font-bold text-text-primary">
                    Total
                  </td>
                  <td className="text-right tabular-nums font-bold">{fmtStr(data.totalDebit)}</td>
                  <td className="text-right tabular-nums font-bold">{fmtStr(data.totalCredit)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {compareMode && cmpData && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border-light">
            <h3 className="text-sm font-semibold text-text-primary">
              Comparative Trial Balance — {fyLabel(curFY.year)} vs {fyLabel(prevFY.year)}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th rowSpan={2}>Code</th>
                  <th rowSpan={2}>Account</th>
                  <th colSpan={2} className="text-center border-l border-border-light">
                    {fyLabel(curFY.year)}
                  </th>
                  <th colSpan={2} className="text-center border-l border-border-light">
                    {fyLabel(prevFY.year)}
                  </th>
                  <th rowSpan={2} className="text-right border-l border-border-light">
                    Variance
                  </th>
                </tr>
                <tr>
                  <th className="text-right border-l border-border-light">Debit</th>
                  <th className="text-right">Credit</th>
                  <th className="text-right border-l border-border-light">Debit</th>
                  <th className="text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {cmpData.accounts.map((a) => (
                  <tr key={a.accountCode}>
                    <td className="font-mono text-ui text-text-secondary">{a.accountCode}</td>
                    <td className="text-text-primary">{a.accountName}</td>
                    <td className="text-right tabular-nums border-l border-border-light">
                      {parseFloat(a.currentDebit) > 0 ? fmtStr(a.currentDebit) : <span className="text-text-tertiary">—</span>}
                    </td>
                    <td className="text-right tabular-nums">
                      {parseFloat(a.currentCredit) > 0 ? fmtStr(a.currentCredit) : <span className="text-text-tertiary">—</span>}
                    </td>
                    <td className="text-right tabular-nums border-l border-border-light text-text-secondary">
                      {parseFloat(a.previousDebit) > 0 ? fmtStr(a.previousDebit) : <span className="text-text-tertiary">—</span>}
                    </td>
                    <td className="text-right tabular-nums text-text-secondary">
                      {parseFloat(a.previousCredit) > 0 ? fmtStr(a.previousCredit) : <span className="text-text-tertiary">—</span>}
                    </td>
                    <VarianceCell variance={a.variance} variancePercent={a.variancePercent} positiveIsGood={true} />
                  </tr>
                ))}
                <tr className="border-t-2 border-border-color bg-surface-1">
                  <td colSpan={2} className="font-bold text-text-primary">
                    Total
                  </td>
                  <td className="text-right tabular-nums font-bold border-l border-border-light">{fmtStr(cmpData.currentTotalDebit)}</td>
                  <td className="text-right tabular-nums font-bold">{fmtStr(cmpData.currentTotalCredit)}</td>
                  <td className="text-right tabular-nums font-bold border-l border-border-light text-text-secondary">
                    {fmtStr(cmpData.previousTotalDebit)}
                  </td>
                  <td className="text-right tabular-nums font-bold text-text-secondary">{fmtStr(cmpData.previousTotalCredit)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Balance Sheet View ─────────────────────────────────────────

export function BalanceSheetView() {
  const [compareMode, setCompareMode] = useState(false);
  const curFY = getCurrentFYBounds();
  const prevFY = getPreviousFYBounds();

  const { data, isLoading, error } = trpc.reports.balanceSheet.useQuery(
    { asOfDate: curFY.end },
    { enabled: !compareMode },
  );

  const { data: cmpData, isLoading: cmpLoading, error: cmpError } = trpc.reports.comparativeBalanceSheet.useQuery(
    { currentAsOf: curFY.end, previousAsOf: prevFY.end },
    { enabled: compareMode },
  );

  const loading = compareMode ? cmpLoading : isLoading;
  const err = compareMode ? cmpError : error;

  return (
    <div className="space-y-5">
      <div className="card px-4 py-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-text-primary">Balance Sheet</p>
          <p className="text-xs text-text-tertiary mt-0.5">
            {compareMode ? `${fyLabel(curFY.year)} vs ${fyLabel(prevFY.year)}` : `As of today — ${fyLabel(curFY.year)}`}
          </p>
        </div>
        <CompareToggle enabled={compareMode} onToggle={() => setCompareMode((v) => !v)} />
      </div>

      {loading && <ReportSkeleton summary={0} statement={[5, 4, 3]} />}
      {err && (
        <div className="card px-5 py-4 border-red-200 bg-red-50">
          <p className="text-sm text-red-700">Failed to load balance sheet: {err.message}</p>
        </div>
      )}

      {!compareMode && data && (
        <>
          <BsSection title="Assets" items={data.assets} total={data.totalAssets} />
          <BsSection title="Liabilities" items={data.liabilities} total={data.totalLiabilities} />
          <BsSection title="Equity" items={data.equity} total={data.totalEquity} />
        </>
      )}

      {compareMode && cmpData && (
        <>
          <ComparativeBsSection
            title="Assets"
            items={cmpData.assets}
            currentTotal={cmpData.currentTotalAssets}
            previousTotal={cmpData.previousTotalAssets}
            curFYLabel={fyLabel(curFY.year)}
            prevFYLabel={fyLabel(prevFY.year)}
            positiveIsGood={true}
          />
          <ComparativeBsSection
            title="Liabilities"
            items={cmpData.liabilities}
            currentTotal={cmpData.currentTotalLiabilities}
            previousTotal={cmpData.previousTotalLiabilities}
            curFYLabel={fyLabel(curFY.year)}
            prevFYLabel={fyLabel(prevFY.year)}
            positiveIsGood={false}
          />
          <ComparativeBsSection
            title="Equity"
            items={cmpData.equity}
            currentTotal={cmpData.currentTotalEquity}
            previousTotal={cmpData.previousTotalEquity}
            curFYLabel={fyLabel(curFY.year)}
            prevFYLabel={fyLabel(prevFY.year)}
            positiveIsGood={true}
          />
        </>
      )}
    </div>
  );
}

// ── Balance Sheet sub-components ──────────────────────────────

function BsSection({
  title,
  items,
  total,
}: {
  title: string;
  items: Array<{ accountCode: string; accountName: string; balance: string }>;
  total: string;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-border-light">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      </div>
      <table className="data-table">
        <tbody>
          {items.map((item) => (
            <tr key={item.accountCode}>
              <td className="font-mono text-ui text-text-secondary w-20">{item.accountCode}</td>
              <td className="text-text-primary">{item.accountName}</td>
              <td className="text-right tabular-nums font-medium">{fmtStr(item.balance)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-border-color bg-surface-1">
            <td colSpan={2} className="font-bold text-text-primary">
              Total {title}
            </td>
            <td className="text-right tabular-nums font-bold">{fmtStr(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ComparativeBsSection({
  title,
  items,
  currentTotal,
  previousTotal,
  curFYLabel,
  prevFYLabel,
  positiveIsGood,
}: {
  title: string;
  items: Array<{
    accountCode: string;
    accountName: string;
    currentBalance: string;
    previousBalance: string;
    variance: string;
    variancePercent: string;
  }>;
  currentTotal: string;
  previousTotal: string;
  curFYLabel: string;
  prevFYLabel: string;
  positiveIsGood: boolean;
}) {
  const totals = computeVarianceDisplay(currentTotal, previousTotal);
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-border-light">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Account</th>
              <th className="text-right">{curFYLabel}</th>
              <th className="text-right">{prevFYLabel}</th>
              <th className="text-right">Variance</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.accountCode}>
                <td className="font-mono text-ui text-text-secondary">{item.accountCode}</td>
                <td className="text-text-primary">{item.accountName}</td>
                <td className="text-right tabular-nums font-medium">{fmtStr(item.currentBalance)}</td>
                <td className="text-right tabular-nums text-text-secondary">{fmtStr(item.previousBalance)}</td>
                <VarianceCell variance={item.variance} variancePercent={item.variancePercent} positiveIsGood={positiveIsGood} />
              </tr>
            ))}
            <tr className="border-t-2 border-border-color bg-surface-1">
              <td colSpan={2} className="font-bold text-text-primary">
                Total {title}
              </td>
              <td className="text-right tabular-nums font-bold">{fmtStr(currentTotal)}</td>
              <td className="text-right tabular-nums font-bold text-text-secondary">{fmtStr(previousTotal)}</td>
              <VarianceCell variance={totals.variance} variancePercent={totals.variancePercent} positiveIsGood={positiveIsGood} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Aging Report View ──────────────────────────────────────────

type AgingSortKey = "partyName" | "current" | "days31_60" | "days61_90" | "days90Plus" | "total";

export function AgingReportView() {
  const [sortKey, setSortKey] = useState<AgingSortKey>("total");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data, isLoading, error } = trpc.dashboard.receivablesAging.useQuery();

  function handleSort(key: AgingSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sortedRows = data?.rows ? [...data.rows].sort((a, b) => {
    let av: string | number = a[sortKey];
    let bv: string | number = b[sortKey];
    if (sortKey !== "partyName") {
      av = parseFloat(av as string);
      bv = parseFloat(bv as string);
    }
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  }) : [];

  function SortIcon({ col }: { col: AgingSortKey }) {
    if (sortKey !== col) return <span className="text-text-tertiary ml-1">↕</span>;
    return <span className="text-text-primary ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  return (
    <div className="space-y-5">
      {/* Info card */}
      <div className="card px-4 py-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
        <p className="text-sm text-blue-700 dark:text-blue-400">
          Showing all unpaid sale invoices grouped by customer and bucketed by days overdue (based on due date or invoice date).
        </p>
      </div>

      {isLoading && <ReportSkeleton columns={[{ label: "Party" }, { label: "0–30 days", align: "right" }, { label: "31–60 days", align: "right" }, { label: "61–90 days", align: "right" }, { label: "90+ days", align: "right" }, { label: "Total", align: "right" }]} />}

      {error && (
        <div className="card px-5 py-4 border-red-200 bg-red-50">
          <p className="text-sm text-red-700">Failed to load aging report: {error.message}</p>
        </div>
      )}

      {data && data.rows.length === 0 && (
        <EmptyState
          title="No outstanding receivables"
          description="All your sale invoices are paid or cancelled."
        />
      )}

      {data && data.rows.length > 0 && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="card px-4 py-3 border-l-4 border-emerald-500">
              <p className="text-xs text-text-tertiary mb-1">Current (0–30 days)</p>
              <p className="text-base font-bold tabular-nums text-emerald-600">{fmtStr(data.summary.current)}</p>
            </div>
            <div className="card px-4 py-3 border-l-4 border-amber-400">
              <p className="text-xs text-text-tertiary mb-1">31–60 days</p>
              <p className="text-base font-bold tabular-nums text-amber-600">{fmtStr(data.summary.days31_60)}</p>
            </div>
            <div className="card px-4 py-3 border-l-4 border-orange-500">
              <p className="text-xs text-text-tertiary mb-1">61–90 days</p>
              <p className="text-base font-bold tabular-nums text-orange-600">{fmtStr(data.summary.days61_90)}</p>
            </div>
            <div className="card px-4 py-3 border-l-4 border-red-500">
              <p className="text-xs text-text-tertiary mb-1">90+ days</p>
              <p className="text-base font-bold tabular-nums text-red-600">{fmtStr(data.summary.days90Plus)}</p>
            </div>
            <div className="card px-4 py-3 border-2 border-border-color">
              <p className="text-xs text-text-tertiary mb-1 font-semibold">Total Outstanding</p>
              <p className="text-lg font-bold tabular-nums text-text-primary">{fmtStr(data.summary.total)}</p>
            </div>
          </div>

          {/* Aging table */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-border-light">
              <h3 className="text-sm font-semibold text-text-primary">
                Receivables Aging — {data.rows.length} {data.rows.length === 1 ? "customer" : "customers"}
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>
                      <button className="text-left w-full" onClick={() => handleSort("partyName")}>
                        Party <SortIcon col="partyName" />
                      </button>
                    </th>
                    <th className="text-right">
                      <button onClick={() => handleSort("current")}>
                        0–30 days <SortIcon col="current" />
                      </button>
                    </th>
                    <th className="text-right">
                      <button onClick={() => handleSort("days31_60")}>
                        31–60 days <SortIcon col="days31_60" />
                      </button>
                    </th>
                    <th className="text-right">
                      <button onClick={() => handleSort("days61_90")}>
                        61–90 days <SortIcon col="days61_90" />
                      </button>
                    </th>
                    <th className="text-right">
                      <button onClick={() => handleSort("days90Plus")}>
                        90+ days <SortIcon col="days90Plus" />
                      </button>
                    </th>
                    <th className="text-right">
                      <button onClick={() => handleSort("total")}>
                        Total <SortIcon col="total" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => (
                    <tr key={row.partyId}>
                      <td className="font-medium text-text-primary">{row.partyName}</td>
                      <td className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                        {parseFloat(row.current) > 0 ? fmtStr(row.current) : <span className="text-text-tertiary">—</span>}
                      </td>
                      <td className="text-right tabular-nums text-amber-700 dark:text-amber-400">
                        {parseFloat(row.days31_60) > 0 ? fmtStr(row.days31_60) : <span className="text-text-tertiary">—</span>}
                      </td>
                      <td className="text-right tabular-nums text-orange-700 dark:text-orange-400">
                        {parseFloat(row.days61_90) > 0 ? fmtStr(row.days61_90) : <span className="text-text-tertiary">—</span>}
                      </td>
                      <td className="text-right tabular-nums text-red-700 dark:text-red-400">
                        {parseFloat(row.days90Plus) > 0 ? fmtStr(row.days90Plus) : <span className="text-text-tertiary">—</span>}
                      </td>
                      <td className="text-right tabular-nums font-semibold text-text-primary">
                        {fmtStr(row.total)}
                      </td>
                    </tr>
                  ))}
                  {/* Summary row */}
                  <tr className="border-t-2 border-border-color bg-surface-1 font-semibold">
                    <td className="font-bold text-text-primary">Total</td>
                    <td className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">{fmtStr(data.summary.current)}</td>
                    <td className="text-right tabular-nums text-amber-700 dark:text-amber-400">{fmtStr(data.summary.days31_60)}</td>
                    <td className="text-right tabular-nums text-orange-700 dark:text-orange-400">{fmtStr(data.summary.days61_90)}</td>
                    <td className="text-right tabular-nums text-red-700 dark:text-red-400">{fmtStr(data.summary.days90Plus)}</td>
                    <td className="text-right tabular-nums font-bold text-text-primary">{fmtStr(data.summary.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Party Ledger View ──────────────────────────────────────────

export function PartyLedgerView() {
  const [partyId, setPartyId] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const { preset, setPreset, fromDate, toDate, customFrom, customTo, setCustomRange } =
    useDateRange("ledger-report", "this-fy");

  const { data: partiesData } = trpc.party.list.useQuery({ limit: 100, page: 1 });
  const partyOptions = (partiesData?.data ?? []).map((p) => ({
    value: p.id,
    label: p.name,
    description: p.type === "customer" ? "Customer" : "Supplier",
  }));

  const { data, isLoading, error } = trpc.party.ledgerReport.useQuery(
    {
      partyId,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    },
    { enabled: !!partyId }
  );

  const utils = trpc.useUtils();

  async function handleExportCSV() {
    if (!partyId) return;
    setExporting(true);
    try {
      const result = await utils.party.ledgerReportCSV.fetch({
        partyId,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      });
      if (!result) return;
      const blob = new Blob(["\ufeff" + result.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Ledger CSV exported");
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function handleExportPDF() {
    if (!partyId) return;
    setExportingPdf(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      const res = await fetch(apiUrl(`/api/parties/${partyId}/ledger.pdf?${params}`), {
        credentials: "include",
        headers: { "x-business-id": getBusinessId() || "" },
      });
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ledger-${data?.party.name || "party"}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("PDF export failed");
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Party selector + date range */}
      <div className="card px-4 py-4 space-y-4">
        <div className="w-full max-w-sm">
          <Combobox
            label="Select Party"
            placeholder="Search parties…"
            value={partyId}
            onChange={setPartyId}
            options={partyOptions}
            emptyMessage="No parties found"
          />
        </div>
        <DateRangeBar
          preset={preset}
          onPresetChange={setPreset}
          customFrom={customFrom}
          customTo={customTo}
          onCustomChange={setCustomRange}
        />
      </div>

      {!partyId && (
        <EmptyState
          title="Select a party"
          description="Choose a customer or supplier above to view their ledger."
        />
      )}

      {partyId && isLoading && <ReportSkeleton columns={[{ label: "Date" }, { label: "Document #", kind: "mono" }, { label: "Description" }, { label: "Debit", align: "right" }, { label: "Credit", align: "right" }, { label: "Balance", align: "right" }]} />}

      {partyId && error && (
        <div className="card px-5 py-4 border-red-200 bg-red-50">
          <p className="text-sm text-red-700">Failed to load ledger: {error.message}</p>
        </div>
      )}

      {partyId && !isLoading && !error && !data && (
        <EmptyState title="Party not found" description="The selected party could not be found." />
      )}

      {data && (
        <>
          {/* Party info + summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="card px-4 py-3 col-span-2 lg:col-span-1">
              <p className="text-xs text-text-tertiary mb-1">Party</p>
              <p className="text-base font-bold text-text-primary truncate">{data.party.name}</p>
              <p className="text-xs text-text-secondary capitalize">{data.party.type}</p>
            </div>
            <div className="card px-4 py-3">
              <p className="text-xs text-text-tertiary mb-1">Opening Balance</p>
              <p className="text-lg font-bold tabular-nums text-text-primary">{fmtStr(data.party.openingBalance)}</p>
            </div>
            <div className="card px-4 py-3">
              <p className="text-xs text-text-tertiary mb-1">Total Debit</p>
              <p className="text-lg font-bold tabular-nums text-text-primary">{fmtStr(data.summary.totalDebit)}</p>
            </div>
            <div className="card px-4 py-3">
              <p className="text-xs text-text-tertiary mb-1">Closing Balance</p>
              <p className={`text-lg font-bold tabular-nums ${parseFloat(data.summary.closingBalance) > 0 ? "text-red-600" : "text-emerald-600"}`}>
                {fmtStr(data.summary.closingBalance)}
              </p>
            </div>
          </div>

          {/* Ledger table */}
          {data.entries.length === 0 ? (
            <EmptyState
              title="No transactions"
              description="No invoices or payments found for this party in the selected period."
            />
          ) : (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-border-light flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text-primary">
                  Ledger — {data.entries.length} entries
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleExportCSV}
                    disabled={exporting}
                    className="btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1.5"
                  >
                    {exporting ? (
                      <>
                        <Spinner size="xs" />
                        Exporting…
                      </>
                    ) : (
                      <>
                        <Icon icon={Download04Icon} size={14} />
                        Export CSV
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleExportPDF}
                    disabled={exportingPdf}
                    className="btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1.5"
                  >
                    {exportingPdf ? (
                      <>
                        <Spinner size="xs" />
                        Exporting…
                      </>
                    ) : (
                      <>
                        <Icon icon={Download04Icon} size={14} />
                        Export PDF
                      </>
                    )}
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Document #</th>
                      <th>Description</th>
                      <th className="text-right">Debit</th>
                      <th className="text-right">Credit</th>
                      <th className="text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Opening balance row */}
                    <tr className="bg-surface-1">
                      <td className="text-text-tertiary text-xs italic" colSpan={3}>Opening Balance</td>
                      <td className="text-right tabular-nums text-text-tertiary">—</td>
                      <td className="text-right tabular-nums text-text-tertiary">—</td>
                      <td className="text-right tabular-nums font-medium">{fmtStr(data.party.openingBalance)}</td>
                    </tr>
                    {data.entries.map((e, i) => (
                      <tr key={i}>
                        <td className="text-text-secondary text-ui">{formatDate(e.date)}</td>
                        <td className="font-mono text-ui text-text-secondary">{e.number || "—"}</td>
                        <td className="text-text-primary">{e.description}</td>
                        <td className="text-right tabular-nums">
                          {e.debit !== "0" && e.debit !== "0.00" ? fmtStr(e.debit) : <span className="text-text-tertiary">—</span>}
                        </td>
                        <td className="text-right tabular-nums">
                          {e.credit !== "0" && e.credit !== "0.00" ? fmtStr(e.credit) : <span className="text-text-tertiary">—</span>}
                        </td>
                        <td className={`text-right tabular-nums font-medium ${parseFloat(e.runningBalance) > 0 ? "text-red-600" : "text-emerald-600"}`}>
                          {fmtStr(e.runningBalance)}
                        </td>
                      </tr>
                    ))}
                    {/* Closing balance row */}
                    <tr className="bg-surface-1 border-t-2 border-border-light">
                      <td className="font-semibold text-text-primary text-xs" colSpan={3}>Closing Balance</td>
                      <td className="text-right tabular-nums font-semibold">{fmtStr(data.summary.totalDebit)}</td>
                      <td className="text-right tabular-nums font-semibold">{fmtStr(data.summary.totalCredit)}</td>
                      <td className={`text-right tabular-nums font-bold ${parseFloat(data.summary.closingBalance) > 0 ? "text-red-600" : "text-emerald-600"}`}>
                        {fmtStr(data.summary.closingBalance)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Tally Export View ──────────────────────────────────────────

export function TallyExportView() {
  const [downloading, setDownloading] = useState(false);

  const { preset, setPreset, fromDate, toDate, customFrom, customTo, setCustomRange } =
    useDateRange("tally-export", "this-fy");

  const { data, isLoading } = trpc.party.tallyExport.useQuery({
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
  });

  const utils = trpc.useUtils();

  async function handleDownload() {
    setDownloading(true);
    try {
      const result = await utils.party.tallyExport.fetch({
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      });
      if (!result) return;
      const blob = new Blob(["\ufeff" + result.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Tally export downloaded — ${result.rowCount} vouchers`);
    } catch {
      toast.error("Export failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Period selector */}
      <div className="card px-4 py-4">
        <p className="text-xs text-text-tertiary mb-3 font-medium uppercase tracking-wide">Period</p>
        <DateRangeBar
          preset={preset}
          onPresetChange={setPreset}
          customFrom={customFrom}
          customTo={customTo}
          onCustomChange={setCustomRange}
        />
      </div>

      {/* Summary + download */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="card px-4 py-3">
          <p className="text-xs text-text-tertiary mb-1">Total Vouchers</p>
          <p className="text-lg font-bold tabular-nums text-text-primary">
            {isLoading ? "—" : (data?.rowCount ?? 0)}
          </p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-xs text-text-tertiary mb-1">Format</p>
          <p className="text-base font-semibold text-text-primary">Tally CSV</p>
          <p className="text-xs text-text-tertiary">Compatible with Tally ERP 9 / Prime</p>
        </div>
        <div className="card px-4 py-3 flex items-center">
          <button
            onClick={handleDownload}
            disabled={downloading || isLoading}
            className="btn-primary w-full inline-flex items-center justify-center gap-2"
          >
            {downloading ? (
              <>
                <Spinner size="sm" className="text-white" />
                Preparing…
              </>
            ) : (
              <>
                <Icon icon={Download04Icon} size={16} />
                Download Tally Export
              </>
            )}
          </button>
        </div>
      </div>

      {/* Preview table */}
      {isLoading && <ReportSkeleton columns={[{ label: "Date" }, { label: "Vch Type" }, { label: "Vch No." }, { label: "Debit Ledger" }, { label: "Credit Ledger" }, { label: "Amount", align: "right" }]} />}

      {data && data.preview.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border-light">
            <h3 className="text-sm font-semibold text-text-primary">
              Preview — first {data.preview.length} of {data.rowCount} vouchers
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Vch Type</th>
                  <th>Vch No.</th>
                  <th>Debit Ledger</th>
                  <th>Credit Ledger</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.preview.map((row, i) => (
                  <tr key={i}>
                    <td className="text-text-secondary text-ui tabular-nums">{row.date}</td>
                    <td className="text-text-secondary text-ui">{row.vchType}</td>
                    <td className="font-mono text-ui text-text-secondary">{row.vchNo || "—"}</td>
                    <td className="text-text-primary">{row.debitLedger}</td>
                    <td className="text-text-primary">{row.creditLedger}</td>
                    <td className="text-right tabular-nums font-medium">{fmtStr(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.rowCount > 10 && (
            <div className="px-4 py-3 border-t border-border-light">
              <p className="text-xs text-text-tertiary">
                Showing 10 of {data.rowCount} vouchers. Download the full export to see all entries.
              </p>
            </div>
          )}
        </div>
      )}

      {data && data.rowCount === 0 && (
        <EmptyState
          title="No vouchers found"
          description="No invoices, payments or expenses found for the selected period."
        />
      )}
    </div>
  );
}
