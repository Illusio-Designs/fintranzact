import { describe, it, expect } from "vitest";
import {
  generateLabelSheetPDF,
  LABEL_PRESETS,
  type LabelItem,
} from "../lib/label-pdf.js";

const item = (over: Partial<LabelItem> = {}): LabelItem => ({
  name: "Test Product",
  barcode: "FT1024",
  quantity: 1,
  ...over,
});

describe("generateLabelSheetPDF", () => {
  it("produces a valid PDF", async () => {
    const { pdf } = await generateLabelSheetPDF({
      businessName: "Acme",
      presetId: "a4_21",
      items: [item()],
      showPrice: true,
      showName: true,
    });

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("expands quantity into one label per copy", async () => {
    const { printed } = await generateLabelSheetPDF({
      businessName: "Acme",
      presetId: "a4_21",
      items: [item({ quantity: 3 }), item({ barcode: "FT2048", quantity: 2 })],
      showPrice: true,
      showName: true,
    });

    expect(printed).toBe(5);
  });

  it("skips items with no barcode instead of failing the whole sheet", async () => {
    const { printed, skipped } = await generateLabelSheetPDF({
      businessName: "Acme",
      presetId: "a4_21",
      items: [
        item({ name: "Has code", quantity: 2 }),
        item({ name: "No code", barcode: "", quantity: 4 }),
      ],
      showPrice: true,
      showName: true,
    });

    // The good item still prints — one bad row must not cost the rest.
    expect(printed).toBe(2);
    expect(skipped).toEqual([{ name: "No code", reason: "no barcode set" }]);
  });

  it("skips values that Code 128 subset B cannot encode", async () => {
    const { printed, skipped } = await generateLabelSheetPDF({
      businessName: "Acme",
      presetId: "a4_21",
      items: [item({ name: "Unicode", barcode: "café", quantity: 1 })],
      showPrice: true,
      showName: true,
    });

    expect(printed).toBe(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].name).toBe("Unicode");
  });

  it("caps copies per item so one bad quantity cannot spool forever", async () => {
    const { printed } = await generateLabelSheetPDF({
      businessName: "Acme",
      presetId: "a4_21",
      items: [item({ quantity: 10_000 })],
      showPrice: true,
      showName: true,
    });

    expect(printed).toBe(500);
  });

  it("still returns a valid PDF when everything was skipped", async () => {
    const { pdf, printed } = await generateLabelSheetPDF({
      businessName: "Acme",
      presetId: "a4_21",
      items: [item({ barcode: "" })],
      showPrice: true,
      showName: true,
    });

    expect(printed).toBe(0);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("renders every preset", async () => {
    for (const presetId of Object.keys(LABEL_PRESETS)) {
      const { pdf, printed } = await generateLabelSheetPDF({
        businessName: "Acme",
        presetId,
        // More than one page worth for the sheet presets.
        items: [item({ quantity: 25 })],
        showPrice: true,
        showName: true,
      });
      expect(printed, presetId).toBe(25);
      expect(pdf.subarray(0, 5).toString(), presetId).toBe("%PDF-");
    }
  });

  it("falls back to the default preset for an unknown id", async () => {
    const { pdf } = await generateLabelSheetPDF({
      businessName: "Acme",
      presetId: "nope",
      items: [item()],
      showPrice: false,
      showName: false,
    });

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("renders long names and variant labels without throwing", async () => {
    const { printed } = await generateLabelSheetPDF({
      businessName: "Acme",
      presetId: "roll_50x25",
      items: [
        item({
          name: "A product name far longer than the label is physically wide",
          variantLabel: "Size: XXL, Color: Midnight Blue, Material: Cotton",
          price: "₹1,299.00",
        }),
      ],
      showPrice: true,
      showName: true,
    });

    expect(printed).toBe(1);
  });
});
