import { describe, expect, it } from 'vitest';
import { QUEUE_SECTIONS, queuePriority } from './queue';

const now = new Date('2026-10-13T12:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe('prioridade da Minha Fila (M10)', () => {
  it('ordem padrão das seções: respostas, atrasados, hoje, quentes, novos', () => {
    expect(QUEUE_SECTIONS.slice(0, 7).map((s) => s.key)).toEqual([
      'REPLIES',
      'OVERDUE',
      'PENDING_CONFIRMATION',
      'TODAY_FIRST_CONTACT',
      'TODAY_FOLLOW_UP',
      'HOT_LEADS',
      'NEW_LEADS',
    ]);
  });

  it('peso da seção + score × 0,5 + atraso (até 10 dias) × 5 + resposta pendente', () => {
    expect(queuePriority({ section: 'TODAY_FOLLOW_UP', score: 40, now })).toBe(55 + 20);
    expect(queuePriority({ section: 'OVERDUE', score: 40, dueAt: daysAgo(3), now })).toBe(
      80 + 20 + 15,
    );
    // O atraso conta até 10 dias.
    expect(queuePriority({ section: 'OVERDUE', score: null, dueAt: daysAgo(30), now })).toBe(
      80 + 50,
    );
    expect(queuePriority({ section: 'REPLIES', score: 60, now, replyPending: true })).toBe(
      100 + 30 + 40,
    );
  });

  it('um lead quente atrasado passa na frente de um frio atrasado há mais tempo', () => {
    const hot = queuePriority({ section: 'OVERDUE', score: 90, dueAt: daysAgo(1), now });
    const cold = queuePriority({ section: 'OVERDUE', score: 10, dueAt: daysAgo(4), now });
    expect(hot).toBeGreaterThan(cold);
  });
});
