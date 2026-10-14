import type { ApiScope } from '../modules/identity/domain/api-scopes';
import type { Role, UserStatus } from '../modules/identity/domain/roles';

/** Quem executa uma ação. Toda chamada de caso de uso informa o ator. */
export type Actor =
  | { kind: 'user'; id: string; role: Role; status: UserStatus; teamId: string | null }
  /** Processos internos (worker, CLI de administração, seeds). */
  | { kind: 'system'; name: string }
  /** Requisições sem sessão (ex.: aceitar convite). */
  | { kind: 'anonymous' }
  /**
   * Outro sistema Docline (CRM, n8n, BI) com chave de API (Fase 12). Só passa
   * nas permissões que os escopos liberam (docs/SECURITY.md §4.4).
   */
  | {
      kind: 'apiKey';
      id: string;
      name: string;
      scopes: readonly ApiScope[];
      system: string | null;
    };

export const anonymousActor: Actor = { kind: 'anonymous' };

export function systemActor(name: string): Actor {
  return { kind: 'system', name };
}

/** Tipo de autor gravado na auditoria e na timeline. */
export function actorTypeOf(actor: Actor): 'USER' | 'SYSTEM' | 'INTEGRATION' {
  if (actor.kind === 'user') return 'USER';
  if (actor.kind === 'apiKey') return 'INTEGRATION';
  return 'SYSTEM';
}
