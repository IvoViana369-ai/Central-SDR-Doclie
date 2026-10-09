# Docline SDR — Central Inteligente de Prospecção

Central operacional de prospecção B2B da **Docline Tecnologia**, começando pelos escritórios de contabilidade, contadores e parceiros indicadores.

> **Status: Fases 1 e 2 concluídas.**
> - **Fase 1 (fundação técnica):** acesso por convite, perfis e permissões, auditoria imutável, fila de jobs, CI e deploy em Docker.
> - **Fase 2 (CRM de leads):** cadastro com aviso de duplicidade, lista com filtros e ações em massa, detalhe com timeline, Lista Não Contatar e opt-out, exportação auditada, 2FA, limite de login por conta e Sentry opcional.
>
> **Pendências:** subir o staging na Render (depende da conta e das credenciais da Docline) e configurar o DSN do Sentry ([ROADMAP](docs/ROADMAP.md#fase-2--crm-de-leads)).
>
> **Próxima:** Fase 3 (importação, normalização e deduplicação). Histórico em [CHANGELOG.md](CHANGELOG.md).

---

## O que é

Não é uma ferramenta de disparo de mensagens. É um **sistema operacional de prospecção comercial**, que acompanha cada lead de ponta a ponta:

```
Captação → Normalização → Duplicados → Enriquecimento → Qualificação → Score → Segmentação
→ Abordagem com IA (aprovada por humano) → Fila → WhatsApp / Instagram → Follow-up
→ Resposta → Qualificação → Oportunidade → Comercial → Acompanhamento → Conversão
```

Cada etapa é rastreável, o que permite responder com dados quantos leads temos, quem respondeu, qual abordagem, cidade, canal ou SDR converte melhor, quem está esquecido e onde ainda há potencial.

## Princípios

1. **Humano no controle:** a IA sugere; o SDR edita, aprova e envia.
2. **Conformidade por padrão:** LGPD, políticas da Meta e do Google, opt-out e Lista Não Contatar desde a primeira versão. Telefone encontrado ≠ autorização para mensagem.
3. **Rastreabilidade total:** toda ação vira evento na timeline e na auditoria.
4. **Velocidade do SDR:** fila priorizada, poucos cliques, funciona no celular.
5. **Simples para começar, pronto para crescer:** 1 web + 1 worker + 1 PostgreSQL, preparado para 500 mil leads.
6. **Integrações desacopladas:** adaptadores trocáveis, sem chamadas externas espalhadas pelo código.

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Análise de requisitos, conflitos encontrados, análise da stack, arquitetura, módulos, APIs internas, jobs, estrutura de pastas, testes, escalabilidade, ADRs |
| [docs/MVP.md](docs/MVP.md) | Escopo do MVP, histórias e critérios de aceite, telas, métricas de sucesso, critérios de go-live |
| [docs/DATABASE.md](docs/DATABASE.md) | Modelo conceitual, entidades, relacionamentos, índices, seeds, preparação para inteligência comercial |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Fases, cronograma, marcos, backlog, registro de riscos, dependências |
| [docs/SDR-FLOW.md](docs/SDR-FLOW.md) | Processo SDR: pipeline, cadência, Minha Fila, contato, respostas, transferência, métricas |
| [docs/AI-SDR.md](docs/AI-SDR.md) | SDR AI: arquitetura, modelos, contexto, prompts, guardrails, avaliação, custos |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | Portas e adaptadores; WhatsApp, Instagram, Google, dados abertos CNPJ, IA, CRM |
| [docs/LGPD.md](docs/LGPD.md) | Bases legais, opt-in × base legal, opt-out, direitos dos titulares, retenção, incidentes |
| [docs/SECURITY.md](docs/SECURITY.md) | Autenticação, RBAC, segredos, uploads, webhooks, IA, auditoria, checklist por fase |
| [.env.example](.env.example) | Variáveis de ambiente (sem segredos) |
| [CHANGELOG.md](CHANGELOG.md) | O que foi entregue em cada fase |

## Stack e decisões

| Tema | Decisão | Versão em uso |
|---|---|---|
| Arquitetura | **Monólito modular** em TypeScript (monorepo pnpm): `apps/web` (UI + API `/api/v1`) + `apps/worker` (jobs) + `packages/core` (domínio) + `packages/integrations` (adaptadores) + `packages/db` (Prisma) + `packages/config` (ambiente) | Node 22, pnpm 10, TypeScript 6.0 |
| Banco | **PostgreSQL** + Prisma (adaptador `pg`); `pg_trgm` para similaridade; auditoria append-only | PostgreSQL 16/17, Prisma 7.10 |
| Filas | **pg-boss** no próprio PostgreSQL, com enfileiramento na mesma transação do dado | pg-boss 12 |
| Frontend | Next.js (App Router) + Tailwind + componentes próprios sobre Radix; responsivo, tema claro/escuro | Next.js 16.3, React 19.3, Tailwind 4 |
| Autenticação | Better Auth (e-mail/senha, sem cadastro público) + RBAC próprio (Administrador, Gestor, SDR, Comercial) | Better Auth 1.7 |
| IA | Porta `AiProvider`; adaptador padrão Anthropic (Claude); aprovação humana obrigatória | Fase 6 |
| Contato no MVP | **Modo assistido** (`wa.me`/Instagram aberto pelo SDR, envio humano, registro no sistema). WhatsApp Cloud API na Fase 7, só com opt-in | Fases 5–7 |
| Captação | Planilhas e cadastro no MVP; **dados abertos CNPJ** como fonte primária de descoberta; Google Places apenas como apoio (após parecer jurídico) | Fases 3 e 9 |
| Qualidade | ESLint (com regras de fronteira entre módulos), Prettier, Vitest (unitários + integração com Postgres real), Playwright (E2E) | ESLint 10, Vitest 5, Playwright 1.63 |
| Deploy | Imagem Docker única (web e worker) na **Render, região Virginia** (decisão de 2026-10-08) | `Dockerfile`, `render.yaml` |
| n8n | Só nas bordas (integrações com sistemas Docline), nunca com regra de negócio | Fase 12 |

Justificativas e alternativas em [ARCHITECTURE §4](docs/ARCHITECTURE.md#4-análise-da-stack) e nos [ADRs](docs/ARCHITECTURE.md#15-registro-de-decisões-adrs).

## Principais riscos

1. **WhatsApp exige opt-in** para mensagens iniciadas pela empresa via API, o que inviabiliza a prospecção fria por API. Mitigação: modo assistido, opt-in legítimo e validação jurídica.
2. **Instagram não permite iniciar DMs pela API**: o primeiro contato é sempre humano.
3. **Termos do Google restringem armazenar dados do Places**: guardar só o `place_id` e usar dados abertos CNPJ como fonte primária.
4. **Base legal** de bases existentes precisa ser verificada antes da importação.
5. **Escopo**: disciplina de MVP e entregas por fase.

Registro completo em [ROADMAP §6](docs/ROADMAP.md#6-registro-de-riscos).

## Estrutura do repositório

```
apps/web               Next.js — telas, API /api/v1, autenticação, E2E (e2e/)
apps/worker            Jobs pg-boss (hoje: heartbeat; depois importação, dedup, cadência…)
packages/core          Domínio: casos de uso, RBAC, auditoria, portas (sem framework)
packages/db            Prisma: schema, migrações, seed de referência (UFs, municípios, feriados)
packages/integrations  Adaptadores: logger, e-mail, fila pg-boss, registro de provedores
packages/config        Validação das variáveis de ambiente (Zod)
docker/                Scripts de inicialização dos containers
docs/                  Documentação do projeto
```

Detalhes em [ARCHITECTURE §11](docs/ARCHITECTURE.md#11-estrutura-de-pastas).

## Convenções

- **Código em inglês; interface e documentação em português (pt-BR).**
- Commits no padrão Conventional Commits; um PR pequeno por história.
- Nenhum segredo, dado pessoal real ou planilha real no repositório (o `.gitignore` bloqueia `.env*`, `*.csv`, `*.xlsx` fora de `fixtures/`).
- Toda decisão arquitetural relevante vira ADR em [ARCHITECTURE §15](docs/ARCHITECTURE.md#15-registro-de-decisões-adrs).

## Glossário

| Termo (UI) | No código | Significado |
|---|---|---|
| Lead | `Lead` | Organização prospectada (escritório, empresa, parceiro) |
| Pessoa / responsável | `LeadPerson` | Contador, sócio ou contato dentro do lead |
| Ponto de contato | `ContactPoint` | Telefone, e-mail ou Instagram, com origem e status |
| Etapa | `PipelineStage` | Coluna do pipeline (Kanban) |
| Cadência | `Cadence` | Sequência de passos de contato (D0, D2, D5, D10) |
| Inscrição | `CadenceEnrollment` | Lead percorrendo uma cadência |
| Tarefa / atividade | `Task` / `Activity` | Ação a fazer / interação registrada |
| Abordagem | `Approach` | Estratégia de mensagem comparada em analytics |
| Geração de IA | `AiGeneration` | Rascunho gerado, editado, aprovado ou descartado |
| Lista Não Contatar | `SuppressionEntry` | Identificadores que não podem ser contatados |
| Base legal | `ContactPermission.legalBasis` | Fundamento LGPD do contato |
| Opt-in de plataforma | `ContactPermission.optInStatus` | Permissão exigida pela Meta para envio via API |
| Gate de contactabilidade | `ContactabilityService` | Verificação única de "posso contatar agora?" |
| Modo assistido | `MessageMode.ASSISTED` | O sistema prepara; o humano envia no app; o sistema registra |
| Transferência | `Opportunity` (handoff) | Passagem do lead qualificado ao Comercial |

## Como rodar localmente

**Pré-requisitos:** Node.js 22 (`.nvmrc`), pnpm 10 (`npm i -g pnpm@10.28.0` ou `corepack enable`) e Docker (ou um PostgreSQL 16+ local).

```bash
# 1. Variáveis de ambiente
cp .env.example .env
# Gere os segredos e cole no .env: BETTER_AUTH_SECRET, ENCRYPTION_KEY, SUPPRESSION_HASH_PEPPER
openssl rand -base64 32

# 2. PostgreSQL 17 + Mailpit (e-mails de teste em http://localhost:8025)
docker compose up -d
# Para ver os convites no Mailpit, use no .env: EMAIL_PROVIDER=smtp

# 3. Dependências (gera o cliente Prisma) e banco
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm db:seed:dev   # opcional: ~2.000 empresas fictícias para testar a interface

# 4. Primeiro administrador: imprime o link para definir a senha
pnpm admin:create --email voce@docline.com.br --name "Seu Nome"

# 5. Web (http://localhost:3000) + worker
pnpm dev
```

### Comandos úteis

| Comando | O que faz |
|---|---|
| `pnpm dev` | Web e worker em modo desenvolvimento |
| `pnpm check` | Lint + formatação + tipos + testes unitários |
| `pnpm test` / `pnpm test:int` | Testes unitários / de integração (banco `*_test`, recriado a cada execução) |
| `pnpm --filter @docline/web build && pnpm test:e2e` | Build de produção + jornadas E2E (Playwright) |
| `pnpm db:migrate` / `pnpm db:deploy` | Criar/aplicar migrações (dev) / aplicar migrações (deploy) |
| `pnpm db:check` | Falha se o schema mudou sem migração |
| `pnpm db:seed` | Dados de referência (idempotente) |
| `pnpm db:seed:dev` | ~2.000 empresas fictícias com duplicados propositais (só `APP_ENV=development`; não roda duas vezes) |
| `pnpm admin:create` | Cria usuário por linha de comando (bootstrap) |

Os testes de integração e E2E **apagam** o banco apontado por `DATABASE_URL_TEST` e se recusam a rodar se o nome não terminar em `_test`.

### Deploy

- **Imagem:** `Dockerfile` (uma imagem; o comando define o papel: `docker/start-web.sh` ou `docker/start-worker.sh`).
- **Render (staging):** `render.yaml` cria PostgreSQL, web (com health check em `/api/health` e migrações no pre-deploy) e worker. Instruções no topo do arquivo.
- **CI:** `.github/workflows/ci.yml` roda lint, tipos, testes (unitários, integração, E2E), checagem de migrações, auditoria de dependências, varredura de segredos e build da imagem.

## Próximo passo recomendado

1. **Aprovar a Fase 2 — CRM de leads** ([backlog F2](docs/ROADMAP.md#fase-2--crm-de-leads)): cadastro de leads, pessoas e pontos de contato, filtros com contagem prévia, timeline e a base de conformidade (Lista Não Contatar, base legal por canal).
2. **Pendências da Docline que já afetam o projeto:** conta na Render e credenciais de e-mail para o staging, cláusulas-padrão de transferência internacional no DPA da Render, verificação na Meta, validação jurídica LGPD e estrutura (só as colunas) das planilhas atuais. Lista completa em [ARCHITECTURE §16](docs/ARCHITECTURE.md#16-questões-em-aberto) e [ROADMAP §7](docs/ROADMAP.md#7-dependências).
