import { FintranzactClient, FintranzactApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";

import { VALID_ROLES, inviteLinkOf, inviteSuccessLine, type TenantRole } from "./roles.js";

interface InviteResult {
  token?: string;
  inviteToken?: string;
  inviteUrl?: string;
  inviteLink?: string;
  role?: string;
  message?: string;
}

interface InviteOpts {
  role?: string;
  json?: boolean;
}

export async function tenantInviteCommand(email: string, opts: InviteOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new FintranzactClient(cfg);

  const role: TenantRole = (opts.role as TenantRole) ?? "seller";

  if (!VALID_ROLES.includes(role)) {
    fatalError(`Invalid role "${role}". Must be one of: ${VALID_ROLES.join(", ")}`, EXIT.VALIDATION);
  }

  try {
    const result = await client.tenant.inviteMember({ email, role }) as InviteResult;

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(inviteSuccessLine(email, role));
    const link = inviteLinkOf(result);
    if (link) {
      console.log(`  Invite link: ${link}`);
    } else if (result.token ?? result.inviteToken) {
      console.log(`  Invite token: ${result.token ?? result.inviteToken}`);
    }
    if (result.message) {
      console.log(`  ${result.message}`);
    }

  } catch (e) {
    if (e instanceof FintranzactApiError) {
      const err = e.fintranzactError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: fintranzact login", EXIT.AUTH);
      if (err.code === "forbidden") fatalError(err.message, EXIT.FORBIDDEN);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
