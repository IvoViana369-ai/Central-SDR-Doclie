import { listCampaigns, roleHasPermission } from '@docline/core';
import { GATE_CHANNEL_LABELS } from '@docline/core/compliance-domain';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AccessDenied } from '@/components/access-denied';
import { fmtInt } from '@/components/analytics/format';
import { CampaignStatusBadge } from '@/components/campaigns/status-badge';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { cn, formatDate } from '@/lib/utils';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'Campanhas' };

/** Campanhas (F10-01): lista com situação e números principais; `?arquivadas=1` mostra as arquivadas. */
export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, deps, meta } = await getPageContext();
  if (!roleHasPermission(user.actor.role, 'campaign.manage')) return <AccessDenied />;
  const archived = (await searchParams).arquivadas === '1';
  const { items } = await listCampaigns(
    deps,
    user.actor,
    archived ? { status: 'ARCHIVED' } : {},
    meta,
  );

  return (
    <>
      <PageHeader
        title="Campanhas"
        description="Selecione leads por filtro, veja quem é apto e por quê, distribua entre os SDRs com limite diário e acompanhe o funil e o teste A/B. A campanha não envia mensagens: cada contato é do SDR, pela cadência, e passa pelo gate."
        actions={
          <Button asChild>
            <Link href="/campanhas/nova">
              <Plus /> Nova campanha
            </Link>
          </Button>
        }
      />
      <nav className="mb-4 flex gap-2 border-b text-sm" aria-label="Filtro das campanhas">
        {[
          { key: false, label: 'Em uso', href: '/campanhas' },
          { key: true, label: 'Arquivadas', href: '/campanhas?arquivadas=1' },
        ].map((tab) => (
          <Link
            key={tab.label}
            href={tab.href}
            aria-current={archived === tab.key ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2',
              archived === tab.key
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <Card>
        {items.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {archived ? 'Nenhuma campanha arquivada.' : 'Nenhuma campanha ainda.'}
          </p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Campanha</Th>
                <Th>Situação</Th>
                <Th>Canal</Th>
                <Th className="text-right">Aptos</Th>
                <Th className="text-right">Liberados</Th>
                <Th className="text-right">Contatados</Th>
                <Th className="text-right">Responderam</Th>
              </Tr>
            </THead>
            <TBody>
              {items.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <Link href={`/campanhas/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {c.owner.name} · {c.sdrs} {c.sdrs === 1 ? 'SDR' : 'SDRs'} ·{' '}
                      {fmtInt(c.dailyContactLimit)}/dia
                      {c.variants > 1 ? ` · A/B com ${c.variants} abordagens` : ''}
                      {c.endsAt ? ` · até ${formatDate(c.endsAt)}` : ''}
                    </p>
                  </Td>
                  <Td>
                    <CampaignStatusBadge status={c.status} />
                  </Td>
                  <Td>{GATE_CHANNEL_LABELS[c.channel as keyof typeof GATE_CHANNEL_LABELS]}</Td>
                  <Td className="text-right tabular-nums">{fmtInt(c.eligible)}</Td>
                  <Td className="text-right tabular-nums">{fmtInt(c.released)}</Td>
                  <Td className="text-right tabular-nums">{fmtInt(c.contacted)}</Td>
                  <Td className="text-right tabular-nums">{fmtInt(c.replied)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
