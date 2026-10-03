import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useCan } from "@/lib/permissions";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";

/** Start year of the Indian financial year (April to March) that contains `d`. */
export function currentFyStart(d: Date = new Date()): number {
  return d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
}

const fyName = (start: number) => `FY ${start}-${String((start + 1) % 100).padStart(2, "0")}`;

interface Filed {
  arn: string | null;
  filedOn: string | null;
  mode: string | null;
  valid: boolean | null;
}

/** "2026-05-11" -> "11 May 2026" (the API date is a calendar day, so no time zone is involved). */
function day(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!m) return "Not available";
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[3])} ${names[Number(m[2]) - 1]} ${m[1]}`;
}

/** Filed / Not filed as words (never colour alone), plus date, ARN, mode and the portal's valid flag. */
function Cell({ filed, label }: { filed: Filed | null; label: string }) {
  if (!filed) {
    return (
      <span className="inline-flex items-center gap-1 text-amber-800 dark:text-amber-300">
        <span aria-hidden="true">○</span>
        <span>Not filed<span className="sr-only"> ({label})</span></span>
      </span>
    );
  }
  return (
    <div className="space-y-0.5">
      <span className="inline-flex items-center gap-1 font-medium text-emerald-800 dark:text-emerald-300">
        <span aria-hidden="true">●</span>
        <span>Filed<span className="sr-only"> ({label})</span></span>
      </span>
      <div className="text-xs text-text-tertiary">
        {day(filed.filedOn)}
        {filed.mode ? ` · ${filed.mode}` : ""}
        {filed.valid === null ? "" : filed.valid ? " · Valid" : " · Not valid"}
      </div>
      <div className="text-xs text-text-tertiary break-all">ARN {filed.arn ?? "not available"}</div>
    </div>
  );
}

/**
 * What the GST portal says is filed for a financial year, month by month
 * (GSTR-1 and GSTR-3B; other returns it lists appear under "Also filed").
 * Read-only. Data comes from Sandbox's "Track GST Returns".
 */
export function ReturnStatusPanel() {
  const canRead = useCan("GstReport", "read");
  const [fy, setFy] = useState(currentFyStart());
  const [forced, setForced] = useState(false);
  const { data, isLoading, isFetching, error, refetch } = trpc.gstReturns.filingStatus.useQuery(
    { fyStartYear: fy, refresh: forced },
    { enabled: canRead, retry: false, refetchOnWindowFocus: false },
  );
  if (!canRead) return null;

  const start = currentFyStart();
  const years = Array.from({ length: 5 }, (_, i) => start - i);
  const refresh = () => {
    if (forced) void refetch();
    else setForced(true);
  };

  return (
    <section aria-labelledby="return-status-title" className="card px-4 py-4 mb-6 space-y-3" data-testid="return-status-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="return-status-title" className="text-sm font-semibold text-text-primary">Return status</h2>
          <p className="text-xs text-text-tertiary">From the GST portal via Sandbox. Read-only; check it before you file.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            className="input w-36"
            aria-label="Return status financial year"
            value={fy}
            onChange={(e) => {
              setFy(Number(e.target.value));
              setForced(false);
            }}
          >
            {years.map((y) => (
              <option key={y} value={y}>{fyName(y)}</option>
            ))}
          </Select>
          <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={refresh} disabled={isFetching}>
            {isFetching && <Spinner size="sm" />}
            Refresh
          </button>
        </div>
      </div>

      {isLoading && <p className="text-xs text-text-tertiary" role="status">Checking the GST portal…</p>}
      {error && <p className="text-xs text-red-700 dark:text-red-400" role="alert">{error.message}</p>}
      {data?.status === "unavailable" && (
        <p className="text-xs text-amber-800 dark:text-amber-300" role="status">
          Could not check the GST portal: {data.reason} Make sure earlier returns are filed before you continue.
        </p>
      )}
      {data?.composition && (
        <p className="text-xs text-text-tertiary">Composition dealers file CMP-08 and GSTR-4; monthly GSTR-1 and GSTR-3B do not apply.</p>
      )}

      {data?.status === "ok" && (
        <>
          <p className="text-xs text-text-tertiary">
            {data.financialYear}
            {data.fetchedAt ? ` · checked ${new Date(data.fetchedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : ""}
            {data.cached ? " (saved copy, use Refresh for the latest)" : ""}
          </p>

          {/* Phone: one card per month. */}
          <ul className="space-y-2 sm:hidden" aria-label={`Return status by month, ${data.financialYear}`}>
            {data.months.map((m) => (
              <li key={m.period} className="rounded-lg border border-border px-3 py-2 space-y-2" data-testid={`status-card-${m.period}`}>
                <div className="text-sm font-medium">{m.label}</div>
                <div className="grid grid-cols-1 gap-2 text-sm">
                  <div><div className="text-xs text-text-tertiary">GSTR-1</div><Cell filed={m.gstr1} label={`GSTR-1 ${m.label}`} /></div>
                  <div><div className="text-xs text-text-tertiary">GSTR-3B</div><Cell filed={m.gstr3b} label={`GSTR-3B ${m.label}`} /></div>
                </div>
                {m.others.length > 0 && <p className="text-xs text-text-tertiary">Also filed: {m.others.map((o) => o.rawType).join(", ")}</p>}
              </li>
            ))}
          </ul>

          {/* Wider screens: a table. */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Return status by month, {data.financialYear}</caption>
              <thead>
                <tr className="text-left text-xs text-text-tertiary">
                  <th scope="col" className="py-1 pr-3 font-medium">Month</th>
                  <th scope="col" className="py-1 pr-3 font-medium">GSTR-1</th>
                  <th scope="col" className="py-1 pr-3 font-medium">GSTR-3B</th>
                  <th scope="col" className="py-1 font-medium">Also filed</th>
                </tr>
              </thead>
              <tbody>
                {data.months.map((m) => (
                  <tr key={m.period} className="border-t border-border align-top" data-testid={`status-row-${m.period}`}>
                    <th scope="row" className="py-2 pr-3 text-left font-medium">{m.label}</th>
                    <td className="py-2 pr-3"><Cell filed={m.gstr1} label={`GSTR-1 ${m.label}`} /></td>
                    <td className="py-2 pr-3"><Cell filed={m.gstr3b} label={`GSTR-3B ${m.label}`} /></td>
                    <td className="py-2 text-xs text-text-tertiary">{m.others.length ? m.others.map((o) => o.rawType).join(", ") : "None"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
