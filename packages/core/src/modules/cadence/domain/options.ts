/** Opções de um passo de cadência (contratos e tela de configuração). */
export const CADENCE_CHANNELS = ['WHATSAPP', 'INSTAGRAM', 'EMAIL', 'PHONE', 'ANY'] as const;
export const CADENCE_ACTIONS = ['ASSISTED_MESSAGE', 'CALL', 'TASK'] as const;
export const CADENCE_MESSAGE_TYPES = [
  'FIRST_CONTACT',
  'FOLLOW_UP_1',
  'FOLLOW_UP_2',
  'FOLLOW_UP_3',
  'REACTIVATION',
  'OTHER',
] as const;

export const CADENCE_ACTION_LABELS: Record<(typeof CADENCE_ACTIONS)[number], string> = {
  ASSISTED_MESSAGE: 'Mensagem assistida',
  CALL: 'Ligação',
  TASK: 'Tarefa',
};
