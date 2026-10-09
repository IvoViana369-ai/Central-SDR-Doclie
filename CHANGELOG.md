# Changelog

Registro do que foi entregue em cada fase do [roadmap](docs/ROADMAP.md). Formato inspirado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [Não lançado]

## [0.5.0] — Fase 5: Fila e follow-ups — 2026-10-09

Aceite da fase (MVP M10, M11, M13, M14 e M15) coberto pela jornada E2E `fase5.spec.ts` e pelas suítes de cadência e opt-out. Totais: 317 testes unitários, 155 de integração e 30 jornadas E2E.

### Adicionado

- **Banco:** tarefas, atividades, mensagens, cadências (passos e inscrições), oportunidades e avisos. Índices parciais garantem uma inscrição em andamento por lead, uma oportunidade aberta por lead, uma tarefa aberta por passo e uma cadência padrão. O seed cria a cadência "Padrão — Contabilidade" (D0, D2, D5 e D10).
- **Tarefas e atividades (F5-01, F5-02):** criar, reagendar, concluir com resultado e cancelar. Ligação, reunião e visita registradas, com duração e resultado; ligação atendida e reunião realizada contam como contato.
- **Calendário útil (F5-03):**
  - dias úteis com feriados nacionais, estaduais e municipais;
  - fuso do lead (município, UF ou `America/Fortaleza`);
  - janela de horário, com fim "24:00" permitido.
- **Motor de cadência (F5-04, F5-05):**
  - cada passo vira tarefa, e concluí-la move o lead para a etapa do passo e agenda o próximo a partir da execução real;
  - depois do último passo, o job `cadence.tick` leva o lead a "Sem resposta";
  - pausar (com retomada automática), retomar, encerrar e pular passo;
  - parada automática por resposta, opt-out, bloqueio, arquivamento, mesclagem, mudança manual de etapa ou falta de contato válido.
- **Configuração de cadências (F5-06):** passos, canal, ação, etapa de destino, janela, dias úteis e prazo de "Sem resposta", com versão; escolha da cadência padrão.
- **Minha Fila (F5-07):**
  - seções: respostas com prazo, atrasados, envios a confirmar, hoje, quentes, novos, esquecidos, aguardando resposta e oportunidades;
  - prioridade calculada na leitura e ações rápidas no item;
  - gestor e ADMIN consultam a fila de outra pessoa.
- **Gate completo (F5-08):** janela de horário, intervalo mínimo entre contatos (exceto ao responder quem escreveu) e limite diário de primeiros contatos por SDR. Quando só o horário impede o contato, informa quando ele fica liberado.
- **Contato assistido (F5-09):**
  - links `wa.me` com o texto, Instagram (copiar o texto e abrir o perfil) e e-mail;
  - o envio só conta com a confirmação; sem ela, fica pendente;
  - envio feito fora do sistema pode ser registrado;
  - o passo de cadência vencido é cumprido pelo envio.
- **Respostas (F5-10):**
  - registro da resposta colada pelo SDR, com classificação na hora ou depois;
  - detecção de opt-out: certo (Lista Não Contatar na hora) ou possível (tarefa para decidir);
  - tarefas e etapas por classificação; "Ausente" pausa a cadência.
- **Jobs e avisos (F5-11):** `tasks.overdue-scan` (tarefas atrasadas e transferências sem aceite) e `leads.forgotten-scan` (leads esquecidos); sino de avisos no topo.
- **Transferência ao Comercial (F5-12):**
  - checklist de qualificação e oportunidade com prazo de aceite;
  - aviso e tarefa para o comercial;
  - aceite, ganho (parceiro ou cliente, lead em "Convertido") e perda com motivo.
- **Puxar do pool (F5-13):** 5 leads por vez do território, com trava contra dois SDRs pegarem o mesmo.
- **Telas:**
  - `/fila` e `/mensagens`;
  - na ficha do lead: próximas ações, cadência, mensagens e respostas, e Comercial;
  - `/configuracoes/cadencias` e `/configuracoes/contato` (regras de contato e palavras de opt-out).
- **API v1:** 34 rotas da Fase 5 (ARCHITECTURE §9.2).

### Alterado

- **Botões de WhatsApp, Instagram e e-mail da ficha** abrem o contato assistido em vez de links diretos, para o envio ficar registrado. "Ligar" segue com `tel:`.
- **Score:** "Já respondeu" e "Mostrou interesse" passam a pontuar.
- **Escopo do perfil Comercial:** inclui os leads das oportunidades em que ele é o comercial responsável.
- **Arquivar, mesclar e anonimizar** encerram a cadência e cuidam das tarefas, mensagens e oportunidades do lead. A mesclagem é recusada quando os dois leads têm oportunidade aberta.
- **Dashboard e menu:** Minha Fila e Mensagens disponíveis; próximas entregas a partir da Fase 6.

### Decidido

- **Nada é enviado automaticamente.** O modo assistido abre o app com o texto; quem envia é a pessoa, e a mensagem fica registrada.
- **Opt-out certo vence a classificação escolhida.** Na dúvida, uma pessoa decide; nada é bloqueado ou excluído por suposição.
- **Resposta sem classificação** encerra a cadência e cria a tarefa "Classificar e responder".
- **Prazo de resposta (SLA)** em horas corridas.
- **Regras de contato** em `app_settings`, com os padrões no código.
- **Editar a cadência** sobe a versão; quem já está nela segue pela posição do passo.
- **Comercial** pode ser alguém com perfil Comercial, Gestor ou Administrador.
- **Timeline e auditoria sem texto livre:** guardam tipos, datas, canais e classificações; títulos, resultados e textos ficam nas tabelas que a anonimização limpa.

### Pendente

- **Confirmação de descadastro ao titular:** depende do jurídico e, no WhatsApp, de template (Fase 7).
- **SDR somente leitura depois da transferência:** Fase 6.
- **Cadência de reativação (90 dias):** não implementada; o tipo de mensagem já existe.
- **Próximo passo no card do Kanban:** a data já é gravada no lead; a exibição fica para a Fase 6.
- **Staging na Render e Sentry:** continuam dependendo da Docline.

## [0.4.0] — Fase 4: Pipeline SDR — 2026-10-09

Aceite da fase (MVP M07 e M08) coberto por jornadas E2E que rodam com o worker de verdade. Totais: 293 testes unitários, 129 de integração e 26 jornadas E2E.

### Adicionado

- **Pipeline e etapas (F4-01):**
  - pipeline padrão com as 17 etapas e os 8 motivos de perda;
  - o seed só cria o que falta, então as edições do ADMIN não são desfeitas no deploy;
  - configuração pelo ADMIN: nome, cor, ordem, SLA, ativação e etapas novas. Nenhuma etapa é excluída; etapas do sistema ou com leads não são desativadas.
- **Kanban (F4-02):**
  - colunas com contagem e cards por prioridade (score, depois tempo na etapa), paginados por coluna;
  - o card mostra score e faixa, dias na etapa, SLA vencido, responsável e selos de WhatsApp, Instagram e Não contatar;
  - filtros por responsável, UF, cidade, faixa, origem e tag, e busca;
  - arrastar e soltar com as regras de transição; durante o arraste, os desfechos aparecem numa barra fixa;
  - botão "Mover" acessível pelo teclado;
  - lock otimista: se outra pessoa alterou o lead, o card volta e o quadro recarrega.
- **Regras e histórico (F4-03):**
  - entre etapas abertas, qualquer pessoa com acesso ao lead;
  - "Primeiro contato" só registrando o contato;
  - etapas das automações, conversão e reabertura só por gestor ou administrador, auditadas como correção;
  - perda exige motivo;
  - histórico com a duração de cada passagem, na ficha do lead.
- **Pipeline no celular (F4-04):** lista por etapa com seletor, sem arrastar.
- **Lead scoring (F4-05, F4-06):**
  - critérios registrados no código e modelo versionado no banco;
  - normalização `CLAMP` ou `SCALE`; faixas Frio, Morno, Quente e Prioridade;
  - recálculo na transação de quem muda o lead (contatos, cidade, tipo, tags) e no worker para ações em massa;
  - histórico só quando o score ou a faixa mudam;
  - explicação por critério na ficha do lead.
- **Pesos do score (F4-07):** rascunho a partir do modelo ativo, simulação da distribuição por faixa e ativação de versão com recálculo da base no worker.
- **Cidades prioritárias (F4-08):** incluir e retirar (remoção lógica); o score dos leads da cidade é recalculado no worker.
- **API v1:** `pipelines` (4 rotas), `leads/{id}/stage`, `stage-history` e `score`, `loss-reasons`, `scoring/models` (7 rotas) e `priority-cities` (3 rotas).
- **Worker:**
  - jobs `score.recompute-lead` e `score.recompute-all`;
  - na subida, põe em "Novo" os leads sem etapa e calcula o score de quem ainda não tem.

### Alterado

- **Cadastro e importação:** todo lead entra em "Novo", com a primeira passagem no histórico, e sai com o score calculado.
- **Mesclagem:** a etapa vira um campo escolhível; o lead mesclado sai do funil.
- **Filtros (DSL):** novos campos `stage`, `scoreBand` e `score`.
- **Configurações:** atalhos para etapas, score e cidades prioritárias; rótulos de auditoria das ações novas.

### Decidido

- **"Primeiro contato" nunca é manual**, nem para gestor, porque o contato passa pelo gate de contactabilidade.
- **"Convertido"** é marcado por gestor ou administrador até existir oportunidade ganha (Fases 5–6).
- **Motivo "Pediu para não ser contatado"** inclui o lead na Lista Não Contatar na mesma transação.
- **Primeiro cálculo do score** vai só para o histórico do score, sem evento na timeline.
- **Quadro por `POST`**, com a mesma seleção da lista de leads.
- **Critérios ainda sem dado** ("Já respondeu", "Mostrou interesse", "Instagram ativo", avaliações do Google) ficam no modelo e pontuam quando o dado existir. Os dois últimos começam inativos.

### Pendente

- **Staging no ar:** depende da conta da Docline na Render e das credenciais de e-mail.
- **Sentry:** falta criar a conta e configurar o DSN.
- **2FA obrigatória:** bloquear o acesso de ADMIN/GESTOR sem 2FA antes da Fase 7.
- **Próximo passo no card:** depende das tarefas da Fase 5.

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
