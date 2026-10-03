/**
 * Upcoming features board in the platform admin console: the one-time seed,
 * filters, create/update/delete, checklist ticks and reordering.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { roadmapItems, systemConfig } from "@fintranzact/db";
import { getControlDb, getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createUser, createTenant, addMember, createBusiness, type TestUser, type TestTenant, type TestBusiness } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { ensureRoadmapSeeded, resetRoadmapSeedCache, roadmapAdditionKey, roadmapProgressKey } from "../../lib/roadmap.js";
import { ROADMAP_ADDITIONS, ROADMAP_PROGRESS, ROADMAP_SEED } from "../../lib/roadmap-seed.js";
import { roadmapRank } from "@fintranzact/shared";

const ADMIN_EMAIL = "roadmap.admin@fintranzact.com";

let admin: TestUser;
let owner: TestUser;
let tenant: TestTenant;
let business: TestBusiness;
let savedEnv: NodeJS.ProcessEnv;

const callerFor = (user: TestUser) =>
  createTestCaller({ userId: user.id, email: user.email, name: user.name ?? null, tenantId: tenant.id, businessId: business.id });
const adminCaller = () => callerFor(admin);

async function forgetSeed() {
  const db = getControlDb();
  await db.delete(roadmapItems);
  await db.delete(systemConfig).where(like(systemConfig.key, "roadmap_%"));
  resetRoadmapSeedCache();
}

beforeAll(async () => {
  savedEnv = { ...process.env };
  process.env.PLATFORM_ADMIN_EMAIL = ADMIN_EMAIL;
  delete process.env.PLATFORM_ADMIN_EMAILS;
  admin = await createUser({ email: ADMIN_EMAIL, name: "Roadmap Admin" });
  owner = await createUser({ email: "owner.roadmap@patelstores.in", name: "Nikhil Patel" });
  tenant = await createTenant({ name: "Patel Stores Org" });
  await addMember(tenant.id, owner.id, "owner");
  business = await createBusiness(getTenantTestDb(), owner.id, { name: "Patel Stores" });
  await forgetSeed();
});

afterAll(async () => {
  await forgetSeed();
  process.env = savedEnv;
  await truncateAllTables();
  await closeTestDb();
});

describe("starting roadmap", () => {
  it("fills an empty board the first time it is opened", async () => {
    const list = await adminCaller().platform.roadmapList();
    expect(list.data).toHaveLength(ROADMAP_SEED.length);
    expect(ROADMAP_SEED.length).toBe(70);
    expect(new Set(list.data.map((i) => i.title))).toEqual(new Set(ROADMAP_SEED.map((s) => s.title)));
    // Items built since the roadmap was written arrive already moved.
    expect(list.counts.done).toBe(3); // + old docs domains redirect (2026-10-03-old-docs-redirect)
    expect(list.counts.in_progress).toBe(14); // + two-factor authentication (2026-10-02-2fa), CA access (2026-10-02-ca-access), HSN / SAC through Sandbox (2026-10-03-hsn-sandbox), Full Access Trial (2026-10-03-p2-trial)
    expect(list.counts.planned).toBe(ROADMAP_SEED.length - 17);
    expect(list.stageCounts).toEqual({ before_launch: 18, after_launch: 52 });
    expect(list.categories).toEqual(expect.arrayContaining(["Payroll", "Inventory", "GST", "Mobile", "Platform", "Accounting", "Banking"]));
    for (const item of list.data) {
      expect(item.description.length, item.title).toBeGreaterThan(80);
      expect(item.checklist.length, item.title).toBeGreaterThanOrEqual(4);
      if (item.status === "planned") expect(item.checklist.every((c) => c.done === false), item.title).toBe(true);
    }

    const byTitle = (start: string) => list.data.find((i) => i.title.startsWith(start))!;
    const phase1 = byTitle("Payroll — Phase 1");
    expect(phase1).toMatchObject({
      category: "Payroll",
      phase: 1,
      billing: "paid_add_on",
      status: "planned",
      priority: "high",
      launchStage: "after_launch",
    });
    expect(phase1.description).toContain("50% of total remuneration");
    expect(phase1.checklist.length).toBeGreaterThan(10);
    expect(byTitle("Payroll — Phase 2")).toMatchObject({ priority: "medium", launchStage: "after_launch" });
    expect(byTitle("Payroll add-on billing")).toMatchObject({ priority: "high", launchStage: "after_launch" });
    expect(byTitle("Serial / IMEI")).toMatchObject({ priority: "medium", launchStage: "after_launch" });
    expect(byTitle("TDS & TCS")).toMatchObject({ priority: "high", launchStage: "before_launch", billing: "included" });
    expect(byTitle("Budgets vs actuals")).toMatchObject({ priority: "low", launchStage: "after_launch" });
    expect(byTitle("Online payments at store checkout")).toMatchObject({ category: "Online store", priority: "high", launchStage: "before_launch" });
    expect(byTitle("Store policy pages")).toMatchObject({ category: "Online store", launchStage: "before_launch" });
    expect(byTitle("Custom domain for stores").description).toContain("stores.fintranzact.com");
    expect(byTitle("Store Pro add-on billing")).toMatchObject({ billing: "paid_add_on", priority: "high", launchStage: "after_launch" });
    expect(list.data.filter((i) => i.category === "Online store")).toHaveLength(9);
    const ai = list.data.filter((i) => i.category === "AI");
    expect(ai.map((i) => [i.phase, i.priority])).toEqual([[1, "high"], [2, "medium"], [3, "medium"]]);
    expect(ai[0]).toMatchObject({ billing: "paid_add_on", launchStage: "after_launch" });
    expect(ai[0]!.description).toContain("never another business's data");

    const domains = byTitle("Redirect old docs");
    expect(domains).toMatchObject({ category: "Platform", status: "done", billing: "included", priority: "high", launchStage: "before_launch" });
    expect(domains.description).toContain("api-docs.fintranzact.com → /developers");
    expect(list.data.filter((i) => i.title.toLowerCase().includes("redirect"))).toHaveLength(1);
  });

  it("lists before-launch and high-priority work first", async () => {
    const list = (await adminCaller().platform.roadmapList()).data;
    const ranks = list.map((i) => (i.launchStage === "before_launch" ? 0 : 10) + ["high", "medium", "low"].indexOf(i.priority));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(list[0]).toMatchObject({ launchStage: "before_launch", priority: "high" });
    expect(list.at(-1)).toMatchObject({ launchStage: "after_launch", priority: "low" });
  });

  it("puts plans, trial and billing first, then the build order", async () => {
    const list = (await adminCaller().platform.roadmapList()).data;
    expect(list.slice(0, 6).map((i) => i.title.slice(0, 3))).toEqual(["P1.", "P2.", "P3.", "P4.", "P5.", "Onl"]);
    for (const item of list.slice(0, 5)) expect(item.description).toMatch(/^\*\*Build order: 1\*\*/);
    const afterHigh = list.filter((i) => i.launchStage === "after_launch" && i.priority === "high").map((i) => i.title);
    expect(afterHigh.slice(0, 6).map((t) => t.split(/[—:]/)[0]!.trim())).toEqual([
      "AI business assistant",
      "Payroll",
      "Payroll add-on billing",
      "Store Pro add-on billing",
      "Custom domain for stores",
      "Store themes",
    ]);
    expect(list.find((i) => i.title.startsWith("P1."))!.description).toContain("No free plan");
    expect(list.find((i) => i.title.startsWith("P2."))!.description).toContain("read-only");
    expect(list.find((i) => i.title.startsWith("Payroll add-on billing"))!.priceNote).toContain("₹49");
    expect(list.find((i) => i.title.startsWith("Store Pro"))!.priceNote).toContain("₹499");
    expect(list.find((i) => i.title.startsWith("AI business assistant — Phase 1"))!.priceNote).toContain("₹399");
  });

  it("filters by launch stage", async () => {
    const before = await adminCaller().platform.roadmapList({ launchStage: "before_launch" });
    expect(before.data).toHaveLength(18);
    expect(before.data.every((i) => i.launchStage === "before_launch")).toBe(true);
    expect(before.counts.planned).toBe(4); // 8 before CA access (2026-10-02-ca-access) moved to in_progress, then HSN / SAC through Sandbox (2026-10-03-hsn-sandbox) the old docs redirect (2026-10-03-old-docs-redirect) and the Full Access Trial (2026-10-03-p2-trial) moved on
    expect(before.stageCounts).toEqual({ before_launch: 18, after_launch: 52 });
  });

  it("seeds only once, even if the board is emptied later", async () => {
    const db = getControlDb();
    await db.delete(roadmapItems);
    resetRoadmapSeedCache();
    expect(await ensureRoadmapSeeded()).toBe(0);
    expect((await adminCaller().platform.roadmapList()).data).toEqual([]);
  });

  it("adds a later batch once to a board seeded before it existed", async () => {
    await forgetSeed();
    await adminCaller().platform.roadmapList();
    const batch = ROADMAP_ADDITIONS.find((b) => b.key === "2026-10-government-filing")!;
    const titles = batch.items.map((i) => i.title);
    expect(titles).toEqual([
      "Connect e-invoice, e-way bill and GST returns through Sandbox.co.in",
      "TDS & TCS return filing and certificates through Sandbox.co.in",
      "GST TDS & TCS credits (GSTR-2X)",
    ]);
    // An older board: seeded, but without this batch and its marker.
    const db = getControlDb();
    await db.delete(roadmapItems).where(inArray(roadmapItems.title, titles.slice(1)));
    await db.delete(systemConfig).where(eq(systemConfig.key, roadmapAdditionKey(batch.key)));
    resetRoadmapSeedCache();

    expect(await ensureRoadmapSeeded()).toBe(2);
    const list = (await adminCaller().platform.roadmapList()).data;
    expect(list).toHaveLength(ROADMAP_SEED.length);
    expect(list.filter((i) => titles.includes(i.title))).toHaveLength(3);
    const gsp = list.find((i) => i.title === titles[0])!;
    expect(gsp).toMatchObject({ category: "GST", launchStage: "before_launch", priority: "high" });
    expect(gsp.description).toContain("Sandbox.co.in");

    // Deleting an added item later sticks.
    await db.delete(roadmapItems).where(eq(roadmapItems.title, titles[2]!));
    resetRoadmapSeedCache();
    expect(await ensureRoadmapSeeded()).toBe(0);
    expect((await adminCaller().platform.roadmapList()).data).toHaveLength(ROADMAP_SEED.length - 1);
  });

  it("marks finished and started work on an older board, once", async () => {
    await forgetSeed();
    await adminCaller().platform.roadmapList();
    const db = getControlDb();
    // An older board: seeded before the progress batch existed.
    await db.update(roadmapItems).set({ status: "planned" });
    const rows = await db.select().from(roadmapItems);
    for (const row of rows) {
      await db.update(roadmapItems).set({ checklist: row.checklist.map((c) => ({ ...c, done: false })) }).where(eq(roadmapItems.id, row.id));
    }
    // An admin already moved one of the items on their own.
    await db.update(roadmapItems).set({ status: "dropped" }).where(eq(roadmapItems.title, "Store policy pages"));
    await db.delete(systemConfig).where(eq(systemConfig.key, roadmapProgressKey(ROADMAP_PROGRESS[0]!.key)));
    resetRoadmapSeedCache();

    expect(await ensureRoadmapSeeded()).toBe(0);
    const list = (await adminCaller().platform.roadmapList()).data;
    const byTitle = (title: string) => list.find((i) => i.title === title)!;
    const bank = byTitle("Bank statement import: Excel, OFX/QIF and PDF");
    expect(bank.status).toBe("done");
    expect(bank.checklist.every((c) => c.done)).toBe(true);
    expect(byTitle("P3. Checkout & subscription billing").status).toBe("in_progress");
    const exports = byTitle("Multi-currency and export invoices");
    expect(exports.status).toBe("in_progress");
    expect(exports.checklist.filter((c) => c.done).map((c) => c.text)).toEqual(["Export invoice under LUT/bond", "Export with IGST paid"]);
    const store = byTitle("Store policy pages");
    expect(store.status).toBe("dropped");
    expect(store.checklist.filter((c) => c.done).map((c) => c.text)).toEqual(["Pre-fill from business details"]);

    // Applied once: undoing it by hand later sticks.
    await db.update(roadmapItems).set({ status: "planned" }).where(eq(roadmapItems.id, bank.id));
    resetRoadmapSeedCache();
    await ensureRoadmapSeeded();
    expect((await adminCaller().platform.roadmapList()).data.find((i) => i.id === bank.id)!.status).toBe("planned");
  });

  it("names only real titles and checklist lines in progress batches", () => {
    for (const batch of ROADMAP_PROGRESS) {
      for (const update of batch.updates) {
        const item = ROADMAP_SEED.find((i) => i.title === update.title);
        expect(item, update.title).toBeDefined();
        for (const line of update.done) expect(item!.checklist, `${update.title}: ${line}`).toContain(line);
      }
    }
  });

  it("does not seed over a board that already has items", async () => {
    await forgetSeed();
    await adminCaller().platform.roadmapCreate({ title: "Existing idea", category: "Other" });
    resetRoadmapSeedCache();
    expect(await ensureRoadmapSeeded()).toBe(0);
    expect((await adminCaller().platform.roadmapList()).data.map((i) => i.title)).toEqual(["Existing idea"]);
  });
});

describe("managing features", () => {
  let id: string;

  beforeAll(async () => {
    await forgetSeed();
    await ensureRoadmapSeeded(); // seed, then start from a clean board for these tests
    await getControlDb().delete(roadmapItems);
  });

  it("creates a feature with its checklist and records who added it", async () => {
    const created = await adminCaller().platform.roadmapCreate({
      title: "Payroll — Phase 1",
      description: "Employees, attendance and payslips.",
      category: "Payroll",
      status: "planned",
      priority: "high",
      launchStage: "before_launch",
      phase: 1,
      target: "2026-12",
      billing: "paid_add_on",
      priceNote: "₹ per employee / month",
      checklist: [{ text: "Employee master", done: false }, { text: "Payslips", done: false }, { text: "Bank file" }],
    });
    id = created.id;
    expect(created).toMatchObject({
      status: "planned",
      target: "2026-12",
      billing: "paid_add_on",
      createdByUserId: admin.id,
      checklist: [
        { text: "Employee master", done: false },
        { text: "Payslips", done: false },
        { text: "Bank file", done: false },
      ],
    });
    await adminCaller().platform.roadmapCreate({ title: "Serial numbers", category: "Inventory" });
    await adminCaller().platform.roadmapCreate({ title: "E-way bills from challans", category: "GST", status: "idea", priority: "low" });
  });

  it("uses sensible defaults", async () => {
    const serial = (await adminCaller().platform.roadmapList({ search: "serial" })).data[0]!;
    expect(serial).toMatchObject({ status: "idea", priority: "medium", launchStage: "after_launch", billing: "included", phase: null, target: null, priceNote: null, checklist: [] });
  });

  it("filters by status, category and search", async () => {
    const caller = adminCaller();
    expect((await caller.platform.roadmapList({ status: "planned" })).data.map((i) => i.title)).toEqual(["Payroll — Phase 1"]);
    expect((await caller.platform.roadmapList({ category: "gst" })).data.map((i) => i.title)).toEqual(["E-way bills from challans"]);
    expect((await caller.platform.roadmapList({ search: "payslips" })).data.map((i) => i.id)).toEqual([id]);
    const counts = (await caller.platform.roadmapList({ status: "planned" })).counts;
    expect(counts).toEqual({ idea: 2, planned: 1, in_progress: 0, done: 0, dropped: 0 });
  });

  it("moves a feature and ticks checklist lines", async () => {
    const before = (await adminCaller().platform.roadmapList({ search: "Payroll" })).data[0]!;
    const moved = await adminCaller().platform.roadmapUpdate({
      id,
      status: "in_progress",
      checklist: before.checklist.map((c, i) => ({ ...c, done: i === 0 })),
    });
    expect(moved.status).toBe("in_progress");
    expect(moved.checklist.filter((c) => c.done)).toEqual([{ text: "Employee master", done: true }]);
    expect(moved.title).toBe("Payroll — Phase 1");
    expect(new Date(moved.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(before.updatedAt).getTime());
  });

  it("clears the target and price note", async () => {
    const row = await adminCaller().platform.roadmapUpdate({ id, target: null, priceNote: "", billing: "included" });
    expect(row).toMatchObject({ target: null, priceNote: null, billing: "included" });
  });

  it("rejects bad input", async () => {
    await expect(adminCaller().platform.roadmapCreate({ title: "", category: "Payroll" })).rejects.toThrow();
    await expect(adminCaller().platform.roadmapCreate({ title: "Thing", category: "Other", target: "Dec 2026" })).rejects.toThrow();
    await expect(
      adminCaller().platform.roadmapUpdate({ id, status: "shipped" as never }),
    ).rejects.toThrow();
    await expect(adminCaller().platform.roadmapUpdate({ id, checklist: [{ text: "  ", done: false }] })).rejects.toThrow();
    await expect(
      adminCaller().platform.roadmapUpdate({ id: "00000000-0000-4000-8000-000000000000", title: "Nope" }),
    ).rejects.toThrow(/Feature not found/);
  });

  it("changes the launch stage", async () => {
    const row = await adminCaller().platform.roadmapUpdate({ id, launchStage: "after_launch" });
    expect(row.launchStage).toBe("after_launch");
    expect((await adminCaller().platform.roadmapList({ launchStage: "before_launch" })).data).toEqual([]);
    await adminCaller().platform.roadmapUpdate({ id, launchStage: "before_launch" });
  });

  it("reorders the board within the same stage and priority", async () => {
    await adminCaller().platform.roadmapCreate({ title: "Landed cost", category: "Inventory" });
    await adminCaller().platform.roadmapCreate({ title: "Job work", category: "Inventory" });
    const all = (await adminCaller().platform.roadmapList()).data;
    const reversed = [...all].reverse();
    expect(await adminCaller().platform.roadmapReorder({ ids: reversed.map((i) => i.id) })).toEqual({ count: all.length });
    // Stage and priority still come first; the new order applies inside each group.
    const expected = [...reversed].sort((a, b) => roadmapRank(a) - roadmapRank(b)).map((i) => i.title);
    const after = (await adminCaller().platform.roadmapList()).data.map((i) => i.title);
    expect(after).toEqual(expected);
    expect(after.indexOf("Job work")).toBeLessThan(after.indexOf("Landed cost"));
  });

  it("adds new features at the end", async () => {
    const created = await adminCaller().platform.roadmapCreate({ title: "Kits and bundles", category: "Inventory", priority: "low" });
    const all = (await adminCaller().platform.roadmapList()).data;
    expect(all.at(-1)?.id).toBe(created.id);
  });

  it("deletes a feature", async () => {
    await adminCaller().platform.roadmapDelete({ id });
    expect((await adminCaller().platform.roadmapList()).data.map((i) => i.id)).not.toContain(id);
    await expect(adminCaller().platform.roadmapDelete({ id })).rejects.toThrow(/Feature not found/);
  });

  it("is closed to everyone but platform admins", async () => {
    const other = callerFor(owner).platform;
    const any = "00000000-0000-4000-8000-000000000000";
    for (const call of [
      () => other.roadmapList(),
      () => other.roadmapCreate({ title: "Sneaky", category: "Other" }),
      () => other.roadmapUpdate({ id: any, status: "done" }),
      () => other.roadmapDelete({ id: any }),
      () => other.roadmapReorder({ ids: [any] }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});
