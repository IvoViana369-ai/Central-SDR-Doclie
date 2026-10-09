import type { DbClient } from '../src/client';
import { backfillLeadStages } from '../src/pipeline-backfill';

/**
 * Configuração comercial inicial: pipeline padrão com as 17 etapas, motivos de
 * perda e o modelo de score v1 (Fase 4), e a cadência padrão (Fase 5)
 * (docs/DATABASE.md §8.1 a §8.4).
 * Idempotente e conservadora: só cria o que falta. O ADMIN pode renomear,
 * reordenar e recolorir etapas e publicar novas versões do score; o seed nunca
 * desfaz essas escolhas.
 */

export const DEFAULT_PIPELINE_KEY = 'DEFAULT';

type StageSeed = {
  key: string;
  name: string;
  category: 'OPEN' | 'WON' | 'LOST' | 'PARKED';
  ownerRole: 'SDR' | 'SALES' | null;
  color: string;
  requiresLossReason?: boolean;
  description: string;
};

export const PIPELINE_STAGES: StageSeed[] = [
  {
    key: 'NEW',
    name: 'Novo',
    category: 'OPEN',
    ownerRole: 'SDR',
    color: 'slate',
    description: 'Cadastro ou importação.',
  },
  {
    key: 'TO_QUALIFY',
    name: 'A qualificar',
    category: 'OPEN',
    ownerRole: 'SDR',
    color: 'slate',
    description: 'Conferir se é do público-alvo e se o contato está certo.',
  },
  {
    key: 'QUALIFIED',
    name: 'Qualificado',
    category: 'OPEN',
    ownerRole: 'SDR',
    color: 'blue',
    description: 'Do público-alvo, pronto para a abordagem.',
  },
  {
    key: 'AWAITING_OUTREACH',
    name: 'Aguardando prospecção',
    category: 'OPEN',
    ownerRole: 'SDR',
    color: 'blue',
    description: 'Na fila para o primeiro contato.',
  },
  {
    key: 'FIRST_CONTACT',
    name: 'Primeiro contato',
    category: 'OPEN',
    ownerRole: 'SDR',
    color: 'teal',
    description: 'Entra ao registrar o primeiro contato (passa pelo gate de contactabilidade).',
  },
  {
    key: 'FOLLOW_UP_1',
    name: 'Follow-up 1',
    category: 'OPEN',
    ownerRole: 'SDR',
    color: 'teal',
    description: 'Movido pela cadência.',
  },
  {
    key: 'FOLLOW_UP_2',
    name: 'Follow-up 2',
    category: 'OPEN',
    ownerRole: 'SDR',
    color: 'teal',
    description: 'Movido pela cadência.',
  },
  {
    key: 'FOLLOW_UP_3',
    name: 'Follow-up 3',
    category: 'OPEN',
    ownerRole: 'SDR',
    color: 'teal',
    description: 'Movido pela cadência.',
  },
  {
    key: 'REPLIED',
    name: 'Respondeu',
    category: 'OPEN',
    ownerRole: 'SDR',
    color: 'violet',
    description: 'Entra ao registrar a resposta do lead.',
  },
  {
    key: 'INTERESTED',
    name: 'Interessado',
    category: 'OPEN',
    ownerRole: 'SDR',
    color: 'green',
    description: 'Resposta classificada como interesse.',
  },
  {
    key: 'MEETING',
    name: 'Reunião',
    category: 'OPEN',
    ownerRole: 'SDR',
    color: 'green',
    description: 'Reunião marcada com o Comercial.',
  },
  {
    key: 'OPPORTUNITY',
    name: 'Oportunidade',
    category: 'OPEN',
    ownerRole: 'SALES',
    color: 'amber',
    description: 'Transferido ao Comercial.',
  },
  {
    key: 'NEGOTIATION',
    name: 'Negociação',
    category: 'OPEN',
    ownerRole: 'SALES',
    color: 'amber',
    description: 'Em negociação com o Comercial.',
  },
  {
    key: 'CONVERTED',
    name: 'Convertido',
    category: 'WON',
    ownerRole: 'SALES',
    color: 'green',
    description: 'Parceiro ou cliente fechado.',
  },
  {
    key: 'NOT_INTERESTED',
    name: 'Sem interesse',
    category: 'LOST',
    ownerRole: null,
    color: 'red',
    requiresLossReason: true,
    description: 'Motivo de perda obrigatório.',
  },
  {
    key: 'NO_RESPONSE',
    name: 'Sem resposta',
    category: 'PARKED',
    ownerRole: null,
    color: 'orange',
    description: 'Fim da cadência sem resposta; pode ser reativado.',
  },
  {
    key: 'DISCARDED',
    name: 'Descartado',
    category: 'LOST',
    ownerRole: null,
    color: 'red',
    requiresLossReason: true,
    description: 'Fora do público ou contato inválido. Motivo obrigatório.',
  },
];

export const LOSS_REASONS = [
  { key: 'NO_INTEREST', name: 'Sem interesse' },
  { key: 'HAS_PROVIDER', name: 'Já tem fornecedor' },
  { key: 'NO_DIGITAL_CERTIFICATE', name: 'Não atua com certificado digital' },
  { key: 'INVALID_CONTACT', name: 'Contato inválido' },
  { key: 'COMPANY_CLOSED', name: 'Empresa encerrada' },
  { key: 'ASKED_NOT_TO_BE_CONTACTED', name: 'Pediu para não ser contatado' },
  { key: 'OUT_OF_PROFILE', name: 'Fora do perfil' },
  { key: 'OTHER', name: 'Outro' },
] as const;

/** Faixas padrão: 0–30 Frio · 31–60 Morno · 61–80 Quente · 81–100 Prioridade. */
export const DEFAULT_SCORE_BANDS = [
  { band: 'COLD', min: 0, max: 30 },
  { band: 'WARM', min: 31, max: 60 },
  { band: 'HOT', min: 61, max: 80 },
  { band: 'PRIORITY', min: 81, max: 100 },
] as const;

/**
 * Modelo inicial (§8.2). Os critérios do Google ficam inativos até a validação
 * jurídica; "Instagram ativo" fica inativo até haver dado de atividade (Fase 8).
 * "Respondeu" e "Mostrou interesse" já valem e passam a pontuar quando as
 * respostas forem registradas (Fase 5).
 */
export const DEFAULT_SCORE_RULES = [
  { criterionKey: 'has_whatsapp', params: {}, points: 20, active: true },
  { criterionKey: 'has_instagram', params: {}, points: 15, active: true },
  { criterionKey: 'has_website', params: {}, points: 10, active: true },
  {
    criterionKey: 'google_reviews_gte',
    params: { min: 1 },
    points: 10,
    active: false,
    description: 'Inativo até a validação jurídica do uso de dados do Google.',
  },
  {
    criterionKey: 'google_reviews_gte',
    params: { min: 21 },
    points: 10,
    active: false,
    description: 'Inativo até a validação jurídica do uso de dados do Google.',
  },
  {
    criterionKey: 'instagram_active',
    params: { maxDaysSincePost: 30 },
    points: 10,
    active: false,
    description: 'Inativo até haver dado de atividade do Instagram (Fase 8).',
  },
  { criterionKey: 'in_priority_city', params: {}, points: 15, active: true },
  { criterionKey: 'replied_before', params: {}, points: 20, active: true },
  { criterionKey: 'showed_interest', params: {}, points: 30, active: true },
] as const;

export const DEFAULT_CADENCE_KEY = 'DEFAULT';

/**
 * Cadência padrão (§8.3): D0 primeiro contato → D2, D5 e D10 follow-ups →
 * 3 dias sem resposta → "Sem resposta". Cada passo vira uma tarefa de contato
 * assistido; nada é enviado sem ação humana.
 */
export const DEFAULT_CADENCE_STEPS = [
  { dayOffset: 0, messageType: 'FIRST_CONTACT', targetStageKey: 'FIRST_CONTACT' },
  { dayOffset: 2, messageType: 'FOLLOW_UP_1', targetStageKey: 'FOLLOW_UP_1' },
  { dayOffset: 5, messageType: 'FOLLOW_UP_2', targetStageKey: 'FOLLOW_UP_2' },
  { dayOffset: 10, messageType: 'FOLLOW_UP_3', targetStageKey: 'FOLLOW_UP_3' },
] as const;

export interface SalesConfigSeedResult {
  stages: number;
  lossReasons: number;
  scoringModelCreated: boolean;
  cadenceCreated: boolean;
  leadsPlacedInPipeline: number;
}

export async function seedSalesConfig(db: DbClient): Promise<SalesConfigSeedResult> {
  const pipeline = await db.pipeline.upsert({
    where: { key: DEFAULT_PIPELINE_KEY },
    create: { key: DEFAULT_PIPELINE_KEY, name: 'Prospecção', isDefault: true },
    update: {},
  });
  // Só cria o que falta: etapas e motivos já existentes ficam como o ADMIN deixou.
  await db.pipelineStage.createMany({
    data: PIPELINE_STAGES.map((stage, position) => ({
      pipelineId: pipeline.id,
      key: stage.key,
      name: stage.name,
      position,
      category: stage.category,
      ownerRole: stage.ownerRole,
      color: stage.color,
      requiresLossReason: stage.requiresLossReason ?? false,
      description: stage.description,
      isSystem: true,
    })),
    skipDuplicates: true,
  });
  await db.lossReason.createMany({
    data: LOSS_REASONS.map((reason, position) => ({ ...reason, position })),
    skipDuplicates: true,
  });

  let scoringModelCreated = false;
  if ((await db.scoringModel.count()) === 0) {
    await db.scoringModel.create({
      data: {
        name: 'Modelo inicial',
        version: 1,
        status: 'ACTIVE',
        normalization: 'CLAMP',
        bands: DEFAULT_SCORE_BANDS.map((b) => ({ ...b })),
        notes: 'Critérios e pesos do levantamento de requisitos (docs/DATABASE.md §8.2).',
        activatedAt: new Date(),
        rules: {
          createMany: {
            data: DEFAULT_SCORE_RULES.map((rule, position) => ({
              criterionKey: rule.criterionKey,
              params: { ...rule.params },
              points: rule.points,
              active: rule.active,
              position,
              description: 'description' in rule ? rule.description : null,
            })),
          },
        },
      },
    });
    scoringModelCreated = true;
  }

  // A cadência padrão só nasce uma vez; depois é do ADMIN.
  let cadenceCreated = false;
  if (!(await db.cadence.findUnique({ where: { key: DEFAULT_CADENCE_KEY } }))) {
    await db.cadence.create({
      data: {
        key: DEFAULT_CADENCE_KEY,
        name: 'Padrão — Contabilidade',
        description: 'Primeiro contato e três follow-ups em dias úteis, na janela de 08h às 18h.',
        isDefault: true,
        stopOnReply: true,
        useBusinessDays: true,
        sendWindowStart: '08:00',
        sendWindowEnd: '18:00',
        noResponseAfterDays: 3,
        steps: {
          createMany: {
            data: DEFAULT_CADENCE_STEPS.map((step, i) => ({
              ...step,
              position: i + 1,
              channel: 'WHATSAPP' as const,
              action: 'ASSISTED_MESSAGE' as const,
            })),
          },
        },
      },
    });
    cadenceCreated = true;
  }

  const leadsPlacedInPipeline = await backfillLeadStages(db);
  return {
    stages: PIPELINE_STAGES.length,
    lossReasons: LOSS_REASONS.length,
    scoringModelCreated,
    cadenceCreated,
    leadsPlacedInPipeline,
  };
}
