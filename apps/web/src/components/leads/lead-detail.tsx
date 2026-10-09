'use client';

import type { GateResult } from '@docline/core/compliance-domain';
import { GATE_CHANNEL_LABELS, LEGAL_BASIS_LABELS } from '@docline/core/compliance-domain';
import { LEAD_TYPE_LABELS } from '@docline/core/leads-domain';
import { Check, Pencil, Pin, PinOff, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { LeadScoreCard, type LeadScoreView } from '@/components/pipeline/lead-score-card';
import { LeadStageCard, type StageHistoryItem } from '@/components/pipeline/lead-stage-card';
import type { LossReasonView, StageView } from '@/components/pipeline/pipeline-ui';
import { api } from '@/lib/api-client';
import { formatDate, formatDateTime } from '@/lib/utils';
import { ActivityCard, type TimelinePage } from './activity-card';
import { ContactStatusBadge, LeadStatusBadge, TagChip } from './badges';
import { ContactPointsCard, type ContactPointView } from './contact-points-card';
import { AnonymizeDialog, AssignDialog, OptOutDialog, PermissionDialog } from './lead-dialogs';
import { useAction } from './use-action';

type LegalBasis = keyof typeof LEGAL_BASIS_LABELS;

export interface LeadDetailView {
  id: string;
  codeLabel: string;
  version: number;
  status: 'ACTIVE' | 'ARCHIVED' | 'MERGED' | 'ANONYMIZED';
  /** Para leads mesclados: o lead que reuniu os dados. */
  mergedInto: { id: string; codeLabel: string } | null;
  displayName: string;
  companyName: string | null;
  tradeName: string | null;
  leadType: keyof typeof LEAD_TYPE_LABELS;
  category: string | null;
  cnpjFormatted: string | null;
  addressLine: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  cityRaw: string | null;
  stateUf: string | null;
  postalCode: string | null;
  websiteUrl: string | null;
  description: string | null;
  originDetail: string | null;
  originUrl: string | null;
  collectedAt: string | Date;
  createdAt: string | Date;
  ownerId: string | null;
  contactStatus: Parameters<typeof ContactStatusBadge>[0]['status'];
  segment: { name: string } | null;
  originSource: { name: string };
  owner: { id: string; name: string } | null;
  createdBy: { name: string } | null;
  people: {
    id: string;
    fullName: string;
    roleTitle: string | null;
    isPrimary: boolean;
    isDecisionMaker: boolean;
  }[];
  contactPoints: ContactPointView[];
  tags: { id: string; name: string; color: string }[];
  notes: {
    id: string;
    body: string;
    pinned: boolean;
    createdAt: string | Date;
    author: { id: string; name: string } | null;
  }[];
  permissions: {
    channel: string;
    legalBasis: LegalBasis;
    optInStatus: string;
    evidence: string | null;
  }[];
  legalBasis: { legalBasis: LegalBasis } | null;
  organizationSuppressions: { id: string; scope: string; since: string | Date }[];
  stageId: string | null;
  lossReason: { name: string } | null;
}

/** Pipeline e score na ficha (Fase 4). */
export interface LeadSalesView {
  stages: StageView[];
  lossReasons: LossReasonView[];
  stageHistory: StageHistoryItem[];
  score: LeadScoreView | null;
  privileged: boolean;
}

export interface LeadDetailPermissions {
  userId: string;
  isAdmin: boolean;
  canEdit: boolean;
  canAssign: boolean;
  canClaim: boolean;
  canOptOut: boolean;
  canSetPermission: boolean;
  canAnonymize: boolean;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children || '—'}</dd>
    </div>
  );
}

/** Detalhe do lead (F2-05): contatos com tel:/wa.me liberados pelo gate, timeline, histórico e conformidade. */
export function LeadDetail({
  lead,
  gate,
  timeline,
  sales,
  permissions,
  options,
}: {
  lead: LeadDetailView;
  gate: GateResult[];
  timeline: TimelinePage;
  sales: LeadSalesView;
  permissions: LeadDetailPermissions;
  options: {
    tags: { id: string; name: string; color: string }[];
    owners?: { id: string; name: string }[];
  };
}) {
  const { run, notice, busy } = useAction();
  const [note, setNote] = useState('');
  const [person, setPerson] = useState({ fullName: '', roleTitle: '' });
  const [tagToAdd, setTagToAdd] = useState('');
  const editable = permissions.canEdit && (lead.status === 'ACTIVE' || lead.status === 'ARCHIVED');
  const availableTags = options.tags.filter((t) => !lead.tags.some((lt) => lt.id === t.id));
  const address = [
    [lead.addressLine, lead.addressNumber].filter(Boolean).join(', '),
    lead.addressComplement,
    lead.neighborhood,
    lead.cityRaw ? `${lead.cityRaw}/${lead.stateUf}` : null,
    lead.postalCode ? `CEP ${lead.postalCode.slice(0, 5)}-${lead.postalCode.slice(5)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            <Link href="/leads" className="hover:underline">
              Leads
            </Link>{' '}
            / {lead.codeLabel}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{lead.displayName}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <ContactStatusBadge status={lead.contactStatus} />
            <LeadStatusBadge status={lead.status} />
            <span className="text-muted-foreground">
              Responsável: {lead.owner?.name ?? 'sem responsável (pool)'}
            </span>
            {lead.tags.map((tag) => (
              <TagChip
                key={tag.id}
                tag={tag}
                onRemove={
                  editable
                    ? () =>
                        run(
                          () => api(`/leads/${lead.id}/tags/${tag.id}`, { method: 'DELETE' }),
                          'Tag removida.',
                        )
                    : undefined
                }
              />
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable ? (
            <Button variant="outline" asChild>
              <Link href={`/leads/${lead.id}/editar`}>
                <Pencil /> Editar
              </Link>
            </Button>
          ) : null}
          {permissions.canClaim ? (
            <Button
              disabled={busy}
              onClick={() =>
                run(() => api(`/leads/${lead.id}/claim`, { method: 'POST' }), 'O lead agora é seu.')
              }
            >
              Assumir lead
            </Button>
          ) : null}
          {permissions.canAssign && options.owners && editable ? (
            <AssignDialog
              leadId={lead.id}
              currentOwnerId={lead.ownerId}
              owners={options.owners}
              run={run}
            />
          ) : null}
          {permissions.canOptOut && lead.status !== 'ANONYMIZED' ? (
            <OptOutDialog leadId={lead.id} run={run} />
          ) : null}
          {editable ? (
            lead.status === 'ARCHIVED' ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(
                    () => api(`/leads/${lead.id}/unarchive`, { method: 'POST' }),
                    'Lead reativado.',
                  )
                }
              >
                Reativar
              </Button>
            ) : (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  const reason = window.prompt('Motivo do arquivamento (opcional):');
                  if (reason === null) return;
                  void run(
                    () =>
                      api(`/leads/${lead.id}/archive`, {
                        method: 'POST',
                        body: { reason: reason || null },
                      }),
                    'Lead arquivado. Ele não é excluído e pode ser reativado.',
                  );
                }}
              >
                Arquivar
              </Button>
            )
          ) : null}
          {permissions.canAnonymize && lead.status !== 'ANONYMIZED' && lead.status !== 'MERGED' ? (
            <AnonymizeDialog leadId={lead.id} codeLabel={lead.codeLabel} run={run} />
          ) : null}
        </div>
      </div>

      {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}
      {lead.status === 'MERGED' && lead.mergedInto ? (
        <Alert title="Lead mesclado">
          Contatos, pessoas, observações e histórico foram reunidos em{' '}
          <Link href={`/leads/${lead.mergedInto.id}`} className="font-medium underline">
            {lead.mergedInto.codeLabel}
          </Link>
          . Este registro fica só para consulta; nada foi excluído.
        </Alert>
      ) : null}
      {lead.organizationSuppressions.length > 0 ? (
        <Alert variant="error" title="Lead na Lista Não Contatar">
          Desde {formatDate(lead.organizationSuppressions[0]!.since)}
          {lead.organizationSuppressions.some((s) => s.scope !== 'ALL_CHANNELS')
            ? ' (em parte dos canais)'
            : ''}
          .
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <ContactPointsCard
            leadId={lead.id}
            contactPoints={lead.contactPoints}
            people={lead.people}
            gate={gate}
            canEdit={editable}
            canOptOut={permissions.canOptOut && lead.status !== 'ANONYMIZED'}
            run={run}
            busy={busy}
          />
          <ActivityCard leadId={lead.id} initial={timeline} />
        </div>

        <div className="space-y-4">
          <LeadStageCard
            lead={lead}
            stages={sales.stages}
            lossReasons={sales.lossReasons}
            history={sales.stageHistory}
            canMove={permissions.canEdit && lead.status === 'ACTIVE'}
            privileged={sales.privileged}
          />
          {sales.score ? <LeadScoreCard score={sales.score} /> : null}

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle>Canais e base legal</CardTitle>
              {permissions.canSetPermission && editable ? (
                <PermissionDialog leadId={lead.id} current={lead.permissions} run={run} />
              ) : null}
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm">
                Base legal:{' '}
                <strong>
                  {lead.legalBasis
                    ? LEGAL_BASIS_LABELS[lead.legalBasis.legalBasis]
                    : 'não registrada'}
                </strong>
              </p>
              <ul className="space-y-1.5" aria-label="Contato permitido por canal">
                {gate.map((g) => (
                  <li key={g.channel} className="text-sm">
                    <span className="flex items-center gap-1.5">
                      {g.allowed ? (
                        <Check className="size-4 text-success" aria-hidden />
                      ) : (
                        <X className="size-4 text-destructive" aria-hidden />
                      )}
                      {GATE_CHANNEL_LABELS[g.channel]}: {g.allowed ? 'permitido' : 'bloqueado'}
                    </span>
                    {!g.allowed ? (
                      <span className="block pl-5.5 text-xs text-muted-foreground">
                        {g.reasons.join(' ')}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Dados</CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                <Row label="Razão social">{lead.companyName}</Row>
                <Row label="CNPJ">{lead.cnpjFormatted}</Row>
                <Row label="Tipo">{LEAD_TYPE_LABELS[lead.leadType]}</Row>
                <Row label="Segmento">{lead.segment?.name}</Row>
                <Row label="Endereço">{address}</Row>
                <Row label="Site">
                  {lead.websiteUrl ? (
                    <a
                      href={lead.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      {lead.websiteUrl.replace(/^https?:\/\//, '')}
                    </a>
                  ) : null}
                </Row>
                <Row label="Origem">
                  {lead.originSource.name}
                  {lead.originDetail ? ` · ${lead.originDetail}` : ''}
                </Row>
                <Row label="Coletado em">{formatDate(lead.collectedAt)}</Row>
                <Row label="Cadastro">
                  {formatDateTime(lead.createdAt)}
                  {lead.createdBy ? ` · ${lead.createdBy.name}` : ''}
                </Row>
              </dl>
              {lead.description ? (
                <p className="mt-3 whitespace-pre-line text-sm">{lead.description}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pessoas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {lead.people.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma pessoa cadastrada.</p>
              ) : null}
              <ul className="space-y-2">
                {lead.people.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-2 text-sm">
                    <span>
                      <span className="font-medium">{p.fullName}</span>
                      {p.roleTitle ? (
                        <span className="text-muted-foreground"> · {p.roleTitle}</span>
                      ) : null}
                      {p.isPrimary ? (
                        <Badge variant="muted" className="ml-1">
                          principal
                        </Badge>
                      ) : null}
                      {p.isDecisionMaker ? (
                        <Badge variant="muted" className="ml-1">
                          decide
                        </Badge>
                      ) : null}
                    </span>
                    {editable ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Remover ${p.fullName}`}
                        onClick={() =>
                          window.confirm(`Remover ${p.fullName} do lead?`) &&
                          run(
                            () => api(`/leads/${lead.id}/people/${p.id}`, { method: 'DELETE' }),
                            'Pessoa removida.',
                          )
                        }
                      >
                        <X />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {editable ? (
                <form
                  className="grid gap-2 border-t pt-3"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const ok = await run(
                      () =>
                        api(`/leads/${lead.id}/people`, {
                          method: 'POST',
                          body: { fullName: person.fullName, roleTitle: person.roleTitle || null },
                        }),
                      'Pessoa adicionada.',
                    );
                    if (ok) setPerson({ fullName: '', roleTitle: '' });
                  }}
                >
                  <Input
                    aria-label="Nome da nova pessoa"
                    placeholder="Nome completo"
                    value={person.fullName}
                    onChange={(e) => setPerson((p) => ({ ...p, fullName: e.target.value }))}
                  />
                  <Input
                    aria-label="Cargo da nova pessoa"
                    placeholder="Cargo"
                    value={person.roleTitle}
                    onChange={(e) => setPerson((p) => ({ ...p, roleTitle: e.target.value }))}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    disabled={busy || person.fullName.trim().length < 2}
                  >
                    <Plus /> Adicionar pessoa
                  </Button>
                </form>
              ) : null}
            </CardContent>
          </Card>

          {editable && availableTags.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Tags</CardTitle>
              </CardHeader>
              <CardContent className="flex gap-2">
                <Select
                  aria-label="Tag para adicionar"
                  value={tagToAdd}
                  onChange={(e) => setTagToAdd(e.target.value)}
                >
                  <option value="">Escolha uma tag</option>
                  {availableTags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!tagToAdd || busy}
                  onClick={async () => {
                    const ok = await run(
                      () =>
                        api(`/leads/${lead.id}/tags`, {
                          method: 'POST',
                          body: { tagId: tagToAdd },
                        }),
                      'Tag adicionada.',
                    );
                    if (ok) setTagToAdd('');
                  }}
                >
                  Adicionar
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Observações</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {editable ? (
                <form
                  className="space-y-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const ok = await run(
                      () =>
                        api(`/leads/${lead.id}/notes`, { method: 'POST', body: { body: note } }),
                      'Observação adicionada.',
                    );
                    if (ok) setNote('');
                  }}
                >
                  <Textarea
                    aria-label="Nova observação"
                    placeholder="Sem dados sensíveis ou opiniões pessoais sobre pessoas."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <Button type="submit" size="sm" disabled={busy || !note.trim()}>
                    Adicionar observação
                  </Button>
                </form>
              ) : null}
              <ul className="space-y-3">
                {lead.notes.map((n) => (
                  <li key={n.id} className="rounded-md border p-2 text-sm">
                    <p className="whitespace-pre-line">{n.body}</p>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        {n.pinned ? 'Fixada · ' : ''}
                        {n.author?.name ?? 'Sistema'} · {formatDateTime(n.createdAt)}
                      </span>
                      {editable ? (
                        <span className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={n.pinned ? 'Desafixar' : 'Fixar'}
                            onClick={() =>
                              run(() =>
                                api(`/leads/${lead.id}/notes/${n.id}`, {
                                  method: 'PATCH',
                                  body: { pinned: !n.pinned },
                                }),
                              )
                            }
                          >
                            {n.pinned ? <PinOff /> : <Pin />}
                          </Button>
                          {permissions.isAdmin || n.author?.id === permissions.userId ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="Remover observação"
                              onClick={() =>
                                window.confirm('Remover esta observação?') &&
                                run(
                                  () =>
                                    api(`/leads/${lead.id}/notes/${n.id}`, { method: 'DELETE' }),
                                  'Observação removida.',
                                )
                              }
                            >
                              <X />
                            </Button>
                          ) : null}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
