import type { Role, UserStatus } from '../modules/identity/domain/roles';

/** Quem executa uma ação. Toda chamada de caso de uso informa o ator. */
export type Actor =
  | { kind: 'user'; id: string; role: Role; status: UserStatus; teamId: string | null }
  /** Processos internos (worker, CLI de administração, seeds). */
  | { kind: 'system'; name: string }
  /** Requisições sem sessão (ex.: aceitar convite). */
  | { kind: 'anonymous' };

export const anonymousActor: Actor = { kind: 'anonymous' };

export function systemActor(name: string): Actor {
  return { kind: 'system', name };
}
