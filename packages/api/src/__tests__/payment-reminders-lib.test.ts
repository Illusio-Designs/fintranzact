import { describe, it, expect, vi } from "vitest";
import { sampleReminderVariables } from "@fintranzact/shared";
import {
  buildMsg91Request,
  createMsg91Provider,
  createSmsProvider,
  smsConfigured,
  MSG91_FLOW_URL,
} from "../lib/sms.js";
import { buildReminderEmail, safeDisplayName } from "../lib/email.js";

const vars = sampleReminderVariables("Acme Co", new Date("2026-10-05T05:00:00Z"));
const cfg = { authKey: "KEY123", templateId: "tpl_1", variableNames: ["customerName", "amount", "nope"] };

describe("MSG91 request building", () => {
  it("posts the template id and the variables for one recipient, with the auth key in a header", () => {
    const req = buildMsg91Request(cfg, { to: "919876543210", body: "ignored", variables: vars });
    expect(req.url).toBe(MSG91_FLOW_URL);
    expect(req.init.method).toBe("POST");
    expect(req.init.headers.authkey).toBe("KEY123");
    const body = JSON.parse(req.init.body);
    expect(body.template_id).toBe("tpl_1");
    expect(body.recipients).toEqual([{ mobiles: "919876543210", customerName: "Sharma Traders", amount: "₹11,800.00", nope: "" }]);
    expect(req.init.body).not.toContain("KEY123");
  });

  it("sends through the injected fetch and treats an error type or HTTP failure as a failure", async () => {
    const ok = vi.fn().mockResolvedValue(new Response(JSON.stringify({ type: "success" }), { status: 200 }));
    await createMsg91Provider(cfg, ok as unknown as typeof fetch).send({ to: "919876543210", body: "x", variables: vars });
    expect(ok).toHaveBeenCalledTimes(1);

    const rejected = vi.fn().mockResolvedValue(new Response(JSON.stringify({ type: "error", message: "Template not found" }), { status: 200 }));
    await expect(createMsg91Provider(cfg, rejected as unknown as typeof fetch).send({ to: "9198", body: "x", variables: vars })).rejects.toThrow(/refused/);

    const down = vi.fn().mockResolvedValue(new Response("oops", { status: 502 }));
    await expect(createMsg91Provider(cfg, down as unknown as typeof fetch).send({ to: "9198", body: "x", variables: vars })).rejects.toThrow(/502/);
  });

  it("an error never carries the number or the key", async () => {
    const down = vi.fn().mockResolvedValue(new Response("oops", { status: 500 }));
    const err = await createMsg91Provider(cfg, down as unknown as typeof fetch).send({ to: "919876543210", body: "x", variables: vars }).catch((e: Error) => e);
    expect(String((err as Error).message)).not.toMatch(/9198765|KEY123/);
  });
});

describe("provider selection", () => {
  it("is off unless SMS_PROVIDER=msg91 and the key and template are both set", () => {
    expect(createSmsProvider({})).toBeNull();
    expect(createSmsProvider({ SMS_PROVIDER: "twilio" })).toBeNull();
    expect(createSmsProvider({ SMS_PROVIDER: "msg91", MSG91_AUTH_KEY: "k" })).toBeNull();
    expect(createSmsProvider({ SMS_PROVIDER: "msg91", MSG91_TEMPLATE_ID: "t" })).toBeNull();
    expect(smsConfigured({})).toBe(false);
    expect(createSmsProvider({ SMS_PROVIDER: "MSG91", MSG91_AUTH_KEY: "k", MSG91_TEMPLATE_ID: "t" })?.name).toBe("msg91");
    expect(smsConfigured({ SMS_PROVIDER: "msg91", MSG91_AUTH_KEY: "k", MSG91_TEMPLATE_ID: "t" })).toBe(true);
  });

  it("MSG91_TEMPLATE_VARS names the variables", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ type: "success" })));
    const p = createSmsProvider(
      { SMS_PROVIDER: "msg91", MSG91_AUTH_KEY: "k", MSG91_TEMPLATE_ID: "t", MSG91_TEMPLATE_VARS: "invoiceNumber, dueDate" },
      fetchMock as unknown as typeof fetch,
    )!;
    await p.send({ to: "919876543210", body: "", variables: vars });
    const sent = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(Object.keys(sent.recipients[0])).toEqual(["mobiles", "invoiceNumber", "dueDate"]);
  });
});

describe("reminder email", () => {
  it("escapes the message and the business name in the HTML", () => {
    const mail = buildReminderEmail({
      subject: "Reminder <script>",
      text: 'Dear <img src=x onerror=alert(1)>,\nPay "now" & \'soon\'',
      businessName: "Evil <b>Co</b>",
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<img");
    expect(mail.html).not.toContain("<b>Co</b>");
    expect(mail.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(mail.html).toContain("&quot;now&quot; &amp;");
    expect(mail.html).toContain("<br />");
  });

  it("tells the customer to reply to the business to stop reminders, in both parts", () => {
    const mail = buildReminderEmail({ subject: "s", text: "Hello", businessName: "Acme Co" });
    expect(mail.text).toContain("reply to this email and tell Acme Co");
    expect(mail.html).toContain("reply to this email and tell Acme Co");
  });

  it("the sender display name cannot break out of the header", () => {
    expect(safeDisplayName('Acme "Co" <x@y.z>, Ltd\r\nBcc: a@b.c')).not.toMatch(/["<>,\r\n:]/);
    expect(safeDisplayName("   ")).toBe("Fintranzact");
    expect(safeDisplayName("A".repeat(300)).length).toBeLessThanOrEqual(80);
  });
});
