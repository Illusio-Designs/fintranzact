import { WRONG_CODE_FALLBACK, mapVerifyError, shouldClearTrustedToken } from "../two-factor-login";

describe("mapVerifyError", () => {
  it("wrong code keeps the server message", () => {
    expect(mapVerifyError({ message: "That code is not right.", data: { code: "BAD_REQUEST" } })).toEqual({
      kind: "wrong",
      message: "That code is not right.",
    });
  });
  it("expired or used-up challenge goes back to the password step", () => {
    const r = mapVerifyError({ message: "This sign-in has expired. Enter your password again.", data: { code: "BAD_REQUEST" } });
    expect(r.kind).toBe("expired");
    expect(r.message).toMatch(/expired/);
  });
  it("lockout reads the unlock time", () => {
    const r = mapVerifyError({
      message: "Too many wrong codes. Try again in 15 minutes (after 2030-01-01T10:15:00.000Z).",
      data: { code: "TOO_MANY_REQUESTS" },
    });
    expect(r.kind).toBe("locked");
    expect(r.message).toMatch(/^Too many attempts\. Try again at .+\.$/);
  });
  it("lockout without a time is generic", () => {
    expect(mapVerifyError({ message: "slow down", data: { code: "TOO_MANY_REQUESTS" } }).message).toBe(
      "Too many attempts. Try again later.",
    );
  });
  it("falls back for network-ish errors with no message", () => {
    expect(mapVerifyError(null)).toEqual({ kind: "wrong", message: WRONG_CODE_FALLBACK });
    expect(mapVerifyError({ message: "" }).message).toBe(WRONG_CODE_FALLBACK);
  });
});

describe("shouldClearTrustedToken", () => {
  it("clears only when a sent token still got a challenge", () => {
    expect(shouldClearTrustedToken("tok", true)).toBe(true);
    expect(shouldClearTrustedToken("tok", false)).toBe(false);
    expect(shouldClearTrustedToken(null, true)).toBe(false);
    expect(shouldClearTrustedToken(undefined, true)).toBe(false);
  });
});
