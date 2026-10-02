# Accountant access: roles, permissions and the mutation backstop

Part 1 of "let a business invite its CA, and a CA work across many clients with one login": the roles and the permission rules only. There is no invite flow yet (that is Part 2); an owner or admin can assign the new roles today with `tenant.updateMemberRole` / `tenant.inviteMember` and the Team tab.

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

The decision is the pure function `caRoleMutationAllowed(role, path)`. API keys resolve the same role through `tenant_members`, so the backstop applies equally. The backstop sits inside `withPermissions` (the CASL base), so it adds no middleware and does not change what `helpers/sweep-procs.ts` sees. Mutations on the tenant-scoped (non-CASL) base are guarded by their own owner/admin checks, which both roles fail. One known exception: `business.ensureWalkInParty` (idempotent, creates the "Walk-in Customer" party, needs only business access).

The read-only organisation entitlement gate is unchanged and still refuses filing writes in read-only mode.

### Adding a filing procedure for `ca_filing`

1. Gate the procedure with `requireCan(ctx.ability, "create", "GstReport")` (or a read-only check if it only reads).
2. Add its path to `CA_FILING_MUTATIONS` in `permissions.ts`.
3. `ca-role-backstop.test.ts` is the typo guard (every entry must be a real mutation on the CASL base) and `role-sweep` expects the new row; update `__snapshots__/role-matrix.md`.

## Other places that know the roles

- Two-factor "admins" policy covers `auditor` and `ca_filing` (`TWO_FACTOR_ADMIN_ROLES` in `packages/shared/src/two-factor.ts`): a CA sees every number and files returns.
- Web `apps/web/src/lib/permissions.ts` `ROLE_ABILITIES` (an unknown role shows everything, so every new role MUST be added there), labels in `apps/web/src/lib/roles.ts`, mobile `team.tsx` / `OrgSwitcherSheet.tsx`, MCP `MEMBER_ROLES`, CLI role lists, developer docs.
- Plan limits and the invite experience are deliberately left for Part 2.

## Migration note

The `member_role` enum gains `auditor` and `ca_filing`. Migrations: `packages/db/drizzle/0052_accountant_roles.sql` (unified, generated) and `packages/db/drizzle-control/0015_accountant_roles.sql` (idempotent `ADD VALUE IF NOT EXISTS`). drizzle's `migrate()` runs all pending migrations in one transaction, and Postgres forbids using a new enum value in the transaction that adds it, so these migrations only add the values: never use them (UPDATE, default, index, insert) in the same migration or run.
