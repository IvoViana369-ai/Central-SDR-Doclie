# LGPD e Governança de Dados — Docline SDR

> **Status:** Fase 0 · **Aviso:** este documento é um guia **técnico e operacional** de privacidade desde a concepção. Ele **não substitui** a análise do jurídico e do encarregado (DPO) da Docline. Os itens da [§20](#20-itens-para-validação-jurídica) precisam de validação antes do go-live.
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
| Operadores | Hospedagem (ex.: Render), provedor de IA, provedor de e-mail, Meta (WhatsApp Cloud API), Sentry | Contratos/DPAs revisados; papel exato conforme termos de cada fornecedor |
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
- **Confirmação ao titular: pendente.** No modo assistido, o gate bloqueia qualquer mensagem depois do opt-out. A mensagem única de confirmação depende de decisão do jurídico (§20) e, no WhatsApp, de template próprio (Fase 7).

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
| Resultados de prospecção (`prospecting_results`) | 30 dias | Excluir |
| Payloads de webhook | 90 dias | Excluir |
| Contexto enviado à IA (`input_snapshot`) | 12 meses | Anonimizar |
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

## 17. Registro das operações de tratamento

Base para o registro exigido pelo art. 37 (a completar pelo encarregado):

| Operação | Dados | Titulares | Base legal | Finalidade | Retenção | Operadores |
|---|---|---|---|---|---|---|
| Cadastro e importação de leads | Identificação e contato profissional | Contadores, sócios, responsáveis | Legítimo interesse (LIA) / outras por origem | Prospecção B2B | §12 | Hospedagem |
| Contato e follow-up | Telefone, Instagram, mensagens | Idem | Idem + opt-in de plataforma (API) | Prospecção | §12 | Hospedagem, Meta (Fase 7+) |
| Geração de mensagens por IA | Contexto mínimo do lead | Idem | Legítimo interesse | Personalização | 12 meses | Provedor de IA |
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
- [ ] Gate nas ações de geração com IA (Fase 6).
- [x] Palavras de opt-out ativas nas respostas registradas (Fase 5).
- [ ] Confirmação de descadastro ao titular (depende do jurídico; ver §8).
- [x] Limites de frequência e janela de horário (Fase 5).
- [ ] IA com contexto mínimo; DPA do provedor revisado.

**Go-live do MVP**
- [ ] Itens da §20 validados.
- [ ] Aviso de privacidade publicado; canal do encarregado definido.
- [ ] Processo de atendimento a titulares testado.

**Fases 7–9**
- [ ] Opt-in WhatsApp com evidência antes de qualquer envio via API.
- [ ] Termos Meta e Google revalidados; parecer sobre uso de dados do Google e dos dados abertos CNPJ.

---

## 20. Itens para validação jurídica

1. LIA de prospecção B2B (estrutura na [§5](#5-legítimo-interesse-avaliação-lia)).
2. Base legal de cada base existente da Docline.
3. Política de primeiro contato por WhatsApp no modo assistido (volume, público, textos).
4. Textos padrão: primeira mensagem, opt-out, confirmação de descadastro.
5. Prazos de retenção da [§12](#12-retenção-proposta).
6. Uso dos dados abertos do CNPJ para prospecção (especialmente MEI/empresário individual).
7. Uso de dados do Google Places (o que pode ser armazenado e exibido).
8. Transferência internacional (hospedagem, IA, Meta, Sentry) e contratos com operadores.
9. Necessidade de encarregado (ou dispensa) e canal de atendimento.
10. Aviso de privacidade cobrindo a prospecção.
