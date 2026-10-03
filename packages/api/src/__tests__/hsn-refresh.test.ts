import { describe, it, expect, vi } from "vitest";
import {
  refreshHsnCodes, selectForRefresh, hsnRefreshBatchFromEnv,
  HSN_REFRESH_MIN_AGE_MS, type HsnRefreshDeps, type RefreshRow,
} from "../lib/hsn-refresh.js";
import type { HsnResolution } from "../lib/hsn-lookup.js";
import type { SandboxHsnResult } from "../lib/sandbox/hsn.js";

const NOW = Date.parse("2026-10-03T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const sbRes = (code: string, over: Partial<SandboxHsnResult> = {}): SandboxHsnResult => ({
  code, kind: "hsn", description: `Desc ${code}`, rate: 18, effectiveFrom: "2017-07-01", effectiveTo: null, active: true, source: "sandbox", ...over,
});
const live = (code: string, over: Partial<SandboxHsnResult> = {}): HsnResolution => ({
  code, source: "sandbox", sandboxStatus: "ok", valid: true, kind: "hsn", description: "x", bundledDescription: null, bundled: null,
  sandbox: sbRes(code, over), rate: 18, effectiveFrom: null, effectiveTo: null, active: over.active ?? true, checkedAt: null,
});
const other = (code: string, status: HsnResolution["sandboxStatus"]): HsnResolution => ({
  code, source: "bundled", sandboxStatus: status, valid: true, kind: null, description: null, bundledDescription: null, bundled: null,
  sandbox: null, rate: null, effectiveFrom: null, effectiveTo: null, active: null, checkedAt: null,
});

function fakes(over: Partial<HsnRefreshDeps> & { used?: Record<string, number>; checked?: Record<string, number>; answers?: Record<string, HsnResolution | Error> } = {}) {
  const saved: Array<{ row: RefreshRow; at: number }> = [];
  const lookups: string[] = [];
  const finish = vi.fn(async () => {});
  const used = new Map(Object.entries(over.used ?? { "3004": 5, "9983": 2, "8517": 1 }));
  const checked = new Map(Object.entries(over.checked ?? {}));
  const deps: HsnRefreshDeps = {
    status: () => "ready",
    batchSize: () => 200,
    usedCodes: async () => used,
    checkedAt: async () => checked,
    lookup: async (code) => {
      lookups.push(code);
      const a = over.answers?.[code] ?? live(code);
      if (a instanceof Error) throw a;
      return a;
    },
    save: async (row, at) => { saved.push({ row, at }); },
    inactiveCodes: async () => saved.filter((s) => !s.row.active).map((s) => s.row.code),
    finish,
    now: () => NOW,
    sleep: async () => {},
    pacingMs: 0,
    ...over,
  };
  return { deps, saved, lookups, finish };
}

describe("selectForRefresh", () => {
  it("takes never-checked codes first, then the oldest check first", () => {
    const used = new Map([["1111", 1], ["2222", 1], ["3333", 1], ["4444", 1]]);
    const checked = new Map([["1111", NOW - 5 * DAY], ["2222", NOW - 9 * DAY], ["3333", NOW - 2 * DAY]]);
    expect(selectForRefresh(used, checked, NOW, 10)).toEqual(["4444", "2222", "1111", "3333"]);
  });
  it("caps the batch and breaks ties by item count, then code", () => {
    const used = new Map([["3004", 1], ["2002", 9], ["1001", 9], ["5005", 3]]);
    expect(selectForRefresh(used, new Map(), NOW, 3)).toEqual(["1001", "2002", "5005"]);
  });
  it("skips codes checked in the last 20 hours and anything not a code", () => {
    const used = new Map([["3004", 1], ["8517", 1], ["abc", 1], ["1", 1]]);
    const checked = new Map([["3004", NOW - HSN_REFRESH_MIN_AGE_MS + 1000]]);
    expect(selectForRefresh(used, checked, NOW, 10)).toEqual(["8517"]);
  });
  it("batch size comes from HSN_REFRESH_BATCH, default 200, max 1000", () => {
    expect(hsnRefreshBatchFromEnv({})).toBe(200);
    expect(hsnRefreshBatchFromEnv({ HSN_REFRESH_BATCH: "50" })).toBe(50);
    expect(hsnRefreshBatchFromEnv({ HSN_REFRESH_BATCH: "99999" })).toBe(1000);
    expect(hsnRefreshBatchFromEnv({ HSN_REFRESH_BATCH: "0" })).toBe(200);
    expect(hsnRefreshBatchFromEnv({ HSN_REFRESH_BATCH: "x" })).toBe(200);
  });
});

describe("refreshHsnCodes", () => {
  it("skips silently when disabled or Sandbox is not configured", async () => {
    for (const status of ["disabled", "not_configured"] as const) {
      const f = fakes({ status: () => status });
      expect(await refreshHsnCodes(f.deps)).toEqual({ ran: false, reason: status });
      expect(f.lookups).toEqual([]);
      expect(f.saved).toEqual([]);
      expect(f.finish).not.toHaveBeenCalled();
    }
  });

  it("looks up in order, capped, and records Sandbox's answers", async () => {
    const f = fakes({
      used: { "1111": 1, "2222": 1, "3333": 1 },
      checked: { "1111": NOW - 3 * DAY },
      batchSize: () => 2,
      answers: { "2222": live("2222", { description: "Two", rate: 5, effectiveFrom: "2020-01-01" }) },
    });
    const res = await refreshHsnCodes(f.deps);
    expect(f.lookups).toEqual(["2222", "3333"]);
    expect(res).toMatchObject({ ran: true, stoppedEarly: false, summary: { attempted: 2, recorded: 2, found: 2, notFound: 0 } });
    expect(f.saved[0]).toEqual({
      at: NOW,
      row: { code: "2222", kind: "hsn", description: "Two", rate: 5, active: true, inactiveReason: null, effectiveFrom: "2020-01-01", effectiveTo: null, status: "ok" },
    });
  });

  it("records a code Sandbox does not list, without treating it as an outage", async () => {
    const f = fakes({ used: { "3004": 1 }, answers: { "3004": other("3004", "not_found") } });
    const res = await refreshHsnCodes(f.deps);
    expect(f.saved[0].row).toMatchObject({ code: "3004", status: "not_found", description: "" });
    expect(res).toMatchObject({ ran: true, summary: { notFound: 1, found: 0, unavailable: 0 } });
  });

  it("detects a withdrawn code still used by items and reports counts", async () => {
    const f = fakes({
      used: { "3004": 4, "9983": 2 },
      answers: { "3004": live("3004", { active: false, inactiveReason: "Withdrawn" }) },
    });
    const res = await refreshHsnCodes(f.deps);
    expect(res).toMatchObject({ ran: true, summary: { withdrawnInUse: 1, itemsAffected: 4, withdrawnCodes: ["3004"] } });
    expect(f.saved.find((s) => s.row.code === "3004")!.row).toMatchObject({ active: false, inactiveReason: "Withdrawn" });
    expect(f.finish).toHaveBeenCalledTimes(1);
  });

  it("ignores inactive stored codes no item uses any more", async () => {
    const f = fakes({ used: { "3004": 1 }, inactiveCodes: async () => ["3004", "7777"] });
    const res = await refreshHsnCodes(f.deps);
    expect(res).toMatchObject({ ran: true, summary: { withdrawnInUse: 1, itemsAffected: 1 } });
  });

  it("stops after consecutive Sandbox failures and records nothing for them", async () => {
    const f = fakes({
      used: { "1111": 5, "2222": 4, "3333": 3, "4444": 2, "5555": 1 },
      answers: { "1111": other("1111", "unavailable"), "2222": new Error("boom"), "3333": other("3333", "unavailable") },
    });
    const res = await refreshHsnCodes(f.deps);
    expect(f.lookups).toEqual(["1111", "2222", "3333"]);
    expect(f.saved).toEqual([]);
    expect(res).toMatchObject({ ran: true, stoppedEarly: true, summary: { unavailable: 3, recorded: 0 } });
  });

  it("a success resets the failure streak", async () => {
    const f = fakes({
      used: { "1111": 5, "2222": 4, "3333": 3, "4444": 2 },
      answers: { "1111": other("1111", "unavailable"), "2222": live("2222"), "3333": other("3333", "unavailable") },
    });
    const res = await refreshHsnCodes(f.deps);
    expect(res).toMatchObject({ ran: true, stoppedEarly: false, summary: { attempted: 4, recorded: 2, unavailable: 2 } });
  });

  it("stops quietly if the resolver reports Sandbox not configured mid-run", async () => {
    const f = fakes({ used: { "1111": 1, "2222": 1 }, answers: { "1111": other("1111", "not_configured") } });
    const res = await refreshHsnCodes(f.deps);
    expect(f.lookups).toEqual(["1111"]);
    expect(res).toMatchObject({ ran: true, stoppedEarly: true });
  });

  it("counts a failed write and carries on", async () => {
    const f = fakes({ used: { "1111": 2, "2222": 1 } });
    let n = 0;
    f.deps.save = async (row, at) => { if (n++ === 0) throw new Error("db"); f.saved.push({ row, at }); };
    const res = await refreshHsnCodes(f.deps);
    expect(res).toMatchObject({ ran: true, summary: { failed: 1, recorded: 1 } });
  });

  it("never throws, whatever fails", async () => {
    for (const key of ["usedCodes", "checkedAt", "status", "inactiveCodes", "finish"] as const) {
      const f = fakes();
      (f.deps as unknown as Record<string, unknown>)[key] = async () => { throw new Error("nope"); };
      if (key === "status") f.deps.status = () => { throw new Error("nope"); };
      await expect(refreshHsnCodes(f.deps)).resolves.toBeDefined();
    }
    const f = fakes();
    f.deps.usedCodes = async () => { throw new Error("nope"); };
    expect(await refreshHsnCodes(f.deps)).toEqual({ ran: false, reason: "error" });
  });

  it("is idempotent: a second run right after records nothing new", async () => {
    const checked = new Map<string, number>();
    const f = fakes({ used: { "3004": 1, "9983": 1 } });
    f.deps.checkedAt = async () => checked;
    f.deps.save = async (row, at) => { f.saved.push({ row, at }); checked.set(row.code, at); };
    await refreshHsnCodes(f.deps);
    expect(f.saved).toHaveLength(2);
    const again = await refreshHsnCodes(f.deps);
    expect(f.saved).toHaveLength(2);
    expect(again).toMatchObject({ ran: true, summary: { attempted: 0 } });
  });

  it("paces calls between lookups", async () => {
    const f = fakes({ used: { "1111": 1, "2222": 1, "3333": 1 }, pacingMs: 1300 });
    const sleep = vi.fn(async () => {});
    f.deps.sleep = sleep;
    await refreshHsnCodes(f.deps);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1300);
  });
});
