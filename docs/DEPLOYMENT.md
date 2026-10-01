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
| `APP_URL` | Yes | Frontend URL (for magic links) | `https://fintranzact-web.vercel.app` |
| `ENCRYPTION_KEY` | Yes | AES-256-GCM key for field-level encryption (64-char hex). Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | `a1b2c3...` |
| `ENCRYPTION_KEY_PREVIOUS` | No | Previous encryption key — set only during key rotation | |
| `RESEND_API_KEY` | Yes | Email service API key (magic links, invites) | `re_xxx` |
| `EMAIL_FROM` | No | From address for emails | `Fintranzact <noreply@fintranzact.com>` |
| `MULTI_TENANT` | No | Enable multi-tenancy | `true` |
| `CONTROL_DATABASE_URL` | No | Separate control DB (multi-tenant only) | `postgresql://...` |

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
