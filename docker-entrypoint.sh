#!/bin/sh
set -e

echo "[entrypoint] Fintranzact API — starting up"
echo "[entrypoint] Node $(node --version) | ENV=${NODE_ENV}"

# ── Validate required env vars ────────────────────────────────
if [ -z "$DATABASE_URL" ]; then
  echo "[entrypoint] FATAL: DATABASE_URL is not set. Cannot start without a database connection."
  exit 1
fi

# ── Run database migrations ────────────────────────────────────
# Default behaviour is unchanged: migrate, then start the server.
# Two opt-in switches exist for hosts that run migrations as a separate step
# (for example the AWS ECS deploy, see docs/infra/):
#   docker-entrypoint.sh migrate   run the migrations and exit (one-off task)
#   RUN_MIGRATIONS=false           skip the migrations and just start the server
# The migration runner holds a Postgres advisory lock, so even two containers
# starting together never migrate at the same time.
run_migrations() {
  echo "[entrypoint] Running database migrations..."
  if ! node /app/packages/db/dist/migrate.mjs; then
    echo "[entrypoint] FATAL: Migration failed! Refusing to start with potentially inconsistent DB."
    echo "[entrypoint] Check DATABASE_URL and migration files."
    exit 1
  fi
}

if [ "$1" = "migrate" ]; then
  run_migrations
  echo "[entrypoint] Migrations finished. Exiting (migrate-only mode)."
  exit 0
fi

if [ "${RUN_MIGRATIONS:-true}" = "false" ]; then
  echo "[entrypoint] RUN_MIGRATIONS=false, skipping migrations (run them as a separate step)."
else
  run_migrations
fi

# ── Start the API server ───────────────────────────────────────
echo "[entrypoint] Starting Fintranzact API server on port ${PORT:-3000}..."
exec node packages/api/dist/server.js
