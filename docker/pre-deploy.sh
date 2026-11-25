#!/bin/sh
# Pre-deploy do serviço web (render.yaml): migrações e dados de referência.
# Em serviços Docker a Render roda o comando sem shell: com
# "pnpm db:deploy && pnpm db:seed" direto no render.yaml, o "&&" virava argumento
# e o seed nunca rodava (o deploy passava com o banco sem etapas, UFs e origens).
# Aqui cada etapa roda em sequência e qualquer falha derruba o deploy.
set -eu
cd "$(dirname "$0")/.."
pnpm db:deploy
pnpm db:seed
