/**
 * journey-seed.ts — Prerequisites that another journey owns, created through
 * the API (J1 covers signing up and onboarding in the UI; invoices and
 * payments have their own journeys).
 *
 * Calls go through `context.request`, which shares the browser context's
 * cookie jar: after `seedOwner`, pages opened in that context are signed in as
 * the new owner.
 */
import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { API_URL, uid } from "./journey";

export class Trpc {
  constructor(
    private request: APIRequestContext,
    public businessId?: string,
  ) {}

  private headers() {
    return {
      "Content-Type": "application/json",
      "X-Requested-With": "fintranzact",
      ...(this.businessId ? { "x-business-id": this.businessId } : {}),
    };
  }

  async mutate<T = any>(procedure: string, input: unknown): Promise<T> {
    const res = await this.request.post(`${API_URL}/api/trpc/${procedure}`, {
      headers: this.headers(),
      data: { json: input },
    });
    if (!res.ok()) throw new Error(`tRPC ${procedure} failed (${res.status()}): ${await res.text()}`);
    const body = await res.json();
    return body.result?.data?.json ?? body.result?.data;
  }

  async query<T = any>(procedure: string, input?: unknown): Promise<T> {
    const q = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
    const res = await this.request.get(`${API_URL}/api/trpc/${procedure}${q}`, { headers: this.headers() });
    if (!res.ok()) throw new Error(`tRPC ${procedure} query failed (${res.status()}): ${await res.text()}`);
    const body = await res.json();
    return body.result?.data?.json ?? body.result?.data;
  }
}

export type SeededOwner = {
  email: string;
  password: string;
  name: string;
  userId: string;
  tenantId: string;
  businessId: string;
  businessName: string;
  api: Trpc;
};

/** A signed-up owner (Forever Free) with one GST-registered business in Maharashtra. */
export async function seedOwner(context: BrowserContext, label: string): Promise<SeededOwner> {
  const id = uid();
  const email = `${label}-owner-${id}@test.fintranzact.com`;
  const password = "Journey@1234";
  const name = `${label.toUpperCase()} Owner ${id}`;
  const api = new Trpc(context.request);

  const reg = await api.mutate<{ user: { id: string } }>("auth.register", {
    username: name,
    email,
    password,
    confirmPassword: password,
  });
  await api.mutate("tenant.updatePlan", { plan: "forever_free" });
  const me = await api.query<{ tenantId: string }>("auth.me");
  const businessName = `${label.toUpperCase()} Enterprises ${id}`;
  const biz = await api.mutate<{ id: string }>("business.create", {
    name: businessName,
    gstRegistrationType: "regular",
    gstin: "27AAPFU0939F1ZV",
    pan: "AAPFU0939F",
    phone: "+919876500001",
    address: "1 Test Road",
    addressLine1: "1 Test Road",
    city: "Mumbai",
    state: "Maharashtra",
    stateCode: "27",
    pincode: "400001",
    countryOfOperations: "India",
    currency: "INR",
  });
  api.businessId = biz.id;
  return { email, password, name, userId: reg.user.id, tenantId: me.tenantId, businessId: biz.id, businessName, api };
}
