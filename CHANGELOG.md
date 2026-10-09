# Changelog

Registro do que foi entregue em cada fase do [roadmap](docs/ROADMAP.md). Formato inspirado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [Não lançado]

## [0.3.0] — Fase 3: Importação, normalização e deduplicação — 2026-10-09

Aceite da fase (MVP M04, M05 e M06) coberto por jornadas E2E que rodam com o worker de verdade. Totais: 278 testes unitários, 113 de integração e 23 jornadas E2E.

### Adicionado

- **Normalização completa (F3-01):**
  - telefone com ramal, prefixo "055" e variantes do `wa_id` do WhatsApp (com e sem o 9º dígito);
  - nomes com capitalização e siglas;
  - cidade e UF casadas com o IBGE (abreviações como "Sta." e cidade ambígua avisada);
  - listas numa célula ("fone1 / fone2");
  - testes de propriedade (fast-check).
- **Leitura segura de planilhas (F3-02):**
  - CSV em UTF-8, Windows-1252 ou UTF-16, com `;`, `,` ou tab;
  - XLSX com várias abas e cabeçalho fora da linha 1;
  - recusa macros, `.xls` e DTD;
  - protegida contra *zip bomb*.
- **Importação (F3-03 a F3-07, F3-13):**
  - mapeamento sugerido pelo nome da coluna, com modelos reutilizáveis e colunas extras em `custom_fields`;
  - lote com origem, data da coleta, base legal, responsável, tags e política de duplicados;
  - prévia com a situação de cada linha: novo, já existe, possível duplicado, repetido no arquivo, Lista Não Contatar, inválido;
  - decisões por linha e por situação;
  - gravação no worker, uma transação por linha (retoma se cair), com relatório final;
  - aviso de arquivo já importado;
  - linhas apagadas depois de 30 dias.
- **Deduplicação (F3-08, F3-10 a F3-12):**
  - sinais por CNPJ e filial, telefone, e-mail (provedor gratuito pesa menos), Instagram, site, nome na mesma cidade e nome parecido (`pg_trgm`, sem termos genéricos: "Contabilidade Silva" × "Contabilidade Souza" não é duplicado);
  - score e confiança (alta, média, baixa);
  - busca ao cadastrar, editar e importar, e varredura diária em blocos por UF;
  - "Manter separados" nunca volta à fila; "Ignorar" volta só com motivo novo;
  - mesclagem campo a campo: tudo vai para o lead que fica e a cópia do outro é guardada, sem exclusão;
  - "Não Contatar", opt-in revogado e decisões anteriores do lead mesclado continuam valendo.
- **Telas (F3-09):** Importar (envio, mapeamento, prévia, progresso e relatório) e Duplicados (fila por confiança e motivo, comparação lado a lado). O lead mesclado mostra o lead em que foi reunido.
- **API v1:** `imports` (10 rotas) e `duplicates` (6 rotas).
- **Worker:** jobs `import.parse`, `import.preview`, `import.commit`, `import.purge`, `dedup.check-lead` e `dedup.scan`, com os dados conferidos antes de rodar.

### Alterado

- **Anonimização:** apaga também os leads mesclados no anonimizado, a cópia guardada na mesclagem, os campos extras e as linhas de importação ainda não purgadas.
- **Cadastro manual:** além do aviso antes de salvar, o lead entra na busca de duplicados por similaridade.
- **E2E:** o Playwright sobe o worker junto com o web.

### Decidido

- **Leitor de XLSX próprio** (fflate 0.8.3 + saxes 6.0.0) em vez do ExcelJS, para controlar os limites contra *zip bomb* e recusar macros ([ADR-020](docs/ARCHITECTURE.md#15-registro-de-decisões-adrs)).
- **Arquivo enviado** fica no banco (`import_files`) só até o worker ler, sem *object storage*.
- **Valor repetido em mais de 20 leads** (ex.: telefone de associação) não conta como sinal de duplicidade.

### Pendente

- **Staging no ar:** depende da conta da Docline na Render e das credenciais de e-mail.
- **Sentry:** falta criar a conta e configurar o DSN.
- **2FA obrigatória:** bloquear o acesso de ADMIN/GESTOR sem 2FA antes da Fase 7.
- **Aviso do `pg`:** o adaptador do Prisma (7.10) dispara consultas em paralelo na mesma conexão, o que o `pg` 8 já marca como obsoleto. Funciona hoje e é revisto quando o `pg` 9 sair.

## [0.2.0] — Fase 2: CRM de leads — 2026-10-09

Aceite da fase (MVP M02, M03, M09 e parte de M14) coberto por jornadas E2E. Totais: 229 testes unitários, 93 de integração e 21 jornadas E2E.

### Adicionado

- **Leads (F2-01 a F2-06, F2-10, F2-12):**
  - cadastro e edição com pessoas, contatos, origem, data da coleta e base legal obrigatórias (com padrão por origem);
  - aviso de duplicidade **antes de salvar**: telefone em qualquer formato, e-mail, Instagram, site e nome parecido na mesma cidade; CNPJ igual bloqueia;
  - detalhe responsivo com `tel:` e `wa.me`, notas fixáveis, tags, timeline append-only e histórico;
  - atribuição com histórico; SDR assume lead do pool do seu território;
  - arquivar e anonimizar (ADMIN).
- **Normalização (F2-02):** telefone em E.164 (9º dígito, DDD inferido da cidade), e-mail, CNPJ numérico e **alfanumérico** (IN RFB 2.229/2024), Instagram e site.
- **Lista (F2-07 a F2-09):**
  - filtros combináveis (DSL validada), busca por nome, código, CNPJ, telefone, e-mail ou @instagram;
  - contagem "N · X contactáveis · Y bloqueados";
  - ações em massa (atribuir, tags) com simulação e token de confirmação;
  - visões salvas.
- **Conformidade (F2-11, F2-15):**
  - Lista Não Contatar por HMAC: não pode ser alterada nem apagada, só revogada pelo ADMIN com motivo;
  - opt-out em 1 clique, que vale para outros leads e reimportações;
  - gate de contato por canal com motivos legíveis;
  - avaliações de legítimo interesse e solicitações de titulares com prazo;
  - tela Conformidade.
- **Exportação auditada (F2-14):**
  - CSV para o Excel, só ADMIN/GESTOR;
  - proteção contra injeção de fórmulas;
  - contatos só quando pedidos e nunca os da Lista Não Contatar;
  - 5 exportações por dia, até 20.000 leads por arquivo.
- **Seed de desenvolvimento (F2-13):** `pnpm db:seed:dev`, com ~2.000 empresas fictícias (5% de duplicados propositais, opt-outs e arquivados). Só roda em `development`.
- **Limite de login por conta (F2-18):**
  - atraso progressivo por conta + IP ou por dispositivo conhecido, sem bloqueio rígido nem como trancar um colega;
  - alerta aos ADMIN em picos.
- **Verificação em duas etapas (F2-16):**
  - TOTP com códigos de recuperação, em "Minha conta";
  - lembrete para ADMIN/GESTOR;
  - ADMIN redefine a 2FA de quem perdeu o celular.
- **Sentry (F2-17):** opcional por `SENTRY_DSN`, para web e worker, sem dados pessoais (e-mails e números mascarados em toda mensagem).
- **API v1:** 40 rotas novas (leads, cadastros, conformidade, `exports`, `users/{id}/reset-two-factor`).
- **Telas:** Leads (lista, cadastro, edição, detalhe), Conformidade, Minha conta, verificação no login e territórios do SDR na Equipe.

### Decidido

- **Hospedagem: Render, região Virginia (EUA)** para staging e produção ([ADR-019](docs/ARCHITECTURE.md#15-registro-de-decisões-adrs)). Antes de dados pessoais reais: cláusulas-padrão da ANPD no DPA da Render e validação jurídica ([LGPD §16](docs/LGPD.md#16-transferência-internacional)).
- **Exportação síncrona:** o arquivo é gerado na resposta e não fica guardado no servidor. O job assíncrono vem quando o volume pedir ([ARCHITECTURE §9.2](docs/ARCHITECTURE.md#92-endpoints-por-módulo)).
- **`SUPPRESSION_HASH_PEPPER` obrigatória** em todos os ambientes, porque o HMAC da Lista Não Contatar depende dela.
- **Sentry 10.75.3** (linha estável) em vez da 11.x, lançada dias antes.

### Pendente

- **Staging no ar:** depende da conta da Docline na Render e das credenciais de e-mail.
- **Sentry:** falta criar a conta e configurar o DSN.
- **2FA obrigatória:** bloquear o acesso de ADMIN/GESTOR sem 2FA antes da Fase 7 (hoje é só um lembrete).

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
