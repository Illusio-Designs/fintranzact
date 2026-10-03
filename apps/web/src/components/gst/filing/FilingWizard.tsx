/**
 * FilingWizard: file GSTR-1, GSTR-3B or a nil return through the GST portal (Sandbox),
 * step by step. Every step is driven by what the server has persisted for the period
 * (`gstReturns.filingAttempt`), so closing the window, reloading, or coming back days
 * later resumes at the right step. Nothing here files by itself: the return is filed
 * only after the user types the EVC OTP, ticks the final acknowledgement and presses
 * the button; the 3B tax payment is posted only after the user confirms the set-off.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FILE_CONFIRM_TEXT,
  NIL_CONFIRM_TEXT,
  OTP_RESEND_SECONDS,
  SETOFF_CONFIRM_TEXT,
  deriveWizardStep,
  finalConfirmationTitle,
  formatRemaining,
  fyStartOf,
  gstnPeriodOf,
  isOtpComplete,
  isPortalSessionError,
  itcRows,
  itcUsedTotal,
  preflightFromStatus,
  reconcile3bWithGstr1,
  returnName,
  summariseSecSum,
  totalOf,
  wizardPeriodLabel,
  HEAD_LABEL,
  type FilingKind,
  type StatusMonth,
  type WizardPhase,
} from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { useCan } from "@/lib/permissions";
import { formatCurrency } from "@/lib/utils";
import { SlideOver } from "@/components/ui/SlideOver";
import { Spinner } from "@/components/ui/Spinner";
import { OtpInput } from "./OtpInput";
import { useFilingSession } from "./useFilingSession";
import { usePortalPolling } from "./usePortalPolling";
import { Actions, Notice, PollPanel, PortalErrors, StepHeading, Stepper } from "./WizardParts";

export interface FilingWizardProps {
  open: boolean;
  onClose: () => void;
  kind: FilingKind;
  year: number;
  month: number;
  gstin: string;
  /** Open the wizard for another period or return (the "file this first" links). */
  onSwitch?: (kind: FilingKind, year: number, month: number) => void;
}

export function FilingWizard(props: FilingWizardProps) {
  const name = returnName(props.kind);
  return (
    <SlideOver
      open={props.open}
      onClose={props.onClose}
      title={`File ${name} for ${wizardPeriodLabel(props.year, props.month)}`}
      description={`GSTIN ${props.gstin}`}
    >
      {props.open && <WizardBody key={`${props.kind}:${props.year}:${props.month}`} {...props} />}
    </SlideOver>
  );
}

const msg = (e: unknown) => (e instanceof Error && e.message ? e.message : "Something went wrong. Please try again.");
const SESSION_LOST = "Your session with the GST portal has ended. Sign in again with a new OTP; your progress is saved and you will continue where you stopped.";

/** Seconds left of a cool-down that began at `since` (epoch ms), ticking once a second. */
function useCooldown(since: number | null, seconds: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since]);
  if (since === null) return 0;
  return Math.max(0, Math.ceil((since + seconds * 1000 - now) / 1000));
}

const num = (s: string): number | null => {
  const t = s.replace(/[,\s₹]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

function WizardBody({ kind, year, month, gstin, onClose, onSwitch }: FilingWizardProps) {
  const canFile = useCan("GstReport", "create");
  const name = returnName(kind);
  const label = wizardPeriodLabel(year, month);
  const period = gstnPeriodOf(year, month);
  const fy = fyStartOf(year, month);
  const session = useFilingSession();

  // ── What the server says ──
  const attemptQ = trpc.gstReturns.filingAttempt.useQuery({ kind, year, month }, { retry: false, refetchOnWindowFocus: false });
  const [forceStatus, setForceStatus] = useState(false);
  const statusQ = trpc.gstReturns.filingStatus.useQuery({ fyStartYear: fy, refresh: forceStatus }, { retry: false, refetchOnWindowFocus: false });
  const prevStatusQ = trpc.gstReturns.filingStatus.useQuery({ fyStartYear: fy - 1, refresh: false }, { enabled: month === 4, retry: false, refetchOnWindowFocus: false });
  const g1Q = trpc.gst.gstr1.useQuery({ year, month }, { retry: false, refetchOnWindowFocus: false });
  const g3Q = trpc.gst.gstr3b.useQuery({ year, month }, { enabled: kind === "gstr3b", retry: false, refetchOnWindowFocus: false });

  const attempt = attemptQ.data;
  const state = attempt?.state ?? "draft";

  // ── Local, in-this-window state (never persisted) ──
  const [checked, setChecked] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [choice, setChoice] = useState<"normal" | "nil">("normal");
  const [nilConfirmed, setNilConfirmed] = useState(false);
  const [nil3bReady, setNil3bReady] = useState(false);
  const [gt, setGt] = useState("");
  const [curGt, setCurGt] = useState("");
  const [username, setUsername] = useState(session.username);
  const [signInOtpSent, setSignInOtpSent] = useState<number | null>(null);
  const [signInOtp, setSignInOtp] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [recon, setRecon] = useState<string | null>(null);
  const [secSum, setSecSum] = useState<unknown[] | null>(null);
  const [pollErrors, setPollErrors] = useState<string[]>([]);
  const [setoffAck, setSetoffAck] = useState(false);
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);
  const [otp, setOtp] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [fileAck, setFileAck] = useState(false);
  const [panOpen, setPanOpen] = useState(false);
  const [pan, setPan] = useState("");
  const [panMasked, setPanMasked] = useState<string | null>(null);
  const [filedInfo, setFiledInfo] = useState<{ arn: string | null; filedOn: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestOtp = trpc.gstReturns.requestOtp.useMutation();
  const verifyOtp = trpc.gstReturns.verifyOtp.useMutation();
  const saveG1 = trpc.gstReturns.saveGstr1.useMutation();
  const proceedG1 = trpc.gstReturns.proceedGstr1.useMutation();
  const summaryG1 = trpc.gstReturns.fetchGstr1Summary.useMutation();
  const saveG3 = trpc.gstReturns.saveGstr3b.useMutation();
  const ledgerG3 = trpc.gstReturns.checkLedgerGstr3b.useMutation();
  const offsetG3 = trpc.gstReturns.postOffsetGstr3b.useMutation();
  const detailsG3 = trpc.gstReturns.fetchGstr3bDetails.useMutation();
  const evc = trpc.gstReturns.requestEvcOtp.useMutation();
  const fileG1 = trpc.gstReturns.fileGstr1.useMutation();
  const fileG3 = trpc.gstReturns.fileGstr3b.useMutation();

  const effectiveNil = (attempt?.nil ?? false) || (kind === "gstr3b" && nil3bReady && state === "draft");

  // ── Where we are ──
  let pos = deriveWizardStep({ kind, state, nil: attempt?.nil ?? false, signedIn: session.signedIn, checked });
  if (session.signedIn && kind === "gstr3b" && state === "draft" && nil3bReady) pos = { step: "otp", phase: "otp_request" };
  if (session.signedIn && reviewed && (pos.phase === "summary" || pos.phase === "final")) pos = { step: "otp", phase: "otp_request" };
  const phase: WizardPhase = pos.phase;

  async function refreshAttempt() {
    try {
      await attemptQ.refetch();
    } catch {
      // the next render shows the query's own error
    }
  }

  /** Runs one step: shows progress, turns a lost portal session into "sign in again", and re-reads the persisted state. */
  async function act<T>(id: string, fn: () => Promise<T>, after?: (r: T) => void): Promise<T | undefined> {
    setBusy(id);
    setError(null);
    try {
      const r = await fn();
      after?.(r);
      await refreshAttempt();
      return r;
    } catch (e) {
      if (isPortalSessionError(e)) {
        session.clear();
        setNotice(SESSION_LOST);
      } else {
        setError(msg(e));
      }
      await refreshAttempt();
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  const sessionLost = () => {
    session.clear();
    setNotice(SESSION_LOST);
  };

  const polling = usePortalPolling({
    enabled: phase === "polling_save" || phase === "polling_proceed" || phase === "polling_offset",
    input: { kind, year, month },
    onSettled: (outcome, errors) => {
      setPollErrors(outcome === "errors" ? errors : []);
      void refreshAttempt();
    },
    onSessionLost: sessionLost,
  });

  // Lead-in notes once the 6 hours are over while the window is open.
  const signedInRef = useRef(session.signedIn);
  useEffect(() => {
    if (signedInRef.current && !session.signedIn) setNotice(SESSION_LOST);
    signedInRef.current = session.signedIn;
  }, [session.signedIn]);

  // The stored GSTR-1 summary comes back from the server without calling the portal.
  const wantSummary = phase === "summary" && !secSum && kind === "gstr1";
  const summaryRequested = useRef(false);
  useEffect(() => {
    if (!wantSummary || summaryRequested.current || busy) return;
    summaryRequested.current = true;
    void act("summary", () => summaryG1.mutateAsync({ year, month }), (r) => setSecSum(r.secSum as unknown[]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantSummary]);

  // A confirmation belongs to the proposal that was shown: a new proposal clears it.
  useEffect(() => setSetoffAck(false), [attempt?.proposalKey]);
  // The OTP clock restarts from the stored time of the last request when the window is reopened.
  useEffect(() => {
    if (state === "otp_requested" && otpSentAt === null && attempt?.updatedAt) setOtpSentAt(attempt.updatedAt);
  }, [state, otpSentAt, attempt?.updatedAt]);

  const signInCooldown = useCooldown(signInOtpSent, OTP_RESEND_SECONDS);
  const evcCooldown = useCooldown(otpSentAt, OTP_RESEND_SECONDS);

  // ── Pre-flight ──
  const statusMonths: StatusMonth[] | null = useMemo(() => {
    if (statusQ.data?.status !== "ok") return null;
    if (month === 4) {
      if (prevStatusQ.data?.status !== "ok") return null;
      return [...prevStatusQ.data.months, ...statusQ.data.months] as StatusMonth[];
    }
    return statusQ.data.months as StatusMonth[];
  }, [statusQ.data, prevStatusQ.data, month]);
  const preflight = useMemo(
    () => preflightFromStatus({ kind, period, composition: statusQ.data?.composition ?? false, months: statusMonths }),
    [kind, period, statusQ.data?.composition, statusMonths],
  );
  const statusLoading = statusQ.isLoading || (month === 4 && prevStatusQ.isLoading);

  if (!canFile) {
    return <Notice tone="info">Your role can see the return status but cannot file returns. Ask the business owner or a filing accountant.</Notice>;
  }
  if (attemptQ.isLoading) {
    return (
      <div role="status" aria-label="Loading filing progress" className="space-y-3">
        <div className="h-5 w-40 animate-pulse rounded bg-surface-2" />
        <div className="h-24 animate-pulse rounded bg-surface-2" />
      </div>
    );
  }
  if (attemptQ.error || !attempt) {
    return (
      <div className="space-y-3">
        <Notice tone="error">{attemptQ.error?.message ?? "Could not load the filing progress."}</Notice>
        <button type="button" className="btn-secondary" onClick={() => void attemptQ.refetch()}>Try again</button>
      </div>
    );
  }

  const book1 = g1Q.data;
  const book3 = g3Q.data;
  const gtN = num(gt);
  const curGtN = num(curGt);
  const turnoverOk = gtN !== null && curGtN !== null;
  const isNilFlow = effectiveNil;

  // ── Step bodies ──

  const stepper = <Stepper nil={isNilFlow} current={pos.step} />;
  const sessionLine = session.signedIn && (
    <p className="mb-3 text-xs text-text-tertiary" data-testid="session-left">
      GST portal session: {formatRemaining(session.remainingMs)} left
    </p>
  );
  const notices = (
    <div className="space-y-2">
      {notice && <Notice tone="warning" alert>{notice}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {warnings.map((w) => <Notice key={w} tone="warning">{w}</Notice>)}
    </div>
  );

  function body() {
    switch (phase) {
      case "check":
        return renderCheck();
      case "signin":
        return renderSignIn();
      case "choose":
        return renderChoose();
      case "polling_save":
        return renderPolling("Checking with the GST portal...", "Your data was saved on the GST portal. It is now being validated.");
      case "polling_proceed":
        return renderPolling("Checking with the GST portal...", "The GST portal is preparing the return for filing.");
      case "polling_offset":
        return renderPolling("Checking with the GST portal...", "The GST portal is recording your tax payment.");
      case "save_errors":
      case "proceed_errors":
        return renderErrors();
      case "save_ok":
        return renderSaveOk();
      case "load_summary":
        return renderLoadSummary();
      case "summary":
        return renderSummary();
      case "load_ledger":
        return renderLoadLedger();
      case "setoff":
      case "offset_errors":
        return renderSetoff();
      case "load_details":
        return renderLoadDetails();
      case "final":
        return renderFinal();
      case "otp_request":
        return renderOtpRequest();
      case "otp_enter":
        return confirming ? renderConfirm() : renderOtpEnter();
      case "otp_failed":
        return renderOtpFailed();
      case "filed":
        return renderDone();
    }
  }

  // 1. Pre-flight
  function renderCheck() {
    const blocked = preflight.verdict === "missing" || !!preflight.alreadyFiled;
    return (
      <div className="space-y-4">
        <StepHeading>Before you start</StepHeading>
        <section aria-labelledby="pf-prereq" className="space-y-2">
          <h4 id="pf-prereq" className="text-sm font-semibold">Earlier returns on the GST portal</h4>
          {statusLoading && <p role="status" className="text-sm text-text-tertiary">Checking the GST portal...</p>}
          {!statusLoading && preflight.alreadyFiled && (
            <Notice tone="success">
              {name} for {label} is already filed on the GST portal{preflight.alreadyFiled.arn ? ` (ARN ${preflight.alreadyFiled.arn})` : ""}. There is nothing more to file.
            </Notice>
          )}
          {!statusLoading && preflight.verdict === "ok" && !preflight.alreadyFiled && (
            <Notice tone="success">Earlier returns are filed{kind === "gstr3b" ? ", including GSTR-1 for this period" : ""}.</Notice>
          )}
          {!statusLoading && preflight.verdict === "missing" && (
            <Notice tone="error">
              <p className="font-medium">File these first. The GST portal does not accept {name} for {label} until they are filed.</p>
              <ul className="mt-1 space-y-1">
                {preflight.missing.map((m) => {
                  const p = { year: Number(m.period.slice(2)), month: Number(m.period.slice(0, 2)) };
                  return (
                    <li key={`${m.kind}${m.period}`}>
                      {m.label}
                      {onSwitch && (
                        <>
                          {" "}
                          <button type="button" className="font-medium underline" onClick={() => onSwitch(m.kind, p.year, p.month)}>
                            File it first<span className="sr-only"> ({m.label})</span>
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Notice>
          )}
          {!statusLoading && preflight.verdict === "unknown" && (
            <Notice tone="warning">{preflight.notes[0]}</Notice>
          )}
          {!statusLoading && preflight.verdict === "skipped" && <Notice tone="info">{preflight.notes[0]}</Notice>}
          {!statusLoading && preflight.verdict !== "skipped" && preflight.verdict !== "unknown" && (
            <p className="text-xs text-text-tertiary">{preflight.notes.join(" ")}</p>
          )}
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => {
              setForceStatus(true);
              void statusQ.refetch();
            }}
          >
            Check the GST portal again
          </button>
        </section>

        <section aria-labelledby="pf-books" className="space-y-2">
          <h4 id="pf-books" className="text-sm font-semibold">Your books for {label}</h4>
          {(g1Q.isLoading || g3Q.isLoading) && <p role="status" className="text-sm text-text-tertiary">Reading your books...</p>}
          {kind === "gstr1" && book1 && (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm" data-testid="books-summary">
              <dt className="text-text-tertiary">Sales invoices</dt>
              <dd className="text-right tabular-nums">{book1.invoiceCount}</dd>
              <dt className="text-text-tertiary">Taxable value</dt>
              <dd className="text-right tabular-nums">{formatCurrency(book1.totalTaxableValue)}</dd>
              <dt className="text-text-tertiary">Tax</dt>
              <dd className="text-right tabular-nums">{formatCurrency(book1.totalTax)}</dd>
              <dt className="text-text-tertiary">Credit and debit notes</dt>
              <dd className="text-right tabular-nums">{book1.creditNotes.length + book1.debitNotes.length}</dd>
            </dl>
          )}
          {kind === "gstr3b" && book3 && (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm" data-testid="books-summary">
              <dt className="text-text-tertiary">Taxable outward supplies</dt>
              <dd className="text-right tabular-nums">{formatCurrency(book3.outwardSupplies.taxable.taxableValue)}</dd>
              <dt className="text-text-tertiary">Input tax credit</dt>
              <dd className="text-right tabular-nums">{formatCurrency(book3.itc.total)}</dd>
              <dt className="text-text-tertiary">Net tax after credit</dt>
              <dd className="text-right tabular-nums">{formatCurrency(book3.netTax.total)}</dd>
            </dl>
          )}
          {(g1Q.error || g3Q.error) && <Notice tone="error">{(g1Q.error ?? g3Q.error)?.message}</Notice>}
          {kind === "gstr3b" && book1 && book3 && (() => {
            const o = book3.outwardSupplies;
            const hint = reconcile3bWithGstr1({
              gstr1: { totalTaxableValue: book1.totalTaxableValue, totalTax: book1.totalTax },
              gstr3b: {
                outwardTaxableValue: o.taxable.taxableValue + o.zeroRated.taxableValue + o.exempt.taxableValue,
                outwardTax: o.taxable.igst + o.taxable.cgst + o.taxable.sgst,
              },
            });
            return hint ? <Notice tone="warning">{hint}</Notice> : <p className="text-xs text-text-tertiary">GSTR-3B agrees with GSTR-1 for this period.</p>;
          })()}
        </section>

        <p className="text-xs text-text-tertiary">
          You will sign in to the GST portal with an OTP, save the return there, review it, and confirm with a second OTP (EVC) before it is filed. Nothing is filed until you confirm at the very end.
        </p>
        {notices}
        <Actions>
          <button type="button" className="btn-secondary" onClick={onClose}>Back to GST</button>
          <button type="button" className="btn-primary" disabled={blocked || statusLoading || !(kind === "gstr1" ? book1 : book3)} onClick={() => setChecked(true)}>
            Continue to GST portal sign-in
          </button>
        </Actions>
      </div>
    );
  }

  // 2. GST portal sign-in
  function renderSignIn() {
    const sentOtp = signInOtpSent !== null;
    const where = pos.resume ? `Then you continue where you stopped.` : "";
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!sentOtp && username.trim() && busy === null) void sendSignInOtp();
        }}
      >
        <StepHeading focus={!sentOtp}>Sign in to the GST portal</StepHeading>
        <p className="text-sm text-text-secondary">
          The GST portal sends a one-time password (OTP) to the mobile number registered for your GST login. The session lasts about 6 hours. {where}
        </p>
        {notices}
        <div className="space-y-1">
          <label htmlFor="gst-username" className="label">GST portal username</label>
          <input
            id="gst-username"
            className="input w-full"
            autoComplete="username"
            value={username}
            maxLength={100}
            disabled={sentOtp}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        {sentOtp && (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary" role="status">An OTP was sent to the mobile registered with the GST portal.</p>
            <OtpInput
              label="OTP from the GST portal"
              value={signInOtp}
              onChange={setSignInOtp}
              onEnter={() => void verify()}
              disabled={busy === "verify"}
            />
            <button
              type="button"
              className="btn-ghost text-sm"
              disabled={signInCooldown > 0 || busy === "otp"}
              onClick={() => void sendSignInOtp()}
            >
              {signInCooldown > 0 ? `Resend OTP in ${signInCooldown} s` : "Resend OTP"}
            </button>
          </div>
        )}
        <Actions>
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
          {!sentOtp ? (
            <button type="button" className="btn-primary" disabled={!username.trim() || busy === "otp"} onClick={() => void sendSignInOtp()}>
              {busy === "otp" && <Spinner size="sm" />} Send OTP
            </button>
          ) : (
            <button type="button" className="btn-primary" disabled={!isOtpComplete(signInOtp) || busy === "verify"} onClick={() => void verify()}>
              {busy === "verify" && <Spinner size="sm" />} Verify and continue
            </button>
          )}
        </Actions>
      </form>
    );
  }

  async function sendSignInOtp() {
    const ok = await act("otp", () => requestOtp.mutateAsync({ username: username.trim() }));
    if (ok) {
      setSignInOtpSent(Date.now());
      setSignInOtp("");
      setNotice(null);
    }
  }

  async function verify() {
    if (!isOtpComplete(signInOtp)) return;
    const code = signInOtp;
    setSignInOtp("");
    const ok = await act("verify", () => verifyOtp.mutateAsync({ username: username.trim(), otp: code }));
    if (ok) {
      session.markVerified(username.trim());
      setSignInOtpSent(null);
      setNotice(null);
    } else {
      // A wrong OTP stays on this step with the server's reason; the field is empty and ready for another try.
    }
  }

  // 3. Prepare: choose the path, turnover, save
  function renderChoose() {
    const nilOk = attempt!.nilEligible;
    const blockers = attempt!.nilBlockers;
    const nilConfirmText = NIL_CONFIRM_TEXT[kind](label);
    const normalReady = kind === "gstr1" ? turnoverOk : true;
    return (
      <div className="space-y-4">
        <StepHeading>Prepare {name} for {label}</StepHeading>
        {sessionLine}
        {notices}
        <fieldset className="space-y-2">
          <legend className="sr-only">Type of return</legend>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm">
            <input type="radio" name="return-type" checked={choice === "normal"} onChange={() => setChoice("normal")} className="mt-1" />
            <span>
              <span className="font-medium">Normal return</span>
              <span className="block text-text-tertiary">Send the figures from your books.</span>
            </span>
          </label>
          {nilOk ? (
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <input type="radio" name="return-type" checked={choice === "nil"} onChange={() => setChoice("nil")} className="mt-1" />
              <span>
                <span className="font-medium">Nil return</span>
                <span className="block text-text-tertiary">Your books show nothing for {label}, so a nil return is available.</span>
              </span>
            </label>
          ) : (
            <p className="text-xs text-text-tertiary" data-testid="nil-unavailable">
              {blockers.length
                ? `A nil return is not available: your books have ${blockers.join(", ")} for ${label}.`
                : "A nil return is not available right now."}
            </p>
          )}
        </fieldset>

        {choice === "nil" && nilOk ? (
          <div className="space-y-3">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={nilConfirmed} onChange={(e) => setNilConfirmed(e.target.checked)} />
              <span>{nilConfirmText}</span>
            </label>
            <Actions>
              <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
              <button
                type="button"
                className="btn-primary"
                disabled={!nilConfirmed || busy !== null}
                onClick={() => {
                  if (kind === "gstr1") {
                    void act("proceed", () => proceedG1.mutateAsync({ year, month, nil: true, confirmNil: true }), (r) => setWarnings(r.warnings));
                  } else {
                    setNil3bReady(true);
                  }
                }}
              >
                {busy === "proceed" && <Spinner size="sm" />} {kind === "gstr1" ? "Start nil return" : "Continue with nil return"}
              </button>
            </Actions>
          </div>
        ) : (
          <>
            {kind === "gstr1" && renderGstr1Inputs()}
            {kind === "gstr3b" && renderBooks3b()}
            <Actions>
              <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
              <button type="button" className="btn-primary" disabled={!normalReady || busy !== null} onClick={() => void save()}>
                {busy === "save" && <Spinner size="sm" />} Save to GST portal
              </button>
            </Actions>
          </>
        )}
      </div>
    );
  }

  function renderGstr1Inputs() {
    return (
      <div className="space-y-3">
        {book1 && (
          <p className="text-sm text-text-secondary">
            Your books for {label}: {book1.invoiceCount} sales invoice{book1.invoiceCount === 1 ? "" : "s"}, taxable value {formatCurrency(book1.totalTaxableValue)}, tax {formatCurrency(book1.totalTax)}.
          </p>
        )}
        <p className="text-sm text-text-secondary">
          The GST portal also needs two turnover figures. The app does not work them out, so please enter them.
        </p>
        <div className="space-y-1">
          <label htmlFor="gt" className="label">Aggregate turnover of the previous financial year</label>
          <input id="gt" className="input w-full" inputMode="decimal" autoComplete="off" value={gt} onChange={(e) => setGt(e.target.value)} aria-describedby="gt-help" />
          <p id="gt-help" className="text-xs text-text-tertiary">Total turnover of your whole last financial year (April to March), in rupees. Your CA has this number. Enter 0 if you were not registered.</p>
        </div>
        <div className="space-y-1">
          <label htmlFor="curgt" className="label">Aggregate turnover of the current financial year up to this period</label>
          <input id="curgt" className="input w-full" inputMode="decimal" autoComplete="off" value={curGt} onChange={(e) => setCurGt(e.target.value)} aria-describedby="curgt-help" />
          <p id="curgt-help" className="text-xs text-text-tertiary">Total turnover from 1 April of this financial year up to the end of {label}, in rupees, including this month.</p>
        </div>
        {(gt !== "" && gtN === null) || (curGt !== "" && curGtN === null) ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">Enter the turnover as a number, for example 2500000.</p>
        ) : null}
      </div>
    );
  }

  function renderBooks3b() {
    if (!book3) return g3Q.isLoading ? <p role="status" className="text-sm text-text-tertiary">Reading your books...</p> : null;
    const o = book3.outwardSupplies;
    const rows: Array<[string, number, number, number, number]> = [
      ["Outward taxable supplies", o.taxable.taxableValue, o.taxable.igst, o.taxable.cgst, o.taxable.sgst],
      ["Zero rated supplies", o.zeroRated.taxableValue, o.zeroRated.igst, o.zeroRated.cgst, o.zeroRated.sgst],
      ["Nil rated and exempt supplies", o.exempt.taxableValue, o.exempt.igst, o.exempt.cgst, o.exempt.sgst],
      ["Inward supplies on reverse charge", Number(book3.rcmSupplies.taxableValue), Number(book3.rcmSupplies.igst), Number(book3.rcmSupplies.cgst), Number(book3.rcmSupplies.sgst)],
    ];
    return (
      <div className="space-y-3" data-testid="details-3b">
        <p className="text-sm text-text-secondary">This is what will be saved on the GST portal for {label}.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">GSTR-3B figures from your books</caption>
            <thead>
              <tr className="text-left text-xs text-text-tertiary">
                <th scope="col" className="py-1 pr-2 font-medium">Supplies</th>
                <th scope="col" className="py-1 pr-2 text-right font-medium">Taxable value</th>
                <th scope="col" className="py-1 pr-2 text-right font-medium">IGST</th>
                <th scope="col" className="py-1 pr-2 text-right font-medium">CGST</th>
                <th scope="col" className="py-1 text-right font-medium">SGST</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([l, v, i, c, s]) => (
                <tr key={l} className="border-t border-border-light">
                  <th scope="row" className="py-1 pr-2 text-left font-normal">{l}</th>
                  <td className="py-1 pr-2 text-right tabular-nums">{formatCurrency(v)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{formatCurrency(i)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{formatCurrency(c)}</td>
                  <td className="py-1 text-right tabular-nums">{formatCurrency(s)}</td>
                </tr>
              ))}
              <tr className="border-t border-border-light">
                <th scope="row" className="py-1 pr-2 text-left font-normal">Input tax credit (eligible)</th>
                <td className="py-1 pr-2 text-right">-</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatCurrency(book3.itc.igst)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatCurrency(book3.itc.cgst)}</td>
                <td className="py-1 text-right tabular-nums">{formatCurrency(book3.itc.sgst)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-text-tertiary">
          Interest and late fee are not included: the app does not calculate them. If they apply, add them on the GST portal.
        </p>
      </div>
    );
  }

  async function save() {
    setPollErrors([]);
    setWarnings([]);
    if (kind === "gstr1") {
      if (!turnoverOk) return;
      await act("save", () => saveG1.mutateAsync({ year, month, gt: gtN!, curGt: curGtN! }), (r) => setWarnings(r.warnings));
    } else {
      await act("save", () => saveG3.mutateAsync({ year, month }), (r) => {
        setWarnings(r.warnings);
        setRecon(r.reconciliation);
      });
    }
  }

  function renderPolling(title: string, intro: string) {
    return (
      <div className="space-y-4">
        <StepHeading>{state === "offset_posted" ? "Recording the tax payment" : "Saved on the GST portal"}</StepHeading>
        {sessionLine}
        <p className="text-sm text-text-secondary">{intro}</p>
        {recon && <Notice tone="warning">{recon}</Notice>}
        {notices}
        <PollPanel title={title} elapsedMs={polling.elapsedMs} timedOut={polling.timedOut} error={polling.error} onRetry={polling.retry} />
        <Actions>
          <button type="button" className="btn-secondary" onClick={onClose}>Close and come back later</button>
        </Actions>
      </div>
    );
  }

  function renderErrors() {
    const messages = pollErrors.length ? pollErrors : attempt!.errors;
    const isNilRetry = attempt!.nil;
    return (
      <div className="space-y-4">
        <StepHeading>The GST portal found problems</StepHeading>
        <Notice tone="error">
          {state === "save_errors"
            ? "The GST portal rejected the saved data. Fix the books if needed, then save again. You cannot go on until it saves cleanly."
            : "The GST portal could not prepare the return. Save again before you go on."}
        </Notice>
        {messages.length > 0 ? <PortalErrors messages={messages} /> : <p className="text-sm text-text-secondary">The portal gave no details. Save again, or check the return on the GST portal.</p>}
        {notices}
        {isNilRetry ? (
          <>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={nilConfirmed} onChange={(e) => setNilConfirmed(e.target.checked)} />
              <span>{NIL_CONFIRM_TEXT[kind](label)}</span>
            </label>
            <Actions>
              <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
              <button
                type="button"
                className="btn-primary"
                disabled={!nilConfirmed || busy !== null}
                onClick={() => void act("proceed", () => proceedG1.mutateAsync({ year, month, nil: true, confirmNil: true }))}
              >
                Try again
              </button>
            </Actions>
          </>
        ) : (
          <>
            {kind === "gstr1" && renderGstr1Inputs()}
            <Actions>
              <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
              <button type="button" className="btn-primary" disabled={(kind === "gstr1" && !turnoverOk) || busy !== null} onClick={() => void save()}>
                {busy === "save" && <Spinner size="sm" />} Save again
              </button>
            </Actions>
          </>
        )}
      </div>
    );
  }

  function renderSaveOk() {
    return (
      <div className="space-y-4">
        <StepHeading>Saved on the GST portal</StepHeading>
        {sessionLine}
        <p className="text-sm text-text-secondary">
          The GST portal has accepted and checked the figures. They are saved on the portal but the return is <strong>not filed yet</strong>. Next, ask the portal to prepare the return for filing.
        </p>
        {notices}
        <Actions>
          <button type="button" className="btn-secondary" onClick={onClose}>Close and come back later</button>
          <button type="button" className="btn-primary" disabled={busy !== null} onClick={() => void act("proceed", () => proceedG1.mutateAsync({ year, month, nil: false, confirmNil: false }), (r) => setWarnings(r.warnings))}>
            {busy === "proceed" && <Spinner size="sm" />} Prepare for filing
          </button>
        </Actions>
      </div>
    );
  }

  // 4. Review (GSTR-1)
  function renderLoadSummary() {
    return (
      <div className="space-y-4">
        <StepHeading>Return is ready on the GST portal</StepHeading>
        {sessionLine}
        <p className="text-sm text-text-secondary">Next, load the summary the GST portal holds for {label} so you can review it before you file.</p>
        {notices}
        <Actions>
          <button type="button" className="btn-secondary" onClick={onClose}>Close and come back later</button>
          <button type="button" className="btn-primary" disabled={busy !== null} onClick={() => void act("summary", () => summaryG1.mutateAsync({ year, month }), (r) => setSecSum(r.secSum as unknown[]))}>
            {busy === "summary" && <Spinner size="sm" />} Load summary
          </button>
        </Actions>
      </div>
    );
  }

  function renderSummary() {
    const rows = secSum ? summariseSecSum(secSum) : [];
    const money = (n: number | null) => (n === null ? "-" : formatCurrency(n));
    return (
      <div className="space-y-4">
        <StepHeading>Review the summary</StepHeading>
        {sessionLine}
        <p className="text-sm text-text-secondary">This is the GST portal's summary of {name} for {label}, section by section. Check it against your books.</p>
        {notices}
        {!secSum && <p role="status" className="text-sm text-text-tertiary">Loading the summary...</p>}
        {secSum && rows.length === 0 && <Notice tone="info">The GST portal returned a summary this app cannot show in a table. Review it on the GST portal before you file.</Notice>}
        {rows.length > 0 && (
          <div className="overflow-x-auto" data-testid="gstr1-summary">
            <table className="w-full text-sm">
              <caption className="sr-only">GSTR-1 summary by section</caption>
              <thead>
                <tr className="text-left text-xs text-text-tertiary">
                  <th scope="col" className="py-1 pr-2 font-medium">Section</th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">Records</th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">Taxable value</th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">IGST</th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">CGST</th>
                  <th scope="col" className="py-1 text-right font-medium">SGST</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.section} className="border-t border-border-light">
                    <th scope="row" className="py-1 pr-2 text-left font-normal">{r.section}</th>
                    <td className="py-1 pr-2 text-right tabular-nums">{r.records ?? "-"}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{money(r.taxable ?? r.value)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{money(r.igst)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{money(r.cgst)}</td>
                    <td className="py-1 text-right tabular-nums">{money(r.sgst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Actions>
          <button type="button" className="btn-secondary" onClick={onClose}>Close and come back later</button>
          <button type="button" className="btn-primary" disabled={!secSum || busy !== null} onClick={() => setReviewed(true)}>
            The summary is correct: continue
          </button>
        </Actions>
      </div>
    );
  }

  // 4. Review (GSTR-3B)
  function renderLoadLedger() {
    return (
      <div className="space-y-4">
        <StepHeading>Saved on the GST portal</StepHeading>
        {sessionLine}
        {recon && <Notice tone="warning">{recon}</Notice>}
        <p className="text-sm text-text-secondary">
          The figures are saved on the GST portal and checked. Next we read your cash and credit ledger balances and propose how the tax is paid. Nothing is paid until you confirm it.
        </p>
        {notices}
        <Actions>
          <button type="button" className="btn-secondary" onClick={onClose}>Close and come back later</button>
          <button type="button" className="btn-primary" disabled={busy !== null} onClick={() => void act("ledger", () => ledgerG3.mutateAsync({ year, month }))}>
            {busy === "ledger" && <Spinner size="sm" />} Check ledger balances
          </button>
        </Actions>
      </div>
    );
  }

  function renderSetoff() {
    const p = attempt!.proposal;
    const l = attempt!.ledger;
    const heads = ["igst", "cgst", "sgst"] as const;
    const hasProposal = !!p && !!l && !!attempt!.proposalKey;
    return (
      <div className="space-y-4">
        <StepHeading>Review the tax payment (set-off)</StepHeading>
        {sessionLine}
        {phase === "offset_errors" && (
          <>
            <Notice tone="error">The GST portal rejected the tax payment. Check the balances again, then confirm a new set-off.</Notice>
            {(pollErrors.length ? pollErrors : attempt!.errors).length > 0 && <PortalErrors messages={pollErrors.length ? pollErrors : attempt!.errors} />}
          </>
        )}
        {notices}
        {!hasProposal && <p role="status" className="text-sm text-text-tertiary">Loading the proposal...</p>}
        {hasProposal && p && l && (
          <>
            <p className="text-sm text-text-secondary">
              Your tax for {label} is paid first from your input tax credit and the rest in cash. This is only a <strong>proposal</strong>: nothing is paid until you confirm below.
            </p>
            <section aria-labelledby="ledger-h" className="space-y-1">
              <h4 id="ledger-h" className="text-sm font-semibold">Ledger balances on the GST portal</h4>
              <div className="overflow-x-auto" data-testid="ledger-table">
                <table className="w-full text-sm">
                  <caption className="sr-only">Credit and cash ledger balances</caption>
                  <thead>
                    <tr className="text-left text-xs text-text-tertiary">
                      <th scope="col" className="py-1 pr-2 font-medium">Tax</th>
                      <th scope="col" className="py-1 pr-2 text-right font-medium">Credit ledger</th>
                      <th scope="col" className="py-1 text-right font-medium">Cash ledger</th>
                    </tr>
                  </thead>
                  <tbody>
                    {heads.map((h) => (
                      <tr key={h} className="border-t border-border-light">
                        <th scope="row" className="py-1 pr-2 text-left font-normal">{HEAD_LABEL[h]}</th>
                        <td className="py-1 pr-2 text-right tabular-nums">{formatCurrency(l.itc[h])}</td>
                        <td className="py-1 text-right tabular-nums">{formatCurrency(l.cash[h])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section aria-labelledby="proposal-h" className="space-y-1">
              <h4 id="proposal-h" className="text-sm font-semibold">Proposed set-off</h4>
              <div className="overflow-x-auto" data-testid="setoff-table">
                <table className="w-full text-sm">
                  <caption className="sr-only">Proposed use of credit and cash</caption>
                  <thead>
                    <tr className="text-left text-xs text-text-tertiary">
                      <th scope="col" className="py-1 pr-2 font-medium">Paid from</th>
                      <th scope="col" className="py-1 pr-2 font-medium">Pays</th>
                      <th scope="col" className="py-1 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itcRows(p).map((r) => (
                      <tr key={`${r.credit}-${r.against}`} className="border-t border-border-light">
                        <td className="py-1 pr-2">{r.credit}</td>
                        <td className="py-1 pr-2">{r.against}</td>
                        <td className="py-1 text-right tabular-nums">{formatCurrency(r.amount)}</td>
                      </tr>
                    ))}
                    {itcRows(p).length === 0 && (
                      <tr className="border-t border-border-light"><td colSpan={3} className="py-1 text-text-tertiary">No credit is used.</td></tr>
                    )}
                    <tr className="border-t border-border font-medium">
                      <td className="py-1 pr-2" colSpan={2}>Credit used in total</td>
                      <td className="py-1 text-right tabular-nums">{formatCurrency(itcUsedTotal(p))}</td>
                    </tr>
                    {heads.map((h) => (
                      <tr key={h} className="border-t border-border-light">
                        <td className="py-1 pr-2">Cash</td>
                        <td className="py-1 pr-2">{HEAD_LABEL[h]}</td>
                        <td className="py-1 text-right tabular-nums">{formatCurrency(p.cashNeeded[h])}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-border font-semibold">
                      <td className="py-1 pr-2" colSpan={2}>Cash payable in total</td>
                      <td className="py-1 text-right tabular-nums" data-testid="cash-payable">{formatCurrency(totalOf(p.cashNeeded))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <details className="text-sm text-text-secondary">
              <summary className="cursor-pointer font-medium text-text-primary">How the credit is used</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>IGST credit pays IGST first, then CGST, then SGST.</li>
                <li>CGST credit pays CGST, then IGST. It never pays SGST.</li>
                <li>SGST credit pays SGST, then IGST. It never pays CGST.</li>
                <li>What is left is paid in cash, tax by tax: cash of one tax cannot pay another.</li>
                <li>Tax on reverse charge is always paid in cash. Interest and late fee are not included.</li>
              </ul>
            </details>

            {!p.sufficient ? (
              <Notice tone="warning" alert>
                <p className="font-medium">Your cash ledger does not cover the tax that credit cannot pay.</p>
                <ul className="mt-1">
                  {heads.filter((h) => p.cashShortfall[h] > 0).map((h) => (
                    <li key={h}>Add {formatCurrency(p.cashShortfall[h])} to the {HEAD_LABEL[h]} cash ledger.</li>
                  ))}
                </ul>
                <p className="mt-1">Deposit the cash on the GST portal with a challan. This app cannot make the payment. Then check the balances again.</p>
              </Notice>
            ) : (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={setoffAck} onChange={(e) => setSetoffAck(e.target.checked)} />
                <span>{SETOFF_CONFIRM_TEXT}</span>
              </label>
            )}
          </>
        )}
        <Actions>
          <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => void act("ledger", () => ledgerG3.mutateAsync({ year, month }))}>
            {busy === "ledger" && <Spinner size="sm" />} Check balances again
          </button>
          {hasProposal && p?.sufficient && (
            <button
              type="button"
              className="btn-primary"
              disabled={!setoffAck || busy !== null}
              onClick={() => {
                // The key sent is the one of the proposal on screen; the server refuses it if it went stale.
                const key = attempt!.proposalKey!;
                setPollErrors([]);
                void act("offset", () => offsetG3.mutateAsync({ year, month, confirm: true, proposalKey: key }));
              }}
            >
              {busy === "offset" && <Spinner size="sm" />} Confirm set-off and record on the GST portal
            </button>
          )}
        </Actions>
      </div>
    );
  }

  function renderLoadDetails() {
    return (
      <div className="space-y-4">
        <StepHeading>Tax payment recorded</StepHeading>
        {sessionLine}
        <p className="text-sm text-text-secondary">The GST portal has recorded the tax payment. Next, load the updated GSTR-3B from the portal for a final review.</p>
        {notices}
        <Actions>
          <button type="button" className="btn-secondary" onClick={onClose}>Close and come back later</button>
          <button type="button" className="btn-primary" disabled={busy !== null} onClick={() => void act("details", () => detailsG3.mutateAsync({ year, month }))}>
            {busy === "details" && <Spinner size="sm" />} Load updated return
          </button>
        </Actions>
      </div>
    );
  }

  function renderFinal() {
    const p = attempt!.proposal;
    return (
      <div className="space-y-4">
        <StepHeading>Final review</StepHeading>
        {sessionLine}
        <p className="text-sm text-text-secondary">The GST portal now holds the updated GSTR-3B for {label} with this tax payment:</p>
        {p && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm" data-testid="final-payment">
            <dt className="text-text-tertiary">Paid from input tax credit</dt>
            <dd className="text-right tabular-nums">{formatCurrency(itcUsedTotal(p))}</dd>
            <dt className="text-text-tertiary">Paid in cash</dt>
            <dd className="text-right tabular-nums">{formatCurrency(totalOf(p.cashNeeded))}</dd>
          </dl>
        )}
        <p className="text-xs text-text-tertiary">Interest and late fee are not included. If they apply, add them on the GST portal before you file.</p>
        {notices}
        <Actions>
          <button type="button" className="btn-secondary" onClick={onClose}>Close and come back later</button>
          <button type="button" className="btn-primary" onClick={() => setReviewed(true)}>Continue to OTP</button>
        </Actions>
      </div>
    );
  }

  // 5. EVC OTP and final confirmation
  async function sendEvc() {
    const r = await act(
      "evc",
      () =>
        evc.mutateAsync({
          kind,
          year,
          month,
          nil: isNilFlow,
          confirmNil: isNilFlow,
          ...(pan.trim() ? { pan: pan.trim().toUpperCase() } : {}),
        }),
      (res) => {
        setWarnings(res.warnings);
        setPanMasked(res.panMasked);
        setOtpSentAt(Date.now());
        setOtp("");
        setConfirming(false);
        setFileAck(false);
      },
    );
    if (!r) setPanOpen(true);
  }

  function renderOtpRequest() {
    return (
      <div className="space-y-4">
        <StepHeading>Send the filing OTP</StepHeading>
        {sessionLine}
        <p className="text-sm text-text-secondary">
          To file, the GST portal sends an OTP (EVC) to the mobile number and email registered for the PAN holder of this GST registration. You will type it in on the next screen.
        </p>
        <div>
          <button type="button" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400" aria-expanded={panOpen} onClick={() => setPanOpen((v) => !v)}>
            {panOpen ? "Hide PAN" : "Use a different PAN (for example, a company's authorised signatory)"}
          </button>
          {panOpen && (
            <div className="mt-2 space-y-1">
              <label htmlFor="evc-pan" className="label">PAN to send the OTP to</label>
              <input id="evc-pan" className="input w-full max-w-xs uppercase" maxLength={10} autoComplete="off" value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} />
              <p className="text-xs text-text-tertiary">Leave empty to use the PAN of this registration.</p>
            </div>
          )}
        </div>
        {notices}
        <Actions>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setReviewed(false);
              setNil3bReady(false);
            }}
          >
            Back
          </button>
          <button type="button" className="btn-primary" disabled={busy !== null} onClick={() => void sendEvc()}>
            {busy === "evc" && <Spinner size="sm" />} Send OTP
          </button>
        </Actions>
      </div>
    );
  }

  function renderOtpEnter() {
    return (
      <div className="space-y-4">
        <StepHeading>Enter the filing OTP</StepHeading>
        {sessionLine}
        <p className="text-sm text-text-secondary">
          Type the 6-digit OTP the GST portal sent{panMasked ? ` for PAN ${panMasked}` : ""}. It is used once, to file, and is not stored.
        </p>
        {notices}
        <OtpInput label="Filing OTP (6 digits)" value={otp} onChange={setOtp} onEnter={() => isOtpComplete(otp) && setConfirming(true)} />
        <button type="button" className="btn-ghost text-sm" disabled={evcCooldown > 0 || busy !== null} onClick={() => void sendEvc()}>
          {evcCooldown > 0 ? `Resend OTP in ${evcCooldown} s` : "Resend OTP"}
        </button>
        <Actions>
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
          <button type="button" className="btn-primary" disabled={!isOtpComplete(otp)} onClick={() => setConfirming(true)}>
            Continue
          </button>
        </Actions>
      </div>
    );
  }

  function renderConfirm() {
    const filing = busy === "file";
    return (
      <div className="space-y-4">
        <StepHeading>{finalConfirmationTitle(kind, label, gstin)}</StepHeading>
        {sessionLine}
        <Notice tone="warning">
          This is the last step. When you press the button, the return is filed with the government. It cannot be undone or withdrawn. To correct a filed return you must file an amendment.
        </Notice>
        <p className="text-sm text-text-secondary">OTP entered. It will be used once and then discarded.</p>
        {notices}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={fileAck} onChange={(e) => setFileAck(e.target.checked)} />
          <span>{FILE_CONFIRM_TEXT}</span>
        </label>
        <Actions>
          <button type="button" className="btn-secondary" disabled={filing} onClick={() => { setConfirming(false); setFileAck(false); }}>
            Back
          </button>
          <button type="button" className="btn-primary" disabled={!fileAck || filing} onClick={() => void file()}>
            {filing && <Spinner size="sm" />} File {name} now
          </button>
        </Actions>
      </div>
    );
  }

  async function file() {
    if (!fileAck || !isOtpComplete(otp)) return;
    const code = otp;
    // The OTP is cleared at once: it is only ever held for this one call.
    setOtp("");
    setConfirming(false);
    const input = { year, month, evcOtp: code, ...(pan.trim() ? { pan: pan.trim().toUpperCase() } : {}) };
    const r = await act(
      "file",
      () => (kind === "gstr1" ? fileG1.mutateAsync(input) : fileG3.mutateAsync(input)),
      (res) => {
        setFiledInfo(res.tracked ? { arn: res.tracked.arn, filedOn: res.tracked.filedOn } : { arn: null, filedOn: null });
        void statusQ.refetch();
      },
    );
    setFileAck(false);
    return r;
  }

  function renderOtpFailed() {
    return (
      <div className="space-y-4">
        <StepHeading>The return was not filed</StepHeading>
        {sessionLine}
        <Notice tone="error">
          {attempt!.lastError ?? "The OTP was not accepted or the GST portal refused the filing."} Nothing was filed. Request a new OTP and try again.
        </Notice>
        {notices}
        <Actions>
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
          <button type="button" className="btn-primary" disabled={busy !== null} onClick={() => void sendEvc()}>
            {busy === "evc" && <Spinner size="sm" />} Send a new OTP
          </button>
        </Actions>
      </div>
    );
  }

  // 6. Result
  function renderDone() {
    const row = statusQ.data?.status === "ok" ? statusQ.data.months.find((m) => m.period === period) : null;
    const tracked = filedInfo?.arn || filedInfo?.filedOn ? filedInfo : kind === "gstr1" ? row?.gstr1 : row?.gstr3b;
    return (
      <div className="space-y-4">
        <StepHeading>{name} for {label} is filed</StepHeading>
        <Notice tone="success">The GST portal accepted the return.</Notice>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm" data-testid="filed-result">
          <dt className="text-text-tertiary">ARN</dt>
          <dd className="break-all text-right">{tracked?.arn ?? "Not shown yet"}</dd>
          <dt className="text-text-tertiary">Filed on</dt>
          <dd className="text-right">{tracked?.filedOn ?? "Not shown yet"}</dd>
        </dl>
        {!tracked?.arn && (
          <div className="space-y-2">
            <p className="text-xs text-text-tertiary">The GST portal has not shown the ARN yet. It usually appears within a few minutes.</p>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                if (forceStatus) void statusQ.refetch();
                else setForceStatus(true);
              }}
            >
              Check again
            </button>
          </div>
        )}
        <p className="text-xs text-text-tertiary">You can download the filed return from your GST portal login (Returns Dashboard). The Return status panel on the GST page keeps showing the ARN.</p>
        <Actions>
          <button type="button" className="btn-primary" onClick={onClose}>Back to GST</button>
        </Actions>
      </div>
    );
  }

  return (
    <div>
      {stepper}
      <div key={`${pos.step}:${phase}`}>{body()}</div>
    </div>
  );
}
