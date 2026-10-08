#!/bin/sh
# Servidor web (Next.js). "exec" faz o Node receber o SIGTERM da plataforma.
set -eu
cd /app/apps/web
exec node node_modules/next/dist/bin/next start --port "${PORT:-3000}" --hostname "${HOSTNAME:-0.0.0.0}"
