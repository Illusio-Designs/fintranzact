import { describe, it, expect } from "vitest";
import {
  STORE_POLICY_KINDS,
  STORE_POLICY_TITLES,
  composeBusinessAddress,
  defaultPolicyTemplate,
  fillPolicyPlaceholders,
  isPolicyCustomised,
  isStorePolicyKind,
  parsePolicyMarkdown,
  policyBlocksToHtml,
  renderPolicyText,
  safeHref,
  sanitizePolicyInput,
  storePolicyPath,
  type StorePolicyVariables,
} from "../store-policies.js";

const FULL: StorePolicyVariables = {
  businessName: "Sharma Electronics",
  address: "12 MG Road, Pune, Maharashtra, 411001",
  gstin: "27ABCDE1234F1Z5",
  phone: "+91 98765 43210",
  email: "hello@sharma.example",
  returnWindowDays: 10,
};

describe("policy templates", () => {
  it("has a template and title for each of the five pages", () => {
    expect(STORE_POLICY_KINDS).toEqual(["terms", "refund", "shipping", "contact", "privacy"]);
    for (const kind of STORE_POLICY_KINDS) {
      expect(defaultPolicyTemplate(kind).length).toBeGreaterThan(200);
      expect(STORE_POLICY_TITLES[kind]).toBeTruthy();
    }
  });

  it("fills every placeholder from the business details", () => {
    for (const kind of STORE_POLICY_KINDS) {
      const text = renderPolicyText(kind, null, FULL);
      expect(text).not.toMatch(/\{\{/);
      expect(text).toContain("Sharma Electronics");
    }
    const refund = renderPolicyText("refund", null, FULL);
    expect(refund).toContain("within **10 days**");
    const contact = renderPolicyText("contact", null, FULL);
    expect(contact).toContain("27ABCDE1234F1Z5");
    expect(contact).toContain("hello@sharma.example");
    expect(contact).toContain("12 MG Road");
  });

  it("shows the delivery charge on the shipping page only when the store charges one", () => {
    const withFee = renderPolicyText("shipping", null, { ...FULL, deliveryCharges: "Rs 49 per order, plus GST where applicable" });
    expect(withFee).toContain("Delivery charge: Rs 49 per order, plus GST where applicable");
    for (const none of [undefined, null, ""]) {
      const text = renderPolicyText("shipping", null, { ...FULL, deliveryCharges: none });
      expect(text).not.toContain("Delivery charge:");
      expect(text).not.toMatch(/\{\{/);
    }
  });

  it("drops lines whose value is missing instead of leaving blanks", () => {
    const text = renderPolicyText("contact", null, { businessName: "Tiny Shop", returnWindowDays: 7 });
    expect(text).toContain("Business name: Tiny Shop");
    expect(text).not.toMatch(/GSTIN:|Phone:|Email:|Address:/);
    expect(text).not.toMatch(/\{\{/);
  });

  it("leaves unknown placeholders visible and does not claim legal advice", () => {
    expect(fillPolicyPlaceholders("Hi {{nope}} {{ businessName }}", FULL)).toBe("Hi {{nope}} Sharma Electronics");
    expect(defaultPolicyTemplate("privacy")).toMatch(/not a substitute for legal advice/);
  });

  it("uses the owner's saved text instead of the template", () => {
    const stored = { refund: { content: "No returns on {{businessName}} goods.", updatedAt: "2026-10-05T00:00:00.000Z" } };
    expect(isPolicyCustomised("refund", stored)).toBe(true);
    expect(isPolicyCustomised("terms", stored)).toBe(false);
    expect(renderPolicyText("refund", stored, FULL)).toBe("No returns on Sharma Electronics goods.");
    expect(isPolicyCustomised("refund", { refund: { content: "   ", updatedAt: "x" } })).toBe(false);
  });
});

describe("safe markdown", () => {
  it("parses headings, lists, paragraphs and bold", () => {
    const blocks = parsePolicyMarkdown("## Title\n\nHello **world**\nsecond line\n\n- a\n- b\n\n1. one\n2. two");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list", "list"]);
    expect(blocks[2]).toMatchObject({ type: "list", ordered: false });
    expect(blocks[3]).toMatchObject({ type: "list", ordered: true });
  });

  it("never passes raw HTML through", () => {
    const html = policyBlocksToHtml(parsePolicyMarkdown("<script>alert(1)</script> <img src=x onerror=alert(1)>\n\n- <b>x</b>"));
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("only links http, https, mailto and tel", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHref("mailto:a@b.co")).toBe("mailto:a@b.co");
    const html = policyBlocksToHtml(parsePolicyMarkdown("[x](javascript:alert(1)) and [ok](https://example.com)"));
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('<a href="https://example.com" rel="noopener noreferrer nofollow">ok</a>');
  });

  it("escapes ampersands and quotes", () => {
    const html = policyBlocksToHtml(parsePolicyMarkdown('[a"b](https://example.com/?q=1&r=2)'));
    expect(html).toContain("&amp;");
    expect(html).not.toContain('a"b');
  });

  it("sanitises stored input: control chars, newlines, length", () => {
    expect(sanitizePolicyInput("  a\u0000b\r\nc  ")).toBe("ab\nc");
    expect(sanitizePolicyInput("x".repeat(30_000)).length).toBe(20_000);
  });
});

describe("helpers", () => {
  it("builds the path and validates kinds", () => {
    expect(storePolicyPath("my-shop", "refund")).toBe("/my-shop/policies/refund");
    expect(isStorePolicyKind("privacy")).toBe(true);
    expect(isStorePolicyKind("cookies")).toBe(false);
  });

  it("composes an address without repeating parts", () => {
    expect(composeBusinessAddress(["12 MG Road, Pune", "Pune", "Maharashtra", null, "411001"])).toBe(
      "12 MG Road, Pune, Maharashtra, 411001",
    );
    expect(composeBusinessAddress([null, "", undefined])).toBe("");
  });
});
