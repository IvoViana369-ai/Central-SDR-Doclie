'use client';

import { formatCnpj, formatPhone } from '@docline/core/normalization';
import {
  formatCnae,
  PROSPECTING_DECISION_LABELS,
  PROSPECTING_MATCH_LABELS,
} from '@docline/core/prospecting-domain';
import { Ban, Check, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useAction } from '@/components/leads/use-action';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api } from '@/lib/api-client';
import { formatDateTime, plural } from '@/lib/utils';
import type { ProspectingResultView, ProspectingSearchDetail } from './types';

const APPROVE_LIMIT = 100;

const MATCH_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'muted' | 'default'> = {
  NEW: 'success',
  EXISTING: 'default',
  POSSIBLE_DUPLICATE: 'warning',
  DUPLICATE_IN_FILE: 'warning',
  SUPPRESSED: 'destructive',
  INVALID: 'muted',
};

const DECISION_VARIANT = {
  PENDING: 'muted',
  APPROVED: 'success',
  REJECTED: 'destructive',
} as const;

interface ApproveSummary {
  created: number;
  completed: number;
  skipped: number;
  errors: { resultId: string; message: string }[];
}

/** Pode ser aprovado: pendente, ainda na base aberta e fora da Lista Não Contatar. */
const selectable = (r: ProspectingResultView) =>
  r.decision === 'PENDING' && r.company !== null && r.matchStatus !== 'SUPPRESSED';

function Office({ result }: { result: ProspectingResultView }) {
  const c = result.company;
  if (!c) {
    return (
      <div>
        <p className="font-mono text-xs">{formatCnpj(result.cnpj)}</p>
        <p className="text-xs text-muted-foreground">
          Saiu da base aberta (baixado ou mudou de atividade).
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-0.5">
      <p className="font-medium">{c.tradeName ?? c.companyName}</p>
      {c.tradeName && c.companyName ? (
        <p className="text-xs text-muted-foreground">{c.companyName}</p>
      ) : null}
      <p className="font-mono text-xs">{formatCnpj(c.cnpj)}</p>
      <div className="flex flex-wrap gap-1">
        <Badge variant="muted">{c.isHeadOffice ? 'Matriz' : 'Filial'}</Badge>
        {c.isIndividualEntrepreneur ? <Badge variant="warning">Empresário individual</Badge> : null}
      </div>
    </div>
  );
}

function Comparison({ result }: { result: ProspectingResultView }) {
  return (
    <div className="space-y-1">
      <Badge variant={MATCH_VARIANT[result.matchStatus] ?? 'muted'}>
        {PROSPECTING_MATCH_LABELS[result.matchStatus]}
      </Badge>
      {result.rejectedBefore ? <Badge variant="muted">Recusado antes</Badge> : null}
      <ul className="text-xs text-muted-foreground">
        {result.reasons.map((reason, index) => (
          <li key={index}>{reason.detail}</li>
        ))}
      </ul>
      {result.matchedLead ? (
        <Link
          href={`/leads/${result.matchedLead.id}`}
          className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
        >
          {result.matchedLead.code} · {result.matchedLead.displayName}
          <ExternalLink className="size-3" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

function Decision({ result }: { result: ProspectingResultView }) {
  return (
    <div className="space-y-1">
      <Badge variant={DECISION_VARIANT[result.decision]}>
        {PROSPECTING_DECISION_LABELS[result.decision]}
      </Badge>
      {result.createdLead ? (
        <Link
          href={`/leads/${result.createdLead.id}`}
          className="block text-xs text-primary underline-offset-2 hover:underline"
        >
          Lead {result.createdLead.code}
        </Link>
      ) : null}
      {result.decision !== 'PENDING' && result.decidedBy ? (
        <p className="text-xs text-muted-foreground">{result.decidedBy}</p>
      ) : null}
      {result.rejectReason ? (
        <p className="text-xs text-muted-foreground">“{result.rejectReason}”</p>
      ) : null}
    </div>
  );
}

function ApproveDialog({
  searchId,
  ids,
  owners,
  assessments,
  onDone,
  run,
  busy,
}: {
  searchId: string;
  ids: string[];
  owners: { id: string; name: string }[] | null;
  assessments: { id: string; name: string; version: number }[];
  onDone: (summary: ApproveSummary) => void;
  run: ReturnType<typeof useAction>['run'];
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [ownerId, setOwnerId] = useState('');
  const [assessmentId, setAssessmentId] = useState('');
  const tooMany = ids.length > APPROVE_LIMIT;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={busy || ids.length === 0 || tooMany}>
          <Check /> Aprovar ({ids.length})
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Aprovar ${ids.length} ${ids.length === 1 ? 'escritório' : 'escritórios'}?`}
        description="Os novos viram leads com origem “Dados abertos CNPJ” (legítimo interesse) e os que já existem são só completados nos campos vazios. A comparação é refeita na hora: quem entrou na Lista Não Contatar não vira lead."
      >
        <div className="space-y-4">
          {owners ? (
            <Field label="Responsável dos novos" htmlFor="prospectOwner">
              <Select
                id="prospectOwner"
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
              >
                <option value="">Sem responsável (pool)</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field
            label="Avaliação de legítimo interesse (LIA)"
            htmlFor="prospectLia"
            hint="A avaliação que cobre a prospecção B2B (docs/LGPD.md §5)."
          >
            <Select
              id="prospectLia"
              value={assessmentId}
              onChange={(e) => setAssessmentId(e.target.value)}
            >
              <option value="">Nenhuma</option>
              {assessments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} (v{a.version})
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end">
            <Button
              disabled={busy}
              onClick={async () => {
                const summary = await run(() =>
                  api<ApproveSummary>(`/prospecting/searches/${searchId}/approve`, {
                    method: 'POST',
                    body: {
                      resultIds: ids,
                      ...(ownerId ? { ownerId } : {}),
                      legalBasisAssessmentId: assessmentId || null,
                    },
                  }),
                );
                if (summary) {
                  setOpen(false);
                  onDone(summary);
                }
              }}
            >
              <Check /> Aprovar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({
  searchId,
  ids,
  onDone,
  run,
  busy,
}: {
  searchId: string;
  ids: string[];
  onDone: () => void;
  run: ReturnType<typeof useAction>['run'];
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={busy || ids.length === 0}>
          <Ban /> Recusar ({ids.length})
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Recusar ${ids.length} ${ids.length === 1 ? 'escritório' : 'escritórios'}?`}
        description="Recusados ficam de fora das próximas buscas por 30 dias (enquanto o resultado existir)."
      >
        <div className="space-y-4">
          <Field label="Motivo (opcional)" htmlFor="prospectReject">
            <Input
              id="prospectReject"
              value={reason}
              maxLength={200}
              placeholder="Ex.: fora do perfil"
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="flex justify-end">
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                const ok = await run(
                  () =>
                    api(`/prospecting/searches/${searchId}/reject`, {
                      method: 'POST',
                      body: { resultIds: ids, reason: reason.trim() || null },
                    }),
                  (r) => {
                    const n = (r as { rejected: number }).rejected;
                    return `${n} ${n === 1 ? 'recusado' : 'recusados'}.`;
                  },
                );
                if (ok) {
                  setOpen(false);
                  setReason('');
                  onDone();
                }
              }}
            >
              <Ban /> Recusar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Resultados de uma busca: comparação com a base, seleção, aprovação e recusa. */
export function SearchResults({
  detail,
  owners,
  assessments,
}: {
  detail: ProspectingSearchDetail;
  owners: { id: string; name: string }[] | null;
  assessments: { id: string; name: string; version: number }[];
}) {
  const { run, notice, busy } = useAction();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingOnly, setPendingOnly] = useState(false);
  const [summary, setSummary] = useState<ApproveSummary | null>(null);
  const { search, results, counts } = detail;
  const visible = useMemo(
    () => (pendingOnly ? results.filter((r) => r.decision === 'PENDING') : results),
    [pendingOnly, results],
  );
  const selectableIds = visible.filter(selectable).map((r) => r.id);
  const ids = [...selected].filter((id) => results.some((r) => r.id === id && selectable(r)));
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };
  const nameOf = (resultId: string) => {
    const r = results.find((x) => x.id === resultId);
    return r?.company?.tradeName ?? r?.company?.companyName ?? (r ? formatCnpj(r.cnpj) : '');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {search.resultCount} {search.resultCount === 1 ? 'escritório' : 'escritórios'}
        </CardTitle>
        <CardDescription>
          Busca de {formatDateTime(search.createdAt)}
          {search.requestedBy ? ` por ${search.requestedBy}` : ''} · base de{' '}
          {search.datasetReference ?? '—'} · {plural(counts.PENDING, 'pendente', 'pendentes')},{' '}
          {plural(counts.APPROVED, 'aprovado', 'aprovados')},{' '}
          {plural(counts.REJECTED, 'recusado', 'recusados')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {search.purgedAt ? (
          <Alert>
            Os resultados desta busca foram apagados pela retenção de 30 dias. Faça uma busca nova.
          </Alert>
        ) : null}
        {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}
        {summary ? (
          <Alert
            variant={summary.errors.length ? 'error' : 'success'}
            title={`${summary.created} ${summary.created === 1 ? 'lead criado' : 'leads criados'}, ${summary.completed} ${summary.completed === 1 ? 'completado' : 'completados'}${summary.skipped ? `, ${summary.skipped} já decididos` : ''}${summary.errors.length ? `, ${summary.errors.length} com problema` : ''}.`}
          >
            {summary.errors.length ? (
              <ul className="list-disc pl-4">
                {summary.errors.map((e) => (
                  <li key={e.resultId}>
                    {nameOf(e.resultId)}: {e.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={pendingOnly}
              onChange={(e) => setPendingOnly(e.target.checked)}
            />
            Só pendentes
          </label>
          <div className="flex gap-2">
            <RejectDialog
              searchId={search.id}
              ids={ids}
              run={run}
              busy={busy}
              onDone={() => setSelected(new Set())}
            />
            <ApproveDialog
              searchId={search.id}
              ids={ids}
              owners={owners}
              assessments={assessments}
              run={run}
              busy={busy}
              onDone={(s) => {
                setSummary(s);
                setSelected(new Set());
              }}
            />
          </div>
        </div>
        {ids.length > APPROVE_LIMIT ? (
          <p className="text-xs text-muted-foreground">
            Aprove no máximo {APPROVE_LIMIT} de cada vez.
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <Tr>
                <Th className="w-8">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todos os pendentes"
                    checked={allSelected}
                    disabled={selectableIds.length === 0}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(selectableIds) : new Set())
                    }
                  />
                </Th>
                <Th>Escritório</Th>
                <Th>Cidade</Th>
                <Th>Atividade</Th>
                <Th>Contatos na Receita</Th>
                <Th>Na base</Th>
                <Th>Decisão</Th>
              </Tr>
            </THead>
            <TBody>
              {visible.map((r) => (
                <Tr key={r.id} data-testid="prospect-row">
                  <Td>
                    {selectable(r) ? (
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${r.company?.tradeName ?? r.company?.companyName ?? r.cnpj}`}
                        checked={selected.has(r.id)}
                        onChange={(e) => toggle(r.id, e.target.checked)}
                      />
                    ) : null}
                  </Td>
                  <Td>
                    <Office result={r} />
                  </Td>
                  <Td className="text-sm">
                    {r.company ? (
                      <>
                        {r.company.city ?? '—'} — {r.company.uf}
                        {r.company.neighborhood ? (
                          <p className="text-xs text-muted-foreground">{r.company.neighborhood}</p>
                        ) : null}
                      </>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td className="text-sm">
                    {r.company ? (
                      <>
                        {formatCnae(r.company.cnaeMain)}
                        <p className="text-xs text-muted-foreground">
                          {r.company.openedAt
                            ? `desde ${new Date(r.company.openedAt).getUTCFullYear()}`
                            : ''}
                          {r.company.companySize ? ` · ${r.company.companySize}` : ''}
                        </p>
                      </>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td className="text-sm">
                    {r.company ? (
                      <ul className="space-y-0.5">
                        {r.company.phones.map((p) => (
                          <li key={p}>{formatPhone(p)}</li>
                        ))}
                        {r.company.email ? (
                          <li className="break-all text-xs">{r.company.email}</li>
                        ) : null}
                        {r.company.phones.length === 0 && !r.company.email ? (
                          <li className="text-xs text-muted-foreground">Nenhum</li>
                        ) : null}
                      </ul>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>
                    <Comparison result={r} />
                  </Td>
                  <Td>
                    <Decision result={r} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          Telefones e e-mails são os declarados à Receita: entram no lead sem presumir WhatsApp, e o
          contato segue as regras de sempre (base legal, Lista Não Contatar, horários e limites).
        </p>
      </CardContent>
    </Card>
  );
}
