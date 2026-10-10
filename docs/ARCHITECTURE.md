# Arquitetura — Docline SDR

> **Status:** aprovada; Fases 1 a 6 implementadas (MVP), Fase 7 (WhatsApp Cloud API), Fase 8 (Instagram API), Fase 9 (dados abertos do CNPJ e Prospecção) e Fase 10 (Campanhas) · **Última revisão:** 2026-10-10
> Documentos relacionados: [DATABASE](./DATABASE.md) · [MVP](./MVP.md) · [ROADMAP](./ROADMAP.md) · [INTEGRATIONS](./INTEGRATIONS.md) · [SECURITY](./SECURITY.md) · [LGPD](./LGPD.md) · [SDR-FLOW](./SDR-FLOW.md) · [AI-SDR](./AI-SDR.md)

## Sumário

1. [Análise dos requisitos](#1-análise-dos-requisitos)
2. [Conflitos e pontos de atenção encontrados](#2-conflitos-e-pontos-de-atenção-encontrados)
3. [Drivers arquiteturais](#3-drivers-arquiteturais)
4. [Análise da stack](#4-análise-da-stack)
5. [Visão geral da arquitetura](#5-visão-geral-da-arquitetura)
6. [Módulos de domínio](#6-módulos-de-domínio)
7. [Padrões transversais](#7-padrões-transversais)
8. [Fluxo principal ponta a ponta](#8-fluxo-principal-ponta-a-ponta)
9. [APIs internas](#9-apis-internas)
10. [Jobs assíncronos (worker)](#10-jobs-assíncronos-worker)
11. [Estrutura de pastas](#11-estrutura-de-pastas)
12. [Estratégia de testes](#12-estratégia-de-testes)
13. [Escalabilidade](#13-escalabilidade)
14. [Implantação, ambientes e custos](#14-implantação-ambientes-e-custos)
15. [Registro de decisões (ADRs)](#15-registro-de-decisões-adrs)
16. [Questões em aberto](#16-questões-em-aberto)

---

## 1. Análise dos requisitos

### 1.1 O que estamos construindo

Um **sistema operacional de prospecção B2B**, não uma ferramenta de disparo. O valor está em quatro capacidades combinadas:

| Capacidade | Requisitos de origem | Consequência arquitetural |
|---|---|---|
| **Base de leads confiável** | Importação, normalização, deduplicação, origem, histórico (§4–8) | Pipeline de dados com prévia, regras puras testáveis, nunca exclusão automática |
| **Operação diária do SDR** | Pipeline, fila, cadência, follow-up, timeline, mobile (§11–13, 18, 30) | UI rápida, tarefas geradas por regras configuráveis, eventos de tudo |
| **Contato responsável** | WhatsApp, Instagram, opt-out, LGPD (§14, 15, 25) | Um único *gate* de contactabilidade, integrações oficiais, modo assistido |
| **Inteligência comercial** | Scoring, IA, dashboard, campanhas, diferencial futuro (§10, 16, 21, 22, 39) | Modelo orientado a eventos e atribuição (abordagem/canal/campanha) desde o 1º dia |

### 1.2 Requisitos não funcionais derivados

| Atributo | Meta inicial | Observação |
|---|---|---|
| Conformidade | 0 contatos a identificadores na Lista Não Contatar | Verificado no código **e** em testes automatizados |
| Rastreabilidade | 100% das mudanças relevantes geram evento/auditoria | Timeline e auditoria são *append-only* |
| Velocidade operacional | p95 < 300 ms em ações comuns; < 800 ms em listas filtradas com 100 mil leads | Paginação por cursor, índices dedicados |
| Custo inicial | 1 serviço web + 1 worker + 1 PostgreSQL | Sem Redis, sem Elasticsearch, sem Kubernetes |
| Escalabilidade | 500 mil leads sem reescrita | Ver [§13](#13-escalabilidade) |
| Evolutividade | Trocar fornecedor de integração sem tocar no domínio | Portas e adaptadores ([§7.1](#71-portas-e-adaptadores-integrações)) |
| Testabilidade | Regras críticas (normalização, dedup, score, cadência, opt-out) como funções puras | Cobertura alta no núcleo |
| Usabilidade móvel | Fluxos essenciais do SDR no celular | Responsivo; ver [MVP §7](./MVP.md#7-telas-do-mvp) |

### 1.3 Perfis de usuário

| Perfil | Uso principal |
|---|---|
| **ADMINISTRADOR** | Configurações (pipeline, score, cadência, integrações), usuários, conformidade |
| **GESTOR** | Acompanhamento da equipe, distribuição, relatórios, campanhas, decisões de duplicados |
| **SDR** | Fila diária, prospecção, follow-up, qualificação, transferência |
| **COMERCIAL** | Recebe oportunidades transferidas, negocia, registra conversão |

---

## 2. Conflitos e pontos de atenção encontrados

A análise encontrou pontos em que um requisito, se implementado literalmente, entraria em conflito com políticas de plataforma, com a lei ou com outro requisito. Cada um tem uma proposta de tratamento.

| # | Ponto | Por que importa | Proposta |
|---|---|---|---|
| A1 | **WhatsApp exige opt-in para mensagens iniciadas pela empresa.** A política de mensagens do WhatsApp Business exige que o destinatário tenha fornecido o número **e** dado permissão (opt-in) para receber mensagens da empresa no WhatsApp. | Prospecção "fria" via WhatsApp Business Platform (API) para leads encontrados no Google viola a política e pode derrubar o número/conta. | Separar **base legal LGPD** de **opt-in WhatsApp** no modelo de dados. A API só envia a quem tem opt-in registrado. Para o primeiro contato sem opt-in: **modo assistido** (humano, 1 a 1, com limites) ou outros canais. Ver [INTEGRATIONS §6](./INTEGRATIONS.md#6-whatsapp) e [LGPD §6](./LGPD.md#6-whatsapp-base-legal-lgpd--opt-in-da-meta). |
| A2 | **A API do Instagram não permite iniciar conversas por DM.** A API de mensagens só responde a quem escreveu primeiro, dentro da janela permitida. | Requisito §15 já prevê isso; precisamos de fluxo assistido desde o MVP. | DM fria = ação humana no app do Instagram, registrada na plataforma. API (Fase 8) só para receber/responder mensagens e comentários. |
| A3 | **Os Termos da Google Maps Platform restringem armazenar conteúdo do Places** (nome, endereço, telefone, avaliações). Em regra, só o `place_id` pode ser guardado indefinidamente. | Os campos "nota Google" e "quantidade de avaliações" e a "prospecção via Google" (§9) não podem virar uma base permanente copiada do Google. | Google como **ferramenta de descoberta e apoio**: guardar `place_id`, exibir dados ao vivo com atribuição. **Fonte primária proposta para descoberta:** dados abertos do CNPJ da Receita Federal (CNAE 6920-6/01 e 6920-6/02). Critérios de score baseados em Google ficam **desligados até validação jurídica**. Ver [INTEGRATIONS §8](./INTEGRATIONS.md#8-google). |
| A4 | **A soma dos pesos do score de exemplo é 140**, mas a escala é 0–100. | Sem regra explícita, as faixas ficam inconsistentes. | O modelo de score tem uma estratégia de normalização configurável (`CLAMP` limita em 100; `SCALE` faz proporção). Padrão: `CLAMP`. |
| A5 | **"Follow-up 1/2/3" como etapas do pipeline** misturam "onde o lead está no funil" com "em que passo da cadência ele está". | Mover cards à mão desincroniza a cadência. | Manter as 17 etapas pedidas (seed), mas **quem move entre Primeiro contato → FU1 → FU2 → FU3 → Sem resposta é o motor de cadência**, via chaves estáveis (`stage.key`). Alternativa futura: uma etapa "Em cadência" com selo "FU 2/3". Decisão pendente com o negócio. |
| A6 | **"Não contatar" como tag** (§19). | Uma tag pode ser removida por engano e não protege o mesmo telefone em outro lead. | "Não contatar" é **mecanismo de conformidade** (Lista Não Contatar por identificador), exibido como selo do sistema, nunca como tag editável. |
| A7 | **"WhatsApp identificado"** não pode ser verificado pela API oficial antes do contato. | Celular ≠ WhatsApp. | Estados `UNKNOWN` / `PROBABLE` (declarado pela fonte) / `CONFIRMED` (houve conversa) / `NOT_ON_WHATSAPP`. |
| A8 | **CNPJ alfanumérico.** Desde julho/2026 a Receita emite CNPJs com letras nas 12 primeiras posições (IN RFB 2.229/2024). | Validação só numérica rejeitaria CNPJs válidos e quebraria a deduplicação. | Campo `varchar(14)` em maiúsculas; validação de DV com o novo algoritmo (valor ASCII − 48) desde a Fase 3. |
| A9 | **Números brasileiros e o 9º dígito no WhatsApp.** O `wa_id` que chega nos webhooks pode vir sem o 9º dígito em números antigos. | Uma resposta recebida pode não ser associada ao lead certo. | Ao casar números, comparar as duas variantes (com e sem 9º dígito) para celulares BR. |
| A10 | **"Serviço independente" de IA** (§16). | Um microsserviço separado no MVP adiciona deploy, rede e custo sem ganho imediato. | Módulo `ai-sdr` isolado com contrato próprio (porta `AiProvider` + API interna), rodando no monólito; extraível depois sem mudar os consumidores. |
| A11 | **Dados de terceiros na IA.** Bio do Instagram, texto de site e mensagens recebidas podem conter instruções maliciosas (*prompt injection*). | A IA poderia gerar conteúdo indevido. | Dados externos são tratados como dados, nunca como instrução; saída validada; aprovação humana obrigatória. Ver [AI-SDR §9](./AI-SDR.md#9-guardrails). |

---

## 3. Drivers arquiteturais

Em ordem de prioridade, para desempate de decisões:

1. **Conformidade e confiança** — nenhuma decisão de produtividade passa por cima de opt-out, base legal ou política de plataforma.
2. **Simplicidade operacional** — poucos componentes, um banco, um idioma de programação.
3. **Velocidade do SDR** — a ferramenta precisa ser mais rápida que a planilha + WhatsApp Web que ela substitui.
4. **Rastreabilidade** — toda ação gera evento; métricas vêm de eventos, não de contadores soltos.
5. **Evolutividade** — integrações e regras de negócio trocáveis sem reescrever o domínio.

---

## 4. Análise da stack

A preferência inicial foi avaliada item a item. Onde a recomendação diverge, a justificativa está explícita.

| Função | Preferência inicial | Recomendação | Justificativa |
|---|---|---|---|
| Frontend | Next.js + React + TypeScript | ✅ **Manter** (App Router, versão estável mais recente) | Ecossistema maduro, Server Components para telas de leitura, um só idioma no projeto inteiro. |
| Backend | Node.js / TypeScript | ✅ **Manter**, como **API dentro do Next.js (route handlers) + processo worker separado** | Uma API separada (NestJS/Fastify) dobraria deploys e contratos no MVP. O domínio fica em `packages/core`, independente de framework: se a API precisar ser extraída, extrai-se a casca, não as regras. |
| Banco | PostgreSQL | ✅ **Manter** | Relacional, transacional, JSONB, busca textual, `pg_trgm` para similaridade de nomes, particionamento para crescer. Cobre fila, busca e dedup sem serviços extras. |
| ORM | Prisma ou alternativa | ✅ **Prisma**, com SQL tipado (`TypedSQL` / `$queryRaw` com `Prisma.sql`) para analytics e deduplicação | Migrações maduras e boa DX para a equipe. **Drizzle** foi considerado (mais próximo do SQL, melhor para recursos específicos do Postgres); a diferença não justifica fugir da preferência. Índices trigram e partições entram como SQL nas migrações. |
| Filas | Redis / BullMQ | ⚠️ **Substituir no MVP por `pg-boss`** (fila sobre o próprio PostgreSQL) | O volume de jobs de um time de SDR (milhares/dia) é pequeno. `pg-boss` tem retentativas, agendamento cron, *dead letter* e enfileiramento **na mesma transação** do dado de negócio, sem um Redis para pagar, monitorar e fazer backup. A interface `JobQueue` permite migrar para BullMQ se um dia for necessário. |
| Automação | n8n | ⚠️ **Somente nas bordas** (Fase 12) | Regra de negócio no n8n fica fora do Git, dos testes e da auditoria. n8n pode orquestrar integrações com sistemas Docline consumindo a nossa API, nunca decidir quem é contatado. |
| Interface | Tailwind CSS + componentes reutilizáveis | ✅ **Tailwind + shadcn/ui (Radix)**, TanStack Table (grade de leads), dnd-kit (Kanban), Recharts (gráficos), React Hook Form + Zod | shadcn/ui gera componentes acessíveis que ficam no nosso código, sem dependência de biblioteca fechada. |
| Infra | Docker | ✅ **Manter**: `docker compose` no desenvolvimento e um Dockerfile por app | Portabilidade entre Render e qualquer outro provedor. |
| Deploy | Render | ✅ **Decidido: Render, região Virginia** ([ADR-019](#15-registro-de-decisões-adrs)) | Simples e barato (web service + background worker + Postgres gerenciado). **Ressalva:** a Render não tem região no Brasil; hospedar fora exige tratamento de transferência internacional (LGPD art. 33). Alternativas com São Paulo avaliadas: Google Cloud `southamerica-east1`, Fly.io `gru`, AWS `sa-east-1`. |
| Autenticação | (não especificado) | **Better Auth** (e-mail/senha, sessões no banco, adaptador Prisma, 2FA por plugin) + **RBAC próprio no domínio** | Auth.js tem suporte fraco a login por senha; Clerk é pago e leva dados de usuários para fora. Better Auth é open source e roda no nosso banco. Permissões ficam no nosso código, testadas ([SECURITY §4](./SECURITY.md#4-autorização-rbac)). |
| Planilhas | — | ~~ExcelJS~~ **leitor próprio de XLSX** (fflate + saxes, ADR-020) + **Papa Parse** (CSV), com detecção de codificação | O pacote `xlsx` publicado no npm está desatualizado e tem vulnerabilidades conhecidas (as versões novas do SheetJS saem só pelo CDN do fornecedor). Exportações do Excel no Brasil costumam vir em Windows-1252 com `;`, o que precisa ser tratado. |
| Telefones | — | **libphonenumber-js** + regras BR próprias (DDD, 9º dígito, variantes `wa_id`) | Biblioteca de referência; regras brasileiras ficam em módulo próprio testado. |
| Busca | — | **PostgreSQL** (full-text + `pg_trgm`) | Elasticsearch/OpenSearch só se a busca virar gargalo, o que não se espera até 500 mil leads. |
| IA | `AI_API_KEY` | Porta `AiProvider` com adaptador padrão **Anthropic (Claude)** via SDK oficial; modelo configurável por variável de ambiente | Ver [AI-SDR §4](./AI-SDR.md#4-provedor-modelos-e-configuração). |
| Testes | — | **Vitest** + **fast-check** (testes de propriedade) + **Testcontainers/Postgres** (integração) + **Playwright** (E2E) + **MSW** (HTTP de adaptadores) | Ver [§12](#12-estratégia-de-testes). |
| Observabilidade | — | **pino** (logs estruturados com mascaramento de dados pessoais) + **Sentry** (erros) | Plano gratuito suficiente no início. |
| Monorepo | — | **pnpm workspaces** (sem Turborepo no início) | Dois apps e três pacotes não justificam um orquestrador de build. Turborepo entra se o build ficar lento. |
| E-mail transacional | — | Porta `EmailProvider` (SMTP/Resend/SES) | Convites e redefinição de senha. Não é canal de prospecção no MVP. |

### 4.1 Versões adotadas na Fase 1

Node.js 22 · pnpm 10.28 · TypeScript 6.0 · Next.js 16.3 (React 19.3) · Tailwind CSS 4 · Prisma 7.10 (gerador `prisma-client` + adaptador `pg`) · PostgreSQL 16/17 · Better Auth 1.7 · pg-boss 12 · Zod 4 · ESLint 10 · Vitest 5 · Playwright 1.63.

Ajustes em relação à análise acima, decididos durante a implementação:

- **TypeScript 6.0, não 7.x:** a versão 7 (compilador nativo) ainda não é suportada pelo typescript-eslint.
- **Next.js 16** renomeou o `middleware` para **`proxy`**; a CSP com nonce é aplicada ali (ADR-018).
- **Prisma 7** exige `prisma.config.ts` e adaptador de driver; o cliente é gerado em `packages/db/src/generated` (não versionado, gerado no `postinstall`).
- **Ponto de atenção (pg 9):** dentro de transações, o Prisma 7 com o adaptador `pg` carrega relações de um mesmo `select` em consultas paralelas na mesma conexão; o pg 8 as enfileira (resultado correto) e emite um aviso de *deprecation*. Antes de atualizar para o pg 9, avaliar `relationLoadStrategy: 'join'` (recurso `relationJoins`) nas leituras com muitas relações, como o detalhe do lead.
- **Índices parciais** (Fase 2) declarados no schema com o recurso `partialIndexes` do Prisma, ainda em *preview*: assim a checagem de drift do CI os cobre. Se o recurso mudar, a alternativa é SQL manual na migração, perdendo essa checagem.
- **Componentes de UI** escritos no próprio projeto sobre Radix (no estilo shadcn/ui), sem depender do gerador do shadcn.
- **Sentry (Fase 2, F2-17):** opcional, ativado por `SENTRY_DSN`. Usa `@sentry/node` 10 sem instrumentação automática, sem tracing e sem breadcrumbs: só envia o que a aplicação captura.
  - **Web:** erros 5xx da API v1 (`apiHandler`) e erros de páginas e server actions (`onRequestError` em `instrumentation.ts`), com `requestId` e rota.
  - **Worker:** falhas de job, com o nome do job; o pg-boss segue fazendo a retentativa.
  - **Sem dados pessoais:** nada de usuário, cookies, cabeçalhos ou corpo; e-mails e sequências de 8 ou mais dígitos viram marcadores em toda mensagem.
  - **Sem DSN:** nada é enviado, e os erros continuam nos logs pino com `requestId`.
- **IP do cliente:** lido só do `X-Forwarded-For`, com a lista `TRUSTED_PROXIES` (CIDR) definindo quais saltos são confiáveis; a mesma regra serve ao rate limit e à auditoria ([SECURITY §12](./SECURITY.md#12-limites-de-taxa-e-abuso)).
- **Cadeia de suprimentos:** `minimumReleaseAge` de 24 h no pnpm (já barrou uma versão publicada no mesmo dia) e sobrescritas de versão para dependências transitivas vulneráveis (`pnpm-workspace.yaml`).

---

## 5. Visão geral da arquitetura

**Estilo:** monólito modular em TypeScript, com núcleo de domínio independente de framework, integrações por **portas e adaptadores** e **eventos de domínio** como espinha dorsal de timeline, automação e analytics.

### 5.1 Contexto

```mermaid
flowchart LR
  SDR(["SDR"]) --> APP
  GES(["Gestor"]) --> APP
  COM(["Comercial"]) --> APP
  ADM(["Administrador"]) --> APP
  APP["Docline SDR<br/>Central de Prospecção"]
  APP --> META["Meta<br/>WhatsApp Cloud API / Instagram API<br/>(Fases 7–8)"]
  APP --> GOO["Google Places API<br/>(Fase 9, uso restrito)"]
  APP --> RFB["Receita Federal<br/>Dados abertos CNPJ (Fase 9)"]
  APP --> IBGE["IBGE Localidades<br/>(seed de municípios)"]
  APP --> AI["Provedor de IA<br/>(Fase 6)"]
  APP --> MAIL["E-mail transacional"]
  APP <--> CRM["CRM e sistemas Docline<br/>(Fase 12)"]
  N8N["n8n (opcional, bordas)"] <--> APP
```

### 5.2 Containers

```mermaid
flowchart TB
  subgraph CLIENT["Navegador — desktop, tablet, celular"]
    UI["UI Next.js<br/>React + Tailwind + shadcn/ui"]
  end
  subgraph WEB["apps/web — Next.js (Render Web Service)"]
    RSC["Server Components<br/>(telas de leitura)"]
    API["API REST /api/v1"]
    WH["Webhooks /api/webhooks/*"]
  end
  subgraph WORKER["apps/worker — Node (Render Background Worker)"]
    JOBS["Consumidores pg-boss<br/>importação, dedup, score, cadência,<br/>webhooks, rollups, retenção"]
  end
  CORE["packages/core<br/>domínio + casos de uso"]
  INT["packages/integrations<br/>adaptadores (whatsapp, instagram,<br/>google, ai, crm, enrichment, email)"]
  DB[("PostgreSQL<br/>dados + fila pg-boss + busca/trigram")]
  EXT["Serviços externos"]
  UI --> RSC
  UI --> API
  RSC --> CORE
  API --> CORE
  WH --> CORE
  JOBS --> CORE
  CORE --> DB
  CORE -- "chama via portas (interfaces)" --> INT
  INT --> EXT
```

**Por que dois processos?** O web atende requisições curtas. O worker executa o que é lento, agendado ou precisa de retentativa (importações grandes, varredura de duplicados, cadência, webhooks). Ambos usam o mesmo `packages/core`.

### 5.3 Camadas e regras de dependência

```
apps/web, apps/worker      → camada de entrega (HTTP, jobs). Sem regra de negócio.
packages/core              → domínio + casos de uso. Define PORTAS (interfaces).
packages/integrations      → ADAPTADORES que implementam as portas do core.
packages/db                → schema Prisma, migrações, seed, cliente.
```

Regras (validadas por lint com `eslint-plugin-boundaries` ou `dependency-cruiser`):

1. `core` **não importa** `integrations`, `next`, `react` nem SDKs de terceiros.
2. Chamadas externas existem **somente** em `packages/integrations`.
3. Um módulo do core só acessa outro pelo seu `index.ts` público, nunca por arquivos internos.
4. As funções puras de domínio (normalização, matching de duplicados, cálculo de score, calendário de cadência) não fazem I/O.
5. Todas as mutações passam por um caso de uso, que (a) autoriza, (b) valida, (c) persiste, (d) emite evento e (e) audita, na mesma transação.

---

## 6. Módulos de domínio

| Módulo | Responsabilidade | Entidades principais | Fase |
|---|---|---|---|
| `identity` | Usuários, equipes, sessões (via Better Auth), RBAC | users, teams | 1 |
| `audit` | Log imutável de mutações e eventos de segurança | audit_logs | 1 |
| `settings` | Configurações de negócio versionadas, visões salvas | app_settings, saved_views | 1 |
| `reference` | UFs, municípios IBGE, feriados, cidades prioritárias | states, municipalities, holidays, priority_cities | 1–2 |
| `leads` | Lead, pessoas, pontos de contato, origem, tags, observações, filtros | leads, lead_people, contact_points, lead_origins, tags, lead_notes | 2 |
| `timeline` | Eventos de domínio por lead (append-only) | lead_events | 2 |
| `normalization` | Funções puras de padronização | — | 3 |
| `import` | Upload, mapeamento, prévia, confirmação, relatório | import_batches, import_rows, import_mapping_templates | 3 |
| `dedup` | Detecção, revisão e mesclagem de duplicados | duplicate_candidates, lead_merges | 3 |
| `compliance` | Base legal, opt-in, Lista Não Contatar, *gate* de contactabilidade, direitos do titular, retenção | contact_permissions, suppression_entries, data_subject_requests, legal_basis_assessments, retention_policies | 2–5 (núcleo no MVP) |
| `scoring` | Modelos e regras de score versionados, cálculo explicável | scoring_models, scoring_rules, lead_score_history | 4 |
| `pipeline` | Etapas configuráveis, movimentação, histórico, motivos de perda | pipelines, pipeline_stages, lead_stage_history, loss_reasons | 4 |
| `distribution` | Atribuição de responsável (manual no MVP; estratégias depois) | lead_assignments, distribution_rules | 2 (manual) / futura |
| `tasks` | Atividades, follow-ups, "Minha Fila SDR" | tasks, activities | 5 |
| `cadence` | Cadências configuráveis, inscrição, avanço, parada automática | cadences, cadence_steps, cadence_enrollments | 5 |
| `messaging` | Mensagens assistidas e registradas, respostas e classificação | messages | 5 |
| `whatsapp` | Envio pela Cloud API (texto na janela, modelo com opt-in), webhooks (status, respostas), conversas, modelos, números sem lead, saúde do número | conversations, whatsapp_templates, message_status_events, webhook_events, inbound_unmatched, integration_connections | 7 |
| `instagram` | Respostas pela API (texto em 24 h, resposta privada a comentário em 7 dias), webhooks (mensagens, ecos, "visto", comentários), quem não é lead, conta conectada, métricas públicas dos perfis (Business Discovery) para o score | conversations, social_comments, instagram_profiles, webhook_events, inbound_unmatched, integration_connections | 8 |
| `ai-sdr` | Geração de abordagens, classificação de respostas, insights | ai_generations, ai_knowledge_items | 6 |
| `opportunities` | Qualificação, transferência ao Comercial, conversão | opportunities | 5–6 |
| `prospecting` | Carga mensal do recorte de contabilidade da base aberta do CNPJ, buscas com comparação com a base, aprovação humana de novos leads, potencial por cidade e enriquecimento pelo CNPJ | registry_ingestions, registry_companies, prospecting_searches, prospecting_results | 9 |
| `campaigns` | Retrato de um filtro de leads, elegibilidade com motivos, distribuição entre SDRs, liberação diária para a cadência (nunca envia), funil por janela de atribuição e teste A/B de abordagens | campaigns, campaign_sdrs, campaign_variants, campaign_leads | 10 |
| `analytics` | Indicadores, funis, rollups, insights | daily_metrics, insights | 6 (básico) / 11 |

Cada módulo segue o mesmo layout:

```
modules/<modulo>/
  domain/        # tipos, invariantes, funções puras (sem I/O)
  application/   # casos de uso: autorizam, validam, orquestram, emitem eventos
  infra/         # repositórios Prisma e consultas SQL
  contracts/     # schemas Zod de entrada/saída (compartilhados com a API e a UI)
  index.ts       # API pública do módulo
```

---

## 7. Padrões transversais

### 7.1 Portas e adaptadores (integrações)

O core declara interfaces (portas) como `MessagingProvider`, `AiProvider`, `PlaceSearchProvider`, `CompanyRegistryProvider`, `SocialProfileProvider`, `CrmProvider`, `EmailProvider` e `JobQueue`. `packages/integrations` implementa cada uma em uma ou mais variantes (`fake`, `assisted`, `meta_cloud`, `anthropic`…). Um **registro de provedores** escolhe a implementação pela variável de ambiente (`WHATSAPP_PROVIDER=assisted`). Em desenvolvimento e testes o padrão é sempre `fake` ou `assisted`, e **nenhuma mensagem real sai de um ambiente que não seja produção**. Detalhes em [INTEGRATIONS](./INTEGRATIONS.md).

### 7.2 Eventos de domínio, timeline e auditoria

- Todo caso de uso relevante emite **eventos de domínio** tipados (`lead.created`, `lead.stage_changed`, `message.sent`, `optout.registered`…).
- Eventos relacionados a um lead viram linhas em `lead_events`, a **timeline**: append-only, legível pelo SDR, base de analytics e do "SDR assistido por IA" futuro.
- Mutações de qualquer entidade geram `audit_logs` com o diff dos campos (quem, quando, de onde). A auditoria é técnica e de conformidade; a timeline é de negócio.
- Reações assíncronas (recalcular score, procurar duplicado, parar cadência) são **jobs enfileirados na mesma transação** que o dado (pg-boss com a conexão transacional, ou tabela *outbox*). Assim nenhum evento se perde e nenhum job roda sobre dado que sofreu rollback.

### 7.3 Gate de contactabilidade

Um único serviço, `ContactabilityService.check(lead, channel, mode)`, responde **"posso contatar este lead neste canal, deste modo, agora?"** com `{ allowed, reasons[] }`. Ele considera Lista Não Contatar, base legal, opt-in do canal, status do ponto de contato, cadência ativa, limites de frequência e horário permitido. É chamado:

1. pela UI, para desabilitar botões e explicar o motivo;
2. pelo `ai-sdr`, antes de gerar mensagem;
3. pelo `messaging`, antes de registrar ou enviar;
4. pelos **adaptadores de envio** de novo, como defesa em profundidade;
5. pelo `campaigns`, para calcular elegibilidade (Fase 10): o gate devolve, junto com os textos, **códigos de motivo** (`GateReasonCode`), que a campanha traduz nos seus motivos de inelegibilidade. A campanha usa o modo assistido e ignora o horário (vale na hora de cada contato); a liberação para a cadência confere tudo de novo.

### 7.4 Configuração de negócio versionada

Etapas do pipeline, regras de score, cadências, palavras-chave de opt-out, horários permitidos e cidades prioritárias ficam **no banco**, editáveis pelo administrador. Mudanças estruturais (modelo de score, cadência) geram **nova versão**; registros antigos guardam a versão usada, o que mantém a análise histórica correta.

### 7.5 Autorização

`authorize(actor, action, resource)` roda no caso de uso, nunca só na UI. Escopos por perfil e matriz de permissões em [SECURITY §4](./SECURITY.md#4-autorização-rbac). Toda consulta de lista aplica o escopo do ator, o que previne IDOR.

### 7.6 Idempotência e concorrência

- `Idempotency-Key` em criações sensíveis (mensagens, importações, mesclagens).
- Coluna `version` em `leads` (lock otimista) para movimentação no Kanban e edição concorrente.
- Webhooks e jobs são idempotentes por chave natural (id do evento do provedor, id do job).

### 7.7 Tempo, fuso e calendário

Datas em UTC (`timestamptz`). Exibição no fuso do usuário (padrão `America/Fortaleza`). A cadência respeita **dias úteis, feriados e janela de horário no fuso do lead**, derivado da UF.

### 7.8 Erros, logs e observabilidade

- Erros de domínio tipados (`NotFound`, `Forbidden`, `ValidationFailed`, `ContactNotAllowed`, `Conflict`) mapeados para `application/problem+json` (RFC 9457).
- Logs estruturados (pino) com `requestId`/`jobId`, e **mascaramento** de telefone, e-mail e tokens.
- Sentry para exceções; `/api/health` para *health checks*; métricas de jobs (falhas, atraso da fila).

---

## 8. Fluxo principal ponta a ponta

```mermaid
sequenceDiagram
  autonumber
  actor SDR
  participant UI as UI Web
  participant API as API /api/v1
  participant Core as Core (casos de uso)
  participant Q as Fila pg-boss
  participant W as Worker
  participant AI as AiProvider
  SDR->>UI: Envia planilha e mapeia colunas
  UI->>API: POST /imports e PUT /imports/{id}/mapping
  API->>Q: import.preview
  W->>Core: normaliza, valida, casa com a base e com a Lista Não Contatar
  SDR->>UI: Revisa a prévia e confirma
  UI->>API: POST /imports/{id}/commit
  API->>Q: import.commit
  W->>Core: cria leads, eventos, candidatos a duplicado, score
  SDR->>UI: Abre Minha Fila e escolhe um lead
  UI->>API: POST /ai/generations
  API->>Core: gate de contactabilidade e montagem do contexto
  Core->>AI: gerar mensagem (saída estruturada)
  AI-->>Core: rascunho e metadados
  Core-->>UI: rascunho validado pelos guardrails
  SDR->>UI: Edita e aprova
  SDR->>UI: Abrir no WhatsApp (modo assistido) e confirmar envio
  UI->>API: POST /messages/{id}/confirm-sent
  API->>Core: registra mensagem, inscreve na cadência, move a etapa
  W->>Core: cadence.tick gera tarefas de follow-up
  SDR->>UI: Registra resposta do lead
  UI->>API: POST /leads/{id}/messages/inbound
  API->>Core: classifica, para a cadência, move para Respondeu ou Interessado
  SDR->>UI: Qualifica e transfere ao Comercial
  UI->>API: POST /leads/{id}/handoff
```

Cada etapa do fluxo de negócio (captação → conversão) está detalhada, com eventos e critérios, em [SDR-FLOW](./SDR-FLOW.md).

---

## 9. APIs internas

### 9.1 Convenções

| Tema | Convenção |
|---|---|
| Base | `/api/v1` (REST, JSON). Contrato único para a UI e futuras integrações (n8n, sistemas Docline). |
| Autenticação | Cookie de sessão (UI). Fase 12: chaves de API com escopos (`Authorization: Bearer`). |
| Validação | Zod na borda; os mesmos schemas tipam o cliente da UI. |
| Erros | `application/problem+json` com `type`, `title`, `status`, `detail`, `code`, `errors[]`. |
| Paginação | Por cursor: `?cursor=…&limit=50` → `{ data, nextCursor }`. Nunca `OFFSET` em listas grandes. |
| Filtros complexos | `POST /leads/search` com corpo em DSL de filtros (abaixo). Campos e operadores vêm de uma *whitelist*. |
| Contagem prévia | `POST /leads/count` com o mesmo filtro, retorna total e quebra por contactabilidade. Toda ação em massa exige `dryRun` antes. |
| Concorrência | `version` no corpo de `PATCH` e de movimentação de etapa; conflito → `409`. |
| Idempotência | Cabeçalho `Idempotency-Key` em criações sensíveis. |
| Datas | ISO 8601 em UTC. |
| Documentação | OpenAPI gerado a partir dos schemas Zod (Fase 2+). |

Exemplo da DSL de filtros (§20 dos requisitos):

```json
{
  "all": [
    { "field": "state", "op": "eq", "value": "CE" },
    { "field": "city", "op": "in", "value": ["Sobral"] },
    { "field": "segment", "op": "eq", "value": "contabilidade" },
    { "field": "hasWhatsapp", "op": "eq", "value": true },
    { "field": "stage", "op": "eq", "value": "NEW" },
    { "field": "origin", "op": "eq", "value": "GOOGLE" },
    { "field": "score", "op": "gt", "value": 60 }
  ]
}
```

Grupos `all` e `any` podem ser aninhados. O servidor compila a DSL para `where` do Prisma ou SQL parametrizado, nunca concatenando texto.

### 9.2 Endpoints por módulo

> **Implementado até a Fase 5** (`apps/web/src/app/api/v1`): identidade e auditoria (Fase 1); leads (`search`, `count`, `check-duplicates`, cadastro, detalhe, edição, `archive` e **`unarchive`**, `timeline`, `history`, notas, pessoas, contatos, tags, `assign`, **`claim`** — SDR assume do pool —, `contactability`, `opt-out`, `permissions/{channel}`, `anonymize`, `bulk`); `tags`, `lead-sources`, `segments`, **`states`** e **`municipalities?q=`** (autocompletar); `users/{id}/territories`; `saved-views`; `suppressions` (+ `revoke`); `data-subject-requests`; **`legal-basis-assessments`** (Fase 2); importação (`imports`: upload multipart, lote, `mapping`, `preview`, `rows/{rowId}`, **`decisions`** — mesma decisão para todas as linhas de uma situação —, `commit`, `report` e **`cancel`**) e duplicados (`duplicates`, comparação, `merge`, `keep-separate`, `ignore` e `scan`), na Fase 3. Em negrito, rotas que não estavam na lista abaixo. Possível duplicado no cadastro responde `409` com `code: POSSIBLE_DUPLICATE` e a lista em `duplicates`. O upload confere o tamanho antes de ler o corpo; `commit` e `scan` respondem `202` (o trabalho segue no worker). **`POST /exports`** devolve o CSV na própria resposta (`text/csv`, separador `;`, BOM UTF-8). Erros possíveis: `429 RATE_LIMITED` (5 exportações em 24 h) e `422` (seleção vazia ou acima de 20.000 leads). Não implementadas: `/import-mapping-templates` (o modelo é salvo no `mapping` e sugerido pelo cabeçalho) e `/normalize/preview` (a prévia da importação cobre).
>
> **Fase 4:** `GET /pipelines`, `GET /pipelines/{id}` e `PUT /pipelines/{id}/stages` (`default` aponta para o pipeline padrão); `POST /pipelines/{id}/board` e **`POST /pipelines/{id}/board/cards`** (próxima página de uma coluna); `POST /leads/{id}/stage` (com `version`; conflito → `409`), `GET /leads/{id}/stage-history`, **`GET /leads/{id}/score`** (explicação por critério e histórico) e **`GET /loss-reasons`**; `GET /scoring/models/active`, **`GET /scoring/models`**, `POST /scoring/models` (abre o rascunho ou devolve o aberto), **`PUT` e `DELETE /scoring/models/{id}`** (salvar e descartar o rascunho), `simulate` e `activate`; **`GET/POST /priority-cities`** e **`DELETE /priority-cities/{code}`**. O quadro é `POST`, e não `GET`, porque recebe a mesma seleção da lista de leads (DSL e busca) no corpo.
>
> **Fase 5:** `GET /queue` (Minha Fila; `?userId=` para gestor e ADMIN); `POST /tasks`, `PATCH /tasks/{id}` (reagendar) e `POST /tasks/{id}/complete|cancel|skip` (pular passo de cadência); `GET /leads/{id}/tasks`; `POST /leads/{id}/activities`; `POST /leads/{id}/messages/assisted` (prepara o envio assistido e devolve o link), `POST /leads/{id}/messages/logged` (envio feito fora do sistema), `GET /leads/{id}/messages`, **`GET /messages?view=pending|sent|replies|unclassified`** e `POST /messages/{id}/confirm|cancel|classify`; `POST /leads/{id}/replies` (resposta recebida, com a detecção de opt-out); `GET/POST /leads/{id}/cadence` e `POST /leads/{id}/cadence/pause|resume|stop`; `GET/POST /cadences` (`?all=1` inclui as inativas), `PUT /cadences/{id}` e **`POST /cadences/{id}/default`**; `POST /leads/{id}/handoff`, `GET /leads/{id}/opportunities`, **`GET /opportunities`** e `POST /opportunities/{id}/accept|won|lost`; **`GET /sales-owners`**; **`GET /notifications`** e **`POST /notifications/read`**; `GET/PUT /settings/contact-rules`; **`POST /leads/pull`** (puxar do pool do território). As rotas seguem o recurso do lead em vez de `/enrollments/{id}` e `/messages/inbound`, porque cada lead tem no máximo uma inscrição em andamento e a resposta sempre pertence a um lead. Ficam para a Fase 6: `/message-templates`, `/approaches` e `/ai/*`.
>
> **Fase 7 (WhatsApp Cloud API):** `GET /leads/{id}/whatsapp` (números com opt-in e janela, gate do modo API, conversa e modelos liberados), `POST /leads/{id}/whatsapp/messages` (`kind: text` na janela ou `kind: template` com opt-in; responde `202`, o worker envia), `POST /leads/{id}/whatsapp/opt-in` e `/opt-in/revoke`, `POST /messages/{id}/retry`, `GET /conversations?filter=attention|open|all`, `GET /whatsapp/templates`, `POST /whatsapp/templates/sync`, `PATCH /whatsapp/templates/{id}`, `GET /whatsapp/unmatched` e `POST /whatsapp/unmatched/{id}/link|retry|dismiss`, `GET /whatsapp/overview`, `POST /whatsapp/health/check` e `GET/PUT /whatsapp/settings`. O webhook fica fora da v1: `GET/POST /api/webhooks/whatsapp`, sem sessão e sem checagem de origem, autenticado pela assinatura da Meta (`X-Hub-Signature-256`); responde `404` no modo assistido. Não implementadas: `/message-templates` (os modelos são os aprovados da Meta) e `/integrations/{provider}/test` (a verificação do número cobre).

> **Fase 8 (Instagram API):** `GET /leads/{id}/instagram` (@ com métricas públicas, janela, gate, mensagens e comentários), `POST /leads/{id}/instagram/messages` (`202`, só com a janela de 24 h aberta), `POST /leads/{id}/instagram/refresh` (métricas, no máximo uma vez por hora), `POST /instagram/comments/{id}/private-reply` (`202`), `POST /instagram/messages/{id}/retry`, `GET /instagram/conversations`, `GET /instagram/unmatched` e `POST /instagram/unmatched/{id}/link|retry|dismiss`, `GET /instagram/overview`, `POST /instagram/account/check` e `GET/PUT /instagram/settings`. Webhook fora da v1: `GET/POST /api/webhooks/instagram`, com a mesma assinatura da Meta; `404` no modo assistido.
>
> **Fase 9 (dados abertos do CNPJ e Prospecção):** `GET/POST /prospecting/searches` (histórico e busca; `201`), `GET /prospecting/searches/{id}` (resultados com os dados da base aberta e a comparação), `POST /prospecting/searches/{id}/approve` (até 100 por pedido, uma transação por resultado; devolve criados, completados, já decididos e os erros de cada um) e `/reject`, `GET /prospecting/potential?uf=`; `GET /registry` (painel), `PUT /registry/settings` e `POST /registry/ingestions` (rodar ou repetir a carga; o worker faz o trabalho), só ADMIN; `GET/POST /leads/{id}/registry` (o que a base aberta tem do CNPJ do lead e "completar"). Os resultados não ficam em `/results` à parte: vêm com a busca.
>
> **Decisão (Fase 2): exportação síncrona.** O desenho previa job assíncrono, mas isso exigiria guardar o arquivo com dados pessoais até o download. A geração na hora não deixa nada no servidor, alinhada a SECURITY §8, e cabe no volume do MVP (20.000 leads em poucos segundos). Vira job quando o limite por arquivo precisar subir.

> Legenda de fase: **MVP** = Fases 1–6. Números indicam fases posteriores.

**Identidade, equipe e configurações**

| Método e rota | Descrição | Fase |
|---|---|---|
| `GET /me` | Usuário atual, perfil e permissões efetivas | MVP |
| `GET/POST /users`, `PATCH /users/{id}` | Gestão de usuários (convite, perfil, ativar/desativar) | MVP |
| `GET/PUT /users/{id}/territories` | Territórios (UF/cidade) do usuário | 2 (estrutura) |
| `GET/PUT /settings/contact-rules` | Regras de contato: janela, limites, prazos da fila, palavras de opt-out (ADMIN altera) | MVP |
| `GET/POST/PATCH/DELETE /saved-views` | Visões e filtros salvos | MVP |
| `GET /audit-logs` | Consulta de auditoria (ADMIN) | MVP |
| `GET /health` | Health check (sem autenticação, sem dados) | MVP |

**Leads**

| Método e rota | Descrição | Fase |
|---|---|---|
| `POST /leads/search` | Lista com filtros, ordenação e cursor | MVP |
| `POST /leads/count` | Contagem prévia do filtro, com quebra por contactabilidade | MVP |
| `POST /leads/check-duplicates` | Verificação de duplicidade antes de criar | MVP |
| `POST /leads` | Cadastro manual | MVP |
| `GET /leads/{id}` | Detalhe (inclui pessoas, pontos de contato, score explicado, contactabilidade) | MVP |
| `PATCH /leads/{id}` | Edição (com `version`) | MVP |
| `POST /leads/{id}/archive` | Arquivar (não exclui) | MVP |
| `GET /leads/{id}/timeline` | Timeline paginada | MVP |
| `GET /leads/{id}/history` | Histórico de alterações de campos (auditoria filtrada) | MVP |
| `POST /leads/{id}/notes` | Adicionar observação | MVP |
| `POST/PATCH/DELETE /leads/{id}/people[/{personId}]` | Pessoas do lead (contador, sócio…) | MVP |
| `POST/PATCH/DELETE /leads/{id}/contact-points[/{cpId}]` | Telefones, e-mails, Instagram | MVP |
| `POST/DELETE /leads/{id}/tags[/{tagId}]` | Tags | MVP |
| `POST /leads/{id}/assign` | Atribuir responsável | MVP |
| `POST /leads/{id}/stage` | Mover de etapa (motivo obrigatório em perdas) | MVP |
| `GET /leads/{id}/contactability` | Resultado do gate por canal | MVP |
| `POST /leads/{id}/activities` | Registrar contato (ligação, reunião, visita) | MVP |
| `POST /leads/pull` | Puxar os próximos leads do pool do território (com trava) | MVP |
| `POST /leads/{id}/handoff` | Qualificar e transferir ao Comercial (cria oportunidade) | MVP |
| `GET /opportunities`, `POST /opportunities/{id}/accept\|won\|lost` | Oportunidades: aceite, ganho e perda | MVP |
| `POST /leads/bulk` | Ação em massa por ids ou filtro (`dryRun` obrigatório antes) | MVP |
| `GET/POST/PATCH /tags`, `GET /lead-sources`, `GET /segments` | Cadastros auxiliares | MVP |

**Importação e deduplicação**

| Método e rota | Descrição | Fase |
|---|---|---|
| `POST /imports` | Upload (multipart) e criação do lote | MVP |
| `GET /imports/{id}` | Status, colunas detectadas, sugestões de mapeamento | MVP |
| `PUT /imports/{id}/mapping` | Mapeamento coluna → campo, política de duplicados, origem e base legal | MVP |
| `GET /imports/{id}/preview` | Prévia normalizada, com erros, avisos e status de match por linha | MVP |
| `PATCH /imports/{id}/rows/{rowId}` | Decisão por linha (importar, pular, vincular) | MVP |
| `POST /imports/{id}/commit` | Confirma e processa (assíncrono) | MVP |
| `GET /imports/{id}/report` | Relatório final | MVP |
| `GET/POST /import-mapping-templates` | Modelos de mapeamento reutilizáveis | MVP |
| `GET /duplicates` | Fila de possíveis duplicados (filtros por confiança e motivo) | MVP |
| `GET /duplicates/{id}` | Comparação lado a lado | MVP |
| `POST /duplicates/{id}/merge` | Mesclar (sobrevivente e escolhas campo a campo) | MVP |
| `POST /duplicates/{id}/keep-separate` | Manter separados (o par não volta a ser sugerido) | MVP |
| `POST /duplicates/{id}/ignore` | Ignorar por agora | MVP |
| `POST /duplicates/scan` | Disparar varredura completa (ADMIN/GESTOR) | MVP |
| `POST /normalize/preview` | Normalizar valores avulsos (apoio à UI) | MVP |

**Pipeline, score, fila, cadência**

| Método e rota | Descrição | Fase |
|---|---|---|
| `GET /pipelines`, `GET /pipelines/{id}/board` | Colunas com contagens e primeiros cards (cada coluna pagina sozinha) | MVP |
| `PUT /pipelines/{id}/stages` | Configurar etapas (ADMIN) | MVP |
| `GET /leads/{id}/stage-history` | Histórico de etapas com duração | MVP |
| `GET /scoring/models/active` | Modelo ativo e regras | MVP |
| `POST /scoring/models` | Nova versão (rascunho) | MVP |
| `POST /scoring/models/{id}/simulate` | Impacto na distribuição de faixas antes de ativar | MVP |
| `POST /scoring/models/{id}/activate` | Ativar e recalcular tudo (job) | MVP |
| `GET /queue` | "Minha Fila SDR" com seções e prioridade | MVP |
| `POST /tasks`, `PATCH /tasks/{id}`, `POST /tasks/{id}/complete\|cancel\|skip` | Tarefas: criar, reagendar, concluir, cancelar, pular passo | MVP |
| `GET/POST /cadences`, `PUT /cadences/{id}` | Cadências (ADMIN) | MVP |
| `POST /leads/{id}/cadence` | Inscrever lead em cadência | MVP |
| `POST /leads/{id}/cadence/pause\|resume\|stop` | Controle da inscrição | MVP |

**Mensagens, IA e conformidade**

| Método e rota | Descrição | Fase |
|---|---|---|
| `POST /ai/generations` | Gerar abordagem (lead, tipo, canal, abordagem, instruções extras) | MVP |
| `PATCH /ai/generations/{id}` | Salvar edição | MVP |
| `POST /ai/generations/{id}/approve` | Aprovar (cria mensagem pendente de envio) | MVP |
| `POST /ai/generations/{id}/discard` | Descartar com motivo | MVP |
| `POST /ai/classify-reply` | Sugerir classificação para uma resposta recebida | MVP (SHOULD) |
| `GET /leads/{id}/messages` | Histórico de mensagens | MVP |
| `POST /leads/{id}/messages/assisted` | Preparar envio assistido (gate, link `wa.me`/Instagram/e-mail); `API` na Fase 7 | MVP |
| `POST /messages/{id}/confirm\|cancel` | Confirmar ou cancelar o envio feito pelo humano (modo assistido) | MVP |
| `POST /leads/{id}/replies`, `POST /messages/{id}/classify` | Registrar resposta recebida manualmente e classificá-la | MVP |
| `GET /notifications`, `POST /notifications/read` | Avisos no app | MVP |
| `GET/POST /message-templates`, `GET/POST /approaches` | Templates internos e abordagens | MVP (Fase 6) |
| `GET/POST /suppressions`, `POST /suppressions/{id}/revoke` | Lista Não Contatar (revogação só ADMIN, com motivo) | MVP |
| `POST /leads/{id}/opt-out` | Registrar opt-out (todos os canais ou um) | MVP |
| `PUT /leads/{id}/permissions/{channel}` | Base legal e opt-in por canal | MVP |
| `GET/POST/PATCH /data-subject-requests` | Solicitações de titulares (LGPD art. 18) | MVP (registro manual) |
| `POST /leads/{id}/anonymize` | Anonimização (ADMIN) | MVP |
| `GET/POST /api/webhooks/whatsapp` | Verificação e eventos da Meta | 7 |
| `GET/POST /api/webhooks/instagram` | Verificação e eventos da Meta (mensagens, ecos, "visto", comentários) | 8 |

**Analytics, prospecção, campanhas, integrações**

| Método e rota | Descrição | Fase |
|---|---|---|
| `GET /analytics/overview?from&to` | KPIs do período | MVP |
| `GET /analytics/funnel` | Funil por etapa | MVP |
| `GET /analytics/breakdown?dimension=city\|source\|sdr\|channel\|approach\|campaign` | Quebra por dimensão | MVP (básico) / 11 |
| `GET /analytics/timeseries?granularity=day\|month` | Evolução diária e mensal | MVP (básico) / 11 |
| `GET /analytics/export?report=overview\|funnel\|city\|source\|sdr\|daily` | CSV do relatório (ADMIN/GESTOR, auditado) | MVP |
| `GET /analytics/insights` | Insights da carteira | 11+ |
| `GET/POST /prospecting/searches`, `GET /prospecting/searches/{id}`, `POST /prospecting/searches/{id}/approve\|reject`, `GET /prospecting/potential` | Busca na base aberta do CNPJ, comparação com a base, aprovação e recusa, potencial por cidade | 9 |
| `GET /registry`, `PUT /registry/settings`, `POST /registry/ingestions`, `GET/POST /leads/{id}/registry` | Carga da base aberta (ADMIN) e enriquecimento do lead pelo CNPJ | 9 |
| `GET/POST /campaigns`, `GET/PATCH /campaigns/{id}`, `POST /campaigns/{id}/actions` (`build`, `activate`, `pause`, `resume`, `complete`, `archive`), `GET /campaigns/{id}/leads`, `POST /campaigns/{id}/leads/{leadId}/remove` | Campanhas (`campaign.manage`): o detalhe traz retrato, motivos, distribuição por SDR, funil e A/B | 10 |
| `GET /leads/{id}/campaigns` | Campanhas do lead e a abordagem sorteada (escopo do lead) | 10 |
| `POST /exports` | Exportação auditada (ADMIN/GESTOR); síncrona no MVP, ver nota acima | 2 |
| `GET /integrations`, `POST /integrations/{provider}/test` | Status e teste de conexões | 7+ |

---

## 10. Jobs assíncronos (worker)

| Job | Gatilho | O que faz | Fase |
|---|---|---|---|
| `import.parse` | Upload | Lê o arquivo (CSV/XLSX) com limites, grava as linhas como texto em `import_rows` e apaga os bytes na mesma transação | 3 |
| `import.preview` | Mapeamento salvo | Normaliza e valida cada linha, casa com a base, com o próprio arquivo e com a Lista Não Contatar (lotes de 1.000 linhas) e propõe a decisão pela política do lote | 3 |
| `import.commit` | Confirmação | Grava as linhas confirmadas, uma transação por linha (erro numa linha não derruba as outras), pelo mesmo caminho do cadastro manual. Emite eventos, sinaliza possíveis duplicados e gera o relatório. Retoma de onde parou | 3 |
| `import.purge` | Diário (04:17 UTC) | Apaga as `import_rows` 30 dias após o lote e cancela lotes abandonados há mais de 7 dias | 3 |
| `dedup.check-lead` | Cadastro manual, edição de nome/CNPJ/site/cidade, contato novo ou reativado, mesclagem (enfileirado na transação) | Busca candidatos para os leads (índices exatos + trigram por cidade) e atualiza a fila de revisão. Na importação, a busca roda na própria linha, para o relatório contar os sinalizados | 3 |
| `dedup.scan` | Diário (03:43 UTC) e manual (`POST /duplicates/scan`) | Varredura completa em blocos por UF, um bloco por transação; cada par é visto uma vez | 3 |
| `score.recompute-lead` | Ações em massa de tags (lotes de 1.000 leads). As mudanças de um lead só (contatos, cidade, tipo, tags) recalculam na própria transação | Recalcula o score; grava histórico e o evento `score.changed` quando o score ou a faixa mudam | 4 |
| `score.recompute-all` | Ativação de modelo, inclusão ou retirada de cidade prioritária (só os leads da cidade) e subida do worker com leads sem score | Recalcula a base em lotes de 500 leads por transação | 4 |
| `cadence.tick` | A cada 5 min | Conclui as cadências sem resposta no prazo (lead em `NO_RESPONSE`), retoma pausas vencidas e recria a tarefa de um passo que ficou sem tarefa. Cada passo vira tarefa já na inscrição e a cada passo executado (modo assistido); envios automáticos só na Fase 7 | 5 |
| `tasks.overdue-scan` | De hora em hora (minuto 7) | Avisa cada pessoa das tarefas que atrasaram (uma vez por tarefa) e os gestores das transferências sem aceite no prazo. A prioridade da fila é calculada na leitura | 5 |
| `leads.forgotten-scan` | Diário (10:20 UTC, 07:20 em Fortaleza) | Avisa cada responsável de quantos leads estão esquecidos: etapa aberta, sem próxima ação e sem atividade há N dias (regras de contato) | 5 |
| `retention.enforce` | Diário | Anonimiza conforme a política de retenção (as `import_rows` têm job próprio, `import.purge`) | 5+ |
| `ai.generate-batch` | Agendado (opcional) | Pré-gera rascunhos para a fila do dia seguinte (Batch API, custo menor) | 6+ |
| `whatsapp.send` | Envio pedido pela pessoa (na mesma transação da mensagem `QUEUED`) | Confere o gate de novo, marca a tentativa, chama a Cloud API fora da transação e grava o desfecho. **Sem nova tentativa automática** (ADR-022) | 7 |
| `whatsapp.webhook` | Webhook gravado na inbox | Processa item a item (status, respostas, modelos, qualidade), cada um na sua transação e idempotente; até 3 novas tentativas | 7 |
| `whatsapp.suggest-classification` | Resposta recebida sem classificação (se configurado) | Pede à IA a sugestão de classificação (F7-07); nunca classifica sozinha | 7 |
| `whatsapp.sync-templates` | Diário (06:41 UTC) e manual | Sincroniza os modelos da conta na Meta | 7 |
| `whatsapp.health-check` | De hora em hora (minuto 23) e por webhook de qualidade/conta | Qualidade, limite e situação do número; piora avisa os ADMINs | 7 |
| `webhooks.purge` | Diário (04:47 UTC) | Apaga payloads de webhook e mensagens de números sem lead com mais de 90 dias (WhatsApp e Instagram) | 7 |
| `instagram.send` | Resposta pedida pela pessoa (na mesma transação da mensagem `QUEUED`) | Confere os prazos da Meta e o gate de novo, chama a API fora da transação e grava o desfecho. **Sem nova tentativa automática** (ADR-022) | 8 |
| `instagram.webhook` | Webhook gravado na inbox | Consulta o @ de quem escreve pela primeira vez (fora da transação) e processa item a item (mensagens, ecos, "visto", comentários); até 3 novas tentativas | 8 |
| `instagram.suggest-classification` | Mensagem recebida sem classificação (se configurado) | Pede à IA a sugestão de classificação; nunca classifica sozinha | 8 |
| `instagram.account-check` | Diário (07:13 UTC) | Confere o token e a conta profissional; erro de permissão avisa os ADMINs | 8 |
| `instagram.discovery` | De hora em hora (minuto 17) | Business Discovery dos @ dos leads, com teto por rodada; recalcula o score (ADR-026) | 8 |
| `registry.check` | Diário (06:31 UTC, 03:31 em Fortaleza) e "Rodar a carga agora" | Confere se a Receita publicou um mês novo **e completo**; abre a carga (uma por vez) ou retoma a interrompida; carga parada há mais de 72 h é dada como falha | 9 |
| `registry.ingest` | Aberto pelo `registry.check` | Carga do mês em streaming: estabelecimentos ativos de contabilidade, depois razão social, natureza e porte só das raízes guardadas; apaga o que saiu da base (menos se a queda passar de 30%: avisa os ADMINs). Retoma do arquivo em que parou; até 3 novas tentativas se o servidor da Receita cair | 9 |
| `prospecting.purge` | Diário (04:27 UTC) | Apaga os resultados das buscas com mais de 30 dias (a busca fica no histórico) | 9 |
| `campaign.build` | "Montar" na campanha (na mesma transação) | Congela o filtro (até 5.000 leads), avalia a elegibilidade de cada lead (gate do canal em lotes de 250 + regras da campanha), distribui os aptos entre os SDRs e sorteia as variantes; grava tudo de uma vez se a campanha não mudou no meio. Falha volta ao rascunho com o erro | 10 |
| `campaign.tick` | De hora em hora (minuto 11) e logo após ativar ou retomar | Conclui as campanhas vencidas; libera até o limite diário de cada SDR (dias de expediente das regras de contato, fuso do SDR), um lead por transação, com trava por campanha e elegibilidade conferida de novo; atualiza os marcos do funil. **Nunca envia mensagem** (ADR-029) | 10 |
| `analytics.rollup-daily` | Diário | Consolida `daily_metrics` | 11 |

Política padrão: até 5 tentativas com backoff exponencial e jitter; depois vai para *dead letter* com alerta. Jobs de varredura usam *singleton* (uma execução por vez).

---

## 11. Estrutura de pastas

```
central-sdr-docline/
├── apps/
│   ├── web/                          # Next.js — UI + API /api/v1 + webhooks
│   │   ├── src/app/
│   │   │   ├── (auth)/login/
│   │   │   ├── (app)/                # layout com menu lateral
│   │   │   │   ├── dashboard/  fila/  leads/  leads/[id]/  pipeline/
│   │   │   │   ├── campanhas/  prospeccao/  importar/  duplicados/
│   │   │   │   ├── mensagens/  relatorios/  equipe/  integracoes/
│   │   │   │   └── configuracoes/
│   │   │   └── api/
│   │   │       ├── v1/…              # route handlers finos → casos de uso do core
│   │   │       ├── webhooks/{whatsapp,instagram}/
│   │   │       └── auth/[...all]/    # Better Auth
│   │   ├── src/components/           # ui/ (shadcn), leads/, pipeline/, queue/, …
│   │   ├── src/lib/                  # cliente da API, auth, formatação pt-BR
│   │   └── tests/e2e/                # Playwright
│   └── worker/
│       └── src/
│           ├── index.ts              # bootstrap pg-boss + registro de jobs
│           ├── jobs/                 # *.job.ts (um arquivo por job)
│           └── schedules.ts          # agendamentos cron
├── packages/
│   ├── core/
│   │   └── src/
│   │       ├── modules/              # um diretório por módulo (ver §6)
│   │       ├── ports/                # interfaces: MessagingProvider, AiProvider, JobQueue…
│   │       ├── shared/               # erros, Result, Clock, ids, paginação, DSL de filtros
│   │       └── index.ts
│   ├── db/
│   │   ├── prisma/schema.prisma
│   │   ├── prisma/migrations/        # inclui SQL manual: extensões, trigram, partições
│   │   ├── prisma/sql/               # consultas TypedSQL (analytics, dedup)
│   │   └── seed/                     # dados de referência + empresas fictícias
│   ├── integrations/
│   │   └── src/
│   │       ├── whatsapp/             # meta-cloud.ts (Graph API) e signature.ts (webhooks); o simulado fica no core
│   │       ├── instagram/            # meta-graph.ts (Graph API com Facebook Login); o simulado fica no core
│   │       ├── google/{places,fake}/   # planejado (F9-03, aguardando parecer jurídico)
│   │       ├── company-registry/     # receita-open-data.ts (arquivos oficiais, streaming); a base simulada fica no core
│   │       ├── ai/{anthropic,fake}/
│   │       ├── crm/{docline,webhook,fake}/
│   │       ├── email/{smtp,resend,console}/
│   │       └── registry.ts           # escolhe adaptadores pelo ambiente
│   └── config/                       # tsconfig base, eslint, schema Zod das envs
├── docs/                             # esta documentação
├── docker/                           # Dockerfiles
├── docker-compose.yml                # Postgres local (+ Mailpit)
├── .github/workflows/ci.yml
├── .env.example
├── package.json · pnpm-workspace.yaml
└── README.md
```

---

## 12. Estratégia de testes

### 12.1 Pirâmide

| Nível | Ferramenta | Alvo | Onde roda |
|---|---|---|---|
| Unitário | Vitest | Funções puras do domínio, guardrails, cálculo de score/cadência | Todo PR |
| Propriedade | fast-check | Normalização: idempotência, equivalência de formatos, nunca lançar exceção | Todo PR |
| Integração | Vitest + Postgres real (Testcontainers ou serviço do CI) | Repositórios, SQL de dedup (`pg_trgm`), permissões, importação, transações e eventos | Todo PR |
| Adaptadores | Vitest + MSW | Contratos HTTP de Meta/Google/IA com respostas gravadas | Todo PR |
| E2E | Playwright (Chromium) | Jornadas críticas, incluindo viewport de celular | PRs para `main` e noturno |
| Avaliação de IA | Conjunto offline de leads fictícios + rubrica | Qualidade e conformidade das mensagens | Antes de mudar prompt ou modelo |

### 12.2 Suítes obrigatórias (requisito §35)

| Área | Casos-chave |
|---|---|
| **Telefone** | `(88) 99999-9999`, `88999999999`, `+55 88 99999-9999`, `055 88 99999 9999`, `0xx88…` → mesmo E.164; DDD inexistente; fixo × celular; 8 dígitos antigos (+9 com aviso); ramais; 0800/4004/3003 (serviço, não WhatsApp); variantes do `wa_id` com e sem o 9º dígito; idempotência |
| **CNPJ** | Numéricos válidos e inválidos; **alfanuméricos** (novo formato); máscaras; todos os dígitos iguais (inválido); raiz × filial |
| **Deduplicação** | Matriz de sinais (CNPJ, telefone, e-mail, Instagram, nome+cidade, similaridade); "Contabilidade Silva" × "Contabilidade Souza" **não** é duplicado (termos genéricos removidos); filial (mesma raiz de CNPJ) sinalizada à parte; e-mail de provedor gratuito com peso menor; par "manter separados" não reaparece; mesclagem move contatos, eventos, tarefas e mensagens e **não exclui nada** |
| **Lead scoring** | Soma, teto 100 (`CLAMP`), faixas configuráveis, regra inativa, pontos negativos, versão do modelo, explicação (breakdown) |
| **Cadência** | Offsets D0/D2/D5/D10 com relógio falso; dias úteis; feriados; janela de horário; fuso do lead; parada ao responder; parada por opt-out; fim → `NO_RESPONSE`; uma inscrição ativa por lead |
| **Permissões** | Matriz perfil × ação; SDR não lê lead de outro SDR; COMERCIAL só vê o que foi transferido a ele; exportação só ADMIN/GESTOR; tentativa negada gera auditoria |
| **Pipeline** | Transições permitidas; motivo obrigatório em perda; histórico com duração; conflito de versão |
| **Opt-out** | Palavra-chave → supressão imediata; supressão por identificador bloqueia o mesmo número em outro lead e em reimportação; gate bloqueia geração e envio; revogação só ADMIN com motivo |
| **Importação** | CSV UTF-8 e Windows-1252; delimitadores `;` e `,`; XLSX com várias abas e cabeçalho fora da linha 1; linhas vazias; colunas extras → `custom_fields`; duplicados dentro do arquivo; limite de tamanho; XLSX malicioso (bomba zip) rejeitado; relatório confere com a prévia |

### 12.3 Dados de teste

- *Factories* com `@faker-js/faker` (locale `pt_BR`) e semente fixa, ou seja, determinísticas.
- **Nunca** usar dados pessoais reais em testes ou seeds. Empresas fictícias ("Contabilidade Exemplo Sobral Ltda."), CNPJs gerados com DV válido e marcados `is_test_data = true`.
- Provedores `fake` em teste e desenvolvimento; um *guard* nos adaptadores reais recusa enviar para `is_test_data`.
- Fixtures de planilhas em `packages/core/test/fixtures/` (o `.gitignore` bloqueia `*.csv`/`*.xlsx` fora de `fixtures/`).

### 12.4 Pipeline de CI

`pnpm install --frozen-lockfile` → lint → typecheck → unit/propriedade → integração (Postgres) → build → checagem de migrações (`prisma migrate diff`) → varredura de segredos (gitleaks) → auditoria de dependências → E2E (para `main`).

---

## 13. Escalabilidade

O volume de **leads** é pequeno para o PostgreSQL. O que cresce são **eventos, mensagens e auditoria** (≈ 20–50 linhas por lead ao longo da vida). A estratégia é crescer por etapas, sem reescrita:

| Volume de leads | Estratégia |
|---|---|
| até 50 mil | Postgres único; índices B-tree + GIN trigram; paginação por cursor; dashboards consultando ao vivo |
| ~100 mil | Rollups diários (`daily_metrics`) e *materialized views* para dashboards; jobs em lotes; `tsvector` gerado para busca |
| ~500 mil | Particionamento mensal de `lead_events`, `messages`, `audit_logs`; réplica de leitura para analytics; filas por prioridade; avaliar Redis só para cache e rate limit distribuído |
| > 500 mil / BI | Exportação incremental para um armazém analítico (BigQuery, ClickHouse ou DuckDB/Parquet) alimentado pelos eventos |

**Medição (Fase 6, `pnpm perf:100k`).** Banco próprio (`*_perf`) com 100 mil leads fictícios, ~116 mil mensagens, 3,3 mil oportunidades, tarefas e opt-outs; mediana de 5 leituras pelos casos de uso da aplicação, num contêiner de desenvolvimento com Postgres local:

| Leitura | Mediana |
|---|---:|
| Lista de leads (50) · lista filtrada · busca por nome · ficha | 6–11 ms |
| Contagem total | 25 ms |
| Minha Fila (SDR) | 68 ms |
| Kanban | 212 ms |
| Dashboard da equipe: 30 / 90 / 366 dias | 0,5 / 0,7 / 1,2 s |
| Dashboard do SDR (30 dias) | 186 ms |
| Relatório por cidade (366 dias) · exportação diária (366 dias) | 111 ms · 482 ms |

A primeira versão do dashboard levava 4,6 s (30 dias) e 6,9 s (366 dias): uma passada pelos leads por dimensão e subconsultas por lead. Agora respostas, interesse e oportunidades são agregados por lead antes (hash join) e o total, a cidade, a origem e o SDR saem de uma passada só (`GROUPING SETS`). Com isso, os *rollups* diários ficam para quando o volume ou a medição pedirem.

Práticas desde o início: nada de `OFFSET` em listas; nada de `SELECT *` em listas; colunas de busca normalizadas e indexadas (o `unaccent` não é `IMMUTABLE`, então a normalização é feita na aplicação e gravada em `name_search`); contagens com filtros indexados; Kanban carrega contagem por coluna e pagina os cards de cada uma.

---

## 14. Implantação, ambientes e custos

### 14.1 Ambientes

| Ambiente | Onde | Dados | Provedores externos |
|---|---|---|---|
| Local | `docker compose` (Postgres, Mailpit) | Seed fictício | `fake` / `assisted` |
| Staging | Render (instâncias mínimas) | Seed fictício | `fake` / sandboxes oficiais |
| Produção | Render (ou alternativa com região BR, ver §16) | Reais | Reais, depois de checklist ([INTEGRATIONS §16](./INTEGRATIONS.md#16-checklist-de-ativação-de-uma-integração)) |

### 14.2 Topologia (produção)

- **Uma imagem Docker** (`Dockerfile`) para os dois serviços; o comando define o papel (ADR-016).
- **Web Service** (`docker/start-web.sh`), com *health check* em `/api/health` e *pre-deploy* `pnpm db:deploy && pnpm db:seed` (migrações + dados de referência).
- **Background Worker** (`docker/start-worker.sh`), executado com `tsx` (ADR-017).
- **PostgreSQL gerenciado**, plano pago com backup diário e recuperação a um ponto no tempo (verificar plano). Os bancos gratuitos da Render expiram e não servem para produção.
- Segredos em *environment groups*; `render.yaml` (Blueprint de staging) versionado no repositório.
- Teste de restauração de backup trimestral.

### 14.3 Custos (ordem de grandeza, a validar)

| Item | Estimativa inicial |
|---|---|
| Web + worker + Postgres (Render, planos iniciais pagos) | dezenas de US$/mês |
| IA (volume de MVP: alguns milhares de gerações/mês) | dezenas de US$/mês (ver [AI-SDR §15](./AI-SDR.md#15-custos-e-controles)) |
| Sentry, e-mail transacional | planos gratuitos no início |
| WhatsApp Cloud API (Fase 7) | cobrança por mensagem conforme categoria e país (tabela vigente da Meta) |
| Instagram API (Fase 8) | sem cobrança por mensagem; limites de chamadas por conta (o teto da consulta de perfis deixa folga) |
| Google Places (Fase 9) | pago por uso, por SKU e campos solicitados; usar *field masks* e cotas |

---

## 15. Registro de decisões (ADRs)

| ADR | Decisão | Motivo | Alternativas descartadas | Consequências |
|---|---|---|---|---|
| 001 | **Monólito modular** em monorepo TypeScript (`apps/web`, `apps/worker`, `packages/*`) | Simplicidade, um deploy de código, refatoração barata | Microsserviços; API NestJS separada | Fronteiras de módulo garantidas por lint; extração futura possível |
| 002 | **PostgreSQL como única base** (dados, fila, busca, similaridade) | Menos infraestrutura e custo | Redis + Elasticsearch desde o início | Migrações com SQL manual para extensões e índices |
| 003 | **pg-boss** em vez de Redis/BullMQ no MVP | Enfileiramento transacional, custo zero adicional | BullMQ, Graphile Worker | Interface `JobQueue` mantém a troca possível |
| 004 | **Prisma** + SQL tipado para consultas especiais | Produtividade, migrações | Drizzle, Kysely | Consultas de dedup e analytics em `.sql` revisado |
| 005 | **API REST `/api/v1`** como contrato único | Reuso por UI, n8n e sistemas Docline | Server Actions como única via; GraphQL; tRPC | Schemas Zod compartilhados; OpenAPI gerado |
| 006 | **Portas e adaptadores**, com `fake` como padrão fora de produção | Trocar fornecedor sem mexer no domínio; testes sem rede | Chamadas diretas a SDKs | Um pouco mais de código de interface |
| 007 | **Modo assistido** de envio no MVP (humano envia, sistema registra) | Valor imediato sem depender de aprovação da Meta e respeitando o opt-in | Esperar a Fase 7; automação não oficial (proibida) | Registro depende de confirmação do SDR; UX precisa ser de 1 clique |
| 008 | **Timeline por eventos de domínio** (append-only) | Rastreabilidade e base para a IA futura | Timeline montada de várias tabelas | Mais escrita; particionamento futuro |
| 009 | **Lista Não Contatar por identificador** (HMAC do valor normalizado), independente do lead | Opt-out sobrevive a reimportação, mesclagem e exclusão | Flag no lead; tag | Exige *pepper* estável (`SUPPRESSION_HASH_PEPPER`) |
| 010 | **Configuração de negócio versionada no banco** | Admin ajusta sem deploy; histórico consistente | Constantes no código | Telas de configuração e versionamento |
| 011 | **Single-tenant** (somente Docline) | YAGNI; menos complexidade em todas as consultas | `tenant_id` em todas as tabelas | Se virar SaaS: migração + RLS |
| 012 | **Better Auth + RBAC próprio** | Open source, dados no nosso banco | Auth.js, Clerk, Supabase Auth | Autorização testada no domínio |
| 013 | **Código em inglês, interface e documentação em pt-BR** | Padrão de mercado e bibliotecas; usuário em português | Código em português | Glossário no [README](../README.md#glossário) |
| 014 | **Google Places só como apoio** (guardar só `place_id`); **dados abertos CNPJ** como fonte primária de descoberta | Termos da Google Maps Platform; dado público oficial | Copiar dados do Places para a base | Depende de validação jurídica (Fase 9) |
| 015 | **n8n apenas nas bordas** | Regra de negócio versionada, testada e auditada | Fluxos de negócio no n8n | n8n consome a API com chave e escopo |
| 016 | **Imagem Docker única** para web e worker | Um artefato por versão; a imagem do web traz o CLI do Prisma, então as migrações rodam no pre-deploy | Next `standalone` + imagem separada para o worker | Imagem maior (~1,5 GB descompactada); separar imagens é otimização futura |
| 017 | **Worker executado com `tsx`** (sem etapa de build) | Resolve os pacotes TypeScript do workspace sem bundler; menos configuração | Bundling com tsup/esbuild | Pequeno custo de transpilação na inicialização |
| 018 | **CSP com nonce por requisição** no `proxy.ts`; o nonce do documento é registrado para estilos injetados por bibliotecas (Radix) | Política estrita sem `unsafe-inline` para scripts e estilos em produção | `unsafe-inline` em `style-src` | Todas as páginas são dinâmicas; atributos `style=""` liberados via `style-src-attr` |
| 019 | **Hospedagem na Render, região Virginia (EUA)**, para staging e produção (decisão da Docline em 2026-10-08) | Blueprint (`render.yaml`) e imagem já validados; operação simples; custo baixo; Virginia é a região da Render mais próxima do Brasil | Google Cloud em São Paulo (mais configuração); Fly.io em São Paulo (Postgres gerenciado recente); Railway (sem região no Brasil) | **Transferência internacional** (LGPD art. 33): exige cláusulas-padrão da ANPD no contrato/DPA da Render e validação jurídica **antes de dados pessoais reais**; até lá, só dados fictícios. A Render não muda a região de um serviço existente (trocar = recriar e migrar). A Render acrescenta ao `X-Forwarded-For`: `TRUSTED_PROXIES` deve ser configurado no primeiro deploy ([SECURITY §12](./SECURITY.md#12-limites-de-taxa-e-abuso)) |
| 020 | **Leitor próprio de XLSX** (fflate para o ZIP, saxes para o XML), só valores das células como texto, em vez do ExcelJS (Fase 3) | O ExcelJS 4.4.0 está sem versão nova desde 2023 e depende de pacotes antigos (`tmp`, `archiver`, `unzipper`). Com o leitor próprio, os limites contra zip bomb são explícitos: o total declarado e o número de entradas são conferidos antes de descompactar, e o buffer tem o tamanho declarado, então o arquivo não cresce além dele. Também recusa macros e lê em streaming, com 3 dependências pequenas | ExcelJS; SheetJS (o pacote `xlsx` do npm está desatualizado) | Não converte datas (vêm como número serial; não há campo de data no mapeamento do lead) nem avalia fórmulas: vale o último resultado gravado no arquivo. Testado com planilhas montadas no próprio teste |
| 021 | **Opt-in do WhatsApp por número** (`contact_permissions.contact_point_id`), com evidência; a linha do lead guarda só a base legal (Fase 7) | A Meta exige a permissão do próprio número para mensagens iniciadas pela empresa; um lead pode ter vários números | Opt-in no nível do lead (Fase 2) | O opt-in de WhatsApp gravado no lead deixa de liberar a API; o gate do modo API filtra os números (opt-in ou janela aberta); opt-out e o erro 131050 revogam o opt-in; mesclagem leva o opt-in do mesmo número (revogado prevalece) |
| 022 | **Envio pela API sem reenvio automático**: tentativa marcada antes da chamada, desfecho gravado com atualização condicional e nosso id em `biz_opaque_callback_data` (Fase 7) | A Cloud API não tem chave de idempotência; repetir uma chamada de resultado incerto pode mandar a mesma mensagem duas vezes (pior que não mandar, para quem prospecta) | Retentativas automáticas do pg-boss | Falha conhecida vira "Tentar de novo" para a pessoa; resultado incerto só é repetido depois de 10 minutos sem status e com confirmação; o webhook de status corrige uma falha incerta |
| 023 | **Cloud API direta pela Graph API oficial com `fetch`**, versão fixada em `META_GRAPH_API_VERSION`; leitura do webhook (formato da Meta) no core; inbox de webhooks idempotente pelo SHA-256 do corpo (Fase 7) | A Meta não mantém SDK oficial para Node; a Cloud API direta é a opção de menor custo; o provedor simulado fala o mesmo formato de webhook, então a mesma leitura serve aos dois | BSP (Twilio, 360dialog…), possível pela porta; SDK de terceiros | Atualizar a versão da Graph API é uma mudança planejada, com os testes do adaptador; um BSP exigiria adaptador e leitura de webhook próprios |
| 024 | **2FA obrigatória para ADMIN/GESTOR aplicada na borda web** (páginas por `getPageContext` e API v1 por `apiHandler`), com a regra pura `twoFactorGate` no core e `TWO_FACTOR_ENFORCEMENT` (`required` em staging e produção; `reminder` só em dev/test) (0.7.1) | A situação da 2FA vem da sessão do Better Auth, que só existe na borda; jobs e o sistema não têm 2FA; a suíte E2E precisa entrar como ADMIN sem um código novo a cada login | Bloqueio no core (cada caso de uso) ou no `proxy.ts` (consulta à sessão em toda requisição) | Página nova deve usar `getPageContext` (as de "em breve" não leem dados); uma rota da API v1 fora do `apiHandler` não teria o bloqueio; o E2E sobe um segundo servidor com `required` |
| 025 | **Instagram só responde**: porta própria (`InstagramProvider`), texto só com a janela de 24 h aberta naquele @ e resposta privada a comentário (uma por comentário, até 7 dias) pelo gate do contato assistido; o primeiro contato continua pelo app; ecos conciliam envios e registram respostas dadas pelo app; comentários só de leads já cadastrados (Fase 8) | A API da Meta não permite iniciar conversa; as regras (janela, resposta privada, eco, perfil por IGSID) são diferentes das do WhatsApp; guardar comentários de quem não é lead seria tratar dados sem finalidade | Porta única de mensageria para os dois canais; tag `human_agent` (até 7 dias); guardar todos os comentários | Mesmo desenho de envio do WhatsApp (ADR-022) e mesma inbox de webhooks; o IGSID vira o `external_thread_id` da conversa; a lista de quem não é lead é a do WhatsApp com o canal; comentário não para a cadência |
| 026 | **Business Discovery mínimo**: job de hora em hora com teto configurável, seleção em SQL (nunca consultados ou com o @ trocado primeiro, depois os vencidos), cada @ consultado uma vez, só seguidores, número de publicações e data da última; o score usa a última publicação conhecida do @ atual; leads com opt-out ou bloqueados não são consultados (Fase 8) | Os limites de chamadas da Meta são por conta e compartilhados com as mensagens; o critério "Instagram ativo" só precisa da data; minimização (LGPD) | Consultar na criação do lead; guardar mídias e legendas; consulta sem teto | Métricas de um @ antigo não valem; falha não apaga o que se sabia; o critério continua inativo no seed até o ADMIN ligar |
| 027 | **Cópia local filtrada da base aberta do CNPJ** (`registry_companies`), carregada todo mês pelos arquivos oficiais da Receita em streaming, separada de `leads`; a porta (`CompanyRegistrySource`) só entrega arquivos e o core lê o layout (Fase 9) | A busca roda no nosso banco (sem chamada externa por busca, sem limite de terceiros, comparação em SQL com a base); a Receita publica arquivos, não uma API de busca; ler o layout no core deixa a base simulada no mesmo caminho | API de terceiros por consulta (BrasilAPI e afins) para buscar; guardar os arquivos completos | Carga longa e retomável no worker; o mês só entra com a publicação completa; queda grande não apaga nada; formato e endereço conferidos na ativação |
| 028 | **Prospecção sem cópia dos dados nos resultados e com aprovação humana que refaz a comparação** (Fase 9) | Os resultados guardam só o CNPJ, a comparação e a decisão (30 dias); os dados vêm da cópia da base na leitura. Na aprovação, a base pode ter mudado: compara de novo, completa o existente e recusa quem entrou na Lista Não Contatar. A decisão é reservada por atualização condicional, como no envio pela API | Criar leads direto da busca; guardar os dados no resultado | Uma transação por aprovação (até 100 por pedido); o "recusado antes" vale enquanto o resultado existir (30 dias) |
| 029 | **Campanha não envia mensagens**: seleciona (retrato congelado do filtro), avalia a elegibilidade com motivos, distribui entre os SDRs e **libera para a cadência** até um limite diário por SDR; cada contato continua sendo do SDR, pelo gate de sempre (assistido; API só com opt-in ou janela aberta). Única mudança nas tabelas existentes: `campaign_id` opcional em inscrições e mensagens (Fase 10) | O requisito proíbe disparos indiscriminados e spam; o gate, a cadência e a Minha Fila já resolvem horário, frequência, opt-out e registro; liberar em lotes diários dá ritmo sem criar outro caminho de envio | Disparo em massa pela API; enviar o passo de cadência `API_MESSAGE` sozinho (F7-09) | O lote do dia vira tarefas na Minha Fila; o limite diário é de leads liberados, não de mensagens; conferir de novo na hora da liberação evita contatar quem entrou na Lista Não Contatar depois da montagem; campanha concluída não para as cadências em andamento |
| 030 | **Funil por janela de atribuição e A/B por variante sorteada** (Fase 10) | Um marco (contato, entrega, resposta, interesse, oportunidade, conversão, opt-out) conta para a campanha se acontece até 90 dias depois da liberação ou até o lead ser liberado por outra campanha, recalculado por SQL idempotente. O A/B compara a **variante sorteada** (não a abordagem que o SDR acabou usando), alternada dentro da lista de cada SDR, só com 30 contatados por variante e com Bonferroni; nunca declara vencedora | Atribuir pela abordagem gravada na mensagem; ligar a atribuição à data de conclusão; declarar vencedora por p-valor | Mensagens da janela ganham o `campaign_id`; a comparação aponta "diferença provável" e a decisão é do gestor; a Fase 11 (Analytics) pode reaproveitar a atribuição |