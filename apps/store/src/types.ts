export interface StoreConfig {
  business: {
    name: string;
    tagline?: string;
    accentColor?: string;
    minOrderAmount?: string;
    deliveryNote?: string;
    whatsappNumber?: string;
    currency: string;
    phone?: string;
    email?: string;
    city?: string;
    state?: string;
    address?: string;
    // Versioned path to the storefront logo, or null when the business has
    // no logo uploaded. Carries a `?v=<timestamp>` cache-buster so the
    // browser refreshes automatically when the owner changes the logo.
    logoUrl?: string | null;
    // Which ways to pay checkout offers (the server decides; absent on an older API = Cash on Delivery only).
    payments?: { online: boolean; cod: boolean };
  };
  items: StoreItem[];
  categories: string[];
}

export interface StoreItem {
  id: string;
  name: string;
  description?: string;
  price: string;
  unit: string;
  category?: string;
  inStock: boolean;
  lowStock?: boolean;
  sortOrder: number;
  taxPercent?: string;
  taxInclusive?: boolean;
  itemMode: "simple" | "alt_units" | "variants";
  unitVariants?: Array<{
    unit: string;
    conversionFactor: number;
    price: string;
  }>;
  variantAttributes?: string[];
  variants?: Array<{
    id: string;
    attributes: Record<string, string>;
    price: string;
    inStock: boolean;
  }>;
}

export interface CartItem {
  item: StoreItem;
  quantity: number;
  selectedUnit?: string;
  conversionFactor?: number;
  selectedVariantId?: string;
  effectivePrice: string;
}

/** Unique key for a cart entry — same item with different variant/unit = different entry */
export function cartItemKey(entry: CartItem): string {
  if (entry.selectedVariantId) return `${entry.item.id}::v::${entry.selectedVariantId}`;
  if (entry.selectedUnit) return `${entry.item.id}::u::${entry.selectedUnit}`;
  return entry.item.id;
}

export type PaymentMethod = "online" | "cod";

export interface OrderResult {
  orderId: string;
  orderNumber: string;
  totalAmount: string;
  subtotal?: string;
  taxAmount?: string;
  message?: string;
  paymentMethod?: PaymentMethod;
  paymentStatus?: string;
  /** Razorpay's hosted payment page for an online order, when it could be made. */
  paymentUrl?: string | null;
  /** Shown politely when the payment page could not be made; the order itself is saved. */
  paymentError?: string;
}

/** An order as its shopper may see it (the public order page). */
export interface PublicOrder {
  orderId: string;
  orderNumber: string;
  status: string;
  paymentMethod: PaymentMethod;
  /** unpaid | paid | partially_refunded | refunded */
  paymentStatus: string;
  currency: string;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  refundedAmount: string;
  balance: string | null;
  canPayOnline: boolean;
  lines: Array<{ name: string; quantity: string; total: string }>;
  createdAt: string;
}

/** A safe block tree for policy text. The API sends these; the storefront never receives HTML. */
export type PolicyInline =
  | { type: "text"; text: string }
  | { type: "strong"; text: string }
  | { type: "link"; text: string; href: string };

export type PolicyBlock =
  | { type: "heading"; level: 2 | 3; inline: PolicyInline[] }
  | { type: "paragraph"; inline: PolicyInline[] }
  | { type: "list"; ordered: boolean; items: PolicyInline[][] };

export interface StorePolicies {
  business: { name: string };
  policies: Array<{
    kind: "terms" | "refund" | "shipping" | "contact" | "privacy";
    title: string;
    shortTitle: string;
    path: string;
    blocks: PolicyBlock[];
    updatedAt: string | null;
  }>;
}
