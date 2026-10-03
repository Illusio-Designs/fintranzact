import { describe, it, expect } from "vitest";
import { audited, withActorRole } from "../lib/audit.js";

function fakeDb() {
  const rows: Array<Record<string, unknown>> = [];
  const db = { insert: () => ({ values: async (v: Record<string, unknown>) => { rows.push(v); } }) };
  return { db: db as never, rows };
}

describe("withActorRole", () => {
  it("adds the role for CA roles only", () => {
    expect(withActorRole({ period: "2026-08" }, "ca_filing")).toEqual({ period: "2026-08", role: "ca_filing" });
    expect(withActorRole(undefined, "auditor")).toEqual({ role: "auditor" });
    expect(withActorRole({ a: 1 }, "owner")).toEqual({ a: 1 });
    expect(withActorRole(undefined, "accountant")).toBeUndefined();
    expect(withActorRole({ a: 1 }, undefined)).toEqual({ a: 1 });
  });
  it("never replaces an entry's own role field", () => {
    expect(withActorRole({ role: "admin" }, "ca_filing")).toEqual({ role: "admin" });
  });
});

describe("audited records the actor's role", () => {
  it("CA filing entry carries metadata.role and never an OTP", async () => {
    const { db, rows } = fakeDb();
    await audited(
      { db, businessId: "b", user: { id: "u" }, role: "ca_filing", ipAddress: null },
      async () => ({ period: "2026-08", referenceId: "REF1" }),
      (r) => ({ action: "gstReturns.fileGstr1", entityType: "gst_return", metadata: { period: r.period, referenceId: r.referenceId } }),
    );
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.metadata as string)).toEqual({ period: "2026-08", referenceId: "REF1", role: "ca_filing" });
    expect(rows[0]!.action).toBe("gstReturns.fileGstr1");
    expect(String(rows[0]!.metadata)).not.toMatch(/otp|evc|pan/i);
  });
  it("other roles are recorded as before", async () => {
    const { db, rows } = fakeDb();
    await audited({ db, businessId: "b", user: { id: "u" }, role: "admin" }, async () => 1, () => ({ action: "x.y", entityType: "x", metadata: { a: 1 } }));
    expect(JSON.parse(rows[0]!.metadata as string)).toEqual({ a: 1 });
  });
  it("nothing is logged when the mutation throws", async () => {
    const { db, rows } = fakeDb();
    await expect(audited({ db, businessId: "b", user: { id: "u" }, role: "ca_filing" }, async () => { throw new Error("no"); }, () => ({ action: "a", entityType: "b" }))).rejects.toThrow();
    expect(rows).toHaveLength(0);
  });
});
