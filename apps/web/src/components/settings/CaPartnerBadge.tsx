/** Shown to owners and admins: this invited / joined accountant is a registered Fintranzact CA partner. */
export function CaPartnerBadge({ partner }: { partner: { id: string; companyName: string } | null | undefined }) {
  if (!partner) return null;
  return (
    <span
      data-testid="ca-partner-badge"
      title={`${partner.companyName} is a registered Fintranzact CA partner`}
      className="mt-1 inline-flex items-center gap-1 rounded bg-emerald-600/[0.08] px-2 py-0.5 text-2xs font-medium text-emerald-700 dark:text-emerald-400"
    >
      Registered CA partner
      <span className="font-normal text-text-secondary">{partner.companyName}</span>
    </span>
  );
}
