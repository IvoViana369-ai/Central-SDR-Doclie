import { z } from 'zod';

const id = z.uuid({ message: 'Identificador inválido.' });
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres.`)
    .nullish()
    .transform((v) => v || null);
const instant = z.coerce.date({ message: 'Data e hora inválidas.' });

/** Tipos que a pessoa cria à mão (os demais vêm da cadência, das respostas e da transferência). */
export const MANUAL_TASK_TYPES = ['FOLLOW_UP', 'CALL', 'MEETING', 'CUSTOM'] as const;

/** Follow-up avulso ou outra tarefa agendada (M11). */
export const createTaskInput = z.object({
  leadId: id,
  type: z.enum(MANUAL_TASK_TYPES).default('FOLLOW_UP'),
  title: z.string().trim().min(2, 'Descreva a tarefa.').max(120),
  description: text(1000),
  dueAt: instant,
  /** Padrão: quem cria. Só gestor e ADMIN atribuem a outra pessoa. */
  assigneeId: id.nullish(),
});

export const rescheduleTaskInput = z.object({
  taskId: id,
  dueAt: instant,
  reason: text(300),
});

export const completeTaskInput = z.object({
  taskId: id,
  outcome: text(300),
});

export const cancelTaskInput = z.object({
  taskId: id,
  reason: text(300),
});

export const leadTasksInput = z.object({ leadId: id });

export const ACTIVITY_TYPES = ['CALL', 'MEETING', 'VISIT', 'EMAIL_EXTERNAL', 'OTHER'] as const;
export const ACTIVITY_OUTCOMES = [
  'CONNECTED',
  'NO_ANSWER',
  'BUSY',
  'WRONG_NUMBER',
  'VOICEMAIL',
  'HELD',
  'NO_SHOW',
] as const;

/** Registrar ligação, reunião ou visita (F5-02), opcionalmente concluindo uma tarefa. */
export const logActivityInput = z.object({
  leadId: id,
  type: z.enum(ACTIVITY_TYPES),
  outcome: z.enum(ACTIVITY_OUTCOMES).nullish(),
  occurredAt: instant.optional(),
  durationMinutes: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .nullish(),
  notes: text(2000),
  contactPointId: id.nullish(),
  taskId: id.nullish(),
});
