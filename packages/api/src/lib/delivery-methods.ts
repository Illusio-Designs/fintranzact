import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { businesses } from "@fintranzact/db";
import { deliveryMethods, isBuiltInDeliveryMethod } from "@fintranzact/shared";

type CustomMethod = { id: string; label: string; hasTracking: boolean };

/**
 * Finds a delivery method the business offers: a built-in one, or one of its
 * own from Settings → Shipping, matched by id or, for people typing it in a
 * CLI prompt, by its name. Returns the id to store, or null when the business
 * has no such method.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function findDeliveryMethod(db: any, businessId: string, method: string): Promise<string | null> {
  const wanted = method.trim();
  if (isBuiltInDeliveryMethod(wanted)) return wanted;
  const [biz] = await db
    .select({ customShippingMethods: businesses.customShippingMethods })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  const custom: CustomMethod[] = Array.isArray(biz?.customShippingMethods) ? biz.customShippingMethods : [];
  const byId = custom.find((m) => m.id === wanted);
  if (byId) return byId.id;
  const byLabel = custom.find((m) => m.label.trim().toLowerCase() === wanted.toLowerCase());
  return byLabel?.id ?? null;
}

/** Like findDeliveryMethod, but a method the business doesn't offer is a bad request. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveDeliveryMethod(db: any, businessId: string, method: string): Promise<string> {
  const found = await findDeliveryMethod(db, businessId, method);
  if (found) return found;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: `Unknown delivery method "${method}". Use one of ${deliveryMethods.join(", ")}, or add it in Settings → Shipping.`,
  });
}
