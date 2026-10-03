/**
 * The error the two-factor gate throws: a FORBIDDEN TRPCError whose `cause`
 * carries the machine-readable data. trpc.ts's errorFormatter copies it to
 * `error.data.twoFactor` (the same pattern as `error.data.entitlement`), so
 * clients branch on it without parsing the message. Free of database imports.
 */

import { TRPCError } from "@trpc/server";
import {
  TWO_FACTOR_REQUIRED_MESSAGE,
  TWO_FACTOR_REQUIRED_REASON,
  TWO_FACTOR_SETUP_PATH,
  type TwoFactorErrorData,
} from "@fintranzact/shared";

export class TwoFactorCause extends Error {
  readonly twoFactor: TwoFactorErrorData;
  constructor(message: string, twoFactor: TwoFactorErrorData) {
    super(message);
    this.name = "TwoFactorCause";
    this.twoFactor = twoFactor;
  }
}

export function twoFactorDataOf(error: unknown): TwoFactorErrorData | null {
  const cause = (error as { cause?: unknown } | null)?.cause;
  return cause instanceof TwoFactorCause ? cause.twoFactor : null;
}

export function twoFactorRequiredError(): TRPCError {
  return new TRPCError({
    code: "FORBIDDEN",
    message: TWO_FACTOR_REQUIRED_MESSAGE,
    cause: new TwoFactorCause(TWO_FACTOR_REQUIRED_MESSAGE, {
      required: true,
      reason: TWO_FACTOR_REQUIRED_REASON,
      setupPath: TWO_FACTOR_SETUP_PATH,
    }),
  });
}
