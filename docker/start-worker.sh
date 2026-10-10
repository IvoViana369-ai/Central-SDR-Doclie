#!/bin/sh
# Worker de jobs (pg-boss), executado com tsx. "exec" garante o encerramento gracioso.
set -eu
cd /app/apps/worker
exec node --import tsx src/index.ts
