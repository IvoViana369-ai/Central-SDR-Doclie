import { Search, Star } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { formatDate } from '@/lib/utils';
import type { ProspectingPotentialView } from './types';

const numberFormat = new Intl.NumberFormat('pt-BR');
const pct = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);

/**
 * Potencial por cidade (F9-05): escritórios ativos na base aberta × já na base
 * × contatados, ordenado pelo que falta prospectar.
 */
export function PotentialTable({
  potential,
  states,
}: {
  potential: ProspectingPotentialView;
  states: { uf: string; name: string }[];
}) {
  const { cities, totals } = potential;
  // A população vem do seed do IBGE quando houver; sem nenhuma, a coluna some.
  const withPopulation = cities.some((c) => c.population !== null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Potencial por cidade</CardTitle>
        <CardDescription>
          {potential.datasetReference
            ? `Escritórios ativos de contabilidade na base aberta do CNPJ (mês ${potential.datasetReference}, carregada em ${formatDate(potential.loadedAt)}) comparados com a base de leads.`
            : 'A base aberta do CNPJ ainda não foi carregada: só os leads aparecem.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form method="get" className="flex items-end gap-2">
          <input type="hidden" name="aba" value="potencial" />
          <label className="space-y-1.5 text-sm font-medium" htmlFor="potentialUf">
            UF
            <Select id="potentialUf" name="uf" defaultValue={potential.uf} className="w-56">
              {states.map((s) => (
                <option key={s.uf} value={s.uf}>
                  {s.uf} — {s.name}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" variant="outline">
            Ver
          </Button>
        </form>
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div className="rounded-lg border p-3">
            <dt className="text-muted-foreground">Escritórios na base aberta</dt>
            <dd className="text-xl font-semibold">{numberFormat.format(totals.offices)}</dd>
          </div>
          <div className="rounded-lg border p-3">
            <dt className="text-muted-foreground">Já são leads</dt>
            <dd className="text-xl font-semibold">{numberFormat.format(totals.inBase)}</dd>
          </div>
          <div className="rounded-lg border p-3">
            <dt className="text-muted-foreground">Faltam prospectar</dt>
            <dd className="text-xl font-semibold">{numberFormat.format(totals.remaining)}</dd>
          </div>
          <div className="rounded-lg border p-3">
            <dt className="text-muted-foreground">Leads contatados / leads</dt>
            <dd className="text-xl font-semibold">
              {numberFormat.format(totals.contacted)} / {numberFormat.format(totals.leads)}
            </dd>
          </div>
        </dl>
        {potential.unmatched > 0 ? (
          <p className="text-xs text-muted-foreground">
            {numberFormat.format(potential.unmatched)}{' '}
            {potential.unmatched === 1 ? 'escritório está' : 'escritórios estão'} em cidade que a
            carga não casou com o IBGE (nome diferente): aparecem na busca pela UF, não nesta
            tabela.
          </p>
        ) : null}
        {cities.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada nesta UF ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Tr>
                  <Th>Cidade</Th>
                  {withPopulation ? <Th className="text-right">População</Th> : null}
                  <Th className="text-right">Escritórios</Th>
                  <Th className="text-right">Já são leads</Th>
                  <Th className="text-right">Faltam</Th>
                  <Th>Cobertura</Th>
                  <Th className="text-right">Leads</Th>
                  <Th className="text-right">Contatados</Th>
                  <Th />
                </Tr>
              </THead>
              <TBody>
                {cities.map((c) => (
                  <Tr key={c.municipalityCode} data-testid="potential-row">
                    <Td>
                      <span className="font-medium">{c.name}</span>
                      {c.priority ? (
                        <Badge variant="default" className="ml-2">
                          <Star className="size-3" aria-hidden /> Prioritária
                        </Badge>
                      ) : null}
                    </Td>
                    {withPopulation ? (
                      <Td className="text-right tabular-nums">
                        {c.population === null ? '—' : numberFormat.format(c.population)}
                      </Td>
                    ) : null}
                    <Td className="text-right tabular-nums" data-testid="potential-offices">
                      {c.offices}
                    </Td>
                    <Td className="text-right tabular-nums" data-testid="potential-in-base">
                      {c.inBase}
                    </Td>
                    <Td
                      className="text-right font-medium tabular-nums"
                      data-testid="potential-remaining"
                    >
                      {c.remaining}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2 w-24 overflow-hidden rounded-full bg-muted"
                          role="img"
                          aria-label={`Cobertura ${pct(c.coverage)}`}
                        >
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.round((c.coverage ?? 0) * 100)}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums">{pct(c.coverage)}</span>
                      </div>
                    </Td>
                    <Td className="text-right tabular-nums">{c.leads}</Td>
                    <Td className="text-right tabular-nums">{c.contacted}</Td>
                    <Td>
                      {c.remaining > 0 ? (
                        <Button asChild size="sm" variant="outline">
                          <Link
                            href={`/prospeccao?uf=${potential.uf}&cidade=${c.municipalityCode}&cidadeNome=${encodeURIComponent(c.name)}`}
                          >
                            <Search /> Buscar
                          </Link>
                        </Button>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
