import { describe, it, expect } from "vitest";
import {
  backupCodesFileContent,
  formatBackupCodeInput,
  formatTotpInput,
  groupKey,
  isCompleteBackupCode,
  lockedMessage,
  parseUnlockTime,
} from "../two-factor";

describe("formatBackupCodeInput", () => {
  it("upper-cases, strips junk and dashes after six characters", () => {
    expect(formatBackupCodeInput("k7p2mq9xd4hw")).toBe("K7P2MQ-9XD4HW");
    expect(formatBackupCodeInput("k7p2mq-9xd4hw")).toBe("K7P2MQ-9XD4HW");
    expect(formatBackupCodeInput(" K7P2 MQ 9XD4 HW ")).toBe("K7P2MQ-9XD4HW");
  });
  it("does not add a dash until there is a seventh character, and caps at 12", () => {
    expect(formatBackupCodeInput("k7p2mq")).toBe("K7P2MQ");
    expect(formatBackupCodeInput("k7p2mq9")).toBe("K7P2MQ-9");
    expect(formatBackupCodeInput("k7p2mq9xd4hwEXTRA")).toBe("K7P2MQ-9XD4HW");
    expect(formatBackupCodeInput("")).toBe("");
  });
  it("knows a complete code", () => {
    expect(isCompleteBackupCode("K7P2MQ-9XD4HW")).toBe(true);
    expect(isCompleteBackupCode("K7P2MQ-9XD4H")).toBe(false);
  });
});

describe("formatTotpInput", () => {
  it("keeps six digits from a paste", () => {
    expect(formatTotpInput("123 456")).toBe("123456");
    expect(formatTotpInput("12a34b56789")).toBe("123456");
  });
});

describe("lockout message", () => {
  const msg = "Too many wrong codes. Try again in 15 minutes (after 2030-01-01T10:15:00.000Z).";
  it("reads the unlock time", () => {
    expect(parseUnlockTime(msg)?.toISOString()).toBe("2030-01-01T10:15:00.000Z");
    expect(parseUnlockTime("Too many wrong codes. Please try again later.")).toBeNull();
  });
  it("builds the sign-in line", () => {
    expect(lockedMessage(msg)).toMatch(/^Too many attempts\. Try again at .+\.$/);
    expect(lockedMessage("nope")).toBe("Too many attempts. Try again later.");
  });
});

describe("backup codes file", () => {
  it("names the account, the date, a warning and every code", () => {
    const text = backupCodesFileContent(["AAAAAA-BBBBBB", "CCCCCC-DDDDDD"], "me@firm.in", new Date("2026-03-04T10:00:00Z"));
    expect(text).toContain("Account: me@firm.in");
    expect(text).toContain("Generated: 2026-03-04");
    expect(text).toMatch(/Keep this file somewhere safe/);
    expect(text).toContain(" 1. AAAAAA-BBBBBB");
    expect(text).toContain(" 2. CCCCCC-DDDDDD");
  });
  it("groups a manual key by four", () => {
    expect(groupKey("ABCDEFGHIJKLMNOP")).toBe("ABCD EFGH IJKL MNOP");
  });
});
