/**
 * two-factor-router.test.ts — API-key (and anonymous) callers are rejected
 * before any database access. No database needed.
 */
import { describe, expect, it } from "vitest";
import { createCallerFactory } from "../trpc.js";
import { appRouter } from "../router.js";
import { createTestContext } from "./helpers/test-context.js";

const factory = createCallerFactory(appRouter);
const user = { id: "11111111-1111-1111-1111-111111111111", email: "a@example.in", name: "A" };

describe("two-factor procedures reject API-key auth", () => {
  // authTokenKind is null for API keys (context.ts).
  const apiKeyCaller = () => factory(createTestContext({ user, authTokenKind: null }));

  it("every procedure is refused with a clear message", async () => {
    const c = apiKeyCaller();
    const calls: Array<() => Promise<unknown>> = [
      () => c.auth.twoFactorStatus(),
      () => c.auth.twoFactorBeginSetup(),
      () => c.auth.twoFactorConfirmSetup({ code: "123456" }),
      () => c.auth.twoFactorDisable({ password: "x", code: "123456" }),
      () => c.auth.regenerateBackupCodes({ password: "x", code: "123456" }),
    ];
    for (const call of calls) {
      const err = (await call().catch((e) => e)) as { code: string; message: string };
      expect(err.code).toBe("BAD_REQUEST");
      expect(err.message).toMatch(/not with an API key/);
    }
  });

  it("anonymous callers are UNAUTHORIZED", async () => {
    const err = (await factory(createTestContext()).auth.twoFactorStatus().catch((e) => e)) as { code: string };
    expect(err.code).toBe("UNAUTHORIZED");
  });
});
