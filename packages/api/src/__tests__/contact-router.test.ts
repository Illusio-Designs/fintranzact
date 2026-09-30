/**
 * contact.submit — the public contact and partner forms on the marketing site.
 *
 * Pins the guards on this unauthenticated endpoint: input validation, the
 * per-IP limit, Turnstile when a secret is configured, the honeypot, and
 * that the enquiry reaches our inbox with Reply-To set to the visitor.
 * No database is touched.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { createCallerFactory, router } from "../trpc.js";
import { ENQUIRY_LIMIT, contactRouter, resetEnquiryRateLimit } from "../routers/contact.js";
import { emailService, enquiryHtml, enquiryText, type EnquiryEmail } from "../lib/email.js";

const createCaller = createCallerFactory(router({ contact: contactRouter }));

function anonymousCaller(ip = "203.0.113.7") {
  const req = new Request("http://localhost/api/trpc/contact.submit", { method: "POST" });
  return createCaller({ user: null, tenantId: null, businessId: null, req, resHeaders: new Headers(), ipAddress: ip });
}

const CONTACT = {
  kind: "contact" as const,
  name: "Asha Mehta",
  email: "Asha@Example.com",
  message: "Do you support multiple GSTINs on one plan?",
};

describe("contact.submit", () => {
  let send: MockInstance<(enquiry: EnquiryEmail) => Promise<void>>;

  beforeEach(() => {
    resetEnquiryRateLimit();
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.CONTACT_INBOX;
    send = vi.spyOn(emailService, "sendEnquiry").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  it("emails a contact enquiry to the inbox with Reply-To set to the visitor", async () => {
    await expect(anonymousCaller().contact.submit(CONTACT)).resolves.toEqual({ success: true });
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0][0];
    expect(mail.to).toBe("support@fintranzact.com");
    expect(mail.replyTo).toBe("asha@example.com");
    expect(mail.subject).toBe("Website enquiry from Asha Mehta");
    expect(mail.message).toBe(CONTACT.message);
  });

  it("sends partner applications with the programme and details", async () => {
    process.env.CONTACT_INBOX = "partners@example.com";
    await anonymousCaller().contact.submit({
      kind: "partner",
      programme: "accountant",
      name: "Ravi Kumar",
      email: "ravi@firm.in",
      company: "Kumar & Co",
      phone: "+91 98765 43210",
      city: "Pune",
    });
    const mail = send.mock.calls[0][0];
    expect(mail.to).toBe("partners@example.com");
    expect(mail.subject).toBe("Partner application (Accountants & CA firms): Kumar & Co");
    expect(mail.fields).toContainEqual(["City", "Pune"]);
  });

  it("rejects invalid input", async () => {
    const caller = anonymousCaller();
    await expect(caller.contact.submit({ ...CONTACT, email: "not-an-email" })).rejects.toThrow();
    await expect(caller.contact.submit({ ...CONTACT, message: "hi" })).rejects.toThrow();
    await expect(caller.contact.submit({ ...CONTACT, name: "Eve\r\nBcc: x@y.z" })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("validates partner applications and falls back to the name in the subject", async () => {
    const caller = anonymousCaller();
    const partner = { kind: "partner" as const, programme: "reseller" as const, name: "Meera Iyer", email: "meera@x.in" };
    await expect(caller.contact.submit({ ...partner, programme: "investor" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.contact.submit({ ...partner, company: "Evil\nBcc: a@b.c" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.contact.submit({ ...partner, kind: "sales" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.contact.submit({ ...partner, name: "M" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(send).not.toHaveBeenCalled();

    await caller.contact.submit(partner);
    expect(send.mock.calls[0][0].subject).toBe("Partner application (Resellers & consultants): Meera Iyer");
    expect(send.mock.calls[0][0].message).toBe("");
  });

  it(`allows ${ENQUIRY_LIMIT} submissions per IP, then refuses`, async () => {
    const caller = anonymousCaller("198.51.100.20");
    for (let i = 0; i < ENQUIRY_LIMIT; i++) {
      await caller.contact.submit(CONTACT);
    }
    await expect(caller.contact.submit(CONTACT)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    // A different IP is unaffected.
    await expect(anonymousCaller("198.51.100.21").contact.submit(CONTACT)).resolves.toEqual({ success: true });
  });

  it("requires a Turnstile token when a secret is configured", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    await expect(anonymousCaller().contact.submit(CONTACT)).rejects.toMatchObject({ code: "BAD_REQUEST" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false }))));
    await expect(
      anonymousCaller().contact.submit({ ...CONTACT, turnstileToken: "bad" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }))));
    await expect(
      anonymousCaller().contact.submit({ ...CONTACT, turnstileToken: "good" }),
    ).resolves.toEqual({ success: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("quietly drops submissions that fill the honeypot", async () => {
    await expect(
      anonymousCaller().contact.submit({ ...CONTACT, website: "http://spam.example" }),
    ).resolves.toEqual({ success: true });
    expect(send).not.toHaveBeenCalled();
  });

  it("reports a send failure as an error", async () => {
    send.mockRejectedValueOnce(new Error("Resend down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(anonymousCaller().contact.submit(CONTACT)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

describe("enquiry email bodies", () => {
  const enquiry = {
    to: "support@fintranzact.com",
    replyTo: "a@b.c",
    subject: "Website enquiry from <b>Eve</b>",
    fields: [["Name", "<script>x</script>"], ["Company", ""]] as Array<[string, string]>,
    message: "Line one\nLine <two>",
  };

  it("escapes everything in the HTML body", () => {
    const html = enquiryHtml(enquiry);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Line one<br />Line &lt;two&gt;");
  });

  it("leaves empty fields out of the text body", () => {
    expect(enquiryText(enquiry)).toBe("Name: <script>x</script>\n\nLine one\nLine <two>");
  });
});
