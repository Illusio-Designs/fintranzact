/**
 * GstFilingFlow: file GSTR-1, GSTR-3B or a nil return from the phone, step by step.
 * The same sequence as the web wizard (pre-flight, GST portal sign-in, save and check,
 * review, [3B set-off], EVC OTP, final confirmation, result), driven by the persisted
 * state from `gstReturns.filingAttempt` so it resumes where it stopped. Nothing files
 * by itself: the return is filed only after the EVC OTP, the explicit acknowledgement
 * and a press of the final button.
 *
 * Compact by design: it shows what the server provides (summaries, ledger balances, the
 * set-off proposal). Large validation-error lists show the first few messages and point
 * to the web app for the rest.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  FILE_CONFIRM_TEXT,
  HEAD_LABEL,
  NIL_CONFIRM_TEXT,
  OTP_RESEND_SECONDS,
  SETOFF_CONFIRM_TEXT,
  deriveWizardStep,
  finalConfirmationTitle,
  formatElapsed,
  formatRemaining,
  fyStartOf,
  groupPortalErrors,
  gstnPeriodOf,
  isOtpComplete,
  isPortalSessionError,
  itcRows,
  itcUsedTotal,
  preflightFromStatus,
  returnName,
  sessionRemainingMs,
  startPortalPolling,
  summariseSecSum,
  totalOf,
  wizardPeriodLabel,
  wizardSteps,
  type FilingKind,
  type StatusMonth,
  type WizardPhase,
} from "@fintranzact/shared";
import { trpc } from "../../lib/trpc";
import { formatCurrency } from "../../lib/utils";
import { makeStyles } from "../../lib/makeStyles";
import { useColors } from "../../contexts/ThemeContext";
import { useBusinessStore } from "../../stores/business";
import { useGstSessionStore } from "../../stores/gst-session";
import { Btn, Check, Field, H, KV, Note, OtpField, P } from "./parts";

const msg = (e: unknown) => (e instanceof Error && e.message ? e.message : "Something went wrong. Please try again.");
const SESSION_LOST = "Your session with the GST portal has ended. Sign in again with a new OTP; your progress is saved and you will continue where you stopped.";
/** The phone shows this many portal messages; the rest are on the web app. */
const MAX_ERRORS_SHOWN = 8;

const num = (s: string): number | null => {
  const t = s.replace(/[,\s₹]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

function useNow(everyMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

export interface GstFilingFlowProps {
  kind: FilingKind;
  year: number;
  month: number;
  gstin: string;
  onExit: () => void;
  /** Open another return (the "file this first" shortcuts). */
  onSwitch?: (kind: FilingKind, year: number, month: number) => void;
}

export function GstFilingFlow({ kind, year, month, gstin, onExit, onSwitch }: GstFilingFlowProps) {
  const styles = useStyles();
  const colors = useColors();
  const name = returnName(kind);
  const label = wizardPeriodLabel(year, month);
  const period = gstnPeriodOf(year, month);
  const fy = fyStartOf(year, month);
  const businessId = useBusinessStore((s) => s.businessId) ?? "default";

  // ── The GST portal session ──
  const entry = useGstSessionStore((s) => s.entries[businessId]);
  const markVerified = useGstSessionStore((s) => s.markVerified);
  const clearSession = useGstSessionStore((s) => s.clear);
  const hydrate = useGstSessionStore((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  const now = useNow(30_000);
  const remainingMs = sessionRemainingMs(entry?.verifiedAt ?? null, now);
  const signedIn = remainingMs > 0;

  // ── What the server says ──
  const attemptQ = trpc.gstReturns.filingAttempt.useQuery({ kind, year, month }, { retry: false, refetchOnWindowFocus: false });
  const [forceStatus, setForceStatus] = useState(false);
  const statusQ = trpc.gstReturns.filingStatus.useQuery({ fyStartYear: fy, refresh: forceStatus }, { retry: false, refetchOnWindowFocus: false });
  const prevStatusQ = trpc.gstReturns.filingStatus.useQuery({ fyStartYear: fy - 1, refresh: false }, { enabled: month === 4, retry: false, refetchOnWindowFocus: false });
  const attempt = attemptQ.data;
  const state = attempt?.state ?? "draft";

  // ── Local state (never persisted) ──
  const [checked, setChecked] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [choice, setChoice] = useState<"normal" | "nil">("normal");
  const [nilConfirmed, setNilConfirmed] = useState(false);
  const [nil3bReady, setNil3bReady] = useState(false);
  const [gt, setGt] = useState("");
  const [curGt, setCurGt] = useState("");
  const [username, setUsername] = useState(entry?.username ?? "");
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
  const pollM = trpc.gstReturns.pollReturnStatus.useMutation();

  const isNilFlow = (attempt?.nil ?? false) || (kind === "gstr3b" && nil3bReady && state === "draft");

  let pos = deriveWizardStep({ kind, state, nil: attempt?.nil ?? false, signedIn, checked });
  if (signedIn && kind === "gstr3b" && state === "draft" && nil3bReady) pos = { step: "otp", phase: "otp_request" };
  if (signedIn && reviewed && (pos.phase === "summary" || pos.phase === "final")) pos = { step: "otp", phase: "otp_request" };
  const phase: WizardPhase = pos.phase;

  async function refreshAttempt() {
    try {
      await attemptQ.refetch();
    } catch {
      // the next render shows the query's own error
    }
  }

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
        clearSession(businessId);
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

  // ── Polling: the shared loop, one check per 12 s at the earliest ──
  const polling = phase === "polling_save" || phase === "polling_proceed" || phase === "polling_offset";
  const [elapsed, setElapsed] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const restartNext = useRef(false);
  const pollRef = useRef(pollM.mutateAsync);
  pollRef.current = pollM.mutateAsync;
  const refreshRef = useRef(refreshAttempt);
  refreshRef.current = refreshAttempt;
  useEffect(() => {
    if (!polling) return;
    const startedAt = Date.now();
    setElapsed(0);
    setTimedOut(false);
    setPollError(null);
    const tick = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    const restart = restartNext.current;
    restartNext.current = false;
    const stop = startPortalPolling({
      restart,
      poll: (r) => pollRef.current({ kind, year, month, restart: r }),
      onSettled: (outcome, errors) => {
        setPollErrors(outcome === "errors" ? errors : []);
        void refreshRef.current();
      },
      onTimeout: () => setTimedOut(true),
      onSessionLost: () => {
        clearSession(businessId);
        setNotice(SESSION_LOST);
      },
      onError: setPollError,
    });
    return () => {
      stop();
      clearInterval(tick);
    };
  }, [polling, kind, year, month, round, businessId, clearSession]);

  // The stored GSTR-1 summary comes back from the server without calling the portal.
  const summaryRequested = useRef(false);
  useEffect(() => {
    if (phase !== "summary" || kind !== "gstr1" || secSum || summaryRequested.current || busy) return;
    summaryRequested.current = true;
    void act("summary", () => summaryG1.mutateAsync({ year, month }), (r) => setSecSum(r.secSum as unknown[]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, secSum]);

  useEffect(() => setSetoffAck(false), [attempt?.proposalKey]);
  useEffect(() => {
    if (state === "otp_requested" && otpSentAt === null && attempt?.updatedAt) setOtpSentAt(attempt.updatedAt);
  }, [state, otpSentAt, attempt?.updatedAt]);

  const tickSec = useNow(1000);
  const cooldown = (since: number | null) => (since === null ? 0 : Math.max(0, Math.ceil((since + OTP_RESEND_SECONDS * 1000 - tickSec) / 1000)));

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

  if (attemptQ.isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel="Loading filing progress">
          <ActivityIndicator color={colors.brand} />
        </View>
      </SafeAreaView>
    );
  }
  if (attemptQ.error || !attempt) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.body}>
          <Note tone="error">{attemptQ.error?.message ?? "Could not load the filing progress."}</Note>
          <Btn label="Try again" onPress={() => void attemptQ.refetch()} />
          <Btn label="Back" variant="secondary" onPress={onExit} />
        </View>
      </SafeAreaView>
    );
  }

  const gtN = num(gt);
  const curGtN = num(curGt);
  const turnoverOk = gtN !== null && curGtN !== null;
  const steps = wizardSteps(isNilFlow);
  const at = Math.max(0, steps.findIndex((s) => s.step === pos.step));

  const notes = (
    <>
      {notice ? <Note tone="warning">{notice}</Note> : null}
      {error ? <Note tone="error">{error}</Note> : null}
      {warnings.map((w) => <Note key={w} tone="warning">{w}</Note>)}
    </>
  );
  const sessionLine = signedIn ? <P muted>GST portal session: {formatRemaining(remainingMs)} left</P> : null;

  // ── Actions ──
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
      markVerified(businessId, username.trim());
      setSignInOtpSent(null);
      setNotice(null);
    }
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
  async function sendEvc() {
    const r = await act(
      "evc",
      () => evc.mutateAsync({ kind, year, month, nil: isNilFlow, confirmNil: isNilFlow, ...(pan.trim() ? { pan: pan.trim().toUpperCase() } : {}) }),
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
  async function file() {
    if (!fileAck || !isOtpComplete(otp)) return;
    const code = otp;
    // The OTP is cleared at once: it is only ever held for this one call.
    setOtp("");
    setConfirming(false);
    const input = { year, month, evcOtp: code, ...(pan.trim() ? { pan: pan.trim().toUpperCase() } : {}) };
    await act(
      "file",
      () => (kind === "gstr1" ? fileG1.mutateAsync(input) : fileG3.mutateAsync(input)),
      (res) => {
        setFiledInfo(res.tracked ? { arn: res.tracked.arn, filedOn: res.tracked.filedOn } : { arn: null, filedOn: null });
        void statusQ.refetch();
      },
    );
    setFileAck(false);
  }

  // ── Screens: { body, actions } ──
  function screen(): { body: React.ReactNode; actions: React.ReactNode } {
    switch (phase) {
      case "check": {
        const blocked = preflight.verdict === "missing" || !!preflight.alreadyFiled;
        return {
          body: (
            <>
              <H>Before you start</H>
              {statusLoading ? <P muted>Checking the GST portal...</P> : null}
              {!statusLoading && preflight.alreadyFiled ? (
                <Note tone="success">{name} for {label} is already filed on the GST portal{preflight.alreadyFiled.arn ? ` (ARN ${preflight.alreadyFiled.arn})` : ""}. There is nothing more to file.</Note>
              ) : null}
              {!statusLoading && preflight.verdict === "ok" && !preflight.alreadyFiled ? (
                <Note tone="success">Earlier returns are filed{kind === "gstr3b" ? ", including GSTR-1 for this period" : ""}.</Note>
              ) : null}
              {!statusLoading && preflight.verdict === "missing" ? (
                <>
                  <Note tone="error">File these first. The GST portal does not accept {name} for {label} until they are filed.</Note>
                  {preflight.missing.map((m) => (
                    <View key={`${m.kind}${m.period}`} style={styles.missingRow}>
                      <Text style={styles.missingText}>{m.label}</Text>
                      {onSwitch ? (
                        <Btn
                          variant="link"
                          label={`File ${m.label} first`}
                          onPress={() => onSwitch(m.kind, Number(m.period.slice(2)), Number(m.period.slice(0, 2)))}
                        />
                      ) : null}
                    </View>
                  ))}
                </>
              ) : null}
              {!statusLoading && (preflight.verdict === "unknown" || preflight.verdict === "skipped") ? <Note tone={preflight.verdict === "unknown" ? "warning" : "info"}>{preflight.notes[0]}</Note> : null}
              {!statusLoading && preflight.verdict !== "skipped" && preflight.verdict !== "unknown" ? <P muted>{preflight.notes.join(" ")}</P> : null}
              <Btn
                variant="link"
                label="Check the GST portal again"
                onPress={() => {
                  setForceStatus(true);
                  void statusQ.refetch();
                }}
              />
              <P muted>
                The figures come from your books on the server. To look through them line by line, open the GST page in the web app. You will sign in to the GST portal with an OTP, save the return, review it and confirm with a second OTP. Nothing is filed until the very last step.
              </P>
            </>
          ),
          actions: (
            <>
              <Btn label="Continue to GST portal sign-in" disabled={blocked || statusLoading} onPress={() => setChecked(true)} />
              <Btn label="Back to GST" variant="secondary" onPress={onExit} />
            </>
          ),
        };
      }
      case "signin": {
        const sent = signInOtpSent !== null;
        const left = cooldown(signInOtpSent);
        return {
          body: (
            <>
              <H>Sign in to the GST portal</H>
              <P>
                The GST portal sends a one-time password (OTP) to the mobile number registered for your GST login. The session lasts about 6 hours.
                {pos.resume ? " Then you continue where you stopped." : ""}
              </P>
              {notes}
              <Field label="GST portal username" value={username} onChangeText={setUsername} disabled={sent} />
              {sent ? (
                <>
                  <P muted>An OTP was sent to the mobile registered with the GST portal.</P>
                  <OtpField label="OTP from the GST portal" value={signInOtp} onChangeText={setSignInOtp} />
                  <Btn variant="link" label={left > 0 ? `Resend OTP in ${left} s` : "Resend OTP"} disabled={left > 0 || busy === "otp"} onPress={() => void sendSignInOtp()} />
                </>
              ) : null}
            </>
          ),
          actions: (
            <>
              {!sent ? (
                <Btn label="Send OTP" disabled={!username.trim()} busy={busy === "otp"} onPress={() => void sendSignInOtp()} />
              ) : (
                <Btn label="Verify and continue" disabled={!isOtpComplete(signInOtp)} busy={busy === "verify"} onPress={() => void verify()} />
              )}
              <Btn label="Close" variant="secondary" onPress={onExit} />
            </>
          ),
        };
      }
      case "choose": {
        const nilOk = attempt!.nilEligible;
        const blockers = attempt!.nilBlockers;
        return {
          body: (
            <>
              <H>Prepare {name} for {label}</H>
              {sessionLine}
              {notes}
              <Check label="Normal return: send the figures from your books" value={choice === "normal"} onChange={() => setChoice("normal")} />
              {nilOk ? (
                <Check label={`Nil return: your books show nothing for ${label}`} value={choice === "nil"} onChange={() => setChoice("nil")} />
              ) : (
                <P muted>
                  {blockers.length ? `A nil return is not available: your books have ${blockers.join(", ")} for ${label}.` : "A nil return is not available right now."}
                </P>
              )}
              {choice === "nil" && nilOk ? (
                <Check label={NIL_CONFIRM_TEXT[kind](label)} value={nilConfirmed} onChange={setNilConfirmed} />
              ) : kind === "gstr1" ? (
                <Gstr1Inputs gt={gt} curGt={curGt} setGt={setGt} setCurGt={setCurGt} label={label} gtN={gtN} curGtN={curGtN} />
              ) : (
                <P muted>The figures for {label} are taken from your books and saved on the GST portal. Interest and late fee are not included: add them on the GST portal if they apply.</P>
              )}
            </>
          ),
          actions:
            choice === "nil" && nilOk ? (
              <>
                <Btn
                  label={kind === "gstr1" ? "Start nil return" : "Continue with nil return"}
                  disabled={!nilConfirmed || busy !== null}
                  busy={busy === "proceed"}
                  onPress={() => {
                    if (kind === "gstr1") void act("proceed", () => proceedG1.mutateAsync({ year, month, nil: true, confirmNil: true }), (r) => setWarnings(r.warnings));
                    else setNil3bReady(true);
                  }}
                />
                <Btn label="Close" variant="secondary" onPress={onExit} />
              </>
            ) : (
              <>
                <Btn label="Save to GST portal" disabled={(kind === "gstr1" && !turnoverOk) || busy !== null} busy={busy === "save"} onPress={() => void save()} />
                <Btn label="Close" variant="secondary" onPress={onExit} />
              </>
            ),
        };
      }
      case "polling_save":
      case "polling_proceed":
      case "polling_offset":
        return {
          body: (
            <>
              <H>{state === "offset_posted" ? "Recording the tax payment" : "Saved on the GST portal"}</H>
              {sessionLine}
              {recon ? <Note tone="warning">{recon}</Note> : null}
              {notes}
              {timedOut || pollError ? (
                <>
                  <Note tone="warning">{pollError ?? "The GST portal is taking longer than usual. Nothing is lost: your progress is saved."}</Note>
                  <Btn
                    label="Check again"
                    onPress={() => {
                      restartNext.current = true;
                      setRound((n) => n + 1);
                    }}
                  />
                </>
              ) : (
                <View accessibilityLiveRegion="polite" style={styles.polling}>
                  <ActivityIndicator color={colors.brand} />
                  <Text style={styles.pollingText}>Checking with the GST portal...</Text>
                  <P muted>Waiting {formatElapsed(elapsed)}. This usually takes 1-2 minutes; we check every 12 seconds. You can close this screen and come back: your place is saved.</P>
                </View>
              )}
            </>
          ),
          actions: <Btn label="Close and come back later" variant="secondary" onPress={onExit} />,
        };
      case "save_errors":
      case "proceed_errors": {
        const messages = pollErrors.length ? pollErrors : attempt!.errors;
        const groups = groupPortalErrors(messages.slice(0, MAX_ERRORS_SHOWN));
        const more = messages.length - Math.min(messages.length, MAX_ERRORS_SHOWN);
        const nilRetry = attempt!.nil;
        return {
          body: (
            <>
              <H>The GST portal found problems</H>
              <Note tone="error">
                {state === "save_errors"
                  ? "The GST portal rejected the saved data. Fix your books, then save again. You cannot go on until it saves cleanly."
                  : "The GST portal could not prepare the return. Save again before you go on."}
              </Note>
              <View testID="portal-errors" style={styles.errors}>
                {groups.map((g) => (
                  <View key={g.section} style={styles.errGroup}>
                    <Text style={styles.errTitle}>{g.label}</Text>
                    {g.messages.map((m) => <Text key={m} style={styles.errMsg}>{`• ${m}`}</Text>)}
                    {g.fix ? <P muted>Fix in your books: open {g.fix === "invoices" ? "Invoices" : g.fix === "credit-notes" ? "Credit notes" : "Items"} in this app, then come back and save again.</P> : null}
                  </View>
                ))}
                {more > 0 ? <P muted>{more} more message{more === 1 ? "" : "s"} from the GST portal. Open the GST page in the web app to see them all.</P> : null}
                {messages.length === 0 ? <P>The portal gave no details. Save again, or check the return on the GST portal.</P> : null}
              </View>
              {notes}
              {nilRetry ? <Check label={NIL_CONFIRM_TEXT[kind](label)} value={nilConfirmed} onChange={setNilConfirmed} /> : kind === "gstr1" ? <Gstr1Inputs gt={gt} curGt={curGt} setGt={setGt} setCurGt={setCurGt} label={label} gtN={gtN} curGtN={curGtN} /> : null}
            </>
          ),
          actions: nilRetry ? (
            <>
              <Btn label="Try again" disabled={!nilConfirmed || busy !== null} onPress={() => void act("proceed", () => proceedG1.mutateAsync({ year, month, nil: true, confirmNil: true }))} />
              <Btn label="Close" variant="secondary" onPress={onExit} />
            </>
          ) : (
            <>
              <Btn label="Save again" disabled={(kind === "gstr1" && !turnoverOk) || busy !== null} busy={busy === "save"} onPress={() => void save()} />
              <Btn label="Close" variant="secondary" onPress={onExit} />
            </>
          ),
        };
      }
      case "save_ok":
        return {
          body: (
            <>
              <H>Saved on the GST portal</H>
              {sessionLine}
              <P>The GST portal has accepted and checked the figures. They are saved on the portal but the return is not filed yet. Next, ask the portal to prepare the return for filing.</P>
              {notes}
            </>
          ),
          actions: (
            <>
              <Btn label="Prepare for filing" disabled={busy !== null} busy={busy === "proceed"} onPress={() => void act("proceed", () => proceedG1.mutateAsync({ year, month, nil: false, confirmNil: false }), (r) => setWarnings(r.warnings))} />
              <Btn label="Close and come back later" variant="secondary" onPress={onExit} />
            </>
          ),
        };
      case "load_summary":
        return {
          body: (
            <>
              <H>Return is ready on the GST portal</H>
              {sessionLine}
              <P>Next, load the summary the GST portal holds for {label} so you can review it before you file.</P>
              {notes}
            </>
          ),
          actions: (
            <>
              <Btn label="Load summary" disabled={busy !== null} busy={busy === "summary"} onPress={() => void act("summary", () => summaryG1.mutateAsync({ year, month }), (r) => setSecSum(r.secSum as unknown[]))} />
              <Btn label="Close and come back later" variant="secondary" onPress={onExit} />
            </>
          ),
        };
      case "summary": {
        const rows = secSum ? summariseSecSum(secSum) : [];
        const money = (n: number | null) => (n === null ? "-" : formatCurrency(n));
        return {
          body: (
            <>
              <H>Review the summary</H>
              {sessionLine}
              <P>This is the GST portal's summary of {name} for {label}, section by section. Check it against your books.</P>
              {notes}
              {!secSum ? <P muted>Loading the summary...</P> : null}
              {secSum && rows.length === 0 ? <Note tone="info">The GST portal returned a summary this app cannot show here. Review it on the GST portal before you file.</Note> : null}
              <View testID="gstr1-summary" style={styles.cards}>
                {rows.map((r) => (
                  <View key={r.section} style={styles.card}>
                    <Text style={styles.cardTitle}>{r.section}</Text>
                    <KV k="Records" v={r.records === null ? "-" : String(r.records)} />
                    <KV k="Taxable value" v={money(r.taxable ?? r.value)} />
                    <KV k="IGST" v={money(r.igst)} />
                    <KV k="CGST" v={money(r.cgst)} />
                    <KV k="SGST" v={money(r.sgst)} />
                  </View>
                ))}
              </View>
            </>
          ),
          actions: (
            <>
              <Btn label="The summary is correct: continue" disabled={!secSum || busy !== null} onPress={() => setReviewed(true)} />
              <Btn label="Close and come back later" variant="secondary" onPress={onExit} />
            </>
          ),
        };
      }
      case "load_ledger":
        return {
          body: (
            <>
              <H>Saved on the GST portal</H>
              {sessionLine}
              {recon ? <Note tone="warning">{recon}</Note> : null}
              <P>The figures are saved on the GST portal and checked. Next we read your cash and credit ledger balances and propose how the tax is paid. Nothing is paid until you confirm it.</P>
              {notes}
            </>
          ),
          actions: (
            <>
              <Btn label="Check ledger balances" disabled={busy !== null} busy={busy === "ledger"} onPress={() => void act("ledger", () => ledgerG3.mutateAsync({ year, month }))} />
              <Btn label="Close and come back later" variant="secondary" onPress={onExit} />
            </>
          ),
        };
      case "setoff":
      case "offset_errors": {
        const p = attempt!.proposal;
        const l = attempt!.ledger;
        const heads = ["igst", "cgst", "sgst"] as const;
        const has = !!p && !!l && !!attempt!.proposalKey;
        const errs = pollErrors.length ? pollErrors : attempt!.errors;
        return {
          body: (
            <>
              <H>Review the tax payment (set-off)</H>
              {sessionLine}
              {phase === "offset_errors" ? <Note tone="error">The GST portal rejected the tax payment. Check the balances again, then confirm a new set-off.</Note> : null}
              {phase === "offset_errors" && errs.length ? <Note tone="error">{errs.slice(0, MAX_ERRORS_SHOWN).join("\n")}</Note> : null}
              {notes}
              {!has ? <P muted>Loading the proposal...</P> : null}
              {has && p && l ? (
                <>
                  <P>Your tax for {label} is paid first from your input tax credit and the rest in cash. This is only a proposal: nothing is paid until you confirm below.</P>
                  <View style={styles.card} testID="ledger-table">
                    <Text style={styles.cardTitle}>Ledger balances on the GST portal</Text>
                    {heads.map((h) => (
                      <KV key={h} k={`${HEAD_LABEL[h]}: credit / cash`} v={`${formatCurrency(l.itc[h])} / ${formatCurrency(l.cash[h])}`} />
                    ))}
                  </View>
                  <View style={styles.card} testID="setoff-table">
                    <Text style={styles.cardTitle}>Proposed set-off</Text>
                    {itcRows(p).map((r) => (
                      <KV key={`${r.credit}-${r.against}`} k={`${r.credit} pays ${r.against}`} v={formatCurrency(r.amount)} />
                    ))}
                    <KV k="Credit used in total" v={formatCurrency(itcUsedTotal(p))} />
                    {heads.map((h) => (
                      <KV key={h} k={`Cash pays ${HEAD_LABEL[h]}`} v={formatCurrency(p.cashNeeded[h])} />
                    ))}
                    <KV testID="cash-payable" k="Cash payable in total" v={formatCurrency(totalOf(p.cashNeeded))} />
                  </View>
                  <P muted>How credit is used: IGST credit pays IGST, then CGST, then SGST. CGST credit pays CGST, then IGST. SGST credit pays SGST, then IGST. What is left is paid in cash, tax by tax. Reverse charge tax is always paid in cash. Interest and late fee are not included.</P>
                  {!p.sufficient ? (
                    <Note tone="warning">
                      {`Your cash ledger does not cover the tax that credit cannot pay.\n${heads.filter((h) => p.cashShortfall[h] > 0).map((h) => `Add ${formatCurrency(p.cashShortfall[h])} to the ${HEAD_LABEL[h]} cash ledger.`).join("\n")}\nDeposit the cash on the GST portal with a challan. This app cannot make the payment. Then check the balances again.`}
                    </Note>
                  ) : (
                    <Check label={SETOFF_CONFIRM_TEXT} value={setoffAck} onChange={setSetoffAck} />
                  )}
                </>
              ) : null}
            </>
          ),
          actions: (
            <>
              {has && p?.sufficient ? (
                <Btn
                  label="Confirm set-off and record on the GST portal"
                  disabled={!setoffAck || busy !== null}
                  busy={busy === "offset"}
                  onPress={() => {
                    const key = attempt!.proposalKey!;
                    setPollErrors([]);
                    void act("offset", () => offsetG3.mutateAsync({ year, month, confirm: true, proposalKey: key }));
                  }}
                />
              ) : null}
              <Btn label="Check balances again" variant="secondary" disabled={busy !== null} busy={busy === "ledger"} onPress={() => void act("ledger", () => ledgerG3.mutateAsync({ year, month }))} />
            </>
          ),
        };
      }
      case "load_details":
        return {
          body: (
            <>
              <H>Tax payment recorded</H>
              {sessionLine}
              <P>The GST portal has recorded the tax payment. Next, load the updated GSTR-3B from the portal for a final review.</P>
              {notes}
            </>
          ),
          actions: (
            <>
              <Btn label="Load updated return" disabled={busy !== null} busy={busy === "details"} onPress={() => void act("details", () => detailsG3.mutateAsync({ year, month }))} />
              <Btn label="Close and come back later" variant="secondary" onPress={onExit} />
            </>
          ),
        };
      case "final": {
        const p = attempt!.proposal;
        return {
          body: (
            <>
              <H>Final review</H>
              {sessionLine}
              <P>The GST portal now holds the updated GSTR-3B for {label} with this tax payment:</P>
              {p ? (
                <View style={styles.card} testID="final-payment">
                  <KV k="Paid from input tax credit" v={formatCurrency(itcUsedTotal(p))} />
                  <KV k="Paid in cash" v={formatCurrency(totalOf(p.cashNeeded))} />
                </View>
              ) : null}
              <P muted>Interest and late fee are not included. If they apply, add them on the GST portal before you file.</P>
              {notes}
            </>
          ),
          actions: (
            <>
              <Btn label="Continue to OTP" onPress={() => setReviewed(true)} />
              <Btn label="Close and come back later" variant="secondary" onPress={onExit} />
            </>
          ),
        };
      }
      case "otp_request":
        return {
          body: (
            <>
              <H>Send the filing OTP</H>
              {sessionLine}
              <P>To file, the GST portal sends an OTP (EVC) to the mobile number and email registered for the PAN holder of this GST registration. You will type it on the next screen.</P>
              <Btn variant="link" label={panOpen ? "Hide PAN" : "Use a different PAN"} onPress={() => setPanOpen((v) => !v)} />
              {panOpen ? <Field label="PAN to send the OTP to" value={pan} onChangeText={(v) => setPan(v.toUpperCase())} maxLength={10} autoCapitalize="characters" help="Leave empty to use the PAN of this registration. For a company, this may be the authorised signatory's PAN." /> : null}
              {notes}
            </>
          ),
          actions: (
            <>
              <Btn label="Send OTP" disabled={busy !== null} busy={busy === "evc"} onPress={() => void sendEvc()} />
              <Btn
                label="Back"
                variant="secondary"
                onPress={() => {
                  setReviewed(false);
                  setNil3bReady(false);
                }}
              />
            </>
          ),
        };
      case "otp_enter": {
        if (confirming) {
          const filing = busy === "file";
          return {
            body: (
              <>
                <H>{finalConfirmationTitle(kind, label, gstin)}</H>
                {sessionLine}
                <Note tone="warning">This is the last step. When you press the button, the return is filed with the government. It cannot be undone or withdrawn. To correct a filed return you must file an amendment.</Note>
                <P muted>OTP entered. It will be used once and then discarded.</P>
                {notes}
                <Check label={FILE_CONFIRM_TEXT} value={fileAck} onChange={setFileAck} />
              </>
            ),
            actions: (
              <>
                <Btn label={`File ${name} now`} disabled={!fileAck || filing} busy={filing} onPress={() => void file()} />
                <Btn label="Back" variant="secondary" disabled={filing} onPress={() => { setConfirming(false); setFileAck(false); }} />
              </>
            ),
          };
        }
        const left = cooldown(otpSentAt);
        return {
          body: (
            <>
              <H>Enter the filing OTP</H>
              {sessionLine}
              <P>Type the 6-digit OTP the GST portal sent{panMasked ? ` for PAN ${panMasked}` : ""}. It is used once, to file, and is not stored.</P>
              {notes}
              <OtpField label="Filing OTP (6 digits)" value={otp} onChangeText={setOtp} />
              <Btn variant="link" label={left > 0 ? `Resend OTP in ${left} s` : "Resend OTP"} disabled={left > 0 || busy !== null} onPress={() => void sendEvc()} />
            </>
          ),
          actions: (
            <>
              <Btn label="Continue" disabled={!isOtpComplete(otp)} onPress={() => setConfirming(true)} />
              <Btn label="Close" variant="secondary" onPress={onExit} />
            </>
          ),
        };
      }
      case "otp_failed":
        return {
          body: (
            <>
              <H>The return was not filed</H>
              {sessionLine}
              <Note tone="error">{`${attempt!.lastError ?? "The OTP was not accepted or the GST portal refused the filing."} Nothing was filed. Request a new OTP and try again.`}</Note>
              {notes}
            </>
          ),
          actions: (
            <>
              <Btn label="Send a new OTP" disabled={busy !== null} busy={busy === "evc"} onPress={() => void sendEvc()} />
              <Btn label="Close" variant="secondary" onPress={onExit} />
            </>
          ),
        };
      case "filed": {
        const row = statusQ.data?.status === "ok" ? statusQ.data.months.find((m) => m.period === period) : null;
        const tracked = filedInfo?.arn || filedInfo?.filedOn ? filedInfo : kind === "gstr1" ? row?.gstr1 : row?.gstr3b;
        return {
          body: (
            <>
              <H>{`${name} for ${label} is filed`}</H>
              <Note tone="success">The GST portal accepted the return.</Note>
              <View style={styles.card} testID="filed-result">
                <KV k="ARN" v={tracked?.arn ?? "Not shown yet"} />
                <KV k="Filed on" v={tracked?.filedOn ?? "Not shown yet"} />
              </View>
              {!tracked?.arn ? (
                <>
                  <P muted>The GST portal has not shown the ARN yet. It usually appears within a few minutes.</P>
                  <Btn
                    label="Check again"
                    variant="secondary"
                    onPress={() => {
                      if (forceStatus) void statusQ.refetch();
                      else setForceStatus(true);
                    }}
                  />
                </>
              ) : null}
              <P muted>You can download the filed return from your GST portal login (Returns Dashboard).</P>
            </>
          ),
          actions: <Btn label="Back to GST" onPress={onExit} />,
        };
      }
    }
  }

  const { body, actions } = screen();
  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text accessibilityLabel={`Step ${at + 1} of ${steps.length}: ${steps[at]?.label}`} style={styles.stepper}>
            {`Step ${at + 1} of ${steps.length}: ${steps[at]?.label}`}
          </Text>
          {body}
        </ScrollView>
        <View style={styles.footer}>{actions}</View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Gstr1Inputs(p: {
  gt: string;
  curGt: string;
  setGt: (v: string) => void;
  setCurGt: (v: string) => void;
  label: string;
  gtN: number | null;
  curGtN: number | null;
}) {
  return (
    <View style={{ gap: 12 }}>
      <P>The GST portal also needs two turnover figures. The app does not work them out, so please enter them.</P>
      <Field
        label="Aggregate turnover of the previous financial year"
        value={p.gt}
        onChangeText={p.setGt}
        numeric
        help="Total turnover of your whole last financial year (April to March), in rupees. Your CA has this number. Enter 0 if you were not registered."
      />
      <Field
        label="Aggregate turnover of the current financial year up to this period"
        value={p.curGt}
        onChangeText={p.setCurGt}
        numeric
        help={`Total turnover from 1 April of this financial year up to the end of ${p.label}, in rupees, including this month.`}
      />
      {(p.gt !== "" && p.gtN === null) || (p.curGt !== "" && p.curGtN === null) ? <Note tone="error">Enter the turnover as a number, for example 2500000.</Note> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { padding: 20, gap: 12, paddingBottom: 24 },
  stepper: { fontSize: 12, fontWeight: "600", color: colors.textMuted },
  footer: { padding: 16, gap: 8, borderTopWidth: 1, borderTopColor: colors.borderLight, backgroundColor: colors.bar },
  missingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  missingText: { flex: 1, fontSize: 14, color: colors.textPrimary },
  polling: { gap: 8, alignItems: "flex-start" },
  pollingText: { fontSize: 15, fontWeight: "600", color: colors.textPrimary },
  errors: { gap: 8 },
  errGroup: { borderRadius: 12, borderWidth: 1, borderColor: colors.danger, padding: 12, gap: 4 },
  errTitle: { fontSize: 14, fontWeight: "700", color: colors.danger },
  errMsg: { fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  cards: { gap: 8 },
  card: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 12, gap: 2 },
  cardTitle: { fontSize: 14, fontWeight: "700", color: colors.textPrimary, marginBottom: 4 },
}));
