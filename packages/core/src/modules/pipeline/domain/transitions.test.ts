import { describe, expect, it } from 'vitest';
import { checkTransition, stageDurationSeconds, type StageRef } from './transitions';

const stage = (
  key: string,
  category: StageRef['category'] = 'OPEN',
  extra: Partial<StageRef> = {},
) => ({
  id: key,
  key,
  name: key,
  category,
  requiresLossReason: category === 'LOST',
  active: true,
  ...extra,
});

const NEW = stage('NEW');
const QUALIFIED = stage('QUALIFIED');
const FIRST_CONTACT = stage('FIRST_CONTACT');
const FOLLOW_UP_2 = stage('FOLLOW_UP_2');
const NO_RESPONSE = stage('NO_RESPONSE', 'PARKED');
const AWAITING = stage('AWAITING_OUTREACH');
const CONVERTED = stage('CONVERTED', 'WON');
const DISCARDED = stage('DISCARDED', 'LOST');
const CUSTOM_LOST = stage('PERDIDO_PRAZO', 'LOST');

const move = (from: StageRef | null, to: StageRef, privileged = false, lossReasonGiven = false) =>
  checkTransition({ from, to, privileged, lossReasonGiven });

describe('regras de movimentação do pipeline (SDR-FLOW §3.2)', () => {
  it('entre etapas abertas, qualquer pessoa com acesso ao lead', () => {
    expect(move(NEW, QUALIFIED)).toEqual({ ok: true, override: false });
    expect(move(QUALIFIED, NEW)).toEqual({ ok: true, override: false });
  });

  it('"Primeiro contato" nunca por arrastar, nem para gestor', () => {
    expect(move(AWAITING, FIRST_CONTACT)).toMatchObject({ ok: false, error: 'ACTION_ONLY' });
    expect(move(AWAITING, FIRST_CONTACT, true)).toMatchObject({ ok: false, error: 'ACTION_ONLY' });
  });

  it('etapas de automação: só gestor/ADMIN, como correção', () => {
    expect(move(QUALIFIED, FOLLOW_UP_2)).toMatchObject({ ok: false, error: 'AUTOMATION_ONLY' });
    expect(move(QUALIFIED, FOLLOW_UP_2, true)).toEqual({ ok: true, override: true });
  });

  it('perda exige motivo (também em etapa criada pelo ADMIN)', () => {
    expect(move(QUALIFIED, DISCARDED)).toMatchObject({ ok: false, error: 'LOSS_REASON_REQUIRED' });
    expect(move(QUALIFIED, DISCARDED, false, true)).toEqual({ ok: true, override: false });
    expect(move(QUALIFIED, CUSTOM_LOST)).toMatchObject({ error: 'LOSS_REASON_REQUIRED' });
  });

  it('conversão e reabertura de ganho/perda: só gestor/ADMIN', () => {
    expect(move(QUALIFIED, CONVERTED)).toMatchObject({ ok: false, error: 'WON_REQUIRES_MANAGER' });
    expect(move(QUALIFIED, CONVERTED, true)).toEqual({ ok: true, override: true });
    expect(move(DISCARDED, QUALIFIED)).toMatchObject({ error: 'REOPEN_REQUIRES_MANAGER' });
    expect(move(DISCARDED, QUALIFIED, true)).toEqual({ ok: true, override: true });
  });

  it('reativar quem está em "Sem resposta" vale para todos', () => {
    expect(move(NO_RESPONSE, AWAITING)).toEqual({ ok: true, override: false });
  });

  it('mesma etapa e etapa desativada são recusadas', () => {
    expect(move(NEW, NEW)).toMatchObject({ error: 'SAME_STAGE' });
    expect(move(NEW, stage('X', 'OPEN', { active: false }))).toMatchObject({
      error: 'INACTIVE_STAGE',
    });
  });

  it('duração em segundos, nunca negativa', () => {
    const at = new Date('2026-10-01T12:00:00Z');
    expect(stageDurationSeconds(at, new Date('2026-10-03T12:00:30Z'))).toBe(2 * 86_400 + 30);
    expect(stageDurationSeconds(at, new Date('2026-10-01T11:00:00Z'))).toBe(0);
  });
});
