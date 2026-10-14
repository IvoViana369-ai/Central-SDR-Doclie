import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../../shared/actor';
import { ConflictError, ForbiddenError, ValidationError } from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import {
  archiveLead,
  bulkLeads,
  countLeads,
  createLead,
  createTag,
  deleteView,
  listSavedViews,
  registerOptOut,
  saveView,
  searchLeads,
  updateView,
  type CreateLeadInput,
} from '.';

const { db, deps, createActor } = createTestDeps();
const SOBRAL = 2312908;
const FORTALEZA = 2304400;
const SAO_PAULO = 3550308;

async function expectError<T extends Error>(
  promise: Promise<unknown>,
  type: new (...a: never[]) => T,
) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(type);
  return error as T;
}

describe('lista, contagem, ações em massa e visões', () => {
  let manager: Actor;
  let sdr: Actor;
  let otherSdr: Actor;
  let ids: Record<string, string>;
  let sourceId: string;

  const make = (name: string, overrides: Partial<CreateLeadInput> = {}): CreateLeadInput => ({
    tradeName: name,
    municipalityCode: SOBRAL,
    origin: { sourceId, collectedAt: '2026-10-01' },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [],
    acknowledgeDuplicates: true,
    ...overrides,
  });

  beforeEach(async () => {
    await resetTestData(db);
    sourceId = (await db.leadSource.findUniqueOrThrow({ where: { key: 'GOOGLE' } })).id;
    manager = (await createActor('MANAGER')).actor;
    sdr = (await createActor('SDR')).actor;
    otherSdr = (await createActor('SDR')).actor;
    const sdrId = sdr.kind === 'user' ? sdr.id : '';
    ids = {};
    ids.alpha = (
      await createLead(
        deps,
        manager,
        make('Alpha Contábil', {
          ownerId: sdrId,
          contactPoints: [{ type: 'PHONE', value: '(88) 99999-0001', isWhatsapp: true }],
        }),
      )
    ).id;
    ids.beta = (
      await createLead(
        deps,
        manager,
        make('Beta Assessoria', {
          municipalityCode: FORTALEZA,
          ownerId: sdrId,
          contactPoints: [{ type: 'EMAIL', value: 'beta@ficticio.com.br' }],
        }),
      )
    ).id;
    ids.gamma = (
      await createLead(
        deps,
        manager,
        make('Gamma Contadores', {
          municipalityCode: SAO_PAULO,
          contactPoints: [{ type: 'PHONE', value: '(11) 98888-0003' }],
        }),
      )
    ).id;
    ids.delta = (
      await createLead(
        deps,
        manager,
        make('Delta Escritório', {
          ownerId: sdrId,
          contactPoints: [{ type: 'PHONE', value: '(88) 98888-0004' }],
        }),
      )
    ).id;
    ids.epsilon = (await createLead(deps, manager, make('Epsilon Arquivado'))).id;
    await archiveLead(deps, manager, { leadId: ids.epsilon });
    await registerOptOut(deps, manager, { leadId: ids.delta });
  });

  afterAll(() => closeTestDb());

  const names = (result: { data: { displayName: string }[] }) =>
    result.data.map((l) => l.displayName);

  it('lista no escopo: gestor vê todos os ativos; SDR só os seus', async () => {
    const all = await searchLeads(deps, manager, { sort: 'name' });
    expect(names(all)).toEqual([
      'Alpha Contábil',
      'Beta Assessoria',
      'Delta Escritório',
      'Gamma Contadores',
    ]);
    const mine = await searchLeads(deps, sdr, { sort: 'name' });
    expect(names(mine)).toEqual(['Alpha Contábil', 'Beta Assessoria', 'Delta Escritório']);
    expect(names(await searchLeads(deps, otherSdr, {}))).toEqual([]);
    expect(mine.data[0]).toMatchObject({
      codeLabel: 'L-000001',
      primaryPhone: '(88) 99999-0001',
      cityRaw: 'Sobral',
    });
  });

  it('filtros combinados, busca livre em qualquer formato e arquivados só quando pedidos', async () => {
    const ce = await searchLeads(deps, manager, {
      sort: 'name',
      filter: {
        all: [
          { field: 'state', op: 'eq', value: 'CE' },
          { field: 'hasPhone', op: 'eq', value: true },
        ],
      },
    });
    expect(names(ce)).toEqual(['Alpha Contábil', 'Delta Escritório']);
    expect(names(await searchLeads(deps, manager, { q: '+55 88 9 9999-0001' }))).toEqual([
      'Alpha Contábil',
    ]);
    expect(names(await searchLeads(deps, manager, { q: 'BETA@ficticio.com.br' }))).toEqual([
      'Beta Assessoria',
    ]);
    expect(names(await searchLeads(deps, manager, { q: 'gamma' }))).toEqual(['Gamma Contadores']);
    expect(names(await searchLeads(deps, manager, { q: 'L-000002' }))).toEqual(['Beta Assessoria']);
    const archived = await searchLeads(deps, manager, {
      filter: { field: 'status', op: 'eq', value: 'ARCHIVED' },
    });
    expect(names(archived)).toEqual(['Epsilon Arquivado']);
    await expectError(
      searchLeads(deps, manager, { filter: { field: 'state', op: 'eq', value: 'Ceará' } }),
      ValidationError,
    );
  });

  it('paginação por cursor percorre tudo sem repetir', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await searchLeads(deps, manager, { limit: 3, sort: 'newest', cursor });
      seen.push(...page.data.map((l) => l.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);
  });

  it('aceite M03: contagem com quebra contactáveis × bloqueados', async () => {
    expect(await countLeads(deps, manager, {})).toEqual({
      total: 4,
      contactable: 3,
      blocked: 1,
      byStatus: { CONTACTABLE: 3, OPTED_OUT: 1 },
    });
    expect((await countLeads(deps, sdr, {})).total).toBe(3);
  });

  describe('ações em massa', () => {
    it('só ADMIN/GESTOR; exige simulação e confirmação com o mesmo resultado', async () => {
      const otherId = otherSdr.kind === 'user' ? otherSdr.id : null;
      const input = {
        action: 'assign' as const,
        target: {
          mode: 'filter' as const,
          filter: { field: 'state' as const, op: 'eq' as const, value: 'CE' },
        },
        params: { ownerId: otherId, reason: 'Redistribuição de carteira' },
      };
      await expectError(bulkLeads(deps, sdr, input), ForbiddenError);

      const preview = await bulkLeads(deps, manager, input);
      expect(preview).toMatchObject({
        dryRun: true,
        total: 3,
        contactable: 2,
        blocked: 1,
        willChange: 3,
      });
      expect(await db.leadAssignment.count({ where: { toUserId: otherId } })).toBe(0);

      await expectError(bulkLeads(deps, manager, { ...input, dryRun: false }), ConflictError);
      const done = await bulkLeads(deps, manager, {
        ...input,
        dryRun: false,
        confirmationToken: preview.dryRun ? preview.confirmationToken : '',
      });
      expect(done).toMatchObject({ dryRun: false, changed: 3 });
      const reassigned = await searchLeads(deps, otherSdr, { sort: 'name' });
      expect(names(reassigned)).toEqual(['Alpha Contábil', 'Beta Assessoria', 'Delta Escritório']);
      // O cadastro registra só "lead.created"; os eventos de atribuição vêm da ação em massa.
      expect(await db.leadEvent.count({ where: { type: 'owner.assigned' } })).toBe(3);
      const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'lead.bulk' } });
      expect(audit.metadata).toMatchObject({ bulkAction: 'assign', selected: 3, changed: 3 });
    });

    it('se a seleção muda entre a simulação e a confirmação, a execução é recusada', async () => {
      const tag = await createTag(deps, manager, { name: 'Prioridade' });
      const input = {
        action: 'addTag' as const,
        target: {
          mode: 'filter' as const,
          filter: { field: 'state' as const, op: 'eq' as const, value: 'CE' },
        },
        params: { tagId: tag.id },
      };
      const preview = await bulkLeads(deps, manager, input);
      await createLead(deps, manager, make('Novo Lead CE'));
      const token = preview.dryRun ? preview.confirmationToken : '';
      await expectError(
        bulkLeads(deps, manager, { ...input, dryRun: false, confirmationToken: token }),
        ConflictError,
      );
    });

    it('tags em massa por ids: só o que muda é alterado; ids fora do escopo são ignorados', async () => {
      const tag = await createTag(deps, manager, { name: 'Evento 2026' });
      const target = { ids: [ids.alpha!, ids.gamma!, '0199c0de-0000-7000-8000-00000000ffff'] };
      const run = async (action: 'addTag' | 'removeTag') => {
        const preview = await bulkLeads(deps, manager, {
          action,
          target,
          params: { tagId: tag.id },
        });
        return bulkLeads(deps, manager, {
          action,
          target,
          params: { tagId: tag.id },
          dryRun: false,
          confirmationToken: preview.dryRun ? preview.confirmationToken : '',
        });
      };
      expect(await run('addTag')).toMatchObject({ total: 2, changed: 2, notFound: 1 });
      expect(await run('addTag')).toMatchObject({ changed: 0 });
      const tagged = await searchLeads(deps, manager, {
        sort: 'name',
        filter: { field: 'tags', op: 'hasAny', value: [tag.id] },
      });
      expect(names(tagged)).toEqual(['Alpha Contábil', 'Gamma Contadores']);
      expect(await run('removeTag')).toMatchObject({ changed: 2 });
      expect(await db.leadTag.count()).toBe(0);
    });
  });

  describe('visões salvas', () => {
    it('pessoais e compartilhadas; só o dono altera; filtro validado ao salvar', async () => {
      const mine = await saveView(deps, sdr, {
        name: 'Meus do CE',
        filter: { field: 'state', op: 'eq', value: 'CE' },
      });
      await saveView(deps, otherSdr, { name: 'Particular', filter: undefined });
      const shared = await saveView(deps, manager, {
        name: 'Com WhatsApp',
        filter: { field: 'hasWhatsapp', op: 'eq', value: true },
        shared: true,
      });
      const views = await listSavedViews(deps, sdr, {});
      expect(views.map((v) => [v.name, v.mine])).toEqual([
        ['Meus do CE', true],
        ['Com WhatsApp', false],
      ]);
      await expectError(
        updateView(deps, sdr, { viewId: shared.id, name: 'Meu agora' }),
        ForbiddenError,
      );
      await expectError(
        saveView(deps, sdr, {
          name: 'Quebrada',
          filter: { field: 'city', op: 'eq', value: 'Sobral' },
        }),
        ValidationError,
      );
      await expectError(saveView(deps, sdr, { name: 'Meus do CE' }), ConflictError);
      await updateView(deps, sdr, { viewId: mine.id, shared: true });
      await deleteView(deps, sdr, { viewId: mine.id });
      expect((await listSavedViews(deps, sdr, {})).map((v) => v.name)).toEqual(['Com WhatsApp']);
    });
  });
});
