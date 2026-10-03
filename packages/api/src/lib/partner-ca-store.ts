/** Real control-DB store for lib/partner-ca.ts. */
import { and, eq, isNull, sql } from "drizzle-orm";
import { controlDb, partners, tenants, users } from "@fintranzact/db";
import type { AttributionStore } from "./partner-ca.js";

export const partnerCaStore: AttributionStore = {
  async partnersByEmails(emails) {
    if (emails.length === 0) return [];
    const list = sql.join(emails.map((e) => sql`${e}`), sql`, `);
    return controlDb
      .select({
        id: partners.id,
        companyName: partners.companyName,
        email: partners.email,
        status: partners.status,
        partnerType: partners.partnerType,
        createdAt: partners.createdAt,
      })
      .from(partners)
      .where(sql`lower(${partners.email}) in (${list})`);
  },
  async usersByEmails(emails) {
    if (emails.length === 0) return [];
    const list = sql.join(emails.map((e) => sql`${e}`), sql`, `);
    return controlDb
      .select({ email: users.email, emailVerified: users.emailVerified })
      .from(users)
      .where(sql`lower(${users.email}) in (${list})`);
  },
  async tenantPartnerId(tenantId) {
    const [row] = await controlDb.select({ partnerId: tenants.partnerId }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    return row?.partnerId ?? null;
  },
  async setTenantPartnerIfNone(tenantId, partnerId) {
    const rows = await controlDb
      .update(tenants)
      .set({ partnerId })
      .where(and(eq(tenants.id, tenantId), isNull(tenants.partnerId)))
      .returning({ id: tenants.id });
    return rows.length > 0;
  },
};
