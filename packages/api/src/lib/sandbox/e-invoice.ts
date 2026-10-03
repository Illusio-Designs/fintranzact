/**
 * sandbox/e-invoice.ts — e-invoice (IRP) via Sandbox.co.in.
 *
 * Exposes the same method surface as the direct NIC `IRPClient` so the
 * routers can use either through createIRPClient(). Sandbox terminates the
 * NIC RSA/AES handshake for us: we send the plain IRP v1.1 JSON that
 * invoice-to-irp.ts already builds and get the IRP response back.
 *
 * Failures are re-thrown as IRPError so existing router handling
 * (retryable vs permanent, message shown to the user) is unchanged.
 */

import { IRPError, type IRPGenerateIRNResponse, type IRPGstinDetails, type IRPInvoiceJson } from "../irp-client.js";
import { SandboxClient, SandboxError, SandboxFundingError, type PortalCredentials } from "./client.js";
import { fundingFrom } from "./funding.js";

const BASE = "/gst/compliance/e-invoice/tax-payer";

interface IRPEnvelope<T> {
  Status?: number | string;
  Data?: T | null;
  ErrorDetails?: Array<{ ErrorCode?: string; ErrorMessage?: string }> | null;
  /** Some "get" responses flatten the error. */
  ErrorCode?: string;
  ErrorMessage?: string;
}

type IRNData = NonNullable<IRPGenerateIRNResponse["Data"]>;

/** "YYYY-MM-DD HH:MM:SS" (IST) or "DD/MM/YYYY HH:MM:SS" (IST) → Date. */
export function parseIrpDateTime(s: string | null | undefined): Date {
  if (!s) return new Date();
  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (iso) return new Date(`${iso[1]}-${iso[2]}-${iso[3]}T${iso[4]}:${iso[5]}:${iso[6]}+05:30`);
  const nic = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (nic) return new Date(`${nic[3]}-${nic[2]}-${nic[1]}T${nic[4]}:${nic[5]}:${nic[6]}+05:30`);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** Wrap gateway/network failures as IRPError (retryable -> "RETRYABLE"). */
function toIRPError(err: unknown): IRPError {
  if (err instanceof IRPError) return err;
  if (err instanceof SandboxFundingError) {
    // Customer-safe message; Sandbox's raw wording stays in `cause`. RETRYABLE keeps the invoice pending.
    return fundingFrom(new IRPError(err.customerMessage, "RETRYABLE", err.httpStatus), err);
  }
  if (err instanceof SandboxError) {
    return new IRPError(err.message, err.isRetryable ? "RETRYABLE" : err.code, err.httpStatus);
  }
  return new IRPError(err instanceof Error ? err.message : "Sandbox request failed", "UNKNOWN");
}

function unwrap<T>(envelope: IRPEnvelope<T> | undefined, what: string): T {
  const ok = envelope && (envelope.Status === 1 || envelope.Status === "1");
  if (!ok || !envelope?.Data) {
    const first = envelope?.ErrorDetails?.[0];
    const code = first?.ErrorCode ?? envelope?.ErrorCode ?? "UNKNOWN";
    const message = first?.ErrorMessage ?? envelope?.ErrorMessage ?? `IRP rejected ${what}`;
    throw new IRPError(message, code);
  }
  return envelope.Data;
}

export interface SandboxEInvoiceConfig {
  gstin: string;
  username: string;
  password: string;
}

export class SandboxIRPClient {
  private readonly creds: PortalCredentials;

  constructor(
    private readonly sandbox: SandboxClient,
    config: SandboxEInvoiceConfig,
  ) {
    this.creds = { gstin: config.gstin, username: config.username, password: config.password };
  }

  /** Verifies the business's IRP API login (used by "Test connection"). */
  async authenticate(): Promise<void> {
    try {
      await this.sandbox.getPortalToken("e-invoice", this.creds);
    } catch (err) {
      throw toIRPError(err);
    }
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<IRPEnvelope<T>> {
    try {
      const res = await this.sandbox.portalRequest<IRPEnvelope<T>>("e-invoice", this.creds, method, path, { body });
      return res.data;
    } catch (err) {
      throw toIRPError(err);
    }
  }

  async generateIRN(invoiceJson: IRPInvoiceJson): Promise<{
    irn: string;
    ackNo: string;
    ackDt: Date;
    signedQrCode: string;
    signedInvoice: string;
  }> {
    const data = unwrap(await this.call<IRNData>("POST", `${BASE}/invoice`, invoiceJson), "the invoice");
    return {
      irn: data.Irn,
      ackNo: String(data.AckNo),
      ackDt: parseIrpDateTime(data.AckDt),
      signedQrCode: data.SignedQRCode,
      signedInvoice: data.SignedInvoice,
    };
  }

  async cancelIRN(irn: string, reason: string, remarks?: string): Promise<{ irn: string; cancelDate: Date }> {
    const data = unwrap(
      await this.call<{ Irn: string; CancelDate: string }>(
        "POST",
        `${BASE}/invoice/${encodeURIComponent(irn)}/cancel`,
        { Irn: irn, CnlRsn: reason, CnlRem: remarks ?? "" },
      ),
      "the cancellation",
    );
    return { irn: data.Irn, cancelDate: parseIrpDateTime(data.CancelDate) };
  }

  /** Only e-invoices generated in the last 2 days can be fetched (IRP rule). */
  async getIRNDetails(irn: string): Promise<IRPGenerateIRNResponse["Data"]> {
    return unwrap(await this.call<IRNData>("GET", `${BASE}/invoice/${encodeURIComponent(irn)}`), "the IRN lookup");
  }

  /**
   * GSTIN details via the gateway's public GSTIN search (no portal login
   * needed), mapped to the shape the IRP master API returned.
   */
  async getGstinDetails(gstin: string): Promise<IRPGstinDetails> {
    let body: GstinSearchResponse | undefined;
    try {
      const res = await this.sandbox.request<GstinSearchResponse>("POST", "/gst/compliance/public/gstin/search", {
        body: { gstin },
      });
      body = res.data;
    } catch (err) {
      throw toIRPError(err);
    }
    const g = body?.data;
    if (!g) throw new IRPError("GSTIN details not found", "NOT_FOUND");
    return mapGstinSearch(gstin, g);
  }
}

// ── GSTIN search mapping (public GSTN payload → IRP master shape) ─

interface GstnAddress {
  bnm?: string;
  bno?: string;
  flno?: string;
  st?: string;
  loc?: string;
  pncd?: string | number;
  stcd?: string;
}
interface GstinSearchPayload {
  gstin?: string;
  lgnm?: string;
  tradeNam?: string;
  dty?: string;
  sts?: string;
  rgdt?: string;
  cxdt?: string;
  pradr?: { addr?: GstnAddress };
}
interface GstinSearchResponse {
  data?: GstinSearchPayload;
}

const GSTN_STATUS_TO_IRP: Record<string, string> = {
  active: "ACT",
  cancelled: "CNL",
  inactive: "INA",
  suspended: "SUS",
  provisional: "PRO",
};
const GSTN_TYPE_TO_IRP: Record<string, string> = {
  regular: "REG",
  composition: "COM",
  "special economic zone": "SEZ",
  "sez unit": "SEZ",
  "sez developer": "SEZ",
};

export function mapGstinSearch(requested: string, g: GstinSearchPayload): IRPGstinDetails {
  const a = g.pradr?.addr ?? {};
  const status = g.sts?.toLowerCase() ?? "";
  const type = g.dty?.toLowerCase() ?? "";
  return {
    Gstin: g.gstin ?? requested,
    TradeName: g.tradeNam ?? null,
    LegalName: g.lgnm ?? null,
    AddrBnm: a.bnm ?? null,
    AddrBno: a.bno ?? null,
    AddrFlno: a.flno ?? null,
    AddrSt: a.st ?? null,
    AddrLoc: a.loc ?? null,
    // The first two GSTIN digits are the state code; the payload's stcd is a state *name*.
    StateCode: (g.gstin ?? requested).slice(0, 2),
    AddrPncd: a.pncd ?? null,
    TxpType: GSTN_TYPE_TO_IRP[type] ?? g.dty ?? null,
    Status: GSTN_STATUS_TO_IRP[status] ?? g.sts ?? null,
    // The public search carries no blocked flag; "U" = not blocked.
    BlkStatus: "U",
    DtReg: g.rgdt ?? null,
    DtDReg: g.cxdt ?? null,
  };
}
