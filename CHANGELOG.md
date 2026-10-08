# Changelog

Registro do que foi entregue em cada fase do [roadmap](docs/ROADMAP.md). Formato inspirado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [0.1.0] — Fase 1: Fundação técnica — 2026-10-08

### Adicionado

- **Monorepo** pnpm (`apps/web`, `apps/worker`, `packages/core|db|integrations|config`), TypeScript 6 estrito, ESLint 10 com regras de fronteira entre módulos, Prettier, Vitest e `docker-compose` (PostgreSQL 17 + Mailpit).
- **Ambiente validado** (Zod): a aplicação não sobe com configuração inválida; mensagens sem expor valores; regras mais rígidas em staging/produção; teste garante que o `.env.example` documenta exatamente o que é validado.
- **Banco** (Prisma 7.10): usuários e sessões (Better Auth), equipes, convites, auditoria, configurações, UFs, 5.571 municípios (código IBGE, DDD, fuso) e feriados nacionais calculados. IDs UUIDv7.
- **Auditoria imutável**: trigger bloqueia UPDATE, DELETE e TRUNCATE em `audit_logs`; purga só pela rotina de retenção autorizada na transação.
- **Núcleo de domínio**: matriz de permissões por perfil (testada contra o SECURITY.md), executor de casos de uso (autoriza → valida → transação com auditoria → pós-commit) e acessos negados auditados.
- **Identidade**: convite por e-mail (token com hash, 72 h, reenvio invalida o anterior), aceite com definição de senha, mudança de perfil, ativar/desativar (revoga sessões) e proteção contra remover o último administrador.
- **Autenticação** (Better Auth): login sem cadastro público, redefinição de senha (30 min), rate limit por IP persistido no banco, só usuários ativos abrem sessão, login e falhas auditados com e-mail mascarado.
- **IP do cliente confiável**: lido só do `X-Forwarded-For`, percorrido a partir dos proxies listados em `TRUSTED_PROXIES`; um valor forjado pelo cliente não é aceito nem no rate limit nem na auditoria.
- **Web** (Next.js 16): login, esqueci/redefinir senha, convite, dashboard, Equipe, Auditoria, Integrações, Configurações e páginas "Em breve" por fase; menu lateral por permissão, gaveta no celular, tema claro/escuro.
- **API v1** (`/api/v1`): `me`, `users`, `users/{id}`, `resend-invitation`, `invitations/accept`, `audit-logs`, `integrations`; erros em `problem+json`, verificação de origem (CSRF), limite de corpo; `/api/health` com banco e worker.
- **Segurança web**: CSP com nonce por requisição, HSTS, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.
- **Fila e worker**: pg-boss 12 com enfileiramento na mesma transação do dado; worker com heartbeat a cada minuto e encerramento gracioso.
- **Integrações**: logger com mascaramento de dados pessoais; e-mail por console, arquivo (dev/testes), SMTP ou Resend; registro de provedores que falha na inicialização se uma integração de fase futura for configurada.
- **CLI** `pnpm admin:create` para o primeiro administrador.
- **Testes**: 152 unitários, 32 de integração (PostgreSQL real) e 8 jornadas E2E (Playwright), incluindo verificação de violações de CSP.
- **CI** (GitHub Actions, fixadas por SHA): lint, tipos, testes, checagem de drift de migrações, `pnpm audit`, gitleaks no histórico completo, E2E e build da imagem.
- **Deploy**: Dockerfile único (web e worker, dependências de produção, usuário não-root) validado de ponta a ponta; `render.yaml` para staging.

### Pendente

- **Staging no ar**: pronto para subir, mas depende da decisão de hospedagem e das credenciais da Docline.
- **F1-13 — Sentry** (MUST): não integrado; só `SENTRY_DSN` está reservada. Movido para F2-17 (depende da conta da Docline).
- **F1-15 — 2FA (TOTP) para Administrador e Gestor** (SHOULD). Movido para F2-16; obrigatório antes das Fases 7–9 (SECURITY.md §3).
- **Limite de login por conta** (SECURITY.md §12): hoje o limite é por IP. Movido para F2-18.

### Decisões tomadas na execução

- TypeScript **6.0** em vez de 7.x (o typescript-eslint ainda não suporta o 7).
- **Imagem Docker única** para web e worker (o worker roda com `tsx`), em vez de Next standalone + imagem separada: um artefato e migrações garantidas no pre-deploy. Otimização de tamanho registrada como melhoria futura.
- `prisma` e `tsx` são dependências de produção do pacote de banco (migrações e seed rodam no deploy).
- Sobrescritas de segurança para dependências transitivas do CLI do Prisma (`deepmerge-ts`, `mysql2`), até o Prisma publicar versões corrigidas.

## [0.0.0] — Fase 0: Descoberta e arquitetura — 2026-10-05

### Adicionado

- Documentação de arquitetura, MVP, modelo de dados, roadmap, segurança, integrações, LGPD, fluxo SDR e SDR AI (`docs/`).
- `.env.example` e `.gitignore` com proteção de segredos e planilhas.
