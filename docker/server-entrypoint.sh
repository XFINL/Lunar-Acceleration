#!/bin/sh
set -e

cd /app/apps/server

PRISMA_BIN="./node_modules/.bin/prisma"
if [ ! -x "$PRISMA_BIN" ]; then
  PRISMA_BIN="/app/node_modules/.bin/prisma"
fi

echo "[entrypoint] applying database migrations..."
"$PRISMA_BIN" migrate deploy

if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] seeding database..."
  "$PRISMA_BIN" db seed || echo "[entrypoint] seed failed or already applied, continue"
fi

exec "$@"
