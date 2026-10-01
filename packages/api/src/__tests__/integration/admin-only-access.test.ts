/**
 * Owner decisions:
 *  - Only owners and admins see the organisation's pending invitations
 *    (they show invitee emails).
 *  - A new business is opened automatically to the organisation's owners and
 *    admins; other members get access only when it is granted.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { businessMembers } from "@fintranzact/db";
import { createUser, createTenant, addMember, type TestUser, type TestTenant } from "../helpers/fixtures.js";
import { getTenantTestDb, truncateAllTables } from "../helpers/test-db.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";

const factory = createCallerFactory(appRouter);
const callerFor = (user: TestUser, tenantId: string) =>
  factory({
    user: { id: user.id, email: user.email, name: user.name ?? null },
    tenantId,
    businessId: null,
    req: new Request("http://localhost:3000/api/trpc/test", { method: "POST", headers: new Headers({ "content-type": "application/json" }) }),
    resHeaders: new Headers(),
    ipAddress: null,
  });

let owner: TestUser;
let admin: TestUser;
let seller: TestUser;
let tenant: TestTenant;

beforeAll(async () => {
  owner = await createUser({ email: "owner.adminonly@example.in", name: "Owner" });
  admin = await createUser({ email: "admin.adminonly@example.in", name: "Admin" });
  seller = await createUser({ email: "seller.adminonly@example.in", name: "Seller" });
  tenant = await createTenant();
  await addMember(tenant.id, owner.id, "owner");
  await addMember(tenant.id, admin.id, "admin");
  await addMember(tenant.id, seller.id, "seller");
});

afterAll(async () => {
  await truncateAllTables();
});

describe("pending invitations", () => {
  it("are listed for owners and admins, empty for other members", async () => {
    await callerFor(owner, tenant.id).tenant.inviteMember({ email: "new.person@example.in", role: "seller" });
    expect((await callerFor(owner, tenant.id).tenant.pendingInvitations()).map((i) => i.email)).toContain("new.person@example.in");
    expect((await callerFor(admin, tenant.id).tenant.pendingInvitations()).map((i) => i.email)).toContain("new.person@example.in");
    expect(await callerFor(seller, tenant.id).tenant.pendingInvitations()).toEqual([]);
  });
});

describe("a new business", () => {
  it("is opened to the creator and the organisation's admins, not to other members", async () => {
    const biz = await callerFor(owner, tenant.id).business.create({
      name: "New Branch",
      pan: "ABCDE1234F",
      phone: "9876543210",
      address: "12, Gandhi Nagar, Jaipur",
      city: "Jaipur",
      state: "Rajasthan",
      stateCode: "08",
      pincode: "302001",
      gstRegistrationType: "regular",
      gstin: "08ABCDE1234F1Z5",
      invoicePrefix: "NB",
      currency: "INR",
    } as never);
    const rows = await getTenantTestDb().select({ userId: businessMembers.userId, role: businessMembers.role })
      .from(businessMembers)
      .where(and(eq(businessMembers.businessId, biz.id)));
    const byUser = new Map(rows.map((r) => [r.userId, r.role]));
    expect(byUser.get(owner.id)).toBe("admin");
    expect(byUser.get(admin.id)).toBe("admin");
    expect(byUser.has(seller.id)).toBe(false);
  });
});
