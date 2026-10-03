/** One-trial-per-business hashing and the reminder email text (no database). */
import { describe, it, expect } from "vitest";
import { gstinCheckChar } from "@fintranzact/shared";
import { hashClaimValue, hashClaims, trialClaimsEnabled } from "../lib/trial-claims.js";
import { trialReminderEmail } from "../lib/trial-reminders.js";

describe("claim hashing", () => {
  it("is a salted SHA-256: 64 hex chars, never the value, different per salt and per kind", () => {
    const h = hashClaimValue("email", "alice@example.com", "salt-one");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("alice");
    expect(hashClaimValue("email", "alice@example.com", "salt-one")).toBe(h);
    expect(hashClaimValue("email", "alice@example.com", "salt-two")).not.toBe(h);
    expect(hashClaimValue("phone", "alice@example.com", "salt-one")).not.toBe(h);
  });

  it("normalises before hashing so aliases collide, and drops invalid values", () => {
    const first14 = "27AAAAA1234A1Z";
    const g = first14 + gstinCheckChar(first14);
    const a = hashClaims([{ kind: "email", value: "A.Li.ce+shop@Gmail.com" }, { kind: "gstin", value: g.toLowerCase() }, { kind: "phone", value: "98765 43210" }]);
    const b = hashClaims([{ kind: "email", value: "alice@gmail.com" }, { kind: "gstin", value: g }, { kind: "phone", value: "+91 9876543210" }]);
    expect(a).toEqual(b);
    expect(a.map((c) => c.kind)).toEqual(["email", "gstin", "phone"]);
    expect(hashClaims([{ kind: "email", value: "nope" }, { kind: "gstin", value: "X" }, { kind: "phone", value: null }])).toEqual([]);
  });

  it("TRIAL_CLAIMS=off disables the check", () => {
    expect(trialClaimsEnabled({})).toBe(true);
    expect(trialClaimsEnabled({ TRIAL_CLAIMS: "off" } as NodeJS.ProcessEnv)).toBe(false);
    expect(trialClaimsEnabled({ TRIAL_CLAIMS: "OFF" } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("trialReminderEmail", () => {
  it("links to billing and says what still works at the end", () => {
    const early = trialReminderEmail("days_7", 7, "https://app.example.com/");
    expect(early.subject).toBe("7 days left in your Fintranzact trial");
    expect(early.text).toContain("https://app.example.com/settings?tab=billing");
    const end = trialReminderEmail("days_0", 0, "https://app.example.com");
    expect(end.subject).toBe("Your Fintranzact trial has ended");
    expect(end.text).toContain("Nothing has been deleted");
    expect(end.text).toContain("view, search, download PDFs and export");
  });
});
