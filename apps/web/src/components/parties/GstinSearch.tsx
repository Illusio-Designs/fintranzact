import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { RouterOutputs } from "@fintranzact/api";
import { GSTIN_REGEX, MAX_ADDITIONAL_SHIPPING_ADDRESSES, shippingEntryFromGstinAddress, type GstinAddress, type GstinStatus } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/Spinner";
import { planGstinFill, type FillConflict, type GstinDetails, type GstinFormValues } from "@fintranzact/shared";

type LookupResult = RouterOutputs["party"]["lookupGstin"];

/** Wait this long after a valid GSTIN is typed or pasted before searching on its own. */
export const GSTIN_AUTO_SEARCH_DELAY_MS = 700;
const FAILURE_TEXT = "Could not reach the GST portal; you can still save.";

export interface GstinSearchMeta {
  gstinStatus: GstinStatus | null;
  verifiedAt: string | null;
}

export interface ShippingEntry {
  label: string;
  address: string;
  city: string;
  stateCode: string;
  pincode: string;
}

export interface GstinSearchProps {
  /** The GSTIN field (rendered next to the button). */
  input: ReactNode;
  gstin: string;
  values: GstinFormValues;
  /** Values the form derived itself from the GSTIN; treated as empty when filling. */
  auto?: Partial<GstinFormValues>;
  /** Bump to tell the component the GSTIN field lost focus. */
  blurSignal?: number;
  /** A GSTIN already saved on this party: not searched again on open. */
  initialGstin?: string;
  /** Extra shipping addresses the form holds now. */
  shippingCount?: number;
  onFill: (patch: Partial<GstinFormValues>) => void;
  onMeta: (meta: GstinSearchMeta) => void;
  onUseAsShipping?: (entry: ShippingEntry) => void;
}

const dateText = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

const addressLine = (a: GstinAddress) =>
  [a.line1, a.line2, a.city, a.state, a.pincode].map((p) => p?.trim()).filter(Boolean).join(", ");

function Badge({ status, label }: { status: string; label: string }) {
  const tone =
    status === "active"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
      : status === "cancelled"
        ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400"
        : "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
  const dot = status === "active" ? "bg-emerald-500" : status === "cancelled" ? "bg-red-500" : "bg-amber-500";
  return (
    <span data-testid="gstin-status-badge" data-status={status} className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", tone)}>
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {label}
    </span>
  );
}

/**
 * GSTIN field + "Search GST" for the party form. Searches the GST portal
 * through the server (Sandbox) and pre-fills the form:
 *  - empty fields are filled straight away;
 *  - fields that already hold a different value are listed in a "Use these
 *    details" panel with a per-field diff, and only change when confirmed;
 *  - failures never block saving ("Could not reach the GST portal; you can
 *    still save"); when searching is not set up on the server nothing is
 *    reported as an error.
 * It also searches on its own once a valid 15-character GSTIN is entered (after
 * a short pause, or at once on blur). Answers for an earlier GSTIN are ignored.
 */
export function GstinSearch({
  input, gstin, values, auto, blurSignal = 0, initialGstin = "", shippingCount = 0, onFill, onMeta, onUseAsShipping,
}: GstinSearchProps) {
  const uid = useId();
  const statusId = `${uid}-status`;
  const lookup = trpc.party.lookupGstin.useMutation();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ gstin: string; data: LookupResult; manual: boolean } | null>(null);
  const [failure, setFailure] = useState<{ gstin: string; text: string } | null>(null);
  const [conflicts, setConflicts] = useState<FillConflict[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [addedShipping, setAddedShipping] = useState<Record<number, boolean>>({});
  const [showAllAddresses, setShowAllAddresses] = useState(false);

  const reqId = useRef(0);
  const lastSearched = useRef(initialGstin);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ gstin, values, auto, onFill, onMeta });
  latest.current = { gstin, values, auto, onFill, onMeta };

  const valid = GSTIN_REGEX.test(gstin);

  // A different GSTIN invalidates what is shown and any answer still on its way.
  useEffect(() => {
    reqId.current++;
    setLoading(false);
    setConflicts([]);
    setAddedShipping({});
    setShowAllAddresses(false);
  }, [gstin]);

  const run = useCallback((manual: boolean) => {
    const g = latest.current.gstin;
    if (!GSTIN_REGEX.test(g)) return;
    const id = ++reqId.current;
    lastSearched.current = g;
    setLoading(true);
    setFailure(null);
    lookup.mutate(
      { gstin: g },
      {
        onSuccess: (data) => {
          if (id !== reqId.current) return;
          setLoading(false);
          setResult({ gstin: g, data, manual });
          if (data.available) {
            const cur = latest.current;
            const plan = planGstinFill(data.details as GstinDetails, cur.values, cur.auto);
            if (Object.keys(plan.fills).length) cur.onFill(plan.fills);
            cur.onMeta({ gstinStatus: data.details.gstinStatus ?? null, verifiedAt: data.verifiedAt });
            setConflicts(plan.conflicts);
            setPicked(Object.fromEntries(plan.conflicts.map((c) => [c.key, true])));
            if (manual && plan.conflicts.length) setTimeout(() => panelRef.current?.focus(), 0);
          } else {
            setConflicts([]);
          }
        },
        onError: (err) => {
          if (id !== reqId.current) return;
          setLoading(false);
          setResult(null);
          const tooMany = (err as { data?: { code?: string } }).data?.code === "TOO_MANY_REQUESTS";
          setFailure({ gstin: g, text: tooMany ? err.message : FAILURE_TEXT });
        },
      },
    );
  // `lookup.mutate` is stable enough; ids guard against stale answers.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runRef = useRef(run);
  runRef.current = run;

  // Search by itself shortly after a valid GSTIN is entered.
  useEffect(() => {
    if (!valid || gstin === lastSearched.current) return;
    const t = setTimeout(() => {
      // A blur or a click may have searched this GSTIN while the pause ran.
      if (gstin !== lastSearched.current) runRef.current(false);
    }, GSTIN_AUTO_SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [gstin, valid]);

  // ...or at once when the field loses focus.
  const firstBlur = useRef(blurSignal);
  useEffect(() => {
    if (blurSignal === firstBlur.current) return;
    firstBlur.current = blurSignal;
    const g = latest.current.gstin;
    if (GSTIN_REGEX.test(g) && g !== lastSearched.current) runRef.current(false);
  }, [blurSignal]);

  const shown = result && result.gstin === gstin ? result.data : null;
  const shownFailure = failure && failure.gstin === gstin ? failure.text : null;
  const profile = shown && shown.available ? shown.profile : null;
  const details = shown && shown.available ? (shown.details as GstinDetails) : null;

  // The one-line status read out by screen readers.
  let statusText = "";
  let statusTone: "muted" | "ok" | "warn" = "muted";
  if (loading) statusText = "Searching the GST portal…";
  else if (shownFailure) { statusText = shownFailure; statusTone = "warn"; }
  else if (shown) {
    if (shown.available) {
      const name = details?.legalName || details?.tradeName;
      statusText = `GST record found${name ? `: ${name}` : ""}.${conflicts.length ? ` ${conflicts.length} ${conflicts.length === 1 ? "field differs" : "fields differ"} from what you entered.` : ""}`;
      statusTone = "ok";
    } else if (shown.sandboxStatus === "not_found") { statusText = "No GST record was found for this GSTIN. Check it for typos; you can still save."; statusTone = "warn"; }
    else if (shown.sandboxStatus === "invalid") { statusText = `${shown.reason} You can still save.`; statusTone = "warn"; }
    else if (shown.sandboxStatus === "unavailable") { statusText = FAILURE_TEXT; statusTone = "warn"; }
    else if (shown.sandboxStatus === "not_configured" && result?.manual) {
      statusText = "GST search is not set up here, so only the PAN and state from the GSTIN itself were filled in.";
    }
  }


  function applyConflicts() {
    const patch = conflicts.filter((c) => picked[c.key]).reduce<Partial<GstinFormValues>>((acc, c) => ({ ...acc, ...c.patch }), {});
    if (Object.keys(patch).length) latest.current.onFill(patch);
    setConflicts([]);
    buttonRef.current?.focus();
  }
  function keepMine() {
    setConflicts([]);
    buttonRef.current?.focus();
  }

  const additional = profile?.additionalAddresses ?? [];
  const visibleAddresses = showAllAddresses ? additional : additional.slice(0, 5);
  const shippingFull = shippingCount >= MAX_ADDITIONAL_SHIPPING_ADDRESSES;

  return (
    <div>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{input}</div>
        <button
          ref={buttonRef}
          type="button"
          className="btn-secondary mt-6 shrink-0"
          onClick={() => run(true)}
          disabled={!valid || loading}
          aria-describedby={statusId}
          title="Fetch legal name, trade name, address and status from the GST portal"
        >
          {loading ? <><Spinner size="sm" /><span className="sr-only">Searching</span></> : "Search GST"}
        </button>
      </div>

      <p
        id={statusId}
        role="status"
        aria-live="polite"
        className={cn(
          "mt-1.5 text-xs",
          statusText ? "min-h-4" : "sr-only",
          statusTone === "warn" ? "text-amber-700 dark:text-amber-400" : statusTone === "ok" ? "text-text-secondary" : "text-text-tertiary",
        )}
      >
        {statusText}
      </p>

      {shown && shown.available && (
        <div data-testid="gstin-card" className="mt-2 rounded-lg border border-border-light bg-surface-1 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {(details?.legalName || details?.tradeName) && (
              <span className="min-w-0 break-words text-sm font-semibold text-text-primary">{details.legalName || details.tradeName}</span>
            )}
            {(profile?.statusRaw || details?.gstinStatus) && (
              <Badge status={profile?.status === "provisional" ? "other" : (details?.gstinStatus ?? "other")} label={profile?.statusRaw || (details?.gstinStatus ? details.gstinStatus.charAt(0).toUpperCase() + details.gstinStatus.slice(1) : "")} />
            )}
          </div>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-text-secondary sm:grid-cols-2">
            {profile?.taxpayerType && <div><dt className="inline text-text-tertiary">Type: </dt><dd className="inline">{profile.taxpayerType}</dd></div>}
            {dateText(details?.registeredOn) && <div><dt className="inline text-text-tertiary">Registered: </dt><dd className="inline">{dateText(details?.registeredOn)}</dd></div>}
            {dateText(details?.cancelledOn) && <div><dt className="inline text-text-tertiary">Cancelled: </dt><dd className="inline">{dateText(details?.cancelledOn)}</dd></div>}
            {profile && profile.eInvoiceEnabled !== null && <div><dt className="inline text-text-tertiary">E-invoicing: </dt><dd className="inline">{profile.eInvoiceEnabled ? "Enabled" : "Not enabled"}</dd></div>}
          </dl>
          {shown.warnings.length > 0 && (
            <ul data-testid="gstin-warnings" className="mt-2 list-disc space-y-1 pl-4 text-amber-800 dark:text-amber-300">
              {shown.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          <p className="mt-2 text-2xs text-text-tertiary">
            {shown.source === "sandbox" ? "From the GST portal, checked with Sandbox" : "From your e-invoice login"}
          </p>

          {additional.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-text-secondary">Additional places of business ({additional.length})</summary>
              <ul className="mt-2 space-y-2">
                {visibleAddresses.map((a, i) => (
                  <li key={`${addressLine(a)}-${i}`} className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 break-words text-text-secondary">{addressLine(a)}</span>
                    {onUseAsShipping && (
                      <button
                        type="button"
                        className="btn-secondary !px-2 !py-1 text-xs"
                        disabled={addedShipping[i] || shippingFull}
                        aria-label={`Use as shipping address: ${addressLine(a)}`}
                        onClick={() => {
                          const e = shippingEntryFromGstinAddress(a, `Place of business ${i + 1}`);
                          onUseAsShipping({ label: e.label, address: e.address, city: e.city ?? "", stateCode: e.stateCode ?? "", pincode: e.pincode ?? "" });
                          setAddedShipping((s) => ({ ...s, [i]: true }));
                        }}
                      >
                        {addedShipping[i] ? "Added" : "Use as shipping address"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {additional.length > 5 && !showAllAddresses && (
                <button type="button" className="mt-2 text-xs text-brand-600 underline" onClick={() => setShowAllAddresses(true)}>
                  Show all {additional.length}
                </button>
              )}
            </details>
          )}
        </div>
      )}

      {conflicts.length > 0 && (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="group"
          aria-labelledby={`${uid}-diff-title`}
          data-testid="gstin-diff"
          className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-amber-800 dark:bg-amber-950"
        >
          <p id={`${uid}-diff-title`} className="text-sm font-semibold">Use these details?</p>
          <p className="mt-0.5 text-text-secondary">These fields already have a value. Tick the ones you want replaced by the GST record.</p>
          <ul className="mt-2 space-y-2">
            {conflicts.map((c) => (
              <li key={c.key}>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={!!picked[c.key]}
                    onChange={(e) => setPicked((p) => ({ ...p, [c.key]: e.target.checked }))}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{c.label}</span>
                    <span className="mt-0.5 grid grid-cols-1 gap-x-3 sm:grid-cols-2">
                      <span className="break-words text-text-secondary"><span className="text-text-tertiary">Yours: </span>{c.current}</span>
                      <span className="break-words"><span className="text-text-tertiary">GST record: </span>{c.incoming}</span>
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-primary !px-3 !py-1.5 text-xs" onClick={applyConflicts} disabled={!conflicts.some((c) => picked[c.key])}>
              Use these details
            </button>
            <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={keepMine}>
              Keep mine
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
