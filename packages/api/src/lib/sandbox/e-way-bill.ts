/**
 * sandbox/e-way-bill.ts — e-way bill via Sandbox.co.in.
 *
 * Same method surface as the direct NIC `EWBClient` (every method takes the
 * businessId first and the router sets `config.gstin` per call), so the
 * router can use either through createEWBClient(). The gateway handles the
 * NIC encryption; we send the plain e-way bill JSON that invoice-to-ewb.ts
 * already builds.
 *
 * Sandbox returns portal-level failures as HTTP 200 with `data.status: "0"`
 * and `data.error.errorCodes`; those are thrown as EWBApiError.
 */

import type {
  EWBCancelResponse,
  EWBGenerateResponse,
  EWBVehicleUpdateResponse,
  GenerateEWBPayload,
} from "../ewb-client.js";
import { SandboxClient, SandboxError, type PortalCredentials } from "./client.js";

const BASE = "/gst/compliance/e-way-bill";

interface EWBEnvelope<T> {
  status?: string | number;
  data?: T | null;
  error?: { errorCodes?: string; message?: string };
  alert?: string | null;
  info?: string | null;
}

/** NIC / gateway failure. `code` is the NIC error code(s) or a gateway code. */
export class EWBApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly isRetryable = false,
  ) {
    super(message);
    this.name = "EWBApiError";
  }
}

function unwrap<T>(env: EWBEnvelope<T> | undefined, what: string): T {
  const ok = env && (env.status === "1" || env.status === 1);
  if (!ok || !env?.data) {
    const code = env?.error?.errorCodes ?? "UNKNOWN";
    const detail = env?.error?.message ?? env?.info ?? "";
    throw new EWBApiError(`EWB ${what} failed${detail ? `: ${detail}` : ""} [${code}]`, code);
  }
  return env.data;
}

function toApiError(err: unknown, what: string): Error {
  if (err instanceof EWBApiError) return err;
  if (err instanceof SandboxError) {
    return new EWBApiError(`EWB ${what} failed: ${err.message}`, err.code, err.isRetryable);
  }
  return err instanceof Error ? err : new Error(`EWB ${what} failed`);
}

/**
 * The NIC reasons are 1 Duplicate, 2 Order cancelled, 3 Data entry mistake,
 * 4 Others. Free text (older callers pass the remark as the "reason") maps to
 * 4 with the text as the remark.
 */
export function ewbCancelReason(reason: string): { code: number; remarks: string } {
  const trimmed = reason.trim();
  if (/^[1-4]$/.test(trimmed)) return { code: Number(trimmed), remarks: "" };
  return { code: 4, remarks: trimmed.slice(0, 100) };
}

export interface SandboxEWBConfig {
  username: string;
  password: string;
  /** Mutable: the router sets this to the business GSTIN before each call. */
  gstin: string;
}

export class SandboxEWBClient {
  public config: SandboxEWBConfig;

  constructor(
    private readonly sandbox: SandboxClient,
    config: SandboxEWBConfig,
  ) {
    this.config = config;
  }

  private get creds(): PortalCredentials {
    return { gstin: this.config.gstin, username: this.config.username, password: this.config.password };
  }

  private async call<T>(
    what: string,
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: unknown,
  ): Promise<T> {
    try {
      const res = await this.sandbox.portalRequest<EWBEnvelope<T>>("e-way-bill", this.creds, method, path, { body });
      return unwrap(res.data, what);
    } catch (err) {
      throw toApiError(err, what);
    }
  }

  async authenticate(): Promise<void> {
    try {
      await this.sandbox.getPortalToken("e-way-bill", this.creds);
    } catch (err) {
      throw toApiError(err, "login");
    }
  }

  async generateEWB(_businessId: string, payload: GenerateEWBPayload): Promise<EWBGenerateResponse> {
    const d = await this.call<{ ewayBillNo: string | number; ewayBillDate: string; validUpto: string }>(
      "generate",
      "POST",
      `${BASE}/consignor/bill`,
      payload,
    );
    return { ewayBillNo: String(d.ewayBillNo), ewayBillDate: d.ewayBillDate, validUpto: d.validUpto };
  }

  async cancelEWB(_businessId: string, ewbNo: string, reason: string): Promise<EWBCancelResponse> {
    const { code, remarks } = ewbCancelReason(reason);
    const d = await this.call<{ ewayBillNo: string | number; cancelDate: string }>(
      "cancel",
      "POST",
      `${BASE}/consignor/bill/${encodeURIComponent(ewbNo)}/cancel`,
      { ewbNo: Number(ewbNo), cancelRsnCode: code, cancelRmrk: remarks },
    );
    return { ewayBillNo: String(d.ewayBillNo), cancelDate: d.cancelDate };
  }

  async updateVehicle(
    _businessId: string,
    ewbNo: string,
    vehicleNo: string,
    fromPlace: string,
    fromState: number,
    reason: string,
    vehicleType = "R",
  ): Promise<EWBVehicleUpdateResponse> {
    const d = await this.call<{ validUpto: string; vehUpdDate: string }>(
      "vehicle update",
      "PUT",
      `${BASE}/consignor/bill/${encodeURIComponent(ewbNo)}/vehicle`,
      {
        ewbNo: Number(ewbNo),
        vehicleNo,
        vehicleType,
        fromPlace: fromPlace.slice(0, 50),
        fromState,
        // NIC reason codes are one character: 1 breakdown, 2 transshipment, 3 others, 4 first time.
        reasonCode: /^[1-4]$/.test(reason) ? reason : "3",
        reasonRem: (/^[1-4]$/.test(reason) ? "" : reason).slice(0, 50) || "Vehicle updated",
        transMode: "1",
      },
    );
    return { ewayBillNo: ewbNo, transUpdateDate: d.vehUpdDate, validUpto: d.validUpto };
  }

  async extendValidity(
    _businessId: string,
    ewbNo: string,
    vehicleNo: string,
    fromPlace: string,
    fromStateCode: number,
    fromPincode: number,
    remainingDistance: number,
  ): Promise<{ ewayBillNo: string; validUpto: string }> {
    const d = await this.call<{ ewayBillNo: string | number; validUpto: string }>(
      "extend validity",
      "POST",
      `${BASE}/consignor/bill/${encodeURIComponent(ewbNo)}/extend`,
      {
        ewbNo: Number(ewbNo),
        vehicleNo,
        fromPlace: fromPlace.slice(0, 50),
        fromState: fromStateCode,
        fromPincode,
        remainingDistance,
        transMode: "1",
        extnRsnCode: 5, // Others
        extnRemarks: "Validity extension requested",
      },
    );
    return { ewayBillNo: String(d.ewayBillNo), validUpto: d.validUpto };
  }

  async getEWBDetails(_businessId: string, ewbNo: string): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>("lookup", "GET", `${BASE}/tax-payer/bill/${encodeURIComponent(ewbNo)}`);
  }
}
