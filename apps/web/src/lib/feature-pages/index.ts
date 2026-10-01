import type { FeatureSlug } from "@/lib/feature-slugs";
import { GST_PLATFORM_PAGES } from "./gst-platform";
import { INVENTORY_PAGES } from "./inventory";
import { SALES_MONEY_PAGES } from "./sales-money";
import type { FeaturePage } from "./types";

export type { FeaturePage } from "./types";

/** Every public feature page (/features/<slug>). */
export const FEATURE_PAGES: FeaturePage[] = [...SALES_MONEY_PAGES, ...GST_PLATFORM_PAGES, ...INVENTORY_PAGES];

const BY_SLUG = new Map<string, FeaturePage>(FEATURE_PAGES.map((p) => [p.slug, p]));

/** The page for a slug, or undefined for an unknown slug. */
export function featurePage(slug: string): FeaturePage | undefined {
  return BY_SLUG.get(slug as FeatureSlug);
}
