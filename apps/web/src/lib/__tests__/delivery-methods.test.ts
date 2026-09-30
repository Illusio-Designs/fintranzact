import { describe, it, expect } from "vitest";
import { BUILT_IN_DELIVERY_METHODS, deliveryMethodLabel, deliveryMethodOptions } from "../delivery-methods";

describe("deliveryMethodOptions", () => {
  it("lists the built-in methods, then the business's own", () => {
    const options = deliveryMethodOptions([{ id: "porter", label: "Porter", hasTracking: false }]);
    expect(options.map((o) => o.id)).toEqual([...BUILT_IN_DELIVERY_METHODS.map((m) => m.id), "porter"]);
    expect(options.at(-1)).toMatchObject({ id: "porter", label: "Porter", custom: true });
  });

  it("copes with no custom methods and skips repeats of a built-in id", () => {
    expect(deliveryMethodOptions(null)).toHaveLength(BUILT_IN_DELIVERY_METHODS.length);
    expect(deliveryMethodOptions([{ id: "courier", label: "My courier", hasTracking: true }])).toHaveLength(BUILT_IN_DELIVERY_METHODS.length);
  });
});

describe("deliveryMethodLabel", () => {
  it("names built-in and custom methods, and shows unknown ids as they are", () => {
    const options = deliveryMethodOptions([{ id: "local_tempo", label: "Local Tempo", hasTracking: false }]);
    expect(deliveryMethodLabel("hand_delivery", options)).toBe("Self / Driver");
    expect(deliveryMethodLabel("local_tempo", options)).toBe("Local Tempo");
    expect(deliveryMethodLabel("retired_van", options)).toBe("retired_van");
    expect(deliveryMethodLabel(null)).toBe("—");
  });
});
