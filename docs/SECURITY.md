# Segurança — Docline SDR

> **Status:** baseline da Fase 0; controles da Fase 1 implementados em 2026-10-08; webhook do WhatsApp e credenciais da Meta na Fase 7 e webhook do Instagram na Fase 8, em 2026-10-09 (ver [§18](#18-checklist-por-fase)). Aplica-se desde o primeiro commit de código.
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
| Força bruta | Limite por IP e por conta; atraso progressivo; alerta em picos (por conta desde a Fase 2, ver §12) |
| Redefinição de senha | Token de uso único, curto (≤ 30 min), invalida sessões anteriores |
| 2FA | TOTP obrigatório para ADMIN e GESTOR (SHOULD no MVP, MUST antes das Fases 7–9). *Desde a Fase 2:* disponível para todos em "Minha conta". *Desde a 0.7.1:* **obrigatória de fato** — ADMIN/GESTOR sem 2FA só acessam "Minha conta" até ativar (ver notas abaixo) |
| SSO | Opcional futuro: Google Workspace da Docline |

**Verificação em duas etapas (Fase 2, F2-16).** Plugin `two-factor` do Better Auth, só com aplicativo autenticador (TOTP: SHA-1, 30 s, 6 dígitos). Não há código por e-mail.

| Etapa | Como funciona |
|---|---|
| Ativar | Em "Minha conta": senha → QR code (desenhado em SVG, sem imagem externa) ou chave → primeiro código válido. Só então a verificação passa a valer. Ficam 10 códigos de recuperação, cada um de uso único e mostrados uma única vez. |
| Login | A senha certa abre um desafio de 10 min (cookie assinado), e a sessão só é criada com o código do aplicativo ou um código de recuperação. 10 códigos errados seguidos bloqueiam a verificação da conta por 15 min; isso exige saber a senha, então não serve para trancar um colega. |
| Armazenamento | Segredo e códigos de recuperação cifrados com `BETTER_AUTH_SECRET` na tabela `two_factors`. **Trocar esse segredo invalida a 2FA de todos**, que precisarão reativar. |
| Auditoria | `auth.2fa_enabled`, `auth.2fa_disabled`, `auth.2fa_backup_codes` e `auth.2fa_challenge` (senha certa, aguardando código). O `auth.login` só é gravado depois do segundo fator. Código errado vira `auth.login_failed` com motivo `2FA_…`. |
| Desativar | Exige a senha e fica auditado. |
| Perda do celular | Usa-se um código de recuperação. Sem eles, o ADMIN redefine em Equipe → "Redefinir 2FA": o segredo é apagado, as sessões são encerradas e a ação fica auditada (`user.2fa_reset`). Antes, confirme a identidade da pessoa por outro canal. |

**Bloqueio sem 2FA (0.7.1, ADR 024).** Com `TWO_FACTOR_ENFORCEMENT=required` (padrão, e o único valor aceito em staging e produção), ADMIN e GESTOR sem a verificação ativada continuam entrando com a senha, mas o acesso fica restrito a "Minha conta":

| Onde | O que acontece |
|---|---|
| Páginas | Qualquer página leva a "Minha conta" (conferido em cada página, porque o layout não roda de novo na navegação). Menu e avisos ficam ocultos; uma faixa explica o motivo. |
| API v1 | `403` com `code: TWO_FACTOR_REQUIRED` em todas as rotas autenticadas. |
| Liberado | Rotas de autenticação do Better Auth (`/api/auth/*`), que incluem ativar a 2FA e sair. |
| Quando vale | Assim que o perfil exige: primeiro acesso de um convidado ADMIN/GESTOR, SDR promovido a GESTOR, 2FA redefinida pelo ADMIN ou desativada pela própria pessoa (a troca de celular é desativar e ativar de novo). |
| SDR e Comercial | Não são afetados (2FA opcional). |
| Fora de staging/produção | `reminder` mantém só o lembrete; serve ao desenvolvimento e à suíte E2E, que entra como ADMIN dezenas de vezes. Um segundo servidor E2E roda com `required` e testa o bloqueio. |

A regra (`twoFactorGate`, em `packages/core/src/modules/identity/domain/roles.ts`) é aplicada na borda web (`getPageContext` e `apiHandler`), onde está a sessão; os casos de uso não mudam. **Último recurso:** se o único ADMIN perder o celular e os códigos de recuperação, o suporte cria outro ADMIN pelo Shell do serviço (`pnpm admin:create`), que redefine a 2FA do primeiro.

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
- **Fase 5:** o **COMERCIAL** vê os leads atribuídos a ele e os leads das oportunidades em que é o comercial responsável. O SDR continua responsável pelo lead depois da transferência e mantém o acesso; o bloqueio de edição (somente leitura) fica para a Fase 6. Aceitar, ganhar e perder a oportunidade são ações do comercial dela, do gestor e do ADMIN.
- **Fase 6:** com oportunidade aberta ou ganha, o **SDR fica só com consulta** no lead (`handoffReadOnlyReason`, conferido em toda escrita por `requireEditableLead`); a ficha avisa e esconde as ações. Opt-out e pedidos de titular continuam possíveis. Se a oportunidade for perdida, o SDR volta a editar.
- **Fora do escopo, o lead parece não existir** (404, sem revelar que existe) e a tentativa é registrada como `access.denied` na auditoria, gravada fora da transação para sobreviver ao rollback. Na verificação de duplicidade, um lead fora do escopo aparece só com o código, para evitar o cadastro duplicado sem expor os dados.

### 4.2 Matriz de permissões (inicial)

| Ação | ADMIN | GESTOR | SDR | COMERCIAL |
|---|:-:|:-:|:-:|:-:|
| Ver/editar leads no escopo | ✅ | ✅ | ✅ | ✅ |
| Criar lead manualmente | ✅ | ✅ | ✅ | ✅ |
| Importar planilhas | ✅ | ✅ | ⚙️ (configurável) | ❌ |
| Prospecção na base aberta do CNPJ: buscar, ver o potencial por cidade, aprovar (vira lead) e recusar (`prospecting.run`) | ✅ | ✅ | ❌ | ❌ |
| Completar um lead com os dados abertos do CNPJ (no escopo) | ✅ | ✅ | ✅ | ✅ |
| Carga da base aberta do CNPJ: rodar, acompanhar e configurar | ✅ | ❌ | ❌ | ❌ |
| Atribuir/redistribuir leads | ✅ | ✅ | ❌ (só "puxar do pool") | ❌ |
| Ações em massa | ✅ | ✅ | ⚙️ (nos próprios leads) | ❌ |
| Criar e editar tags (aplicar tags existentes: todos) | ✅ | ✅ | ❌ | ❌ |
| Decidir duplicados (mesclar) | ✅ | ✅ | ⚙️ | ❌ |
| Gerar e aprovar mensagens com IA; pedir sugestão de classificação | ✅ | ✅ | ✅ | ✅ |
| Ver o dashboard (SDR e Comercial: só os próprios números) | ✅ | ✅ | ✅ | ✅ |
| Relatórios da equipe, exportação CSV dos relatórios e custos da IA (`report.read`) | ✅ | ✅ | ❌ | ❌ |
| Configurar a IA (base de conhecimento, abordagens, regras dos rascunhos) | ✅ | ❌ | ❌ | ❌ |
| Registrar opt-out | ✅ | ✅ | ✅ | ✅ |
| Consultar a Lista Não Contatar (valores mascarados) | ✅ | ✅ | ❌ | ❌ |
| **Revogar** item da Lista Não Contatar | ✅ | ❌ | ❌ | ❌ |
| Alterar base legal/opt-in | ✅ | ✅ | ⚙️ (com evidência) | ❌ |
| WhatsApp pela API: enviar, tentar de novo, registrar opt-in com a mensagem do contato como evidência, revogar opt-in (no escopo) | ✅ | ✅ | ✅ | ✅ |
| WhatsApp pela API: registrar opt-in por outro meio (formulário, verbal, contrato…) | ✅ | ✅ | ❌ | ❌ |
| Decidir mensagens de números sem lead (vincular, procurar de novo, descartar) | ✅ | ✅ | ❌ | ❌ |
| Modelos do WhatsApp (vincular a abordagem, ativar) e tabela de custo | ✅ | ❌ | ❌ | ❌ |
| Sincronizar modelos, checar o número e ver o painel do WhatsApp | ✅ | ❌ | ❌ | ❌ |
| Instagram pela API: responder na janela, resposta privada a comentário, tentar de novo, atualizar métricas do perfil (no escopo) | ✅ | ✅ | ✅ | ✅ |
| Decidir mensagens no Instagram de quem não é lead (vincular, procurar de novo, descartar) | ✅ | ✅ | ❌ | ❌ |
| Configuração do Instagram (consulta de perfis, automação), verificar a conta e ver o painel | ✅ | ❌ | ❌ | ❌ |
| Exportar leads | ✅ | ✅ | ❌ | ❌ |
| Mover leads entre etapas abertas, para perda (com motivo) e reativar "Sem resposta" | ✅ | ✅ | ✅ | ✅ |
| Mover para etapas das automações, converter ou reabrir lead ganho/perdido (auditado como correção) | ✅ | ✅ | ❌ | ❌ |
| Registrar contatos, respostas e tarefas; inscrever em cadência; transferir ao Comercial | ✅ | ✅ | ✅ (só consulta depois da transferência) | ✅ |
| Aceitar a transferência e marcar ganho ou perda | ✅ | ✅ | ❌ | ✅ (as dele) |
| Ver a Minha Fila de outra pessoa (só consulta) | ✅ | ✅ | ❌ | ❌ |
| Configurar pipeline, score, cadência e regras de contato (horário, limites, palavras de opt-out) | ✅ | ❌ | ❌ | ❌ |
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
- **Meta (Fase 7):** token de *System User* com só `whatsapp_business_messaging` e `whatsapp_business_management`, nunca token pessoal. `META_APP_SECRET` assina os webhooks: vazou, troca no app Meta e no ambiente ao mesmo tempo. O adaptador não coloca token, número nem texto em erros ou logs; o token vai só no cabeçalho `Authorization`. Fora de produção, envio real só com `ALLOW_REAL_SENDS=true`, e o simulador de webhooks recusa rodar com `meta_cloud`.
- **Instagram (Fase 8):** token **da Página** (`INSTAGRAM_PAGE_ACCESS_TOKEN`), gerado por um usuário do sistema com acesso só à Página da Docline e às permissões do App Review (INTEGRATIONS §16.2); o mesmo `META_APP_SECRET` assina os webhooks dos dois canais. O adaptador segue as mesmas regras (token só no cabeçalho, nada de token, @ ou texto em erros e logs, `ALLOW_REAL_SENDS` fora de produção); o simulador recusa rodar com `meta_graph`.
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

> **Implementado na Fase 3** (`packages/integrations/src/spreadsheet`, ADR-020):
> - **Formatos:** `.csv`, `.txt` e `.xlsx`, conferindo extensão e assinatura. `.xls` (formato OLE), `.xlsm`/`.xltm` e XLSX com `vbaProject.bin` são recusados.
> - **Zip bomb:** antes de descompactar, no máximo 2.000 entradas e um total declarado de até 30× o arquivo (teto de 250 MB). Cada entrada é descompactada num buffer do tamanho declarado, então quem mente o tamanho é cortado, não cresce.
> - **XML:** lido em streaming, sem DTD (documento com `DOCTYPE` é recusado).
> - **Timeout:** a leitura tem tempo máximo.
> - **Arquivo descartado:** os bytes ficam em `import_files` só até a leitura no worker e são apagados na mesma transação que grava as linhas.

---

## 9. Webhooks

- Verificação de assinatura (`X-Hub-Signature-256`, HMAC-SHA256 com o *app secret*) em **comparação de tempo constante**, sobre o corpo bruto.
- Handshake de verificação com `META_WEBHOOK_VERIFY_TOKEN`.
- Limite de tamanho do corpo; resposta rápida; processamento assíncrono.
- Idempotência por id do evento (proteção contra replay).
- Assinatura inválida → `401`, registro de segurança, sem processamento.

> **Implementado na Fase 7** (`/api/webhooks/whatsapp`, `packages/integrations/src/whatsapp/signature.ts`):
> - A rota é pública (sem sessão e fora da checagem de `Origin` da API v1): a autenticidade vem só da assinatura, conferida sobre os **bytes exatos** recebidos, com `timingSafeEqual` e formato `sha256=<64 hex>` estrito. Só depois disso o corpo é lido como JSON.
> - Corpo acima de 1 MB → `413` (pelo `Content-Length` e de novo pelo tamanho lido). Formato inválido → `400`. O registro de assinatura inválida leva IP e `requestId`, nunca o conteúdo.
> - Verificação do endpoint só com `hub.mode=subscribe`, token igual a `META_WEBHOOK_VERIFY_TOKEN` (comparação em tempo constante) e `hub.challenge` curto, devolvido como texto puro.
> - Sem o provedor configurado (`assisted`), a rota responde `404`: não há superfície exposta no modo assistido.
> - Replay: a inbox é idempotente pelo SHA-256 do corpo, e cada efeito (status, mensagem recebida) também; uma entrega repetida não muda nada.
> - Mensagens recebidas são **dados de terceiros**: aparecem como texto (React escapa), entram na IA só delimitadas (§13) e nunca criam lead sozinhas.
>
> **Fase 8:** `/api/webhooks/instagram` usa a mesma verificação e os mesmos limites (mesmo app da Meta). Eventos de outra conta, mensagens de teste e apagadas são ignorados; comentários e ecos só alteram leads e conversas já existentes.

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

**Limite por conta (Fase 2, F2-18).** Não vira ferramenta de bloqueio: quem souber o e-mail de um colega não consegue trancá-lo para fora.

| Regra | Como funciona |
|---|---|
| Contador | Por **conta + IP**. Se o navegador já entrou nessa conta antes, o contador é **daquele dispositivo**: um cookie assinado (`docline.login_device`, HttpOnly, só em `/api/auth`, 1 ano) é emitido após login bem-sucedido. Assim, nem um colega no mesmo escritório (mesmo IP público) atrasa o dono da conta. |
| Atraso progressivo | Até 4 falhas em 15 min, sem espera. Da 5ª em diante: 30 s, 1 min, 2 min, 4 min, 8 min e no máximo 15 min entre tentativas. Durante a espera a senha nem é conferida, e a tentativa barrada é auditada (`auth.login_failed`, motivo `THROTTLED`) sem somar no contador. |
| Sem bloqueio rígido | A espera nunca passa de 15 min, e login certo zera o contador. |
| Alerta | 20 falhas na mesma conta em 15 min, somando todos os IPs e dispositivos, geram auditoria `auth.login_alert` e e-mail aos ADMIN ativos, uma vez por janela, com o e-mail da conta mascarado. |
| Sem enumeração | Vale igual para e-mails que não existem. |
| Armazenamento | Tabela `login_throttles`, com chaves derivadas do HMAC do e-mail (nunca o e-mail em claro). Linhas paradas há mais de 1 dia são apagadas. |

Risco residual: um navegador **novo** do dono da conta, no mesmo IP de quem está errando a senha, espera junto (no máximo 15 min). O alerta ao ADMIN cobre esse caso.

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

> **Implementação (Fase 6).**
> - O provedor real fica **desligado por padrão** (`AI_PROVIDER=fake`): nenhum dado sai para terceiros até a Docline decidir (transferência internacional, [LGPD](./LGPD.md)). A chave vem só de `AI_API_KEY`.
> - Contexto por lista branca; telefones, e-mails e links do histórico e das instruções do SDR são trocados por marcadores antes de ir ao modelo. Texto de terceiros entra entre marcas e não consegue fechá-las (`<` e `>` viram `‹` e `›`).
> - Guardrails bloqueantes (termo proibido, dado de contato, valor fora dos fatos) impedem aprovar; o texto aprovado passa de novo pelo gate de contato. A sugestão de classificação nunca altera a resposta sozinha.
> - O conjunto de avaliação (AI-SDR §14) mede injeção obedecida, marcador vazado e presença local inventada; a CI roda com o provedor falso, e o real só com `--yes` e dados fictícios.
> - Cota diária por pessoa (falhas contam), orçamento mensal com aviso em 80% e bloqueio em 100%; tudo registrado em `ai_generations` e na auditoria.

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
- [x] Better Auth com convite, política de senha, rate limit de login (por IP e, desde a Fase 2, por conta com atraso progressivo), cookies seguros.
- [x] RBAC com matriz testada; auditoria append-only.
- [x] Cabeçalhos de segurança, CSP, CSRF.
- [x] Logs com mascaramento.
- [x] Sentry para erros (F2-17): pronto e opcional por `SENTRY_DSN`, sem dados pessoais; falta só criar a conta da Docline e configurar o DSN.
- [ ] Staging: configurar `TRUSTED_PROXIES` após conferir o `X-Forwarded-For` da hospedagem (§12).

**Fases 2–6 — MVP (MUST)**
- [x] Escopo por perfil em todas as listas e detalhes (testes de IDOR): leads, listas, exportação, pipeline, tarefas, oportunidades, IA e indicadores; acesso fora do escopo responde 404 e fica na auditoria.
- [x] Upload seguro (limites, zip bomb, sem persistência): Fase 3, com testes do leitor de planilhas.
- [x] Exportação restrita, auditada e protegida contra CSV injection (Fase 2: só ADMIN/GESTOR, 5 por dia, até 20.000 leads, contatos só quando pedidos e nunca os da Lista Não Contatar).
- [x] Guardrails de IA e cotas (Fase 6, §13).
- [ ] Backups e restauração testados antes do go-live.
- [x] 2FA para ADMIN/GESTOR (SHOULD): TOTP com códigos de recuperação e lembrete persistente (Fase 2). O bloqueio de acesso sem 2FA entrou na 0.7.1 (§3).

**Revisão de segurança da Fase 6 (F6-10)**
- Rotas novas (`/ai/*`, `/approaches`, `/analytics/*`) passam pelo `apiHandler` (sessão, CSRF nas que alteram, Zod) e pelos casos de uso com permissão e escopo; o SDR vê só os próprios números, e gestão e ADMIN filtram por pessoa.
- Depois da transferência ao Comercial, o SDR fica só com consulta no lead (§4.1); opt-out e pedidos de titular continuam possíveis.
- A exportação de relatórios é um `GET` com efeito só de auditoria: sem dado pessoal além do nome de quem trabalha na equipe, células protegidas contra CSV injection e nome de arquivo só ASCII.
- Consultas de indicadores medidas com 100 mil leads (ARCHITECTURE §13): até ~1,3 s no pior caso (366 dias), aceitável para usuários autenticados sem limite próprio de taxa por enquanto.
- Script de desempenho só aceita bancos `*_perf` (nome com padrão fechado, porque entra em `DROP DATABASE`).
- `pnpm audit --prod` sem vulnerabilidades altas; o SDK da Anthropic entra só no pacote de integrações.

**Revisão de segurança da Fase 7 (WhatsApp)**
- Rotas novas da API v1 (`/leads/:id/whatsapp*`, `/messages/:id/retry`, `/conversations`, `/whatsapp/*`) passam pelo `apiHandler` (sessão, CSRF nas que alteram, Zod) e pelos casos de uso com permissão e escopo (matriz §4.2). Lead fora do escopo continua 404.
- O webhook é a única rota pública nova (§9); o caso de uso que grava a inbox é `public` e confia na rota para a assinatura, então não há outro caminho até ele.
- O gate de contactabilidade é conferido ao pedir o envio **e de novo no worker**, imediatamente antes de chamar a Meta (opt-out registrado no meio do caminho barra o envio).
- Sem reenvio automático (ADR 022): um erro do nosso lado não vira mensagem duplicada no celular do contato.
- Testes: assinatura (corpo exato, segredo, cabeçalho ausente ou fora do formato), verificação do endpoint (unitários e E2E), webhook repetido, status fora de ordem, status que corrige um envio de resultado incerto, gate por número conferido de novo no envio, 131050 → supressão e opt-in revogado.
- O **bloqueio de acesso de ADMIN/GESTOR sem 2FA**, prometido para antes da Fase 7, ficou de fora da 0.7.0 e entrou logo depois, na 0.7.1 (§3).

**Revisão de segurança da Fase 8 (Instagram)**
- Rotas novas da API v1 (`/leads/:id/instagram*`, `/instagram/*`) passam pelo `apiHandler` e pelos casos de uso com permissão e escopo; a resposta privada confere o lead do comentário (escopo e edição) e o gate do contato.
- O webhook é a única rota pública nova (§9), com a mesma assinatura do WhatsApp; o `@` de quem escreve vem do perfil na Meta pelo IGSID (consulta do worker, fora da transação), nunca de texto livre do corpo.
- Só responder: o gate do modo API exige a janela aberta naquele @; a resposta privada passa pelo gate do contato assistido. Prazos da Meta e gate são conferidos de novo no worker. Sem reenvio automático (ADR 022).
- Consulta de perfis (Business Discovery): o @ é validado antes de entrar na URL (só letras, números, ponto e sublinhado; até 30), a seleção é SQL parametrizado e há teto por hora; nada além de três números públicos é gravado.
- Testes: webhook (verificação, assinatura, E2E), ecos e conciliação de resultado incerto, comentários de quem não é lead não gravados, anonimização apagando comentários, métricas, payloads (pelo @ e pelo IGSID) e mensagens de quem não era lead.

**Fases 7+ — Integrações**
- [x] 2FA obrigatório para ADMIN/GESTOR: sem 2FA, só "Minha conta" (0.7.1, §3).
- [x] Webhooks com assinatura, idempotência e limites (Fase 7 e Fase 8, §9).
- [ ] Tokens com menor privilégio e rotação: definido para a Meta (§5, WhatsApp e Instagram); falta criar os usuários do sistema e agendar a rotação na ativação.
- [ ] Proteção SSRF antes de qualquer busca de URL externa.
- [ ] Chaves de API com escopos e revogação (Fase 12).

**Todo PR**
- [ ] Nenhum segredo, dado real ou planilha real no diff.
- [ ] Novas rotas com autorização e teste.
- [ ] Novas entradas validadas por schema.
