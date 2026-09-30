import { ApiIcon, FileValidationIcon, Store01Icon } from "@hugeicons/core-free-icons";
import { partnerTypes, type PartnerType } from "@fintranzact/shared";
import type { IconSvgElement } from "@/components/ui/Icon";

/**
 * The partner programmes shown on /partners and offered on the application
 * form at /partners/apply.
 */
export type PartnerProgram = {
  id: PartnerType;
  icon: IconSvgElement;
  title: string;
  /** Button label that opens the application form with this programme picked. */
  apply: string;
  body: string;
  points: string[];
};

export const PARTNER_PROGRAMS: PartnerProgram[] = [
  {
    id: "accountant",
    icon: FileValidationIcon,
    title: "Accountants & CA firms",
    apply: "Apply as an accountant",
    body: "Manage all your clients' books, GST returns and reconciliations from one login.",
    points: ["One dashboard for every client business", "Role-based access with your staff", "GSTR-1, 3B and 2B ready to review"],
  },
  {
    id: "reseller",
    icon: Store01Icon,
    title: "Resellers & consultants",
    apply: "Apply as a reseller",
    body: "Recommend Fintranzact to the businesses you work with and help them get set up.",
    points: ["Earn on the paid plans you bring in", "Sales and onboarding material", "A partner contact at Fintranzact"],
  },
  {
    id: "technology",
    icon: ApiIcon,
    title: "Technology partners",
    apply: "Apply as a technology partner",
    body: "Connect your app to Fintranzact through our API and reach Indian businesses that bill with us.",
    points: ["API keys and developer docs", "Help testing your integration", "Listed as an integration partner"],
  },
];

/** The programme named in a ?type= search param, or undefined when it names none. */
export function parsePartnerType(value: unknown): PartnerType | undefined {
  return typeof value === "string" && (partnerTypes as readonly string[]).includes(value) ? (value as PartnerType) : undefined;
}
