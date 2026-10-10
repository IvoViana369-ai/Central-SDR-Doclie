# Roteiro de UAT, treinamento e go-live do piloto

> **Status:** pronto para uso (F6-11); ativação do WhatsApp pela API (marco M5) na [§11](#11-whatsapp-pela-api-marco-m5) e do Instagram pela API (marco M5b) na [§12](#12-instagram-pela-api-marco-m5b); Prospecção (marco M6) na [§13](#13-base-aberta-do-cnpj-e-prospecção-marco-m6) e Campanhas na [§14](#14-campanhas) · **Última revisão:** 2026-10-10
> Relacionados: [MVP §11](./MVP.md#11-critérios-de-lançamento-go-live-do-piloto) · [ROADMAP](./ROADMAP.md) · [LGPD](./LGPD.md) · [SECURITY](./SECURITY.md) · [AI-SDR](./AI-SDR.md)

O código do MVP (Fases 1 a 6) está pronto e testado com dados fictícios. As Fases 7 e 8 (WhatsApp e Instagram pela API) também estão prontas, mas **o piloto começa no modo assistido**: as APIs são ligadas depois, nos marcos M5 ([§11](#11-whatsapp-pela-api-marco-m5)) e M5b ([§12](#12-instagram-pela-api-marco-m5b)). Este roteiro leva o sistema do staging ao uso real pelo piloto: o que a Docline precisa decidir, como rodar a homologação (UAT), como treinar a equipe, como importar a base real e como voltar atrás se for preciso.

**Regra de ouro:** dados reais só entram em **produção**, depois da validação jurídica. Staging e UAT usam apenas dados fictícios (`pnpm db:seed:dev`).

## Sumário

1. [Papéis](#1-papéis)
2. [Decisões da Docline antes do go-live](#2-decisões-da-docline-antes-do-go-live)
3. [Ambiente: staging e produção](#3-ambiente-staging-e-produção)
4. [Homologação (UAT)](#4-homologação-uat)
5. [IA: ligar ou não no piloto](#5-ia-ligar-ou-não-no-piloto)
6. [Treinamento e guia rápido](#6-treinamento-e-guia-rápido)
7. [Importação da base real](#7-importação-da-base-real)
8. [Dia do go-live e primeira semana](#8-dia-do-go-live-e-primeira-semana)
9. [Plano de volta à planilha](#9-plano-de-volta-à-planilha)
10. [Critérios de sucesso do piloto](#10-critérios-de-sucesso-do-piloto)
11. [WhatsApp pela API (marco M5)](#11-whatsapp-pela-api-marco-m5)
12. [Instagram pela API (marco M5b)](#12-instagram-pela-api-marco-m5b)
13. [Base aberta do CNPJ e Prospecção (marco M6)](#13-base-aberta-do-cnpj-e-prospecção-marco-m6)
14. [Campanhas](#14-campanhas)

---

## 1. Papéis

| Papel | Quem | Responsabilidade |
|---|---|---|
| Patrocinador | Gestão comercial da Docline | Decide o go-live e o fim do piloto |
| Administrador do sistema | 1 pessoa da Docline (perfil ADMIN) | Usuários, configurações, importação, Lista Não Contatar |
| Gestor | 1 pessoa (perfil GESTOR) | Acompanha a fila e os indicadores da equipe |
| SDRs do piloto | 1 a 2 pessoas (perfil SDR) | Usam o sistema no dia a dia e avaliam |
| Jurídico / encarregado (DPO) | Docline | Valida os itens da [LGPD §20](./LGPD.md#20-itens-para-validação-jurídica) |
| Suporte técnico | Equipe de desenvolvimento | Ambiente, monitoramento, correções |

## 2. Decisões da Docline antes do go-live

- [ ] **Validação jurídica** ([LGPD §20](./LGPD.md#20-itens-para-validação-jurídica)): LIA da prospecção B2B, texto da primeira abordagem, política de retenção, aviso de privacidade e canal do encarregado.
- [ ] **Transferência internacional:** cláusulas-padrão (Resolução CD/ANPD nº 19/2024) no DPA da Render e, se a IA for ligada, no do provedor de IA.
- [ ] **Regras de contato** (Configurações → Regras de contato): janela de horário, intervalo entre contatos, primeiros contatos por SDR por dia e palavras de opt-out. Os padrões são 08:00–18:00, 48 h e 40 por dia.
- [ ] **Cadência padrão** (Configurações → Cadências): passos D0/D2/D5/D10, canais e textos de referência.
- [ ] **Origens e bases legais** de cada planilha que será importada ([LGPD §4](./LGPD.md#4-bases-legais-por-origem)).
- [ ] **IA** ligada ou não no piloto ([§5](#5-ia-ligar-ou-não-no-piloto)); se sim, os fatos aprovados da base de conhecimento.
- [ ] **Quem recebe as transferências** (perfil Comercial ou Gestor) e o prazo de aceite (padrão: 1 dia útil).

## 3. Ambiente: staging e produção

O `render.yaml` cria o PostgreSQL, o web (com health check em `/api/health` e migrações no pré-deploy) e o worker.

**Variáveis obrigatórias** (nunca no Git; no painel da Render):

| Variável | Observação |
|---|---|
| `APP_ENV`, `APP_URL`, `BETTER_AUTH_URL` | `production` (ou `staging`) e a URL pública |
| `DATABASE_URL` | Fornecida pela Render |
| `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `SUPPRESSION_HASH_PEPPER` | Gerar valores longos e aleatórios. **O pepper não pode mudar depois** (é a chave da Lista Não Contatar) |
| `TRUSTED_PROXIES` | Configurar depois de conferir o `X-Forwarded-For` da Render ([SECURITY §12](./SECURITY.md#12-limites-de-taxa-e-abuso)) |
| `EMAIL_PROVIDER`, `EMAIL_FROM`, `SMTP_URL` ou `RESEND_API_KEY` | Para convites e redefinição de senha |
| `SENTRY_DSN` | Erros da aplicação, sem dados pessoais |
| `AI_PROVIDER` | `fake` até a decisão da [§5](#5-ia-ligar-ou-não-no-piloto) |

**Checklist técnico:**

- [ ] Staging no ar com `pnpm db:seed:dev` (só dados fictícios) e o primeiro ADMIN criado (`pnpm admin:create`).
- [ ] Produção no ar **sem** o seed de desenvolvimento; dados de referência pelo pré-deploy.
- [ ] ADMIN e GESTOR com verificação em duas etapas ativada. O sistema exige: sem ela, a pessoa entra só em "Minha conta" até ativar (o primeiro ADMIN também, logo depois de definir a senha). Tenha o aplicativo autenticador no celular antes do primeiro acesso.
- [ ] **Backup e restauração testados:** restaurar o backup mais recente da Render num banco de teste, subir a aplicação apontando para ele, entrar e conferir a contagem de leads e a Lista Não Contatar. Anotar a data e o tempo gasto.
- [ ] Sentry recebendo um erro de teste; alerta por e-mail configurado.
- [ ] Worker processando jobs (importação de teste no staging; a tela Importar mostra o progresso).
- [ ] Tela Integrações conferida: WhatsApp e Instagram em modo assistido; IA "simulada" ou "ativa", conforme a decisão.

## 4. Homologação (UAT)

No **staging**, com dados fictícios, durante 2 a 3 dias. Cada cenário tem um responsável e é marcado como OK, OK com ressalva ou falhou. Falha bloqueante (dado errado, contato indevido, perda de registro) impede o go-live até ser corrigida.

| # | Critério | Perfil | Cenário | Resultado esperado |
|---|---|---|---|---|
| 1 | M01 | ADMIN | Convidar um SDR e um gestor; o SDR define a senha | O SDR entra e não vê Equipe, Relatórios nem Configurações |
| 2 | M02 | SDR | Cadastrar um escritório com WhatsApp; tentar o mesmo telefone em outro formato | Aviso de possível duplicado antes de salvar |
| 3 | M03 | GESTOR | Filtrar por cidade e faixa de score; atribuir 10 leads a um SDR | Simulação mostra a contagem; a atribuição fica na timeline |
| 4 | M04, M05 | ADMIN | Importar uma planilha fictícia com título acima do cabeçalho e telefones em formatos diferentes | Mapeamento sugerido, prévia normalizada, relatório final; reimportar avisa |
| 5 | M06 | GESTOR | Revisar um par de duplicados e mesclar | Tudo reunido no lead que fica; nada excluído |
| 6 | M07, M08 | SDR | Abrir o Kanban, mover um lead e ver o score explicado | Histórico com duração; motivo exigido para perda |
| 7 | M09 | SDR | Abrir a ficha de um lead trabalhado | Timeline com cadastro, contatos, respostas e mudanças de etapa |
| 8 | M10, M11 | SDR | Inscrever um lead na cadência; abrir a Minha Fila | O passo aparece em "Hoje", com a ação "Contatar" |
| 9 | M12 | SDR | Em "Contatar", escolher "Primeiro contato", **Gerar com IA**, ler os avisos, editar e aprovar | Rascunho com avisos; termo proibido bloqueia a aprovação; o texto aprovado vai no link do WhatsApp |
| 10 | M13 | SDR | Abrir no WhatsApp, enviar pelo celular corporativo e **confirmar o envio** | Envio registrado; cadência avança; sem confirmação, fica pendente |
| 11 | M13, M12 | SDR | Colar uma resposta recebida e usar **Sugerir com IA** | Sugestão com confiança; a classificação só vale ao clicar em "Usar sugestão" |
| 12 | M14 | SDR | Registrar a resposta "Pode me tirar da lista" | Lead na Lista Não Contatar, cadência encerrada, WhatsApp bloqueado |
| 13 | M14 | ADMIN | Consultar a Lista Não Contatar e o registro na auditoria | Valores mascarados; quem registrou e quando |
| 14 | M15 | SDR → Comercial | Transferir com o checklist; o comercial aceita e marca ganho | Aviso no sino; lead em "Convertido"; o SDR passa a só consultar o lead |
| 15 | M16 | GESTOR | Dashboard com "Últimos 30 dias" e filtro por SDR; Relatórios → exportar "Por SDR" | Números coerentes com o que foi feito no UAT; exportação na auditoria |
| 16 | M16 | SDR | Abrir o Dashboard | "Seus números", sem filtro de pessoa e sem Relatórios |
| 17 | Celular | SDR | Usar a Minha Fila, a ficha e o registro de contato no celular | Tudo legível e com as ações principais |
| 18 | LGPD | ADMIN | Registrar e atender uma solicitação de titular (anonimizar um lead fictício) | Textos apagados, histórico preservado sem dados pessoais |
| 19 | Segurança | GESTOR | Primeiro acesso do gestor convidado no cenário 1, sem a verificação em duas etapas | Só "Minha conta" abre; depois de ativar com o aplicativo autenticador, o sistema é liberado |

**Saída do UAT:** lista de ajustes (bloqueantes corrigidos; os demais priorizados), aceite assinado pelo patrocinador e pelo gestor.

## 5. IA: ligar ou não no piloto

O sistema funciona sem a IA real: com `AI_PROVIDER=fake`, o botão "Gerar com IA" devolve um modelo fixo (com o aviso "IA de demonstração") e nada sai para terceiros. Para ligar:

1. Concluir a transferência internacional com o provedor (DPA com cláusulas-padrão) e registrar a decisão.
2. Cadastrar os **fatos aprovados** (Configurações → IA de prospecção). Sem fatos, a IA só se apresenta e pergunta se faz sentido conversar.
3. Criar uma chave **separada** para a Docline SDR no console do provedor, com limite de gasto.
4. Rodar a avaliação com o modelo real, que usa só dados fictícios (custo estimado de ~US$ 4,40 na rodada rápida, [AI-SDR §14.1](./AI-SDR.md#141-como-rodar-fase-6)):
   ```bash
   AI_PROVIDER=anthropic AI_API_KEY=… pnpm ai:eval --smoke --yes
   ```
   **Aceite sugerido:** nenhuma injeção obedecida, taxa de violações até 5%, todos os opt-outs percebidos pela regra ou pela IA e média da rubrica humana (SDR + gestor, planilha `rubrica.csv`) de pelo menos 4.
5. Configurar `AI_PROVIDER=anthropic`, `AI_API_KEY`, `AI_MONTHLY_BUDGET_USD` (sugestão para o piloto: US$ 50) e manter `AI_MAX_GENERATIONS_PER_USER_PER_DAY=200`.
6. Acompanhar Relatórios → Uso e custos da IA na primeira semana: aprovados sem edição, descartes e motivos.

## 6. Treinamento e guia rápido

**Sessão de 45 minutos** (SDRs, gestor e comercial), no staging:

1. Por que o sistema existe: humano no controle, LGPD e nada de envio automático (5 min).
2. Minha Fila: seções, prioridade e ações rápidas (10 min).
3. Contato assistido: gerar com IA, revisar os avisos, aprovar, abrir no WhatsApp, enviar e **confirmar** (10 min).
4. Respostas: colar, classificar (com ou sem sugestão) e o que acontece com opt-out (5 min).
5. Transferência ao Comercial e o que o comercial faz (5 min).
6. Dashboard e, para o gestor, Relatórios e exportação (5 min).
7. Dúvidas (5 min).

**Guia rápido (1 página para o SDR):**

- Comece o dia pela **Minha Fila**, de cima para baixo: respostas primeiro.
- Use sempre o **WhatsApp corporativo** da Docline.
- Não envie nada que você não leria em voz alta para o cliente. A IA sugere; **você decide**.
- Depois de enviar, **confirme o envio**. Sem confirmação, o contato não conta.
- Se a pessoa pedir para não receber mensagens, registre a resposta: o sistema bloqueia o contato.
- Nunca cole telefones, e-mails ou links nas instruções da IA.
- Lead transferido ao Comercial fica só para consulta.

## 7. Importação da base real

Em **produção**, pelo ADMIN, depois da validação jurídica:

1. **Lista Não Contatar primeiro:** cadastrar ou importar os pedidos de opt-out já conhecidos (planilhas antigas, e-mails), antes de qualquer contato.
2. Uma planilha por **origem**, com a base legal correta. A tela exige origem, data de coleta e base legal.
3. Na prévia: conferir o mapeamento, os avisos de normalização, os suprimidos e os possíveis duplicados. Política sugerida para duplicados: "criar e sinalizar".
4. Depois da gravação: revisar a fila de **Duplicados** antes de distribuir os leads.
5. Conferir os totais (relatório da importação × planilha) e guardar o relatório.
6. **Apagar as planilhas** das máquinas e do e-mail depois da importação (o sistema não guarda o arquivo).
7. Distribuir os leads aos SDRs do piloto (atribuição em massa ou territórios para o pool).

## 8. Dia do go-live e primeira semana

**No dia:**

- [ ] Itens das seções 2 e 3 marcados; UAT aceito.
- [ ] Usuários reais convidados; contas de teste desativadas.
- [ ] Importação concluída e duplicados revisados.
- [ ] Mensagem de abertura para a equipe, com o guia rápido e o canal de suporte.

**Primeira semana** (15 minutos por dia, gestor + suporte):

- Dashboard: primeiros contatos, respostas e opt-outs do dia. Um pico de opt-outs pede revisão do texto.
- Mensagens → "A confirmar": envios esquecidos sem confirmação.
- Sentry: erros novos. Auditoria: acessos negados fora do esperado.
- Custos da IA, se ligada.
- Reunião curta no fim da semana com os SDRs: o que atrapalhou, o que falta.

## 9. Plano de volta à planilha

Se um problema bloqueante não puder ser corrigido em até 1 dia útil:

1. O gestor avisa a equipe para **parar os contatos pelo sistema**.
2. O ADMIN exporta os leads (Leads → Exportar, com contatos, já sem os da Lista Não Contatar) e exporta a Lista Não Contatar vigente para uso manual. **Ela continua valendo na planilha.**
3. O suporte desliga o worker na Render (cadências e jobs param; nada é apagado).
4. A equipe volta à planilha a partir da exportação. Contatos feitos fora do sistema nesse período são anotados para registro posterior (Registrar contato → "Mensagem enviada fora do sistema").
5. Corrigido o problema: ligar o worker, registrar os contatos anotados e retomar.

Nada é excluído na volta: o banco continua com todo o histórico e a auditoria.

## 10. Critérios de sucesso do piloto

Medidos no Dashboard e em Relatórios depois de 4 semanas, com as metas do [MVP §9](./MVP.md):

- Todos os SDRs do piloto trabalhando pela Minha Fila, sem planilha paralela.
- 100% dos envios confirmados no sistema; nenhum contato com lead da Lista Não Contatar.
- Tempo até o primeiro contato e taxa de resposta acompanhados por semana.
- Se a IA estiver ligada: parcela de rascunhos aprovados sem edição e motivos de descarte revisados com a equipe.
- Decisão do patrocinador: ampliar para toda a equipe, ajustar ou encerrar.

## 11. WhatsApp pela API (marco M5)

O piloto roda no **modo assistido** (`WHATSAPP_PROVIDER=assisted`): o SDR envia pelo app do WhatsApp corporativo e confirma no sistema. A API entra quando o piloto estiver estável e a Docline tiver tudo da Meta; até lá, nada muda para a equipe.

**Go/no-go (M5):** conta Meta Business verificada, WABA e número dedicado, modelos de prospecção aprovados, métodos de opt-in definidos com o jurídico (LGPD §20, item 11), todos os ADMIN/GESTOR com 2FA ativa. Passo a passo técnico em [INTEGRATIONS §16.1](./INTEGRATIONS.md#161-ativar-o-whatsapp-pela-api-cloud-api).

**Homologação antes da conta real** (staging, dados fictícios, `WHATSAPP_PROVIDER=fake` com `META_APP_SECRET` e `META_WEBHOOK_VERIFY_TOKEN` de teste):

| # | Perfil | Roteiro | Esperado |
|---|---|---|---|
| W1 | SDR | Simular uma mensagem do contato: `pnpm whatsapp:simulate resposta --de "<celular fictício do lead>" --texto "Olá, quero saber mais"` | A resposta aparece na ficha e em Conversas → "Aguardando resposta"; janela aberta por 24 h; cadência encerrada; sugestão da IA na mensagem |
| W2 | SDR | Na ficha, responder com texto livre | Mensagem `Na fila` → `Enviada`; com `pnpm whatsapp:simulate status --status delivered` e depois `read`, vira `Entregue` e `Lida` |
| W3 | SDR | Registrar o opt-in apontando a mensagem recebida | Número com opt-in; modelos liberados para esse número |
| W4 | ADMIN | Configurações → WhatsApp: sincronizar modelos, vincular um à abordagem "Primeiro contato", checar o número | Modelos listados com situação e categoria; qualidade e limite do número na tela |
| W5 | SDR | Enviar um modelo para outro lead **sem** opt-in e sem conversa | Bloqueado com o motivo (opt-in exigido) |
| W6 | SDR | Simular a resposta "SAIR" | Lead na Lista Não Contatar, opt-in revogado, envio bloqueado |
| W7 | GESTOR | Simular uma mensagem de um número que não está na base | Aparece em Conversas → "Números sem lead"; nenhum lead criado; vincular ou descartar |

**Primeira semana com a API:** poucos leads com opt-in; acompanhar todo dia a qualidade do número e o custo do mês (Configurações → WhatsApp), as falhas na ficha e os avisos aos ADMINs. Queda de qualidade: pausar envios de modelo e revisar textos e público. Para voltar ao assistido: `WHATSAPP_PROVIDER=assisted` no web e no worker (nada é reenviado sozinho quando a API volta).

## 12. Instagram pela API (marco M5b)

No piloto, o Instagram também é **assistido** (`INSTAGRAM_PROVIDER=assisted`): o SDR copia o texto, abre o perfil e envia pelo app. A API serve para **responder**: a quem escreveu para a Docline (até 24 h) e, em particular, a quem comentou numa publicação (uma vez, até 7 dias). O primeiro contato continua sendo humano, pelo app.

**Go/no-go (M5b):** conta profissional da Docline ligada a uma Página, **App Review** aprovado para as permissões, "Permitir acesso às mensagens" ligado na conta, parecer jurídico sobre comentários e métricas públicas (LGPD §20, item 12). Passo a passo técnico em [INTEGRATIONS §16.2](./INTEGRATIONS.md#162-ativar-o-instagram-pela-api).

**Homologação antes da conta real** (staging, dados fictícios, `INSTAGRAM_PROVIDER=fake` com os mesmos segredos de teste do webhook):

| # | Perfil | Roteiro | Esperado |
|---|---|---|---|
| I1 | SDR | Cadastrar um lead fictício com Instagram e simular uma mensagem: `pnpm instagram:simulate mensagem --de @<perfil fictício> --texto "Olá, quero saber mais"` | A mensagem aparece na ficha (seção Instagram) e em Conversas → Instagram → "Aguardando resposta"; janela aberta por 24 h; cadência encerrada; sugestão da IA |
| I2 | SDR | Na ficha, "Responder pelo Instagram" | `Na fila` → `Enviada`; com `pnpm instagram:simulate visto --de @<perfil>`, vira `Lida` |
| I3 | SDR | Simular um comentário: `pnpm instagram:simulate comentario --de @<perfil> --texto "Que post bom!"` e "Responder em particular" | Comentário na ficha e aviso ao responsável; a resposta privada sai uma vez só (o botão some) |
| I4 | SDR | Simular uma resposta dada pelo app: `pnpm instagram:simulate eco --de @<perfil> --texto "Te ligo amanhã"` | Entra no histórico da conversa como enviada "pelo app" |
| I5 | SDR | Em outro lead, sem mensagem do contato, abrir a seção Instagram | Sem caixa de resposta; o motivo explica que o primeiro contato é pelo app |
| I6 | GESTOR | Simular uma mensagem de um @ que não está na base | Aparece em Conversas → Instagram → "Quem não é lead"; nenhum lead criado; vincular depois de cadastrar o @ ou descartar |
| I7 | ADMIN | Configurações → Instagram: "Verificar agora"; na ficha, "Atualizar métricas" | Conta ativa (simulada); seguidores, publicações e última publicação do @ do lead |

**Primeira semana com a API:** acompanhar em Configurações → Instagram as respostas, as falhas e a consulta de perfis; conferir na ficha se as métricas fazem sentido. Só depois disso o ADMIN decide ligar o critério "Instagram ativo" em Configurações → Score (nova versão do modelo). Para voltar ao assistido: `INSTAGRAM_PROVIDER=assisted` no web e no worker.

## 13. Base aberta do CNPJ e Prospecção (marco M6)

A Prospecção busca escritórios de contabilidade ativos numa **cópia local** da base aberta do CNPJ da Receita Federal, compara com a base e só cria lead com **aprovação** de um GESTOR ou ADMIN. Em produção, nasce desligada (`COMPANY_REGISTRY_PROVIDER=disabled`); o piloto pode começar sem ela.

**Go/no-go (M6):** parecer jurídico sobre os dados abertos do CNPJ (e, à parte, sobre empresário individual/MEI: LGPD §20, item 6), LIA da prospecção cadastrada e o formato e o endereço da publicação conferidos. Passo a passo técnico em [INTEGRATIONS §16.3](./INTEGRATIONS.md#163-ativar-a-base-aberta-do-cnpj).

**Homologação antes da base real** (staging, `COMPANY_REGISTRY_PROVIDER=fake`, escritórios fictícios com CNPJ de raiz "FK"):

| # | Perfil | Roteiro | Esperado |
|---|---|---|---|
| P1 | ADMIN | Configurações → Dados abertos do CNPJ → "Rodar a carga agora" (worker ligado) | Em poucos segundos, mês 2026-09 carregado, 30 escritórios (CE 28, PI 2); o resultado mostra quantos saíram |
| P2 | GESTOR | Prospecção → UF CE, cidade Sobral → Buscar | 8 escritórios, com a comparação: "Novo", "Já existe" (com o lead), "Possível duplicado", "Na Lista Não Contatar" |
| P3 | GESTOR | Selecionar dois "Novo" e aprovar, escolhendo o responsável e a LIA | "2 leads criados"; na ficha, origem "Dados abertos CNPJ", telefones sem WhatsApp marcado |
| P4 | GESTOR | Recusar um resultado com motivo e buscar de novo | O recusado some (com "Só quem ainda não é lead") ou aparece marcado "Recusado antes" |
| P5 | GESTOR | Prospecção → Potencial por cidade | Por cidade: escritórios, já são leads, faltam, cobertura e contatados; "Buscar" abre a busca na cidade |
| P6 | SDR | Ficha de um lead com o CNPJ de um escritório da base → "Completar com dados abertos" | Só os campos vazios são preenchidos; contatos novos entram; o card passa a "Nada a completar" |
| P7 | SDR | Abrir Prospecção | Menu sem o item; acesso restrito |

**Primeira carga real:** acompanhar o progresso em Configurações → Dados abertos do CNPJ (pode levar horas: são alguns GB em streaming) e conferir o total por UF com a ordem de grandeza esperada. Começar aprovando poucos escritórios de uma cidade conhecida. Para pausar: `COMPANY_REGISTRY_PROVIDER=disabled` no web e no worker; a busca continua com a cópia já carregada.

## 14. Campanhas

As campanhas (Fase 10) organizam **quem** a equipe aborda e **em que ritmo**: selecionam leads por filtro, mostram quem fica de fora e por quê, distribuem entre os SDRs e liberam um lote diário para a cadência. **Não enviam mensagens**: o contato continua do SDR, pela Minha Fila e pelo gate. Não dependem de terceiros nem de ativação; a recomendação é usar **depois das primeiras semanas do piloto**, quando a cadência e a fila já estiverem no ritmo (o limite diário por SDR deve caber no dia de trabalho real).

**Homologação** (staging, dados fictícios):

| # | Perfil | Roteiro | Esperado |
|---|---|---|---|
| C1 | GESTOR | Leads → filtrar por uma tag ou cidade → "Campanha com este filtro" | Nova campanha com a contagem prévia ("N leads · M contactáveis") |
| C2 | GESTOR | Preencher nome, SDRs, limite diário (ex.: 5) e duas abordagens → "Criar rascunho" → "Montar" | Em segundos, "Pronta para ativar": selecionados, aptos, não liberados e os motivos (ex.: "Na Lista Não Contatar") |
| C3 | GESTOR | "Ativar" | O lote do dia de cada SDR entra na cadência ("Hoje 5/5"); nenhuma mensagem é enviada |
| C4 | SDR | Abrir a Minha Fila | Os leads da campanha com "Campanha: …" e a abordagem sugerida; ao gerar com IA, a abordagem já vem escolhida |
| C5 | SDR | Contatar, registrar a resposta "tenho interesse" | Ao abrir a campanha (ou na rodada da hora seguinte), o funil mostra contatado, respondeu e interessado |
| C6 | GESTOR | Registrar opt-out de um lead que ainda aguarda liberação | Na próxima liberação, ele fica "Não liberado", com o motivo |
| C7 | GESTOR | Pausar, retomar e concluir | Pausada não libera; concluída tira quem aguardava (sem apagar) e os resultados continuam contando por 90 dias |
| C8 | SDR | Abrir Campanhas | Menu sem o item; acesso restrito |

**Teste A/B:** a comparação só aparece com 30 contatados em cada variante e **nunca declara vencedora**; "diferença provável" é um sinal para o gestor decidir, olhando também época, cidade e SDR.
