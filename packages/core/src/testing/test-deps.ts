import { getTestDb } from '@docline/db/testing';
import type { Role, UserStatus } from '../modules/identity/domain/roles';
import type { TransactionalEmail } from '../ports/email';
import type { Actor } from '../shared/actor';
import { fixedClock, type Clock } from '../shared/clock';
import { createIdentifierHasher } from '../shared/identifier-hash';
import type { Logger } from '../shared/logger';
import type { CoreDeps } from '../shared/use-case';

/**
 * Dependências para testes de integração do core (somente testes): banco de
 * testes, relógio fixo, e-mail em memória e pepper de teste.
 */
export function createTestDeps(options: { now?: Date } = {}) {
  const db = getTestDb();
  const clock: Clock = fixedClock(options.now ?? new Date('2026-10-13T12:00:00Z'));
  const sent: TransactionalEmail[] = [];
  const noop = () => undefined;
  const logger: Logger = { debug: noop, info: noop, warn: noop, error: noop };
  const deps: CoreDeps = {
    db,
    clock,
    logger,
    appUrl: 'https://sdr.example.com',
    email: {
      name: 'memory',
      async send(email) {
        sent.push(email);
      },
    },
    passwordHasher: { hash: async (password) => `hashed:${password}` },
    identifiers: createIdentifierHasher('pepper-de-teste-com-pelo-menos-32-caracteres'),
  };

  let counter = 0;
  /** Cria um usuário ativo com dados fictícios e devolve o ator correspondente. */
  async function createActor(role: Role, status: UserStatus = 'ACTIVE') {
    counter += 1;
    const user = await db.user.create({
      data: {
        name: `Usuário ${role} ${counter}`,
        email: `${role.toLowerCase()}${counter}@example.com`,
        role,
        status,
      },
    });
    const actor: Actor = { kind: 'user', id: user.id, role, status, teamId: null };
    return { user, actor };
  }

  return { db, deps, sent, createActor };
}
