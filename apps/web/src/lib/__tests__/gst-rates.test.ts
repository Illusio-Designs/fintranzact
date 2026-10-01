import { describe, it, expect } from "vitest";
import { GST_RATE_OPTIONS, gstRateOptions, gstRateValue } from "../gst-rates";

describe("GST rate options", () => {
  it("maps stored rates to their option", () => {
    expect(gstRateValue("18.00")).toBe("18");
    expect(gstRateValue(5)).toBe("5");
    expect(gstRateValue("0.250")).toBe("0.25");
    expect(gstRateValue(null)).toBe("0");
  });

  it("keeps an unlisted saved rate as an option", () => {
    expect(gstRateOptions("18")).toBe(GST_RATE_OPTIONS);
    const options = gstRateOptions("7.5");
    expect(options.at(-1)).toEqual({ value: "7.5", label: "7.5% (current)" });
  });
});
