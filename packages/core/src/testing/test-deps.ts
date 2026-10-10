import { getTestDb } from '@docline/db/testing';
import { FakeAiProvider } from '../modules/ai-sdr/infra/fake-provider';
import { FakeInstagramProvider } from '../modules/instagram/infra/fake-provider';
import { FakeCompanyRegistrySource } from '../modules/prospecting/infra/fake-source';
import { FakeWhatsappProvider } from '../modules/whatsapp/infra/fake-provider';
import type { Role, UserStatus } from '../modules/identity/domain/roles';
import type { TransactionalEmail } from '../ports/email';
import type { EnqueueOptions } from '../ports/job-queue';
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
  /** Jobs enfileirados (os testes executam os handlers diretamente). */
  const enqueued: { name: string; data: object; options?: EnqueueOptions }[] = [];
  /** IA falsa (determinística): os testes leem os pedidos recebidos. */
  const ai = new FakeAiProvider();
  /** WhatsApp simulado: os testes leem o que foi "enviado". */
  const whatsapp = new FakeWhatsappProvider();
  /** Instagram simulado, no relógio dos testes (Business Discovery determinístico). */
  const instagram = new FakeInstagramProvider(() => clock.now());
  /** Base aberta do CNPJ simulada (escritórios fictícios, CNPJs com raiz "FK"). */
  const companyRegistry = new FakeCompanyRegistrySource();
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
    jobs: {
      async enqueue(name, data, options) {
        enqueued.push({ name, data, options });
        return `job-${enqueued.length}`;
      },
    },
    importLimits: { maxBytes: 10 * 1024 * 1024, maxRows: 50_000 },
    ai,
    aiLimits: {
      effortGeneration: 'medium',
      effortClassification: 'low',
      maxGenerationsPerUserPerDay: 200,
      monthlyBudgetUsd: null,
    },
    whatsapp,
    instagram,
    companyRegistry,
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

  return { db, deps, sent, enqueued, ai, whatsapp, instagram, companyRegistry, createActor };
}
