import { FintranzactClient, FintranzactApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, success, EXIT } from "../../output.js";

export async function revokeAllSessionsCommand(): Promise<void> {
  const cfg = requireAuth();
  const client = new FintranzactClient(cfg);

  try {
    await client.auth.logoutAll();
    success("Signed out from all devices.");
  } catch (e) {
    if (e instanceof FintranzactApiError) {
      const err = e.fintranzactError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: fintranzact login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
