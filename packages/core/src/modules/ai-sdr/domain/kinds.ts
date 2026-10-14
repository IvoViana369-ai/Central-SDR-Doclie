/**
 * O que a IA gera (docs/AI-SDR.md §7): os 8 tipos de mensagem do requisito, a
 * sugestão de classificação de uma resposta recebida e a redação dos insights
 * da carteira (Fase 11, sem lead).
 */

export const OUTREACH_KINDS = [
  'FIRST_CONTACT',
  'FOLLOW_UP_1',
  'FOLLOW_UP_2',
  'FOLLOW_UP_3',
  'INTERESTED_REPLY',
  'OBJECTION_REPLY',
  'SCHEDULING',
  'REACTIVATION',
] as const;

export type OutreachKind = (typeof OUTREACH_KINDS)[number];
export type AiGenerationKindKey = OutreachKind | 'REPLY_CLASSIFICATION' | 'INSIGHT';

export const AI_KIND_LABELS: Record<AiGenerationKindKey, string> = {
  FIRST_CONTACT: 'Primeiro contato',
  FOLLOW_UP_1: 'Follow-up 1',
  FOLLOW_UP_2: 'Follow-up 2',
  FOLLOW_UP_3: 'Follow-up 3',
  INTERESTED_REPLY: 'Resposta a interessado',
  OBJECTION_REPLY: 'Resposta a objeção',
  SCHEDULING: 'Agendamento',
  REACTIVATION: 'Reativação',
  REPLY_CLASSIFICATION: 'Classificação de resposta',
  INSIGHT: 'Insights da carteira',
};

/** Objetivo de cada tipo, enviado à IA junto com o pedido (§7). */
export const KIND_GOALS: Record<OutreachKind, string> = {
  FIRST_CONTACT:
    'Abrir a conversa com relevância: diga quem escreve e de onde, dê um motivo concreto para o contato e termine com uma pergunta simples. Sem links.',
  FOLLOW_UP_1:
    'Retomar sem pressão: faça referência ao contato anterior e traga um ângulo de valor diferente.',
  FOLLOW_UP_2: 'Mostrar um benefício concreto da parceria, usando um dos fatos aprovados.',
  FOLLOW_UP_3:
    'Encerrar com elegância: avise que é a última mensagem, deixe a porta aberta e ofereça explicitamente a opção de não receber mais mensagens.',
  INTERESTED_REPLY:
    'O lead demonstrou interesse: confirme o interesse, explique o próximo passo e proponha dois horários para uma conversa.',
  OBJECTION_REPLY:
    'O lead levantou uma objeção: reconheça a objeção e responda só com fatos aprovados, sem pressão.',
  SCHEDULING: 'Confirmar a reunião combinada: data, hora, canal e quem participa.',
  REACTIVATION:
    'Retomar um lead parado há tempo: traga um contexto novo, sem cobrar a falta de resposta, e ofereça a opção de não receber mais mensagens.',
};
