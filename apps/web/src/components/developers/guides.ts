import type { DEVELOPER_GUIDE_SLUGS } from "@/lib/developer-paths";

/** The hand-written guide pages under /developers, in sidebar order. */
export const GUIDES: Array<{
  slug: (typeof DEVELOPER_GUIDE_SLUGS)[number];
  navLabel: string;
  title: string;
  description: string;
}> = [
  {
    slug: "authentication",
    navLabel: "Authentication & access",
    title: "Authentication and access",
    description:
      "Sign in with a session cookie, a bearer token or an API key, pick the business with the x-business-id header, and see what each team role can do.",
  },
  {
    slug: "conventions",
    navLabel: "Conventions & limits",
    title: "Conventions and rate limits",
    description:
      "How the Fintranzact API sends money, dates and pages of results, how queries and mutations travel over tRPC, and the per-minute rate limits.",
  },
  {
    slug: "faq",
    navLabel: "FAQ",
    title: "API questions and answers",
    description:
      "Answers for developers, AI agent builders, CAs and business owners using the Fintranzact API: invoices, GST returns, bank reconciliation and more.",
  },
];
