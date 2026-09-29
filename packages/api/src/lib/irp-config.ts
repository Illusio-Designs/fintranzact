/**
 * irp-config.ts — Assemble a usable IRP credential set from a stored config row.
 *
 * WHY THIS FILE EXISTS:
 * IRP authentication needs two credential pairs that come from different
 * places:
 *   - username / password — the taxpayer's own API login, issued per GSTIN and
 *     stored (encrypted) per business in e_invoice_configs.
 *   - clientId / clientSecret — issued once to the GSP, i.e. to this
 *     deployment. Businesses set up through the wizard leave these null and
 *     the server supplies them from IRP_CLIENT_ID / IRP_CLIENT_SECRET.
 *
 * Every caller must go through here rather than handing a raw row to
 * IRPClient: rows come back encrypted, so passing one straight through
 * authenticates with ciphertext and always fails.
 */

import { TRPCError } from "@trpc/server";
import { decryptEInvoiceConfig } from "./field-encryption.js";
import type { EInvoiceConfig } from "./irp-client.js";

export function resolveIRPConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawConfig: any,
): EInvoiceConfig {
  const config = decryptEInvoiceConfig(rawConfig);

  const clientId = config.clientId || process.env.IRP_CLIENT_ID;
  const clientSecret = config.clientSecret || process.env.IRP_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "IRP GSP credentials are not configured on this server. Contact your administrator.",
    });
  }

  return { ...config, clientId, clientSecret } as EInvoiceConfig;
}
