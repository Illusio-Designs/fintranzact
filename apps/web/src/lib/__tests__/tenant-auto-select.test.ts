import { describe, it, expect } from "vitest";
import { shouldAutoSelectTenant } from "../tenant-auto-select";

const base = { signedIn: true, selectedTenantId: null, tenantCount: 1, selectPending: false, selectSucceeded: false };

describe("shouldAutoSelectTenant", () => {
  it("selects the only organisation when none is selected", () => {
    expect(shouldAutoSelectTenant(base)).toBe(true);
  });
  it("never with several organisations (the switcher shows), none, or unknown", () => {
    expect(shouldAutoSelectTenant({ ...base, tenantCount: 2 })).toBe(false);
    expect(shouldAutoSelectTenant({ ...base, tenantCount: 0 })).toBe(false);
    expect(shouldAutoSelectTenant({ ...base, tenantCount: undefined })).toBe(false);
  });
  it("not when one is already selected, signed out, or a selection is in flight / done", () => {
    expect(shouldAutoSelectTenant({ ...base, selectedTenantId: "t1" })).toBe(false);
    expect(shouldAutoSelectTenant({ ...base, signedIn: false })).toBe(false);
    expect(shouldAutoSelectTenant({ ...base, selectPending: true })).toBe(false);
    expect(shouldAutoSelectTenant({ ...base, selectSucceeded: true })).toBe(false);
  });
});
