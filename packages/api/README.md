# @fintranzact/api

The Fintranzact backend. A [Hono](https://hono.dev/) HTTP server with a [tRPC v11](https://trpc.io/) router that provides fully type-safe access to all business data. 14 routers, 130+ procedures, rate limiting, audit logging, PDF generation, and email.

[![Hono](https://img.shields.io/badge/Hono-4-E36002?logo=hono&logoColor=white)](https://hono.dev/)
[![tRPC](https://img.shields.io/badge/tRPC-v11-2596BE?logo=trpc&logoColor=white)](https://trpc.io/)
[![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)

---

## Running locally

```bash
# From monorepo root
pnpm --filter @fintranzact/api dev

# Or from this directory
pnpm dev
```

The API starts at `http://localhost:3000`. Requires a running PostgreSQL instance — see the root README for Docker setup.

---

## Building

```bash
pnpm --filter @fintranzact/api build
```

Uses [tsup](https://tsup.egoist.dev/) to bundle `src/server.ts` → `dist/server.js`. The PDF worker is compiled separately:

```bash
# Handled automatically by the build script
npx tsup src/lib/pdf-worker.ts --format esm --out-dir dist/lib
```

---

## Architecture

### Hono server (`src/server.ts`)

The Hono app handles:
- Security headers (HSTS, X-Frame-Options, CSP, etc.)
- CORS with origin allowlist from `CORS_ORIGINS` env var
- Rate limiting: 120 requests/minute per IP
- Health check: `GET /health`
- tRPC endpoint: `POST /trpc/*` and `GET /trpc/*`
- Public store REST endpoints: `GET /store/:slug/catalog.json`, `POST /store/:slug/order`
- Invoice PDF endpoint: `GET /invoice/:id/pdf`

### tRPC procedure hierarchy

Three levels of middleware protection, each extending the previous:

```
publicProcedure          — No auth required (login, register)
  └── protectedProcedure — Requires valid session (user settings, business list)
        └── tenantProcedure    — Requires tenant selection (injects ctx.db)
              └── businessProcedure  — Requires business selection (scopes queries)
                    └── authorizedProcedure — CASL ability object in context
```

All mutation and query procedures that touch business data use `authorizedProcedure` (aliased as `viewerProcedure`, `memberProcedure`, `adminProcedure` for backward compatibility). Granular permission checks happen per-procedure via `requireCan(ctx.ability, action, subject)`.

### Multi-tenancy

In self-hosted mode (`MULTI_TENANT=false`), all tenants share a single PostgreSQL database. The tenant ID is still tracked — it is just resolved to the same database for every request.

In cloud/SaaS mode (`MULTI_TENANT=true`), each tenant has its own database. The `getTenantDb()` function in `packages/db` resolves the tenant's connection string from the control database and maintains a connection pool (max 50 pools, 5-minute idle eviction).

---

## Routers

| Router | File | Key procedures |
|---|---|---|
| `auth` | `routers/auth.ts` | `register`, `login`, `logout`, `me`, `completeProfile` |
| `business` | `routers/business.ts` | `list`, `create`, `update`, `switchBusiness` |
| `party` | `routers/party.ts` | `list`, `create`, `update`, `delete`, `ledger`, `merge`, `exportTally` |
| `item` | `routers/item.ts` | `list`, `create`, `update`, `delete`, `adjustStock`, `stockHistory` |
| `invoice` | `routers/invoice.ts` | `list`, `create`, `update`, `delete`, `updateStatus`, `pdf` |
| `payment` | `routers/payment.ts` | `list`, `create`, `update`, `delete`, `allocate` |
| `expense` | `routers/expense.ts` | `list`, `create`, `update`, `delete` |
| `bankAccount` | `routers/bankAccount.ts` | `list`, `create`, `update`, `transfer`, `transactions` |
| `gst` | `routers/gst.ts` | `gstr1`, `gstr3b` |
| `dashboard` | `routers/dashboard.ts` | `summary`, `salesTrend`, `topParties`, `expenseBreakdown` |
| `document` | `routers/document.ts` | Quotation, proforma, delivery challan, credit note procedures |
| `store` | `routers/store.ts` | `getConfig`, `updateConfig`, `listOrders`, `fulfillOrder` |
| `import` | `routers/import.ts` | MyBillBook data import (parties, items, invoices, payments) |
| `tenant` | `routers/tenant.ts` | Tenant management for cloud/SaaS deployments |

---

## Authentication model

### Web app (cookie-based sessions)

1. User logs in with email and password (`auth.login`).
2. API creates a session record in the control database with a 30-day expiry.
3. API sets a `session_id` HttpOnly, Secure, SameSite=Lax cookie.
4. Every request reads the `session_id` cookie, validates the session in the database (with in-memory LRU cache), and resolves the user.

### Mobile app (Bearer token sessions)

The mobile app cannot reliably use cookies. It sends `Authorization: Bearer <session_id>` as a header instead. The session model is identical — the same session table, same 30-day expiry, same server-side invalidation.

### Email-change links

1. Client calls `auth.requestEmailChange` with the new address.
2. API generates a token, stores its SHA-256 hash (table `magic_link_tokens`, kept for its legacy name) with a 15-minute expiry, and emails a verification link to the NEW address.
3. The link opens `/auth/verify-email-change?token=...`, which calls `auth.confirmEmailChange`.

If `RESEND_API_KEY` is not set, the link is printed to the console (development convenience).

---

## PDF generation

Invoice PDFs are generated by PDFKit in `src/lib/invoice-pdf.ts`. The PDF worker (`src/lib/pdf-worker.ts`) runs in a separate thread via Node's `worker_threads` to avoid blocking the event loop during generation.

Fonts are bundled in `packages/api/fonts/`:
- NotoSans (Latin + Devanagari) for body text and Indian script support
- JetBrains Mono for invoice numbers and codes

PDF formats:
- **A4 portrait** — standard business invoice
- **A5 landscape** — compact format
- **Thermal (80mm)** — for thermal receipt printers

Every invoice PDF includes a UPI QR code if the business has a UPI account configured.

---

## Permissions (CASL)

`src/lib/permissions.ts` defines abilities for five roles:

| Role | Can |
|---|---|
| `superadmin` | Everything |
| `admin` | All CRUD, manage team members |
| `seller_manager` | Invoices (all), parties, items, payments, expenses |
| `seller` | Create invoices (cannot modify tax rates or discounts), view |
| `accountant` | Read everything, manage payments and expenses, cannot create invoices |

Permission checks use `requireCan(ctx.ability, action, subject)` at the start of each procedure. Unauthorized requests throw a `FORBIDDEN` tRPC error.

---

## Audit logging

Every mutation (create, update, delete) is logged via `logAudit()` in `src/lib/audit.ts`. Audit records include:
- User ID and tenant ID
- Entity type and entity ID
- Action performed
- Client IP address
- Timestamp

Stock adjustments/transfers/counts, manufacturing, journals, the chart of accounts, warehouses, ITC, e-invoice / e-way bill, bank reconciliation and batch mutations log through `audited()` / `withAudit()` in the same file, which write one entry per entity once the mutation has succeeded. The data audit below checks the trail per table (`<table>.audit-trail` rules).

---

## Data completeness audit (Layer 4)

`src/lib/data-audit/` holds SQL rules that check what the app saved is complete per business logic, not just per NOT NULL: invoice totals = lines + charges − discount + round-off, line tax = taxable × rate, amount paid = live allocations, stock = sum of movements (items, variants, warehouse balances), documents hold exactly their lines' stock, bank balances = opening + postings, payments post one bank transaction in the right direction, ITC = purchase tax split by state, e-invoice/e-way bill fields per status, GSTIN ⇄ state code, audit entries for user-entered rows, and more. `registry.ts` has an entry for every tenant table — rules, or the reason the table needs none (`registry.test.ts` fails when a new table has neither). Each rule names the procedures/screens that write its rows.

```bash
pnpm data:audit                          # whole DATABASE_URL (repo-root .env is loaded)
pnpm data:audit --business <uuid>        # one or more businesses (comma-separated)
pnpm data:audit --only invoices,payments # rule-id prefixes
pnpm data:audit --strict --json          # warnings fail too; machine-readable output
pnpm data:audit --list                   # the rule catalogue
```

Exit code 0 = clean, 1 = violations (errors; warnings too with `--strict`), 2 = a rule query failed. In multi-tenant mode point `TENANT_DATABASE_URL` at one tenant's database.

- `src/__tests__/integration/data-audit.test.ts` builds a business through the tRPC procedures the web calls (onboarding, masters, quotation → order → challan → invoice, PO → GRN → bill, returns, notes, POS, payments, expenses, banking, reconciliation, stock, manufacturing, journals, recurring invoices, edits, merges) and expects zero violations; it also corrupts rows and checks the rules fire.
- The Playwright suite runs the audit over the e2e business after all web journeys (`e2e/data-audit.teardown.ts`, the setup project's teardown). `pnpm test:e2e` runs it; `E2E_SKIP_DATA_AUDIT=1` skips it, `E2E_DATA_AUDIT_STRICT=1` fails on warnings, `E2E_DATA_AUDIT_DATABASE_URL` overrides the database. To run only the audit against an existing e2e run: `pnpm exec playwright test --config e2e/playwright.config.ts --project data-audit`.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `PORT` | No | Server port (default: 3000) |
| `CORS_ORIGINS` | Yes | Comma-separated allowed origins |
| `APP_URL` | Yes | Frontend URL (for email links) |
| `NODE_ENV` | No | `development` or `production` |
| `RESEND_API_KEY` | No | Resend API key for transactional email |
| `EMAIL_FROM` | No | Sender address for emails |
| `MULTI_TENANT` | No | Enable multi-tenant mode (default: `false`) |
| `CONTROL_DATABASE_URL` | Multi-tenant only | Separate control database URL |
| `TURNSTILE_SECRET_KEY` | Production store | Cloudflare Turnstile backend key |
