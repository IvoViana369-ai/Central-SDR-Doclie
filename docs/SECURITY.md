# Segurança — Docline SDR

> **Status:** baseline da Fase 0; controles da Fase 1 implementados em 2026-10-08 (ver [§18](#18-checklist-por-fase)). Aplica-se desde o primeiro commit de código.
> Relacionados: [LGPD](./LGPD.md) · [ARCHITECTURE](./ARCHITECTURE.md) · [INTEGRATIONS](./INTEGRATIONS.md) · [`.env.example`](../.env.example)

## Sumário

1. [Princípios](#1-princípios)
2. [Ativos e ameaças](#2-ativos-e-ameaças)
3. [Autenticação](#3-autenticação)
4. [Autorização (RBAC)](#4-autorização-rbac)
5. [Segredos](#5-segredos)
6. [Proteção de dados](#6-proteção-de-dados)
7. [Validação de entrada e saída](#7-validação-de-entrada-e-saída)
8. [Upload de arquivos](#8-upload-de-arquivos)
9. [Webhooks](#9-webhooks)
10. [SSRF (busca de URLs externas)](#10-ssrf-busca-de-urls-externas)
11. [Cabeçalhos e proteções web](#11-cabeçalhos-e-proteções-web)
12. [Limites de taxa e abuso](#12-limites-de-taxa-e-abuso)
13. [Segurança da IA](#13-segurança-da-ia)
14. [Auditoria e monitoramento](#14-auditoria-e-monitoramento)
15. [Dependências e cadeia de suprimentos](#15-dependências-e-cadeia-de-suprimentos)
16. [Infraestrutura](#16-infraestrutura)
17. [Resposta a incidentes](#17-resposta-a-incidentes)
18. [Checklist por fase](#18-checklist-por-fase)

---

## 1. Princípios

- **Defesa em profundidade:** regras críticas (permissão, contactabilidade) verificadas em mais de uma camada.
- **Menor privilégio:** usuários, chaves de API, tokens de integração e usuário do banco com o mínimo necessário.
- **Seguro por padrão:** provedores falsos fora de produção; integrações desligadas até serem ativadas.
- **Nenhum segredo no código ou no Git.** Nunca.
- **Falhar de forma segura:** na dúvida (ex.: possível opt-out, permissão ambígua), bloquear e pedir decisão humana.

---

## 2. Ativos e ameaças

| Ativo | Ameaças principais | Controles |
|---|---|---|
| Base de leads (dados pessoais) | Exfiltração por usuário interno via exportação; IDOR na API; vazamento de backup | Escopos por perfil; exportação restrita e auditada; testes de autorização; backups criptografados |
| Contas de usuários | Credential stuffing; força bruta; sessão roubada | Rate limit e bloqueio; senhas fortes; 2FA para perfis elevados; cookies seguros |
| Tokens Meta/Google/IA | Vazamento em Git, logs ou erro | Variáveis de ambiente/cofre; mascaramento em logs; gitleaks; rotação |
| Lista Não Contatar | Remoção indevida → contato com quem pediu para sair | Revogação só ADMIN com motivo; auditoria; hash com *pepper* |
| Reputação dos canais | Uso abusivo do WhatsApp; denúncias | Gate, limites diários, modo assistido, opt-out imediato |
| Disponibilidade | Upload gigante; abuso de IA; consultas pesadas | Limites de arquivo/linhas; cotas de IA; paginação e índices |
| Integridade da UI | XSS via dados de lead ou mensagens recebidas; CSV injection | Escape do React; sem HTML bruto; sanitização na exportação |
| Servidor | SSRF ao buscar sites de leads; payload malicioso de webhook | Bloqueio de IPs internos; validação de assinatura e tamanho |
| IA | Injeção de prompt via bio/site/mensagem | Dados delimitados, sem ferramentas, validação de saída, aprovação humana |

---

## 3. Autenticação

| Controle | Definição |
|---|---|
| Biblioteca | Better Auth (sessões no PostgreSQL) |
| Cadastro | **Sem cadastro público.** Só por convite do ADMIN, com link de uso único e expiração |
| Senhas | Mínimo de 12 caracteres; sem regras de composição forçada; verificação contra senhas comuns/vazadas; hash forte (scrypt/argon2, padrão da biblioteca) |
| Sessão | Cookie `HttpOnly`, `Secure`, `SameSite=Lax`; expiração por inatividade; renovação; revogação ao desativar usuário ou trocar senha |
| Força bruta | Limite por IP e por conta; atraso progressivo; alerta em picos *(Fase 1: limite por IP; por conta em F2-18 — ver §12)* |
| Redefinição de senha | Token de uso único, curto (≤ 30 min), invalida sessões anteriores |
| 2FA | TOTP obrigatório para ADMIN e GESTOR (SHOULD no MVP, MUST antes das Fases 7–9) |
| SSO | Opcional futuro: Google Workspace da Docline |

---

## 4. Autorização (RBAC)

### 4.1 Escopo de dados por perfil

| Perfil | Leads visíveis |
|---|---|
| ADMIN | Todos + configurações e conformidade |
| GESTOR | Todos da(s) sua(s) equipe(s) (ou todos, por configuração) |
| SDR | Leads atribuídos a ele + pool não atribuído do seu território + leads que transferiu (somente leitura) |
| COMERCIAL | Leads/oportunidades transferidos a ele |

**Como está implementado (Fase 2)** — `leadScopeWhere` em `packages/core/src/modules/leads/infra/scope.ts`, aplicado em toda leitura e escrita de lead:

- **GESTOR vê todos os leads** enquanto não houver gestão de equipes (hoje não há tela para criar equipes). Quando houver, o escopo por equipe entra como configuração.
- **Pool do SDR** = leads ativos e sem responsável nas UFs ou cidades dos seus territórios (`user_territories`, definidos pelo ADMIN na tela Equipe). **Sem território, não há pool**: o SDR vê só os leads atribuídos a ele. Ao "puxar do pool", o lead passa a ser dele (atribuição `CLAIM`, com proteção contra dois SDRs puxarem o mesmo lead).
- "Leads que transferiu (somente leitura)" entra com a transferência ao Comercial (Fase 5).
- **Fora do escopo, o lead parece não existir** (404, sem revelar que existe) e a tentativa é registrada como `access.denied` na auditoria, gravada fora da transação para sobreviver ao rollback. Na verificação de duplicidade, um lead fora do escopo aparece só com o código, para evitar o cadastro duplicado sem expor os dados.

### 4.2 Matriz de permissões (inicial)

| Ação | ADMIN | GESTOR | SDR | COMERCIAL |
|---|:-:|:-:|:-:|:-:|
| Ver/editar leads no escopo | ✅ | ✅ | ✅ | ✅ |
| Criar lead manualmente | ✅ | ✅ | ✅ | ✅ |
| Importar planilhas | ✅ | ✅ | ⚙️ (configurável) | ❌ |
| Atribuir/redistribuir leads | ✅ | ✅ | ❌ (só "puxar do pool") | ❌ |
| Ações em massa | ✅ | ✅ | ⚙️ (nos próprios leads) | ❌ |
| Criar e editar tags (aplicar tags existentes: todos) | ✅ | ✅ | ❌ | ❌ |
| Decidir duplicados (mesclar) | ✅ | ✅ | ⚙️ | ❌ |
| Gerar e aprovar mensagens com IA | ✅ | ✅ | ✅ | ✅ |
| Registrar opt-out | ✅ | ✅ | ✅ | ✅ |
| **Revogar** item da Lista Não Contatar | ✅ | ❌ | ❌ | ❌ |
| Alterar base legal/opt-in | ✅ | ✅ | ⚙️ (com evidência) | ❌ |
| Exportar leads | ✅ | ✅ | ❌ | ❌ |
| Configurar pipeline, score, cadência | ✅ | ❌ | ❌ | ❌ |
| Gerenciar usuários | ✅ | ⚙️ (sua equipe) | ❌ | ❌ |
| Ver auditoria | ✅ | ⚙️ (sua equipe) | ❌ | ❌ |
| Anonimizar lead / atender titular | ✅ | ❌ | ❌ | ❌ |
| Configurar integrações | ✅ | ❌ | ❌ | ❌ |

⚙️ = definido em configuração; padrão conservador.

### 4.3 Aplicação

- `authorize(actor, action, resource)` em **todo caso de uso**. A UI esconde botões só por conveniência.
- Consultas de lista sempre aplicam o escopo do ator (previne IDOR).
- Negações geram `audit_logs` com `action = ACCESS_DENIED`.
- Testes de integração para cada linha da matriz.

---

## 5. Segredos

- Somente em **variáveis de ambiente** (Render *environment groups*) ou cofre. Modelo em [`.env.example`](../.env.example), sem valores reais.
- `.gitignore` bloqueia `.env*` (exceto `.env.example`).
- **gitleaks** no CI e *push protection* de segredos no GitHub.
- Variáveis validadas na inicialização (schema Zod); a aplicação não sobe com configuração inválida.
- Credenciais de integração eventualmente salvas no banco (ex.: tokens OAuth por usuário, Fase 12) ficam **criptografadas** com AES-256-GCM (`ENCRYPTION_KEY`).
- Rotação: tokens Meta/Google/IA a cada 90 dias ou após qualquer suspeita; segredos separados por ambiente.
- `SUPPRESSION_HASH_PEPPER` **não pode ser rotacionado** sem plano de migração (os hashes da Lista Não Contatar dependem dele). Guardar cópia segura fora do provedor de hospedagem.
- Pino com `redact` para `authorization`, `cookie`, `*.token`, `*.password`, `*.secret`, telefones e e-mails.

---

## 6. Proteção de dados

- TLS em todo tráfego (HTTPS obrigatório, HSTS).
- Criptografia em repouso do banco e dos backups (recurso do provedor).
- Lista Não Contatar com **HMAC-SHA256 + pepper**: permite verificar sem guardar o valor em claro após anonimização.
- Ambientes não produtivos **só com dados fictícios**; proibido copiar a base de produção para dev/staging.
- Mascaramento na UI quando o perfil não precisa do dado completo (ex.: auditoria mostra `+55 88 9****-9999`).

---

## 7. Validação de entrada e saída

| Risco | Controle |
|---|---|
| Entrada malformada | Zod em toda borda (API, jobs, webhooks, variáveis de ambiente) |
| SQL injection | Prisma parametrizado; SQL manual só com `Prisma.sql`/TypedSQL; DSL de filtros com *whitelist* de campos e operadores |
| XSS | React escapa por padrão; **proibido** `dangerouslySetInnerHTML` com dados de usuário/lead/mensagem; notas em texto simples |
| CSV/Formula injection | Na exportação, prefixar `'` em células que começam com `=`, `+`, `-`, `@`, tab ou CR |
| Open redirect | Redirecionamentos só para rotas internas |
| Mass assignment | Schemas de entrada explícitos por caso de uso |

---

## 8. Upload de arquivos

- Tamanho máximo `IMPORT_MAX_FILE_MB` (padrão 10 MB) e `IMPORT_MAX_ROWS` (padrão 50 mil).
- Tipos aceitos: `.csv`, `.xlsx` (verificação de extensão **e** assinatura do arquivo). `.xlsm`/macros rejeitados.
- XLSX é um ZIP: limite de tamanho descompactado e de número de entradas (proteção contra *zip bomb*).
- Parsing no **worker**, com timeout e memória limitada; leitura em streaming.
- Arquivo processado e **descartado** (não fica em disco nem em bucket no MVP).
- Conteúdo das células tratado como texto (nada é executado ou avaliado).

---

## 9. Webhooks

- Verificação de assinatura (`X-Hub-Signature-256`, HMAC-SHA256 com o *app secret*) em **comparação de tempo constante**, sobre o corpo bruto.
- Handshake de verificação com `META_WEBHOOK_VERIFY_TOKEN`.
- Limite de tamanho do corpo; resposta rápida; processamento assíncrono.
- Idempotência por id do evento (proteção contra replay).
- Assinatura inválida → `401`, registro de segurança, sem processamento.

---

## 10. SSRF (busca de URLs externas)

Se o enriquecimento buscar páginas de sites de leads (futuro):

- Somente `http`/`https`; resolver DNS e **bloquear IPs privados, loopback, link-local e metadados de nuvem** (ex.: `169.254.169.254`), inclusive após redirecionamentos.
- Timeout curto, tamanho máximo de resposta, sem cookies, *user-agent* identificando a Docline.
- Respeitar `robots.txt` e os termos do site.

---

## 11. Cabeçalhos e proteções web

- **CSP** restritiva com nonces; `frame-ancestors 'none'`.
- `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` mínima.
- **CORS fechado** (mesma origem). Integrações usam chaves de API (Fase 12).
- **CSRF:** cookies `SameSite=Lax` + verificação de `Origin` em requisições que alteram estado.
- Respostas de erro sem stack trace nem detalhes internos.

---

## 12. Limites de taxa e abuso

| Recurso | Limite padrão |
|---|---|
| Login | 5 tentativas / 15 min por conta + limite por IP |
| Geração de IA | `AI_MAX_GENERATIONS_PER_USER_PER_DAY` + orçamento mensal |
| Importações | 10 por usuário por hora |
| Exportações | 5 por usuário por dia (auditadas) |
| API (chaves, Fase 12) | Por chave e escopo |
| Primeiros contatos (assistido) | Por SDR/dia (configuração de negócio) |

MVP com uma instância: limites em memória ou no PostgreSQL. Com várias instâncias: PostgreSQL ou Redis.

**Implementado na Fase 1** (Better Auth, contadores no PostgreSQL, valem com várias instâncias):

| Rota | Limite por IP |
|---|---|
| `/sign-in/email` | 10 / 15 min |
| `/request-password-reset` | 5 / h |
| `/reset-password` | 10 / 15 min |
| Demais rotas de autenticação | 100 / min, ou o padrão mais restrito da biblioteca (ex.: troca de senha, 3 / 10 s) |

O limite **por conta** (5 / 15 min) ainda não existe (F2-18). Ele precisa ser desenhado para não virar ferramenta de bloqueio: quem souber o e-mail de um colega não pode trancá-lo para fora (atraso progressivo em vez de bloqueio rígido, alerta ao ADMIN).

**IP do cliente.** O limite por IP só funciona se o IP não puder ser forjado. Regra única, usada pelo rate limit e pela auditoria (`apps/web/src/server/request-meta.ts`):

- Só o `X-Forwarded-For` é lido. `X-Real-IP` e similares são ignorados, porque o cliente pode enviá-los.
- `TRUSTED_PROXIES` lista os proxies da hospedagem (IPs ou CIDRs). A cadeia é lida **da direita para a esquerda**, pulando os proxies confiáveis; o primeiro salto não confiável é o cliente. O primeiro item da cadeia nunca é usado diretamente.
- Sem `TRUSTED_PROXIES`, o cabeçalho só é aceito quando traz um único IP. Com uma cadeia, o IP fica indefinido: a auditoria registra sem IP e o rate limit usa um contador comum à rota, que é mais restritivo (todos dividem o mesmo limite) mas nunca mais permissivo.
- **No primeiro deploy de cada ambiente:** conferir o `X-Forwarded-For` que a hospedagem entrega e configurar `TRUSTED_PROXIES` de acordo. O Better Auth avisa no log quando não consegue determinar o IP (*"Rate limiting could not determine a client IP"*). Sem esse ajuste, um pico de tentativas pode esgotar o contador comum e barrar logins legítimos.
- **Na Render (ADR-019):** segundo relatos de usuários e de um funcionário da Render (não há documentação oficial), ela **acrescenta** itens ao `X-Forwarded-For` enviado pelo cliente, em vez de substituí-lo. Então as requisições devem chegar com uma cadeia, e sem `TRUSTED_PROXIES` **todos os usuários dividiriam o mesmo limite de 10 logins a cada 15 minutos**. Lá, configurar a lista no primeiro deploy é obrigatório.

---

## 13. Segurança da IA

- Contexto mínimo; sem segredos nem dados desnecessários no prompt.
- Conteúdo de terceiros delimitado e tratado como dado; o modelo não tem ferramentas nem executa ações.
- Saída validada por schema e por regras determinísticas; aprovação humana obrigatória.
- Cotas por usuário e orçamento mensal contra abuso de custo.
- Prompts e respostas não vão para logs de aplicação.
- Detalhes em [AI-SDR §9](./AI-SDR.md#9-guardrails).

---

## 14. Auditoria e monitoramento

- `audit_logs` append-only: trigger no banco bloqueia `UPDATE`/`DELETE`; o usuário da aplicação não tem permissão de DDL em produção.
- Eventos de segurança: login com falha, 2FA, mudança de perfil/permissão, exportação, revogação de supressão, anonimização, acesso negado, assinatura de webhook inválida.
- **Sentry** para exceções (sem dados pessoais no contexto); alertas de jobs em *dead letter*; monitor de disponibilidade em `/api/health`.
- Relatório mensal de acessos e exportações para gestor e encarregado.

---

## 15. Dependências e cadeia de suprimentos

- `pnpm-lock.yaml` versionado; instalação com `--frozen-lockfile`.
- pnpm bloqueia scripts de instalação de dependências por padrão; liberar só os necessários (`onlyBuiltDependencies`).
- Atraso mínimo para adotar versões recém-publicadas (`minimumReleaseAge` do pnpm, quando disponível), contra pacotes comprometidos.
- Renovate ou Dependabot com revisão humana; `pnpm audit` no CI.
- GitHub Actions fixadas por SHA; permissões mínimas no `GITHUB_TOKEN`.
- Evitar pacotes abandonados ou com vulnerabilidades conhecidas (ex.: `xlsx` do npm; ver [ARCHITECTURE §4](./ARCHITECTURE.md#4-análise-da-stack)).

---

## 16. Infraestrutura

- Ambientes separados (local, staging, produção) com credenciais distintas.
- Banco com usuário da aplicação sem privilégios de DDL; migrações com usuário próprio no *pre-deploy*.
- Rede privada entre serviços quando o provedor oferecer; banco sem acesso público ou com allowlist.
- Backups diários com recuperação a um ponto no tempo; **teste de restauração trimestral**.
- 2FA obrigatório nas contas de GitHub, Render, Meta, Google Cloud e provedor de IA.
- Imagens Docker mínimas, sem segredos embutidos, executando como usuário não-root.

---

## 17. Resposta a incidentes

1. **Detectar e registrar:** quem detectou, quando, o quê.
2. **Conter:** revogar tokens e sessões, pausar integrações (`*_PROVIDER=disabled`), bloquear contas.
3. **Avaliar:** dados e titulares afetados, período, causa.
4. **Comunicar:** encarregado/jurídico → ANPD e titulares quando aplicável ([LGPD §15](./LGPD.md#15-incidentes-de-segurança)).
5. **Corrigir a causa raiz** e adicionar teste/controle que impeça a repetição.
6. **Pós-mortem** sem culpados, registrado em `docs/`.

---

## 18. Checklist por fase

**Fase 1 — Fundação (MUST)**
- [x] `.env.example` sem segredos; `.gitignore` com `.env*`; gitleaks no CI.
- [x] Validação de variáveis de ambiente na inicialização.
- [x] Better Auth com convite, política de senha, rate limit de login (por IP; por conta em F2-18), cookies seguros.
- [x] RBAC com matriz testada; auditoria append-only.
- [x] Cabeçalhos de segurança, CSP, CSRF.
- [x] Logs com mascaramento.
- [ ] Sentry para erros (F2-17; depende da conta da Docline).
- [ ] Staging: configurar `TRUSTED_PROXIES` após conferir o `X-Forwarded-For` da hospedagem (§12).

**Fases 2–6 — MVP (MUST)**
- [ ] Escopo por perfil em todas as listas e detalhes (testes de IDOR).
- [ ] Upload seguro (limites, zip bomb, sem persistência).
- [ ] Exportação restrita, auditada e protegida contra CSV injection.
- [ ] Guardrails de IA e cotas.
- [ ] Backups e restauração testados antes do go-live.
- [ ] 2FA para ADMIN/GESTOR (SHOULD).

**Fases 7+ — Integrações**
- [ ] 2FA obrigatório para ADMIN/GESTOR.
- [ ] Webhooks com assinatura, idempotência e limites.
- [ ] Tokens com menor privilégio e rotação.
- [ ] Proteção SSRF antes de qualquer busca de URL externa.
- [ ] Chaves de API com escopos e revogação (Fase 12).

**Todo PR**
- [ ] Nenhum segredo, dado real ou planilha real no diff.
- [ ] Novas rotas com autorização e teste.
- [ ] Novas entradas validadas por schema.
