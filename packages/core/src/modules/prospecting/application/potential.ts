import { Prisma } from '@docline/db';
import { defineUseCase } from '../../../shared/use-case';
import { prospectingPotentialInput } from '../contracts/schemas';
import { latestDataset } from './prospecting';

interface PotentialRow {
  code: number;
  name: string;
  population: number | null;
  priority: boolean;
  offices: number;
  in_base: number;
  leads: number;
  contacted: number;
}

/**
 * Potencial por cidade (F9-05): o universo de escritórios ativos na base
 * aberta × o que já está na base de leads e o que já foi trabalhado. Ordena
 * pelo que falta prospectar (escritórios da base aberta que ainda não são lead).
 *
 * - **Escritórios:** estabelecimentos ativos de contabilidade na cidade
 *   (matriz e filiais), da última carga.
 * - **Na base:** desses, os que já são lead (mesmo CNPJ).
 * - **Leads / contatados:** todos os leads da cidade (com ou sem CNPJ) e os que
 *   já tiveram o primeiro contato.
 */
export const getProspectingPotential = defineUseCase({
  name: 'prospecting.potential',
  access: 'prospecting.run',
  input: prospectingPotentialInput,
  async run(ctx, input) {
    const dataset = await latestDataset(ctx.tx);
    const rows = await ctx.tx.$queryRaw<PotentialRow[]>(Prisma.sql`
      WITH universe AS (
        SELECT rc.municipality_code AS code,
               count(*)::int AS offices,
               count(l.id)::int AS in_base
        FROM registry_companies rc
        LEFT JOIN leads l ON l.cnpj = rc.cnpj AND l.status IN ('ACTIVE', 'ARCHIVED')
        WHERE rc.uf = ${input.uf} AND rc.municipality_code IS NOT NULL
        GROUP BY rc.municipality_code
      ), worked AS (
        SELECT l.municipality_code AS code,
               count(*)::int AS leads,
               count(*) FILTER (WHERE l.first_contact_at IS NOT NULL)::int AS contacted
        FROM leads l
        WHERE l.state_uf = ${input.uf}
          AND l.municipality_code IS NOT NULL
          AND l.status IN ('ACTIVE', 'ARCHIVED')
        GROUP BY l.municipality_code
      )
      SELECT m.ibge_code AS code, m.name, m.population,
             coalesce(pc.active, false) AS priority,
             coalesce(u.offices, 0) AS offices,
             coalesce(u.in_base, 0) AS in_base,
             coalesce(w.leads, 0) AS leads,
             coalesce(w.contacted, 0) AS contacted
      FROM municipalities m
      LEFT JOIN universe u ON u.code = m.ibge_code
      LEFT JOIN worked w ON w.code = m.ibge_code
      LEFT JOIN priority_cities pc ON pc.municipality_code = m.ibge_code
      WHERE m.uf = ${input.uf} AND (u.code IS NOT NULL OR w.code IS NOT NULL)
      ORDER BY coalesce(u.offices, 0) - coalesce(u.in_base, 0) DESC, m.name`);
    // Escritórios em cidades que a carga não casou com o IBGE (nome diferente).
    const unmatched = await ctx.tx.registryCompany.count({
      where: { uf: input.uf, municipalityCode: null },
    });

    const cities = rows.map((r) => ({
      municipalityCode: r.code,
      name: r.name,
      population: r.population,
      priority: r.priority,
      offices: r.offices,
      inBase: r.in_base,
      /** Escritórios da base aberta que ainda não são lead. */
      remaining: Math.max(r.offices - r.in_base, 0),
      /** Parcela do universo que já está na base (nula sem universo). */
      coverage: r.offices > 0 ? r.in_base / r.offices : null,
      leads: r.leads,
      contacted: r.contacted,
    }));
    const totals = cities.reduce(
      (t, c) => ({
        offices: t.offices + c.offices,
        inBase: t.inBase + c.inBase,
        remaining: t.remaining + c.remaining,
        leads: t.leads + c.leads,
        contacted: t.contacted + c.contacted,
      }),
      { offices: 0, inBase: 0, remaining: 0, leads: 0, contacted: 0 },
    );
    return {
      uf: input.uf,
      datasetReference: dataset?.reference ?? null,
      loadedAt: dataset?.finishedAt ?? null,
      cities,
      totals,
      unmatched,
    };
  },
});
