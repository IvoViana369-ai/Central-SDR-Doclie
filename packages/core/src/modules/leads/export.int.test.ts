import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../../shared/actor';
import { BusinessRuleError, ForbiddenError, RateLimitError } from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import {
  createLead,
  EXPORTS_PER_DAY,
  exportLeads,
  getLead,
  registerOptOut,
  type CreateLeadInput,
} from '.';

const { db, deps, createActor } = createTestDeps();
const SOBRAL = 2312908;

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

/** Linhas do CSV sem o BOM, cada uma separada em células (sem aspas nos casos usados aqui). */
const parse = (content: string) =>
  content
    .replace(/^\uFEFF/, '')
    .trimEnd()
    .split('\r\n')
    .map((line) => line.split(';'));

describe('exportação de leads', () => {
  let manager: Actor;
  let sdr: Actor;
  let sourceId: string;
  let ids: Record<string, string>;

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
    ids = {};
    ids.alpha = (
      await createLead(
        deps,
        manager,
        make('Alpha Contábil', {
          contactPoints: [
            { type: 'PHONE', value: '(88) 99999-0001', isWhatsapp: true },
            { type: 'EMAIL', value: 'alpha@ficticio.com.br' },
          ],
        }),
      )
    ).id;
    ids.beta = (
      await createLead(
        deps,
        manager,
        make('Beta Assessoria', {
          contactPoints: [
            { type: 'PHONE', value: '(88) 99999-0002' },
            { type: 'PHONE', value: '(88) 3611-0002' },
          ],
        }),
      )
    ).id;
    ids.delta = (
      await createLead(
        deps,
        manager,
        make('Delta Escritório', {
          contactPoints: [{ type: 'PHONE', value: '(88) 98888-0004' }],
        }),
      )
    ).id;
    ids.formula = (await createLead(deps, manager, make('=1+1 Contábil'))).id;
    // Delta inteiro na lista; em Beta, só o celular.
    await registerOptOut(deps, manager, { leadId: ids.delta });
    const beta = await getLead(deps, manager, { leadId: ids.beta });
    const mobile = beta.contactPoints.find((cp) => cp.valueNormalized === '+5588999990002')!;
    await registerOptOut(deps, manager, { leadId: ids.beta, contactPointId: mobile.id });
  });

  afterAll(() => closeTestDb());

  it('sem contatos por padrão; fórmulas neutralizadas; auditada com quantidade e filtro', async () => {
    const result = await exportLeads(deps, manager, {});
    expect(result.fileName).toBe('leads-2026-10-13.csv');
    expect(result.count).toBe(4);
    const [header, ...rows] = parse(result.content);
    expect(header).toContain('Situação de contato');
    expect(header).not.toContain('Telefone');
    expect(rows.map((r) => r[1]).sort()).toEqual([
      "'=1+1 Contábil",
      'Alpha Contábil',
      'Beta Assessoria',
      'Delta Escritório',
    ]);
    expect(result.content).not.toContain('99999');

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'lead.export' } });
    expect(audit.metadata).toMatchObject({
      count: 4,
      includeContacts: false,
      filter: null,
      q: null,
    });
  });

  it('com contatos: nada da Lista Não Contatar sai no arquivo', async () => {
    const result = await exportLeads(deps, manager, { includeContacts: true });
    const [header, ...rows] = parse(result.content);
    const col = (name: string) => header!.indexOf(name);
    const row = (name: string) => rows.find((r) => r[1] === name)!;

    expect(row('Alpha Contábil')[col('Telefone')]).toBe('(88) 99999-0001');
    expect(row('Alpha Contábil')[col('WhatsApp')]).toBe('(88) 99999-0001');
    expect(row('Alpha Contábil')[col('E-mail')]).toBe('alpha@ficticio.com.br');
    // Beta: o celular suprimido fica de fora; o fixo sai.
    expect(row('Beta Assessoria')[col('Telefone')]).toBe('(88) 3611-0002');
    expect(row('Beta Assessoria')[col('WhatsApp')]).toBe('');
    // Delta inteiro na lista: nenhum contato.
    expect(row('Delta Escritório')[col('Telefone')]).toBe('');
    expect(row('Delta Escritório')[col('Situação de contato')]).toBe(
      'Pediu para não ser contatado',
    );
    expect(result.content).not.toContain('99999-0002');
    expect(result.content).not.toContain('98888-0004');
    expect(result.omittedContacts).toBe(2);
  });

  it('a busca vai mascarada para a auditoria', async () => {
    const result = await exportLeads(deps, manager, { q: '(88) 99999-0001' });
    expect(result.count).toBe(1);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'lead.export' } });
    expect(JSON.stringify(audit.metadata)).not.toContain('99999');
    expect(audit.metadata).toMatchObject({ q: '+55 88 9****-0001', count: 1 });
  });

  it('SDR não exporta; a tentativa é auditada', async () => {
    await expectError(exportLeads(deps, sdr, {}), ForbiddenError);
    expect(await db.auditLog.count({ where: { action: 'access.denied' } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'lead.export' } })).toBe(0);
  });

  it('seleção vazia é recusada e não conta no limite', async () => {
    await expectError(exportLeads(deps, manager, { q: 'Inexistente' }), BusinessRuleError);
    expect(await db.auditLog.count({ where: { action: 'lead.export' } })).toBe(0);
  });

  it(`limite de ${EXPORTS_PER_DAY} exportações por usuário em 24 horas`, async () => {
    for (let i = 0; i < EXPORTS_PER_DAY; i++) await exportLeads(deps, manager, {});
    const error = await expectError(exportLeads(deps, manager, {}), RateLimitError);
    expect(error.message).toMatch(/Limite de 5 exportações/);
    // O limite é por usuário.
    const other = (await createActor('ADMIN')).actor;
    expect((await exportLeads(deps, other, {})).count).toBe(4);
  });
});
