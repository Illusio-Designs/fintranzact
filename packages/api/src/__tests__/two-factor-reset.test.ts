/** Platform-admin 2FA reset rules with a faked data layer. */

import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  resetTwoFactorByAdmin,
  resetNoticeText,
  RESET_NOTICE_SUBJECT,
  type ResetDeps,
  type ResetInput,
  type ResetTarget,
} from "../lib/two-factor-reset.js";
import type { SecurityEventInput } from "../lib/security-events.js";

const NOW = new Date("2026-10-02T10:00:00Z");
const ADMIN = "admin-1";
const TARGET_ID = "user-2";

function fake(opts: { target?: ResetTarget | null; emailFails?: boolean } = {}) {
  const target = opts.target === undefined ? { id: TARGET_ID, email: "Asha@Example.com", name: "Asha", twoFactorEnabled: true } : opts.target;
  const calls: string[] = [];
  const events: SecurityEventInput[] = [];
  const emails: Array<{ to: string; subject: string; text: string }> = [];
  const logged: unknown[] = [];
  const deps: ResetDeps = {
    store: {
      getTarget: async () => target,
      clearTwoFactor: async (id) => { calls.push(`clear:${id}`); },
    },
    revokeAllSessions: async (id) => { calls.push(`sessions:${id}`); },
    invalidateGate: (id) => { calls.push(`gate:${id}`); },
    record: async (e) => { events.push(e); },
    sendNotice: async (to, subject, text) => {
      if (opts.emailFails) throw new Error("smtp down");
      emails.push({ to, subject, text });
    },
    log: { error: (...a) => { logged.push(a); } },
    now: () => NOW,
  };
  return { deps, calls, events, emails, logged };
}

const good = (over: Partial<ResetInput> = {}): ResetInput => ({
  userId: TARGET_ID,
  tenantId: "t1",
  confirmEmail: "asha@example.com",
  verification: {
    method: "video_call",
    checks: ["name_matches_account", "email_ownership_confirmed"],
    reference: "TCK-42",
    reason: "Lost phone and backup codes; verified on a video call.",
  },
  ...over,
});
const run = (f: ReturnType<typeof fake>, input: ResetInput, adminUserId = ADMIN) =>
  resetTwoFactorByAdmin(f.deps, { adminUserId, input, ip: "203.0.113.9", userAgent: "ua" });
const rejects = async (p: Promise<unknown>, code: string, msg?: RegExp) => {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(TRPCError);
  expect((err as TRPCError).code).toBe(code);
  if (msg) expect((err as TRPCError).message).toMatch(msg);
};

describe("resetTwoFactorByAdmin refusals", () => {
  it("refuses a reset of the admin's own account and changes nothing", async () => {
    const f = fake();
    await rejects(run(f, good({ userId: ADMIN }), ADMIN), "BAD_REQUEST", /your own/);
    expect(f.calls).toEqual([]);
    expect(f.events).toEqual([]);
  });
  it("refuses a wrong typed email", async () => {
    const f = fake();
    await rejects(run(f, good({ confirmEmail: "someone@else.com" })), "BAD_REQUEST", /does not match/);
    expect(f.calls).toEqual([]);
  });
  it("refuses fewer than two checks, duplicates and unknown checks", async () => {
    for (const checks of [[], ["name_matches_account"], ["name_matches_account", "name_matches_account"], ["name_matches_account", "bogus"]]) {
      const f = fake();
      await rejects(run(f, good({ verification: { ...good().verification, checks } })), "BAD_REQUEST", /at least 2 identity checks/);
      expect(f.calls).toEqual([]);
    }
  });
  it("refuses a short reason (whitespace does not count)", async () => {
    const f = fake();
    await rejects(run(f, good({ verification: { ...good().verification, reason: "short   " + " ".repeat(30) } })), "BAD_REQUEST", /reason/);
  });
  it("refuses an invalid method", async () => {
    const f = fake();
    await rejects(run(f, good({ verification: { ...good().verification, method: "telepathy" as never } })), "BAD_REQUEST", /how the user was verified/);
  });
  it("NOT_FOUND for an unknown user", async () => {
    await rejects(run(fake({ target: null }), good()), "NOT_FOUND");
  });
});

describe("resetTwoFactorByAdmin success", () => {
  it("clears 2FA, then drops the gate cache and every session, in that order", async () => {
    const f = fake();
    const r = await run(f, good());
    expect(r).toMatchObject({ reset: true, emailSent: true });
    expect(f.calls).toEqual([`clear:${TARGET_ID}`, `gate:${TARGET_ID}`, `sessions:${TARGET_ID}`]);
  });
  it("records the event with actor, subject, tenant and the verification metadata", async () => {
    const f = fake();
    await run(f, good());
    expect(f.events).toHaveLength(1);
    expect(f.events[0]).toMatchObject({
      type: "2fa.reset_by_admin",
      userId: TARGET_ID,
      actorUserId: ADMIN,
      tenantId: "t1",
      metadata: {
        method: "video_call",
        checks: ["name_matches_account", "email_ownership_confirmed"],
        reference: "TCK-42",
        reason: "Lost phone and backup codes; verified on a video call.",
        ip: "203.0.113.9",
      },
    });
  });
  it("tenantId and reference are optional", async () => {
    const f = fake();
    const v = { ...good().verification, reference: undefined };
    await run(f, { ...good({ verification: v }), tenantId: undefined });
    expect(f.events[0]!.tenantId).toBeNull();
    expect((f.events[0]!.metadata as { reference: unknown }).reference).toBeNull();
  });
  it("emails the user (not the admin) with who, what and what to do", async () => {
    const f = fake();
    await run(f, good());
    expect(f.emails).toHaveLength(1);
    expect(f.emails[0]!.to).toBe("Asha@Example.com");
    expect(f.emails[0]!.subject).toBe(RESET_NOTICE_SUBJECT);
    const text = f.emails[0]!.text;
    expect(text).toMatch(/platform support/);
    expect(text).toContain(NOW.toUTCString());
    expect(text).toMatch(/signed out everywhere/);
    expect(text).toMatch(/set up two-factor authentication again/);
    expect(text).toMatch(/did not ask for this, contact Fintranzact support/);
  });
  it("an email failure does not fail the reset; it is logged", async () => {
    const f = fake({ emailFails: true });
    const r = await run(f, good());
    expect(r).toMatchObject({ reset: true, emailSent: false });
    expect(f.calls).toContain(`sessions:${TARGET_ID}`);
    expect(f.events).toHaveLength(1);
    expect(f.logged).toHaveLength(1);
  });
  it("a user without 2FA gets reset:false, nothing changes and nothing is recorded", async () => {
    const f = fake({ target: { id: TARGET_ID, email: "asha@example.com", name: null, twoFactorEnabled: false } });
    const r = await run(f, good());
    expect(r).toEqual({ reset: false, message: expect.stringMatching(/does not have two-factor/) });
    expect(f.calls).toEqual([]);
    expect(f.events).toEqual([]);
    expect(f.emails).toEqual([]);
  });
  it("notice text copes with a missing name", () => {
    expect(resetNoticeText({ name: null, at: NOW })).toMatch(/^Hi there,/);
  });
});
