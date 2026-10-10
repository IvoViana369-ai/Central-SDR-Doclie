import {
  getProspectingDataset,
  getProspectingPotential,
  getProspectingSearch,
  isDomainError,
  listLegalBasisAssessments,
  listProspectingSearches,
  listStates,
  listUsers,
  roleHasPermission,
} from '@docline/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AccessDenied } from '@/components/access-denied';
import { PageHeader } from '@/components/page-header';
import { PotentialTable } from '@/components/prospecting/potential-table';
import { SearchForm } from '@/components/prospecting/search-form';
import { SearchHistory } from '@/components/prospecting/search-history';
import { SearchResults } from '@/components/prospecting/search-results';
import type { SearchParamsView } from '@/components/prospecting/types';
import { Alert } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'Prospecção' };

/** UF de partida sem escolha nem busca anterior (a mesma do padrão do score). */
const FALLBACK_UF = 'CE';

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : null);

/**
 * Prospecção na base aberta do CNPJ (F9-02 e F9-05): busca com comparação e
 * aprovação humana (`?busca=<id>`) e o potencial por cidade (`?aba=potencial`).
 */
export default async function ProspectingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, deps, meta } = await getPageContext();
  const actor = user.actor;
  if (!roleHasPermission(actor.role, 'prospecting.run')) return <AccessDenied />;
  const params = await searchParams;
  const tab = params.aba === 'potencial' ? 'potential' : 'search';
  const [history, states, dataset] = await Promise.all([
    listProspectingSearches(deps, actor, { limit: 10 }, meta),
    listStates(deps, actor, {}, meta),
    getProspectingDataset(deps, actor, {}, meta),
  ]);
  const lastUf = (history[0]?.params as SearchParamsView | undefined)?.uf;
  const requestedUf = one(params.uf)?.toUpperCase();
  const uf = states.some((s) => s.uf === requestedUf) ? requestedUf! : (lastUf ?? FALLBACK_UF);

  const header = (
    <PageHeader
      title="Prospecção"
      description="Escritórios de contabilidade ativos na base aberta do CNPJ da Receita Federal, comparados com a base. Nada vira lead sem aprovação de uma pessoa."
    />
  );
  const tabs = (
    <nav className="mb-4 flex gap-2 border-b text-sm" aria-label="Seções da Prospecção">
      {[
        { key: 'search', label: 'Buscar', href: '/prospeccao' },
        {
          key: 'potential',
          label: 'Potencial por cidade',
          href: `/prospeccao?aba=potencial&uf=${uf}`,
        },
      ].map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={tab === t.key ? 'page' : undefined}
          className={cn(
            '-mb-px border-b-2 px-3 py-2',
            tab === t.key
              ? 'border-primary font-medium text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );

  if (tab === 'potential') {
    const potential = await getProspectingPotential(deps, actor, { uf }, meta);
    return (
      <>
        {header}
        {tabs}
        <PotentialTable potential={potential} states={states} />
      </>
    );
  }

  const searchId = one(params.busca);
  let detail = null;
  let notFound = false;
  if (searchId) {
    try {
      detail = await getProspectingSearch(deps, actor, { searchId }, meta);
    } catch (error) {
      if (!isDomainError(error)) throw error;
      notFound = true;
    }
  }
  const [owners, assessments] = detail
    ? await Promise.all([
        roleHasPermission(actor.role, 'lead.assign') && roleHasPermission(actor.role, 'user.read')
          ? listUsers(deps, actor, { status: 'ACTIVE' }, meta)
          : Promise.resolve(null),
        listLegalBasisAssessments(deps, actor, {}, meta),
      ])
    : [null, []];
  const cityCode = Number(one(params.cidade));
  const cityName = one(params.cidadeNome);
  const initialCity =
    Number.isInteger(cityCode) && cityCode > 0 && cityName
      ? { ibgeCode: cityCode, name: cityName, uf }
      : null;

  return (
    <>
      {header}
      {tabs}
      <div className="space-y-4">
        <SearchForm
          key={`${uf}-${initialCity?.ibgeCode ?? ''}`}
          states={states}
          initialUf={uf}
          initialCity={initialCity}
          datasetReference={dataset.reference}
        />
        {notFound ? <Alert variant="error">Busca não encontrada.</Alert> : null}
        {detail ? (
          <SearchResults
            key={detail.search.id}
            detail={detail}
            owners={owners ? owners.map((o) => ({ id: o.id, name: o.name })) : null}
            assessments={assessments.map((a) => ({ id: a.id, name: a.name, version: a.version }))}
          />
        ) : null}
        <SearchHistory searches={history} currentId={detail?.search.id ?? null} />
      </div>
    </>
  );
}
