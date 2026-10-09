import { describe, expect, it } from 'vitest';
import type { Actor } from '../../../shared/actor';
import { ValidationError } from '../../../shared/errors';
import { compileLeadSelection, compileSearch } from './filters';

const actor: Actor = {
  kind: 'user',
  id: '0199c0de-0000-7000-8000-000000000001',
  role: 'SDR',
  status: 'ACTIVE',
  teamId: null,
};

function issues(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof ValidationError) return error.issues.map((i) => `${i.path} ${i.message}`);
    throw error;
  }
  return [];
}

describe('compilador de filtros', () => {
  it('sem filtro de status, mostra só os ativos', () => {
    expect(compileLeadSelection(actor, {})).toEqual({ AND: [{ status: 'ACTIVE' }] });
    expect(
      compileLeadSelection(actor, { filter: { field: 'status', op: 'eq', value: 'ARCHIVED' } }),
    ).toEqual({ AND: [{ status: 'ARCHIVED' }] });
  });

  it('compila grupos aninhados e "eu" como responsável', () => {
    const where = compileLeadSelection(actor, {
      filter: {
        all: [
          { field: 'state', op: 'eq', value: 'CE' },
          { field: 'city', op: 'in', value: [2312908] },
          { field: 'hasWhatsapp', op: 'eq', value: true },
          {
            any: [
              { field: 'owner', op: 'eq', value: 'me' },
              { field: 'owner', op: 'isNull', value: true },
            ],
          },
          { field: 'tags', op: 'hasNone', value: ['0199c0de-0000-7000-8000-0000000000aa'] },
          { field: 'createdAt', op: 'between', value: ['2026-10-01', '2026-10-31'] },
        ],
      },
    });
    expect(where).toEqual({
      AND: [
        {
          AND: [
            { stateUf: 'CE' },
            { municipalityCode: { in: [2312908] } },
            { hasWhatsapp: true },
            { OR: [{ ownerId: actor.kind === 'user' ? actor.id : '' }, { ownerId: null }] },
            { tags: { none: { tagId: { in: ['0199c0de-0000-7000-8000-0000000000aa'] } } } },
            { createdAt: { gte: new Date('2026-10-01'), lte: new Date('2026-10-31') } },
          ],
        },
        { status: 'ACTIVE' },
      ],
    });
  });

  it('recusa campo/operador incompatível, valores inválidos e filtros profundos demais, apontando o caminho', () => {
    expect(
      issues(() =>
        compileLeadSelection(actor, {
          filter: {
            all: [
              { field: 'hasPhone', op: 'in', value: [true] },
              { field: 'state', op: 'eq', value: "CE' OR 1=1" },
              { field: 'contactStatus', op: 'eq', value: 'QUALQUER' },
            ],
          },
        }),
      ),
    ).toEqual([
      'filter.all.0 hasPhone: Operador "in" não vale para o campo "hasPhone".',
      'filter.all.1 state: Valor inválido.',
      'filter.all.2 contactStatus: Valor inválido (aceitos: CONTACTABLE, RESTRICTED, NO_LEGAL_BASIS, OPTED_OUT, BLOCKED).',
    ]);
    const deep = {
      all: [{ all: [{ all: [{ all: [{ field: 'hasPhone', op: 'eq', value: true }] }] }] }],
    };
    expect(issues(() => compileLeadSelection(actor, { filter: deep as never }))[0]).toContain(
      'níveis',
    );
  });
});

describe('busca livre', () => {
  it('reconhece nome, código, telefone, CNPJ, e-mail e Instagram', () => {
    expect(compileSearch('Contábil São')).toEqual({
      OR: [{ nameSearch: { contains: 'contabil sao' } }],
    });
    expect(compileSearch('L-000123')).toEqual({
      OR: [{ nameSearch: { contains: 'l 000123' } }, { code: 123 }],
    });
    const phone = compileSearch('(88) 99999-1111') as { OR: object[] };
    expect(phone.OR).toContainEqual({
      contactPoints: {
        some: { type: 'PHONE', valueNormalized: '+5588999991111', status: { not: 'REMOVED' } },
      },
    });
    expect(phone.OR).toContainEqual({ cnpj: { startsWith: '88999991111' } });
    expect((compileSearch('X@Exemplo.com') as { OR: object[] }).OR).toContainEqual({
      contactPoints: {
        some: { type: 'EMAIL', valueNormalized: 'x@exemplo.com', status: { not: 'REMOVED' } },
      },
    });
    expect((compileSearch('@contabil.x') as { OR: object[] }).OR).toContainEqual({
      contactPoints: {
        some: { type: 'INSTAGRAM', valueNormalized: 'contabil.x', status: { not: 'REMOVED' } },
      },
    });
  });
});
