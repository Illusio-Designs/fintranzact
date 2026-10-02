import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Every form error becomes one goey toast: errors raised in the same moment
// are grouped ("Fix 3 fields"), a single one shows its own message.
const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useToast", () => ({ toast: toastMock }));

import { reportFieldError, resetFieldErrorToast } from "@/lib/field-error-toast";

describe("field error toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toastMock.mockClear();
    resetFieldErrorToast();
  });
  afterEach(() => vi.useRealTimers());

  it("shows a single field's message as the toast title", () => {
    reportFieldError("Email", "Enter a valid email address");
    vi.runAllTimers();
    expect(toastMock).toHaveBeenCalledOnce();
    expect(toastMock).toHaveBeenCalledWith({ title: "Enter a valid email address", variant: "error" });
  });

  it("groups fields that fail together into one toast naming them", () => {
    reportFieldError("Party name", "Required");
    reportFieldError("GSTIN", "Enter a valid GSTIN");
    reportFieldError("Pincode", "Enter 6 digits");
    vi.runAllTimers();
    expect(toastMock).toHaveBeenCalledOnce();
    expect(toastMock).toHaveBeenCalledWith({
      title: "Fix 3 fields",
      description: "Party name, GSTIN, Pincode",
      variant: "error",
    });
  });

  it("does not repeat the same problem reported twice in a row", () => {
    reportFieldError("PAN", "Enter a valid PAN");
    vi.runAllTimers();
    reportFieldError("PAN", "Enter a valid PAN");
    vi.runAllTimers();
    expect(toastMock).toHaveBeenCalledOnce();
  });

  it("shows a new problem on the same field", () => {
    reportFieldError("PAN", "Enter a valid PAN");
    vi.runAllTimers();
    reportFieldError("PAN", "PAN is required");
    vi.runAllTimers();
    expect(toastMock).toHaveBeenCalledTimes(2);
  });
});
