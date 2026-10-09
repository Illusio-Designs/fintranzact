# Access control and offboarding

Owner: [security owner]. Last reviewed: 2026-10-09. Next review: 2027-04-09.

**STATUS.** Product roles, per-business scoping, TOTP 2FA with organisation-level enforcement, session revocation and an access-event trail are implemented. Staff access to vendor consoles, the quarterly review and the 24-hour leaver rule are **process only**: nothing automated checks them yet.

## Access inside the product (customers' people)

Roles stored in `tenant_members.role` (enum `member_role`), turned into permissions by CASL (`packages/api/src/lib/permissions.ts`). In use: `owner`, `admin`, `member`, `viewer` (older), `superadmin`, `seller_manager`, `seller`, `accountant`, `auditor`, `ca_filing`, `hr`, `employee`. Accountant-style roles are read-only or filing-only (`docs/ACCOUNTANT-ACCESS.md`); `employee` sees only their own attendance, payslips and loans; sellers cannot change tax rates or discounts. Every query is scoped to the business of the signed-in member; `docs/security-cross-tenant-audit.md` records the review.

Two-factor authentication (authenticator app + backup codes, `docs/TWO-FACTOR.md`): any user can turn it on; an organisation owner can require it for admins or everyone with a grace period. Platform admins can reset a user's 2FA; the reset is recorded. Role changes, invitations, exports and organisation opens write `access.*` rows to `security_events`. Sessions expire after 30 days and can be revoked.

## Access for Fintranzact staff and tools

| System | Who | Rule |
|---|---|---|
| GitHub (repo, Actions, Dependabot) | engineering | Named accounts, MFA, least role (write only for people who merge). Branch protection on `main` with the required checks. |
| Railway / AWS (API, database, logs) | [engineering lead] + [owner] | Named accounts, MFA, no shared login, no root/owner credentials for daily work. AWS: root locked away with MFA and no access keys. |
| Vercel (web) | [engineering lead] | MFA. |
| Razorpay (own account), Sandbox.co.in, Resend, MSG91, Anthropic console, Cloudflare | [owner] | MFA; API keys only in environment configuration. |
| Production database | [engineering lead] only, by exception | No standing personal access; use a bastion/one-off task and note why. |
| Platform admin screen in the product | [owner], [support lead] | Separate allowlist (`PLATFORM_ADMIN_EMAILS`); 2FA on; use only to support a customer who asked. |

Customers' data is looked at only to answer that customer's request and only to the extent needed.

## Quarterly access review (30 minutes)

Evidence: a dated note [location] with the list checked and what changed.

1. Export the member lists of GitHub, Railway/AWS, Vercel, and the vendor consoles above. Everyone listed must still work here and need that level.
2. Check MFA is on for each (GitHub org people page; others by asking).
3. Review the platform-admin allowlist and the `PLATFORM_ADMIN_EMAILS` value.
4. List API keys and tokens held by people or services; revoke anything unused.
5. Read recent `access.role_changed` and `2fa.reset_by_admin` events in `security_events` for anything nobody remembers doing.

## Leaver checklist (do within 24 hours; same day if the leaving was not friendly)

- [ ] Remove from GitHub organisation, Railway/AWS, Vercel, Cloudflare, Razorpay, Sandbox, Resend, MSG91, Anthropic console, domain registrar, email, password manager shared vaults.
- [ ] Remove from `PLATFORM_ADMIN_EMAILS` and from any Fintranzact organisation they were a member of for work.
- [ ] Revoke personal access tokens, deploy keys, SSH keys, API keys they created. **Rotate** any shared secret they could read ([secrets-management.md](secrets-management.md)); rotating `ENCRYPTION_KEY` is [key-rotation.md](key-rotation.md).
- [ ] Recover or wipe devices; confirm no production data on them.
- [ ] Hand over their open work and ownership of calendar items.
- [ ] Record the date and who did it. Joiners: give the least role, enable MFA the first day, read the policy.

A lost or stolen device is handled as a leaver for that device: revoke its sessions and tokens at once, then tell the security owner.
