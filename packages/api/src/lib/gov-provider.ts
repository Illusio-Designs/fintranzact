/**
 * gov-provider.ts — chooses how this deployment talks to government portals.
 *
 * With SANDBOX_API_KEY / SANDBOX_API_SECRET set, e-invoice and e-way bill go through
 * Sandbox.co.in (no NIC GSP credentials or RSA handshake needed). Without
 * them the direct NIC IRP client is used, as before. GOV_API_PROVIDER=direct
 * forces the direct client even when Sandbox keys exist (rollback switch);
 * GOV_API_PROVIDER=sandbox forces Sandbox.
 *
 * Under NODE_ENV=test the keys alone never select Sandbox: a developer's real
 * .env keys get re-loaded by other modules and would send test traffic to the
 * live gateway. Tests opt in with GOV_API_PROVIDER=sandbox.
 *
 * Callers should build clients here instead of `new IRPClient(...)`.
 */

import type { TenantDatabase } from "../trpc.js";
import { IRPClient, type EInvoiceConfig } from "./irp-client.js";
import { EWBClient, type EWBConfig } from "./ewb-client.js";
import { getSandboxClient } from "./sandbox/client.js";
import { SandboxIRPClient } from "./sandbox/e-invoice.js";
import { SandboxEWBClient } from "./sandbox/e-way-bill.js";

/** The methods routers use; satisfied by both IRPClient and SandboxIRPClient. */
export type IRPClientLike = Pick<
  IRPClient,
  "authenticate" | "generateIRN" | "cancelIRN" | "getGstinDetails" | "getIRNDetails"
>;

/** E-way bill client surface shared by EWBClient and SandboxEWBClient. */
export type EWBClientLike = Pick<
  EWBClient,
  "generateEWB" | "cancelEWB" | "updateVehicle" | "extendValidity" | "getEWBDetails"
> & { config: { gstin: string } };

export function useSandboxProvider(): boolean {
  const forced = process.env.GOV_API_PROVIDER;
  if (forced === "direct") return false;
  if (forced !== "sandbox" && process.env.NODE_ENV === "test") return false;
  return getSandboxClient() !== null;
}

export function createIRPClient(config: EInvoiceConfig, db: TenantDatabase): IRPClientLike {
  const sandbox = useSandboxProvider() ? getSandboxClient() : null;
  if (sandbox) {
    return new SandboxIRPClient(sandbox, {
      gstin: config.gstin,
      username: config.username,
      password: config.password,
    });
  }
  return new IRPClient(config, db);
}

/**
 * `direct` is the NIC config (needs GSP client id/secret). Through Sandbox only
 * the taxpayer's portal login is needed, so those two are ignored.
 */
export function createEWBClient(config: EWBConfig): EWBClientLike {
  const sandbox = useSandboxProvider() ? getSandboxClient() : null;
  if (sandbox) {
    return new SandboxEWBClient(sandbox, {
      username: config.username,
      password: config.password,
      gstin: config.gstin,
    });
  }
  return new EWBClient(config);
}
