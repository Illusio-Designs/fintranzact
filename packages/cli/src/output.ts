import chalk from "chalk";
import { formatPlanRequired, planRequiredJson, formatTwoFactorRequired, type PlanRequiredError, type TwoFactorRequiredError } from "./plan.js";

// ── Environment detection ──────────────────────────────────────────────────

export function isInteractive(): boolean {
  return process.stdout.isTTY === true;
}

export function hasColor(): boolean {
  if (process.env["NO_COLOR"] !== undefined) return false;
  if (process.env["FORCE_COLOR"] === "0") return false;
  return process.stdout.hasColors?.() ?? isInteractive();
}

// ── Strip ANSI ─────────────────────────────────────────────────────────────

export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

// ── Terminal width tiers ──────────────────────────────────────────────────

export type WidthTier = "narrow" | "standard" | "wide";

export function getWidthTier(): WidthTier {
  const w = process.stdout.columns ?? 80;
  if (w < 80) return "narrow";
  if (w <= 120) return "standard";
  return "wide";
}

export function termWidth(): number {
  return process.stdout.columns ?? 80;
}

// ── Exit codes ────────────────────────────────────────────────────────────

export const EXIT = {
  SUCCESS: 0,
  GENERAL: 1,
  USAGE: 2,
  AUTH: 3,
  FORBIDDEN: 4,
  NOT_FOUND: 5,
  VALIDATION: 6,
  NETWORK: 7,
  CONFLICT: 8,
  RATE_LIMITED: 9,
  PLAN_REQUIRED: 10,
  TWO_FACTOR_REQUIRED: 11,
} as const;

// ── Output helpers ────────────────────────────────────────────────────────

export function fatalError(message: string, code = 1): never {
  if (hasColor()) {
    process.stderr.write(chalk.red("Error: ") + message + "\n");
  } else {
    process.stderr.write("Error: " + message + "\n");
  }
  process.exit(code);
}

export function success(message: string): void {
  if (hasColor()) {
    process.stdout.write(chalk.green("✓ ") + message + "\n");
  } else {
    process.stdout.write("OK: " + message + "\n");
  }
}

export function warn(message: string): void {
  if (hasColor()) {
    process.stderr.write(chalk.yellow("Warning: ") + message + "\n");
  } else {
    process.stderr.write("Warning: " + message + "\n");
  }
}

// ── JSON output ───────────────────────────────────────────────────────────

export function outputJSON(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

// ── Table output ──────────────────────────────────────────────────────────

export interface ColumnDef<T extends object> {
  key: keyof T | string;
  header: string;
  width?: number;
  align?: "left" | "right";
  format?: (value: unknown, row: T) => string;
}

function getNestedValue(obj: object, key: string): unknown {
  const parts = key.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function padEnd(str: string, len: number): string {
  const visual = stripAnsi(str).length;
  const pad = Math.max(0, len - visual);
  return str + " ".repeat(pad);
}

function padStart(str: string, len: number): string {
  const visual = stripAnsi(str).length;
  const pad = Math.max(0, len - visual);
  return " ".repeat(pad) + str;
}

export function outputTable<T extends object>(rows: T[], columns: ColumnDef<T>[]): void {
  if (rows.length === 0) {
    process.stdout.write("  (no results)\n");
    return;
  }

  // Compute column widths
  const widths = columns.map((col) => {
    let max = stripAnsi(col.header).length;
    for (const row of rows) {
      const val = col.format
        ? col.format(getNestedValue(row, col.key as string), row)
        : String(getNestedValue(row, col.key as string) ?? "");
      const vis = stripAnsi(val).length;
      if (vis > max) max = vis;
    }
    if (col.width) max = Math.min(max, col.width);
    return max;
  });

  const sep = "─".repeat(widths.reduce((s, w) => s + w + 2, 1));

  // Header
  let header = " ";
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    const h = col.align === "right"
      ? padStart(col.header, widths[i])
      : padEnd(col.header, widths[i]);
    header += (hasColor() ? chalk.dim(h) : h) + "  ";
  }
  process.stdout.write(" " + (hasColor() ? chalk.dim(sep) : sep) + "\n");
  process.stdout.write(header.trimEnd() + "\n");
  process.stdout.write(" " + (hasColor() ? chalk.dim(sep) : sep) + "\n");

  // Rows
  for (const row of rows) {
    let line = " ";
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      let val = col.format
        ? col.format(getNestedValue(row, col.key as string), row)
        : String(getNestedValue(row, col.key as string) ?? "");
      // Truncate if needed
      const vis = stripAnsi(val).length;
      if (col.width && vis > col.width) {
        val = val.slice(0, col.width - 1) + "…";
      }
      const cell = col.align === "right"
        ? padStart(val, widths[i])
        : padEnd(val, widths[i]);
      line += cell + "  ";
    }
    process.stdout.write(line.trimEnd() + "\n");
  }

  process.stdout.write(" " + (hasColor() ? chalk.dim(sep) : sep) + "\n");
}

// ── TSV output ────────────────────────────────────────────────────────────

export function outputTSV<T extends object>(rows: T[], columns: ColumnDef<T>[]): void {
  process.stdout.write(columns.map((c) => c.header).join("\t") + "\n");
  for (const row of rows) {
    const line = columns.map((col) => {
      const val = col.format
        ? col.format(getNestedValue(row, col.key as string), row)
        : String(getNestedValue(row, col.key as string) ?? "");
      return stripAnsi(val).replace(/\t/g, " ");
    });
    process.stdout.write(line.join("\t") + "\n");
  }
}

// ── CSV output ────────────────────────────────────────────────────────────

function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

export function outputCSV<T extends object>(rows: T[], columns: ColumnDef<T>[]): void {
  process.stdout.write(columns.map((c) => csvEscape(c.header)).join(",") + "\n");
  for (const row of rows) {
    const line = columns.map((col) => {
      const val = col.format
        ? col.format(getNestedValue(row, col.key as string), row)
        : String(getNestedValue(row, col.key as string) ?? "");
      return csvEscape(stripAnsi(val));
    });
    process.stdout.write(line.join(",") + "\n");
  }
}

// ── ID-only output ────────────────────────────────────────────────────────

export function outputIds(ids: string[]): void {
  for (const id of ids) {
    process.stdout.write(id + "\n");
  }
}

// ── Pagination footer ─────────────────────────────────────────────────────

export function paginationFooter(page: number, limit: number, total: number): void {
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const msg = `  Showing ${from}-${to} of ${total}`;
  process.stdout.write("\n" + (hasColor() ? chalk.dim(msg) : msg) + "\n");
}

// ── Plan-required errors ──────────────────────────────────────────────────

export function wantsJson(argv: string[] = process.argv): boolean {
  return argv.includes("--json");
}

/**
 * Report a plan / entitlement refusal (read-only organisation, plan limit,
 * add-on, suspended) and exit with EXIT.PLAN_REQUIRED. JSON mode (--json)
 * prints {error:{code:"plan_required",reason,message,upgradeUrl}} on stdout so
 * scripts can parse it; human mode prints the message and the billing link on
 * stderr. The `exit` and `write` hooks exist for tests.
 */
export function handlePlanRequired(
  err: PlanRequiredError,
  opts: {
    json?: boolean;
    exit?: (code: number) => never;
    out?: (s: string) => void;
    errOut?: (s: string) => void;
  } = {},
): never {
  const json = opts.json ?? wantsJson();
  const out = opts.out ?? ((s: string) => void process.stdout.write(s));
  const errOut = opts.errOut ?? ((s: string) => void process.stderr.write(s));
  const exit = opts.exit ?? ((c: number) => process.exit(c));
  if (json) {
    out(JSON.stringify(planRequiredJson(err), null, 2) + "\n");
  } else {
    const prefix = hasColor() ? chalk.red("Error: ") : "Error: ";
    errOut(prefix + formatPlanRequired(err) + "\n");
  }
  return exit(EXIT.PLAN_REQUIRED);
}

/**
 * Report that the organisation requires two-factor authentication and this
 * session has not set it up, and exit with EXIT.TWO_FACTOR_REQUIRED. JSON mode
 * prints {error:{code:"two_factor_required",message}} on stdout; human mode
 * prints the message on stderr. API keys never reach this.
 */
export function handleTwoFactorRequired(
  _err: TwoFactorRequiredError,
  opts: {
    json?: boolean;
    exit?: (code: number) => never;
    out?: (s: string) => void;
    errOut?: (s: string) => void;
  } = {},
): never {
  const json = opts.json ?? wantsJson();
  const out = opts.out ?? ((s: string) => void process.stdout.write(s));
  const errOut = opts.errOut ?? ((s: string) => void process.stderr.write(s));
  const exit = opts.exit ?? ((c: number) => process.exit(c));
  const message = formatTwoFactorRequired();
  if (json) {
    out(JSON.stringify({ error: { code: "two_factor_required", message } }, null, 2) + "\n");
  } else {
    const prefix = hasColor() ? chalk.red("Error: ") : "Error: ";
    errOut(prefix + message + "\n");
  }
  return exit(EXIT.TWO_FACTOR_REQUIRED);
}
