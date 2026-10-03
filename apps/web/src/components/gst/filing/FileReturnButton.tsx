import { useState } from "react";
import { returnName, wizardPeriodLabel, type FilingKind } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { useCan } from "@/lib/permissions";
import { FilingWizard } from "./FilingWizard";

/**
 * "File return" on the GSTR-1 and GSTR-3B tabs. Only people who may file see it
 * (owner, admin, filing accountant); a read-only role sees the status panel and nothing to press.
 * The note beside it says where an earlier attempt stopped, so "Resume" is honest.
 */
export function FileReturnButton({
  kind,
  year,
  month,
  gstin,
  onSwitch,
}: {
  kind: FilingKind;
  year: number;
  month: number;
  gstin: string;
  onSwitch?: (kind: FilingKind, year: number, month: number) => void;
}) {
  const canFile = useCan("GstReport", "create");
  const [open, setOpen] = useState(false);
  const { data } = trpc.gstReturns.filingAttempt.useQuery({ kind, year, month }, { enabled: canFile, retry: false, refetchOnWindowFocus: false });
  if (!canFile) return null;

  const name = returnName(kind);
  const label = wizardPeriodLabel(year, month);
  const started = !!data && data.state !== "draft" && data.state !== "filed";
  const filed = data?.state === "filed";

  return (
    <section aria-labelledby="file-return-title" className="card mb-6 flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-testid="file-return">
      <div>
        <h2 id="file-return-title" className="text-sm font-semibold text-text-primary">File {name} from Fintranzact</h2>
        <p className="text-xs text-text-tertiary">
          {filed
            ? `${name} for ${label} is filed.`
            : started
              ? `${name} for ${label} is in progress. Resume where you stopped.`
              : `Step by step through the GST portal for ${label}. Nothing is filed until you confirm at the end.`}
        </p>
      </div>
      <button type="button" className="btn-primary w-full sm:w-auto" onClick={() => setOpen(true)}>
        {filed ? "View result" : started ? "Resume filing" : "File return"}
        <span className="sr-only"> {name} for {label}</span>
      </button>
      <FilingWizard
        open={open}
        onClose={() => setOpen(false)}
        kind={kind}
        year={year}
        month={month}
        gstin={gstin}
        onSwitch={
          onSwitch
            ? (k, y, m) => {
                setOpen(false);
                onSwitch(k, y, m);
              }
            : undefined
        }
      />
    </section>
  );
}
