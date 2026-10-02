/**
 * env-setup.ts — Environment bootstrap loaded via vitest setupFiles.
 *
 * WHY THIS FILE EXISTS:
 * vitest setupFiles run before any test module is imported. That means the
 * process.env mutations below take effect before @fintranzact/db creates its
 * postgres.js clients (which happen at module evaluation time). This is the
 * ONLY safe place to redirect DB connections for tests — anywhere later and
 * the production clients are already open.
 *
 * MULTI_TENANT=false keeps getTenantDb() in self-hosted mode, meaning the
 * control schema and tenant schema live in the same database. This is the
 * correct model for the test environment.
 */

const testUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://test:test@localhost:5433/fintranzact_test";

process.env.DATABASE_URL = testUrl;
process.env.CONTROL_DATABASE_URL = testUrl;
process.env.MULTI_TENANT = "false";
process.env.NODE_ENV = "test";
// Prevent real email delivery during tests
process.env.RESEND_API_KEY = "";
// Billing must use the demo gateway in tests, never the live Razorpay API.
// The developer's real keys would leak in through the root .env, which
// @fintranzact/db's dotenv call loads AFTER this setup file runs — but dotenv
// never overrides a key that already exists, so blank them (not delete) here.
process.env.RAZORPAY_KEY_ID = "";
process.env.RAZORPAY_KEY = "";
process.env.RAZORPAY_KEY_SECRET = "";
process.env.RAZORPAY_SECRET = "";
process.env.RAZORPAY_WEBHOOK_SECRET = "";
// A developer's real Sandbox.co.in keys (loaded from .env) must never leak
// into tests: they would route e-invoice / e-way bill calls to the live
// gateway instead of the mocked NIC clients. Tests that exercise the Sandbox
// provider set these themselves.
delete process.env.SANDBOX_API_KEY;
delete process.env.SANDBOX_API_SECRET;
delete process.env.SANDBOX_BASE_URL;
delete process.env.GOV_API_PROVIDER;
