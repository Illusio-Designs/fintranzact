/**
 * gst-filing.ts — orchestration of the GSTR-1 / GSTR-3B filing flows over the
 * Sandbox client and the attempt journal. The tRPC router is a thin wrapper;
 * everything that decides "may this step run now" lives here so it can be
 * tested with an in-memory store and a mocked gateway.
 *
 * No step ever files automatically: filing needs the EVC OTP the user types,
 * and the 3B tax payment needs the user's explicit confirmation of the
 * proposed cash / credit split.
 */

import type { GSTR1Report, GSTR3BReport } from "./gst-reports.js";
import {
  GstReturnsError,
  gstr1SaveBody,
  gstr3bToGstn,
  type SandboxGstReturnsClient,
} from "./sandbox/gst-returns.js";
import {
  GSTR1_PREREQUISITE,
  GSTR3B_PREREQUISITE,
  assertCanRun,
  gstr1NilBlockers,
  gstr3bLiability,
  gstr3bNilBlockers,
  gstr3bRcmCash,
  newAttempt,
  nilRefusal,
  pickFilingData,
  pollDecision,
  reconcileHint,
  type Attempt,
  type AttemptState,
  type PanSource,
  type ReturnKind,
} from "./gst-return-flow.js";
import { missingMessage, type PrereqResult } from "./gst-track.js";
import { offsetBody, parseLedgerBalances, proposalKey, proposeOffset } from "./gst-3b-offset.js";

export interface AttemptStore {
  load(kind: ReturnKind, period: string): Promise<Attempt | null>;
  save(attempt: Attempt): Promise<Attempt>;
}

export interface FilingDeps {
  gstin: string;
  client: SandboxGstReturnsClient;
  store: AttemptStore;
  now?: () => number;
  gstr1Report: () => Promise<GSTR1Report>;
  gstr3bReport: () => Promise<GSTR3BReport>;
  /** PAN for the EVC OTP / filing (explicit input, business PAN, or from the GSTIN). */
  pan: (input?: string) => { pan: string; source: PanSource } | null;
  /** Display period for messages, e.g. "Aug 2026". */
  periodLabel: string;
  /** Return-status prerequisite check (Track GST Returns); never throws. Omitted = no check. */
  prerequisite?: (kind: ReturnKind, period: string) => Promise<PrereqResult>;
}

/** A refusal the user can act on (mapped to PRECONDITION_FAILED / BAD_REQUEST by the router). */
export class FilingRefusal extends Error {
  constructor(message: string, public readonly kind: "precondition" | "bad_input" = "precondition") {
    super(message);
    this.name = "FilingRefusal";
  }
}

const mask = (pan: string) => `${pan.slice(0, 2)}${"*".repeat(7)}${pan.slice(9)}`;

export class GstFiling {
  private readonly now: () => number;
  constructor(private readonly d: FilingDeps) {
    this.now = d.now ?? Date.now;
  }

  private load(kind: ReturnKind, period: string) {
    return this.d.store.load(kind, period);
  }

  private async put(a: Attempt): Promise<Attempt> {
    return this.d.store.save(a);
  }

  private startPolling(a: Attempt): Attempt {
    const t = this.now();
    return { ...a, pollStartedAt: t, lastPolledAt: t, errors: undefined };
  }

  // ── Eligibility (read-only; used by the status query and the guards) ──

  async gstr1NilBlockers(): Promise<string[]> {
    return gstr1NilBlockers(await this.d.gstr1Report());
  }

  async gstr3bNilBlockers(): Promise<string[]> {
    return gstr3bNilBlockers(await this.d.gstr3bReport());
  }

  /**
   * Prerequisite check before a return is started. Blocks only when the GST
   * portal shows earlier returns (or, for 3B, GSTR-1 of the same period) as
   * not filed, or the return itself as already filed. "Could not verify" warns
   * and allows; for 3B it then falls back to our own record of GSTR-1.
   */
  private async checkPrereq(kind: ReturnKind, period: string): Promise<string[]> {
    const name = kind === "gstr1" ? "GSTR-1" : "GSTR-3B";
    let verdict: PrereqResult["verdict"] = "unknown";
    const warnings: string[] = [];
    if (this.d.prerequisite) {
      const r = await this.d.prerequisite(kind, period);
      verdict = r.verdict;
      if (r.alreadyFiled) {
        const arn = r.alreadyFiled.arn ? ` (ARN ${r.alreadyFiled.arn})` : "";
        throw new FilingRefusal(`${name} for ${this.d.periodLabel} is already filed on the GST portal${arn}.`);
      }
      if (r.verdict === "missing") throw new FilingRefusal(`${missingMessage(r)} Earlier returns must be filed before ${name} for ${this.d.periodLabel}.`);
      if (r.verdict === "unknown") warnings.push("Could not verify earlier returns on the GST portal. Make sure they are filed before you continue.");
      warnings.push(...r.notes.filter((n) => !warnings.includes(n)));
    }
    if (kind === "gstr3b" && verdict !== "ok" && verdict !== "skipped") {
      // The portal could not confirm GSTR-1: fall back to what we know from our own filings.
      const g1 = await this.load("gstr1", period);
      if (g1 && g1.state !== "filed") {
        throw new FilingRefusal(
          `GSTR-1 for ${this.d.periodLabel} is not filed yet (step: ${g1.state}). File GSTR-1 first, then GSTR-3B.`,
        );
      }
    }
    return warnings;
  }

  prerequisite(kind: ReturnKind): string {
    return kind === "gstr1" ? GSTR1_PREREQUISITE : GSTR3B_PREREQUISITE;
  }

  // ── GSTR-1 ───────────────────────────────────────────────────

  /** Step 2. Re-running re-saves (also the way out of save errors). */
  async saveGstr1(period: string, turnover: { gt: number; curGt: number }) {
    const attempt = await this.load("gstr1", period);
    assertCanRun("gstr1", "save", attempt, false);
    const warnings = await this.checkPrereq("gstr1", period);
    const report = await this.d.gstr1Report();
    const body = gstr1SaveBody(report, this.d.gstin, period, turnover);
    const referenceId = await this.d.client.saveGstr1(period, body);
    const next = this.startPolling({ ...newAttempt("gstr1", period, false, "saved", this.now()), saveRef: referenceId });
    await this.put(next);
    return { state: next.state, referenceId, warnings };
  }

  /** Step 3 (normal) or the first step of a nil return. */
  async proceedGstr1(period: string, opts: { nil: boolean; confirmNil: boolean }) {
    const attempt = await this.load("gstr1", period);
    assertCanRun("gstr1", "proceed", attempt, opts.nil);
    if (attempt?.state === "proceeding" && attempt.nil === opts.nil) {
      return { state: attempt.state, referenceId: attempt.proceedRef ?? null, resumed: true, warnings: [] as string[] };
    }
    if (opts.nil) {
      if (!opts.confirmNil) {
        throw new FilingRefusal(`Confirm that there were no outward supplies in ${this.d.periodLabel} to file a nil GSTR-1.`, "bad_input");
      }
      const blockers = await this.gstr1NilBlockers();
      if (blockers.length) throw new FilingRefusal(nilRefusal("GSTR-1", this.d.periodLabel, blockers));
    }
    // A nil return starts here: check what must be filed before it. (A normal return was checked at save.)
    const warnings = opts.nil && !attempt ? await this.checkPrereq("gstr1", period) : [];
    const referenceId = await this.d.client.proceedGstr1(period, opts.nil);
    const base = opts.nil ? newAttempt("gstr1", period, true, "proceeding", this.now()) : { ...attempt!, state: "proceeding" as AttemptState };
    const next = this.startPolling({ ...base, proceedRef: referenceId });
    await this.put(next);
    return { state: next.state, referenceId, resumed: false, warnings };
  }

  /** Step 4. Idempotent once the summary is stored. */
  async fetchGstr1Summary(period: string) {
    const attempt = await this.load("gstr1", period);
    assertCanRun("gstr1", "summary", attempt, false);
    if (attempt!.chksum && attempt!.secSum && attempt!.state !== "ready_to_file") {
      return { state: attempt!.state, secSum: attempt!.secSum };
    }
    const s = await this.d.client.getGstr1Summary(period);
    const next = await this.put({ ...attempt!, state: "summary_fetched", secSum: s.secSum, chksum: s.chksum, errors: undefined });
    return { state: next.state, secSum: s.secSum };
  }

  // ── Shared: status polling ───────────────────────────────────

  /**
   * One status check, rate-limited: never hits the portal more often than every
   * 12 s (floor 10 s) and gives up after ~3 minutes. Client-driven: the UI
   * calls this repeatedly using `retryAfterMs`.
   */
  async pollStatus(kind: ReturnKind, period: string, opts: { restart?: boolean } = {}) {
    let attempt = await this.load(kind, period);
    if (!attempt) throw new FilingRefusal("Nothing to check yet: save or proceed first.");
    assertCanRun(kind, "poll", attempt, attempt.nil);
    if (opts.restart) {
      attempt = await this.put(this.startPolling(attempt));
    }
    const decision = pollDecision(attempt, this.now());
    if (decision.action === "wait") return { state: attempt.state, status: "wait" as const, retryAfterMs: decision.retryAfterMs, errors: [] as string[] };
    if (decision.action === "timeout") return { state: attempt.state, status: "timeout" as const, retryAfterMs: 0, errors: [] as string[] };

    const ref = attempt.state === "saved" ? attempt.saveRef : attempt.state === "proceeding" ? attempt.proceedRef : attempt.offsetRef;
    if (!ref) throw new FilingRefusal("This step has no reference to check. Run it again.");
    const res = await this.d.client.getReturnStatus(period, ref);
    const at = this.now();
    if (res.phase === "processing") {
      await this.put({ ...attempt, lastPolledAt: at });
      return { state: attempt.state, status: "processing" as const, retryAfterMs: 12_000, errors: [] as string[] };
    }
    const ok = res.phase === "processed";
    const to: AttemptState =
      attempt.state === "saved" ? (ok ? "save_validated" : "save_errors")
      : attempt.state === "proceeding" ? (ok ? "ready_to_file" : "proceed_errors")
      : ok ? "offset_validated" : "offset_errors";
    const next = await this.put({ ...attempt, state: to, lastPolledAt: at, errors: ok ? undefined : res.errors });
    return { state: next.state, status: ok ? ("done" as const) : ("errors" as const), retryAfterMs: 0, errors: res.errors };
  }

  // ── EVC OTP (both returns) ───────────────────────────────────

  async requestEvcOtp(kind: ReturnKind, period: string, opts: { nil?: boolean; confirmNil?: boolean; pan?: string }) {
    const attempt = await this.load(kind, period);
    // GSTR-1 nil is decided by the attempt (started via proceed); a 3B nil has no earlier step, so it is asked for here.
    const nil = kind === "gstr1" ? attempt?.nil ?? false : !!opts.nil || (attempt?.nil ?? false);
    assertCanRun(kind, "otp", attempt, nil);
    let warnings: string[] = [];
    if (nil) {
      await this.assertNilAllowed(kind, !!opts.confirmNil || !!attempt?.nil);
      if (kind === "gstr3b" && attempt?.state !== "otp_requested") warnings = await this.checkPrereq("gstr3b", period);
    }
    if (!nil && kind === "gstr1" && !attempt?.chksum) throw new FilingRefusal("Fetch the GSTR-1 summary first.");
    if (!nil && kind === "gstr3b" && !attempt?.details) throw new FilingRefusal("Fetch the updated GSTR-3B details (tax payment) first.");
    const p = this.requirePan(opts.pan);
    await this.d.client.requestEvcOtp(kind === "gstr1" ? "gstr-1" : "gstr-3b", p.pan);
    const base = attempt && attempt.nil === nil ? attempt : newAttempt(kind, period, nil, "otp_requested", this.now());
    await this.put({ ...base, state: "otp_requested", otpRequestedAt: this.now(), lastError: undefined });
    return { sent: true, panMasked: mask(p.pan), panSource: p.source, nil, warnings };
  }

  // ── File ─────────────────────────────────────────────────────

  async file(kind: ReturnKind, period: string, evcOtp: string, panInput?: string) {
    const attempt = await this.load(kind, period);
    if (!attempt) throw new FilingRefusal("Request the EVC OTP first.");
    assertCanRun(kind, "file", attempt, attempt.nil);
    if (attempt.nil) await this.assertNilAllowed(kind, true);
    const p = this.requirePan(panInput);
    try {
      let res;
      if (kind === "gstr1") {
        if (attempt.nil) res = await this.d.client.fileNilGstr1(period, evcOtp, p.pan);
        else {
          if (!attempt.secSum || !attempt.chksum) throw new FilingRefusal("Fetch the GSTR-1 summary first.");
          res = await this.d.client.fileGstr1(period, evcOtp, p.pan, { secSum: attempt.secSum, chksum: attempt.chksum });
        }
      } else if (attempt.nil) {
        res = await this.d.client.fileNilGstr3b(period, evcOtp, p.pan);
      } else {
        const data = attempt.details ? pickFilingData(attempt.details) : null;
        if (!data) throw new FilingRefusal("The tax payment (tx_pmt) is missing. Fetch the updated GSTR-3B details first.");
        res = await this.d.client.fileGstr3b(period, evcOtp, p.pan, data);
      }
      await this.put({ ...attempt, state: "filed", filedRef: res.referenceId, lastError: undefined, errors: undefined });
      return { filed: true as const, referenceId: res.referenceId, nil: attempt.nil };
    } catch (err) {
      if (err instanceof GstReturnsError) {
        // Wrong or expired OTP (4xx) and portal rejections: ask for a new OTP. A lost session or a
        // transient failure leaves the step as it was; a transient one may or may not have filed.
        if (err.code !== "no_session" && !err.retryable) {
          await this.put({ ...attempt, state: "failed", lastError: err.message.slice(0, 300) });
        } else if (err.retryable) {
          await this.put({ ...attempt, lastError: err.message.slice(0, 300) });
        }
      }
      throw err;
    }
  }

  // ── GSTR-3B ──────────────────────────────────────────────────

  /** Steps 2-3: look at what the portal holds, then save. */
  async saveGstr3b(period: string) {
    const attempt = await this.load("gstr3b", period);
    assertCanRun("gstr3b", "save", attempt, false);
    const warnings = await this.checkPrereq("gstr3b", period);
    const [report, r1] = await Promise.all([this.d.gstr3bReport(), this.d.gstr1Report()]);
    let portalHasData = false;
    try {
      const existing = await this.d.client.getGstr3b(period);
      portalHasData = Object.keys(existing).length > 0;
    } catch (err) {
      // Nothing saved yet may come back as an error; a lost session must not be swallowed. VERIFY.
      if (err instanceof GstReturnsError && err.code === "no_session") throw err;
    }
    const referenceId = await this.d.client.saveGstr3b(period, gstr3bToGstn(report, this.d.gstin, period));
    const next = this.startPolling({ ...newAttempt("gstr3b", period, false, "saved", this.now()), saveRef: referenceId });
    await this.put(next);
    return { state: next.state, referenceId, portalHadData: portalHasData, reconciliation: reconcileHint(r1, report), prerequisite: GSTR3B_PREREQUISITE, warnings };
  }

  /** Step 4: ledger balances and the PROPOSED set-off. Nothing is posted. */
  async checkLedger(period: string) {
    const attempt = await this.load("gstr3b", period);
    assertCanRun("gstr3b", "ledger", attempt, false);
    const [raw, report] = await Promise.all([this.d.client.getLedgerBalances(period), this.d.gstr3bReport()]);
    const ledger = parseLedgerBalances(raw);
    if (!ledger) throw new FilingRefusal("Could not read the ledger balances from the GST portal response. Nothing was changed.", "bad_input");
    const proposal = proposeOffset({
      liability: gstr3bLiability(report),
      rcmCash: gstr3bRcmCash(report),
      itc: ledger.itc,
      cash: ledger.cash,
    });
    const next = await this.put({
      ...attempt!,
      state: "ledger_checked",
      ledger,
      proposal,
      proposalKey: proposalKey(proposal),
      errors: undefined,
    });
    return {
      state: next.state,
      ledger,
      proposal,
      proposalKey: next.proposalKey!,
      notes: [
        "Interest and late fee are not included: the app does not calculate them. Add them on the GST portal if they apply.",
        "The set-off order and the 3B mapping need a CA's review before go-live.",
      ],
    };
  }

  /** Step 5: post the set-off the user confirmed (must be exactly the proposal shown). */
  async postOffset(period: string, confirmedKey: string) {
    const attempt = await this.load("gstr3b", period);
    assertCanRun("gstr3b", "offset", attempt, false);
    if (attempt!.state === "offset_posted") return { state: attempt!.state, referenceId: attempt!.offsetRef ?? null, resumed: true };
    if (!attempt!.proposal || attempt!.proposalKey !== confirmedKey) {
      throw new FilingRefusal("The proposed tax payment changed or was not shown. Check the ledger balances again and confirm the new proposal.", "bad_input");
    }
    if (!attempt!.proposal.sufficient) {
      throw new FilingRefusal("The cash ledger does not cover the tax that credit cannot pay. Deposit the shortfall on the GST portal, then check the balances again.");
    }
    const confirmed = await this.put({ ...attempt!, state: "offset_confirmed" });
    const referenceId = await this.d.client.offsetGstr3bLiability(period, offsetBody(confirmed.proposal!));
    const next = this.startPolling({ ...confirmed, state: "offset_posted", offsetRef: referenceId });
    await this.put(next);
    return { state: next.state, referenceId, resumed: false };
  }

  /** Step 6: the portal's updated 3B data; tx_pmt is required to file. */
  async fetchDetails(period: string) {
    const attempt = await this.load("gstr3b", period);
    assertCanRun("gstr3b", "details", attempt, false);
    if (attempt!.details && attempt!.state !== "offset_validated") return { state: attempt!.state, hasTxPmt: true };
    const details = await this.d.client.getGstr3b(period);
    const data = pickFilingData(details);
    if (!data) throw new FilingRefusal("The GST portal has not returned the tax payment (tx_pmt) yet. Wait a little and try again.");
    const next = await this.put({ ...attempt!, state: "details_fetched", details: data });
    return { state: next.state, hasTxPmt: true };
  }

  // ── Helpers ──────────────────────────────────────────────────

  private requirePan(input?: string) {
    const p = this.d.pan(input);
    if (!p) throw new FilingRefusal("Enter the PAN tied to this GST registration (5 letters, 4 digits, 1 letter).", "bad_input");
    return p;
  }

  private async assertNilAllowed(kind: ReturnKind, confirmed: boolean) {
    const name = kind === "gstr1" ? "GSTR-1" : "GSTR-3B";
    if (!confirmed) {
      throw new FilingRefusal(
        kind === "gstr1"
          ? `Confirm that there were no outward supplies in ${this.d.periodLabel} to file a nil GSTR-1.`
          : `Confirm that there were no transactions in ${this.d.periodLabel} to file a nil GSTR-3B.`,
        "bad_input",
      );
    }
    const blockers = kind === "gstr1" ? await this.gstr1NilBlockers() : await this.gstr3bNilBlockers();
    if (blockers.length) throw new FilingRefusal(nilRefusal(name, this.d.periodLabel, blockers));
  }
}
