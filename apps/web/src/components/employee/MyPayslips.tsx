import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { formatCurrency } from "@/lib/utils";
import { downloadBase64 } from "@/components/payroll/payroll-ui";

function messageOf(e: unknown): string {
  return (e as { message?: string } | null)?.message || "Something went wrong. Please try again.";
}

/** My payslips (approved runs only) and, when HR has released it, my Form 16 working copy. */
export function MyPayslips() {
  const utils = trpc.useUtils();
  const slips = trpc.payrollSelf.payslips.useQuery();
  const years = trpc.payrollSelf.form16Years.useQuery();

  async function payslip(runId: string) {
    try {
      const f = await utils.payrollSelf.payslipPdf.fetch({ runId });
      downloadBase64(f.filename, f.contentType, f.base64);
    } catch (e) {
      toast({ title: "Could not download the payslip", description: messageOf(e), variant: "error" });
    }
  }
  async function form16(financialYear: number) {
    try {
      const f = await utils.payrollSelf.form16Pdf.fetch({ financialYear });
      downloadBase64(f.filename, f.contentType, f.base64);
    } catch (e) {
      toast({ title: "Could not download Form 16", description: messageOf(e), variant: "error" });
    }
  }

  return (
    <div className="space-y-6">
      <section aria-label="My payslips">
        <h2 className="mb-2 text-base font-semibold text-text-primary">Payslips</h2>
        {(slips.data ?? []).length === 0 ? (
          <p className="rounded-lg border border-border-light px-4 py-3 text-sm text-text-secondary">{slips.isLoading ? "Loading..." : "No payslips yet. A payslip appears here once the month's payroll is approved."}</p>
        ) : (
          <ul className="divide-y divide-border-light rounded-xl border border-border-light bg-surface-0">
            {(slips.data ?? []).map((s) => (
              <li key={s.runId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-text-primary">{s.monthLabel}</p>
                  <p className="text-xs text-text-tertiary">Net pay {formatCurrency(s.netPay)}, paid days {Number(s.paidDays)}</p>
                </div>
                <button className="btn-secondary btn-sm" onClick={() => void payslip(s.runId)} aria-label={`Download payslip for ${s.monthLabel}`}>Download</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="My Form 16">
        <h2 className="mb-2 text-base font-semibold text-text-primary">Form 16</h2>
        {(years.data ?? []).length === 0 ? (
          <p className="rounded-lg border border-border-light px-4 py-3 text-sm text-text-secondary">{years.isLoading ? "Loading..." : "Your Form 16 is not available yet. HR releases it after the financial year."}</p>
        ) : (
          <>
            <ul className="divide-y divide-border-light rounded-xl border border-border-light bg-surface-0">
              {(years.data ?? []).map((y) => (
                <li key={y.financialYear} className="flex items-center justify-between gap-3 px-4 py-3">
                  <p className="text-sm font-medium text-text-primary">Financial year {y.label}</p>
                  <button className="btn-secondary btn-sm" onClick={() => void form16(y.financialYear)} aria-label={`Download Form 16 for ${y.label}`}>Download</button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-text-tertiary">This is a working copy prepared from your payslips for your employer's CA to review. It is not the certificate issued through TRACES.</p>
          </>
        )}
      </section>
    </div>
  );
}
