'use client';

import { formatPhone } from '@docline/core/normalization';
import { formatCnae, REGISTRY_FIELD_LABELS } from '@docline/core/prospecting-domain';
import { DatabaseZap } from 'lucide-react';
import { useAction } from '@/components/leads/use-action';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api-client';
import type { LeadRegistryView } from './types';

const list = (items: string[]) =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;

/**
 * Enriquecimento pelo CNPJ (F9-04): o que a base aberta da Receita tem do
 * CNPJ do lead e o botão para completar só o que está vazio.
 */
export function RegistryCard({
  leadId,
  data,
  canEdit,
}: {
  leadId: string;
  data: LeadRegistryView;
  canEdit: boolean;
}) {
  const { run, notice, busy } = useAction();
  const company = data.company;
  const fillable = [
    ...data.fields.map((f) => REGISTRY_FIELD_LABELS[f] ?? f),
    ...(data.newContacts > 0
      ? [`${data.newContacts} ${data.newContacts === 1 ? 'contato novo' : 'contatos novos'}`]
      : []),
  ];

  return (
    <Card data-testid="registry-card">
      <CardHeader>
        <CardTitle>Dados abertos do CNPJ</CardTitle>
        <CardDescription>
          {company
            ? `Ativo na base da Receita Federal (mês ${company.datasetReference}).`
            : 'Base aberta da Receita Federal (escritórios de contabilidade ativos).'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}
        {data.status === 'no_cnpj' ? (
          <p className="text-muted-foreground">
            Informe o CNPJ do lead para completar com os dados abertos.
          </p>
        ) : null}
        {data.status === 'not_found' ? (
          <p className="text-muted-foreground">
            O CNPJ não está na base carregada: ela guarda só escritórios de contabilidade ativos.
          </p>
        ) : null}
        {company ? (
          <>
            <dl className="space-y-1">
              <div>
                <dt className="inline text-muted-foreground">Razão social: </dt>
                <dd className="inline">{company.companyName ?? '—'}</dd>
              </div>
              <div>
                <dt className="inline text-muted-foreground">Atividade: </dt>
                <dd className="inline">
                  {formatCnae(company.cnaeMain)}
                  {company.openedAt
                    ? ` · desde ${new Date(company.openedAt).getUTCFullYear()}`
                    : ''}
                  {company.companySize ? ` · ${company.companySize}` : ''}
                </dd>
              </div>
              <div>
                <dt className="inline text-muted-foreground">Endereço: </dt>
                <dd className="inline">
                  {[company.addressLine, company.addressNumber].filter(Boolean).join(', ') || '—'}
                  {company.city ? ` · ${company.city}/${company.uf}` : ''}
                </dd>
              </div>
              {company.phones.length || company.email ? (
                <div>
                  <dt className="inline text-muted-foreground">Contatos: </dt>
                  <dd className="inline">
                    {[...company.phones.map(formatPhone), company.email]
                      .filter(Boolean)
                      .join(' · ')}
                  </dd>
                </div>
              ) : null}
            </dl>
            {fillable.length ? (
              <p>
                Dá para completar: <strong>{list(fillable)}</strong>.
              </p>
            ) : (
              <p className="text-muted-foreground">Nada a completar: o lead já tem esses dados.</p>
            )}
            {data.skippedSuppressed > 0 ? (
              <p className="text-xs text-muted-foreground">
                {data.skippedSuppressed}{' '}
                {data.skippedSuppressed === 1
                  ? 'contato está na Lista Não Contatar e não entra.'
                  : 'contatos estão na Lista Não Contatar e não entram.'}
              </p>
            ) : null}
            {canEdit && fillable.length ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      api<{ fields: string[] }>(`/leads/${leadId}/registry`, { method: 'POST' }),
                    (r) =>
                      r.fields.length
                        ? 'Lead completado com os dados abertos do CNPJ.'
                        : 'Nada a completar.',
                  )
                }
              >
                <DatabaseZap /> Completar com dados abertos
              </Button>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Só campos vazios são preenchidos; telefones entram sem presumir WhatsApp.
            </p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
