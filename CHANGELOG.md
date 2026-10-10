# Changelog

Registro do que foi entregue em cada fase do [roadmap](docs/ROADMAP.md). Formato inspirado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [Não lançado]

## [0.11.0] — Fase 11: Analytics — 2026-10-10

Indicadores para **decidir com dados** sem pesar no banco: rollups diários e fatos por lead recalculados de hora em hora; relatórios de conversão por recorte, desempenho por SDR, evolução mensal e WhatsApp × Instagram, **com intervalo de confiança e aviso de amostra insuficiente em toda taxa**; insights da carteira no dashboard (números do banco, texto da IA conferido) e distribuição automática do pool. F11-01 a F11-05 entregues. A distribuição automática nasce **desligada** e nunca tira um lead de alguém. Aceite coberto pela jornada E2E `fase11.spec.ts` e pelas suítes de analytics e distribuição. Totais: 477 testes unitários, 249 de integração e 56 jornadas E2E.

### Adicionado

- **Banco:** `daily_metrics` (contagens por dia local da equipe, de cada pessoa e de cada canal), a *materialized view* `analytics_lead_facts` (um registro por lead com o 1º contato — quando, canal, abordagem, quem, campanha na janela de 90 dias — e os marcos depois dele; só ids, códigos e datas), `insights` (fato, texto, origem IA ou padrão, prioridade, validade e avaliação) e, em `users`, `auto_assign`, `max_active_leads` e `away_until`. `ai_generations.lead_id` passa a ser opcional, com o tipo `INSIGHT`.
- **Rollups (F11-01):** job `analytics.rollup` de hora em hora (às 03h de Fortaleza, a semana): atualiza os fatos por lead sem bloquear quem lê (`REFRESH … CONCURRENTLY`) e recalcula `daily_metrics` de hoje e ontem, retomando do último dia calculado; na 1ª execução preenche o histórico (até 36 meses). "Recalcular período" para a gestão (até 366 dias). Com 100 mil leads: rodada de hora em hora em ~0,9 s; histórico de 401 dias em 4,2 s.
- **Relatórios (F11-02):** abas em Relatórios — **Conversão** por cidade, UF, segmento, origem, responsável, quem fez o 1º contato, campanha, abordagem e canal (coorte do 1º contato, cada lead uma vez); **Por SDR** (carteira ativa, atividade do período e a coorte dos 1ºs contatos de cada um); **Evolução mensal** (volumes e coorte de cada mês, mês corrente marcado como parcial); **Canais** (WhatsApp × Instagram lado a lado e os demais). CSV de cada um, com as faixas, auditado. Relatórios em 13 a 65 ms com 100 mil leads.
- **Intervalo de confiança (F11-03):** Wilson a 95% embaixo de cada taxa; com menos de 20 primeiros contatos, "amostra insuficiente" (asterisco, sem comparação); "acima/abaixo da média" só quando o intervalo inteiro fica de um lado; WhatsApp × Instagram com o teste de duas proporções do A/B das campanhas (30 por canal), sem declarar vencedor.
- **Insights da carteira (F11-04):** seis fatos em SQL — respostas esperando ação, transferências sem aceite, prioritários sem contato, cidade com mais leads sem follow-up, abordagem com resposta acima da média (com significância) e cidade com mais escritórios da base aberta fora da base — para a equipe e cada SDR; a IA (tarefa `portfolio_insights`, prompt versionado) só reescreve, e cada texto é conferido (números do fato, porcentagens separadas de contagens, sem contato nem link, tamanho); senão vale o texto padrão. Sem orçamento ou cota, nem chama a IA. Card no dashboard com "Redigido pela IA" (só quando o texto difere do padrão), "Útil/Não útil" e "Atualizar" (gestão); job `analytics.insights` às 07h05; retenção de 180 dias.
- **Distribuição automática (F11-05):** Equipe → Distribuição: território (cidade, depois UF, rodízio geral opcional) ou rodízio; limite padrão de leads ativos; incluir ou não o pool antigo; "Distribuir agora". Job `leads.auto-assign` de hora em hora: só leads do pool, ativos, contatáveis, em etapa de prospecção e fora de campanha em andamento; respeita participação, ausência e limite de cada SDR; trava contra corrida; histórico `TERRITORY`/`ROUND_ROBIN`, aviso ao SDR e os motivos de quem ficou no pool. Disponibilidade por pessoa (participa, limite próprio, ausente até), auditada.
- **API v1:** `/analytics/conversion`, `/analytics/sdr-performance`, `/analytics/monthly`, `/analytics/channels`, `/analytics/performance-export`, `/analytics/rollup`, `/insights` (+ `refresh` e `{id}/feedback`), `/settings/auto-assign` (+ `run`) e `/users/{id}/availability`.

### Alterado

- **Relatórios:** a página ganhou abas (Visão geral, Conversão, Por SDR, Evolução mensal, Canais, Uso e custos da IA); o filtro de período mantém os outros filtros da tela.
- **Dashboard:** card de insights no topo (a gestão vê os da equipe ou da pessoa filtrada; o SDR, os da própria carteira).
- **IA:** o painel de uso conta os insights no custo, mas fora das métricas de qualidade dos rascunhos; o provedor simulado também redige insights.
- **Menu:** item Distribuição (ADMIN e GESTOR) e atalho em Configurações; Auditoria com os rótulos das ações novas.
- **Documentação:** ARCHITECTURE (jobs, medição e ADRs 031 a 033), SDR-FLOW (§10.2 e §11), AI-SDR (§13), LGPD (retenção, registro de operações e checklist), SECURITY (matriz e revisão da Fase 11), DATABASE (§4.10), ROADMAP, GO-LIVE (§15, roteiro A1–A8) e README.

### Corrigido

- O texto da IA nos insights poderia passar com uma porcentagem trocada por um número que só existia como "dias" no fato (ex.: "30%" num período de 30 dias): porcentagens e contagens agora são conferidas em separado (encontrado pelos testes antes de chegar à tela).
- Achados pelo E2E da própria fase: a linha de disponibilidade do SDR não confirmava o salvamento; o menu acendia Equipe e Distribuição ao mesmo tempo; com o provedor simulado, os insights apareciam como "Redigido pela IA" mesmo sendo o texto padrão (agora a marca só aparece quando o texto da IA difere do padrão).

### Observações

- O dashboard continua ao vivo (números do momento); os relatórios novos leem os rollups e mostram quando foram calculados (até 1 h de atraso).
- O aviso de descontinuação do driver `pg` sobre consultas paralelas numa transação (já registrado na 0.9.0) continua; não é desta fase.

## [0.10.0] — Fase 10: Campanhas — 2026-10-10

Campanhas de prospecção que **organizam quem a equipe aborda e em que ritmo**, sem criar um caminho de envio: a campanha congela uma seleção de leads, mostra quem fica de fora e por quê, distribui os aptos entre os SDRs e **libera um lote diário para a cadência**. **A campanha não envia mensagens** (ADR 029): o SDR recebe as tarefas na Minha Fila, com a abordagem sugerida, e cada contato passa pelo gate de sempre. F10-01 a F10-05 entregues. Aceite coberto pela jornada E2E `fase10.spec.ts` e pelas suítes das campanhas. Totais: 453 testes unitários, 225 de integração e 53 jornadas E2E.

### Adicionado

- **Banco:** `campaigns` (seleção, canal, cadência, responsável, limite diário por SDR, frequência, datas, retrato e erro da montagem, lock otimista), `campaign_sdrs`, `campaign_variants` (abordagens em teste, letra e abordagem únicas) e `campaign_leads` (aptidão com os códigos dos motivos, situação, SDR, variante, prioridade, liberação e marcos do funil). `campaign_id` opcional em `cadence_enrollments` e `messages`; estratégia de atribuição `CAMPAIGN`.
- **Campanhas (F10-01):** rascunho a partir do **filtro da lista de leads** ("Campanha com este filtro"), de uma visão salva ou de todos os ativos, com contagem prévia; responsável, SDRs, canal, cadência, limite diário (até 200 por SDR), frequência mínima (padrão 30 dias), datas e até 4 abordagens. Situações rascunho → montando → pronta → ativa ⇄ pausada → concluída → arquivada; a estrutura só muda antes de ativar (numa campanha pronta, mudar descarta o retrato). Nova permissão `campaign.manage` (ADMIN e GESTOR).
- **Montagem e elegibilidade (F10-02):** job `campaign.build` congela a seleção (até 5.000 leads) e avalia cada lead pelo gate do canal (modo assistido, sem o horário) e pelas regras da campanha: arquivado/mesclado/anonimizado, Lista Não Contatar (lead ou contato do canal), sem base legal, sem contato no canal, ganho ou perdido, oportunidade aberta, em cadência, em outra campanha em andamento, contato recente e responsável fora da campanha. Os motivos aparecem na tela, com contagem e filtro. Falha volta ao rascunho com o erro à vista e na auditoria.
- **Distribuição e liberação diária (F10-03):** lead de um SDR da campanha fica com ele; os do pool vão para quem tem menos, do maior score para o menor; nenhum lead é tomado de outra pessoa. O job `campaign.tick` (de hora em hora e logo após ativar ou retomar) libera até o limite de cada SDR nos dias de expediente, no fuso do SDR, **conferindo tudo de novo** (quem entrou na Lista Não Contatar depois da montagem fica "não liberado"); liberar = o lead passa a ser do SDR, entra na cadência com a campanha e o primeiro passo vira tarefa. Trava por campanha contra duas rodadas simultâneas. A data de fim conclui a campanha sozinha.
- **Funil (F10-04):** selecionados → aptos → liberados → contatados (mensagem enviada ou ligação atendida) → entregues → responderam → interessados → oportunidades → convertidos, e os que pediram para sair; cada taxa com a sua base. Marcos recalculados por SQL idempotente numa **janela de 90 dias da liberação** (ou até o lead entrar em outra campanha) (ADR 030); as mensagens da janela ganham o `campaign_id`. Distribuição por SDR com "liberados hoje".
- **Teste A/B (F10-05):** variantes alternadas dentro da lista de cada SDR; taxas de resposta, interesse, oportunidade e saída por variante; comparação só com **30 contatados por variante**, teste de duas proporções com Bonferroni, e **sem vencedora automática** ("diferença provável" para o gestor decidir).
- **Telas:** `/campanhas` (lista e arquivadas), `/campanhas/nova`, `/campanhas/{id}` (configuração, retrato com motivos, distribuição, funil, A/B e a lista de leads com filtros e "Retirar") e `/campanhas/{id}/editar`. Na **Minha Fila** e na **ficha**, a campanha e a abordagem sugerida; no "Contatar", a abordagem sorteada já vem escolhida para a IA. Evento "Liberado por uma campanha" na timeline.
- **API v1:** `/campaigns` (+ `{id}`, `actions`, `leads`, `leads/{leadId}/remove`) e `/leads/{id}/campaigns`.

### Alterado

- **Gate de contactabilidade:** além dos textos, devolve os códigos dos motivos (`GateReasonCode`), usados pela elegibilidade das campanhas; o comportamento não mudou.
- **Cadência:** a inscrição (`enrollInCadence`) foi separada do caso de uso `enrollLead`, com as mesmas regras, para a liberação das campanhas informar a campanha.
- **Menu:** Campanhas liberada (antes "Em breve"), para quem tem `campaign.manage`.
- **E2E:** as jornadas da Fase 10 em diante rodam num projeto do Playwright que depende das fases 1 a 9 (na ordem alfabética, "fase10" viria antes de "fase2", que conta os leads da base).
- **Documentação:** ARCHITECTURE (módulo, gate, endpoints, jobs e ADRs 029 e 030), SDR-FLOW (§10.1), LGPD (§6.3, retenção, anonimização, registro de operações e checklist), SECURITY (matriz e revisão da Fase 10), DATABASE (§4.10), ROADMAP, GO-LIVE (§14, roteiro C1–C8) e README.

### Observações

- Feriados não seguram a liberação (só os dias da semana das regras de contato); as tarefas da cadência vencem no próximo dia útil do lead.
- O aviso de descontinuação do driver `pg` sobre consultas paralelas numa transação (já registrado na 0.9.0) continua; não é desta fase.

## [0.9.0] — Fase 9: Prospecção pela base aberta do CNPJ — 2026-10-10

Descoberta de escritórios de contabilidade na **base aberta do CNPJ da Receita Federal** (só os arquivos oficiais, sem scraping), com comparação com a base e **aprovação humana**: nada vira lead sozinho. **A base real fica desligada em produção** (`COMPANY_REGISTRY_PROVIDER=disabled`); a ativação segue [INTEGRATIONS §16.3](docs/INTEGRATIONS.md#163-ativar-a-base-aberta-do-cnpj) e o marco M6 do [GO-LIVE](docs/GO-LIVE.md#13-base-aberta-do-cnpj-e-prospecção-marco-m6). F9-01, F9-02 e F9-05 entregues; F9-04 em parte (pelo CNPJ, na cópia local; CEP e CNPJ fora do recorte ficam para depois); **F9-03 (Google Places) adiada** até o parecer jurídico sobre os termos da Google. Aceite coberto pela jornada E2E `fase9.spec.ts` e pelas suítes da Prospecção. Totais: 428 testes unitários, 215 de integração e 51 jornadas E2E.

### Adicionado

- **Banco:** `registry_ingestions` (cargas mensais, com progresso e uma em andamento por vez), `registry_companies` (cópia filtrada, separada dos leads), `prospecting_searches` e `prospecting_results` (só o CNPJ, a comparação e a decisão).
- **Carga mensal (F9-01):** porta `CompanyRegistrySource` e adaptador `receita_open_data` (listagem da pasta oficial, mês só com a publicação completa, ZIP em streaming com limites de tamanho e de download parado); jobs `registry.check` (diário) e `registry.ingest` (retoma do arquivo em que parou). Só estabelecimentos **ativos** de contabilidade (CNAE 6920-6/01 e 6920-6/02), município casado com o IBGE, razão social, natureza e porte só das raízes guardadas; **CPF retirado** da razão social; **empresário individual fora por padrão**. Mês novo atualiza e apaga o que saiu; queda maior que 30% não apaga nada e avisa os ADMINs. Base simulada (`fake`) com o mesmo layout e escritórios fictícios. Variáveis `REGISTRY_BASE_URL` e `REGISTRY_REFERENCE`.
- **Prospecção (F9-02):** tela `/prospeccao` com busca por UF, cidades, atividade, só matriz, nome e quantidade (até 500); comparação com a base e com a Lista Não Contatar pelas regras da importação; aprovação (até 100 por vez, com responsável e LIA) que **refaz a comparação**, cria o lead com a origem "Dados abertos CNPJ" e os contatos **sem presumir WhatsApp**, ou completa o que já existe; quem está na Lista Não Contatar não entra; aprovação simultânea não duplica; recusa com motivo ("Recusado antes" nas buscas seguintes); histórico das buscas. Resultados apagados em 30 dias (job `prospecting.purge`). Nova permissão `prospecting.run` (ADMIN e GESTOR).
- **Potencial por cidade (F9-05):** escritórios ativos na base aberta × já são leads × faltam × cobertura × leads e contatados, com as cidades prioritárias marcadas e atalho para buscar na cidade.
- **Completar com dados abertos (F9-04):** card na ficha do lead com o que a base tem do CNPJ e o que dá para completar; preenche só campos vazios, sem contatos da Lista Não Contatar, e registra a origem.
- **Configurações → Dados abertos do CNPJ (ADMIN):** fonte, mês carregado, escritórios por UF, cargas com progresso e resultado, "Rodar a carga agora", "Carregar o mês de novo" e a configuração (carga automática, atividade secundária, empresário individual).
- **API v1:** `/prospecting/searches` (+ `{id}`, `approve`, `reject`), `/prospecting/potential`, `/registry` (+ `settings`, `ingestions`) e `/leads/{id}/registry`.

### Alterado

- **Importação:** a comparação com a base (`matchRows`) e o "completar só o vazio" (`fillEmptyLeadFields`) passaram a ser compartilhados com a Prospecção, sem mudar o comportamento da importação.
- **Menu:** Prospecção liberada (antes "Em breve"), para quem tem `prospecting.run`.
- **Horários na tela:** passam a sair sempre no fuso padrão (`America/Fortaleza`, ARCHITECTURE §7.7). Antes, o que era montado no servidor saía em UTC (3 horas à frente) e o que era montado no navegador saía no fuso do aparelho.
- **Variável `COMPANY_REGISTRY_PROVIDER`:** o valor `brasilapi`, previsto no desenho e nunca implementado, saiu (consulta a terceiros fica para quando o serviço for escolhido).
- **Documentação:** INTEGRATIONS (§2, §3, §4, §9.1, §9.2 e §16.3), ARCHITECTURE (módulo, endpoints, jobs, estrutura e ADRs 027 e 028), SECURITY (matriz e revisão da Fase 9), LGPD (§6.2, retenção, anonimização, registro de operações e item 6), SDR-FLOW, DATABASE (§4.11), ROADMAP, GO-LIVE (§13, roteiro P1–P7), README e render.yaml.

### Observações

- O servidor da Receita não estava acessível no ambiente de desenvolvimento: o adaptador foi testado contra um servidor local que imita a pasta oficial, e o formato e o endereço vigentes precisam ser conferidos na ativação.
- O driver `pg` avisa (aviso de descontinuação, já presente nas fases anteriores) quando o Prisma faz consultas paralelas dentro de uma transação, ao carregar relações. Funciona hoje; precisa ser revisto antes de atualizar para o `pg` 9.

## [0.8.0] — Fase 8: Instagram — 2026-10-09

Mensagens e comentários da conta profissional da Docline pela Instagram API oficial da Meta (com Facebook Login), **só para responder** a quem escreveu ou comentou; o primeiro contato continua assistido. **A API fica desligada por padrão** (`INSTAGRAM_PROVIDER=assisted`); a ativação segue [INTEGRATIONS §16.2](docs/INTEGRATIONS.md#162-ativar-o-instagram-pela-api) e o marco M5b do [GO-LIVE](docs/GO-LIVE.md#12-instagram-pela-api-marco-m5b). F8-01 a F8-04 entregues. Aceite coberto pela jornada E2E `fase8.spec.ts` e pelas suítes do Instagram. Totais: 407 testes unitários, 200 de integração e 46 jornadas E2E.

### Adicionado

- **Banco:** `instagram_profiles` (métricas públicas por contato), `social_comments` (comentários de leads, com a resposta privada única) e `handle` em `conversations` e `inbound_unmatched`.
- **Adaptador da Instagram API (F8-01):** Graph API com `fetch`, versão fixada, token da Página; envio por `/{page-id}/messages`, resposta privada, perfil de quem escreveu, Business Discovery e conta; envio real desligado fora de produção; testado contra um servidor local que imita a Graph API. Variáveis `INSTAGRAM_BUSINESS_ACCOUNT_ID`, `FACEBOOK_PAGE_ID` e `INSTAGRAM_PAGE_ACCESS_TOKEN`. Verificação diária da conta (`instagram.account-check`) e o botão em **Configurações → Instagram**; roteiro do App Review no INTEGRATIONS §16.2.
- **Webhooks (F8-02):** `/api/webhooks/instagram` com a mesma verificação e assinatura do WhatsApp; job `instagram.webhook`. Mensagem recebida vira resposta do lead (cadência, opt-out por palavra, etapa, tarefa, aviso e sugestão da IA); o @ de quem escreve pela primeira vez vem do perfil na Meta; quem não é lead (ou tem o @ em mais de um lead) vai para **Conversas → Instagram → "Quem não é lead"**, sem criar lead. Ecos confirmam envios da API (inclusive de resultado incerto), guardam o id da Meta no contato assistido e registram o que a equipe respondeu pelo app; "visto" marca como lida.
- **Comentários (F8-02):** só de leads já cadastrados, com aviso ao responsável e evento na timeline (sem o texto); pedido de opt-out num comentário público é sinalizado para uma pessoa conferir.
- **Respostas (F8-03):** texto só em até 24 h da última mensagem do contato (gate do modo API) e **resposta privada** a comentário (uma por comentário, até 7 dias, com o gate do contato assistido); fila e job `instagram.send` no desenho do WhatsApp, sem reenvio automático; "Tentar de novo" recusa quando o prazo da Meta já venceu; até 1.000 bytes.
- **Business Discovery (F8-04):** job `instagram.discovery` de hora em hora, com teto por rodada e validade configuráveis; cada @ consultado uma vez; só seguidores, número de publicações e data da última; leads com opt-out ou bloqueados de fora; "Atualizar métricas" na ficha (uma vez por hora). O critério **"Instagram ativo"** do score passa a funcionar e continua inativo no seed até o ADMIN ligar.
- **Telas:** seção Instagram na ficha (@ com métricas, conversa, comentários, resposta com contador de bytes), seletor de canal em **Conversas** e **Configurações → Instagram** (conta, mês, consulta de perfis e automação).
- **Simulador para homologação:** `pnpm instagram:simulate` (`mensagem`, `comentario`, `eco`, `visto`), só com `INSTAGRAM_PROVIDER=fake`.
- **API v1:** `/leads/{id}/instagram` (+ `messages`, `refresh`), `/instagram/comments/{id}/private-reply`, `/instagram/messages/{id}/retry`, `/instagram/conversations`, `/instagram/unmatched` (+ `link`, `retry`, `dismiss`), `/instagram/overview`, `/instagram/account/check` e `/instagram/settings`.

### Alterado

- **Gate de contactabilidade:** no modo API, o Instagram só libera o @ com conversa aberta pelo contato nas últimas 24 h; a janela passou a ser lida da conversa do próprio contato (telefone no WhatsApp, @ no Instagram).
- **Mensagens de quem não é lead:** a lista e o descarte servem aos dois canais (`channel`); vincular e "procurar de novo" do WhatsApp recusam mensagens do Instagram, e vice-versa.
- **Anonimização** apaga também conversas, comentários e métricas do Instagram, os payloads que citam o @ ou o IGSID e as mensagens de "quem não é lead" do titular. **Mesclagem** leva conversas e comentários para o sobrevivente.
- **Documentação:** INTEGRATIONS (§2, §3, §4, §7.2, §13, §16.2), ARCHITECTURE (módulo, endpoints, jobs e ADRs 025 e 026), SECURITY, LGPD (§6.1, retenção, anonimização, item 12 para o jurídico), SDR-FLOW, AI-SDR, DATABASE, ROADMAP (marco M5b), GO-LIVE (§12, roteiro I1–I7), README e render.yaml.

## [0.7.1] — 2FA obrigatória para ADMIN e GESTOR — 2026-10-09

Fecha a pendência de segurança prometida para antes da Fase 7 ([SECURITY §3](docs/SECURITY.md#3-autenticação), ADR 024). Totais: 388 testes unitários, 188 de integração e 42 jornadas E2E.

### Alterado

- **ADMIN e GESTOR sem a verificação em duas etapas só acessam "Minha conta"** até ativar: as demais páginas levam para lá, o menu e os avisos ficam ocultos e a API v1 responde `403` com `code: TWO_FACTOR_REQUIRED`. Vale no primeiro acesso de um convidado, para quem foi promovido a GESTOR e para quem teve a 2FA redefinida ou desativada. SDR e Comercial não mudam.
- **Desativar a 2FA** num perfil que a exige avisa que o acesso fica restrito até ativar de novo (é assim que se troca de celular).

### Adicionado

- **`TWO_FACTOR_ENFORCEMENT`:** `required` (padrão; o único aceito em staging e produção) ou `reminder` (só o lembrete, para desenvolvimento e para a suíte E2E).
- **E2E com a 2FA obrigatória** (`fase7-2fa.spec.ts`), num segundo servidor com `required`: ADMIN sem 2FA fica em "Minha conta" e recebe `403` na API, o SDR segue normal, e o gestor convidado ativa a 2FA e é liberado.
- **UAT:** cenário 19 no [GO-LIVE](docs/GO-LIVE.md#4-homologação-uat).

### Corrigido

- **E2E dependia da hora do dia:** a cadência padrão tem janela própria (08:00–18:00) e o preparo do banco de testes só abria a das regras de contato; depois das 18h de Fortaleza, o primeiro passo vencia no dia seguinte e a jornada da Fase 5 falhava. O preparo agora abre as duas.


## [0.7.0] — Fase 7: Integração WhatsApp — 2026-10-09

Envio e recebimento pela WhatsApp Cloud API, oficial da Meta, só para números com opt-in ou com a conversa aberta pelo contato. **A API fica desligada por padrão** (`WHATSAPP_PROVIDER=assisted`); a ativação segue [INTEGRATIONS §16.1](docs/INTEGRATIONS.md#161-ativar-o-whatsapp-pela-api-cloud-api) e o marco M5 do [GO-LIVE](docs/GO-LIVE.md#11-whatsapp-pela-api-marco-m5). F7-01 a F7-08 entregues; F7-09 adiada. Aceite coberto pela jornada E2E `fase7.spec.ts` e pelas suítes do WhatsApp. Totais: 384 testes unitários, 188 de integração e 40 jornadas E2E.

### Adicionado

- **Banco:** `whatsapp_templates`, `conversations` (uma por lead e número do WhatsApp, com a janela de atendimento), `message_status_events`, `webhook_events` (inbox), `inbound_unmatched` (números sem lead) e `integration_connections`; `messages` ganha conversa, modelo e variáveis, tentativa, entrega, leitura, erro e custo estimado; `contact_permissions` ganha a mensagem usada como evidência e um opt-in por número.
- **Adaptador da Cloud API (F7-01):** Graph API oficial com `fetch`, versão fixada em `META_GRAPH_API_VERSION`, token de *System User*; envio de modelo e de texto, leitura dos modelos e da saúde do número; nosso id em `biz_opaque_callback_data`; erros traduzidos para o português com a tabela de códigos da Meta; testado contra um servidor local que imita a Graph API.
- **Envio idempotente (F7-01):** mensagem e job na mesma transação, tentativa marcada antes da chamada, gate conferido de novo no worker, desfecho gravado com atualização condicional; pedido repetido da tela não duplica. Falha conhecida vira "Tentar de novo"; resultado incerto só é repetido depois de 10 minutos sem status e com confirmação.
- **Webhooks (F7-02):** `/api/webhooks/whatsapp` com verificação do endpoint, assinatura `X-Hub-Signature-256` sobre o corpo exato, limite de 1 MB e inbox idempotente; job `whatsapp.webhook` aplica status (só avançam), mensagens recebidas, situação e qualidade dos modelos e mudanças da conta.
- **Conversas e janela (F7-03):** seção WhatsApp na ficha (números com opt-in e janela, conversa com status, texto livre na janela, modelo com variáveis e prévia, rascunho aprovado da IA); tela **Conversas** com "Aguardando resposta", "Janela aberta", "Todas" e, para ADMIN/GESTOR, "Números sem lead".
- **Modelos (F7-04):** sincronização diária e sob demanda, vínculo com abordagens, ativar e desativar; modelo removido na Meta fica marcado, sem apagar o histórico.
- **Opt-in por número (F7-05):** com a mensagem do contato como evidência (qualquer pessoa que edita o lead) ou com evidência descrita (ADMIN/GESTOR); revogação; o gate do modo API só libera números com opt-in ou com a janela aberta.
- **Números com e sem o 9º dígito (F7-06):** a resposta encontra o lead nas duas formas; número desconhecido ou em mais de um lead vai para decisão humana, sem criar lead.
- **Sugestão automática de classificação (F7-07):** cada resposta recebida ganha a sugestão da IA, que a pessoa usa ou troca; desligável.
- **Saúde do número e custo (F7-08):** checagem de hora em hora (qualidade, limite e situação), aviso aos ADMINs quando piora, custo estimado por mensagem com a tabela editável e visão do mês em **Configurações → WhatsApp**.
- **Simulador para homologação:** `pnpm whatsapp:simulate` (respostas e status assinados como a Meta), só com `WHATSAPP_PROVIDER=fake`.
- **Purga:** job `webhooks.purge` apaga payloads de webhook e mensagens de números sem lead com mais de 90 dias.
- **API v1:** `/leads/{id}/whatsapp` (+ `messages`, `opt-in`, `opt-in/revoke`), `/messages/{id}/retry`, `/conversations` e `/whatsapp/templates` (+ `sync`, `{id}`), `unmatched` (+ `link`, `retry`, `dismiss`), `overview`, `health/check` e `settings`.

### Alterado

- **Gate de contactabilidade:** no modo API, devolve os números utilizáveis (opt-in ou janela aberta); o opt-in de WhatsApp no nível do lead deixou de liberar a API, e o diálogo de base legal não oferece mais essa opção.
- **Opt-out** (no lead, no canal ou no número) revoga os opt-ins de WhatsApp afetados; o erro 131050 da Meta põe o número na Lista Não Contatar do WhatsApp e revoga o opt-in.
- **Anonimização** apaga também conversas, variáveis dos modelos, payloads de webhook e mensagens de números sem lead do titular; **mesclagem** leva conversas e opt-in do mesmo número (revogado prevalece).
- **Respostas recebidas pela API** têm o mesmo tratamento das registradas à mão (opt-out por palavra, cadência encerrada, tarefa) e confirmam o WhatsApp do número.

### Decidido

- **Opt-in por número** (ADR 021), **sem reenvio automático** (ADR 022) e **Graph API direta com versão fixada** (ADR 023).
- **Envio real desligado fora de produção** sem `ALLOW_REAL_SENDS=true`.
- **F7-09 adiada:** passos de cadência com envio automático só depois de medir qualidade e custo com envios humanos; candidata à Fase 10.

### Pendente

- **Ativação (M5):** verificação da empresa na Meta, WABA e número, modelos aprovados, parecer jurídico sobre opt-in e a Meta como operadora.
- **Bloqueio de acesso de ADMIN/GESTOR sem 2FA:** prometido para antes desta fase, não implementado; pré-requisito para ligar a API.
- **Revalidar a tabela de códigos de erro** na documentação da Meta antes de ligar (a página oficial não pôde ser lida nesta fase).
- **Confirmação de descadastro ao titular:** depende do jurídico e de um modelo próprio.


## [0.6.0] — Fase 6: IA de prospecção e fechamento do MVP — 2026-10-09

Aceite da fase (MVP M12 e M16) coberto pela jornada E2E `fase6.spec.ts` e pelas suítes da IA, da avaliação offline e dos indicadores. Totais: 356 testes unitários, 170 de integração e 36 jornadas E2E. Com esta fase, as histórias MUST do MVP estão concluídas no código; o go-live do piloto segue o roteiro de [GO-LIVE](docs/GO-LIVE.md).

### Adicionado

- **Banco:** `ai_generations` (pedido, contexto mínimo enviado, saída, texto gerado e aprovado, edição, avisos, custo, tokens, latência, motivo de descarte e nota), `ai_knowledge_items` (fatos aprovados, com versão) e `approaches`; `messages` ganha o rascunho, a abordagem e quem aprovou, com um envio ativo por rascunho.
- **Porta da IA e provedores (F6-01):**
  - provedor de demonstração determinístico (padrão: nada sai para terceiros);
  - adaptador Anthropic com o SDK oficial: saída estruturada, esforço explícito, cache do prompt de sistema e *fallback* de recusa do lado do servidor;
  - testes do adaptador contra um servidor local, sem rede e sem custo.
- **Contexto e prompts (F6-02):** contexto por lista branca (sem CNPJ, endereço, contatos ou observações), telefones, e-mails e links mascarados, texto de terceiros entre marcas que não podem ser fechadas, prompts versionados e base de conhecimento com versões.
- **Gerar, editar, aprovar e enviar (F6-03, M12):** os 8 tipos de mensagem; o rascunho aparece com os avisos e as suposições a conferir; editar confere de novo; aprovar prepara o contato assistido com o texto aprovado; descartar com motivo; gerar de novo; nota de 1 a 5.
- **Guardrails (F6-04):** antes (gate de contato: Lista Não Contatar e base legal) e depois (termo proibido, dado de contato e valor fora dos fatos bloqueiam a aprovação; tamanho, opt-out, nome fora do contexto, mensagem genérica e texto repetido são avisos). Regras editáveis pelo ADMIN.
- **Registro, cotas e orçamento (F6-05):** cada pedido fica em `ai_generations` com custo estimado; cota diária por pessoa e orçamento mensal, com aviso aos administradores em 80%.
- **Sugestão de classificação de respostas (F6-06):** classe, confiança, justificativa e próximo passo; só vale quando a pessoa usa a sugestão.
- **Avaliação offline (F6-07):** 50 leads fictícios × 8 tipos e 32 respostas, com os casos difíceis (injeção, sem responsável, objeção, presença local); verificações automáticas, rubrica humana de 6 critérios e comparação entre versões; `pnpm ai:eval` (o provedor real só roda com `--yes` e mostra o custo antes).
- **Dashboard (F6-08, M16):** indicadores do período com definição única, evolução diária, funil da coorte, funil por etapa e quebras por cidade, origem e SDR; atalhos de período e filtro por pessoa.
- **Relatórios (F6-09, M16):** tela Relatórios com cada quebra completa e exportação CSV por relatório, registrada na auditoria; tela de uso e custos da IA.
- **Configuração da IA:** `/configuracoes/ia` (base de conhecimento, abordagens e regras dos rascunhos).
- **Desempenho (F6-10):** `pnpm perf:100k`, com carga fictícia de 100 mil leads e medição das leituras principais.
- **Roteiro de UAT e go-live (F6-11):** papéis, decisões da Docline, checklist de ambiente, cenários de homologação por critério, treinamento, importação da base real e volta à planilha.
- **API v1:** `/ai/generations` (+ `approve`, `discard`, `rate`), `/ai/classify-reply`, `/ai/knowledge`, `/ai/rules`, `/ai/usage`, `/approaches`, `/leads/{id}/ai-generations` e `/analytics/overview`, `funnel`, `breakdown`, `timeseries` e `export`.

### Alterado

- **Depois da transferência ao Comercial, o SDR só consulta o lead** (toda escrita é recusada; a ficha avisa). Opt-out e pedidos de titular continuam possíveis.
- **Kanban:** o card mostra a próxima ação, em destaque quando atrasada.
- **Palavras de opt-out padrão:** formas coloquiais achadas pela avaliação e pela revisão do roteiro de UAT ("para de me mandar", "me tire da sua lista", "me tirar da lista", "não precisa mais mandar").
- **Dashboard** substitui a página de boas-vindas; **Relatórios** saem do "em breve" e ficam para ADMIN e GESTOR (`report.read`).
- **Diálogos longos** rolam dentro da tela (os botões ficavam fora do alcance com os avisos do rascunho).

### Decidido

- **IA real desligada por padrão** até a Docline resolver a transferência internacional com o provedor; o sistema funciona com o provedor de demonstração, que avisa na tela.
- **A chamada à IA corre fora da transação** do banco; falhas ficam registradas e contam na cota.
- **Nada da IA vale sozinho:** rascunho só sai com aprovação e envio de uma pessoa; sugestão de classificação só com confirmação.
- **Indicadores ao vivo, sem rollups:** medidos com 100 mil leads, o pior caso (366 dias) leva ~1,2 s depois da otimização com `GROUPING SETS`.
- **Taxas** pela coorte do primeiro contato no período, com aviso de amostra pequena abaixo de 20.

### Pendente

- **Go-live do piloto:** staging na Render, validação jurídica, UAT, treinamento e importação da base real ([GO-LIVE](docs/GO-LIVE.md)).
- **Ligar a IA real:** DPA do provedor e avaliação com o modelo real.
- **Purga automática de `ai_generations`** pelos prazos de retenção (hoje vale a anonimização).
- **Quebras por canal e abordagem, intervalo de confiança e rollups diários:** Fase 11.
- **Modelos de mensagem:** com os modelos aprovados da Meta, na Fase 7.


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
