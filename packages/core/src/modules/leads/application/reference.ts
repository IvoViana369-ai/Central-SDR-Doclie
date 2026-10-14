import { z } from 'zod';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../../shared/errors';
import { defineUseCase } from '../../../shared/use-case';
import { toSearchKey } from '../../normalization';
import { setUserTerritoriesInput, userRefInput } from '../contracts/schemas';

/** Origens ativas, com a base legal sugerida para o formulário de cadastro. */
export const listLeadSources = defineUseCase({
  name: 'leads.listSources',
  access: 'lead.read',
  input: z.object({}),
  async run(ctx) {
    return ctx.tx.leadSource.findMany({
      where: { active: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: { id: true, key: true, name: true, defaultLegalBasis: true },
    });
  },
});

export const listSegments = defineUseCase({
  name: 'leads.listSegments',
  access: 'lead.read',
  input: z.object({}),
  async run(ctx) {
    return ctx.tx.segment.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: { id: true, key: true, name: true },
    });
  },
});

const territorySelect = {
  id: true,
  stateUf: true,
  municipalityCode: true,
  priority: true,
  municipality: { select: { name: true } },
} as const;

/** Territórios do usuário: definem o pool não atribuído que o SDR enxerga. */
export const getUserTerritories = defineUseCase({
  name: 'leads.getUserTerritories',
  access: 'user.read',
  input: userRefInput,
  async run(ctx, { userId }) {
    return ctx.tx.userTerritory.findMany({
      where: { userId },
      orderBy: [{ stateUf: 'asc' }, { municipalityCode: 'asc' }],
      select: territorySelect,
    });
  },
});

/** Substitui os territórios do usuário (ADMIN). Cidade dentro de UF já coberta é redundante e é recusada. */
export const setUserTerritories = defineUseCase({
  name: 'leads.setUserTerritories',
  access: 'user.manage',
  input: setUserTerritoriesInput,
  async run(ctx, { userId, territories }) {
    const user = await ctx.tx.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) throw new NotFoundError('Usuário não encontrado.');
    if (user.role !== 'SDR' && territories.length > 0) {
      throw new BusinessRuleError('Territórios definem o pool de leads de SDRs.');
    }

    const states = new Set(territories.filter((t) => !t.municipalityCode).map((t) => t.stateUf));
    const issues: { path: string; message: string }[] = [];
    const seen = new Set<string>();
    for (const [index, t] of territories.entries()) {
      const key = `${t.stateUf}:${t.municipalityCode ?? ''}`;
      if (seen.has(key))
        issues.push({ path: `territories.${index}`, message: 'Território repetido.' });
      seen.add(key);
      if (t.municipalityCode) {
        if (states.has(t.stateUf)) {
          issues.push({
            path: `territories.${index}`,
            message: `A UF ${t.stateUf} inteira já está incluída.`,
          });
        }
        const municipality = await ctx.tx.municipality.findUnique({
          where: { ibgeCode: t.municipalityCode },
          select: { uf: true },
        });
        if (!municipality || municipality.uf !== t.stateUf) {
          issues.push({
            path: `territories.${index}`,
            message: 'Município não pertence à UF informada.',
          });
        }
      } else if (!(await ctx.tx.state.findUnique({ where: { uf: t.stateUf } }))) {
        issues.push({ path: `territories.${index}`, message: 'UF não encontrada.' });
      }
    }
    if (issues.length > 0) throw new ValidationError(issues);

    const before = await ctx.tx.userTerritory.findMany({
      where: { userId },
      select: { stateUf: true, municipalityCode: true },
    });
    await ctx.tx.userTerritory.deleteMany({ where: { userId } });
    if (territories.length > 0) {
      await ctx.tx.userTerritory.createMany({
        data: territories.map((t) => ({
          userId,
          stateUf: t.stateUf,
          municipalityCode: t.municipalityCode ?? null,
        })),
      });
    }
    const describe = (list: { stateUf: string; municipalityCode?: number | null }[]) =>
      list
        .map((t) => (t.municipalityCode ? `${t.stateUf}:${t.municipalityCode}` : t.stateUf))
        .sort();
    await ctx.audit({
      action: 'user.territories_changed',
      entityType: 'user',
      entityId: userId,
      changes: { territories: [describe(before), describe(territories)] },
    });
    return ctx.tx.userTerritory.findMany({
      where: { userId },
      orderBy: [{ stateUf: 'asc' }, { municipalityCode: 'asc' }],
      select: territorySelect,
    });
  },
});

/** UFs para filtros e formulários. */
export const listStates = defineUseCase({
  name: 'leads.listStates',
  access: 'lead.read',
  input: z.object({}),
  async run(ctx) {
    return ctx.tx.state.findMany({ orderBy: { uf: 'asc' }, select: { uf: true, name: true } });
  },
});

/** Autocompletar de município: começa com o texto primeiro, depois contém. */
export const searchMunicipalities = defineUseCase({
  name: 'leads.searchMunicipalities',
  access: 'lead.read',
  input: z.object({
    q: z.string().trim().min(2).max(60),
    uf: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(30).default(15),
  }),
  async run(ctx, input) {
    const key = toSearchKey(input.q);
    const select = { ibgeCode: true, name: true, uf: true, ddd: true } as const;
    const base = input.uf ? { uf: input.uf } : {};
    const starts = await ctx.tx.municipality.findMany({
      where: { ...base, nameSearch: { startsWith: key } },
      orderBy: [{ isCapital: 'desc' }, { name: 'asc' }],
      take: input.limit,
      select,
    });
    if (starts.length >= input.limit) return starts;
    const contains = await ctx.tx.municipality.findMany({
      where: {
        ...base,
        nameSearch: { contains: key },
        ibgeCode: { notIn: starts.map((m) => m.ibgeCode) },
      },
      orderBy: [{ isCapital: 'desc' }, { name: 'asc' }],
      take: input.limit - starts.length,
      select,
    });
    return [...starts, ...contains];
  },
});
