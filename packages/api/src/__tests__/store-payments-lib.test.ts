/**
 * Pure pieces of online store payments: refund arithmetic (splitting a refund
 * across tax rates, finding the credit-note price), the storefront URLs and the
 * shopper emails. No database, no Razorpay.
 */
import { afterEach, describe, expect, it } from "vitest";
import { calcInvoiceTotals } from "@fintranzact/shared";
import { netPriceForGross, splitRefundByRate } from "../lib/store-payments/refund.js";
import { buildStoreOrderEmail } from "../lib/store-payments/emails.js";
import { storeBaseUrl, storeOrderUrl } from "../lib/store-payments/urls.js";
import { moneyToPaise } from "../lib/razorpay/client.js";

describe("splitRefundByRate", () => {
  it("splits in proportion to what each rate contributed and always adds up to the refund", () => {
    const groups = [
      { taxPercent: "5", grossPaise: 10500 },
      { taxPercent: "18", grossPaise: 11800 },
      { taxPercent: "0", grossPaise: 3333 },
    ];
    for (const refund of [1, 99, 100, 12345, 25633, 20000, 25632]) {
      const parts = splitRefundByRate(groups, refund);
      expect(parts.reduce((s, p) => s + p.grossPaise, 0)).toBe(refund);
      for (const p of parts) expect(p.grossPaise).toBeGreaterThan(0);
    }
  });

  it("a full refund gives back each rate's own total", () => {
    const groups = [
      { taxPercent: "5", grossPaise: 10500 },
      { taxPercent: "18", grossPaise: 11800 },
    ];
    expect(splitRefundByRate(groups, 22300)).toEqual(groups);
  });

  it("refunding half of a single-rate order stays on that rate", () => {
    expect(splitRefundByRate([{ taxPercent: "18", grossPaise: 11800 }], 5000)).toEqual([{ taxPercent: "18", grossPaise: 5000 }]);
  });

  it("gives the leftover paise to the biggest remainders, deterministically", () => {
    const parts = splitRefundByRate([{ taxPercent: "5", grossPaise: 100 }, { taxPercent: "12", grossPaise: 100 }, { taxPercent: "18", grossPaise: 100 }], 100);
    expect(parts.map((p) => p.grossPaise)).toEqual([34, 33, 33]);
  });

  it("nothing to split gives nothing", () => {
    expect(splitRefundByRate([], 100)).toEqual([]);
    expect(splitRefundByRate([{ taxPercent: "5", grossPaise: 100 }], 0)).toEqual([]);
  });
});

describe("netPriceForGross", () => {
  it("finds the tax-exclusive price whose credit note comes to exactly the refund (CGST/SGST and IGST)", () => {
    let exact = 0;
    let checked = 0;
    for (const rate of ["5", "12", "18", "28", "0", "3"]) {
      for (const gross of [100, 101, 999, 5000, 11800, 12345, 99999]) {
        for (const intra of [true, false]) {
          const { unitPrice, total } = netPriceForGross(gross, rate, intra);
          const calc = calcInvoiceTotals({ lineItems: [{ quantity: "1", unitPrice, taxPercent: rate, discountPercent: "0" }], intraState: intra });
          expect(calc.total).toBe(total);
          checked++;
          if (moneyToPaise(total) === gross) exact++;
          // Never off by more than a paisa or two where rounding cannot land on it.
          expect(Math.abs(moneyToPaise(total) - gross)).toBeLessThanOrEqual(2);
        }
      }
    }
    // The vast majority land on the amount exactly.
    expect(exact / checked).toBeGreaterThan(0.9);
  });

  it("118.00 at 18% is a 100.00 price", () => {
    expect(netPriceForGross(11800, "18", true)).toEqual({ unitPrice: "100.00", total: "118.00" });
    expect(netPriceForGross(11800, "18", false)).toEqual({ unitPrice: "100.00", total: "118.00" });
  });
});

describe("storefront URLs", () => {
  const original = process.env.STORE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.STORE_URL;
    else process.env.STORE_URL = original;
  });
  const ORDER = "0c0f5e9a-1c2b-4d3e-8f4a-5b6c7d8e9f01";

  it("builds the order page from STORE_URL only", () => {
    process.env.STORE_URL = "https://store.fintranzact.example/ignored/path?x=1";
    expect(storeBaseUrl()).toBe("https://store.fintranzact.example");
    expect(storeOrderUrl("my-shop", ORDER)).toBe(`https://store.fintranzact.example/my-shop/order/${ORDER}`);
  });

  it("has no return address when STORE_URL is unset or not an http(s) URL", () => {
    delete process.env.STORE_URL;
    expect(storeOrderUrl("my-shop", ORDER)).toBeNull();
    for (const bad of ["", "   ", "not a url", "javascript:alert(1)", "ftp://store.example"]) {
      process.env.STORE_URL = bad;
      expect(storeOrderUrl("my-shop", ORDER)).toBeNull();
    }
  });

  it("refuses a slug or order id that is not well formed", () => {
    process.env.STORE_URL = "https://store.example";
    expect(storeOrderUrl("../etc", ORDER)).toBeNull();
    expect(storeOrderUrl("my-shop", "not-a-uuid")).toBeNull();
    expect(storeOrderUrl("my-shop/evil", ORDER)).toBeNull();
  });
});

describe("buildStoreOrderEmail", () => {
  const base = { businessName: "Asha's <Bakery>", customerName: "Ravi <script>x</script> Kumar", orderNumber: "ORD-00012", total: "118.00", orderUrl: "https://store.example/asha/order/abc" };

  it("escapes shopper and business text in the HTML", () => {
    for (const kind of ["placed", "paid", "failed", "refund"] as const) {
      const mail = buildStoreOrderEmail({ ...base, kind, amount: "50.00", method: "online" });
      expect(mail.html).not.toContain("<script>");
      expect(mail.html).not.toContain("<Bakery>");
      expect(mail.html).toContain("&lt;Bakery&gt;");
      expect(mail.html).toContain("href=\"https://store.example/asha/order/abc\"");
      expect(mail.text).toContain("https://store.example/asha/order/abc");
      expect(mail.subject).toContain("ORD-00012");
    }
  });

  it("says the right thing for each kind", () => {
    expect(buildStoreOrderEmail({ ...base, kind: "placed", method: "online" }).text).toContain("waiting for your online payment");
    expect(buildStoreOrderEmail({ ...base, kind: "placed", method: "cod" }).text).toContain("Cash on Delivery");
    expect(buildStoreOrderEmail({ ...base, kind: "paid", amount: "118.00" }).subject).toMatch(/^Payment received/);
    const failed = buildStoreOrderEmail({ ...base, kind: "failed" });
    expect(failed.subject).toMatch(/^Payment not completed/);
    expect(failed.text).toContain("Pay again:");
    expect(failed.text).toContain("have not been charged");
    const refund = buildStoreOrderEmail({ ...base, kind: "refund", amount: "50.00" });
    expect(refund.subject).toMatch(/^Refund issued/);
    expect(refund.text).toContain("Rs 50.00");
  });

  it("leaves the link out when no storefront URL is configured", () => {
    const mail = buildStoreOrderEmail({ ...base, kind: "failed", orderUrl: null });
    expect(mail.text).not.toContain("http");
    expect(mail.html).not.toContain("href=");
  });
});
