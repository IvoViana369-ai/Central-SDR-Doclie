# Docline SDR — Central Inteligente de Prospecção

Central operacional de prospecção B2B da **Docline Tecnologia**, começando pelos escritórios de contabilidade, contadores e parceiros indicadores.

> **Status: Fases 1 a 8 concluídas — MVP, WhatsApp e Instagram oficiais prontos no código.**
> - **Fase 1 (fundação técnica):** acesso por convite, perfis e permissões, auditoria imutável, fila de jobs, CI e deploy em Docker.
> - **Fase 2 (CRM de leads):** cadastro com aviso de duplicidade, lista com filtros e ações em massa, detalhe com timeline, Lista Não Contatar e opt-out, exportação auditada, 2FA, limite de login por conta e Sentry opcional.
> - **Fase 3 (importação e deduplicação):** importação de CSV/XLSX com mapeamento, prévia e relatório; normalização completa (telefone, CNPJ alfanumérico, cidades do IBGE…); detecção de duplicados com fila de revisão e mesclagem campo a campo, sem exclusão.
> - **Fase 4 (pipeline SDR):** Kanban com as 17 etapas, regras de movimentação, motivo de perda e histórico com duração; lista por etapa no celular; lead scoring explicável, com versões, simulação e cidades prioritárias.
> - **Fase 5 (fila e follow-ups):** Minha Fila SDR com prioridade e ações rápidas; cadência D0/D2/D5/D10 configurável, em dias úteis e com parada automática; contato assistido (`wa.me`, Instagram, e-mail, `tel:`) com confirmação de envio; registro de respostas com detecção de opt-out; limites de horário e de frequência; transferência ao Comercial com checklist; avisos no app.
> - **Fase 6 (IA e fechamento do MVP):** "Gerar com IA" no contato assistido, com avisos, edição, aprovação humana e envio assistido; guardrails e cotas; sugestão de classificação de respostas; base de conhecimento, abordagens e custos da IA; avaliação offline com rubrica; dashboard e relatórios com exportação; teste de desempenho com 100 mil leads. A IA real fica desligada (`AI_PROVIDER=fake`) até a decisão da Docline.
> - **Fase 7 (WhatsApp oficial):** envio pela WhatsApp Cloud API (modelos aprovados e texto livre na janela de 24 h), status de entrega e leitura e respostas por webhook assinado, opt-in por número com evidência, tela Conversas com os números sem lead, modelos ligados às abordagens, saúde do número e custo estimado. Sem reenvio automático e sem criar leads sozinho. A API fica desligada (`WHATSAPP_PROVIDER=assisted`) até a conta da Meta e o parecer jurídico; para homologar, `fake` + `pnpm whatsapp:simulate`.
> - **Fase 8 (Instagram oficial):** mensagens e comentários da conta da Docline por webhook assinado, resposta pela API só a quem escreveu (24 h) e resposta privada a comentários (uma por comentário, até 7 dias), ecos do que a equipe respondeu pelo app, "Quem não é lead" em Conversas e métricas públicas dos perfis (Business Discovery) para o critério "Instagram ativo" do score. O primeiro contato continua assistido. Desligada (`INSTAGRAM_PROVIDER=assisted`) até o App Review da Meta e o parecer jurídico; para homologar, `fake` + `pnpm instagram:simulate`.
>
> **Pendências para o piloto:** staging na Render (conta e credenciais da Docline), DSN do Sentry, validação jurídica, transferência internacional e decisão sobre ligar a IA. O caminho até o go-live está em [docs/GO-LIVE.md](docs/GO-LIVE.md).
>
> **Próximo:** UAT e go-live do piloto no modo assistido; ativação do WhatsApp e do Instagram pela API (marcos M5 e M5b); depois, Fase 9 (dados abertos do CNPJ e prospecção). Histórico em [CHANGELOG.md](CHANGELOG.md).

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
| [docs/GO-LIVE.md](docs/GO-LIVE.md) | Roteiro de UAT, treinamento, importação da base real, go-live do piloto e volta à planilha |
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
| Contato no MVP | **Modo assistido** (`wa.me`/Instagram aberto pelo SDR, envio humano, registro no sistema). WhatsApp Cloud API (Graph API direta, versão fixada) na Fase 7, só com opt-in ou janela aberta; Instagram API (Facebook Login) na Fase 8, só respondendo a quem escreveu ou comentou | Fases 5–8 |
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
apps/worker            Jobs pg-boss (heartbeat, importação, deduplicação; depois cadência…)
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
| `pnpm ai:eval` | Avaliação offline da IA com o conjunto fictício (provedor falso por padrão; real só com `--yes`) — [AI-SDR §14](docs/AI-SDR.md#14-avaliação-de-qualidade) |
| `pnpm whatsapp:simulate` | Simula webhooks da Meta contra o servidor local (`resposta --de … --texto …`, `status --status delivered`); só com `WHATSAPP_PROVIDER=fake` — [INTEGRATIONS §6.2](docs/INTEGRATIONS.md#6-whatsapp) |
| `pnpm instagram:simulate` | Simula webhooks do Instagram contra o servidor local (`mensagem --de @perfil --texto …`, `comentario`, `eco`, `visto`); só com `INSTAGRAM_PROVIDER=fake` — [INTEGRATIONS §7.2](docs/INTEGRATIONS.md#7-instagram) |
| `pnpm perf:100k` | Teste de desempenho com 100 mil leads fictícios num banco próprio (`DATABASE_URL_PERF`, nome terminado em `_perf`, recriado do zero) — [ARCHITECTURE §13](docs/ARCHITECTURE.md#13-escalabilidade) |

Os testes de integração e E2E **apagam** o banco apontado por `DATABASE_URL_TEST` e se recusam a rodar se o nome não terminar em `_test`.

### Deploy

- **Imagem:** `Dockerfile` (uma imagem; o comando define o papel: `docker/start-web.sh` ou `docker/start-worker.sh`).
- **Render (staging):** `render.yaml` cria PostgreSQL, web (com health check em `/api/health` e migrações no pre-deploy) e worker. Instruções no topo do arquivo.
- **CI:** `.github/workflows/ci.yml` roda lint, tipos, testes (unitários, integração, E2E), checagem de migrações, auditoria de dependências, varredura de segredos e build da imagem.

## Próximo passo recomendado

1. **Piloto (F6-11):** seguir o [roteiro de go-live](docs/GO-LIVE.md): staging na Render, validação jurídica, UAT com 1–2 SDRs e o gestor, treinamento, importação da base real em produção e decisão sobre ligar a IA real (com a avaliação offline e o DPA do provedor). O piloto começa no modo assistido.
2. **WhatsApp pela API (marco M5):** a Docline inicia já a verificação da empresa na Meta, a WABA, o número dedicado e os modelos de prospecção; para ligar, seguir o [checklist de ativação](docs/INTEGRATIONS.md#161-ativar-o-whatsapp-pela-api-cloud-api) e a [homologação W1–W7](docs/GO-LIVE.md#11-whatsapp-pela-api-marco-m5).
3. **Aprovar a Fase 8 — Instagram** ([backlog F8](docs/ROADMAP.md#fase-8--instagram)): DMs recebidas e comentários por webhook, resposta dentro da janela permitida e Business Discovery. Depende de conta profissional e App Review da Meta, que podem começar em paralelo.
4. **Pendências da Docline que já afetam o projeto:** conta na Render e credenciais de e-mail para o staging, cláusulas-padrão de transferência internacional no DPA da Render, verificação na Meta, validação jurídica LGPD e estrutura (só as colunas) das planilhas atuais. Lista completa em [ARCHITECTURE §16](docs/ARCHITECTURE.md#16-questões-em-aberto) e [ROADMAP §7](docs/ROADMAP.md#7-dependências).
