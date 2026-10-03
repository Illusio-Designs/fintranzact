import { describe, it, expect } from "vitest";
import {
  CREDIT_PARTNER_REFUSAL, attributePartnerOnAccept, decideCreditPartner, findCaPartnerByEmail,
  findCaPartnersByEmails, shouldAttributePartner, toManagedClients,
  type AttributionStore, type CaPartnerRow,
} from "../lib/partner-ca.js";

const p = (over: Partial<CaPartnerRow> = {}): CaPartnerRow => ({
  id: "p1", companyName: "Shah & Co", email: "anita@shah.in", status: "approved", partnerType: "accountant",
  createdAt: new Date("2026-01-01"), ...over,
});

function fakeStore(partnerRows: CaPartnerRow[], userRows: Array<{ email: string; emailVerified: boolean }>, tenantPartner: string | null = null) {
  const calls = { partners: 0, users: 0, set: [] as string[] };
  let current = tenantPartner;
  const store: AttributionStore = {
    async partnersByEmails(emails) { calls.partners++; return partnerRows.filter((r) => emails.includes(r.email.toLowerCase())); },
    async usersByEmails(emails) { calls.users++; return userRows.filter((u) => emails.includes(u.email.toLowerCase())); },
    async tenantPartnerId() { return current; },
    async setTenantPartnerIfNone(_t, partnerId) { if (current) return false; current = partnerId; calls.set.push(partnerId); return true; },
  };
  return { store, calls };
}
const verified = [{ email: "anita@shah.in", emailVerified: true }];

describe("findCaPartnerByEmail", () => {
  it("matches an approved accountant partner with a verified user, case-insensitively", async () => {
    const { store } = fakeStore([p()], verified);
    expect(await findCaPartnerByEmail(store, "  Anita@SHAH.in ")).toEqual({ id: "p1", companyName: "Shah & Co" });
  });
  it("ignores pending, rejected and non-accountant partners", async () => {
    for (const over of [{ status: "pending" }, { status: "rejected" }, { partnerType: "reseller" }, { partnerType: "technology" }]) {
      const { store } = fakeStore([p(over)], verified);
      expect(await findCaPartnerByEmail(store, "anita@shah.in"), JSON.stringify(over)).toBeNull();
    }
  });
  it("needs a verified user: unverified never matches; no account only when allowed (invite time)", async () => {
    expect(await findCaPartnerByEmail(fakeStore([p()], [{ email: "anita@shah.in", emailVerified: false }]).store, "anita@shah.in", { allowUnregistered: true })).toBeNull();
    expect(await findCaPartnerByEmail(fakeStore([p()], []).store, "anita@shah.in")).toBeNull();
    expect(await findCaPartnerByEmail(fakeStore([p()], []).store, "anita@shah.in", { allowUnregistered: true })).toEqual({ id: "p1", companyName: "Shah & Co" });
  });
  it("an approved record wins over a newer rejected one, and the newest approved wins", async () => {
    const { store } = fakeStore([p({ id: "old", createdAt: new Date("2025-01-01") }), p({ id: "new", createdAt: new Date("2026-06-01") }), p({ id: "rej", status: "rejected", createdAt: new Date("2026-09-01") })], verified);
    expect((await findCaPartnerByEmail(store, "anita@shah.in"))?.id).toBe("new");
  });
  it("is batched: one partner query and one user query for many e-mails", async () => {
    const { store, calls } = fakeStore([p(), p({ id: "p2", email: "b@x.in" })], [...verified, { email: "b@x.in", emailVerified: true }]);
    const m = await findCaPartnersByEmails(store, ["anita@shah.in", "B@x.in", "none@x.in", "anita@shah.in"]);
    expect([...m.keys()].sort()).toEqual(["anita@shah.in", "b@x.in"]);
    expect(calls).toMatchObject({ partners: 1, users: 1 });
    expect((await findCaPartnersByEmails(store, [])).size).toBe(0);
    expect(calls).toMatchObject({ partners: 1, users: 1 });
  });
});

describe("shouldAttributePartner", () => {
  const match = { id: "p1", companyName: "Shah & Co" };
  it("is true only when opted in, matched and the organisation has no partner", () => {
    expect(shouldAttributePartner({ creditPartner: true, partnerMatch: match, tenantPartnerId: null })).toBe(true);
  });
  it("is false for every other combination", () => {
    for (const creditPartner of [false, null, undefined]) {
      expect(shouldAttributePartner({ creditPartner, partnerMatch: match, tenantPartnerId: null })).toBe(false);
    }
    expect(shouldAttributePartner({ creditPartner: true, partnerMatch: null, tenantPartnerId: null })).toBe(false);
    expect(shouldAttributePartner({ creditPartner: true, partnerMatch: undefined, tenantPartnerId: null })).toBe(false);
    expect(shouldAttributePartner({ creditPartner: true, partnerMatch: match, tenantPartnerId: "other" })).toBe(false);
    expect(shouldAttributePartner({ creditPartner: true, partnerMatch: match, tenantPartnerId: "p1" })).toBe(false);
  });
});

describe("decideCreditPartner (invite input)", () => {
  const match = { id: "p1", companyName: "Shah & Co" };
  it("is ignored for non-CA roles, even when ticked and no partner matches", () => {
    for (const role of ["admin", "seller_manager", "seller", "accountant"]) {
      expect(decideCreditPartner({ role, creditPartner: true, partnerMatch: null })).toEqual({ ok: true, creditPartner: null });
    }
  });
  it("defaults to off for CA roles", () => {
    for (const role of ["auditor", "ca_filing"]) {
      expect(decideCreditPartner({ role, creditPartner: undefined, partnerMatch: null })).toEqual({ ok: true, creditPartner: null });
      expect(decideCreditPartner({ role, creditPartner: false, partnerMatch: match })).toEqual({ ok: true, creditPartner: null });
    }
  });
  it("is stored when ticked for an approved CA partner, refused otherwise", () => {
    expect(decideCreditPartner({ role: "auditor", creditPartner: true, partnerMatch: match })).toEqual({ ok: true, creditPartner: true });
    expect(decideCreditPartner({ role: "ca_filing", creditPartner: true, partnerMatch: null })).toEqual({ ok: false, message: CREDIT_PARTNER_REFUSAL });
  });
});

describe("attributePartnerOnAccept", () => {
  const input = { tenantId: "t1", role: "auditor", creditPartner: true as boolean | null, email: "Anita@shah.in", emailVerified: true };
  it("credits the partner once (idempotent)", async () => {
    const { store, calls } = fakeStore([p()], verified);
    expect(await attributePartnerOnAccept(store, input)).toEqual({ id: "p1", companyName: "Shah & Co" });
    expect(await attributePartnerOnAccept(store, input)).toBeNull();
    expect(calls.set).toEqual(["p1"]);
  });
  it("does nothing without the opt-in, for a non-CA role, or for an unverified accepter", async () => {
    const { store, calls } = fakeStore([p()], verified);
    expect(await attributePartnerOnAccept(store, { ...input, creditPartner: null })).toBeNull();
    expect(await attributePartnerOnAccept(store, { ...input, creditPartner: false })).toBeNull();
    expect(await attributePartnerOnAccept(store, { ...input, role: "admin" })).toBeNull();
    expect(await attributePartnerOnAccept(store, { ...input, emailVerified: false })).toBeNull();
    expect(calls.set).toEqual([]);
  });
  it("does nothing when the partner is no longer approved, or the organisation already has a partner", async () => {
    expect(await attributePartnerOnAccept(fakeStore([p({ status: "rejected" })], verified).store, input)).toBeNull();
    const taken = fakeStore([p()], verified, "other-partner");
    expect(await attributePartnerOnAccept(taken.store, input)).toBeNull();
    expect(taken.calls.set).toEqual([]);
  });
});

describe("toManagedClients", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    tenantId: "t1", name: "Sharma Traders", role: "auditor", since: new Date("2026-03-01T00:00:00Z"),
    lastOpenedAt: null as Date | null, plan: "growth", ...over,
  });
  it("keeps CA roles only and maps role label, dates and plan name", () => {
    const out = toManagedClients([
      row(),
      row({ tenantId: "t2", name: "Own firm", role: "owner" }),
      row({ tenantId: "t3", name: "Bookkeeping client", role: "accountant" }),
      row({ tenantId: "t4", name: "Gupta", role: "ca_filing", since: new Date("2026-05-01T00:00:00Z"), lastOpenedAt: new Date("2026-06-01T00:00:00Z") }),
    ], (plan) => plan.toUpperCase());
    expect(out.map((c) => c.tenantId)).toEqual(["t4", "t1"]);
    expect(out[0]).toEqual({
      tenantId: "t4", name: "Gupta", role: "ca_filing", roleLabel: "Accountant (filing)",
      since: "2026-05-01T00:00:00.000Z", lastOpenedAt: "2026-06-01T00:00:00.000Z", planName: "GROWTH",
    });
    expect(out[1]!.lastOpenedAt).toBeNull();
  });
  it("carries no financial fields", () => {
    const keys = Object.keys(toManagedClients([row()], (x) => x)[0]!).sort();
    expect(keys).toEqual(["lastOpenedAt", "name", "planName", "role", "roleLabel", "since", "tenantId"]);
  });
});
