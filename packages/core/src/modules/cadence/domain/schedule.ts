import { dueAfter, type BusinessCalendar } from '../../../shared/calendar';

/**
 * Agenda da cadência (docs/SDR-FLOW.md §4): cada passo vence no início da
 * janela do dia previsto, no fuso do lead. Se o SDR executa um passo com
 * atraso, o próximo conta da execução real, para as mensagens não se
 * acumularem.
 */

export interface StepPlan {
  position: number;
  /** Dia do passo contado do início da cadência (D0, D2, D5…). */
  dayOffset: number;
}

/** Vencimento do primeiro passo, contado da inscrição. */
export function firstStepDue(enrolledAt: Date, step: StepPlan, calendar: BusinessCalendar): Date {
  return dueAfter(enrolledAt, step.dayOffset, calendar);
}

/** Vencimento do próximo passo: o intervalo previsto entre os dois, a partir da execução. */
export function nextStepDue(
  executedAt: Date,
  executed: StepPlan,
  next: StepPlan,
  calendar: BusinessCalendar,
): Date {
  return dueAfter(executedAt, Math.max(next.dayOffset - executed.dayOffset, 0), calendar);
}

/** Prazo para "Sem resposta" depois do último passo executado. */
export function noResponseDue(executedAt: Date, days: number, calendar: BusinessCalendar): Date {
  return dueAfter(executedAt, days, calendar);
}

/** Agenda prevista se todos os passos forem feitos no dia (prévia ao inscrever). */
export function plannedSchedule(
  enrolledAt: Date,
  steps: StepPlan[],
  noResponseAfterDays: number,
  calendar: BusinessCalendar,
): { steps: { position: number; dueAt: Date }[]; noResponseAt: Date | null } {
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  const result: { position: number; dueAt: Date }[] = [];
  let previous: { step: StepPlan; dueAt: Date } | null = null;
  for (const step of ordered) {
    const dueAt: Date = previous
      ? nextStepDue(previous.dueAt, previous.step, step, calendar)
      : firstStepDue(enrolledAt, step, calendar);
    result.push({ position: step.position, dueAt });
    previous = { step, dueAt };
  }
  return {
    steps: result,
    noResponseAt: previous ? noResponseDue(previous.dueAt, noResponseAfterDays, calendar) : null,
  };
}

/** Passos de uma cadência configurada pelo ADMIN: ao menos um, dias crescentes. */
export function validateCadenceSteps(steps: { dayOffset: number }[]): string[] {
  const issues: string[] = [];
  if (steps.length === 0) issues.push('A cadência precisa de ao menos um passo.');
  steps.forEach((step, i) => {
    if (step.dayOffset < 0) issues.push(`Passo ${i + 1}: o dia não pode ser negativo.`);
    if (i > 0 && step.dayOffset <= steps[i - 1]!.dayOffset) {
      issues.push(`Passo ${i + 1}: o dia deve ser depois do passo anterior.`);
    }
  });
  return issues;
}

/** Título da tarefa de cada passo, pelo tipo de mensagem. */
export const STEP_TASK_TITLES: Record<string, string> = {
  FIRST_CONTACT: 'Primeiro contato',
  FOLLOW_UP_1: 'Follow-up 1',
  FOLLOW_UP_2: 'Follow-up 2',
  FOLLOW_UP_3: 'Follow-up 3',
  REACTIVATION: 'Reativação',
  OTHER: 'Contato da cadência',
};

export const ENROLLMENT_STATUS_LABELS = {
  ACTIVE: 'Ativa',
  PAUSED: 'Pausada',
  COMPLETED: 'Concluída sem resposta',
  STOPPED: 'Encerrada',
} as const;
