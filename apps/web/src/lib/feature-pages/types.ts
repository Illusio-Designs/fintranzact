import type { IconSvgElement } from "@/components/ui/Icon";
import type { FeatureSlug } from "@/lib/feature-slugs";

/** One public feature page, rendered by routes/features/$slug.tsx. */
export type FeaturePage = {
  slug: FeatureSlug;
  /** Page heading, e.g. "GST invoicing". */
  title: string;
  /** Short label used in menus and cards. */
  navLabel: string;
  /** One-line promise under the heading. */
  tagline: string;
  /** Meta description (120-160 characters). */
  summary: string;
  icon: IconSvgElement;
  /** Four to six key capabilities. */
  highlights: { title: string; body: string; icon: IconSvgElement }[];
  /** Three to five steps showing how it works in the product. */
  steps: { title: string; body: string }[];
  /** Two to four detail sections with bullet points. */
  details: { heading: string; points: string[] }[];
  /** Three to six questions. */
  faqs: { q: string; a: string }[];
  /** Two to four related feature pages. */
  related: FeatureSlug[];
  /** Matching help article, e.g. "/help/invoicing/create-invoice". */
  helpPath?: string;
};
