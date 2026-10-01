import { FintranzactClient, FintranzactApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, success, outputJSON, EXIT } from "../../output.js";

interface RevokeSessionOpts {
  json?: boolean;
}

export async function revokeSessionCommand(sessionId: string, opts: RevokeSessionOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new FintranzactClient(cfg);

  try {
    const result = await client.auth.revokeSession({ sessionId });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success("Session revoked successfully.");
  } catch (e) {
    if (e instanceof FintranzactApiError) {
      const err = e.fintranzactError;
      if (err.code === "not_found") fatalError(`Session not found: ${sessionId}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: fintranzact login", EXIT.AUTH);
      if (err.code === "forbidden") fatalError(err.message, EXIT.FORBIDDEN);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
