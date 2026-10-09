import type { StageCategory } from '@docline/db';

/**
 * Regras de movimentação do pipeline (docs/SDR-FLOW.md §3.2). Funções puras:
 * o caso de uso carrega as etapas e o perfil e só aplica o resultado.
 */

/** Etapa como as regras enxergam (chave estável, categoria e configuração). */
export interface StageRef {
  id: string;
  key: string;
  name: string;
  category: StageCategory;
  requiresLossReason: boolean;
  active: boolean;
}

/**
 * Etapas em que o lead só entra por uma ação registrada, nunca arrastando
 * (regra 2: o primeiro contato passa pelo gate de contactabilidade).
 */
export const ACTION_ONLY_STAGES: Readonly<Record<string, string>> = {
  FIRST_CONTACT:
    'O lead entra em "Primeiro contato" quando o contato é registrado (passa pelo gate de contactabilidade), não arrastando.',
};

/**
 * Etapas movidas pelas automações (cadência, resposta, transferência). Só
 * GESTOR e ADMIN podem mover à mão, como correção (regra 6, auditada).
 */
export const AUTOMATION_STAGES: Readonly<Record<string, string>> = {
  FOLLOW_UP_1: 'a cadência',
  FOLLOW_UP_2: 'a cadência',
  FOLLOW_UP_3: 'a cadência',
  NO_RESPONSE: 'o fim da cadência',
  REPLIED: 'o registro da resposta',
  OPPORTUNITY: 'a transferência ao Comercial',
};

export type TransitionError =
  | 'SAME_STAGE'
  | 'INACTIVE_STAGE'
  | 'ACTION_ONLY'
  | 'AUTOMATION_ONLY'
  | 'WON_REQUIRES_MANAGER'
  | 'REOPEN_REQUIRES_MANAGER'
  | 'LOSS_REASON_REQUIRED';

export type TransitionCheck =
  | {
      ok: true;
      /** A transição só foi aceita por ser GESTOR/ADMIN (vai em destaque na auditoria). */
      override: boolean;
    }
  | { ok: false; error: TransitionError; message: string };

/**
 * Pode mover de `from` para `to`?
 *
 * 1. Entre etapas abertas, qualquer pessoa com acesso ao lead.
 * 2. "Primeiro contato" só registrando o contato.
 * 3. Etapas de perda exigem motivo.
 * 4. "Convertido" (ganho) exige oportunidade ganha; até ela existir (Fases
 *    5–6), só GESTOR/ADMIN marcam a conversão.
 * 5. Etapas de automação e reabrir um lead ganho ou perdido: só GESTOR/ADMIN.
 *    Sair de uma etapa parada ("Sem resposta") é a reativação e vale para todos.
 */
export function checkTransition(input: {
  from: StageRef | null;
  to: StageRef;
  privileged: boolean;
  lossReasonGiven: boolean;
}): TransitionCheck {
  const { from, to, privileged } = input;
  const fail = (error: TransitionError, message: string): TransitionCheck => ({
    ok: false,
    error,
    message,
  });
  if (from?.id === to.id) return fail('SAME_STAGE', 'O lead já está nesta etapa.');
  if (!to.active) return fail('INACTIVE_STAGE', `A etapa "${to.name}" está desativada.`);

  const actionOnly = ACTION_ONLY_STAGES[to.key];
  if (actionOnly) return fail('ACTION_ONLY', actionOnly);

  let override = false;
  const automation = AUTOMATION_STAGES[to.key];
  if (automation) {
    if (!privileged) {
      return fail(
        'AUTOMATION_ONLY',
        `"${to.name}" é preenchida por ${automation}. Só gestor ou administrador movem à mão.`,
      );
    }
    override = true;
  }
  if (to.category === 'WON') {
    if (!privileged) {
      return fail(
        'WON_REQUIRES_MANAGER',
        'A conversão é registrada pelo gestor ou administrador (ou pela oportunidade ganha).',
      );
    }
    override = true;
  }
  if (from && (from.category === 'WON' || from.category === 'LOST')) {
    if (!privileged) {
      return fail(
        'REOPEN_REQUIRES_MANAGER',
        `O lead está em "${from.name}". Só gestor ou administrador reabrem.`,
      );
    }
    override = true;
  }
  if (to.category === 'LOST' && to.requiresLossReason && !input.lossReasonGiven) {
    return fail('LOSS_REASON_REQUIRED', `Informe o motivo para mover para "${to.name}".`);
  }
  return { ok: true, override };
}

/** Segundos inteiros entre a entrada e a saída da etapa (nunca negativo). */
export function stageDurationSeconds(enteredAt: Date, leftAt: Date): number {
  return Math.max(0, Math.round((leftAt.getTime() - enteredAt.getTime()) / 1000));
}
