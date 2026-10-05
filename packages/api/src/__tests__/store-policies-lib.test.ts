import { describe, it, expect } from "vitest";
import {
  buildEditorPolicies,
  buildPublicPolicyPages,
  policyVariables,
  renderPolicyPageHtml,
  type PolicyBusinessRow,
} from "../lib/store-policies.js";

const BIZ: PolicyBusinessRow = {
  name: "Sharma <Electronics> & Sons",
  gstRegistrationType: "regular",
  gstin: "27ABCDE1234F1Z5",
  phone: "9876543210",
  email: "hello@sharma.example",
  address: "12 MG Road",
  addressLine1: null,
  addressLine2: null,
  city: "Pune",
  state: "Maharashtra",
  pincode: "411001",
  storeReturnWindowDays: 10,
  storePolicies: null,
};

describe("policyVariables", () => {
  it("composes the address and carries the return window", () => {
    const v = policyVariables(BIZ);
    expect(v.address).toBe("12 MG Road, Pune, Maharashtra, 411001");
    expect(v.returnWindowDays).toBe(10);
    expect(v.gstin).toBe("27ABCDE1234F1Z5");
  });

  it("publishes no GSTIN for an unregistered business, and falls back to address lines", () => {
    const v = policyVariables({ ...BIZ, gstRegistrationType: "unregistered", address: null, addressLine1: "Shop 4", addressLine2: "Market Yard", storeReturnWindowDays: null });
    expect(v.gstin).toBeNull();
    expect(v.address).toBe("Shop 4, Market Yard, Pune, Maharashtra, 411001");
    expect(v.returnWindowDays).toBe(7);
  });
});

describe("public pages", () => {
  it("builds five pages with paths and only marks edited pages as updated", () => {
    const pages = buildPublicPolicyPages("sharma", {
      ...BIZ,
      storePolicies: { terms: { content: "Our terms", updatedAt: "2026-10-05T10:00:00.000Z" } },
    });
    expect(pages.map((p) => p.path)).toEqual([
      "/sharma/policies/terms",
      "/sharma/policies/refund",
      "/sharma/policies/shipping",
      "/sharma/policies/contact",
      "/sharma/policies/privacy",
    ]);
    expect(pages[0]!.updatedAt).toBe("2026-10-05T10:00:00.000Z");
    expect(pages[1]!.updatedAt).toBeNull();
  });

  it("renders HTML with the business name escaped and the page marked current", () => {
    const pages = buildPublicPolicyPages("sharma", BIZ);
    const html = renderPolicyPageHtml({ slug: "sharma", businessName: BIZ.name, pages, kind: "privacy", basePath: "/store/sharma/policies" });
    expect(html).toContain("Sharma &lt;Electronics&gt; &amp; Sons");
    expect(html).not.toContain("<Electronics>");
    expect(html).toContain('<a href="/store/sharma/policies/privacy" aria-current="page">Privacy Policy</a>');
    expect(html).toContain('href="/store/sharma/policies/refund"');
    expect(html).toContain("<h1>Privacy Policy</h1>");
  });
});

describe("editor view", () => {
  it("exposes template, saved text and flags per page", () => {
    const view = buildEditorPolicies({ ...BIZ, storePolicies: { refund: { content: "Mine", updatedAt: "2026-10-05T10:00:00.000Z" } } });
    const refund = view.policies.find((p) => p.kind === "refund")!;
    expect(refund).toMatchObject({ isCustom: true, content: "Mine" });
    expect(refund.template).toContain("{{returnWindowDays}}");
    expect(view.policies.find((p) => p.kind === "terms")).toMatchObject({ isCustom: false, content: null });
  });
});
