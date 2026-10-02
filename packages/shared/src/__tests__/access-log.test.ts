import { describe, it, expect } from "vitest";
import {
  ACCESS_EVENT_TYPES,
  ACCESS_LOG_FILTERS,
  SECURITY_EVENT_LABELS,
  SECURITY_EVENT_TYPES,
  accessEventSentence,
  exportLabel,
  lastOpenedText,
  type AccessLogItem,
} from "../index.js";

const person = (id: string, name: string | null, email = `${id}@x.in`) => ({ id, name, email });
const item = (type: string, over: Partial<AccessLogItem> = {}): AccessLogItem => ({
  id: "e1",
  type,
  label: SECURITY_EVENT_LABELS[type as keyof typeof SECURITY_EVENT_LABELS] ?? type,
  createdAt: "2026-10-01T10:00:00.000Z",
  actor: person("owner", "Ravi"),
  subject: null,
  metadata: {},
  ...over,
});

describe("access event types", () => {
  it("every access.* security event is in the log's list, and labelled", () => {
    const access = SECURITY_EVENT_TYPES.filter((t) => t.startsWith("access."));
    expect([...ACCESS_EVENT_TYPES].sort()).toEqual([...access].sort());
    for (const t of ACCESS_EVENT_TYPES) expect(SECURITY_EVENT_LABELS[t]).toBeTruthy();
  });
  it("keeps the original 13 and adds eight", () => {
    expect(SECURITY_EVENT_TYPES).toHaveLength(21);
    for (const t of ["access.invited", "access.invite_revoked", "access.accepted", "access.role_changed", "access.org_opened", "access.export", "access.left", "access.partner_attributed"]) {
      expect(SECURITY_EVENT_TYPES).toContain(t);
    }
  });
  it("filters cover every type once, 'All' has none", () => {
    expect(ACCESS_LOG_FILTERS[0]).toMatchObject({ key: "all", types: null });
    const covered = ACCESS_LOG_FILTERS.flatMap((f) => [...(f.types ?? [])]);
    expect([...covered].sort()).toEqual([...ACCESS_EVENT_TYPES].sort());
  });
});

describe("accessEventSentence", () => {
  it("left: the person who left is the subject, the CA tag shows", () => {
    expect(accessEventSentence(item("access.left", { subject: person("ca", "Anita"), actor: person("ca", "Anita"), metadata: { role: "auditor" } }), "owner")).toBe("Anita (CA) left the organisation");
    expect(accessEventSentence(item("access.left", { subject: person("ca", "Anita"), metadata: { role: "auditor" } }), "ca")).toBe("You left the organisation");
  });
  it("invited", () => {
    const s = accessEventSentence(item("access.invited", { subject: person("ca", "Anita Shah"), metadata: { role: "auditor", email: "a@x.in" } }), "owner");
    expect(s).toBe("Anita Shah (CA) was invited as Accountant (read-only) by You");
  });
  it("invited, no account yet: falls back to the e-mail", () => {
    expect(accessEventSentence(item("access.invited", { metadata: { role: "ca_filing", email: "ca@firm.in" } }), "someone-else"))
      .toBe("ca@firm.in (CA) was invited as Accountant (filing) by Ravi");
  });
  it("non-CA invite has no CA tag", () => {
    expect(accessEventSentence(item("access.invited", { metadata: { role: "seller", email: "s@x.in" } })).startsWith("s@x.in was invited as Seller")).toBe(true);
  });
  it("accepted, revoked, role changed, removed", () => {
    expect(accessEventSentence(item("access.accepted", { actor: person("ca", "Anita"), metadata: { role: "auditor" } }), "owner")).toBe("Anita accepted the invitation as Accountant (read-only)");
    expect(accessEventSentence(item("access.invite_revoked", { metadata: { role: "auditor", email: "a@x.in" } }), "owner")).toBe("The invitation to a@x.in (Accountant (read-only)) was withdrawn by You");
    expect(accessEventSentence(item("access.role_changed", { subject: person("ca", "Anita"), metadata: { from: "auditor", to: "ca_filing" } }), "owner"))
      .toBe("Anita's access changed from Accountant (read-only) to Accountant (filing) by You");
    expect(accessEventSentence(item("access.removed", { subject: person("ca", "Anita"), metadata: { role: "auditor" } }), "owner")).toBe("Access removed for Anita (CA) by You");
  });
  it("removed user who no longer exists uses the e-mail in metadata", () => {
    expect(accessEventSentence(item("access.removed", { subject: null, metadata: { role: "seller", email: "gone@x.in" } }))).toBe("Access removed for gone@x.in by Ravi");
  });
  it("partner_attributed names the partner company and who asked", () => {
    expect(accessEventSentence(item("access.partner_attributed", { actor: person("ca", "Anita"), metadata: { role: "auditor", partnerName: "Shah & Co" } }), "owner"))
      .toBe("Shah & Co was credited as the organisation's Fintranzact partner (requested by Anita)");
    expect(accessEventSentence(item("access.partner_attributed", { actor: null, metadata: {} }))).toBe("The accountant was credited as the organisation's Fintranzact partner (requested by Someone)");
  });
  it("opened and downloaded", () => {
    const ca = person("ca", "Anita");
    expect(accessEventSentence(item("access.org_opened", { actor: ca, metadata: { role: "auditor" } }), "owner")).toBe("Anita (CA) opened this organisation");
    expect(accessEventSentence(item("access.export", { actor: ca, metadata: { role: "ca_filing", procedure: "gst.gstr1Json" } }), "owner")).toBe("Anita (CA) downloaded GSTR-1 JSON");
  });
  it("unknown actor and unknown export", () => {
    expect(accessEventSentence(item("access.org_opened", { actor: null }))).toBe("Someone opened this organisation");
    expect(exportLabel("x.y")).toBe("x.y");
    expect(exportLabel(undefined)).toBe("a file");
  });
});

describe("lastOpenedText", () => {
  it("never / relative", () => {
    expect(lastOpenedText(null, () => "x")).toBe("Never opened");
    expect(lastOpenedText("2026-10-01T10:00:00.000Z", () => "3 hours ago")).toBe("Last opened 3 hours ago");
  });
});
