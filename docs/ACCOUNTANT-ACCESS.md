# Accountant access: roles, permissions and the mutation backstop

## Feature map: parts 1-6 and where each lives

"Let a business invite its CA, and let a CA work across many clients with one login." Six parts, one roadmap item ("Accountant (CA) access across clients", batch `2026-10-02-ca-access`, kept in progress until the integration tests have run on Postgres).

| Part | What | Where |
|---|---|---|
| 1 Roles | `auditor` (read-only), `ca_filing` (filing), CASL grants, mutation backstop | `lib/permissions.ts`, `trpc.ts` `withPermissions`; sections below |
| 2 Invite my CA | Owner-only invite, two access levels, cap of 3, plan-limit exclusion, e-mail | `lib/invite-rules.ts`, `tenant.inviteMember`, `InviteCaDialog.tsx` |
| 3 Removal | Revoke keys/grants/sessions, kill invite links, membership checked per request | `lib/member-removal.ts`, `lib/tenant-membership.ts` |
| 4 Access log | `access.*` security events, filings in the audit trail, viewer | `lib/access-events.ts`, `tenant.accessLog`, `AccessLogCard.tsx` |
| 5 Client switcher | Search, pins, recents, leave a client | `lib/client-switcher.ts`, `tenant.listClients/setPinned/leave`, `ClientSwitcher.tsx` |
| 6 Partner link | CA badge, clients you manage, opt-in referral credit | `lib/partner-ca.ts`, `partner.portal`, section "Partner programme link (Part 6)" |


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

## Removing access (Part 3)

"The client can remove access at any time." `tenant.removeMember` is one flow (`removeTenantMember` in `packages/api/src/lib/member-removal.ts`, real store in `member-removal-store.ts`, unit-tested with a fake store):

1. **Tenant DB first:** delete the user's `business_members` rows for this organisation's businesses (`tenantBusinessIds`, so in self-hosted shared-DB mode other organisations' businesses are untouched). It is idempotent: if it fails nothing else has changed and the owner just retries.
2. **Control DB, one transaction:** delete the `tenant_members` row; delete the user's `api_keys` where `tenant_id` is this organisation; delete **accepted** `invitations` for that e-mail (case-insensitive) and **expire** pending ones (`expires_at = now`, row kept); set `sessions.tenant_id = NULL` for their sessions in this organisation.
3. Clear the per-process caches: membership check, two-factor gate, session cache for each cleared session.
4. Record a `access.removed` security event (subject = removed user, actor = remover, tenant; metadata `role`, `email`, `apiKeysRevoked`, `businessesRevoked`, `removedBy`).
5. E-mail the removed person "Your access to {organisation} was removed" (`sendNotice`). Best effort: a failure is logged and never fails the removal.

Guards are unchanged: caller must be owner/superadmin/admin (admins may remove CA members), you cannot remove yourself, owner/superadmin cannot be removed. Removing a non-member is a quiet no-op (it still sweeps leftovers for this organisation; no event, no e-mail). It stays in `READ_ONLY_EXEMPT`.

### Membership is checked on every request

`hasTenantAccess` (`trpc.ts`) calls `requireTenantMembership(tenantId, user.id)` (`lib/tenant-membership.ts`) before anything else on all three tenant bases. No `tenant_members` row means a plain `FORBIDDEN` "You no longer have access to this organisation". This closes two holes: an API key authenticates from `api_keys` with no membership check (and the old role fallback treated "no row" as `seller`), and a session's `tenantId` is cached up to 60s per process and only cleared on the instance that handled the removal.

- Cost: one indexed lookup (unique `(tenant_id, user_id)`), **positive answers cached 15s per process** keyed `(tenantId, userId)`; refusals are never cached (a person added or re-added is let in at once). Only existence is cached, never the role (`withPermissions` reads the role per request).
- Removal and `tenant.updateMemberRole` invalidate the entry on the instance that handled them.
- **Residual window:** another instance can keep honouring a removed user for up to **15 seconds** (the cache TTL), down from 60s. Everything else is revoked at once (keys and grants are deleted, the session's `tenantId` is null for new cache fills).
- Not affected: platform admins (no tenant bases, no `tenant_members`), public/protected procedures, API keys of current members.
- The old "no membership means `seller`" fallback in `withPermissions` is now unreachable for real requests (the request is refused earlier); it is kept only as a defence for a row removed between the two reads.
- Tests that build a context for a user must give the user a `tenant_members` row (`addMember`), because a user with no membership is exactly what is now refused. After editing `tenant_members` directly in a test, call `clearTenantMembershipCache()`.

### Old invite links

Removal deletes the accepted invitation, so the old link finds nothing. `tenant.acceptInvitation` also refuses an accepted invitation for a non-member (NOT_FOUND "This invitation has already been used. Ask the organisation for a new invitation."), replacing the old "re-add after removal" branch. Re-accepting while still a member stays idempotent; a fresh invitation works normally and re-grants the business access.

### Role changes and business-level removal

`tenant.updateMemberRole` already read the new role on the next request (the role is never cached except in the two-factor gate cache, which it invalidates, and now also the membership entry). `business.removeMember` only removes the per-business grant (`business_members`, read on every request, no cache) and leaves API keys alone (keys are tenant-scoped).

### Follow-ups (Part 4/5)

`tenant.leave` (a CA dropping a client, event `access.left`) is deliberately not added here: it needs the web/mobile UI to avoid a parity gap. The access-log viewer and the remaining access event types are Part 4 (next section). Clients should treat the FORBIDDEN message like losing the organisation (Part 4/5 polish).

### Tests

Unit: `member-removal.test.ts` (order, every step, e-mail failure ignored, tenant-DB failure stops early, guards, non-member no-op), `tenant-membership.test.ts` (15s positive cache, refusals not cached, invalidation, FORBIDDEN shape). Integration (need Postgres): `integration/tenant-access-removal.test.ts` (everything revoked, other organisation untouched, API key refused, stale session refused, old invite refused and new invite works, event recorded, admin may remove a CA, owner not removable) and the updated accept-invitation test in `tenant-invite-flow.test.ts`.

## The access log (Part 4)

"Access is logged": the owner can see who was invited, who accepted, role changes, removals, when their CA last opened the books, what they downloaded, and what they filed. Two places, by design.

### What is recorded where

| What | Where | Event / action |
|---|---|---|
| Invite sent | control `security_events` | `access.invited` (actor = inviter, subject = invitee when they already have an account, else null; metadata `role`, `email`) |
| Invite withdrawn | `security_events` | `access.invite_revoked` (`role`, `email`) |
| Invite accepted | `security_events` | `access.accepted` (actor = subject = the person; `role`). Only when a membership is created; re-clicking an old link records nothing |
| Role changed | `security_events` | `access.role_changed` (subject = member; `from`, `to`, `email`). Setting the same role records nothing |
| Removed | `security_events` | `access.removed` (Part 3) |
| CA opened the organisation | `security_events` | `access.org_opened` (CA roles only, `role`) |
| CA downloaded a report/export | `security_events` | `access.export` (CA roles only; `procedure`, `role`) |
| What a CA changed or filed | tenant `audit_log` (business trail) | `gstReturns.*`, `gstr2b.*`, `period.lockGstMonth`, with `metadata.role` |

Lifecycle events go to the control `security_events` table because they are about people and the organisation, not a business, and because that table has **no retention window**: the plan's `auditRetentionDays` only hides old rows of `business.auditTrail`, it never applies to the access log. `lib/access-events.ts` holds the pure builders (`buildAccessEvent`) and the recorders; `recordSecurityEvent` never throws, so a logging failure cannot break an invite or a download. Metadata is a fixed small shape (`role`, `email`, `from`, `to`, `procedure`): never tokens, invite links, codes or request inputs.

### What is not recorded

- **Reads are not logged.** Viewing an invoice or a report is not an event. The log answers "was my CA in my books, and what did they take or change", not "which screen did they open".
- Downloads by the owner, admins and staff are not logged as `access.export`; only `auditor` / `ca_filing`.
- Exports built in the browser from data already on screen (for example a table's own CSV button) cannot be seen by the server. Only the file-producing procedures are logged (below).

### Opened the organisation: throttle

`access.org_opened` is written when a CA role selects the organisation (`tenant.select`) and on the first request a CA role makes in an organisation (a hook inside `withPermissions`, which already resolves the role; no new middleware, so the role sweep's base matching is untouched). It is throttled to **once per hour per (user, organisation)** with an in-process `Map` (`shouldRecordOrgOpened`, pure with an injected clock; bounded at 5,000 entries). That keeps the table small (a CA working all day writes about 8 rows) and costs one map lookup per CA request. It is per API instance: with several instances a CA can produce one row per instance per hour. We accepted that rather than a database check on every request; "last opened" is still correct (the latest row). API keys resolve the same role, so a CA's key counts as opening the books too.

### Downloads: `access.export`

`recordCaExport(ctx, path)` is called by the handlers that return a file (and does nothing unless `ctx.role` is `auditor` / `ca_filing`): `gst.gstr1Json`, `gst.gstr1CSV`, `gst.gstr9Json`, `gst.gstr4Json`, `party.ledgerReportCSV`, `party.tallyExport` (CSV), `reports.tallyExport` (XML), `tds.certificate` (PDF). `business.exportData` is owner-only. `tds.returnData` is not logged: it is the data screen for a quarter (the CSV is part of the same response), so logging it would record every view. Labels for these paths are `EXPORT_PROCEDURE_LABELS` in `packages/shared/src/access-log.ts`; add a new download there and call `recordCaExport` from its handler.

### Filings in the business audit trail

`gstReturns.requestOtp`, `verifyOtp`, `saveGstr1`, `fileGstr1`, `saveGstr3b`, `fileGstr3b`, `pull2b`, `gstr2b.upload`, `linkInvoice`, `ignoreRecord` are wrapped in `withAudit` (`period.lockGstMonth` already was). Entity types: `gst_return` (no entity id; metadata `period`, and `referenceId` for the two file actions), `gstr2b_upload`, `gstr2b_record`. OTPs, the portal username, the signatory PAN and EVC codes are never put in metadata. `lib/audit.ts` now carries the actor's role: `audited()` / `logAudit()` add `metadata.role` when the actor is a CA role (`withActorRole`); other roles' entries are unchanged, and an entry's own `role` field is never replaced. The web and mobile activity log show the new action labels and "by Anita Shah · Accountant (filing)". These rows are business-scoped and fall under the plan's audit retention window like every other audit entry.

### The viewer

`tenant.accessLog({ cursor?, limit?, type? })` (query on the tenant base): owner / superadmin / admin only, FORBIDDEN otherwise (an inline gate like `pendingInvitations`; role-sweep `NON_CASL_GATES` entry, allow owner and admin; row added to `role-matrix.md`). Reads `security_events` where `tenant_id` is the organisation and `type like 'access.%'` (or the given type or list of types), newest first, default 25, max 100. Paging is a **keyset on (createdAt in whole milliseconds, id)**: cursor `"<ms>_<uuid>"`, and both the order and the comparison use `date_trunc('milliseconds', created_at)` with the id as tie-break, so rows with the same millisecond are never skipped or repeated (the older `platform.securityEvents` pages on `createdAt` alone and can skip same-instant rows). Returns `{ items: [{ id, type, label, createdAt, actor, subject, metadata }], nextCursor }`; actor/subject are `{ id, name, email }` or null (null-safe if the user was deleted); `metadata` is only `role`, `from`, `to`, `email`, `procedure`.

`tenant.members` also returns `lastOpenedAt` for each CA member to owner/admin viewers (one grouped query on the latest `access.org_opened` per user); `null` for non-CA members, for CAs who have never opened the books, and for everyone else viewing.

### Clients

- Web: Team tab, **Access log** card under the members table (owner/admin): one sentence per event ("Anita Shah (CA) was invited as Accountant (read-only) by You"), icon, relative and absolute time, filter pills (All / Invites / Role changes / Removals / Opened / Downloads), **Load more**. CA rows show "Last opened 3h ago" or "Never opened". Sentences are built by `accessEventSentence` in `@fintranzact/shared`.
- Mobile: Team screen, the latest 25 events and "Last opened" on CA rows (`src/lib/access-log.ts`).
- CLI `fintranzact tenant access-log [--filter invites|roles|removals|opened|downloads] [--limit n] [--cursor c] [--json]` and MCP `tenant_access_log`.

### Tests

Unit: `access-events.test.ts` (builders and metadata shapes, no secrets, the throttle with an injected clock, `recordOrgOpened`, `recordCaExport` only for CA roles), `access-log.test.ts` (cursor, limit, gate, safe metadata, paging), `audit-role.test.ts` (role in metadata), shared `access-log.test.ts` and `two-factor.test.ts` (labels, 20 event types), web `AccessLogCard.test.tsx`, mobile `access-log.test.ts`, CLI `tenant-access-log.test.ts`. Integration (need Postgres; not run in the environment this was written in): `integration/tenant-access-log.test.ts` (events for invite, revoke, accept, role change, remove; accessLog gated to owner/admin, newest first, keyset with equal timestamps, type filter; a CA's `gst.gstr1Json` writes `access.export` and an owner's does not; throttle and `lastOpenedAt`; `period.lockGstMonth` by a CA writes an audit row with the role).

## The client switcher (Part 5)

"One login, switching between client businesses." A person can be a member of many organisations with different roles: their own firm (owner) and each client (`auditor` / `ca_filing`, or any other role). Part 5 gives them a proper switcher, pins and recents, and a way to leave a client.

### API

- `tenant.listClients({ search?, scope?: 'all' | 'mine' | 'clients', cursor?, limit? })` (protected base: no organisation needs to be selected). One control-DB query: `tenant_members` x `tenants` (active only, as `tenant.list`) left-joined to the caller's `user_tenant_prefs`. Returns `{ items, nextCursor, total, counts: { all, mine, clients, pinned } }`; an item is `{ tenantId, name, slug, role, roleLabel (shared memberRoleLabel), isOwnFirm (owner/superadmin), isClient (!isOwnFirm), isCa, plan, pinned, lastOpenedAt }`. **Order: pinned first, then `lastOpenedAt` descending (never opened last), then name (case-insensitive), then id.** `scope=mine` is own firms, `clients` is everything else.
- **Search, ordering and paging are done in memory** (`lib/client-switcher.ts`, pure `orderAndPageClients`). An accountant has at most a few hundred organisations, one indexed join is cheap, and a composite keyset order with nullable timestamps in SQL is easy to get wrong. The cursor is still a **keyset** (base64url of the last item's `{pinned, lastOpenedAt|null, name, id}`), not an offset, so a page boundary stays correct if something is pinned or opened between two loads. Search is a literal case-insensitive substring over the name: `%`, `_` and `\` match themselves (no LIKE is involved, so there is nothing to escape). A bad cursor starts from the top. Limit default 30, max 100. If lists ever grow into the thousands this is the function to move into SQL.
- `tenant.list` is unchanged (one query, other callers).
- `tenant.setPinned({ tenantId, pinned })`: protected; FORBIDDEN unless the caller is a member; at most **20** pinned (`MAX_PINNED_TENANTS`, counted over organisations the person still belongs to); re-pinning/unpinning is a no-op (`decidePin`). Exempt from the read-only/suspended gate (it only touches the caller's own preferences).
- `tenant.select` now also upserts `user_tenant_prefs.lastOpenedAt = now`, **throttled in the statement itself** (`ON CONFLICT DO UPDATE ... WHERE last_opened_at IS NULL OR last_opened_at < now - 5 minutes`, `lastOpenedCutoff`), so a click costs at most one cheap upsert and usually writes nothing. A failure is logged and never fails the selection. `select` still does not check `tenants.status`; the entitlement and 2FA gates apply to the selected organisation as before.
- `user_tenant_prefs` (control DB): `user_id` -> users and `tenant_id` -> tenants (both cascade), `pinned_at`, `last_opened_at`, primary key `(user_id, tenant_id)`, index on `tenant_id`. Rows for an organisation are deleted when the person is removed or leaves (inside the removal transaction), so they never count towards the pin limit afterwards.

### Leaving a client: `tenant.leave({ tenantId })`

Protected base. The caller removes **their own** membership in an organisation they do not own. It reuses `removeTenantMember` with `self: true`: same cleanup as a removal (business grants, one control transaction for the membership, API keys, invitations and sessions), same caches. Differences from `tenant.removeMember` (whose "cannot remove yourself" guard is unchanged):

- any role except `owner` / `superadmin` may leave; an owner gets "The owner of an organisation cannot leave it. Transfer ownership or delete the organisation instead." (FORBIDDEN); a non-member gets NOT_FOUND;
- the security event is **`access.left`** (new type, in `SECURITY_EVENT_TYPES` / labels and the access log's "Removals" filter), `userId = actorUserId = the person`, `metadata.removedBy = the person`, plus `role`, `email`, `apiKeysRevoked`, `businessesRevoked`. Sentence: "Anita Shah (CA) left the organisation";
- the person is not e-mailed; the **owners and superadmins** get "{name} left your organisation" (`sendNotice`, best effort; one failing address does not stop the others, and none of it undoes the leave).

After leaving, the person's sessions have no organisation. Web: if it was the open one, the business choice is dropped, the select mutation is reset (so a single remaining organisation is auto-selected) and the switcher shows. Mobile has no start-up picker, so it opens the next organisation itself (`nextOrgAfterLeaving`: own firm first, else the first in list order).

### Clients

- Web: `components/tenant/ClientSwitcher.tsx` replaces the old `TenantPicker` (modal; same "Select Organization" title and "Create new organization" button, which e2e may rely on). Autofocused search (debounced 200 ms); All / My firm / Clients chips when both exist; sections Pinned, Recent (top 5 by last opened, not pinned; hidden while searching), My firm, Clients; list scrolls inside `max-h-[85vh]`; arrow keys, Enter, Escape; star per row; role badge from `roleLabel` plus a "CA" tag; "Current" marker; `...` menu with **Leave this client** (own firms have none) opening a confirm that says access ends immediately and the owner is notified; Load more; empty, no-match and loading states; "N clients" count. Opened from the user block in the sidebar (shows "{role} - {organisation}") and from the boot-time picker when several organisations exist and none is selected. Auto-select of a single organisation is unchanged (`lib/tenant-auto-select.ts`).
- Mobile: `OrgSwitcherSheet` (Settings) gains search (once there are more than 5 organisations), the same sections, pin star, role badge and CA tag, leave with a confirm `Alert`, Load more. Up to 5 organisations it stays a flat list as before. Grouping helpers are shared (`@fintranzact/shared` `client-switcher.ts`) and in `apps/mobile/src/lib/client-switcher.ts`.
- CLI `fintranzact tenant clients [--search t] [--scope all|mine|clients] [--limit n] [--cursor c] [--json]` and MCP `list_clients`. `tenant.setPinned` and `tenant.leave` are CLI/MCP parity exceptions (an API key is bound to one organisation; there is nothing to switch).

### Known limitations

- **One selected organisation per login session, not per tab.** `tenant.select` writes `sessions.tenantId`, so two browser tabs on two clients clobber each other: switching in one switches the other, and its next request runs against the new client. Only `x-business-id` is per request (a business inside the selected organisation). Until per-tab selection exists, open the second client in a **private window or another browser**. Documented for users in the help article.
- **Tenant connection pools.** `tenant-pool.ts` keeps at most 50 pools (5 connections each, evicted after 5 idle minutes). A CA flipping across more than 50 clients in a short time churns pools (a reconnect on the first request after each switch). Not re-engineered here.
- Suspended organisations are not listed (consistent with `tenant.list`), so a CA does not see why a client vanished; the owner's billing screen shows it.

### Tests

Unit: `client-switcher.test.ts` (ordering with nulls last and pinned first, name/id tie-breaks, input-order independence, search incl. `%` `_` `\`, scope and counts, keyset paging walks everything once, stable across a pin between pages, bad cursor, limit clamp, last-opened throttle boundary, pin limit), `member-removal.test.ts` (leaving: event `access.left`, owners notified not the leaver, owner/superadmin refused, non-member, self-only, removeMember self guard intact), shared `client-switcher.test.ts` and `access-log.test.ts` / `two-factor.test.ts` (`access.left`, 20 event types), web `ClientSwitcher.test.tsx` (sections, debounce, search/no-match, keyboard, pin, leave confirm, Load more, scope chips, empty/loading) and `tenant-auto-select.test.ts`, mobile `client-switcher.test.ts`, CLI `tenant-clients.test.ts`. Integration (need Postgres; **not run in the environment this was written in**): `integration/tenant-client-switcher.test.ts` (a CA with three organisations sees roles and pinned-first order; search narrows; scope and paging; suspended hidden; select records last opened once within 5 minutes; setPinned needs membership and has the limit; leave removes membership, API keys and prefs, clears the session, the client's access log shows `access.left`, an owner cannot leave, a non-member gets NOT_FOUND). The role sweep gets an input override so `tenant.leave` is called with an organisation nobody belongs to (leaving the sweep's own organisation would remove its users); role-matrix rows were added by hand.

### Migrations

`packages/db/drizzle/0053_user_tenant_prefs.sql` (unified, drizzle-kit generated with snapshot and journal) and `packages/db/drizzle-control/0016_user_tenant_prefs.sql` (hand-written, idempotent: `CREATE TABLE IF NOT EXISTS`, foreign keys guarded with `duplicate_object`, `CREATE INDEX IF NOT EXISTS`, journal entry).

## Partner programme link (Part 6)

A "CA partner" is an **approved** control-DB `partners` row with `partnerType = 'accountant'`. The only link between a person and a partner record is the e-mail (as in `partnerForUser`): a CA's team membership is not stored on the partner. `lib/partner-ca.ts` (pure, injected `CaPartnerStore`; real store `lib/partner-ca-store.ts`) holds the rules.

### Matching: `findCaPartnerByEmail` / `findCaPartnersByEmails`

Case-insensitive; approved and accountant only (pending, rejected, reseller, technology never match); newest approved record wins. **Verified e-mail:** if a user exists with that e-mail it must be `emailVerified` (approving a partner verifies it, as in `platform.updatePartner`). A missing user matches only with `allowUnregistered` (invite time, when the CA may not have signed up yet; the badge on pending invites uses it too). Accept time and the portal are strict. Batched: one partners query and one users query for any number of e-mails (no N+1).

### 1. Badge (owner/admin only)

`tenant.pendingInvitations` and `tenant.members` return `caPartner: { id, companyName } | null` (CA-role rows only; members only for owners/admins). Web Team tab shows **Registered CA partner** under the role on the pending invite and on the member row. The invitee sees nothing extra. There is **no lookup-by-e-mail endpoint**: that would reveal which e-mails are partners to anyone. The only place partner status is revealed to a caller about an arbitrary e-mail is the refusal below, and only to the owner inviting a CA with the credit box ticked.

### 2. Clients you manage

`partner.portal` (kind `partner`, accountant type only; otherwise `null`) returns `managedClients` (latest 100 by membership date, `managedClientsMore` when there are more) and the web partner portal renders the table: organisation, access level, since (membership accepted/created), last opened (`user_tenant_prefs.lastOpenedAt`), plan name; empty state explains the invite flow. Only active organisations where the **partner's own login** holds `auditor` / `ca_filing` (bookkeeping `accountant` is excluded). Who/when/plan only: no financial data. `toManagedClients` is the pure mapping. No new procedure, so no parity entry.

### 3. Opt-in attribution (no automatic commission)

Accepting a CA invite **never** sets `tenants.partnerId` and never credits commission by default. The owner can opt in on the invite:

- `tenant.inviteMember({ ..., creditPartner?: boolean })` (web **Invite your CA**: unticked checkbox "This CA referred me to Fintranzact. Credit them as my partner."). Only meaningful for CA roles (ignored and stored null otherwise); ticked for an e-mail that is not an approved accountant partner is refused (BAD_REQUEST, `CREDIT_PARTNER_REFUSAL`). Stored as nullable boolean `invitations.credit_partner`.
- On accept (`acceptInvitation` and `acceptById`, new memberships only) `attributePartnerOnAccept` credits only when `shouldAttributePartner({ creditPartner, partnerMatch, tenantPartnerId })`: the box was ticked, the accepter's e-mail **still** matches an approved, verified accountant partner, and `tenants.partnerId IS NULL`. The write is `UPDATE tenants SET partner_id = ... WHERE id = ? AND partner_id IS NULL`, so it is idempotent and race-safe; an existing referral is never overwritten.
- Event `access.partner_attributed` (security_events; actor = subject = the CA; metadata `role`, `partnerName` = company only). Sentence: "Shah & Co was credited as the organisation's Fintranzact partner (requested by Anita)". It is in the access log's Invites filter. A failure never fails the accept (logged).
- Commission and stats are unchanged: `getPartnerStats` counts active tenants by `tenants.partnerId`, so a credited organisation behaves exactly like one referred by code.

Mobile's Invite my CA sheet does not offer the box (web only); the field is optional so mobile keeps working. CLI/MCP invites do not pass it.

### Migrations

`packages/db/drizzle/0054_invitation_credit_partner.sql` (unified, drizzle-kit generated with snapshot and journal) and `packages/db/drizzle-control/0017_invitation_credit_partner.sql` (hand-written, `ADD COLUMN IF NOT EXISTS`, journal entry).

### Tests

Unit: `partner-ca.test.ts` (matching rules, batching, every branch of `shouldAttributePartner`, invite-input rules, `attributePartnerOnAccept` with a fake store, managed-client mapping), `access-events.test.ts` (the new event), shared `access-log.test.ts` / `two-factor.test.ts` (21 event types, sentence), web `TeamTab.ca.test.tsx` (checkbox default off and sent, badges) and `ManagedClientsSection.test.tsx`. Integration (need Postgres; **not run in the environment this was written in**): `integration/tenant-ca-partner.test.ts` (credit on accept by token and by id with one event, none without the box, unapproved / non-accountant / stranger refused, existing partner never overwritten, badges, managed clients CA roles only, referral stats count a credited organisation).

Roadmap: `roadmap.test.ts` expects one more `in_progress` item (12; `planned` is `ROADMAP_SEED.length - 14`).

## Migration note

The `member_role` enum gains `auditor` and `ca_filing`. Migrations: `packages/db/drizzle/0052_accountant_roles.sql` (unified, generated) and `packages/db/drizzle-control/0015_accountant_roles.sql` (idempotent `ADD VALUE IF NOT EXISTS`). drizzle's `migrate()` runs all pending migrations in one transaction, and Postgres forbids using a new enum value in the transaction that adds it, so these migrations only add the values: never use them (UPDATE, default, index, insert) in the same migration or run.
