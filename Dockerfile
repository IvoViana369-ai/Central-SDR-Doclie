# syntax=docker/dockerfile:1
#
# Imagem única para os dois serviços (docs/ARCHITECTURE.md §14):
#   web    → docker/start-web.sh    (padrão)
#   worker → docker/start-worker.sh
# Migrações e seed de referência rodam no pre-deploy do serviço web:
#   pnpm db:deploy && pnpm db:seed

FROM node:22-bookworm-slim AS base
ENV CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN npm install -g pnpm@10.28.0 && npm cache clean --force
WORKDIR /app

# Manifestos do workspace (camada de dependências reaproveitada entre builds).
FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/prisma.config.ts packages/db/
COPY packages/db/prisma packages/db/prisma
COPY packages/integrations/package.json packages/integrations/

# Build: todas as dependências + build de produção do Next.js.
FROM manifests AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @docline/web build && rm -rf apps/web/.next/cache

# Somente dependências de produção (o postinstall gera o cliente Prisma).
FROM manifests AS prod-deps
RUN pnpm install --frozen-lockfile --prod

FROM base AS runtime
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=prod-deps --chown=node:node /app /app
COPY --chown=node:node . .
COPY --from=build --chown=node:node /app/apps/web/.next /app/apps/web/.next
USER node
EXPOSE 3000
CMD ["/app/docker/start-web.sh"]
