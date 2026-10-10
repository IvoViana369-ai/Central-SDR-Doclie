# LGPD e Governança de Dados — Docline SDR

> **Status:** Fase 0, com as notas de implementação das Fases 2 a 11 (indicadores, insights e distribuição automática na [§19](#19-checklist-por-fase); WhatsApp pela API na [§6](#6-whatsapp-base-legal-lgpd--opt-in-da-meta), Instagram pela API na [§6.1](#61-instagram-pela-api-fase-8), dados abertos do CNPJ na [§6.2](#62-dados-abertos-do-cnpj-e-prospecção-fase-9), campanhas na [§6.3](#63-campanhas-fase-10)) · **Aviso:** este documento é um guia **técnico e operacional** de privacidade desde a concepção. Ele **não substitui** a análise do jurídico e do encarregado (DPO) da Docline. Os itens da [§20](#20-itens-para-validação-jurídica) precisam de validação antes do go-live.
> Relacionados: [SECURITY](./SECURITY.md) · [SDR-FLOW §9](./SDR-FLOW.md#9-contactabilidade-estados-independentes) · [INTEGRATIONS](./INTEGRATIONS.md) · [DATABASE §4.9](./DATABASE.md#49-conformidade)

## Sumário

1. [Princípios adotados](#1-princípios-adotados)
2. [Papéis](#2-papéis)
3. [Natureza dos dados tratados](#3-natureza-dos-dados-tratados)
4. [Bases legais por origem](#4-bases-legais-por-origem)
5. [Legítimo interesse: avaliação (LIA)](#5-legítimo-interesse-avaliação-lia)
6. [WhatsApp: base legal LGPD ≠ opt-in da Meta](#6-whatsapp-base-legal-lgpd--opt-in-da-meta)
7. [Estados de contato](#7-estados-de-contato)
8. [Opt-out e Lista Não Contatar](#8-opt-out-e-lista-não-contatar)
9. [Transparência com o titular](#9-transparência-com-o-titular)
10. [Direitos dos titulares](#10-direitos-dos-titulares)
11. [Minimização e qualidade](#11-minimização-e-qualidade)
12. [Retenção (proposta)](#12-retenção-proposta)
13. [Anonimização e exclusão](#13-anonimização-e-exclusão)
14. [Controle de acesso, exportação e auditoria](#14-controle-de-acesso-exportação-e-auditoria)
15. [Incidentes de segurança](#15-incidentes-de-segurança)
16. [Transferência internacional](#16-transferência-internacional)
17. [Registro das operações de tratamento](#17-registro-das-operações-de-tratamento)
18. [Como o sistema implementa cada requisito do §25](#18-como-o-sistema-implementa-cada-requisito-do-25)
19. [Checklist por fase](#19-checklist-por-fase)
20. [Itens para validação jurídica](#20-itens-para-validação-jurídica)

---

## 1. Princípios adotados

Os princípios do art. 6º da LGPD orientam decisões de produto:

| Princípio | Como aparece no sistema |
|---|---|
| Finalidade | Dados usados só para prospecção B2B de serviços/parcerias Docline; finalidade registrada por origem |
| Adequação | Contato condizente com o contexto profissional do lead (escritórios que oferecem serviços publicamente) |
| Necessidade | Só campos necessários; IA recebe contexto mínimo |
| Livre acesso | Processo para atender pedidos de titulares |
| Qualidade dos dados | Normalização, correção, marcação de contato inválido |
| Transparência | Primeira mensagem identifica a Docline e oferece saída |
| Segurança | [SECURITY](./SECURITY.md) |
| Prevenção | Gate de contactabilidade, limites de frequência |
| Não discriminação | Nenhum dado sensível; score baseado em sinais de negócio |
| Responsabilização | Auditoria, registro de base legal com evidência, relatórios |

**Regra-mãe:** encontrar um telefone ou perfil publicamente **não** significa autorização irrestrita para mensagens, muito menos automatizadas.

---

## 2. Papéis

| Papel | Quem | Observação |
|---|---|---|
| Controladora | Docline Tecnologia | Decide finalidades e meios |
| Operadores | Hospedagem (ex.: Render), provedor de IA, provedor de e-mail, Meta (WhatsApp Cloud API e Instagram API), Sentry | Contratos/DPAs revisados; papel exato conforme termos de cada fornecedor |
| Encarregado (DPO) | A indicar pela Docline | Verificar se a Docline se enquadra na dispensa para agentes de pequeno porte (Resolução CD/ANPD nº 2/2022); mesmo dispensada, manter canal de atendimento ao titular |
| Usuários internos | ADMIN, GESTOR, SDR, COMERCIAL | Acesso por perfil, treinados nas regras de contato |

---

## 3. Natureza dos dados tratados

Prospecção B2B **também trata dados pessoais**:

- nome do contador/sócio/responsável;
- telefone celular, WhatsApp e e-mail, muitas vezes pessoais;
- perfil de Instagram de pessoa física;
- empresário individual/MEI, em que o CNPJ está ligado a uma pessoa natural;
- histórico de mensagens e observações.

**Diretriz:** tratar **todo dado de contato como dado pessoal** por padrão. **Não coletar dados sensíveis** (art. 5º, II: saúde, religião, opinião política, filiação sindical, origem racial etc.), inclusive em campos livres.

---

## 4. Bases legais por origem

A importação e o cadastro exigem **origem, data da coleta e base legal**. Proposta inicial:

| Origem | Base legal provável | Cuidados |
|---|---|---|
| Base Docline (clientes) | Execução de contrato / legítimo interesse | Confirmar como cada base foi coletada; respeitar opt-outs anteriores |
| Base Docline (ex-clientes, contatos antigos) | Legítimo interesse (com LIA) | Avaliar expectativa do titular e tempo desde o último contato |
| Indicação | Legítimo interesse | Informar, se perguntado, quem indicou (com autorização de quem indicou) |
| Planilha de terceiros | **Depende da coleta original** | Bloquear importação sem declarar origem e base; desconfiar de listas compradas |
| Google | Legítimo interesse | Somado às restrições dos termos do Google ([INTEGRATIONS §8](./INTEGRATIONS.md#8-google)) |
| Instagram (perfil profissional público) | Legítimo interesse | Dado tornado público pelo titular: respeitar finalidade e boa-fé (art. 7º, § 4º) |
| Dados abertos CNPJ | Legítimo interesse | Dado de acesso público: finalidade compatível, boa-fé e interesse público (art. 7º, § 3º) |
| Evento | Consentimento (formulário) ou legítimo interesse | Guardar evidência (lista de presença, formulário) |
| Campanha inbound (formulário, anúncio) | Consentimento / procedimentos preliminares a pedido do titular | Guardar texto do formulário e data |
| Cadastro manual | Conforme a origem declarada | Campo obrigatório |

---

## 5. Legítimo interesse: avaliação (LIA)

O legítimo interesse (art. 7º, IX e art. 10) exige uma **avaliação documentada**. A ANPD publicou guia orientativo sobre essa hipótese legal (2024). O sistema guarda a referência da avaliação em `legal_basis_assessments` e a vincula às permissões.

Estrutura sugerida da LIA para "Prospecção B2B de escritórios de contabilidade":

1. **Finalidade legítima:** oferecer parceria/serviços de certificação digital a empresas cuja atividade se relaciona diretamente com o serviço.
2. **Situação concreta:** contato profissional, com empresas que divulgam publicamente seus canais comerciais.
3. **Necessidade:** só dados de contato profissional e contexto mínimo; nada sensível.
4. **Balanceamento:** a expectativa razoável de um escritório que anuncia serviços é receber contato comercial pontual e relevante; o impacto é baixo se houver frequência limitada e saída fácil.
5. **Salvaguardas:** identificação clara, opt-out em 1 resposta, Lista Não Contatar global, limites de frequência, sem automação em massa, retenção limitada, atendimento a titulares.
6. **Transparência:** aviso de privacidade acessível e explicação da origem do contato quando solicitada.

---

## 6. WhatsApp: base legal LGPD ≠ opt-in da Meta

São **duas exigências diferentes**, e ambas precisam ser cumpridas:

| | Base legal LGPD | Opt-in WhatsApp (Meta) |
|---|---|---|
| Origem | Lei | Política da plataforma (contrato) |
| Exige | Fundamento legal para tratar o dado | Permissão do destinatário para receber mensagens **da empresa no WhatsApp** |
| Onde fica | `contact_permissions.legal_basis` | `contact_permissions.opt_in_status` |
| Bloqueia | Qualquer contato | Envio via **API** (WhatsApp Business Platform) |

Consequências:

- **API (Fase 7):** só para quem tem opt-in registrado com evidência (ou dentro da janela de atendimento aberta pelo próprio lead).
- **Modo assistido:** contato 1 a 1 por um humano, com base legal registrada, limites de frequência e opt-out imediato. Continua sujeito aos termos do WhatsApp; o volume e a qualidade precisam ser controlados para evitar denúncias e bloqueios.
- **Primeiro contato frio** de leads descobertos (Google, CNPJ) deve priorizar canais e formatos que respeitem essas regras; a decisão final de política comercial é da Docline com o jurídico.

> **Implementação (Fase 7).** A API nasce **desligada** (`WHATSAPP_PROVIDER=assisted`); ligar depende dos itens da [§20](#20-itens-para-validação-jurídica) e do checklist de ativação ([INTEGRATIONS §16.1](./INTEGRATIONS.md#161-ativar-o-whatsapp-pela-api-cloud-api)).
>
> - **Opt-in por número, não por lead** (ADR 021): a Meta exige a permissão do próprio número, e um lead pode ter vários. Fica em `contact_permissions` com o ponto de contato, o método e a evidência. O opt-in de WhatsApp gravado no lead (Fase 2) **não libera mais a API**.
> - **Evidência obrigatória.** "O contato escreveu concordando": a pessoa aponta a mensagem recebida daquele número (o sistema confere), e qualquer pessoa que edita o lead pode registrar. Outros métodos (formulário, evento, relação existente, verbal gravado, anúncio click-to-WhatsApp) exigem descrição da evidência e só ADMIN/GESTOR registram. Tudo auditado.
> - **O que o gate libera na API:** só números com opt-in **ou** com a janela de 24 h aberta pelo próprio contato. Texto livre só com a janela aberta; modelo (fora da janela) só com opt-in. A base legal e a Lista Não Contatar continuam valendo antes de tudo, e o gate é conferido de novo na hora do envio.
> - **Opt-out derruba o opt-in:** registrar opt-out (no lead, no canal ou no número) revoga os opt-ins de WhatsApp afetados. O erro 131050 da Meta (o contato pediu ao WhatsApp para não receber marketing da empresa) põe o número na Lista Não Contatar do WhatsApp e revoga o opt-in, sem precisar de uma pessoa. "Sair" e as demais palavras de opt-out nas respostas recebidas pela API valem como nas registradas à mão (§8).
> - **Números desconhecidos não viram leads.** Mensagem de número que não está em nenhum lead (ou está em mais de um) fica em "Números sem lead" para ADMIN/GESTOR decidirem; é apagada em 90 dias se ninguém decidir.
> - **IA:** a resposta recebida ganha uma **sugestão** de classificação (pode ser desligada em Configurações → WhatsApp); nada é aplicado sem uma pessoa. Com `AI_PROVIDER=fake`, nada sai do sistema.

### 6.1 Instagram pela API (Fase 8)

> **Implementação (Fase 8).** Também nasce **desligada** (`INSTAGRAM_PROVIDER=assisted`); ligar depende do item 12 da [§20](#20-itens-para-validação-jurídica) e do checklist de ativação ([INTEGRATIONS §16.2](./INTEGRATIONS.md#162-ativar-o-instagram-pela-api)).
>
> - **Só responde a quem procurou a Docline:** texto até 24 h depois da última mensagem do contato e uma resposta privada por comentário, até 7 dias. O primeiro contato continua assistido, 1 a 1. A Lista Não Contatar, a base legal, o horário e o intervalo valem como nos demais canais.
> - **Mensagens recebidas** viram resposta do lead (opt-out por palavra aplicado na hora, como na §8). De quem não é lead, ficam 90 dias na lista "Quem não é lead" para uma pessoa decidir; **nenhum lead é criado sozinho**.
> - **Comentários** nas publicações da Docline são guardados **só quando o @ é de um lead já cadastrado** (finalidade: dar seguimento a quem demonstrou interesse); de quem não é lead, nada é gravado. Um pedido de opt-out num comentário público é sinalizado para uma pessoa conferir e registrar.
> - **Métricas públicas do perfil** (Business Discovery, da Meta): só de contas profissionais e só três números (seguidores, publicações, data da última), para o critério "Instagram ativo" do score — que continua desligado até o ADMIN ligar. Leads com opt-out ou bloqueados não são consultados; perfis pessoais não aparecem nessa consulta.
> - **Identificadores:** o IGSID (id do contato na conta da Docline) e o @ ficam na conversa; os payloads de webhook guardam só os HMACs do @ e do IGSID no índice.


### 6.2 Dados abertos do CNPJ e Prospecção (Fase 9)

> **Implementação (Fase 9).** Desligada em produção (`COMPANY_REGISTRY_PROVIDER=disabled`); ligar depende do item 6 da [§20](#20-itens-para-validação-jurídica) e do checklist de ativação ([INTEGRATIONS §16.3](./INTEGRATIONS.md#163-ativar-a-base-aberta-do-cnpj)).
>
> - **Fonte e minimização:** só os arquivos abertos oficiais da Receita; ficam guardados só os **estabelecimentos ativos de contabilidade** (CNAE 6920-6/01 e 6920-6/02) e só os campos da prospecção (nomes, CNAE, abertura, porte, endereço, telefones e e-mail declarados). Sócios e Simples **não são lidos**. O CPF que a Receita inclui na razão social de empresário individual é **retirado** na carga.
> - **Empresário individual/MEI:** os dados são de uma pessoa natural; ficam **fora por padrão** e só o ADMIN liga, depois do parecer (item 6 da §20). Desligar de novo apaga esses registros na carga seguinte.
> - **Separado dos leads:** a cópia (`registry_companies`) não é a base de leads. Um escritório só vira lead quando uma pessoa **aprova**, com a origem "Dados abertos CNPJ", data da coleta (a da carga) e base legal (legítimo interesse, com a LIA escolhida na aprovação).
> - **Lista Não Contatar respeitada:** a busca e a aprovação conferem contatos e CNPJ; quem está na lista aparece como tal e **não pode virar lead**. O opt-out em todos os canais e a anonimização já põem o CNPJ na lista (hash), então um pedido de exclusão vale também para a Prospecção. Na ficha, "Completar com dados abertos" não acrescenta contato que esteja na lista.
> - **Telefone público não é autorização:** os contatos entram sem marcar WhatsApp e seguem o gate de sempre (base legal, opt-out, horário, limites). Nada é enviado automaticamente a quem foi prospectado.
> - **Retenção:** os resultados das buscas guardam só o CNPJ, a comparação e a decisão, e são apagados em 30 dias; a cópia é substituída a cada mês (o que saiu da base é apagado).

### 6.3 Campanhas (Fase 10)

> **Implementação (Fase 10).** A campanha **não é disparo em massa e não envia mensagens** ([ARCHITECTURE, ADR-029](./ARCHITECTURE.md#15-registro-de-decisões-adrs)): ela seleciona leads, explica quem fica de fora e libera um número limitado por SDR por dia para a cadência. Cada contato continua sendo feito por uma pessoa (ou, pela API, só com opt-in ou janela aberta) e passa pelo gate.
>
> - **Lista Não Contatar e base legal na seleção:** quem está na lista (o lead ou o contato do canal), sem base legal ou sem contato no canal fica **fora**, com o motivo registrado. Na hora da liberação tudo é conferido de novo: quem pediu para sair depois da montagem não entra na cadência.
> - **Frequência:** por padrão, quem foi contatado nos últimos 30 dias não entra (configurável por campanha); um lead não fica em duas campanhas em andamento ao mesmo tempo; o limite diário por SDR vai até 200 leads.
> - **Minimização:** `campaign_leads` guarda só ids, a situação, os códigos dos motivos e as datas dos marcos; nenhum dado pessoal em claro. Anonimizar o lead não exige limpeza na campanha (as linhas apontam para o lead anonimizado).
> - **Teste A/B:** compara abordagens já cadastradas; não usa dado novo do titular.

---

## 7. Estados de contato

Os estados pedidos no §14 dos requisitos são independentes e calculados pelo gate de contactabilidade. Definição completa em [SDR-FLOW §9](./SDR-FLOW.md#9-contactabilidade-estados-independentes):

`telefone identificado` · `WhatsApp identificado` · `base legal registrada` · `opt-in de plataforma` · `contato permitido` · `opt-out` · `bloqueado`

---

## 8. Opt-out e Lista Não Contatar

| Regra | Implementação |
|---|---|
| Efeito imediato | Registro na Lista Não Contatar na mesma transação; cadência parada; tarefas futuras canceladas |
| Por identificador, não só por lead | `suppression_entries` guarda o **HMAC** do telefone/e-mail/Instagram/CNPJ normalizado; vale para qualquer lead com o mesmo identificador, inclusive reimportações e mesclagens |
| Escopo | Todos os canais (padrão) ou canal específico |
| Detecção | Palavras-chave configuráveis em respostas (determinístico) + sugestão da IA + botão manual |
| Campanhas | Bloqueio automático: leads suprimidos são inelegíveis |
| Importação | Linhas com identificador suprimido aparecem como `SUPPRESSED` na prévia |
| Sobrevive à exclusão | Após anonimização/exclusão do lead, o hash permanece para continuar honrando o pedido |
| Revogação | Só ADMIN, com motivo e evidência (ex.: o titular pediu para voltar a receber), auditada |
| Confirmação ao titular | Uma única mensagem curta confirmando o descadastro, quando o canal permitir |
| Compartilhamento interno | Evento `optout.registered` disponível para outros sistemas Docline (Fase 12) |

**Implementado na Fase 2:** opt-out em 1 clique (lead inteiro, um canal ou um contato), inclusão manual por valor, revogação só pelo ADMIN com motivo, efeito imediato em todos os leads com o mesmo identificador, CNPJ e o próprio lead também entram na lista, consulta com valores mascarados (ADMIN/GESTOR) e gate de contactabilidade por canal com motivos legíveis. Ficam para as próximas fases: detecção de palavras-chave e confirmação ao titular (Fase 5), parada de cadência (Fase 5), prévia de importação (Fase 3) e campanhas (Fase 10).

**Fase 4:** perder o lead no pipeline com o motivo "Pediu para não ser contatado" registra o opt-out em todos os canais, na mesma transação da movimentação. A tela avisa antes de confirmar. A prévia da importação já marca os identificadores suprimidos (Fase 3). O score usa só sinais de negócio (canais cadastrados, cidade, tipo, tags) e mostra na ficha quanto cada critério pesou.

**Fase 5:**
- **Detecção nas respostas registradas.** As palavras e frases ficam em Configurações → Regras de contato. Uma resposta curta com a palavra, ou uma frase de opt-out, inclui o lead na Lista Não Contatar na mesma transação, mesmo que outra classificação tenha sido escolhida. A tela avisa enquanto o SDR digita. A palavra dentro de um texto maior vira tarefa para uma pessoa decidir, e nada é bloqueado ou excluído por suposição.
- **Parada de cadência.** Opt-out ou bloqueio encerra a cadência e cancela as tarefas de contato abertas.
- **Gate.** Todo envio assistido passa pelo gate antes de gerar o link. O gate inclui a janela de horário, o intervalo mínimo entre contatos e o limite diário de primeiros contatos. Nada é enviado automaticamente; quem envia é a pessoa, pelo app.
- **Confirmação ao titular: pendente.** No modo assistido, o gate bloqueia qualquer mensagem depois do opt-out. A mensagem única de confirmação depende de decisão do jurídico (§20) e, no WhatsApp, de template próprio. **Fase 7:** continua pendente; com a API, o gate também bloqueia o envio depois do opt-out, inclusive dentro da janela aberta.

---

## 9. Transparência com o titular

- A primeira mensagem identifica **quem** (nome do SDR), **de onde** (Docline) e **por quê** (motivo do contato).
- Se perguntado, o SDR informa **como obtivemos o contato**: a origem fica registrada por ponto de contato (`contact_points.source_*`).
- Oferecer **saída simples** ("se não quiser receber mensagens, é só avisar").
- Manter **aviso de privacidade** público da Docline cobrindo prospecção, com canal do encarregado.

---

## 10. Direitos dos titulares

Art. 18: confirmação, acesso, correção, anonimização/bloqueio/eliminação, portabilidade, informação sobre compartilhamento, revogação do consentimento, oposição.

| Etapa | No sistema |
|---|---|
| Recebimento | `data_subject_requests` (registro manual no MVP), com prazo calculado |
| Verificação de identidade | Checklist antes de entregar dados |
| Localização | Busca por telefone/e-mail/CNPJ normalizado em todos os leads |
| Atendimento | Exportação dos dados do titular; correção; anonimização; inclusão na Lista Não Contatar (oposição) |
| Prazo | Acesso em formato simplificado imediatamente; declaração completa em até **15 dias** (art. 19). Demais pedidos no prazo definido pelo jurídico |
| Registro | Resposta e data ficam registradas e auditadas |

---

## 11. Minimização e qualidade

- Campos do lead limitados ao necessário para prospecção B2B.
- **Observações livres**: orientação na tela para não registrar dados sensíveis nem opiniões pessoais sobre o titular.
- Colunas extras de planilhas só são guardadas se mapeadas explicitamente.
- Arquivos de importação **não são guardados** após o processamento; as linhas temporárias são purgadas.
- Contatos inválidos são marcados (`INVALID`, `WRONG_PERSON`) e não usados.
- IA recebe só o contexto mínimo ([AI-SDR §5](./AI-SDR.md#5-contexto-enviado-à-ia)).

---

## 12. Retenção (proposta)

Prazos **a validar com o jurídico**; configuráveis em `retention_policies`.

| Dado | Prazo proposto | Ação ao fim |
|---|---|---|
| Lead sem interação e sem relação comercial | 24 meses desde a última atividade | Anonimizar |
| Lead que pediu exclusão | Imediato (respeitadas obrigações legais) | Anonimizar/excluir; manter hash na Lista Não Contatar |
| Lista Não Contatar | Enquanto houver risco de recontato | Manter só hash + máscara |
| Linhas de importação (`import_rows`) | 30 dias | Excluir |
| Arquivos de importação | Não armazenados | — |
| Resultados de prospecção (`prospecting_results`) | 30 dias | Excluir (job `prospecting.purge`, Fase 9); a busca fica, sem os resultados |
| Leads das campanhas (`campaign_leads`) | Enquanto a campanha existir (sem dado pessoal em claro) | Seguem o lead (apagados junto se o lead for excluído) |
| Cópia da base aberta do CNPJ (`registry_companies`) | Até a carga do mês seguinte | Atualizar; o que saiu da base (baixado, outra atividade) é apagado |
| Payloads de webhook | 90 dias | Excluir (job `webhooks.purge`, Fase 7) |
| Mensagens de números sem lead (`inbound_unmatched`) | 90 dias | Excluir (job `webhooks.purge`, Fase 7; Instagram incluído na Fase 8) |
| Comentários de leads no Instagram da Docline (`social_comments`) | Enquanto o lead existir (proposta, a validar) | Excluir na anonimização |
| Métricas públicas do Instagram (`instagram_profiles`) | Substituídas a cada consulta (30 dias) | Excluir na anonimização ou com o contato |
| Contexto enviado à IA (`input_snapshot`) | 12 meses | Anonimizar |
| Rollups dos indicadores (`daily_metrics`, `analytics_lead_facts`) | Enquanto houver dados de origem (agregados; os fatos por lead são recalculados de hora em hora) | Recalculados: o lead mesclado sai dos fatos na rodada seguinte; o anonimizado fica só com ids, datas, cidade e canal (sem dado pessoal) |
| Insights da carteira (`insights`) | 180 dias | Excluir (job `analytics.insights`, Fase 11); só contagens, cidades e abordagens |
| Mensagens | 5 anos (proposta, a validar) | Anonimizar conteúdo |
| Auditoria | 5 anos (proposta, a validar) | Excluir |
| Backups | Rotação de 30 dias | Expiram naturalmente |

---

## 13. Anonimização e exclusão

- **Anonimização** (padrão): remove ou embaralha nome, pessoas, pontos de contato, observações e conteúdo de mensagens; mantém o registro com `status = ANONYMIZED` para que métricas agregadas (quantos contatos, conversões por cidade) continuem corretas.
- **Exclusão física**: só pela rotina de retenção ou por decisão do jurídico, auditada.
- O hash na Lista Não Contatar é mantido para garantir o respeito ao opt-out.
- **Implementado na Fase 2** (`anonymizeLead`, só ADMIN, com motivo): antes de apagar, telefone, e-mail, Instagram, CNPJ e o próprio lead entram na Lista Não Contatar (motivo "solicitação do titular" quando vinculado a um pedido). Depois são removidos nome, razão social, CNPJ, endereço, site, pessoas, valores e hashes dos contatos, observações, evidências e detalhes de origem. Cidade, UF, origem, datas e eventos (que não guardam dados pessoais em claro) são mantidos para as métricas.
- **Operação comercial (Fase 5):** a anonimização também apaga:
  - o texto das mensagens e o trecho que disparou o opt-out;
  - as anotações de ligações e reuniões;
  - título, descrição e resultado das tarefas;
  - o checklist e as notas da oportunidade;
  - título e texto dos avisos ligados ao lead.

  Depois, a cadência é encerrada e as tarefas abertas são canceladas. A timeline e a auditoria guardam só tipos, datas, canais e classificações, sem texto livre, e por isso não precisam de limpeza depois.
- **Mesclagem e importação (Fase 3):** anonimizar um lead também apaga os dados dos leads mesclados nele (que continuam `MERGED`), a cópia guardada em `lead_merges`, os campos extras da importação (`custom_fields`) e as linhas de importação ainda não purgadas ligadas a eles. O "Não Contatar este lead" do mesclado passa para o sobrevivente na mesclagem, e um opt-in revogado em qualquer dos dois prevalece.
- **WhatsApp (Fase 7):** a anonimização também apaga as conversas (número do WhatsApp e nome do perfil), as variáveis dos modelos enviados, os payloads brutos de webhook que citam qualquer telefone do lead (achados pelo HMAC do número, sem guardar o número em claro no índice) e as mensagens de "número sem lead" desses telefones ou já vinculadas ao lead. Mesclar dois leads leva as conversas e o opt-in do mesmo número para o sobrevivente; revogado em qualquer dos dois prevalece.
- **Instagram (Fase 8):** a anonimização apaga também as conversas (IGSID, @ e nome do perfil), os comentários do lead, as métricas públicas dos @ dele, os payloads de webhook que citam o @ ou o IGSID (achados pelos HMACs) e as mensagens de "quem não é lead" com esse @ ou IGSID. Mesclar leva as conversas e os comentários para o sobrevivente.
- **Campanhas (Fase 10):** nada a apagar: as linhas da campanha guardam só ids, motivos e datas. O lead anonimizado deixa de ser apto (motivo "arquivado, mesclado ou anonimizado") e não é liberado.
- **Prospecção (Fase 9):** a anonimização põe o CNPJ na Lista Não Contatar (como o opt-out em todos os canais), e o escritório passa a aparecer na Prospecção como "Na Lista Não Contatar", sem poder ser aprovado. Os resultados de busca apontam para o lead por id (o vínculo cai se ele for excluído) e somem em 30 dias. A cópia da base aberta é dado público da Receita e segue a carga mensal.
- Backups expiram pelo ciclo de rotação; o procedimento documenta que dados excluídos podem existir em backup até a expiração, sem uso.

---

## 14. Controle de acesso, exportação e auditoria

- Perfis e escopos em [SECURITY §4](./SECURITY.md#4-autorização-rbac): o SDR vê só seus leads e o pool do seu território.
- **Exportação** de leads só para ADMIN/GESTOR, auditada (quem, quando, filtro, quantidade) e protegida contra injeção de fórmulas em CSV.
  > **Implementado na Fase 2:**
  > - **Minimização:** contatos (telefone, WhatsApp, e-mail, Instagram) só entram quando marcados.
  > - **Lista Não Contatar:** contatos que estão na lista nunca saem, nem os de leads ou CNPJs que estão nela.
  > - **Limites:** 5 exportações por usuário em 24 h e até 20.000 leads por arquivo.
  > - **Auditoria:** a busca livre é registrada mascarada.
  > - **Sem arquivo guardado:** o arquivo é gerado na hora e entregue na resposta; nada fica no servidor. A versão assíncrona fica para quando o volume exigir (ARCHITECTURE §9.2).
- `audit_logs` imutável: alterações de leads, decisões de duplicados, mudanças de permissão/base legal, revogações de supressão, exportações, logins.
- Relatório periódico de acessos e exportações para o encarregado.

---

## 15. Incidentes de segurança

1. Conter e preservar evidências (runbook em [SECURITY §17](./SECURITY.md#17-resposta-a-incidentes)).
2. Avaliar risco ou dano relevante aos titulares.
3. Comunicar ANPD e titulares quando aplicável (art. 48). A Resolução CD/ANPD nº 15/2024 regulamenta a comunicação e estabelece prazo de **3 dias úteis** (confirmar com o jurídico).
4. Registrar o incidente e as medidas, mesmo quando não comunicado.

---

## 16. Transferência internacional

Hospedagem fora do Brasil (ex.: Render nos EUA/Europa), provedor de IA, Sentry e Meta implicam **transferência internacional** (art. 33). Caminhos: cláusulas-padrão contratuais aprovadas pela ANPD (Resolução CD/ANPD nº 19/2024) nos contratos com fornecedores, ou hospedagem em região brasileira para o banco principal.

**Decisão (2026-10-08):** hospedagem na **Render, região Virginia (EUA)** ([ARCHITECTURE ADR-019](./ARCHITECTURE.md#15-registro-de-decisões-adrs)). Portanto vale o caminho das cláusulas-padrão. Antes de qualquer dado pessoal real entrar no sistema:

- revisar o DPA da Render e incorporar as cláusulas-padrão da ANPD (jurídico/DPO);
- citar a transferência internacional no aviso de privacidade e no registro de operações (§17);
- até lá, staging e testes usam **somente dados fictícios**.

---

> **Meta (Fase 7).** Com a Cloud API, os números e o texto das mensagens passam pela Meta, que atua como **operadora** para a WhatsApp Business Platform (confirmar o papel nos termos vigentes) e trata dados fora do Brasil. Antes de ligar a API: incluir a Meta no registro de operações e no aviso de privacidade, e o jurídico avaliar os termos de dados da plataforma e as cláusulas-padrão. No modo assistido, o envio sai do app do WhatsApp da própria equipe, sem passar pelo sistema.
>
> **Meta (Fase 8).** Com a Instagram API, o @, o IGSID, o texto das mensagens e dos comentários e as métricas públicas passam pela Meta (Plataforma Meta, termos de dados próprios). Os mesmos passos antes de ligar: registro de operações, aviso de privacidade e avaliação dos Termos da Plataforma Meta, inclusive os limites de armazenamento e exclusão de dados obtidos pela API.

> **Implementação (Fase 6).** A IA nasce **desligada** (`AI_PROVIDER=fake`): os rascunhos vêm de um modelo fixo e nenhum dado de lead sai do sistema. Ligar o provedor real é decisão da Docline, depois das cláusulas-padrão com o fornecedor e da avaliação offline com dados fictícios (AI-SDR §14.1). O que foi enviado a cada geração fica em `ai_generations.input_snapshot`; a purga automática pelos prazos da §12 ainda não está implementada (hoje vale a anonimização).

## 17. Registro das operações de tratamento

Base para o registro exigido pelo art. 37 (a completar pelo encarregado):

| Operação | Dados | Titulares | Base legal | Finalidade | Retenção | Operadores |
|---|---|---|---|---|---|---|
| Cadastro e importação de leads | Identificação e contato profissional | Contadores, sócios, responsáveis | Legítimo interesse (LIA) / outras por origem | Prospecção B2B | §12 | Hospedagem |
| Contato e follow-up | Telefone, Instagram, mensagens | Idem | Idem + opt-in de plataforma (API) | Prospecção | §12 | Hospedagem, Meta (Fase 7+) |
| Base aberta do CNPJ e Prospecção (Fase 9) | Dados cadastrais públicos de escritórios de contabilidade ativos (nomes, CNAE, endereço, telefones e e-mail declarados) | Escritórios; empresário individual só se liberado | Legítimo interesse (dado público, art. 7º, §§ 3º e 4º) | Descobrir e priorizar escritórios para prospecção B2B | Cópia: mês seguinte; resultados: 30 dias | Hospedagem |
| Campanhas de prospecção (Fase 10) | Ids dos leads, motivos de inelegibilidade, SDR, variante e datas dos marcos | Leads selecionados | Legítimo interesse (a mesma da prospecção) | Organizar o ritmo de contato e medir abordagens | Enquanto a campanha existir | Hospedagem |
| Geração de mensagens por IA | Contexto mínimo do lead | Idem | Legítimo interesse | Personalização | 12 meses | Provedor de IA |
| Indicadores e insights (Fase 11) | Agregados e fatos por lead (datas dos marcos, canal, abordagem, responsável); para a IA, só contagens, cidades e nomes de abordagens | Leads (agregados) | Legítimo interesse | Medir e priorizar a prospecção | Rollups: recalculados; insights: 180 dias | Hospedagem; provedor de IA (só os textos dos fatos) |
| Distribuição automática (Fase 11) | Participação, limite de leads ativos e ausência de cada SDR | Funcionários Docline | Execução de contrato / legítimo interesse | Distribuir o trabalho | Enquanto o usuário existir; mudanças auditadas | Hospedagem |
| Lista Não Contatar | Hash de identificadores | Quem pediu opt-out | Exercício regular de direitos / legítimo interesse | Respeitar oposição | Indeterminado (hash) | Hospedagem |
| Atendimento a titulares | Dados do pedido | Titulares | Obrigação legal | Cumprir LGPD | 5 anos (proposta) | Hospedagem |
| Usuários internos | Nome, e-mail, logs de acesso | Funcionários Docline | Execução de contrato / legítimo interesse | Operação e segurança | Vínculo + prazo | Hospedagem, Sentry |

---

## 18. Como o sistema implementa cada requisito do §25

| Requisito | Implementação |
|---|---|
| Registro da origem do dado | `leads.origin_*`, `lead_origins`, `contact_points.source_*` |
| Data da coleta | `collected_at` em lead, origem e ponto de contato |
| Base legal / status de contato | `contact_permissions` + gate + `leads.contact_status` |
| Opt-out | `suppression_entries` + detecção + parada de cadência |
| Não contatar | Lista Não Contatar global por identificador |
| Data da última interação | `leads.last_activity_at`, `last_contact_at`, `last_inbound_at` |
| Log de alterações | `audit_logs` (diffs) + `lead_events` |
| Auditoria de mensagens | `messages` (texto enviado, quem aprovou, quem enviou, quando) + `ai_generations` |
| Controle de acesso | RBAC + escopos no servidor |
| Política de retenção futura | `retention_policies` + job `retention.enforce` |

---

## 19. Checklist por fase

**Fase 1–2 (fundação e CRM)**
- [x] Origem, data de coleta e base legal obrigatórias no cadastro.
- [x] `contact_permissions` e `suppression_entries` com testes (incluindo garantias no banco: a lista não pode ser alterada nem apagada, só revogada).
- [x] Auditoria imutável ativa.
- [x] Logs com mascaramento de dados pessoais.
- [x] Seeds somente com dados fictícios.

**Fase 3 (importação)**
- [x] Importação exige origem e base legal; suprimidos aparecem na prévia.
- [x] Arquivos não persistidos; `import_rows` com purga automática.

**Fase 5–6 (contato e IA)**
- [x] Gate em todas as ações de contato (Fase 5).
- [x] Gate nas ações de geração com IA (Fase 6): lead na Lista Não Contatar ou sem base legal não chega à IA.
- [x] Palavras de opt-out ativas nas respostas registradas (Fase 5).
- [ ] Confirmação de descadastro ao titular (depende do jurídico; ver §8).
- [x] Limites de frequência e janela de horário (Fase 5).
- [x] IA com contexto mínimo (Fase 6): lista branca de campos, só o primeiro nome do responsável, telefones, e-mails e links mascarados; anonimizar o lead limpa contexto, saída e textos dos rascunhos.
- [ ] DPA do provedor de IA revisado (antes de ligar `AI_PROVIDER=anthropic`; até lá, o provedor de demonstração não envia nada a terceiros).

**Go-live do MVP**
- [ ] Itens da §20 validados.
- [ ] Aviso de privacidade publicado; canal do encarregado definido.
- [ ] Processo de atendimento a titulares testado.

**Fases 7–9**
- [x] Opt-in WhatsApp com evidência antes de qualquer envio via API (Fase 7): por número, com evidência conferida ou descrita, auditado; opt-out e o erro 131050 revogam.
- [x] Payloads de webhook e mensagens de números sem lead com purga em 90 dias; anonimização cobre conversas e payloads (Fase 7).
- [x] Instagram só responde a quem procurou a Docline; comentários só de leads; métricas públicas mínimas; anonimização e purga cobrem conversas, comentários, métricas e payloads (Fase 8).
- [x] Dados abertos do CNPJ (Fase 9): só o recorte de contabilidade ativo, sem sócios, CPF retirado da razão social, empresário individual fora por padrão, aprovação humana com a Lista Não Contatar conferida, resultados apagados em 30 dias.

**Fase 10 (campanhas)**
- [x] Campanha não envia: libera para a cadência, com limite diário por SDR; cada contato pelo gate.
- [x] Lista Não Contatar, base legal, contato no canal e frequência conferidos na montagem e de novo na liberação, com o motivo à vista.
- [x] Sem dado pessoal em claro nas linhas da campanha.
**Fase 11 (analytics)**
- [x] Relatórios só com números agregados; exportação auditada (`report.export`).
- [x] Insights sem dado pessoal no pedido à IA (só contagens, cidades e nomes de abordagens); texto conferido; retenção de 180 dias.
- [x] Fatos por lead sem dado pessoal (ids, datas, cidade, canal); lead mesclado sai na rodada seguinte do rollup.
- [x] Distribuição automática: dados de disponibilidade de funcionários mínimos (participa, limite, ausente até, sem motivo) e auditados; nunca toma lead de alguém.

- [ ] Meta no registro de operações e no aviso de privacidade; termos de dados da plataforma avaliados (antes de ligar a API do WhatsApp ou do Instagram).
- [ ] Termos Meta e Google revalidados; parecer sobre uso de dados do Google e dos dados abertos CNPJ.

---

## 20. Itens para validação jurídica

1. LIA de prospecção B2B (estrutura na [§5](#5-legítimo-interesse-avaliação-lia)).
2. Base legal de cada base existente da Docline.
3. Política de primeiro contato por WhatsApp no modo assistido (volume, público, textos).
4. Textos padrão: primeira mensagem, opt-out, confirmação de descadastro.
5. Prazos de retenção da [§12](#12-retenção-proposta).
6. Uso dos dados abertos do CNPJ para prospecção (especialmente MEI/empresário individual). **Fase 9:** implementado e desligado em produção; empresário individual fora por padrão ([§6.2](#62-dados-abertos-do-cnpj-e-prospecção-fase-9)). O parecer decide se a base liga e se o empresário individual entra.
7. Uso de dados do Google Places (o que pode ser armazenado e exibido).
8. Transferência internacional (hospedagem, IA, Meta, Sentry) e contratos com operadores.
11. **WhatsApp pela API (Fase 7):** quais métodos de opt-in a Docline aceitará e que evidência basta para cada um; se a "relação comercial existente" vale como opt-in; o texto dos modelos de prospecção (categoria Marketing).
9. Necessidade de encarregado (ou dispensa) e canal de atendimento.
10. Aviso de privacidade cobrindo a prospecção.
12. **Instagram pela API (Fase 8):** uso das métricas públicas de perfis profissionais (Business Discovery) para priorizar leads; guarda de comentários de leads nas publicações da Docline e o prazo; tratamento de pedidos de opt-out feitos em comentários públicos.
