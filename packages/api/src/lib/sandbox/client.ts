/**
 * sandbox/client.ts — HTTP client for the Sandbox.co.in (Quicko) government
 * API gateway. One provider fronts GST e-invoice, e-way bill, GSTIN lookup,
 * and TDS/TCS calculators, returns and certificates.
 *
 * TWO LEVELS OF TOKEN
 *   1. API token — POST /authenticate with this deployment's key + secret
 *      (SANDBOX_API_KEY / SANDBOX_API_SECRET). Valid 24 h. Sent as the raw
 *      `authorization` header (no "Bearer"), with `x-api-key`.
 *   2. Portal session — e-invoice and e-way bill calls need the taxpayer's own
 *      portal API login (username / password / GSTIN) exchanged for a portal
 *      access token, which then replaces `authorization` on those calls.
 *      Those credentials are stored per business, encrypted
 *      (e_invoice_configs / eway_bill_configs); this client never persists
 *      anything — tokens live in memory only and are re-fetched after a restart.
 *
 * Environment (docs: https://developer.sandbox.co.in):
 *   test keys (key_test_…) -> https://test-api.sandbox.co.in
 *   live keys (key_live_…) -> https://api.sandbox.co.in
 *   SANDBOX_BASE_URL overrides the host (self-hosted proxies, tests).
 */

import { createHash } from "node:crypto";
import { logger } from "../logger.js";
import { noteSandboxFundingFailure, trackSandboxCall } from "../gov-usage.js";

export const SANDBOX_TEST_URL = "https://test-api.sandbox.co.in";
export const SANDBOX_LIVE_URL = "https://api.sandbox.co.in";

/** Refresh this long before the real expiry so a token never dies mid-request. */
const EXPIRY_SKEW_MS = 10 * 60 * 1000;
/** Documented API token lifetime. */
const API_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface SandboxConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  /** x-api-version header; the gateway defaults to 1.0.0 when omitted. */
  apiVersion?: string;
  timeoutMs?: number;
}

export type PortalKind = "e-invoice" | "e-way-bill";

export interface PortalCredentials {
  gstin: string;
  username: string;
  password: string;
}

/** Error from the gateway or the network. `isRetryable` drives caller retry/queue logic. */
export class SandboxError extends Error {
  constructor(
    message: string,
    /** Gateway/portal error code ("422", "2150", "network", "timeout", …). */
    public readonly code: string,
    public readonly httpStatus?: number,
    public readonly transactionId?: string,
    /** Raw response body for audit/debug — never shown to end users unredacted. */
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "SandboxError";
  }

  get isRetryable(): boolean {
    return (
      this.code === "network" ||
      this.code === "timeout" ||
      this.httpStatus === 429 ||
      (this.httpStatus !== undefined && this.httpStatus >= 500)
    );
  }
}

/**
 * Read the deployment's Sandbox credentials from the environment.
 * Returns null when not configured so callers can fall back / report cleanly.
 */
export function sandboxConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SandboxConfig | null {
  const apiKey = env.SANDBOX_API_KEY?.trim();
  const apiSecret = env.SANDBOX_API_SECRET?.trim();
  if (!apiKey || !apiSecret) return null;

  const baseUrl = (
    env.SANDBOX_BASE_URL?.trim() ||
    (apiKey.startsWith("key_live_") ? SANDBOX_LIVE_URL : SANDBOX_TEST_URL)
  ).replace(/\/+$/, "");

  return {
    apiKey,
    apiSecret,
    baseUrl,
    apiVersion: env.SANDBOX_API_VERSION?.trim() || undefined,
  };
}

interface CachedToken {
  token: string;
  /** Epoch ms after which the token must be replaced (skew already applied). */
  refreshAt: number;
}

export interface SandboxRequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Extra headers (e.g. x-source, x-accept-cache). */
  headers?: Record<string, string>;
  /** Overrides `authorization` — used for portal-session calls. */
  authToken?: string;
  /** Per-call timeout; defaults to the client's configured timeout. */
  timeoutMs?: number;
}

export interface SandboxEnvelope<T> {
  code: number;
  timestamp?: number;
  transaction_id?: string;
  data: T;
}

export class SandboxClient {
  private apiToken: CachedToken | null = null;
  private apiTokenInflight: Promise<string> | null = null;
  private readonly portalTokens = new Map<string, CachedToken>();
  private readonly portalInflight = new Map<string, Promise<string>>();

  constructor(
    private readonly config: SandboxConfig,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    private readonly now: () => number = Date.now,
    /** Count calls and raise quota/wallet alerts. Off in unit tests that mock fetch. */
    private readonly meter: boolean = false,
  ) {}

  get isLive(): boolean {
    return this.config.baseUrl === SANDBOX_LIVE_URL;
  }

  // ── API token (key + secret) ─────────────────────────────────

  /** Returns a valid API token, authenticating at most once at a time. */
  async getApiToken(): Promise<string> {
    if (this.apiToken && this.apiToken.refreshAt > this.now()) return this.apiToken.token;
    if (this.apiTokenInflight) return this.apiTokenInflight;

    this.apiTokenInflight = (async () => {
      const res = await this.send<{ access_token?: string }>("POST", "/authenticate", {
        headers: { "x-api-secret": this.config.apiSecret },
        authToken: null,
      });
      const token = res.data?.access_token;
      if (!token) {
        throw new SandboxError("Sandbox authentication returned no access token", "auth", 200, res.transaction_id, res);
      }
      this.apiToken = { token, refreshAt: this.now() + API_TOKEN_TTL_MS - EXPIRY_SKEW_MS };
      return token;
    })().finally(() => {
      this.apiTokenInflight = null;
    });
    return this.apiTokenInflight;
  }

  invalidateApiToken(): void {
    this.apiToken = null;
  }

  // ── Portal sessions (e-invoice / e-way bill) ──────────────────

  /**
   * Exchange a business's portal API login for a portal access token.
   * Cached per kind+GSTIN until just before the portal's own expiry.
   * Portal-level login failures arrive as HTTP 200 with Status 0 — they are
   * thrown here as non-retryable SandboxErrors carrying the portal code.
   */
  async getPortalToken(kind: PortalKind, creds: PortalCredentials): Promise<string> {
    const key = portalKey(kind, creds);
    const cached = this.portalTokens.get(key);
    if (cached && cached.refreshAt > this.now()) return cached.token;
    const inflight = this.portalInflight.get(key);
    if (inflight) return inflight;

    const p = (async () => {
      const res = await this.request<PortalAuthData>(
        "POST",
        `/gst/compliance/${kind}/tax-payer/authenticate`,
        { body: { username: creds.username, password: creds.password, gstin: creds.gstin } },
      );
      const d = res.data;
      const ok = d && (d.Status === 1 || d.status === "1") && d.access_token;
      if (!ok) {
        const code = portalErrorCode(d);
        throw new SandboxError(
          `${kind === "e-invoice" ? "E-invoice" : "E-way bill"} portal login failed${code ? ` (${code})` : ""}`,
          code ?? "portal_auth",
          200,
          res.transaction_id,
          res,
        );
      }
      const expiry = typeof d.expiry === "number" ? d.expiry : this.now() + 6 * 60 * 60 * 1000;
      this.portalTokens.set(key, { token: d.access_token as string, refreshAt: expiry - EXPIRY_SKEW_MS });
      return d.access_token as string;
    })().finally(() => {
      this.portalInflight.delete(key);
    });
    this.portalInflight.set(key, p);
    return p;
  }

  invalidatePortalToken(kind: PortalKind, creds: PortalCredentials): void {
    this.portalTokens.delete(portalKey(kind, creds));
  }

  // ── Requests ─────────────────────────────────────────────────

  /**
   * Authenticated request. Retries once with a fresh API token on 401/403
   * (e.g. a token revoked or expired early).
   */
  async request<T = unknown>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    opts: SandboxRequestOptions = {},
  ): Promise<SandboxEnvelope<T>> {
    const run = async () => {
      const authToken = opts.authToken ?? (await this.getApiToken());
      return this.send<T>(method, path, { ...opts, authToken });
    };
    try {
      return await run();
    } catch (err) {
      const stale = err instanceof SandboxError && (err.httpStatus === 401 || err.httpStatus === 403);
      if (stale && !opts.authToken) {
        this.invalidateApiToken();
        return run();
      }
      throw err;
    }
  }

  /** A request made on behalf of a business's portal session. */
  async portalRequest<T = unknown>(
    kind: PortalKind,
    creds: PortalCredentials,
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    opts: Omit<SandboxRequestOptions, "authToken"> = {},
  ): Promise<SandboxEnvelope<T>> {
    const run = async () => {
      const authToken = await this.getPortalToken(kind, creds);
      return this.request<T>(method, path, { ...opts, authToken });
    };
    try {
      return await run();
    } catch (err) {
      if (err instanceof SandboxError && (err.httpStatus === 401 || err.httpStatus === 403)) {
        this.invalidatePortalToken(kind, creds);
        return run();
      }
      throw err;
    }
  }

  /**
   * Low-level call. `authToken: null` omits the authorization header (used by
   * /authenticate itself).
   */
  private async send<T>(
    method: string,
    path: string,
    opts: Omit<SandboxRequestOptions, "authToken"> & { authToken?: string | null },
  ): Promise<SandboxEnvelope<T>> {
    const url = new URL(this.config.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    // URLSearchParams writes a space as "+"; the gateway's docs show %20 (e.g. financial_year=FY 2025-26).
    url.search = url.search.replace(/\+/g, "%20");

    const headers: Record<string, string> = {
      "x-api-key": this.config.apiKey,
      accept: "application/json",
      ...opts.headers,
    };
    if (this.config.apiVersion) headers["x-api-version"] = this.config.apiVersion;
    if (opts.authToken) headers.authorization = opts.authToken;
    if (opts.body !== undefined) headers["content-type"] = "application/json";

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new SandboxError(
        timedOut ? "Sandbox request timed out" : `Sandbox request failed: ${(err as Error).message}`,
        timedOut ? "timeout" : "network",
      );
    }

    let json: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }

    if (!res.ok) {
      const obj = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
      const message = typeof obj.message === "string" ? obj.message : `Sandbox returned HTTP ${res.status}`;
      logger.warn({ path, status: res.status, tx: obj.transaction_id }, "Sandbox request failed");
      if (this.meter) void noteSandboxFundingFailure(res.status, message);
      throw new SandboxError(
        message,
        String(obj.code ?? res.status),
        res.status,
        typeof obj.transaction_id === "string" ? obj.transaction_id : undefined,
        json,
      );
    }
    // Only 2xx calls count against Sandbox's monthly plan.
    if (this.meter && path !== "/authenticate") void trackSandboxCall();
    return json as SandboxEnvelope<T>;
  }
}

interface PortalAuthData {
  Status?: number;
  status?: string;
  access_token?: string;
  expiry?: number;
  error?: { errorCodes?: string };
  ErrorDetails?: Array<{ ErrorCode?: string; ErrorMessage?: string }> | null;
}

/** Cache key; the password is hashed in so a changed login re-authenticates. */
function portalKey(kind: PortalKind, c: PortalCredentials): string {
  const fp = createHash("sha256").update(`${c.username}:${c.password}`).digest("hex").slice(0, 16);
  return `${kind}:${c.gstin}:${fp}`;
}

function portalErrorCode(d: PortalAuthData | undefined): string | undefined {
  return d?.error?.errorCodes ?? d?.ErrorDetails?.[0]?.ErrorCode;
}

// ── Process-wide instance ────────────────────────────────────────

let shared: SandboxClient | null | undefined;

/** The deployment's shared client, or null when SANDBOX_API_KEY/SECRET are not set. */
export function getSandboxClient(): SandboxClient | null {
  if (shared === undefined) {
    const cfg = sandboxConfigFromEnv();
    shared = cfg ? new SandboxClient(cfg, undefined, undefined, process.env.NODE_ENV !== "test") : null;
  }
  return shared;
}

/** Test hook: drop the cached instance so env changes take effect. */
export function resetSandboxClientForTests(): void {
  shared = undefined;
}
