/**
 * A GST portal session that ends (6 hours) is reported by the API as UNAUTHORIZED on a
 * gstReturns.* procedure. It must NOT sign the person out of Fintranzact: the filing
 * wizard asks for a new portal OTP instead. A real app sign-out (any other procedure, or the
 * portal sign-in calls themselves) still goes to the login page.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { queryClient } from "../trpc";

const mutationError = (path: string) => ({ data: { code: "UNAUTHORIZED", path }, message: "no" });
const onError = (path: string) => {
  const handler = queryClient.getDefaultOptions().mutations?.onError as unknown as (e: unknown) => void;
  handler(mutationError(path));
};

describe("UNAUTHORIZED handling", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/gst");
    sessionStorage.clear();
  });

  it("a lost GST portal session does not log the person out", () => {
    onError("gstReturns.fileGstr1");
    onError("gstReturns.pollReturnStatus");
    expect(sessionStorage.getItem("sessionExpired")).toBeNull();
  });

  it("an app session that ended still goes to the login page", () => {
    // jsdom cannot navigate: it reports "not implemented" on the console
    vi.spyOn(console, "error").mockImplementation(() => {});
    onError("invoice.list");
    expect(sessionStorage.getItem("sessionExpired")).toBe("1");
  });
});
