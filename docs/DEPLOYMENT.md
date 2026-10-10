# Fintranzact Deployment Guide

## Architecture Overview

```
                  Vercel                     Vercel          
                  +--------------+           +--------------+
   Users -------> | apps/web     |           | apps/store   |
                  | (React SPA)  |           | (Store SPA)  |
                  +------+-------+           +------+-------+
                         |                          |
                         |   HTTPS (tRPC / REST)    |
                         +----------+---------------+
                                    |
                                    v
                  +-------------------------------+
                  | api.fintranzact.com           |
                  | - /api/*   -> tRPC            |
                  | - /store/* -> public catalog  |
                  | - /health  -> health check    |
                  +------+------------------------+
                         |
                         v
                  +-------------------------------+
                  | fintranzact-api (Docker / GHCR)   |
                  | packages/api + db + shared    |
                  | Runs migrations on startup    |
                  +------+------------------------+
                         |
                         v
                  +-------------------------------+
                  | PostgreSQL 16                  |
                  | (managed or self-hosted)       |
                  +-------------------------------+
```

## CI/CD Pipeline

### On every PR and push to `main`

**`ci.yml`** runs typecheck, lint, and build for the entire monorepo. On PRs it also does a Docker build dry-run (no push) to catch Dockerfile issues early.

### On push to `main` (path-filtered)

| Workflow | Trigger paths | Action |
|---|---|---|
| `deploy-api.yml` | `packages/api/**`, `packages/db/**`, `packages/shared/**`, `Dockerfile` | Build Docker image, push to GHCR |

The web and store frontends are deployed by Vercel's Git integration (see `apps/web/vercel.json`), not by a GitHub workflow.

## Environment Variables

### Vercel (Web App)

| Variable | Description | Example |
|---|---|---|
| `API_URL` | API server URL (build-time) | `${import.meta.env.API_URL}` |

### Vercel (Store)

| Variable | Description | Example |
|---|---|---|
| `API_URL` | API server URL (build-time) | `${import.meta.env.API_URL}` |

### Backend (Docker / GHCR)

| Variable | Required | Description | Example |
|---|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string | `postgresql://user:pass@host:5432/fintranzact` |
| `PORT` | No | API port (default 3000) | `3000` |
| `NODE_ENV` | Yes | Environment | `production` |
| `CORS_ORIGINS` | Yes | Comma-separated allowed origins | `https://fintranzact-web.vercel.app,https://store.fintranzact.com` |
| `TRUSTED_PROXY_CIDRS` | No | Networks of proxies in front of the API whose `X-Forwarded-For` entries are skipped to find the visitor (rate limits, audit trail). On AWS the Terraform sets the CloudFront ranges | `130.176.0.0/18,15.158.0.0/16` |
| `TRUSTED_PROXY_HOPS` | No | Alternative to the above: how many `X-Forwarded-For` entries to skip from the right (0 to 10). Default 0 | `1` |
| `TRUST_CF_CONNECTING_IP` | No | Set `false` unless the API is behind Cloudflare. Anywhere else a client can send this header and dodge every per-IP rate limit. Default: trusted | `false` |
| `APP_URL` | Yes | Frontend URL (for email-change and invitation links) | `https://fintranzact-web.vercel.app` |
| `ENCRYPTION_KEY` | Yes | AES-256-GCM key for field-level encryption (64-char hex). Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | `a1b2c3...` |
| `SANDBOX_API_KEY` | No | Sandbox.co.in API key for GST e-invoice, e-way bill, GSTIN lookup and TDS/TCS. `key_test_…` uses the test host, `key_live_…` the live host | `key_live_abc…` |
| `SANDBOX_API_SECRET` | No | Sandbox.co.in API secret that pairs with the key (server-side only) | |
| `SANDBOX_MONTHLY_QUOTA` | No | Calls per month included in your Sandbox plan. A deployment-wide counter alerts at 80% and 100%. Unset = no quota alerts | `10000` |
| `GOV_API_PROVIDER` | No | `direct` forces the direct NIC client even when Sandbox keys are set (rollback switch); `sandbox` forces Sandbox. Unset = Sandbox when `SANDBOX_API_KEY` is set | `direct` |
| `HSN_SANDBOX_LOOKUP` | No | `off` stops HSN / SAC lookups on Sandbox (the bundled CBIC list is used alone). Default `on`; lookups only run when Sandbox is the provider and its keys are set | `on` |
| `HSN_LOOKUP_TIMEOUT_MS` | No | Longest an HSN lookup waits for Sandbox before using the bundled list. Default `2500`, at most `10000` (item saves are always capped at 2500) | `2500` |
| `GSTIN_SANDBOX_LOOKUP` | No | `off` stops GSTIN searches on Sandbox when a party is added or saved (only local validation is left). Default `on`; searches only run when Sandbox is the provider and its keys are set | `on` |
| `GSTIN_LOOKUP_TIMEOUT_MS` | No | Longest a GSTIN search waits for Sandbox. Default `2500`, at most `10000` (party saves are always capped at 2500) | `2500` |
| `GOV_RATE_E_INVOICE_PAISE` | No | Price per successfully generated e-invoice, in paise, before GST. Default `200` (₹2) | `200` |
| `GOV_RATE_E_WAY_BILL_PAISE` | No | Price per e-way bill, in paise, before GST. Default `200` | `200` |
| `GOV_RATE_GSTR1_PAISE` | No | Price per GSTR-1 filing, in paise, before GST. Default `0` | `0` |
| `GOV_RATE_GSTR3B_PAISE` | No | Price per GSTR-3B filing, in paise, before GST. Default `0` | `0` |
| `ENCRYPTION_KEYS_PREVIOUS` | No | Previous encryption keys (comma separated, decrypt-only) — set during and after a key rotation; see [key rotation](security/key-rotation.md). `ENCRYPTION_KEY_PREVIOUS` (one key) is still read | |
| `ENCRYPTION_KEY_ID` | No | Optional label for the current key (default: a fingerprint of the key) | |
| `RESEND_API_KEY` | Yes | Email service API key (email-change links, invites) | `re_xxx` |
| `EMAIL_FROM` | No | From address for emails | `Fintranzact <noreply@fintranzact.com>` |
| `MULTI_TENANT` | No | Enable multi-tenancy | `true` |
| `CONTROL_DATABASE_URL` | No | Separate control DB (multi-tenant only) | `postgresql://...` |

Rates must be whole paise (integers, 0 or more); an invalid value falls back to the default. See [SANDBOX-INTEGRATION.md](SANDBOX-INTEGRATION.md) for how metering and billing work.

### GitHub Actions Secrets

No extra secrets are needed: `GITHUB_TOKEN` is provided automatically by GitHub Actions for GHCR pushes. Frontend build variables such as `API_URL` are set in the Vercel project settings.

## Self-Hosting with Docker Compose

### Quick start

1. Clone the repo and create your prod env file:

```bash
cp .env.prod.example .env.prod
```

2. Edit `.env.prod` with your production values:
   - Set a strong `POSTGRES_PASSWORD`
   - Generate an `ENCRYPTION_KEY`: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - Set `CORS_ORIGINS` and `APP_URL` to your domain
   - Set `RESEND_API_KEY` for email delivery

3. Update `docker-compose.prod.yml`:
   - Replace `ghcr.io/OWNER/fintranzact-api:latest` with your actual GHCR image path

4. Start the stack:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
```

5. Verify health:

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"2026-03-25T..."}
```

### Updating

```bash
docker compose -f docker-compose.prod.yml pull api
docker compose -f docker-compose.prod.yml up -d api
```

The entrypoint script runs pending migrations automatically before starting the server.

## Kamal / Once.com Compatibility

The `docker-compose.prod.yml` is compatible with Kamal's deploy model:

- Health check endpoint: `GET /health` on port 3000
- The container runs migrations on startup (idempotent)
- Graceful shutdown: entrypoint uses `exec` so Node receives SIGTERM directly
- Image is tagged with both `latest` and the commit SHA for rollback

### TLS Termination

TLS is terminated by the hosting platform (Railway, Vercel) or upstream (Cloudflare Tunnel, Caddy, or a cloud load balancer). The API container listens on plain HTTP on port 3000.
