import { describe, it, expect } from "vitest";
import { clientRow } from "../commands/tenant/clients.js";

describe("tenant clients", () => {
  it("marks pinned, shows the role and own firm vs client", () => {
    expect(clientRow({ tenantId: "t1", name: "Acme", roleLabel: "Accountant (read-only)", isOwnFirm: false, pinned: true, lastOpenedAt: null }))
      .toEqual({ name: "* Acme", role: "Accountant (read-only)", kind: "client", opened: "never", id: "t1" });
    expect(clientRow({ tenantId: "t2", name: "My Firm", roleLabel: "Owner", isOwnFirm: true, pinned: false, lastOpenedAt: "2026-10-01T10:00:00Z" }))
      .toMatchObject({ name: "My Firm", kind: "own firm" });
  });
});
