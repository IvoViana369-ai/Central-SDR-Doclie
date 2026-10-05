# Docline SDR — Central Inteligente de Prospecção

Central operacional de prospecção B2B da **Docline Tecnologia**, começando pelos escritórios de contabilidade, contadores e parceiros indicadores.

> **Status: Fase 0 concluída (descoberta, arquitetura e planejamento). Aguardando aprovação para iniciar a Fase 1.**
> Ainda não há código de aplicação neste repositório: só a documentação de arquitetura, o modelo de dados, o plano e o modelo de variáveis de ambiente.

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
| [.env.example](.env.example) | Variáveis de ambiente previstas (sem segredos) |

## Resumo das decisões

| Tema | Decisão |
|---|---|
| Arquitetura | **Monólito modular** em TypeScript (monorepo pnpm): `apps/web` (Next.js: UI + API `/api/v1`) + `apps/worker` (jobs) + `packages/core` (domínio) + `packages/integrations` (adaptadores) + `packages/db` (Prisma) |
| Banco | **PostgreSQL** + Prisma; `pg_trgm` para similaridade; eventos append-only para timeline e analytics |
| Filas | **pg-boss** (no próprio PostgreSQL). Redis/BullMQ só se necessário no futuro |
| Frontend | Next.js + React + Tailwind + shadcn/ui; responsivo |
| Autenticação | Better Auth + RBAC próprio (Administrador, Gestor, SDR, Comercial) |
| IA | Porta `AiProvider`; adaptador padrão Anthropic (Claude); aprovação humana obrigatória |
| Contato no MVP | **Modo assistido** (`wa.me`/Instagram aberto pelo SDR, envio humano, registro no sistema). WhatsApp Cloud API na Fase 7, só com opt-in |
| Captação | Planilhas e cadastro no MVP; **dados abertos CNPJ** como fonte primária de descoberta e Google Places apenas como apoio (Fase 9, após parecer jurídico) |
| Deploy | Docker; Render (web + worker + Postgres), com a região de hospedagem ainda por decidir |
| n8n | Só nas bordas (integrações com sistemas Docline), nunca com regra de negócio |

## Principais riscos

1. **WhatsApp exige opt-in** para mensagens iniciadas pela empresa via API, o que inviabiliza a prospecção fria por API. Mitigação: modo assistido, opt-in legítimo e validação jurídica.
2. **Instagram não permite iniciar DMs pela API**: o primeiro contato é sempre humano.
3. **Termos do Google restringem armazenar dados do Places**: guardar só o `place_id` e usar dados abertos CNPJ como fonte primária.
4. **Base legal** de bases existentes precisa ser verificada antes da importação.
5. **Escopo**: disciplina de MVP e entregas por fase.

Registro completo em [ROADMAP §6](docs/ROADMAP.md#6-registro-de-riscos).

## Estrutura planejada do repositório

```
apps/web            Next.js — UI, API /api/v1, webhooks
apps/worker         Jobs (importação, dedup, score, cadência, webhooks, retenção)
packages/core       Domínio e casos de uso (sem dependência de framework)
packages/db         Prisma: schema, migrações, seeds
packages/integrations  Adaptadores: whatsapp, instagram, google, enrichment, ai, crm, email
packages/config     Configurações compartilhadas (TS, lint, schema de env)
docs/               Documentação do projeto
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

## Como rodar

Disponível a partir da **Fase 1** (fundação técnica). O plano de setup local (Docker Compose com PostgreSQL) está em [ARCHITECTURE §14](docs/ARCHITECTURE.md#14-implantação-ambientes-e-custos).

## Próximo passo recomendado

1. **Revisar e aprovar** esta Fase 0, respondendo às [questões em aberto](docs/ARCHITECTURE.md#16-questões-em-aberto), principalmente hospedagem, base existente e etapas de follow-up.
2. **Iniciar em paralelo, já:** verificação da empresa na Meta (WABA) e validação jurídica LGPD. São os itens com maior prazo externo.
3. **Autorizar a Fase 1 — Fundação técnica** ([backlog F1](docs/ROADMAP.md#fase-1--fundação-técnica)).
