import { describe, expect, it } from "vitest";
import {
  formatIndianMobile,
  isValidIndianMobile,
  normaliseIndianMobile,
  normalisePhoneForClaim,
  phoneFieldError,
  PHONE_INVALID_MESSAGE,
  PHONE_REQUIRED_MESSAGE,
} from "../index.js";

describe("normaliseIndianMobile", () => {
  it.each([
    ["9876543210", "9876543210"],
    ["98765 43210", "9876543210"],
    ["098765 43210", "9876543210"],
    ["+91 98765-43210", "9876543210"],
    ["+919876543210", "9876543210"],
    ["919876543210", "9876543210"],
    ["91-98765-43210", "9876543210"],
    ["091 9876543210", "9876543210"],
    ["(98765) 43210", "9876543210"],
    ["  6000000000 ", "6000000000"],
    ["7000000000", "7000000000"],
    ["8123456789", "8123456789"],
  ])("accepts %s", (raw, expected) => {
    expect(normaliseIndianMobile(raw)).toBe(expected);
  });

  it.each([
    "5876543210", // must start 6-9
    "1234567890",
    "987654321", // 9 digits
    "98765432101", // 11 digits not starting 0
    "+1 415 555 2671", // not +91
    "+44 7911 123456",
    "+9876543210", // + without 91
    "98765x3210",
    "abcdefghij",
    "98765 43210 ext 4",
    "",
    "   ",
  ])("rejects %s", (raw) => {
    expect(normaliseIndianMobile(raw)).toBeNull();
    expect(isValidIndianMobile(raw)).toBe(false);
  });

  it("null and undefined are not numbers", () => {
    expect(normaliseIndianMobile(null)).toBeNull();
    expect(normaliseIndianMobile(undefined)).toBeNull();
  });

  it("the same number typed differently normalises to one value", () => {
    const forms = ["9876543210", "+91 98765 43210", "09876543210", "91 9876543210", "(+91) 98765-43210"];
    const set = new Set(forms.map((f) => normaliseIndianMobile(f)));
    expect(set.size).toBe(1);
  });
});

describe("formatIndianMobile", () => {
  it("formats a valid number and leaves anything else alone", () => {
    expect(formatIndianMobile("09876543210")).toBe("+91 98765 43210");
    expect(formatIndianMobile("123")).toBe("123");
    expect(formatIndianMobile(null)).toBe("");
  });
});

describe("phoneFieldError", () => {
  it("is required on the forms, optional otherwise", () => {
    expect(phoneFieldError("", { required: true })).toBe(PHONE_REQUIRED_MESSAGE);
    expect(phoneFieldError("   ", { required: true })).toBe(PHONE_REQUIRED_MESSAGE);
    expect(phoneFieldError("")).toBeNull();
    expect(phoneFieldError(undefined)).toBeNull();
  });
  it("flags an invalid number and passes a valid one", () => {
    expect(phoneFieldError("12345", { required: true })).toBe(PHONE_INVALID_MESSAGE);
    expect(phoneFieldError("+91 98765 43210", { required: true })).toBeNull();
  });
});

describe("claim form of a sign-up phone", () => {
  it("every way of typing the number gives the same +91 claim value", () => {
    for (const raw of ["9876543210", "+91 98765 43210", "09876543210", "919876543210"]) {
      expect(normalisePhoneForClaim(raw)).toBe("+919876543210");
    }
  });
});
