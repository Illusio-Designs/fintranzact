import { describe, it, expect } from "vitest";
import {
  ACCESS_LOG_DEFAULT_LIMIT,
  ACCESS_LOG_MAX_LIMIT,
  accessUserIds,
  canViewAccessLog,
  clampAccessLimit,
  decodeAccessCursor,
  encodeAccessCursor,
  pageAccessRows,
  safeAccessMetadata,
  toAccessLogItem,
  type AccessEventRow,
} from "../lib/access-log.js";

const row = (n: number, extra: Partial<AccessEventRow> = {}): AccessEventRow => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  userId: null,
  actorUserId: null,
  type: "access.invited",
  metadata: null,
  createdAt: new Date(1_700_000_000_000),
  ...extra,
});

describe("role gate", () => {
  it("owner, superadmin and admin only", () => {
    for (const r of ["owner", "superadmin", "admin"]) expect(canViewAccessLog(r)).toBe(true);
    for (const r of ["seller_manager", "seller", "accountant", "auditor", "ca_filing", "viewer", "", null, undefined]) expect(canViewAccessLog(r)).toBe(false);
  });
});

describe("limit", () => {
  it("defaults to 25 and caps at 100", () => {
    expect(clampAccessLimit(undefined)).toBe(ACCESS_LOG_DEFAULT_LIMIT);
    expect(ACCESS_LOG_DEFAULT_LIMIT).toBe(25);
    expect(clampAccessLimit(1000)).toBe(ACCESS_LOG_MAX_LIMIT);
    expect(clampAccessLimit(0)).toBe(1);
    expect(clampAccessLimit(10.9)).toBe(10);
    expect(clampAccessLimit(NaN)).toBe(25);
  });
});

describe("keyset cursor", () => {
  it("round-trips ms and id", () => {
    const r = row(7);
    const c = encodeAccessCursor(r);
    expect(decodeAccessCursor(c)).toEqual({ ms: 1_700_000_000_000, id: r.id });
  });
  it("rejects malformed cursors", () => {
    for (const bad of ["", "abc", "123_notauuid", "-5_00000000-0000-4000-8000-000000000001", "1_00000000-0000-4000-8000-000000000001; drop"]) {
      expect(decodeAccessCursor(bad)).toBeNull();
    }
    expect(decodeAccessCursor(undefined)).toBeNull();
  });
  it("two rows in the same millisecond get different cursors that order by id", () => {
    const a = row(1);
    const b = row(2);
    expect(encodeAccessCursor(a)).not.toBe(encodeAccessCursor(b));
    expect(decodeAccessCursor(encodeAccessCursor(a))!.ms).toBe(decodeAccessCursor(encodeAccessCursor(b))!.ms);
  });
});

describe("pageAccessRows", () => {
  it("no next cursor when the page is not full", () => {
    const rows = [row(1), row(2)];
    expect(pageAccessRows(rows, 2)).toEqual({ rows, nextCursor: null });
  });
  it("trims the extra row and points the cursor at the last kept row", () => {
    const rows = [row(3), row(2), row(1)];
    const p = pageAccessRows(rows, 2);
    expect(p.rows).toHaveLength(2);
    expect(p.nextCursor).toBe(encodeAccessCursor(rows[1]!));
  });
});

describe("safe output", () => {
  it("keeps only the five short string fields", () => {
    expect(safeAccessMetadata({ role: "auditor", from: "a", to: "b", email: "x@y.in", procedure: "gst.gstr1Json", apiKeysRevoked: 2, removedBy: "u", token: "secret" }))
      .toEqual({ role: "auditor", from: "a", to: "b", email: "x@y.in", procedure: "gst.gstr1Json" });
    expect(safeAccessMetadata(null)).toEqual({});
    expect(safeAccessMetadata({ role: 5, email: "x".repeat(300) })).toEqual({});
  });
  it("joins actor and subject, null-safe", () => {
    const users = new Map([["u1", { id: "u1", name: "Anita", email: "a@x.in" }]]);
    const item = toAccessLogItem(row(1, { userId: "u1", actorUserId: "gone", metadata: { role: "auditor", email: "a@x.in" } }), users);
    expect(item.subject).toEqual({ id: "u1", name: "Anita", email: "a@x.in" });
    expect(item.actor).toBeNull();
    expect(item.label).toBe("Member invited");
    expect(item.createdAt).toBe("2023-11-14T22:13:20.000Z");
  });
  it("unknown types fall back to the raw type", () => {
    expect(toAccessLogItem(row(1, { type: "access.future" }), new Map()).label).toBe("access.future");
  });
  it("collects distinct user ids", () => {
    expect(accessUserIds([row(1, { userId: "a", actorUserId: "b" }), row(2, { userId: "a", actorUserId: null })]).sort()).toEqual(["a", "b"]);
  });
});
