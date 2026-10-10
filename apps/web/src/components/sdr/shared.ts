import type { GateResult } from '@docline/core/compliance-domain';

/** Resultado de /leads/{id}/contactability, com os contatos ativos. */
export interface ContactabilityView {
  contactStatus: string;
  contactStatusLabel: string;
  channels: GateResult[];
  contactPoints: { id: string; type: 'PHONE' | 'EMAIL' | 'INSTAGRAM'; display: string }[];
}

/** Tarefa que um contato cumpre (passo de cadência, resposta, follow-up). */
export interface TaskRef {
  id: string;
  title: string;
  type: string;
  messageType: string | null;
  channel: string | null;
  enrollmentId: string | null;
  /** Campanha que liberou o lead e a abordagem sorteada (Fase 10). */
  campaign?: { id: string; name: string; approach: { id: string; name: string } | null } | null;
}

/** Tarefa que se cumpre com uma mensagem (as de ligação vão por "Registrar contato"). */
export function isContactTask(task: Pick<TaskRef, 'type' | 'channel'>): boolean {
  return (
    ['FIRST_CONTACT', 'FOLLOW_UP', 'REPLY_NEEDED'].includes(task.type) && task.channel !== 'PHONE'
  );
}

export interface MessageView {
  id: string;
  leadId: string;
  channel: string;
  direction: 'OUTBOUND' | 'INBOUND';
  mode: 'ASSISTED' | 'API' | 'LOGGED';
  messageType: string | null;
  messageTypeLabel: string | null;
  body: string | null;
  status: string;
  statusLabel: string;
  sentAt: string | Date | null;
  receivedAt: string | Date | null;
  createdAt: string | Date;
  classification: string | null;
  classificationLabel: string | null;
  classificationSource: string | null;
  optOutMatch: string | null;
  contactPoint: { id: string; type: string; display: string | null } | null;
  sentBy: { id: string; name: string } | null;
  /** Sugestão de classificação da IA já pedida (inclusive a automática do WhatsApp, F7-07). */
  suggestion?: {
    label: string;
    confidence: number;
    rationale: string;
    suggestedNextStep: string;
    flags: { code: string; message: string }[];
  } | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Valor de `<input type="datetime-local">` no horário do navegador. */
export function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `datetime-local` (hora do navegador) → ISO. */
export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}
