import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import type { Context, Next } from "hono";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { eq, and, gt, lt, inArray, isNull, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { escapeLike } from "./lib/escape-like.js";
import { buildBusinessDateFilter } from "./lib/business-date.js";
import { documentIsIntraState } from "./lib/document-totals.js";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import QRCode from "qrcode";
import { appRouter } from "./router.js";
import { createContext, getSessionIdFromRequest } from "./context.js";
import type { InvoicePDFData } from "./lib/invoice-pdf.js";
import { generateEwayBillPDF, type EwayBillPDFData } from "./lib/eway-bill-pdf.js";
import { sampleInvoiceData } from "./lib/invoice-templates/sample.js";
import { generateLedgerPDF } from "./lib/ledger-pdf.js";
import { generateLabelSheetPDF, LABEL_PRESETS, TYPE_PRESET } from "./lib/label-pdf.js";
import { asBarcodeType } from "./lib/barcode-setup.js";
import { verifyBusinessAccess } from "./lib/business-membership.js";
import { recordShareView, resolveShareToken } from "./lib/share-links.js";
import { controlDb, getTenantDb, invoices, invoiceItems, items, itemVariants, parties, businesses, sessions, tenants, emailChangeTokens, bankAccounts, storeOrders, payments, ewayBills, ewayBillVehicleUpdates, assertMigrationsPresent } from "@fintranzact/db";
import { calcLineItem, calcInvoiceTotals, money, parseCopies, isIntraStateSupply, formatIstDate, INVOICE_TEMPLATES, splitIntraStateTax, type InvoiceTemplate, type ThermalWidth } from "@fintranzact/shared";
import { verifyTurnstile } from "./lib/turnstile.js";
import { startRecurringScheduler, stopRecurringScheduler } from "./lib/recurring-invoice-scheduler.js";
import { startPaymentReminderScheduler, stopPaymentReminderScheduler } from "./lib/payment-reminders.js";
import { startTdsReminderScheduler, stopTdsReminderScheduler } from "./lib/tds-reminder-scheduler.js";
import { startHsnRefreshScheduler, stopHsnRefreshScheduler } from "./lib/hsn-refresh.js";
import { startTrialReminderScheduler, stopTrialReminderScheduler } from "./lib/trial-reminders.js";
import { seedPlatformAdmin } from "./lib/platform-admin.js";
import { logger } from "./lib/logger.js";
import { storeServesTenant } from "./lib/plan-limits.js";
import { resolvePdfBranding, type PdfBranding } from "./lib/pdf-branding.js";
import { resolveDocumentWarehouseId, syncDocumentStock } from "./lib/inventory-service.js";
import { resolveLineBatches } from "./lib/batches.js";
import { lineBatchDetails } from "./lib/batch-display.js";
import { validateEnv } from "./lib/env.js";
import { createCsrfMiddleware } from "./lib/csrf-middleware.js";
import { assertAllowedStoreOrigin } from "./lib/store-origin.js";
import { isStorePolicyKind, calcStoreDelivery } from "@fintranzact/shared";
import { buildPublicPolicyPages, renderPolicyPageHtml } from "./lib/store-policies.js";
import { registerExportRoute } from "./http/exportStream.js";
import { registerImportRoute } from "./http/importStream.js";
import { registerRazorpayWebhook } from "./http/razorpayWebhook.js";
import { registerBillingInvoiceRoute } from "./http/billingInvoice.js";
import { registerBusinessRazorpayWebhook } from "./http/businessRazorpayWebhook.js";
import { registerStorePaymentRoutes } from "./http/storePayments.js";
import { registerAiStreamRoute } from "./http/aiStream.js";
import { createStoreOrderPaymentLink, loadStorePaymentOptions } from "./lib/store-payments/order-payment.js";
import { sendStoreOrderEmail } from "./lib/store-payments/emails.js";
import { createSharePaymentLink, shareOnlinePaymentAvailable } from "./lib/razorpay/share.js";
import { createFixedWindowLimiter } from "./lib/fixed-window-limiter.js";
import { listPublicPlansJson } from "./lib/public-plans.js";
import { apiSecureHeaders } from "./lib/security-headers.js";

// ── Process crash handlers ────────────────────────────────────
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection — shutting down");
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception — shutting down");
  process.exit(1);
});

// ── Environment validation ────────────────────────────────────
validateEnv();

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const app = new Hono();

// ── Security headers ───────────────────────────────────────────
app.use("*", ...apiSecureHeaders());

// ── Request ID tracing ────────────────────────────────────────
app.use("*", async (c: Context, next: Next) => {
  const raw = c.req.header("x-request-id");
  const requestId = (raw && raw.length <= 128) ? raw.replace(/[^a-zA-Z0-9\-_]/g, "") : randomUUID();
  c.set("requestId", requestId);
  c.header("x-request-id", requestId);
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  logger.info({
    requestId,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration,
  }, `${c.req.method} ${c.req.path} ${c.res.status} ${duration}ms`);
});

// ── CORS ───────────────────────────────────────────────────────
// Tauri desktop webviews serve the bundled app from `tauri.localhost` and
// authenticate via Bearer tokens (not cookies). These origins are our own
// shipped app, not third parties, so we accept them unconditionally — the
// CSRF middleware's Bearer bypass is what actually gatekeeps desktop
// requests, not CORS. Listed per-scheme so the `origin` callback comparison
// matches exactly what the webview sends.
const TAURI_DESKTOP_ORIGINS = [
  "http://tauri.localhost",   // Linux / WSL (and the user-reported share URL)
  "https://tauri.localhost",  // Windows / macOS default asset scheme
  "tauri://localhost",        // Legacy custom protocol (kept for compat)
];

const allowedOrigins = [
  ...(process.env.CORS_ORIGINS || "http://localhost:5173").split(","),
  ...TAURI_DESKTOP_ORIGINS,
];

app.use("*", cors({
  origin: allowedOrigins,
  credentials: true,
  allowHeaders: ["Content-Type", "x-business-id", "Authorization", "X-Requested-With", "X-Fintranzact-Client", "X-Fintranzact-Client"],
  allowMethods: ["GET", "POST", "OPTIONS"],
  maxAge: 86400,
}));

// ── Safe IP extraction ─────────────────────────────────────────
// x-forwarded-for is client-controlled when not behind a trusted proxy.
// Trusting it directly allows anyone to spoof their IP and bypass rate limits.
// Cloudflare's cf-connecting-ip is stripped of spoofed values by the CDN layer.
// When behind a reverse proxy we take the LAST entry in x-forwarded-for
// (appended by the proxy itself), not the first (which the client can forge).
function getClientIp(c: Context): string {
  // Cloudflare provides the real client IP — trust it unconditionally
  const cfIp = c.req.header("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  // Behind a reverse proxy take the LAST entry — the proxy's own addition
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  return "unknown";
}

// ── Rate limiting (in-memory, per IP, origin-aware) ───────────
// Same-origin (.fintranzact.com) requests get higher limits (own apps).
// External/third-party origins get strict limits.
// Unauthenticated external requests get the lowest tier.
const rateMap = new Map<string, { count: number; reset: number }>();

const CORS_ORIGINS = (process.env.CORS_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);

function isSameOrigin(c: Context): boolean {
  const origin = c.req.header("origin") || "";
  // Same-origin: no Origin header (server-side calls), or matches configured CORS origins
  if (!origin) return true;
  if (CORS_ORIGINS.some((allowed) => origin === allowed)) return true;
  // Match *.fintranzact.com subdomains
  if (/^https?:\/\/([a-z0-9-]+\.)?fintranzact\.com$/i.test(origin)) return true;
  // Our own Tauri desktop app — different scheme/host but first-party.
  if (TAURI_DESKTOP_ORIGINS.includes(origin)) return true;
  return false;
}

// Rate limits per minute:
// Same-origin authenticated: 300 (normal app usage — higher to accommodate
//   post-import cache invalidation bursts and dashboard queries)
// Same-origin unauthenticated: 60 (login attempts, public pages)
// External authenticated: 120 (API consumers with valid session)
// External unauthenticated: 10 (prevent abuse from unknown sources)
app.use("/api/trpc/*", bodyLimit({ maxSize: 10 * 1024 * 1024 }));

// Escape hatch for e2e test harnesses that hammer the API during seeding.
// Only honored outside production, so accidentally setting this in a real
// deployment does nothing.
const rateLimitDisabled =
  process.env.DISABLE_RATE_LIMIT === "1" &&
  process.env.NODE_ENV !== "production";

app.use("/api/trpc/*", async (c: Context, next: Next) => {
  if (rateLimitDisabled) {
    await next();
    return;
  }
  const ip = getClientIp(c);
  const hasSession = c.req.header("cookie")?.includes("session_id=")
    || c.req.header("authorization")?.startsWith("Bearer ");
  const sameOrigin = isSameOrigin(c);

  let limit: number;
  let tier: string;
  if (sameOrigin && hasSession) { limit = 300; tier = "same-auth"; }
  else if (sameOrigin) { limit = 60; tier = "same-anon"; }
  else if (hasSession) { limit = 120; tier = "ext-auth"; }
  else { limit = 10; tier = "ext-anon"; }

  const key = `${tier}:${ip}`;
  const now = Date.now();
  const entry = rateMap.get(key);
  if (!entry || now > entry.reset) {
    rateMap.set(key, { count: 1, reset: now + 60_000 });
  } else if (entry.count >= limit) {
    c.header("Retry-After", "60");
    return c.json({ error: "Too many requests" }, 429);
  } else {
    entry.count++;
  }
  await next();
});

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateMap) {
    if (now > entry.reset) rateMap.delete(key);
  }
}, 5 * 60_000).unref();

// ── CSRF protection (non-tRPC routes) ─────────────────────────
// State-changing requests authenticated via cookies must include the
// `X-Requested-With: fintranzact` header. This blocks cross-origin form
// submissions and navigation-based CSRF attacks.
//
// Scope:
//   - tRPC routes (/api/trpc/*) are intentionally skipped here and
//     gated by a matching tRPC-level middleware in `trpc.ts`. Doing
//     the rejection at the tRPC layer means the client receives a
//     real `TRPCError` envelope (shaped by superjson) instead of a
//     Hono `{error: "…"}` blob that the tRPC HTTP link cannot parse
//     — the latter was the root cause of the Android "Unable to
//     transform response from server" regression.
//   - Non-tRPC routes (store REST endpoints, webhooks, etc.) still
//     get the plain Hono 403 shape, which their clients expect.
//
// Bearer-authenticated requests are exempt because:
//   1. Bearer tokens are not vulnerable to CSRF — they live in
//      client-controlled storage, not browser cookies, so a hostile
//      origin cannot forge a request that carries them.
//   2. React Native's native HTTP stack maintains a per-app cookie
//      jar that replays stale `session_id` cookies on every request
//      even when the JS tRPC client never set them. Without this
//      bypass the mobile app would be locked out after its first
//      successful sign-in.
//
// GET/HEAD/OPTIONS are exempt by HTTP convention (side-effect-free).
//
// WARNING — `/store/*` exemption:
// Every route under `/store/*` must remain fully public (no cookie-based
// auth). The CSRF exemption here presumes Turnstile + per-IP rate limit
// + Origin allow-list check are the protection layer for store POSTs.
// If you ever add an authenticated endpoint under `/store/*` (e.g.,
// `POST /store/:slug/fulfill` that reads the admin session cookie),
// narrow this exemption to an explicit allow-list of paths BEFORE
// merging — leaving the blanket `/store/` skip in place would expose
// that new endpoint to CSRF.
app.use("*", createCsrfMiddleware({ skipPathPrefixes: ["/api/trpc/", "/store/"] }));

// ── Health check ───────────────────────────────────────────────
// ── UPI payment redirect ──────────────────────────────────────
// HTTPS endpoint that redirects to upi:// deep link.
// Used in PDF QR codes — PDF viewers won't open upi:// directly
// but will open https:// links which then redirect to the UPI app.
app.get("/pay/upi", async (c) => {
  const pa = c.req.query("pa");
  const pn = c.req.query("pn");
  const am = c.req.query("am");
  const tn = c.req.query("tn");
  if (!pa || !am) return c.text("Missing payment parameters", 400);

  const upiUrl = `upi://pay?pa=${encodeURIComponent(pa)}&pn=${encodeURIComponent(pn || "")}&am=${encodeURIComponent(am)}&cu=INR&tn=${encodeURIComponent(tn || "")}`;

  // Generate QR code for desktop view
  const qrDataUrl = await QRCode.toDataURL(upiUrl, { width: 280, margin: 2 });

  // Responsive page: mobile auto-redirects to UPI app, desktop shows QR to scan
  return c.html(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pay ${escapeHtml(pn || pa)} \u20B9${escapeHtml(am)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8f9fa;color:#1a1a2e;padding:1rem}
  .card{text-align:center;max-width:380px;width:100%;background:#fff;border-radius:16px;padding:2rem 1.5rem;box-shadow:0 2px 16px rgba(0,0,0,0.06)}
  .icon{width:48px;height:48px;margin:0 auto 1rem;background:#eef2ff;border-radius:12px;display:flex;align-items:center;justify-content:center}
  .icon svg{width:24px;height:24px;color:#5046e5}
  .to{font-size:.9rem;color:#666;margin-bottom:.25rem}
  .amount{font-size:2.25rem;font-weight:700;color:#1a1a2e;margin-bottom:1.5rem;letter-spacing:-0.02em}
  .pay-btn{display:inline-block;background:#5046e5;color:#fff;padding:.875rem 2.5rem;border-radius:10px;text-decoration:none;font-weight:600;font-size:1rem;transition:background .15s}
  .pay-btn:active{background:#3d35c4}
  .qr{margin:1.5rem auto 0;padding:1rem;background:#fff;border-radius:12px;border:1px solid #eee;display:inline-block}
  .qr img{display:block;width:200px;height:200px}
  .scan-text{margin-top:.75rem;font-size:.8rem;color:#999}
  .mobile-only{display:none}
  .desktop-only{display:block}
  @media(max-width:768px){
    .mobile-only{display:block}
    .desktop-only{display:none}
  }
</style>
</head><body>
<div class="card">
  <div class="icon"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4"/></svg></div>
  <div class="to">Pay ${escapeHtml(pn || pa)}</div>
  <div class="amount">\u20B9${escapeHtml(am)}</div>

  <div class="mobile-only">
    <a class="pay-btn" href="${upiUrl}">Pay with UPI</a>
  </div>

  <div class="desktop-only">
    <div class="qr"><img src="${qrDataUrl}" alt="UPI QR Code" width="200" height="200"></div>
    <p class="scan-text">Scan with any UPI app to pay</p>
  </div>
</div>
</body></html>`);
});

// Public plan catalogue (prices, features, enforced limits). Unlimited = null.
app.get("/api/plans", async (c) => {
  c.header("Cache-Control", "public, max-age=60");
  return c.json({ plans: await listPublicPlansJson() });
});

app.get("/health", async (c) => {
  const deep = c.req.query("deep") === "true";
  const result: Record<string, unknown> = { status: "ok", timestamp: new Date().toISOString() };

  if (deep) {
    try {
      await controlDb.execute(sql`SELECT 1`);
      result.db = "ok";
    } catch {
      result.status = "degraded";
      result.db = "error";
    }
  }

  return c.json(result, result.status === "ok" ? 200 : 503);
});
// ONCE health check — lenient during PG handover (rolling deploy)
app.get("/up", async (c) => {
  try {
    await controlDb.execute(sql`SELECT 1`);
    return c.text("OK", 200);
  } catch {
    // During rolling deploy, PG may be transitioning between containers.
    // Allow 30s grace period for the handover to complete.
    if (process.uptime() < 30) {
      return c.text("WARMING", 200);
    }
    return c.text("PG_DOWN", 503);
  }
});

// ── PDF worker concurrency limiter ────────────────────────────
// Cap concurrent PDF worker threads to prevent CPU saturation under load.
class Semaphore {
  private queue: Array<{ resolve: () => void; timer: ReturnType<typeof setTimeout> }> = [];
  private active = 0;
  constructor(private max: number, private timeoutMs = 30_000) {}
  async acquire(): Promise<void> {
    if (this.active < this.max) { this.active++; return; }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex(e => e.timer === timer);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(new Error("Semaphore acquire timed out"));
      }, this.timeoutMs);
      this.queue.push({ resolve, timer });
    });
  }
  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) { clearTimeout(next.timer); this.active++; next.resolve(); }
  }
}

const pdfSemaphore = new Semaphore(os.cpus().length);

/** Collect a PDFKit document into a Buffer. */
function pdfToBuffer(doc: { on: (e: string, cb: (chunk?: Buffer) => void) => void; end: () => void }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk!));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject as (chunk?: Buffer) => void);
    doc.end();
  });
}

async function generatePDFInWorker(data: any, format: "a5" | "a4" | "thermal"): Promise<Buffer> {
  await pdfSemaphore.acquire();
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const jsPath = path.resolve(dir, "lib/pdf-worker.js");
    const fs = await import("node:fs");

    if (fs.existsSync(jsPath)) {
      // Production: built .js worker exists, run in a worker thread
      return await new Promise((resolve, reject) => {
        const worker = new Worker(jsPath, { workerData: { data, format } });
        worker.on("message", resolve);
        worker.on("error", reject);
        worker.on("exit", (code) => {
          if (code !== 0) reject(new Error(`PDF worker exited with code ${code}`));
        });
      });
    }

    // Dev: no built worker, run in-process (tsx doesn't support worker threads well)
    const { generateInvoicePDF } = await import("./lib/invoice-pdf.js");
    return await new Promise((resolve, reject) => {
      const doc = generateInvoicePDF(data, format);
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.end();
    });
  } finally {
    pdfSemaphore.release();
  }
}

// ── PDF-specific rate limiting (per IP, 30/min) ──────────────
const pdfRateMap = new Map<string, { count: number; reset: number }>();
const PDF_RATE_LIMIT = 30; // per minute
const PDF_RATE_WINDOW = 60_000;

function checkPdfRateLimit(ip: string): boolean {
  if (rateLimitDisabled) return true;
  const now = Date.now();
  const entry = pdfRateMap.get(ip);
  if (!entry || now > entry.reset) {
    pdfRateMap.set(ip, { count: 1, reset: now + PDF_RATE_WINDOW });
    return true;
  }
  entry.count++;
  return entry.count <= PDF_RATE_LIMIT;
}

// Cleanup stale PDF rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of pdfRateMap) {
    if (now > entry.reset) pdfRateMap.delete(ip);
  }
}, 300_000).unref();

/**
 * Everything the invoice PDF needs, read from the tenant DB. Shared by the
 * signed-in PDF download and the public share-link endpoints so both print
 * the same document. Null when the invoice is not in this business.
 */
async function buildInvoicePdfData(
  db: Awaited<ReturnType<typeof getTenantDb>>,
  businessId: string,
  invoiceId: string,
  origin: string,
  branding: PdfBranding,
) {
  // Fetch invoice with party and business
  const [invoice] = await db.select().from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.businessId, businessId))).limit(1);
  if (!invoice) return null;

  const [party] = await db.select().from(parties).where(eq(parties.id, invoice.partyId)).limit(1);
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  const lineItems = await db.select().from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, invoiceId)).orderBy(invoiceItems.sortOrder);

  // Fetch HSN codes and base units for linked items.
  // Historical join — intentionally no `isNull(items.deletedAt)` filter.
  // The invoice was created when the item existed; deleting the item later
  // must not blank out HSN or unit on a previously-generated PDF.
  const itemIds = lineItems.map(li => li.itemId).filter(Boolean) as string[];
  const itemMeta = itemIds.length > 0
    ? await db.select({ id: items.id, hsn: items.hsn, unit: items.unit, mrp: items.mrp, itemType: items.itemType }).from(items).where(inArray(items.id, itemIds))
    : [];
  // MRP per line: the variant's, else the item's, scaled to an alternate unit.
  const variantIds = lineItems.map(li => li.variantId).filter(Boolean) as string[];
  const variantMrp = new Map(
    (variantIds.length > 0
      ? await db.select({ id: itemVariants.id, mrp: itemVariants.mrp }).from(itemVariants).where(inArray(itemVariants.id, variantIds))
      : []).map(v => [v.id, v.mrp]),
  );
  const itemMrp = new Map(itemMeta.map(i => [i.id, i.mrp]));
  const lineMrp = (li: typeof lineItems[number]): string | null => {
    const base = (li.variantId ? variantMrp.get(li.variantId) : null) ?? (li.itemId ? itemMrp.get(li.itemId) : null);
    if (!base || invoice.type !== "sale") return null;
    return money.mul(base, parseFloat(li.conversionFactor ?? "1") || 1);
  };
  const hsnMap = new Map(itemMeta.map(i => [i.id, i.hsn || ""]));
  const itemUnitMap = new Map(itemMeta.map(i => [i.id, i.unit]));
  // Batch and expiry of lines from batch-tracked items. A batch's own MRP
  // wins over the item's.
  const batchMap = await lineBatchDetails(db, businessId, lineItems);

  // Fetch bank accounts for payment info on invoice
  const bizBankAccounts = await db.select().from(bankAccounts)
    .where(eq(bankAccounts.businessId, businessId))
    .orderBy(bankAccounts.isDefault);

  // Find UPI account and primary bank account
  const upiAccount = bizBankAccounts.find(a => a.accountType === "upi");
  const bankAccount = bizBankAccounts.find(a => a.accountType === "savings" || a.accountType === "current")
    || bizBankAccounts.find(a => a.isDefault);

  // Generate UPI QR code if UPI account exists and invoice is a sale with remaining balance
  let upiQrDataUrl: string | undefined;
  let upiPayUrl: string | undefined;
  const upiId = upiAccount?.accountNumber; // UPI ID stored in accountNumber for UPI type
  if (upiId && invoice.type === "sale") {
    const balance = parseFloat(invoice.totalAmount) - parseFloat(invoice.amountPaid);
    if (balance > 0) {
      // QR encodes the raw upi:// deep link (scanned by phone cameras)
      const upiDeepLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(biz.name)}&am=${balance.toFixed(2)}&cu=INR&tn=${encodeURIComponent(invoice.invoiceNumber)}`;
      upiQrDataUrl = await QRCode.toDataURL(upiDeepLink, { width: 200, margin: 1 });
      // Clickable link uses HTTPS redirect (PDF viewers won't open upi:// directly)
      const apiBase = origin;
      upiPayUrl = `${apiBase}/pay/upi?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(biz.name)}&am=${balance.toFixed(2)}&tn=${encodeURIComponent(invoice.invoiceNumber)}`;
    }
  }

  const pdfData: InvoicePDFData = {
    businessName: biz.name,
    businessLegalName: biz.legalName || undefined,
    businessGstin: biz.gstin || undefined,
    businessPan: biz.pan || undefined,
    businessPhone: biz.phone || undefined,
    businessEmail: biz.email || undefined,
    businessAddress: biz.address || undefined,
    businessCity: biz.city || undefined,
    businessState: biz.state || undefined,
    businessPincode: biz.pincode || undefined,
    partyName: party.name,
    partyPhone: party.phone || undefined,
    partyEmail: party.email || undefined,
    partyGstin: party.gstin || undefined,
    partyBillingAddress: party.billingAddress || undefined,
    partyCity: party.city || undefined,
    partyState: party.state || undefined,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate.toISOString(),
    dueDate: invoice.dueDate?.toISOString(),
    type: invoice.type,
    lineItems: lineItems.map((li) => ({
      itemName: li.itemName,
      description: li.description,
      quantity: li.quantity,
      unit: li.selectedUnit || (li.itemId ? itemUnitMap.get(li.itemId) : undefined) || undefined,
      unitPrice: li.unitPrice,
      mrp: (() => {
        const batchMrp = li.batchId ? batchMap.get(li.batchId)?.mrp : null;
        return batchMrp && invoice.type === "sale"
          ? money.mul(batchMrp, parseFloat(li.conversionFactor ?? "1") || 1)
          : lineMrp(li);
      })(),
      freeQuantity: li.freeQuantity,
      rejectedQuantity: li.rejectedQuantity,
      rejectionReason: li.rejectionReason,
      batchNumber: li.batchId ? batchMap.get(li.batchId)?.batchNumber ?? null : null,
      expiryDate: li.batchId ? batchMap.get(li.batchId)?.expiryDate ?? null : null,
      taxPercent: li.taxPercent,
      taxAmount: li.taxAmount,
      discountPercent: li.discountPercent,
      totalAmount: li.totalAmount,
    })),
    subtotal: invoice.subtotal,
    taxAmount: invoice.taxAmount,
    discountAmount: invoice.discountAmount,
    additionalCharges: invoice.additionalCharges,
    tcsAmount: invoice.tcsAmount,
    totalAmount: invoice.totalAmount,
    amountPaid: invoice.amountPaid,
    notes: invoice.notes || undefined,
    termsAndConditions: invoice.termsAndConditions || undefined,
    bankAccountName: bankAccount?.accountName || undefined,
    bankAccountNumber: bankAccount?.accountNumber || undefined,
    bankIfsc: bankAccount?.ifsc || undefined,
    bankName: bankAccount?.bankName || undefined,
    upiId: upiId || undefined,
    upiQrDataUrl,
    upiPayUrl,
    gstRegistrationType: biz.gstRegistrationType || "unregistered",
    businessStateCode: biz.stateCode || undefined,
    partyStateCode: party.stateCode || undefined,
    lineItemHsn: lineItems.map(li => li.itemId ? (hsnMap.get(li.itemId) || "") : ""),
    isPaidPlan: branding.hidden,
    brandingUrl: branding.url,
    status: invoice.status,
    // Logo bytes are carried into the PDF worker. Buffers survive
    // structuredClone across worker threads as Uint8Array, and PDFKit
    // accepts either.
    logoBuffer: biz.logoData ?? undefined,
    signatureBuffer: biz.signatureData ?? undefined,
    // Invoice designs (Settings → Documents → Invoice design)
    documentType: invoice.documentType,
    roundOff: invoice.roundOff,
    isReverseCharge: invoice.isReverseCharge,
    partyShippingAddress: party.shippingAddress || undefined,
    partyPincode: party.pincode || undefined,
    partyGstRegistrationType: party.gstRegistrationType || undefined,
    businessLutArn: biz.lutArn || undefined,
    businessIecCode: biz.iecCode || undefined,
    businessCin: biz.cin || undefined,
    businessLlpin: biz.llpin || undefined,
    isServices: lineItems.length > 0 && lineItems.every((li) => {
      const type = li.itemId ? itemMeta.find((m) => m.id === li.itemId)?.itemType : null;
      return type === "service" || (!type && (hsnMap.get(li.itemId ?? "") ?? "").startsWith("99"));
    }),
    eInvoice: invoice.irn ? await eInvoicePrint(invoice) : undefined,
    eWayBill: await liveEwayBill(db, businessId, invoiceId),
    print: {
      template: (INVOICE_TEMPLATES as readonly string[]).includes(biz.invoiceTemplate) ? biz.invoiceTemplate as InvoiceTemplate : "classic",
      thermalWidth: biz.thermalWidth === 58 ? 58 : 80,
    },
  };

  return { pdfData, invoice, party, biz, lineItems };
}

/** IRN, Ack and the IRP's signed QR for printing. */
async function eInvoicePrint(invoice: typeof invoices.$inferSelect): Promise<InvoicePDFData["eInvoice"]> {
  let qrDataUrl: string | undefined;
  if (invoice.signedQrCode) {
    try {
      qrDataUrl = await QRCode.toDataURL(invoice.signedQrCode, { width: 260, margin: 1, errorCorrectionLevel: "L" });
    } catch {
      qrDataUrl = undefined; // an unreadable QR must not stop the invoice printing
    }
  }
  return {
    irn: invoice.irn!,
    ackNumber: invoice.irnAckNumber || undefined,
    ackDate: invoice.irnAckDate?.toISOString(),
    qrDataUrl,
  };
}

/** The invoice's live (generated or active) e-way bill, for the print. */
async function liveEwayBill(db: Awaited<ReturnType<typeof getTenantDb>>, businessId: string, invoiceId: string): Promise<InvoicePDFData["eWayBill"]> {
  const [ewb] = await db.select().from(ewayBills)
    .where(and(eq(ewayBills.invoiceId, invoiceId), eq(ewayBills.businessId, businessId), inArray(ewayBills.status, ["generated", "active"])))
    .orderBy(desc(ewayBills.createdAt))
    .limit(1);
  if (!ewb?.ewbNumber) return undefined;
  return {
    number: ewb.ewbNumber,
    date: ewb.ewbDate?.toISOString(),
    validUpto: ewb.validUpto?.toISOString(),
    vehicleNumber: ewb.vehicleNumber || undefined,
    transportMode: ewb.transportMode || undefined,
    transporterName: ewb.transporterName || undefined,
    transporterId: ewb.transporterId || undefined,
    distance: ewb.distance ?? undefined,
  };
}

/**
 * The signed-in checks every PDF endpoint makes: a live session, an active
 * organisation, and a business (x-business-id) the caller is a member of.
 * Returns the tenant DB to read from, or the error response to send.
 */
async function authorizePdfRequest(c: Context): Promise<
  | { ok: true; db: Awaited<ReturnType<typeof getTenantDb>>; businessId: string; branding: PdfBranding }
  | { ok: false; response: Response }
> {
  const fail = (body: { error: string }, status: 400 | 401 | 403) => ({ ok: false as const, response: c.json(body, status) });
  const sessionId = getSessionIdFromRequest(c.req.raw);
  if (!sessionId) return fail({ error: "Unauthorized" }, 401);
  const [sessionRow] = await controlDb
    .select({ userId: sessions.userId, tenantId: sessions.tenantId })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!sessionRow) return fail({ error: "Unauthorized" }, 401);
  if (!sessionRow.tenantId) return fail({ error: "No organization selected" }, 400);
  const [tenant] = await controlDb.select({ status: tenants.status, plan: tenants.plan })
    .from(tenants).where(eq(tenants.id, sessionRow.tenantId)).limit(1);
  if (!tenant || tenant.status !== "active") return fail({ error: "Organization suspended" }, 403);
  const businessId = c.req.header("x-business-id");
  if (!businessId) return fail({ error: "No business selected" }, 400);
  const db = await getTenantDb(sessionRow.tenantId);
  const access = await verifyBusinessAccess(db, businessId, sessionRow.tenantId, sessionRow.userId);
  if (!access.ok) return fail({ error: access.error }, 403);
  return { ok: true, db, businessId, branding: await resolvePdfBranding(sessionRow.tenantId, tenant.plan, new URL(c.req.url).origin) };
}

/** Print options from the query: copies=original,duplicate,triplicate and width=58|80. */
function printOptionsFromQuery(c: Context, base: InvoicePDFData["print"]): InvoicePDFData["print"] {
  const width = c.req.query("width");
  return {
    ...base,
    copies: parseCopies(c.req.query("copies")),
    ...(width === "58" || width === "80" ? { thermalWidth: Number(width) as ThermalWidth } : {}),
  };
}

// ── PDF Download endpoint ──────────────────────────────────────
app.get("/api/invoices/:id/pdf", async (c) => {
  if (!checkPdfRateLimit(getClientIp(c))) {
    return c.json({ error: "Too many PDF requests. Try again later." }, 429);
  }

  const invoiceId = c.req.param("id");
  const rawFormat = c.req.query("format") || "a5";
  // Accept legacy "a5-landscape" param from older clients and remap to "a5"
  const format = (rawFormat === "a5-landscape" ? "a5" : rawFormat) as "a5" | "a4" | "thermal";

  // Session, active organisation, and a business the caller belongs to.
  const auth = await authorizePdfRequest(c);
  if (!auth.ok) return auth.response;
  const { db, businessId, branding } = auth;

  const built = await buildInvoicePdfData(db, businessId, invoiceId, new URL(c.req.url).origin, branding);
  if (!built) return c.json({ error: "Invoice not found" }, 404);
  const { pdfData, invoice } = built;
  pdfData.print = printOptionsFromQuery(c, pdfData.print);

  const pdfBuffer = await generatePDFInWorker(pdfData, format);
  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoice.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf"`,
    },
  });
});

// ── Public share links (no sign-in) ─────────────────────────────
// A customer opens /i/<token> in the web app, which reads these. The token
// resolves through the control DB to exactly one document; nothing else in
// the tenant is reachable from it. Unknown, revoked and suspended-tenant
// tokens all answer the same 404. Rate limited like the PDF endpoint.

const SHARE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

async function loadSharedDocument(c: Context) {
  const token = c.req.param("token") ?? "";
  const link = await resolveShareToken(token);
  if (!link) return null;
  const db = await getTenantDb(link.tenantId);
  const built = await buildInvoicePdfData(db, link.businessId, link.documentId, new URL(c.req.url).origin, await resolvePdfBranding(link.tenantId, link.tenantPlan, new URL(c.req.url).origin));
  // A deleted document is gone for the customer too.
  if (!built || built.invoice.deletedAt) return null;
  // Credit notes and returns against it reduce what is still owed.
  const [adj] = await db
    .select({ total: sql<string>`COALESCE(SUM(${invoices.totalAmount}), 0)::text` })
    .from(invoices)
    .where(and(
      eq(invoices.referenceDocumentId, link.documentId),
      eq(invoices.businessId, link.businessId),
      isNull(invoices.deletedAt),
      inArray(invoices.documentType, ["credit_note", "sales_return", "purchase_return"]),
      sql`${invoices.status} <> 'cancelled'`,
    ));
  return { link, db, ...built, amountAdjusted: parseFloat(adj?.total ?? "0") };
}

app.get("/api/share/:token", async (c) => {
  if (!checkPdfRateLimit(getClientIp(c))) {
    return c.json({ error: "Too many requests. Try again later." }, 429, SHARE_HEADERS);
  }
  const shared = await loadSharedDocument(c);
  if (!shared) return c.json({ error: "This link is not valid any more" }, 404, SHARE_HEADERS);
  const { link, pdfData: d, invoice, biz, amountAdjusted } = shared;
  void recordShareView(link.id);

  const total = parseFloat(invoice.totalAmount);
  const paid = parseFloat(invoice.amountPaid);
  return c.json({
    document: {
      documentType: invoice.documentType,
      type: invoice.type,
      number: invoice.invoiceNumber,
      date: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      status: invoice.status,
      subtotal: invoice.subtotal,
      taxAmount: invoice.taxAmount,
      discountAmount: invoice.discountAmount,
      additionalCharges: invoice.additionalCharges,
      tcsAmount: invoice.tcsAmount,
      roundOff: invoice.roundOff,
      totalAmount: invoice.totalAmount,
      amountPaid: invoice.amountPaid,
      amountAdjusted: amountAdjusted.toFixed(2),
      balance: Math.max(0, total - paid - amountAdjusted).toFixed(2),
      notes: d.notes ?? null,
      terms: d.termsAndConditions ?? null,
    },
    business: {
      name: d.businessName,
      legalName: d.businessLegalName ?? null,
      gstin: d.businessGstin ?? null,
      phone: d.businessPhone ?? null,
      email: d.businessEmail ?? null,
      address: [d.businessAddress, d.businessCity, d.businessState, d.businessPincode].filter(Boolean).join(", ") || null,
      hasLogo: !!biz.logoData,
    },
    party: {
      name: d.partyName,
      gstin: d.partyGstin ?? null,
      address: [d.partyBillingAddress, d.partyCity, d.partyState].filter(Boolean).join(", ") || null,
    },
    lineItems: d.lineItems.map((li, i) => ({
      name: li.itemName,
      description: li.description ?? null,
      hsn: d.lineItemHsn?.[i] || null,
      quantity: li.quantity,
      freeQuantity: li.freeQuantity && parseFloat(li.freeQuantity) > 0 ? li.freeQuantity : null,
      unit: li.unit ?? null,
      unitPrice: li.unitPrice,
      discountPercent: li.discountPercent,
      taxPercent: li.taxPercent,
      totalAmount: li.totalAmount,
    })),
    payment: d.upiId && d.upiQrDataUrl
      ? { upiId: d.upiId, payUrl: d.upiPayUrl ?? null, qrDataUrl: d.upiQrDataUrl }
      : null,
    bank: d.bankAccountNumber
      ? { accountName: d.bankAccountName ?? null, accountNumber: d.bankAccountNumber, ifsc: d.bankIfsc ?? null, bankName: d.bankName ?? null }
      : null,
    // "Pay now" is offered when the business connected its own Razorpay and a balance can be paid online.
    onlinePayment: { available: await shareOnlinePaymentAvailable(shared.db, link) },
    poweredBy: !d.isPaidPlan,
    // Where the "Made with Fintranzact" link goes (sign-up with the referring partner's code, else the site).
    poweredByUrl: d.isPaidPlan ? null : d.brandingUrl ?? null,
  }, 200, SHARE_HEADERS);
});

// "Pay now": the server makes (or reuses) a Razorpay payment link for the
// invoice's current balance on the BUSINESS's own Razorpay account. Public,
// no body is read (the amount comes from the database), tighter rate limit
// than the page itself, same neutral 404 as an unknown link.
const payLinkLimiter = createFixedWindowLimiter({ limit: 10, windowMs: 60_000 });
app.post("/api/share/:token/pay", async (c) => {
  if (!rateLimitDisabled && !payLinkLimiter.hit(getClientIp(c))) {
    return c.json({ error: "Too many requests. Try again later." }, 429, SHARE_HEADERS);
  }
  const token = c.req.param("token") ?? "";
  const link = await resolveShareToken(token);
  if (!link) return c.json({ error: "This link is not valid any more" }, 404, SHARE_HEADERS);
  const result = await createSharePaymentLink(await getTenantDb(link.tenantId), link, token);
  if (!result.ok) return c.json({ error: result.error }, result.status, SHARE_HEADERS);
  return c.json({ url: result.url }, 200, SHARE_HEADERS);
});

app.get("/api/share/:token/pdf", async (c) => {
  if (!checkPdfRateLimit(getClientIp(c))) {
    return c.json({ error: "Too many PDF requests. Try again later." }, 429, SHARE_HEADERS);
  }
  const shared = await loadSharedDocument(c);
  if (!shared) return c.json({ error: "This link is not valid any more" }, 404, SHARE_HEADERS);
  const format = c.req.query("format") === "a5" ? "a5" : "a4";
  shared.pdfData.print = printOptionsFromQuery(c, shared.pdfData.print);
  const pdfBuffer = await generatePDFInWorker(shared.pdfData, format);
  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      ...SHARE_HEADERS,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${shared.invoice.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf"`,
    },
  });
});

// ── Invoice design preview ────────────────────────────────────
// GET /api/invoice-templates/preview?template=modern[&format=thermal&width=58]
// A sample invoice in the chosen design, with the business's own name,
// address, GSTIN, logo, signature and bank details. Same auth and PDF rate
// limit as the invoice PDF.
app.get("/api/invoice-templates/preview", async (c) => {
  if (!checkPdfRateLimit(getClientIp(c))) {
    return c.json({ error: "Too many PDF requests. Try again later." }, 429);
  }
  const auth = await authorizePdfRequest(c);
  if (!auth.ok) return auth.response;
  const { db, businessId, branding } = auth;
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz) return c.json({ error: "Business not found" }, 404);

  const asked = c.req.query("template");
  if (asked && !(INVOICE_TEMPLATES as readonly string[]).includes(asked)) return c.json({ error: "Unknown invoice design" }, 400);
  const template = (asked ?? biz.invoiceTemplate) as InvoiceTemplate;
  const format = c.req.query("format") === "thermal" ? "thermal" : "a4";

  const accounts = await db.select().from(bankAccounts).where(eq(bankAccounts.businessId, businessId)).orderBy(bankAccounts.isDefault);
  const bank = accounts.find((a) => a.accountType === "savings" || a.accountType === "current");
  const upi = accounts.find((a) => a.accountType === "upi");
  const registered = biz.gstRegistrationType === "regular" || biz.gstRegistrationType === "composition";
  const sample = sampleInvoiceData({ withEwayBill: true }, {
    businessName: biz.name,
    businessLegalName: biz.legalName || undefined,
    businessGstin: registered ? biz.gstin || undefined : undefined,
    businessPan: biz.pan || undefined,
    businessPhone: biz.phone || undefined,
    businessEmail: biz.email || undefined,
    businessAddress: biz.address || undefined,
    businessCity: biz.city || undefined,
    businessState: biz.state || undefined,
    businessPincode: biz.pincode || undefined,
    businessStateCode: biz.stateCode || undefined,
    businessCin: biz.cin || undefined,
    businessLlpin: biz.llpin || undefined,
    gstRegistrationType: biz.gstRegistrationType,
    logoBuffer: biz.logoData ?? undefined,
    signatureBuffer: biz.signatureData ?? undefined,
    ...(bank ? { bankName: bank.bankName || undefined, bankAccountNumber: bank.accountNumber || undefined, bankIfsc: bank.ifsc || undefined, bankAccountName: bank.accountName || undefined } : {}),
    upiId: upi?.accountNumber || undefined,
    isPaidPlan: branding.hidden,
    brandingUrl: branding.url,
    print: { template, thermalWidth: c.req.query("width") === "58" ? 58 : c.req.query("width") === "80" ? 80 : biz.thermalWidth === 58 ? 58 : 80 },
  });
  if (sample.upiId) {
    sample.upiQrDataUrl = await QRCode.toDataURL(`upi://pay?pa=${encodeURIComponent(sample.upiId)}&pn=${encodeURIComponent(biz.name)}&am=${sample.totalAmount}&cu=INR`, { width: 200, margin: 1 });
  }
  const pdfBuffer = await generatePDFInWorker(sample, format);
  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="invoice-design-${template}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
});

// ── E-way bill PDF ─────────────────────────────────────────────
// GET /api/eway-bills/:id/pdf — the e-way bill in the EWB-01 layout. Same
// auth, business check and PDF rate limit as the invoice PDF.
app.get("/api/eway-bills/:id/pdf", async (c) => {
  if (!checkPdfRateLimit(getClientIp(c))) {
    return c.json({ error: "Too many PDF requests. Try again later." }, 429);
  }
  const auth = await authorizePdfRequest(c);
  if (!auth.ok) return auth.response;
  const { db, businessId, branding } = auth;
  const id = c.req.param("id");
  if (!z.string().uuid().safeParse(id).success) return c.json({ error: "E-way bill not found" }, 404);
  const [ewb] = await db.select().from(ewayBills)
    .where(and(eq(ewayBills.id, id), eq(ewayBills.businessId, businessId))).limit(1);
  if (!ewb || !ewb.ewbNumber) return c.json({ error: "E-way bill not found" }, 404);
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  const [invoice] = ewb.invoiceId
    ? await db.select().from(invoices).where(and(eq(invoices.id, ewb.invoiceId), eq(invoices.businessId, businessId))).limit(1)
    : [];
  const [party] = invoice ? await db.select().from(parties).where(eq(parties.id, invoice.partyId)).limit(1) : [];
  const lines = invoice
    ? await db.select({ hsn: items.hsn }).from(invoiceItems).leftJoin(items, eq(invoiceItems.itemId, items.id)).where(eq(invoiceItems.invoiceId, invoice.id))
    : [];
  const vehicles = await db.select().from(ewayBillVehicleUpdates)
    .where(eq(ewayBillVehicleUpdates.ewayBillId, ewb.id)).orderBy(desc(ewayBillVehicleUpdates.updatedAt));

  const place = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(", ");
  const bizBlock = { gstin: biz!.gstin ?? "", name: biz!.legalName || biz!.name, address: place(biz!.address, biz!.city, biz!.state, biz!.pincode), state: biz!.state ?? undefined };
  const partyBlock = { gstin: party?.gstin ?? "", name: party?.name ?? "", address: place(party?.billingAddress, party?.city, party?.state, party?.pincode), state: party?.state ?? undefined };
  const sale = !invoice || invoice.type === "sale";
  const supplier = sale ? bizBlock : partyBlock;
  const recipient = sale ? partyBlock : bizBlock;
  const tax = invoice?.taxAmount ?? "0";
  const intra = isIntraStateSupply(
    { stateCode: biz!.stateCode, state: biz!.state, gstin: biz!.gstin },
    { stateCode: party?.stateCode, state: party?.state, gstin: party?.gstin },
  );
  const heads = intra ? splitIntraStateTax(tax) : null;
  const docType = invoice?.documentType === "delivery_challan" ? "Delivery Challan"
    : biz!.gstRegistrationType === "composition" ? "Bill of Supply" : "Tax Invoice";
  const enteredBy = biz!.gstin ?? biz!.name;
  const data: EwayBillPDFData = {
    ewbNumber: ewb.ewbNumber,
    ewbDate: ewb.ewbDate?.toISOString(),
    validUpto: ewb.validUpto?.toISOString(),
    status: ewb.status,
    cancelReason: ewb.cancelReason ?? undefined,
    generatedBy: { gstin: biz!.gstin ?? "", name: biz!.legalName || biz!.name },
    supplier,
    recipient,
    dispatchFrom: place(ewb.fromAddress, ewb.fromPincode) || supplier.address,
    deliverTo: place(ewb.toAddress, ewb.toPincode) || recipient.address,
    documentType: docType,
    documentNumber: invoice?.invoiceNumber ?? "",
    documentDate: invoice?.invoiceDate?.toISOString() ?? "",
    transactionType: "Regular",
    valueOfGoods: invoice?.totalAmount ?? "0",
    taxableValue: invoice ? money.sub(invoice.totalAmount, money.add(invoice.taxAmount, invoice.roundOff ?? "0")) : "0",
    ...(heads ? { cgst: heads.cgst.toFixed(2), sgst: heads.sgst.toFixed(2) } : { igst: tax }),
    hsnCodes: [...new Set(lines.map((l) => l.hsn).filter((h): h is string => !!h))],
    reason: sale ? "Outward - Supply" : "Inward - Supply",
    transporterId: ewb.transporterId ?? undefined,
    transporterName: ewb.transporterName ?? undefined,
    distance: ewb.distance ?? undefined,
    // Vehicle updates, latest first; with none, the vehicle entered at generation.
    partB: vehicles.length
      ? vehicles.map((v) => ({ mode: ewb.transportMode ?? undefined, vehicle: v.vehicleNumber, from: v.fromPlace ?? undefined, enteredDate: v.updatedAt.toISOString(), enteredBy }))
      : [{ mode: ewb.transportMode ?? undefined, vehicle: ewb.vehicleNumber ?? "", from: place(biz!.city, biz!.state) || undefined, enteredDate: ewb.ewbDate?.toISOString(), enteredBy }],
    isPaidPlan: branding.hidden,
    brandingUrl: branding.url,
  };
  const genDate = ewb.ewbDate ? formatIstDate(ewb.ewbDate, "/") : "";
  data.qrDataUrl = await QRCode.toDataURL(`${ewb.ewbNumber}/${biz!.gstin ?? ""}/${genDate}`, { width: 220, margin: 1 });
  const pdfBuffer = await pdfToBuffer(generateEwayBillPDF(data));
  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="eway-bill-${ewb.ewbNumber.replace(/[^0-9A-Za-z]/g, "")}.pdf"`,
    },
  });
});

app.get("/api/share/:token/logo", async (c) => {
  if (!checkPdfRateLimit(getClientIp(c))) {
    return c.json({ error: "Too many requests. Try again later." }, 429, SHARE_HEADERS);
  }
  const link = await resolveShareToken(c.req.param("token") ?? "");
  if (!link) return c.json({ error: "Not found" }, 404, SHARE_HEADERS);
  const db = await getTenantDb(link.tenantId);
  const [biz] = await db
    .select({ data: businesses.logoData, mime: businesses.logoMimeType })
    .from(businesses)
    .where(eq(businesses.id, link.businessId))
    .limit(1);
  if (!biz?.data || !biz.mime) return c.json({ error: "Not found" }, 404, SHARE_HEADERS);
  return new Response(new Uint8Array(biz.data), {
    headers: {
      ...SHARE_HEADERS,
      ...LOGO_SAFE_HEADERS,
      "Content-Type": biz.mime,
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  });
});

// ── Business Logo endpoint (authed) ───────────────────────────
// GET /api/businesses/:id/logo — serves the business logo bytes to the
// authenticated caller. Bytes come straight from the businesses.logo_data
// bytea column. 404s with a 1x1 transparent PNG when no logo is set so
// <img> tags don't show broken-image icons.
//
// Security: re-uses the same session/tenant/cross-tenant guard used by the
// PDF endpoint. `nosniff` + strict CSP prevents any future browser from
// sniffing the bytes as HTML/JS even if an attacker smuggled something past
// the magic-byte check at upload time.
const EMPTY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const LOGO_SAFE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'none'",
  "Cross-Origin-Resource-Policy": "same-site",
};

// GET /api/businesses/:id/signature serves the authorised-signatory image
// through the identical guard chain; `kind` picks the column pair.
async function serveBusinessImage(c: Context, kind: "logo" | "signature") {
  // Typed as optional here because the handler is generic over the route;
  // both registrations below declare :id, so this is belt-and-braces.
  const businessId = c.req.param("id");
  if (!businessId) return c.json({ error: "Not found" }, 404);

  const sessionId = getSessionIdFromRequest(c.req.raw);
  if (!sessionId) return c.json({ error: "Unauthorized" }, 401);

  const [sessionRow] = await controlDb
    .select({ userId: sessions.userId, tenantId: sessions.tenantId })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!sessionRow || !sessionRow.tenantId) return c.json({ error: "Unauthorized" }, 401);

  const [tenant] = await controlDb.select({ status: tenants.status })
    .from(tenants).where(eq(tenants.id, sessionRow.tenantId)).limit(1);
  if (!tenant || tenant.status !== "active") return c.json({ error: "Organization suspended" }, 403);

  const db = await getTenantDb(sessionRow.tenantId);
  const bizAccess = await verifyBusinessAccess(db, businessId, sessionRow.tenantId, sessionRow.userId);
  if (!bizAccess.ok) return c.json({ error: bizAccess.error }, 403);

  const [row] = await db.select({
    logoData: businesses.logoData,
    logoMimeType: businesses.logoMimeType,
    logoUpdatedAt: businesses.logoUpdatedAt,
    signatureData: businesses.signatureData,
    signatureMimeType: businesses.signatureMimeType,
    signatureUpdatedAt: businesses.signatureUpdatedAt,
  }).from(businesses).where(eq(businesses.id, businessId)).limit(1);

  const imageData = kind === "logo" ? row?.logoData : row?.signatureData;
  const imageMime = kind === "logo" ? row?.logoMimeType : row?.signatureMimeType;
  const imageUpdatedAt = kind === "logo" ? row?.logoUpdatedAt : row?.signatureUpdatedAt;

  if (!row || !imageData || !imageMime) {
    return new Response(new Uint8Array(EMPTY_PNG), {
      status: 200,
      headers: {
        ...LOGO_SAFE_HEADERS,
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=60",
      },
    });
  }

  const etag = `"${imageUpdatedAt?.getTime() ?? 0}"`;
  if (c.req.header("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, ...LOGO_SAFE_HEADERS } });
  }

  return new Response(new Uint8Array(imageData), {
    status: 200,
    headers: {
      ...LOGO_SAFE_HEADERS,
      "Content-Type": imageMime,
      "Cache-Control": "private, max-age=300",
      ETag: etag,
    },
  });
}

app.get("/api/businesses/:id/logo", (c) => serveBusinessImage(c, "logo"));
app.get("/api/businesses/:id/signature", (c) => serveBusinessImage(c, "signature"));

// ── Party Ledger PDF endpoint ─────────────────────────────────
// GET /api/parties/:id/ledger.pdf?from=...&to=...
app.get("/api/parties/:id/ledger.pdf", async (c) => {
  if (!checkPdfRateLimit(getClientIp(c))) {
    return c.json({ error: "Too many PDF requests. Try again later." }, 429);
  }

  const partyId = c.req.param("id");

  // Auth check — same pattern as invoice PDF
  const sessionId = getSessionIdFromRequest(c.req.raw);
  if (!sessionId) return c.json({ error: "Unauthorized" }, 401);

  const [sessionRow] = await controlDb
    .select({ userId: sessions.userId, tenantId: sessions.tenantId })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!sessionRow) return c.json({ error: "Unauthorized" }, 401);
  if (!sessionRow.tenantId) return c.json({ error: "No organization selected" }, 400);

  const [tenant] = await controlDb.select({ status: tenants.status })
    .from(tenants).where(eq(tenants.id, sessionRow.tenantId)).limit(1);
  if (!tenant || tenant.status !== "active") return c.json({ error: "Organization suspended" }, 403);

  const businessId = c.req.header("x-business-id");
  if (!businessId) return c.json({ error: "No business selected" }, 400);

  const db = await getTenantDb(sessionRow.tenantId);

  // Verify the business exists and belongs to this tenant (cross-tenant guard)
  const bizAccess = await verifyBusinessAccess(db, businessId, sessionRow.tenantId, sessionRow.userId);
  if (!bizAccess.ok) return c.json({ error: bizAccess.error }, 403);

  // Validate party belongs to this business
  const [party] = await db.select().from(parties)
    .where(and(eq(parties.id, partyId), eq(parties.businessId, businessId)))
    .limit(1);
  if (!party) return c.json({ error: "Party not found" }, 404);

  const [biz] = await db.select().from(businesses)
    .where(eq(businesses.id, businessId)).limit(1);
  if (!biz) return c.json({ error: "Business not found" }, 404);

  // Parse optional date range query params
  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");
  const fromDate = fromParam ? new Date(fromParam) : null;
  const toDate = toParam ? new Date(toParam) : null;

  // Build conditions for invoices and payments
  const invoiceConditions = [
    eq(invoices.partyId, partyId),
    eq(invoices.businessId, businessId),
    eq(invoices.documentType, "invoice"),
  ] as Parameters<typeof and>[0][];
  const paymentConditions = [
    eq(payments.partyId, partyId),
    eq(payments.businessId, businessId),
  ] as Parameters<typeof and>[0][];

  invoiceConditions.push(...buildBusinessDateFilter(invoices, { from: fromDate, to: toDate }));
  paymentConditions.push(...buildBusinessDateFilter(payments, { from: fromDate, to: toDate }));

  const [partyInvoices, partyPayments] = await Promise.all([
    db.select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      date: invoices.invoiceDate,
      type: invoices.type,
      totalAmount: invoices.totalAmount,
      status: invoices.status,
    }).from(invoices).where(and(...invoiceConditions as [any, ...any[]])).orderBy(invoices.invoiceDate),
    db.select({
      id: payments.id,
      paymentNumber: payments.paymentNumber,
      date: payments.paymentDate,
      amount: payments.amount,
      mode: payments.mode,
    }).from(payments).where(and(...paymentConditions as [any, ...any[]])).orderBy(payments.paymentDate),
  ]);

  // Build ledger entries (same logic as ledgerReport tRPC procedure)
  const entries = [
    ...partyInvoices.map(inv => ({
      date: inv.date as Date,
      type: "invoice" as const,
      number: inv.invoiceNumber,
      description: inv.type === "sale" ? "Sale Invoice" : "Purchase Invoice",
      debit: inv.type === "sale" ? inv.totalAmount : "0",
      credit: inv.type === "sale" ? "0" : inv.totalAmount,
    })),
    ...partyPayments.map(pmt => ({
      date: pmt.date as Date,
      type: "payment" as const,
      number: pmt.paymentNumber || "",
      description: `Payment (${pmt.mode})`,
      debit: party.type === "supplier" ? pmt.amount : "0",
      credit: party.type === "supplier" ? "0" : pmt.amount,
    })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let runningBalance = party.openingBalance;
  const entriesWithBalance = entries.map(e => {
    runningBalance = money.add(money.sub(runningBalance, e.credit), e.debit);
    return { ...e, runningBalance };
  });

  const totalDebit = money.sum(entries.map(e => e.debit));
  const totalCredit = money.sum(entries.map(e => e.credit));
  const closingBalance = money.add(money.sub(party.openingBalance, totalCredit), totalDebit);

  // Generate UPI QR for ledger if closing balance is receivable
  let ledgerUpiQrDataUrl: string | undefined;
  let ledgerUpiPayUrl: string | undefined;
  if (parseFloat(closingBalance) > 0 && party.type === "customer") {
    const ledgerBankAccounts = await db.select().from(bankAccounts)
      .where(eq(bankAccounts.businessId, businessId));
    const ledgerUpiAccount = ledgerBankAccounts.find(a => a.accountType === "upi");
    const ledgerUpiId = ledgerUpiAccount?.accountNumber;
    if (ledgerUpiId) {
      const ledgerUpiDeepLink = `upi://pay?pa=${encodeURIComponent(ledgerUpiId)}&pn=${encodeURIComponent(biz.name)}&am=${parseFloat(closingBalance).toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Outstanding - ${party.name}`)}`;
      ledgerUpiQrDataUrl = await QRCode.toDataURL(ledgerUpiDeepLink, { width: 200, margin: 1 });
      const apiBase = new URL(c.req.url).origin;
      ledgerUpiPayUrl = `${apiBase}/pay/upi?pa=${encodeURIComponent(ledgerUpiId)}&pn=${encodeURIComponent(biz.name)}&am=${parseFloat(closingBalance).toFixed(2)}&tn=${encodeURIComponent(`Outstanding - ${party.name}`)}`;
    }
  }

  const pdfBuffer = await generateLedgerPDF({
    businessName: biz.name,
    partyName: party.name,
    partyType: party.type,
    openingBalance: party.openingBalance,
    fromDate: fromParam || null,
    toDate: toParam || null,
    entries: entriesWithBalance,
    summary: { totalDebit, totalCredit, closingBalance },
    upiQrDataUrl: ledgerUpiQrDataUrl,
    upiPayUrl: ledgerUpiPayUrl,
  });

  const safePartyName = party.name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="ledger-${safePartyName}.pdf"`,
    },
  });
});

// ── Public Store API ─────────────────────────────────────────
// Slug resolution cache: slug → { tenantId, businessId, expires }
const slugCache = new Map<string, { tenantId: string; businessId: string; expires: number }>();

// Rate limit for order placement: phone → { count, reset }
const orderRateMap = new Map<string, { count: number; reset: number }>();

// Per-IP rate limit for public store POSTs (order + identify).
// Key: `${ip}:${path}`. Limit: 20 requests per minute per IP per path.
// This is in addition to the per-phone 5/min limit on `order` — an
// attacker who cycles fake phone numbers hits the IP ceiling first.
const storeIpRateMap = new Map<string, { count: number; reset: number }>();
const STORE_IP_LIMIT_PER_MIN = 20;

function checkStoreIpRateLimit(ip: string, path: string): boolean {
  const now = Date.now();
  const key = `${ip}:${path}`;
  const entry = storeIpRateMap.get(key);
  if (!entry || now > entry.reset) {
    storeIpRateMap.set(key, { count: 1, reset: now + 60_000 });
    return true;
  }
  if (entry.count >= STORE_IP_LIMIT_PER_MIN) return false;
  entry.count++;
  return true;
}

// Clean stale order rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of orderRateMap) {
    if (now > entry.reset) orderRateMap.delete(key);
  }
  for (const [key, entry] of storeIpRateMap) {
    if (now > entry.reset) storeIpRateMap.delete(key);
  }
}, 5 * 60_000).unref();

/**
 * Resolve a public store slug to its tenant and business, or null when the
 * store cannot serve buyers: unknown slug, store switched off, or (hosted
 * only) the organisation's plan lacks the online store, or it is read-only or
 * suspended. Every public /store/* endpoint treats null as the same neutral
 * 404 "Store not found", so buyers never learn why and never see billing
 * wording. A self-hosted install has no plan check (single tenant).
 */
async function resolveStoreSlug(slug: string): Promise<{ tenantId: string; businessId: string } | null> {
  const resolved = await lookupStoreSlug(slug);
  if (!resolved) return null;
  if (process.env.MULTI_TENANT !== "true") return resolved;
  return (await storeServesTenant(resolved.tenantId)) ? resolved : null;
}

async function lookupStoreSlug(slug: string): Promise<{ tenantId: string; businessId: string } | null> {
  // Validate slug format
  if (!slug || !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) return null;

  const now = Date.now();
  const cached = slugCache.get(slug);
  if (cached && now < cached.expires) {
    return { tenantId: cached.tenantId, businessId: cached.businessId };
  }

  const isMultiTenant = process.env.MULTI_TENANT === "true";

  if (!isMultiTenant) {
    // Self-hosted: single tenant DB — query directly
    const db = await getTenantDb("single");
    const [biz] = await db.select({ id: businesses.id })
      .from(businesses)
      .where(and(eq(businesses.storeSlug, slug), eq(businesses.storeEnabled, true)))
      .limit(1);

    if (!biz) return null;

    const resolved = { tenantId: "single", businessId: biz.id };
    slugCache.set(slug, { ...resolved, expires: now + 5 * 60_000 });
    return resolved;
  }

  // Multi-tenant: scan all active tenants to find the business with this slug
  const activeTenants = await controlDb
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.status, "active"));

  for (const tenant of activeTenants) {
    try {
      const db = await getTenantDb(tenant.id);
      const [biz] = await db.select({ id: businesses.id })
        .from(businesses)
        .where(and(eq(businesses.storeSlug, slug), eq(businesses.storeEnabled, true)))
        .limit(1);

      if (biz) {
        const resolved = { tenantId: tenant.id, businessId: biz.id };
        slugCache.set(slug, { ...resolved, expires: now + 5 * 60_000 });
        return resolved;
      }
    } catch {
      // Skip tenants with DB connectivity issues
    }
  }

  return null;
}

// Helper: get tenant DB for a resolved slug context
async function getStoreDb(tenantId: string) {
  // In self-hosted, tenantId is always "single"
  const isMultiTenant = process.env.MULTI_TENANT === "true";
  return getTenantDb(isMultiTenant ? tenantId : "single");
}

// GET /store/:slug/logo — public logo bytes for the storefront header.
// Fully public (like the rest of /store/*). Storefront-side rendering uses
// <img src="...">, so scripts inside any hypothetical malformed file can't
// execute (image context + nosniff). Still, we only ever serve bytes that
// were magic-byte validated at upload time — PNG or JPEG, never SVG.
app.get("/store/:slug/logo", async (c) => {
  const slug = c.req.param("slug");
  if (!checkStoreIpRateLimit(getClientIp(c), "/store/logo")) {
    return c.json({ error: "Too many requests" }, 429);
  }
  const resolved = await resolveStoreSlug(slug);
  if (!resolved) return c.json({ error: "Store not found" }, 404);

  const db = await getStoreDb(resolved.tenantId);
  const [row] = await db.select({
    logoData: businesses.logoData,
    logoMimeType: businesses.logoMimeType,
    logoUpdatedAt: businesses.logoUpdatedAt,
  }).from(businesses)
    .where(and(eq(businesses.id, resolved.businessId), eq(businesses.storeEnabled, true)))
    .limit(1);

  if (!row || !row.logoData || !row.logoMimeType) {
    return new Response(new Uint8Array(EMPTY_PNG), {
      status: 200,
      headers: {
        ...LOGO_SAFE_HEADERS,
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=60",
      },
    });
  }

  const etag = `"${row.logoUpdatedAt?.getTime() ?? 0}"`;
  if (c.req.header("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, ...LOGO_SAFE_HEADERS } });
  }

  return new Response(new Uint8Array(row.logoData), {
    status: 200,
    headers: {
      ...LOGO_SAFE_HEADERS,
      "Content-Type": row.logoMimeType,
      "Cache-Control": "public, max-age=3600",
      ETag: etag,
    },
  });
});

// GET /store/:slug/catalog.json — public item catalog
app.get("/store/:slug/catalog.json", async (c) => {
  const slug = c.req.param("slug");
  const resolved = await resolveStoreSlug(slug);
  if (!resolved) return c.json({ error: "Store not found" }, 404);

  const db = await getStoreDb(resolved.tenantId);

  const [biz] = await db.select({
    id: businesses.id,
    name: businesses.name,
    storeTagline: businesses.storeTagline,
    storeAccentColor: businesses.storeAccentColor,
    storeMinOrderAmount: businesses.storeMinOrderAmount,
    storeDeliveryNote: businesses.storeDeliveryNote,
    storeDeliveryFee: businesses.storeDeliveryFee,
    storeFreeDeliveryAbove: businesses.storeFreeDeliveryAbove,
    storeWhatsappNumber: businesses.storeWhatsappNumber,
    storeAllowNegativeStock: businesses.storeAllowNegativeStock,
    currency: businesses.currency,
    phone: businesses.phone,
    email: businesses.email,
    city: businesses.city,
    state: businesses.state,
    address: businesses.address,
    logoMimeType: businesses.logoMimeType,
    logoUpdatedAt: businesses.logoUpdatedAt,
  }).from(businesses)
    .where(and(eq(businesses.id, resolved.businessId), eq(businesses.storeEnabled, true)))
    .limit(1);

  if (!biz) return c.json({ error: "Store not found" }, 404);

  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "24", 10)));
  const category = c.req.query("category");
  const search = c.req.query("search");
  const offset = (page - 1) * limit;

  const conditions = [
    eq(items.businessId, resolved.businessId),
    eq(items.storeEnabled, true),
    // Active catalog read — soft-deleted items must never appear in the
    // public store, even if `store_enabled` was not cleared before deletion.
    isNull(items.deletedAt),
  ];
  if (category) conditions.push(eq(sql`COALESCE(${items.storeCategory}, ${items.category})`, category));
  if (search) conditions.push(sql`${items.name} ILIKE ${"%" + escapeLike(search) + "%"}`);

  // NEVER expose: purchasePrice, exact stockQuantity, hsn, sku, or internal business fields
  const [catalog, [{ total }]] = await Promise.all([
    db.select({
      id: items.id,
      name: items.name,
      description: sql<string | null>`COALESCE(${items.storeDescription}, ${items.description})`,
      price: sql<string | null>`COALESCE(${items.storePrice}, ${items.salePrice})`,
      unit: items.unit,
      category: sql<string | null>`COALESCE(${items.storeCategory}, ${items.category})`,
      taxPercent: items.taxPercent,
      taxInclusive: items.taxInclusive,
      inStock: sql<boolean>`(${items.stockQuantity})::numeric > 0`,
      stockQty: items.stockQuantity,
      sortOrder: items.storeSortOrder,
      itemMode: items.itemMode,
      unitVariants: items.unitVariants,
      variantAttributes: items.variantAttributes,
    }).from(items)
      .where(and(...conditions))
      .orderBy(items.storeSortOrder, items.name)
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(items)
      .where(and(...conditions)),
  ]);

  // Fetch store-enabled variants for any variant-mode items in this page
  const variantItemIds = catalog
    .filter((i) => i.itemMode === "variants")
    .map((i) => i.id);

  const variantRows = variantItemIds.length > 0
    ? await db.select({
        id: itemVariants.id,
        itemId: itemVariants.itemId,
        attributeValues: itemVariants.attributeValues,
        salePrice: itemVariants.salePrice,
        storePrice: itemVariants.storePrice,
        stockQuantity: itemVariants.stockQuantity,
        storeEnabled: itemVariants.storeEnabled,
      }).from(itemVariants)
        .where(and(
          inArray(itemVariants.itemId, variantItemIds),
          eq(itemVariants.storeEnabled, true),
          // Active variant read — soft-deleted variants must not appear in
          // the store catalog. Parent already filtered on isNull(items.deletedAt).
          isNull(itemVariants.deletedAt),
        ))
    : [];

  // Group variants by parent item
  const variantsByItem = new Map<string, typeof variantRows>();
  for (const v of variantRows) {
    const arr = variantsByItem.get(v.itemId) || [];
    arr.push(v);
    variantsByItem.set(v.itemId, arr);
  }

  const categories = [...new Set(
    catalog.map((i) => i.category).filter(Boolean) as string[]
  )];

  // When allowNegativeStock is on, out-of-stock items show as "low stock" instead of hidden
  const allowNeg = biz.storeAllowNegativeStock;
  const transformedItems = catalog
    .filter((item) => {
      // Variant items must have at least one store-enabled variant to appear
      if (item.itemMode === "variants") {
        const variants = variantsByItem.get(item.id);
        return variants && variants.length > 0;
      }
      return true;
    })
    .map(({ stockQty: _stockQty, unitVariants: rawUnitVariants, variantAttributes: rawVarAttrs, ...rest }) => {
      const base = {
        ...rest,
        inStock: rest.inStock || allowNeg,
        lowStock: allowNeg && !rest.inStock,
      };

      if (rest.itemMode === "alt_units" && rawUnitVariants) {
        // Expose unit variants with store-safe prices only
        return {
          ...base,
          unitVariants: rawUnitVariants.map((uv) => ({
            unit: uv.unit,
            conversionFactor: uv.conversionFactor,
            price: uv.salePrice,
          })),
        };
      }

      if (rest.itemMode === "variants") {
        const variants = variantsByItem.get(rest.id) || [];
        const variantData = variants.map((v) => ({
          id: v.id,
          attributes: v.attributeValues,
          price: v.storePrice ?? v.salePrice ?? "0",
          inStock: parseFloat(v.stockQuantity) > 0 || allowNeg,
        }));
        // Price = lowest variant price (for display/sorting)
        const prices = variantData.map((v) => parseFloat(v.price));
        const lowestPrice = prices.length > 0 ? Math.min(...prices).toFixed(2) : base.price;
        // inStock = true if ANY variant is in stock
        const anyInStock = variantData.some((v) => v.inStock);

        return {
          ...base,
          price: lowestPrice,
          inStock: anyInStock,
          lowStock: allowNeg && !anyInStock,
          variantAttributes: rawVarAttrs || [],
          variants: variantData,
        };
      }

      return base;
    });

  // Which ways to pay checkout offers: Cash on Delivery only when switched on, online only when
  // switched on AND the business's own Razorpay connection is ready. No keys or ids, just two booleans.
  const paymentOptions = await loadStorePaymentOptions(db, resolved.businessId);

  return c.json(
    {
      business: {
        payments: paymentOptions,
        name: biz.name,
        tagline: biz.storeTagline,
        accentColor: biz.storeAccentColor,
        minOrderAmount: biz.storeMinOrderAmount,
        deliveryNote: biz.storeDeliveryNote,
        // The flat delivery fee (rupees, before GST) and the subtotal at or above which it is free.
        // The server prices the order from its own settings; these are for display only.
        deliveryFee: biz.storeDeliveryFee,
        freeDeliveryAbove: biz.storeFreeDeliveryAbove,
        whatsappNumber: biz.storeWhatsappNumber,
        currency: biz.currency,
        phone: biz.phone,
        email: biz.email,
        city: biz.city,
        state: biz.state,
        address: biz.address,
        // Versioned URL so clients auto-refresh when the logo changes. Null
        // when no logo is set — the storefront UI should treat null as "no
        // logo, fall back to the business name in text".
        logoUrl: biz.logoMimeType && biz.logoUpdatedAt
          ? `/store/${slug}/logo?v=${biz.logoUpdatedAt.getTime()}`
          : null,
      },
      items: transformedItems,
      categories,
      total,
      page,
      limit,
    },
    200,
    { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  );
});

// ── Store policy pages (public, no auth) ─────────────────────────
// Terms, Refund, Shipping, Contact and Privacy pages the store owner edits in
// Settings. Same rules as the rest of /store/*: unknown slug, store off or a
// plan without the store all answer the same neutral 404, and reads are
// rate limited per IP. Only the published policy text and the business details
// the templates fill in are returned.

const POLICY_COLUMNS = {
  name: businesses.name,
  gstRegistrationType: businesses.gstRegistrationType,
  gstin: businesses.gstin,
  phone: businesses.phone,
  email: businesses.email,
  address: businesses.address,
  addressLine1: businesses.addressLine1,
  addressLine2: businesses.addressLine2,
  city: businesses.city,
  state: businesses.state,
  pincode: businesses.pincode,
  storeReturnWindowDays: businesses.storeReturnWindowDays,
  storeDeliveryFee: businesses.storeDeliveryFee,
  storeFreeDeliveryAbove: businesses.storeFreeDeliveryAbove,
  storePolicies: businesses.storePolicies,
};

async function loadPolicyBusiness(c: Context, slug: string) {
  if (!checkStoreIpRateLimit(getClientIp(c), "/store/policies")) {
    return { error: c.json({ error: "Too many requests" }, 429) };
  }
  const resolved = await resolveStoreSlug(slug);
  if (!resolved) return { error: c.json({ error: "Store not found" }, 404) };
  const db = await getStoreDb(resolved.tenantId);
  const [biz] = await db.select(POLICY_COLUMNS).from(businesses)
    .where(and(eq(businesses.id, resolved.businessId), eq(businesses.storeEnabled, true)))
    .limit(1);
  if (!biz) return { error: c.json({ error: "Store not found" }, 404) };
  return { biz };
}

// GET /store/:slug/policies.json — all five pages as safe block trees (used by the storefront app)
app.get("/store/:slug/policies.json", async (c) => {
  const slug = c.req.param("slug");
  const loaded = await loadPolicyBusiness(c, slug);
  if ("error" in loaded) return loaded.error;
  return c.json(
    { business: { name: loaded.biz.name }, policies: buildPublicPolicyPages(slug, loaded.biz) },
    200,
    { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  );
});

// GET /store/:slug/policies/:kind — the same page as server-rendered HTML,
// readable without JavaScript (payment-gateway reviewers and crawlers).
app.get("/store/:slug/policies/:kind", async (c) => {
  const slug = c.req.param("slug");
  const kind = c.req.param("kind");
  if (!isStorePolicyKind(kind)) return c.json({ error: "Page not found" }, 404);
  const loaded = await loadPolicyBusiness(c, slug);
  if ("error" in loaded) return loaded.error;
  const html = renderPolicyPageHtml({
    slug,
    businessName: loaded.biz.name,
    pages: buildPublicPolicyPages(slug, loaded.biz),
    kind,
    basePath: `/store/${slug}/policies`,
  });
  return c.html(html, 200, {
    "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer-when-downgrade",
  });
});

// Online payment of an order: GET /store/:slug/order/:orderId (status) and POST .../pay (Pay again).
registerStorePaymentRoutes(app, {
  clientIp: getClientIp,
  checkIpRateLimit: checkStoreIpRateLimit,
  assertOrigin: assertAllowedStoreOrigin,
  resolveStoreSlug,
  getStoreDb,
  rateLimitDisabled,
});

// POST /store/:slug/identify — phone-first customer identification (public, no auth)
app.post("/store/:slug/identify", async (c) => {
  const slug = c.req.param("slug");

  // Per-IP rate limit (20/min per path) — runs BEFORE body parse / DB
  // lookup so abusive traffic can't exhaust those resources.
  const ip = getClientIp(c);
  if (!checkStoreIpRateLimit(ip, "/store/identify")) {
    return c.json({ error: "Too many requests. Please wait a moment." }, 429);
  }

  // Origin/Referer allow-list — backstop for the `/store/*` CSRF
  // exemption. See `lib/store-origin.ts` for the residual-risk notes.
  const originCheck = assertAllowedStoreOrigin(c, ip);
  if (!originCheck.ok) {
    return c.json({ error: "Origin not allowed" }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body || typeof body !== "object") {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const { phone, turnstileToken } = body as Record<string, unknown>;

  if (typeof phone !== "string" || typeof turnstileToken !== "string") {
    return c.json({ error: "phone and turnstileToken are required" }, 400);
  }

  // Validate Turnstile — reuse the IP captured at rate-limit time above.
  const valid = await verifyTurnstile(turnstileToken, ip || null);
  if (!valid) return c.json({ error: "Verification failed" }, 403);

  // Resolve slug → business
  const resolved = await resolveStoreSlug(slug);
  if (!resolved) return c.json({ error: "Store not found" }, 404);

  const db = await getStoreDb(resolved.tenantId);

  // Normalize to last 10 digits (strip +91, spaces, dashes)
  const normalizedPhone = phone.replace(/\D/g, "").slice(-10);

  const [party] = await db.select({ name: parties.name })
    .from(parties)
    .where(and(
      eq(parties.businessId, resolved.businessId),
      sql`REPLACE(REPLACE(${parties.phone}, '+91', ''), ' ', '') LIKE '%' || ${normalizedPhone}`,
    ))
    .limit(1);

  if (party) {
    // Return first name only — don't expose full name to public endpoint
    const firstName = party.name.split(" ")[0];
    return c.json({ known: true, name: firstName });
  }

  return c.json({ known: false });
});

// POST /store/:slug/order — place an order (public, no auth)
app.post("/store/:slug/order", async (c) => {
  const slug = c.req.param("slug");

  // Per-IP rate limit (20/min per path) — runs BEFORE body parse /
  // Turnstile / DB lookup so abusive traffic can't exhaust those
  // resources. This is orthogonal to the per-phone 5/min cap below.
  const clientIp = getClientIp(c);
  if (!checkStoreIpRateLimit(clientIp, "/store/order")) {
    return c.json({ error: "Too many requests. Please wait a moment." }, 429);
  }

  // Origin/Referer allow-list — backstop for the `/store/*` CSRF
  // exemption. See `lib/store-origin.ts` for the residual-risk notes.
  const originCheck = assertAllowedStoreOrigin(c, clientIp);
  if (!originCheck.ok) {
    return c.json({ error: "Origin not allowed" }, 403);
  }

  // Parse and validate body
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body || typeof body !== "object") {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const {
    turnstileToken: orderTurnstileToken,
    customerName,
    customerPhone,
    customerEmail,
    deliveryAddress,
    deliveryCity,
    deliveryPincode,
    deliveryNotes,
    notes: legacyNotes,
    items: orderItems,
    paymentMethod: requestedPaymentMethod,
  } = body as Record<string, unknown>;
  // The storefront sends the customer's order notes as `deliveryNotes`
  // (apps/store api.ts); only `notes` was read, so they were dropped.
  const notes = deliveryNotes ?? legacyNotes;

  // Validate Turnstile for order submission
  const orderIp = getClientIp(c) || null;
  const turnstileValid = await verifyTurnstile(
    typeof orderTurnstileToken === "string" ? orderTurnstileToken : "",
    orderIp,
  );
  if (!turnstileValid) return c.json({ error: "Verification failed. Please try again." }, 403);

  // Basic validation
  if (typeof customerName !== "string" || customerName.trim().length < 2) {
    return c.json({ error: "customerName is required (min 2 chars)" }, 400);
  }
  if (typeof customerPhone !== "string" || !/^[6-9]\d{9}$/.test(customerPhone)) {
    return c.json({ error: "customerPhone must be a valid 10-digit Indian mobile number" }, 400);
  }
  if (!Array.isArray(orderItems) || orderItems.length === 0) {
    return c.json({ error: "items array is required and must not be empty" }, 400);
  }
  if (requestedPaymentMethod !== undefined && requestedPaymentMethod !== "online" && requestedPaymentMethod !== "cod") {
    return c.json({ error: "paymentMethod must be \"online\" or \"cod\"" }, 400);
  }
  for (const it of orderItems) {
    if (typeof it !== "object" || it === null) return c.json({ error: "Invalid item in items array" }, 400);
    const item = it as Record<string, unknown>;
    if (typeof item.itemId !== "string") return c.json({ error: "Each item must have an itemId" }, 400);
    const qty = Number(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0) return c.json({ error: "Each item must have a positive quantity" }, 400);
    // Optional variant/unit fields
    if (item.variantId !== undefined && typeof item.variantId !== "string") return c.json({ error: "variantId must be a string" }, 400);
    if (item.selectedUnit !== undefined && typeof item.selectedUnit !== "string") return c.json({ error: "selectedUnit must be a string" }, 400);
    if (item.conversionFactor !== undefined && (!Number.isFinite(Number(item.conversionFactor)) || Number(item.conversionFactor) <= 0)) {
      return c.json({ error: "conversionFactor must be a positive number" }, 400);
    }
  }

  // Rate limit: 5 orders per phone per minute
  const now = Date.now();
  const rateKey = `order:${customerPhone}`;
  const rateEntry = orderRateMap.get(rateKey);
  if (!rateEntry || now > rateEntry.reset) {
    orderRateMap.set(rateKey, { count: 1, reset: now + 60_000 });
  } else if (rateEntry.count >= 5) {
    return c.json({ error: "Too many orders. Please wait a moment before trying again." }, 429);
  } else {
    rateEntry.count++;
  }

  // Resolve business
  const resolved = await resolveStoreSlug(slug);
  if (!resolved) return c.json({ error: "Store not found" }, 404);

  const db = await getStoreDb(resolved.tenantId);

  const [biz] = await db.select({
    id: businesses.id,
    name: businesses.name,
    storeEnabled: businesses.storeEnabled,
    storeMinOrderAmount: businesses.storeMinOrderAmount,
    storeDeliveryFee: businesses.storeDeliveryFee,
    storeFreeDeliveryAbove: businesses.storeFreeDeliveryAbove,
    invoicePrefix: businesses.invoicePrefix,
    nextInvoiceNumber: businesses.nextInvoiceNumber,
    storeOrderPrefix: businesses.storeOrderPrefix,
    nextStoreOrderNumber: businesses.nextStoreOrderNumber,
    currency: businesses.currency,
  }).from(businesses)
    .where(and(eq(businesses.id, resolved.businessId), eq(businesses.storeEnabled, true)))
    .limit(1);

  if (!biz) return c.json({ error: "Store not found" }, 404);

  // How the shopper pays. Checked against what the store offers right now, never against the
  // client: Cash on Delivery only when switched on, online only with a ready Razorpay connection.
  const paymentOptions = await loadStorePaymentOptions(db, resolved.businessId);
  const paymentMethod: "online" | "cod" = requestedPaymentMethod === "online" ? "online"
    : requestedPaymentMethod === "cod" ? "cod"
    : paymentOptions.cod ? "cod" : "online";
  if (paymentMethod === "online" && !paymentOptions.online) {
    return c.json({ error: "Online payment is not available at this store. Please choose another way to pay." }, 400);
  }
  if (paymentMethod === "cod" && !paymentOptions.cod) {
    return c.json({ error: "Cash on Delivery is not available at this store. Please pay online." }, 400);
  }

  // Validate items exist and are store-enabled
  type OrderItemInput = { itemId: string; quantity: number; variantId?: string; selectedUnit?: string; conversionFactor?: number };
  const itemIds = (orderItems as OrderItemInput[]).map((i) => i.itemId);
  const foundItems = await db.select({
    id: items.id,
    name: items.name,
    storeEnabled: items.storeEnabled,
    storePrice: items.storePrice,
    salePrice: items.salePrice,
    taxPercent: items.taxPercent,
    taxInclusive: items.taxInclusive,
    stockQuantity: items.stockQuantity,
    unit: items.unit,
    itemMode: items.itemMode,
    unitVariants: items.unitVariants,
  }).from(items)
    .where(and(
      inArray(items.id, itemIds),
      eq(items.businessId, resolved.businessId),
      eq(items.storeEnabled, true),
      // Active read — soft-deleted items are treated as unavailable.
      // If a customer somehow sends a stale item ID, this causes the
      // count mismatch below and returns a 400.
      isNull(items.deletedAt),
    ));

  if (foundItems.length !== new Set(itemIds).size) {
    return c.json({ error: "One or more items are not available in this store" }, 400);
  }

  const itemMap = new Map(foundItems.map((i) => [i.id, i]));

  // Pre-fetch all referenced variants for variant-mode items
  const requestedVariantIds = (orderItems as OrderItemInput[])
    .filter((oi) => oi.variantId)
    .map((oi) => oi.variantId!);

  const foundVariants = requestedVariantIds.length > 0
    ? await db.select({
        id: itemVariants.id,
        itemId: itemVariants.itemId,
        salePrice: itemVariants.salePrice,
        storePrice: itemVariants.storePrice,
        stockQuantity: itemVariants.stockQuantity,
        storeEnabled: itemVariants.storeEnabled,
        attributeValues: itemVariants.attributeValues,
      }).from(itemVariants)
        .where(and(
          inArray(itemVariants.id, requestedVariantIds),
          eq(itemVariants.storeEnabled, true),
          // Active variant read — soft-deleted variants are treated as
          // unavailable for new store orders.
          isNull(itemVariants.deletedAt),
        ))
    : [];

  const variantMap = new Map(foundVariants.map((v) => [v.id, v]));

  // Build line items for calculation — validate variants and alt units
  const lineItemInputs: Array<{
    itemId: string; quantity: string; unitPrice: string; taxPercent: string;
    discountPercent: string; taxInclusive: boolean; name: string; unit: string;
    selectedUnit?: string; conversionFactor?: string; variantId?: string;
  }> = [];

  for (const oi of orderItems as OrderItemInput[]) {
    const item = itemMap.get(oi.itemId)!;
    let price = item.storePrice ?? item.salePrice ?? "0";
    let description = item.name;
    let selectedUnit: string | undefined;
    let conversionFactor: string | undefined;
    let variantId: string | undefined;

    if (item.itemMode === "variants" && oi.variantId) {
      // Validate variant exists and belongs to this item
      const variant = variantMap.get(oi.variantId);
      if (!variant || variant.itemId !== oi.itemId) {
        return c.json({ error: `Variant is not available for item "${item.name}"` }, 400);
      }
      price = variant.storePrice ?? variant.salePrice ?? price;
      variantId = oi.variantId;
      // Build variant label: "Item Name - Size: M, Color: Red"
      const attrLabel = Object.entries(variant.attributeValues).map(([k, v]) => `${k}: ${v}`).join(", ");
      description = `${item.name} - ${attrLabel}`;
    } else if (item.itemMode === "alt_units" && oi.selectedUnit) {
      // Validate unit exists in item's unitVariants
      const uv = item.unitVariants?.find((u) => u.unit === oi.selectedUnit);
      if (!uv) {
        return c.json({ error: `Unit "${oi.selectedUnit}" is not available for item "${item.name}"` }, 400);
      }
      price = uv.salePrice;
      selectedUnit = oi.selectedUnit;
      conversionFactor = String(uv.conversionFactor);
    }

    lineItemInputs.push({
      itemId: oi.itemId,
      quantity: String(oi.quantity),
      unitPrice: price,
      taxPercent: item.taxPercent || "0",
      discountPercent: "0",
      taxInclusive: item.taxInclusive,
      name: description,
      unit: item.unit,
      selectedUnit,
      conversionFactor,
      variantId,
    });
  }

  // Calculate totals using shared library. The order goes to the Walk-in
  // Customer — no state, so the place of supply is the store's own: intra-state,
  // CGST and SGST each rounded at half the rate (re-checked against the
  // walk-in party below).
  const totalsFor = (intraState: boolean, charges?: Array<{ amount: string }>) => calcInvoiceTotals({
    lineItems: lineItemInputs.map((li) => ({
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      taxPercent: li.taxPercent,
      discountPercent: li.discountPercent,
      taxInclusive: li.taxInclusive,
    })),
    charges,
    intraState,
  });
  const goodsTotals = totalsFor(true);

  // Delivery charge: worked out here from the store's settings and the order's subtotal, never taken
  // from the request. It goes on the invoice as an additional charge, which takes GST the way every
  // invoice charge does (at the principal supply's rate: see chargeTaxRateFor), so the invoice stays
  // valid and the order total, payment link, refunds and emails all follow it.
  const delivery = calcStoreDelivery({
    fee: biz.storeDeliveryFee,
    freeAbove: biz.storeFreeDeliveryAbove,
    subtotal: goodsTotals.subtotal,
  });
  const deliveryCharges = delivery.charge === "0.00" ? undefined : [{ amount: delivery.charge }];
  let totals = totalsFor(true, deliveryCharges);

  // Check minimum order amount (on the goods: delivery does not count towards it)
  if (biz.storeMinOrderAmount) {
    const minAmount = parseFloat(biz.storeMinOrderAmount);
    const orderTotal = parseFloat(goodsTotals.total);
    if (orderTotal < minAmount) {
      return c.json({
        error: `Minimum order amount is ${biz.currency} ${biz.storeMinOrderAmount}`,
      }, 400);
    }
  }

  // The smallest amount Razorpay takes is Rs 1.
  if (paymentMethod === "online" && parseFloat(totals.total) < 1) {
    return c.json({ error: "Online payment needs an order of at least Rs 1. Please choose Cash on Delivery or add more items." }, 400);
  }

  // Atomic transaction: increment counters, create invoice + line items + store order
  try {
    const result = await db.transaction(async (tx) => {
      // Lock and increment business counters atomically
      const [bizLocked] = await tx.select({
        invoicePrefix: businesses.invoicePrefix,
        nextInvoiceNumber: businesses.nextInvoiceNumber,
        storeOrderPrefix: businesses.storeOrderPrefix,
        nextStoreOrderNumber: businesses.nextStoreOrderNumber,
      }).from(businesses)
        .where(eq(businesses.id, resolved.businessId))
        .for("update");

      const invoiceNumber = `${bizLocked.invoicePrefix}-${String(bizLocked.nextInvoiceNumber).padStart(5, "0")}`;
      const orderNumber = `${bizLocked.storeOrderPrefix}-${String(bizLocked.nextStoreOrderNumber).padStart(5, "0")}`;

      await tx.update(businesses)
        .set({
          nextInvoiceNumber: bizLocked.nextInvoiceNumber + 1,
          nextStoreOrderNumber: bizLocked.nextStoreOrderNumber + 1,
        })
        .where(eq(businesses.id, resolved.businessId));

      // Find or create a "Walk-in Customer" party for online store orders
      // Advisory lock prevents race condition with concurrent store order requests
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${resolved.businessId} || ':walkin'))`);
      let walkinPartyId: string;
      const [existingWalkin] = await tx.select({ id: parties.id })
        .from(parties)
        .where(and(
          eq(parties.businessId, resolved.businessId),
          eq(parties.name, "Walk-in Customer"),
          eq(parties.type, "customer"),
        ))
        .limit(1);

      if (existingWalkin) {
        walkinPartyId = existingWalkin.id;
      } else {
        const [newWalkin] = await tx.insert(parties).values({
          businessId: resolved.businessId,
          type: "customer",
          name: "Walk-in Customer",
          source: "online_store",
        }).returning({ id: parties.id });
        walkinPartyId = newWalkin.id;
      }

      const intraState = await documentIsIntraState(tx, resolved.businessId, walkinPartyId);
      if (!intraState) totals = totalsFor(false, deliveryCharges);

      // Create unfulfilled invoice (online store order awaiting fulfillment)
      const [invoice] = await tx.insert(invoices).values({
        businessId: resolved.businessId,
        partyId: walkinPartyId,
        type: "sale",
        status: "unfulfilled",
        documentType: "invoice",
        invoiceNumber,
        invoiceDate: new Date(),
        subtotal: totals.subtotal,
        taxAmount: totals.taxTotal,
        discountAmount: "0",
        additionalCharges: totals.chargesTotal,
        // The itemised charge, labelled the way the invoice screens show charges.
        charges: deliveryCharges ? [{ label: "Delivery charge", amount: delivery.charge }] : null,
        roundOff: "0",
        totalAmount: totals.total,
        amountPaid: "0",
        notes: typeof notes === "string" ? notes : null,
        source: "online_store",
        stockMode: "tracked",
      }).returning();

      // Lines of batch-tracked items take stock first-expiry-first-out; a
      // line that spans batches becomes one line per batch.
      const stockDoc = { documentType: "invoice", type: "sale" };
      const batchedLines = await resolveLineBatches(tx, {
        businessId: resolved.businessId,
        lines: lineItemInputs.map((li) => ({ ...li, itemName: li.name })),
        direction: -1,
        warehouseId: await resolveDocumentWarehouseId(tx, { businessId: resolved.businessId, doc: stockDoc }),
        documentDate: new Date(),
        strict: false,
      });

      // Create invoice line items
      const processedLineItems = batchedLines.map((li, idx) => {
        const calc = calcLineItem({
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          taxPercent: li.taxPercent,
          discountPercent: li.discountPercent,
          taxInclusive: li.taxInclusive,
          intraState,
        });
        return {
          invoiceId: invoice.id,
          itemId: li.itemId,
          // Online store orders: snapshot the item name into the required
          // itemName column. Notes column stays null — store customers
          // don't submit per-line comments through the ordering UI.
          itemName: li.name,
          description: null,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          taxPercent: li.taxPercent,
          taxAmount: calc.taxAmount,
          discountPercent: "0",
          totalAmount: calc.total,
          sortOrder: idx,
          conversionFactor: li.conversionFactor ?? "1",
          selectedUnit: li.selectedUnit ?? null,
          variantId: li.variantId ?? null,
          batchId: li.batchId,
        };
      });

      await tx.insert(invoiceItems).values(processedLineItems);

      // Take the ordered stock out, per warehouse. Lock the item rows first
      // so concurrent orders for the same item queue up.
      // No extra isNull filter needed here: items/variants were already confirmed
      // active by the foundItems/foundVariants queries earlier in this handler.
      const itemIds = [...new Set(lineItemInputs.filter(li => !li.variantId).map(li => li.itemId))];
      const variantIds = [...new Set(lineItemInputs.filter(li => li.variantId).map(li => li.variantId!))];
      if (itemIds.length > 0) {
        await tx.select({ id: items.id }).from(items)
          .where(inArray(items.id, itemIds)).for("update");
      }
      if (variantIds.length > 0) {
        await tx.select({ id: itemVariants.id }).from(itemVariants)
          .where(inArray(itemVariants.id, variantIds)).for("update");
      }
      await syncDocumentStock(tx, {
        businessId: resolved.businessId,
        documentId: invoice.id,
        event: "CREATE",
      });

      // Create the store order record
      const [order] = await tx.insert(storeOrders).values({
        businessId: resolved.businessId,
        invoiceId: invoice.id,
        orderNumber,
        status: "pending",
        customerName: customerName.trim(),
        customerPhone,
        customerEmail: typeof customerEmail === "string" ? customerEmail.trim() || null : null,
        deliveryAddress: typeof deliveryAddress === "string" ? deliveryAddress.trim() || null : null,
        deliveryCity: typeof deliveryCity === "string" ? deliveryCity.trim() || null : null,
        deliveryPincode: typeof deliveryPincode === "string" ? deliveryPincode.trim() || null : null,
        deliveryNotes: typeof notes === "string" ? notes.trim() || null : null,
        totalAmount: totals.total,
        itemCount: lineItemInputs.length,
        source: "online_store",
        paymentMethod,
      }).returning();

      return { order, invoice };
    });

    // Online: the payment link is made after the order is saved, so a Razorpay hiccup never loses
    // the order; the shopper can use "Pay again" on the order page.
    let paymentUrl: string | null = null;
    let paymentError: string | null = null;
    if (paymentMethod === "online") {
      try {
        const link = await createStoreOrderPaymentLink(db, { businessId: resolved.businessId, slug, orderId: result.order.id });
        if (link.ok) paymentUrl = link.url;
        else paymentError = link.error;
      } catch (err) {
        logger.error({ err }, "[store/order] could not create the payment link");
        paymentError = "Online payment is unavailable right now. You can pay again from your order page.";
      }
    }
    // Best effort, after the response is decided: the order confirmation email.
    void sendStoreOrderEmail(db, resolved.businessId, result.order.id, "placed");

    return c.json({
      orderId: result.order.id,
      orderNumber: result.order.orderNumber,
      totalAmount: result.order.totalAmount,
      subtotal: totals.subtotal,
      deliveryCharge: totals.chargesTotal,
      taxAmount: totals.taxTotal,
      paymentMethod,
      paymentStatus: "unpaid",
      paymentUrl,
      ...(paymentError ? { paymentError } : {}),
      message: paymentMethod === "online"
        ? "Order placed. Complete the payment to confirm it."
        : "Order placed successfully! The business will confirm shortly.",
    }, 201);
  } catch (err) {
    logger.error({ err }, "[store/order] Failed to create order");
    return c.json({ error: "Failed to place order. Please try again." }, 500);
  }
});

// ── Self-export download endpoint ─────────────────────────────
// Label print request. Quantities are bounded here as well as in the PDF
// generator so an absurd payload is rejected before any work happens.
const labelRequestSchema = z.object({
  // Omitted = the fixed label for the business's barcode type.
  presetId: z.enum(Object.keys(LABEL_PRESETS) as [string, ...string[]]).optional(),
  showPrice: z.boolean().default(true),
  showName: z.boolean().default(true),
  lines: z.array(z.object({
    itemId: z.string().uuid(),
    variantId: z.string().uuid().optional(),
    quantity: z.number().int().min(1).max(500),
  })).min(1).max(500),
});

// POST /api/items/labels — barcode label sheet as a PDF.
//
// POST rather than GET because the body carries a per-item quantity map, and
// a label run can cover far more items than a query string should hold.
// Auth chain is identical to the other PDF endpoints.
// Entitlements (rest-entitlement-policy.ts: exempt-download): a label sheet is a
// PDF download, so it stays open in read-only mode; suspended is refused below.
app.post("/api/items/labels", async (c) => {
  if (!checkPdfRateLimit(getClientIp(c))) {
    return c.json({ error: "Too many PDF requests. Try again later." }, 429);
  }

  const sessionId = getSessionIdFromRequest(c.req.raw);
  if (!sessionId) return c.json({ error: "Unauthorized" }, 401);

  const [sessionRow] = await controlDb
    .select({ userId: sessions.userId, tenantId: sessions.tenantId })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!sessionRow) return c.json({ error: "Unauthorized" }, 401);
  if (!sessionRow.tenantId) return c.json({ error: "No organization selected" }, 400);

  const [tenant] = await controlDb.select({ status: tenants.status })
    .from(tenants).where(eq(tenants.id, sessionRow.tenantId)).limit(1);
  if (!tenant || tenant.status !== "active") return c.json({ error: "Organization suspended" }, 403);

  const businessId = c.req.header("x-business-id");
  if (!businessId) return c.json({ error: "No business selected" }, 400);

  const db = await getTenantDb(sessionRow.tenantId);
  const bizAccess = await verifyBusinessAccess(db, businessId, sessionRow.tenantId, sessionRow.userId);
  if (!bizAccess.ok) return c.json({ error: bizAccess.error }, 403);

  const parsed = labelRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "Invalid label request", detail: parsed.error.flatten() }, 400);
  }
  const body = parsed.data;

  const [biz] = await db.select({
    name: businesses.name,
    barcodesEnabled: businesses.barcodesEnabled,
    barcodeType: businesses.barcodeType,
  }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz?.barcodesEnabled) {
    return c.json({ error: "Barcodes are switched off for this business" }, 403);
  }
  const symbology = asBarcodeType(biz.barcodeType);

  // Read the catalogue rows server-side: the client sends ids and counts, and
  // never the printed values, so a tampered request cannot put arbitrary text
  // or someone else's product on a label.
  const itemIds = body.lines.map((l) => l.itemId);
  const rows = await db.select().from(items)
    .where(and(
      eq(items.businessId, businessId),
      inArray(items.id, itemIds),
      isNull(items.deletedAt),
    ));
  const itemsById = new Map(rows.map((r) => [r.id, r]));

  const variantIds = body.lines.map((l) => l.variantId).filter((v): v is string => !!v);
  const variantRows = variantIds.length
    ? await db.select().from(itemVariants)
        .where(and(inArray(itemVariants.id, variantIds), isNull(itemVariants.deletedAt)))
    : [];
  const variantsById = new Map(variantRows.map((v) => [v.id, v]));

  const labelItems = body.lines.flatMap((line) => {
    const item = itemsById.get(line.itemId);
    if (!item) return [];

    const variant = line.variantId ? variantsById.get(line.variantId) : null;
    // A variant belonging to a different item would be a mismatched request.
    if (line.variantId && (!variant || variant.itemId !== item.id)) return [];

    const price = variant?.salePrice ?? item.salePrice;
    return [{
      name: item.name,
      barcode: (variant?.barcode ?? item.barcode ?? "").trim(),
      price: price ? `₹${price}` : undefined,
      variantLabel: variant
        ? Object.entries(variant.attributeValues as Record<string, string>)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ")
        : undefined,
      quantity: line.quantity,
    }];
  });

  const { pdf, printed, skipped } = await generateLabelSheetPDF({
    businessName: biz?.name ?? "",
    presetId: body.presetId ?? TYPE_PRESET[symbology],
    symbology,
    items: labelItems,
    showPrice: body.showPrice,
    showName: body.showName,
  });

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="labels.pdf"',
      "Cache-Control": "no-store",
      // Surfaced in the UI so a silent skip never looks like a successful run.
      "X-Labels-Printed": String(printed),
      "X-Labels-Skipped": encodeURIComponent(JSON.stringify(skipped)),
    },
  });
});

// Every route below and above has an explicit read-only/suspended decision in
// http/rest-entitlement-policy.ts; rest-entitlement-policy.test.ts fails when a
// route is registered without one. Add the row when you add the route.
registerExportRoute(app);

// ── Self-import upload endpoint ────────────────────────────────
registerImportRoute(app);

// ── Subscription billing ───────────────────────────────────────
// Razorpay subscription webhooks, and the GST invoice PDFs Finvera issues.
registerRazorpayWebhook(app);
registerBillingInvoiceRoute(app);
// A business's own Razorpay account: payment-link webhooks routed by a per-business token.
registerBusinessRazorpayWebhook(app, { clientIp: getClientIp, rateLimitDisabled });

// ── AI assistant (streaming answers over server-sent events) ──
registerAiStreamRoute(app);

// ── tRPC handler ───────────────────────────────────────────────
app.use("/api/trpc/*", async (c) => {
  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
    onError({ error, path }) {
      if (error.code === "INTERNAL_SERVER_ERROR") {
        logger.error({ path, err: error }, `[tRPC] ${path}`);
      }
    },
  });
  return response;
});

// ── Session cleanup (FINDING 7) ────────────────────────────────
// Clean up expired sessions every hour — unref so it doesn't keep process alive
const cleanupTimer = setInterval(async () => {
  try {
    await controlDb.delete(sessions).where(lt(sessions.expiresAt, new Date()));
    await controlDb.delete(emailChangeTokens).where(lt(emailChangeTokens.expiresAt, new Date()));
  } catch (e) {
    logger.error({ err: e }, "[session-cleanup] Failed");
  }
}, 60 * 60 * 1000);
cleanupTimer.unref();

// ── Branded HTML pages ────────────────────────────────────────
function brandedHtml(title: string, heading: string, message: string, status: number) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Fintranzact</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'DM Sans', system-ui, sans-serif; background: #f8f9fa; color: #1a1a2e; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { text-align: center; padding: 2rem; }
    .logo { width: 48px; height: 48px; border-radius: 14px; background: #3b5eaa; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 1.5rem; }
    .logo span { color: white; font-weight: 700; font-size: 22px; }
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; color: #1a1a2e; }
    p { color: #6b7280; font-size: 0.9rem; line-height: 1.6; max-width: 400px; margin: 0 auto; }
    .status { font-size: 4rem; font-weight: 800; color: #3b5eaa; opacity: 0.15; margin-bottom: -0.5rem; }
    a { color: #3b5eaa; text-decoration: none; font-weight: 500; }
    a:hover { text-decoration: underline; }
    .links { margin-top: 1.5rem; display: flex; gap: 1.5rem; justify-content: center; font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo"><span>F</span></div>
    ${status >= 400 ? `<div class="status">${status}</div>` : ""}
    <h1>${heading}</h1>
    <p>${message}</p>
    <div class="links">
      <a href="https://fintranzact-web.vercel.app">Fintranzact</a>
      <a href="/health">API Status</a>
    </div>
  </div>
</body>
</html>`;
}

// ── Shipping carrier webhooks ──────────────────────────────────
// Carriers POST status updates here. The URL includes the business ID for routing.
// Each carrier has a different payload format — the handler normalises them into shipment events.
// For now: accept, log, and store the raw payload. Actual carrier-specific parsing comes later.
//
// Entitlements (http/rest-entitlement-policy.ts: exempt-webhook): events are still
// accepted for a READ-ONLY organisation (dropping carrier updates would lose data),
// but a SUSPENDED organisation is refused: the multi-tenant lookup below only scans
// tenants with status "active", so a suspended tenant's business answers 404.
app.post("/webhooks/shipping/:businessId", async (c) => {
  const secret = process.env.SHIPPING_WEBHOOK_SECRET;
  if (!secret) {
    return c.json({ error: "Webhook not configured" }, 503);
  }

  const signature = c.req.header("x-webhook-signature");
  if (!signature) {
    return c.json({ error: "Missing signature" }, 401);
  }

  const rawBody = await c.req.text();
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const signatureBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== signatureBuf.length || !timingSafeEqual(expectedBuf, signatureBuf)) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  const businessId = c.req.param("businessId");
  let body: Record<string, any>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  // Resolve tenant from business ID and get DB connection
  const { shipments: shipmentsTable, shipmentEvents } = await import("@fintranzact/db");
  // In single-tenant mode, use "single"; in multi-tenant, scan active tenants to find the owner
  const isMultiTenant = process.env.MULTI_TENANT === "true";
  let db: Awaited<ReturnType<typeof getTenantDb>>;

  if (!isMultiTenant) {
    db = await getTenantDb("single");
  } else {
    const activeTenants = await controlDb
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.status, "active"));

    let resolvedDb: Awaited<ReturnType<typeof getTenantDb>> | undefined;
    for (const t of activeTenants) {
      const tdb = await getTenantDb(t.id);
      const [biz] = await tdb
        .select({ id: businesses.id })
        .from(businesses)
        .where(eq(businesses.id, businessId))
        .limit(1);
      if (biz) {
        resolvedDb = tdb;
        break;
      }
    }
    if (!resolvedDb) {
      return c.json({ error: "Business not found" }, 404);
    }
    db = resolvedDb;
  }

  // Extract tracking number — carriers typically send it as `awb`, `tracking_id`, or `waybill`
  const trackingNumber = body.awb || body.tracking_id || body.waybill || body.trackingNumber || null;
  if (!trackingNumber) {
    return c.json({ error: "No tracking number found in payload" }, 400);
  }

  // Find the shipment by tracking number + business
  const [shipment] = await db.select({ id: shipmentsTable.id })
    .from(shipmentsTable)
    .where(and(
      eq(shipmentsTable.businessId, businessId),
      eq(shipmentsTable.trackingNumber, trackingNumber),
    ))
    .limit(1);

  if (!shipment) {
    return c.json({ error: "Shipment not found", trackingNumber }, 404);
  }

  // Store the raw event — carrier-specific parsing will be added per carrier
  await db.insert(shipmentEvents).values({
    shipmentId: shipment.id,
    status: body.status || body.current_status || "unknown",
    statusDetail: body.status_description || body.remarks || body.message || null,
    location: body.location || body.scan_location || body.city || null,
    source: "webhook",
    carrierStatus: body.status_code || body.status || null,
    eventTime: body.timestamp ? new Date(body.timestamp) : new Date(),
  });

  return c.json({ ok: true, shipmentId: shipment.id });
});

// Base page — shows when someone visits the API root
app.get("/", (c) => {
  return c.html(brandedHtml(
    "API",
    "Fintranzact API",
    "Professional billing for Indian businesses. This is the API server — the web app is at <a href=\"https://fintranzact-web.vercel.app\">fintranzact-web.vercel.app</a>",
    200,
  ));
});

// 404 handler — catch-all for unmatched routes
app.notFound((c) => {
  // Return JSON for API-like paths
  if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/store/")) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.html(brandedHtml(
    "Not Found",
    "Page not found",
    "The page you're looking for doesn't exist. If you're looking for the Fintranzact app, visit <a href=\"https://fintranzact-web.vercel.app\">fintranzact-web.vercel.app</a>",
    404,
  ), 404);
});

// ── Startup sanity check ─────────────────────────────────────
// Refuse to boot if the migration SQL directories aren't where the bundled
// runtime expects them. Without this, a broken Dockerfile / bundle layout
// would boot "successfully" and only fail on the first user signup (which is
// how we learned the hard way that @fintranzact/db's __dirname shifts when tsup
// inlines it into apps/api/dist).
{
  const missing = assertMigrationsPresent();
  if (missing.length > 0) {
    for (const m of missing) logger.fatal({ reason: m }, "Migration directory missing at boot");
    logger.fatal("Refusing to start — fix the bundle/deploy layout and retry");
    process.exit(1);
  }
}

// ── Start ──────────────────────────────────────────────────────
const port = parseInt(process.env.PORT || "3000", 10);

const server = serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port }, `Fintranzact API running on http://localhost:${info.port}`);
  logger.info({ port: info.port }, `  tRPC endpoint: http://localhost:${info.port}/api/trpc`);
  startRecurringScheduler();
  startTdsReminderScheduler();
  startHsnRefreshScheduler();
  startTrialReminderScheduler();
  startPaymentReminderScheduler();
  // Create the platform admin from PLATFORM_ADMIN_EMAIL / _PASSWORD if set.
  seedPlatformAdmin().catch((err) => logger.error({ err }, "Could not create the platform admin account"));
});

// ── Graceful shutdown ─────────────────────────────────────────
function shutdown(signal: string) {
  logger.info({ signal }, `Shutting down (${signal})...`);
  stopRecurringScheduler();
  stopTdsReminderScheduler();
  stopHsnRefreshScheduler();
  stopTrialReminderScheduler();
  stopPaymentReminderScheduler();
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
  // Force kill if server doesn't close within 5 seconds
  setTimeout(() => {
    logger.error("Forced exit after timeout");
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
