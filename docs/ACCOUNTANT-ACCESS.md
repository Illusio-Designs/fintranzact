# Accountant access: roles, permissions and the mutation backstop

Part 1 of "let a business invite its CA, and a CA work across many clients with one login" added the roles and the permission rules; Part 2 (below, "Invite my CA") adds the invite flow.

## The three accountant roles

| DB / role value | UI label | What it is |
|---|---|---|
| `accountant` (legacy `viewer` maps here) | Accountant (bookkeeping) | Unchanged. Keeps books: payments, expenses, bank, accounts, ITC, TDS, period locks; read on everything else. Live organisations rely on it. |
| `auditor` | Accountant (read-only) | Reads every book and report. Cannot create, change or delete anything. |
| `ca_filing` | Accountant (filing) | Everything `auditor` can read, plus preparing and filing GST returns. Cannot change the books. |

### CASL grants (`packages/api/src/lib/permissions.ts`)

- `auditor`: `read` on Invoice, Payment, Party, Item, Expense, BankAccount, BankTransaction, BankReconciliation, Account, Report, GstReport, ITC, Tds, EInvoice, EWayBill, Business, Store, RecurringInvoice. Nothing else.
- `ca_filing`: the same reads plus `create:GstReport`. That single grant covers all `gstReturns.*` procedures and `gstr2b.upload/linkInvoice/ignoreRecord`.

Consequences: reports, exports and GSTR-1/3B/9 data are queries behind `read:Report` / `read:GstReport`, so both roles can view and download them. TDS return data, certificates and 26AS views are `read:Tds` (allowed); TDS challans and 26AS linking stay denied. `gst.updateCompositionSettings` (`update:Business`), `business.exportData` (`manage:Business`), books lock / year close (`PeriodLock`), team, import and all owner-only gates are denied.

### Marking a return filed

`period.lockGstMonth` accepts `create:PeriodLock` **or** `create:GstReport` (`canMarkGstFiled`), so a filing accountant can mark a month filed without being able to lock the books or close a year. Unlocking and reopening remain owner-only.

## The mutation backstop

Some mutations are gated only by a read check (`share.create`, `share.revoke`, `stock.setup`), so a pure-read role would pass them. `withPermissions` in `packages/api/src/trpc.ts` therefore refuses **every mutation** for these two roles unless allowlisted, whatever the procedure's own check says:

- `auditor`: no mutation at all ("Your access is read-only...").
- `ca_filing`: only `CA_FILING_MUTATIONS` ("Filing access only..."):
  `gstReturns.requestOtp`, `verifyOtp`, `saveGstr1`, `fileGstr1`, `saveGstr3b`, `fileGstr3b`, `pull2b`, `gstr2b.upload`, `gstr2b.linkInvoice`, `gstr2b.ignoreRecord`, `period.lockGstMonth`.

The decision is the pure function `caRoleMutationAllowed(role, path)`. API keys resolve the same role through `tenant_members`, so the backstop applies equally. The backstop sits inside `withPermissions` (the CASL base), so it adds no middleware and does not change what `helpers/sweep-procs.ts` sees. Mutations on the tenant-scoped (non-CASL) base are guarded by their own owner/admin checks, which both roles fail. The one tenant-base mutation that creates a record, `business.ensureWalkInParty` (idempotent, the "Walk-in Customer" party), refuses both CA roles with an inline `caRoleMutationAllowed(role, path)` check (message from `caRoleRefusalMessage`). It is not folded into the middleware because the tenant base has no role lookup and the sweep helpers match a procedure to its base by middleware prefix; the role-sweep gate table (`NON_CASL_GATES`) and the committed `role-matrix.md` record it. Any future tenant-base mutation that creates data needs the same check.

The read-only organisation entitlement gate is unchanged and still refuses filing writes in read-only mode.

### Adding a filing procedure for `ca_filing`

1. Gate the procedure with `requireCan(ctx.ability, "create", "GstReport")` (or a read-only check if it only reads).
2. Add its path to `CA_FILING_MUTATIONS` in `permissions.ts`.
3. `ca-role-backstop.test.ts` is the typo guard (every entry must be a real mutation on the CASL base) and `role-sweep` expects the new row; update `__snapshots__/role-matrix.md`.

## Other places that know the roles

- Two-factor "admins" policy covers `auditor` and `ca_filing` (`TWO_FACTOR_ADMIN_ROLES` in `packages/shared/src/two-factor.ts`): a CA sees every number and files returns.
- Web `apps/web/src/lib/permissions.ts` `ROLE_ABILITIES` (an unknown role shows everything, so every new role MUST be added there), labels in `apps/web/src/lib/roles.ts`, mobile `team.tsx` / `OrgSwitcherSheet.tsx`, MCP `MEMBER_ROLES`, CLI role lists, developer docs.
- The invite experience, plan-limit exclusion and CA cap are Part 2 (next section).

## Invite my CA (Part 2)

### Rules (`packages/api/src/lib/invite-rules.ts`, pure and unit-tested)

- Only the **owner** (and superadmin) may invite `auditor` / `ca_filing`. Admins keep inviting staff roles (admin, seller_manager, seller, accountant) and are refused for CA roles with "Only the owner can invite an accountant (CA)".
- Changing an existing member's role **to or from** a CA role is owner/superadmin only (`tenant.updateMemberRole`). Admins cannot touch a CA's access, though they can still remove the member or revoke the pending invite.
- **Cap:** at most `MAX_CA_MEMBERS_PER_ORG = 3` (`packages/shared/src/accountant-access.ts`) CA members plus pending (unexpired, unaccepted) CA invitations per organisation, enforced on invite and on a role change that adds a CA (switching between the two CA roles is allowed at the cap). Error: CONFLICT with a clear message.
- **Plan limit:** CA roles do not count towards `maxTeamMembers`, as members or as pending invitations. `enforceTeamMemberLimit` (`lib/plan-limits.ts`) excludes `role in (auditor, ca_filing)` from both counts (`countsTowardTeamLimit(role)` is the pure statement of the rule); CA invites skip the plan check entirely. `countCaSlots(tenantId)` feeds the cap.
- Invite mutations stay gated in read-only organisations (not entitlement-exempt), as before.
- Rules not enforced at accept time: the cap counts pending invites, so accepting never adds a CA beyond the cap.

### Case-insensitive invite e-mails

`tenant.inviteMember` trims and lowercases the address (zod transform) before storing it. Every lookup compares `lower(column) = normalized` (existing-user check, pending-duplicate check, `myInvitations`, `acceptById`) and `acceptInvitation` compares normalised addresses, so invites written before this change with mixed case also appear in the invitee's in-app list.

### API surface (no new procedures)

- `tenant.inviteMember` returns `{ token, inviteUrl, role, expiresAt }` and passes the role to the e-mail.
- `tenant.peekInvitation`, `tenant.myInvitations` and `tenant.pendingInvitations` return `roleLabel` and `accessDescription` (CA roles only, otherwise `null`); peek and myInvitations also return `invitedByName`; peek and myInvitations already return `tenantName`.
- Shared helpers: `isCaRole`, `CA_ROLES`, `CA_ROLE_DESCRIPTIONS`, `CA_ROLE_LABELS`, `CA_ACCESS_CHOICES` (the two dialog cards: "View only" = auditor, "View and file returns" = ca_filing), `CA_ACCESS_NOTE`, `memberRoleLabel`.

### E-mail

`buildInvitationEmail({ inviteUrl, businessName, inviterName, role })` in `lib/email.ts` is a pure builder of subject, text and HTML (all names and the link escaped). CA roles: "X has invited you as their accountant on Fintranzact", the role label and access text, "the business can remove your access at any time, and your activity in their books is logged", 7-day expiry. Other roles keep the original team invitation (subject "You've been invited to join {business} on Fintranzact"). `sendInvitation` takes an optional trailing `role`; the dev console log prints the access level too.

### Clients

- Web: Team tab has **Invite my CA** (owner only) next to **Invite member**; the dialog ("Invite your CA") takes the e-mail and two radio cards, shows the removal/logging note, then the copyable link and "We emailed them". The normal invite dialog has no CA roles; an existing member's role dropdown shows them to the owner only, and an admin sees no dropdown on a CA row. Role pills show a small **CA** tag; pending invitations show the access text. `/invite/$token` shows who invited you, the organisation and (CA) "Registered as accountant" with the access text; after accepting, the new organisation is selected. A CA who joined through the link is offered "Create your own firm to manage all your clients in one place" (the existing create-organisation action, when the plan allows it). The invite does not collect a name: `tenant.inviteMember` has no name field and the CA's own profile name is used.
- Mobile: `settings/team.tsx` has the same **Invite my CA** sheet (owner only), CA tags and access text on pending invites; pure helpers in `src/lib/team-roles.ts`.
- CLI / MCP: `tenant invite <email> --role auditor|ca_filing` (owner only; help text explains the roles and limits) and `tenant_invite_member`.

### Tests

Unit: `invite-rules.test.ts` (admin refused, owner allowed, cap, role changes, `countsTowardTeamLimit`), `invitation-email.test.ts`, `ca-role-backstop.test.ts`, shared `accountant-access.test.ts`, web `TeamTab.ca.test.tsx` / `InviteSummary.test.tsx` / `team-roles.test.ts`, mobile `team-roles.test.ts`, CLI `tenant-roles.test.ts`, MCP `tenant-invite-tool.test.ts`. Integration (need Postgres): `integration/tenant-ca-invite.test.ts` (mixed-case invite visible and accepted, owner vs admin, cap, free-plan exclusion, accept creates `tenant_members` role plus `business_members` grants and the organisation in `tenant.list`, `ensureWalkInParty` refusal).

## Migration note

The `member_role` enum gains `auditor` and `ca_filing`. Migrations: `packages/db/drizzle/0052_accountant_roles.sql` (unified, generated) and `packages/db/drizzle-control/0015_accountant_roles.sql` (idempotent `ADD VALUE IF NOT EXISTS`). drizzle's `migrate()` runs all pending migrations in one transaction, and Postgres forbids using a new enum value in the transaction that adds it, so these migrations only add the values: never use them (UPDATE, default, index, insert) in the same migration or run.
