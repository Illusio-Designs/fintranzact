/**
 * When a signed-in person has no organisation selected and belongs to exactly
 * one, it is selected for them (no picker). Not while a selection is already
 * in flight or has just succeeded (the session refresh is on its way).
 */
export function shouldAutoSelectTenant(opts: {
  signedIn: boolean;
  selectedTenantId?: string | null;
  tenantCount: number | undefined;
  selectPending: boolean;
  selectSucceeded: boolean;
}): boolean {
  return opts.signedIn && !opts.selectedTenantId && opts.tenantCount === 1 && !opts.selectPending && !opts.selectSucceeded;
}
