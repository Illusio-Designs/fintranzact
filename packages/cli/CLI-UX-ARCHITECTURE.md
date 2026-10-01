# Fintranzact CLI: UX Architecture & Interaction Patterns

This document describes the CLI **as built** in `packages/cli`. It started as a pre-build design; ideas from that design that were not built are listed in [section 9](#9-not-built).

## Table of Contents

1. [Overview](#1-overview)
2. [Global Conventions](#2-global-conventions)
3. [Command Reference](#3-command-reference)
4. [Interactive Flows](#4-interactive-flows)
5. [Non-Interactive Mode and Output Formats](#5-non-interactive-mode-and-output-formats)
6. [Error States and Exit Codes](#6-error-states-and-exit-codes)
7. [Configuration & Auth](#7-configuration--auth)
8. [Implementation Notes](#8-implementation-notes)
9. [Not Built](#9-not-built)

---

## 1. Overview

| | |
|---|---|
| Package | `@fintranzact/cli` (version 0.9.0), published to npm |
| Location | `packages/cli` |
| Binary | `fintranzact` → `dist/bin/fintranzact.js` |
| Entry point | `src/bin/fintranzact.ts` |
| Build | `tsup` → one ESM bundle for Node 20, with a `#!/usr/bin/env node` banner; the version is injected as `__CLI_VERSION__` |
| Node | `>=20` |

### Libraries actually used

From `package.json`:

| Concern | Library | Notes |
|---|---|---|
| Command parsing | `commander` ^13 | Every command, option, alias and help text |
| Colours | `chalk` ^5 | Only when `hasColor()` is true (see below) |
| Config storage | `conf` ^13 | Encrypted JSON config file |
| Opening files | `open` ^10 | Only for `invoice pdf --open` |
| API payloads | `superjson` ^2 | Matches the API's tRPC transformer |
| HTTP | Node's built-in `fetch` | No HTTP library |
| Prompts | Node's built-in `readline` | No prompt library |
| Tables | Own code in `src/output.ts` | No table library |

### Code layout

```
packages/cli/
  package.json
  tsup.config.ts
  src/
    bin/
      fintranzact.ts          # creates the commander program, calls every registrar, parses argv
      registrars/*.ts         # 26 files, one per command group: define commands, options, help
    commands/<group>/*.ts     # command handlers (fetch, format, print)
    client.ts                 # FintranzactClient: hand-written tRPC-over-HTTP client
    config.ts                 # config file, env-var auth, maintenance check
    auth.ts                   # login (password / API key), logout, whoami
    output.ts                 # exit codes, colour detection, table/TSV/CSV/ids/JSON output
    format.ts                 # INR, dates, status badges, financial year helpers
```

### How commands are registered

`src/bin/fintranzact.ts` creates one `commander` `Command` named `fintranzact` and calls 26 registrar functions in order (`registerAuthCommands`, `registerDashboardCommands`, … `registerBackupCommands`). Each registrar in `src/bin/registrars/` adds its commands with `program.command(...)`, declares options, and in `.action()` calls a handler from `src/commands/`. Several registrars load their handler with a dynamic `import()` so unused commands are not evaluated at start-up.

Totals (counted from the registrars): **26 registrars, 38 top-level commands, 184 runnable commands.** Not every registrar adds one group: `auth.ts` adds five top-level commands, `backup.ts` adds two, and `document.ts` adds eight (seven document types plus `document`).

---

## 2. Global Conventions

### Command grammar

Most commands follow `fintranzact <group> <action> [args] [flags]`:

```
fintranzact login
fintranzact dashboard summary
fintranzact invoice list --this-month
fintranzact invoice get <id>
fintranzact party list --type customer
fintranzact gst r1 --quarter Q1
fintranzact report daybook --from 2026-04-01 --to 2026-04-30
```

A few commands sit at the top level: `login`, `logout`, `whoami`, `switch`, `profile`, `export`, `restore`.

Aliases: `dashboard` → `dash`, `api-key` → `key`, `automated-invoice` → `auto-inv`.

Running a group with no subcommand (for example `fintranzact dashboard`) prints that group's help.

### INR formatting (`src/format.ts`)

- `formatINR()` uses `Intl.NumberFormat("en-IN")` with two decimals and a `₹` prefix, e.g. `₹1,23,456.78`. Negative amounts get a leading `-`.
- `formatAmount()` is the same without the symbol, for table cells; the column header carries `(₹)`.
- Amount columns are right-aligned.

### Date formatting

- `formatDate()` prints `dd MMM yyyy`, e.g. `30 Mar 2026`.
- `formatRelativeDate()` prints `Today`, `Yesterday`, `5d ago`, `3mo ago`, `1y ago`.
- Financial year helpers (`currentFY()`, `fyStart()`, `quarterRange()`) assume the FY starts on 1 April. `--this-fy` and `--quarter Q1..Q4` use them.

### Status badges

`formatStatus()` prints text badges such as `[PAID]`, `[OVERDUE]`, `[CANCEL]`, coloured when colour is on:

| Status | Badge | Colour |
|---|---|---|
| paid | `[PAID]` | green |
| sent | `[SENT]` | blue |
| draft | `[DRAFT]` | dim |
| partial | `[PARTIAL]` | yellow |
| overdue | `[OVERDUE]` | red |
| cancelled | `[CANCEL]` | dim + strikethrough |
| adjusted | `[ADJUST]` | magenta |
| unfulfilled | `[UNFUL]` | blue |
| pending | `[PEND]` | yellow |
| confirmed | `[CONF]` | blue |
| delivered | `[DELIV]` | green |
| shipped | `[SHIPPED]` | blue |
| in_transit | `[TRANSIT]` | cyan |
| returned | `[RETURN]` | red |
| preparing | `[PREP]` | yellow |
| ready | `[READY]` | cyan |

Unknown statuses print as `[STATUS]` in upper case, uncoloured.

### Colour

`hasColor()` (in `src/output.ts`) returns false when `NO_COLOR` is set or `FORCE_COLOR=0`; otherwise it uses `process.stdout.hasColors()` or whether stdout is a TTY. Without colour, `success()` prints `OK: ` instead of `✓ `.

### Terminal width

`getWidthTier()` reads `process.stdout.columns` (default 80): **narrow** under 80, **standard** 80–120, **wide** over 120. List commands such as `invoice list` pick a column set per tier: narrow shows number, party, amount, status; standard adds date; wide adds due date, paid and balance.

---

## 3. Command Reference

One table per registrar, in the order they are registered. Arguments in `<>` are required.

**`auth.ts`** — top-level commands

| Command | What it does |
|---|---|
| `login` | Log in with email/password or `--token` (API key). Options `--api-url`, `--email`, `--password`, `--token`. |
| `logout` | Clear saved credentials; `--all` also signs out every session on the server. |
| `whoami` | Show the user and active business. |
| `profile update-name <name>` | Change your display name. |
| `switch` | List businesses and mark the active one. |

**`dashboard.ts`** — `dashboard` (alias `dash`): `summary`, `sales-trend`, `top-outstanding`, `top-customers`, `top-items`, `expenses`, `invoice-breakdown`, `profit-loss`, `receivables-aging`, `payment-modes`, `collection-efficiency`, `monthly-comparison`.

**`invoice.ts`** — `invoice`: `list`, `get <id>`, `create`, `status <id> <status>`, `pdf <id>` (`--output`, `--open`), `delete <id>`.

**`party.ts`** — `party`: `list`, `get <id>`, `create`, `delete <id>`, `ledger <partyId>`.

**`item.ts`** — `item`: `list`, `get <id>`, `create`, `delete <id>`, `stock <id> <adjustment>` (e.g. `+10`, `-5`, `100`), `batches <id>`, `expiring`.

**`payment.ts`** — `payment`: `list`, `create`, `delete <id>`, `get <id>`, `update <id>`, `unpaid-invoices <partyId>`, `untracked`, `default-account`.

**`expense.ts`** — `expense`: `list`, `create`, `delete <id>`, `update <id>`, `categories`.

**`gst.ts`** — `gst`: `r1`, `r3b`, `r1-csv`, `gstr9 <fy>`, `gstr2b-uploads`.

**`report.ts`** — `report`: `daybook`, `outstanding`, `tax-summary`, `item-sales`, `stock`, `sales-register`, `purchase-register`, `party-statement <partyId>`, `payment-summary`, `cash-flow`, `collection-efficiency`, `trial-balance`, `balance-sheet`, `cash-flow-statement`, `general-ledger <accountId>`.

**`bank.ts`** — `bank`: `list`, `get <id>`, `create`, `transfer`, `transactions <accountId>`, `gateway-config <accountId>`, `update-gateway <accountId>`.

**`shipment.ts`** — `shipment`: `list`, `get <id>`, `create`, `update <id>`.

**`target.ts`** — `target`: `list`, `my`, `create`.

**`store.ts`** — `store`: `settings`, `update-settings`, `items`, `items-toggle`, `orders`, `order-get <id>`, `order-confirm <id>`, `order-cancel <id>`, `order-update <id>`, `check-slug <slug>`.

**`import.ts`** — `import`: `parties <file>`, `items <file>`, `invoices <file>`, `payments <file>` (JSON or CSV, detected from the extension or `--format`).

**`automated-invoice.ts`** — `automated-invoice` (alias `auto-inv`): `list`, `get <id>`, `create`, `pause <id>`, `resume <id>`, `run-now <id>`, `delete <id>`, `update <id>`, `history <templateId>`, `usage`, `suggestions`.

**`business.ts`** — `business`: `list`, `get`, `update`, `sequence`, `audit-trail`, `export`, `switch`.

**`document.ts`** — one group per document type, each with `list`, `get <id>`, `create`, `update-status <id> <status>`, `delete <id>`:
`quotation`, `credit-note`, `debit-note`, `delivery-challan`, `proforma`, `sales-return`, `purchase-return`. Plus `document convert --from-type --from-id --to-type`.

**`tenant.ts`** — `tenant`: `list`, `members`, `invite <email>`, `remove <userId>`, `update-role <userId> <role>`, `invitations`, `revoke-invitation <invitationId>`.

**`api-key.ts`** — `api-key` (alias `key`): `list`, `create`, `revoke <id>`.

**`session.ts`** — `session`: `list`, `revoke <sessionId>`, `revoke-all`.

**`journal.ts`** — `journal`: `list`, `get <id>`, `void <id>`, `templates`.

**`itc.ts`** — `itc`: `dashboard`, `ledger`, `aging`, `block <invoiceId>`, `unblock <invoiceId>`.

**`bank-recon.ts`** — `bank-recon`: `imports`, `summary <importId>`, `rules`.

**`einvoice.ts`** — `einvoice`: `dashboard`, `generate <invoiceId>`, `cancel <invoiceId>`, `retry <invoiceId>`.

**`ewb.ts`** — `ewb`: `dashboard`, `generate <invoiceId>`, `expiring`.

**`backup.ts`** — top-level commands: `export --tenant <slug-or-id> -o <file>` (download a `.tar.gz` tenant backup) and `restore --tenant <slug-or-id> -i <file>` (upload into an empty tenant).

Use `fintranzact <command> --help` for each command's options.

### Common filter flags

List and report commands share these where they apply (check `--help` per command):

```
--from <YYYY-MM-DD>  --to <YYYY-MM-DD>
--this-month  --this-quarter  --this-fy     # not every command has all three
--status <status>  --type <type>  --party <name>  --party-id <id>  --search <q>
--page <n>  --limit <n>                       # default page size is 20
--quarter Q1..Q4  --month <n>  --year <n>     # gst commands
```

Text search is a flag on `list`, e.g. `party list --search sharma` and `item list --search basmati`.

---

## 4. Interactive Flows

Interactive prompts use Node's `readline`. A command is interactive only when stdin is a TTY and `-y/--yes` is not given.

### 4.1 Login

`fintranzact login` asks for any of server URL (default `http://localhost:3000`), email and password that were not passed as flags. The password is masked with `*` as you type. It then lists your businesses and asks you to pick one if there is more than one, and prints the config file path.

With `--token <api key>` it skips email/password, validates the key with `auth.me`, then does the same business selection.

### 4.2 Invoice creation

`fintranzact invoice create` with no item flags runs a wizard:

1. Party search: type a search term, pick from up to 5 matches.
2. Line items: search an item (or type a free-text description), pick a match (or `0` to use the text as a description), then enter quantity, unit price, tax % and discount % (price and tax default from the item). An empty search ends the list.
3. A summary, then `Create this invoice? (y/n)`.

On success it prints the invoice number and total, plus `invoice get` and `invoice pdf` commands for the new invoice.

With flags it runs without prompts:

```
fintranzact invoice create \
  --party "Sharma Traders" \
  --item "Basmati Rice 5kg" --qty 10 --rate 1200 \
  --item "Toor Dal 1kg" --qty 5 \
  --delivery hand_delivery \
  --yes
```

`--party` takes the first search match. Without `--rate`, the item's sale price is used; if the item is not found and no rate is given, the command fails. `--item/--qty/--rate` can repeat.

### 4.3 Payment recording

`fintranzact payment create` without flags: party search and pick, a list of that party's unpaid invoices (sent / partial / overdue), then prompts for amount, mode (default `upi`), reference, date and notes, and a confirmation. The payment can be linked to one invoice with `--invoice-id`; there is no per-invoice allocation prompt.

### 4.4 Other prompts

`item create`, `party create` and `bank create` prompt for required fields that were not passed as flags.

### 4.5 Confirmations

These commands ask `(y/n)` before acting when interactive: deletes (invoice, party, item, payment, expense, document types, automated invoice), `api-key revoke`, `tenant remove`, `store order-confirm` / `order-cancel`, `document convert`, `business export`, `restore`. `-y/--yes` skips the prompt.

---

## 5. Non-Interactive Mode and Output Formats

### 5.1 JSON

Almost every command accepts `--json` and prints the API result with `JSON.stringify(data, null, 2)`. The exceptions are `login`, `logout`, `profile update-name`, `export`, `restore`, `gst r1-csv`, `invoice pdf` and `session revoke-all`.

Paginated lists wrap the rows, for example `invoice list --json`:

```json
{
  "data": [ { "id": "…", "invoiceNumber": "INV-0040", "status": "overdue", "totalAmount": "800.00", … } ],
  "pagination": { "page": 1, "limit": 20, "total": 3, "hasMore": false }
}
```

Other commands print the API's response as-is.

### 5.2 `--format`

| Value | Output | Where |
|---|---|---|
| (default) / `table` | Box-drawn table, width-aware | All list/report commands |
| `tsv` | Header row + tab-separated rows, ANSI stripped | Commands that list `--format` in `--help` |
| `csv` | Header row + RFC-style quoted CSV | Same |
| `ids` | One ID per line | `invoice list`, `party list`, `item list`, `payment list`, `expense list`, `automated-invoice list`, document-type `list` |

`--format` on `import` commands means the **input** file format (`json` or `csv`).

Paginated tables end with a `Showing 1-20 of 156` footer.

### 5.3 Piping

```
fintranzact invoice list --status overdue --format tsv | awk -F'\t' '{print $1}'
fintranzact invoice list --this-fy --format csv > invoices.csv
fintranzact invoice list --status draft --format ids | xargs -I{} fintranzact invoice status {} sent
fintranzact invoice list --json | jq '.data[].invoiceNumber'
```

Errors and warnings go to stderr, so stdout stays clean for pipes.

---

## 6. Error States and Exit Codes

### 6.1 Exit codes (`EXIT` in `src/output.ts`)

| Code | Name | Used for |
|---|---|---|
| 0 | `SUCCESS` | Success, or a cancelled confirmation |
| 1 | `GENERAL` | Unexpected errors; also commander's own parse errors (unknown command or option, missing argument) |
| 2 | `USAGE` | Bad or missing arguments caught by the command |
| 3 | `AUTH` | Not logged in, or session/API key rejected |
| 4 | `FORBIDDEN` | Permission denied |
| 5 | `NOT_FOUND` | Resource not found |
| 6 | `VALIDATION` | API validation errors |
| 7 | `NETWORK` | API unreachable |
| 8 | `CONFLICT` | Defined, not currently used by any command |
| 9 | `RATE_LIMITED` | Defined, not currently used by any command |

Exception: `export` and `restore` (`src/commands/backup/*.ts`) use their own codes, listed in their `--help`: export — 1 auth/permission, 2 rate limit (2 exports per day), 5 server or network error; restore — 1 auth/permission, 3 target tenant not empty, 4 file error, 5 server error.

### 6.2 Error output

`fatalError(message, code)` writes `Error: <message>` to stderr (red when colour is on) and exits with the code. `warn()` writes `Warning: <message>` to stderr. There is no JSON error format: with `--json`, errors are still plain text on stderr.

The API client normalises tRPC errors into `unauthorized`, `forbidden`, `not_found`, `validation_failed` (with Zod field errors), `rate_limited`, `network_error` and `api_error`. Validation errors print one line per field:

```
Error: Validation failed:
  name: String must contain at least 1 character(s)
```

Commands map these to exit codes, e.g. an expired session prints `Session expired. Run: fintranzact login` and exits 3.

### 6.3 Warnings

- Session tokens older than 25 days: `Session expires soon. Run: fintranzact login` (not shown for API keys).
- `checkMaintenance()` warns when the server reports maintenance mode or a scheduled maintenance window. It never blocks; failures are ignored.

---

## 7. Configuration & Auth

### 7.1 Config file (`src/config.ts`)

Stored with `conf` under project name `fintranzact`, file `config.json`, so on Linux `~/.config/fintranzact/config.json` (macOS and Windows use their usual config folders). `login` prints the exact path.

- The file is **encrypted** with a key derived from the OS user ID and hostname (SHA-256). This stops casual reading; it is not strong protection.
- File mode `0600` (owner read/write only).

Fields: `apiUrl`, `token`, `tenantId`, `businessId`, `businessName`, `tokenCreatedAt`.

`token` is either the session ID returned by `auth.login` or an API key (`fintranzact_key_…`). There is no OS keychain support.

### 7.2 Environment variables

When both `FINTRANZACT_TOKEN` and `FINTRANZACT_API_URL` are set, they are used instead of the config file and nothing is written to disk (for CI and scripts). Optional: `FINTRANZACT_TENANT_ID`, `FINTRANZACT_BUSINESS_ID`, `FINTRANZACT_BUSINESS_NAME`.

Colour: `NO_COLOR` or `FORCE_COLOR=0` turns it off.

### 7.3 Auth checks

- `requireAuth()` needs token, API URL, business ID and tenant ID; otherwise it exits 3 with `Not authenticated. Run: fintranzact login`.
- `requireTenantAuth()` (used by `export`/`restore`) needs only token, API URL and tenant ID.

---

## 8. Implementation Notes

### 8.1 API communication (`src/client.ts`)

`FintranzactClient` is a hand-written client for the API's tRPC HTTP endpoints. It does not import the API's types; each method declares its own return type. It has 254 methods in 35 namespaces (`auth`, `business`, `invoice`, … `selfImport`).

- Queries: `GET {apiUrl}/api/trpc/<path>?input=<superjson>`.
- Mutations: `POST {apiUrl}/api/trpc/<path>` with a superjson body.
- No request batching and no request timeout.
- Headers: `Authorization: Bearer <token>`, `x-tenant-id`, `x-client-type: cli`, and `x-business-id` when a business is selected.
- HTTP 429 becomes a `rate_limited` error using `Retry-After` (capped at 2 minutes). Queries retry up to 2 times, waiting at most 10 s each; mutations do not retry.
- Responses are unwrapped from the tRPC envelope and deserialised with superjson.

`export` and `restore` stream the archive with `fetch` directly.

### 8.2 Document types

Seven document types are separate groups (`quotation`, `credit-note`, `debit-note`, `delivery-challan`, `proforma`, `sales-return`, `purchase-return`), all built from one config list in `registrars/document.ts` and one handler module, `commands/document/factory.ts`. `document convert` converts between types.

### 8.3 Reports

`report` covers 15 report commands that call the API's `reports` router; `dashboard` covers 12 widgets from the `dashboard` router; `gst` covers GSTR-1, GSTR-3B, GSTR-1 CSV, GSTR-9 and GSTR-2B uploads.

---

## 9. Not Built

These ideas were in the original design and do not exist in the code:

- **Libraries**: `@oclif/core`, `inquirer`/`@inquirer/prompts`, `ora` spinners, `cli-table3`, `ofetch`/`ky`, `fuse.js`, `keytar`. The CLI uses `commander`, `readline`, its own table code and `fetch`.
- **Location `apps/cli/`**: it lives in `packages/cli/`.
- **Typed tRPC client** (`createTRPCClient<AppRouter>`): a hand-written client is used instead. Auth is a bearer token, not a `session_id` cookie.
- **Config commands** (`config show`, `config set`), `defaults` / `display` config sections, and `FINTRANZACT_SERVER`, `FINTRANZACT_SESSION_ID`, `FINTRANZACT_NO_COLOR`, `FINTRANZACT_FORMAT` env vars.
- **`--no-color` and `--quiet`/`-q` flags** (use `NO_COLOR`).
- **`--idempotency-key`** on create commands.
- **Batch operations**: bulk `invoice status --from-status … --to-status …`, `import … --dry-run`, `import --file`.
- **Invoice extras**: `invoice edit`, `invoice duplicate`, `--skip-stock-check`, `--additional-charges`, `--invoice-discount`, per-line `--tax`/`--discount`; `get` by invoice number (it takes an ID).
- **Payment allocation prompts** across several invoices.
- **`party search` / `item search` commands** (use `list --search`).
- **Interactive table keys** (`[n] Next page`, `[q] Quit`, sort keys) and action menus on detail views.
- **Shell completions** (`fintranzact completion bash|zsh|fish`) and the completion cache.
- **Shortest-unique-prefix commands** (`fintranzact inv list`). Only the three aliases above exist. Commander's built-in "Did you mean …?" suggestion for unknown commands is the only fuzzy matching.
- **"Next steps" hints** after actions (only `invoice create` prints follow-up commands).
- **`--repeat` / `--last`** recent-command context.
- **Offline support**: `dashboard --cached`, local party/item caches, `--queue` and `fintranzact sync`.
- **JSON error output** on stderr in `--json` mode.
- **Exit code 8 (conflict)**: defined but unused.
- **Report commands** `report pnl`, `report ageing`, `report expense-summary`, `report sale-register` (P&L is `dashboard profit-loss`; ageing is `dashboard receivables-aging`; the register is `sales-register`).
- **`invoice list --doc-type`** (each document type has its own group) and a `challan` alias (the group is `delivery-challan`).
