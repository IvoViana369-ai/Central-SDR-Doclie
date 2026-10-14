'use client';

import type { MergeChoice, MergeChoices, MergeField } from '@docline/core/dedup-domain';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Textarea } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api, ApiError } from '@/lib/api-client';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import { confidenceVariant, type DuplicateItem } from './duplicate-queue';

interface CompareLead {
  id: string;
  code: string;
  version: number;
  status: string;
  statusLabel: string;
  displayName: string;
  originSourceName: string;
  createdAt: string | Date;
  lastActivityAt: string | Date;
  contactPoints: {
    id: string;
    type: 'PHONE' | 'EMAIL' | 'INSTAGRAM';
    display: string;
    valueNormalized: string;
    status: string;
    whatsappStatus: string;
    isPrimary: boolean;
  }[];
  people: { id: string; fullName: string; roleTitle: string | null }[];
  tags: { id: string; name: string }[];
  customFields: Record<string, string>;
  counts: { notes: number; events: number; origins: number };
}

export interface DuplicateDetail extends Pick<
  DuplicateItem,
  'id' | 'score' | 'confidence' | 'confidenceLabel' | 'status' | 'statusLabel' | 'reasons'
> {
  detectedAt: string | Date;
  decidedAt: string | Date | null;
  decidedByName: string | null;
  decisionNote: string | null;
  leads: CompareLead[];
  fields: { key: MergeField; label: string; values: (string | null)[]; differs: boolean }[];
  suggestedSurvivorId: string;
  defaultChoices: Record<string, MergeChoices>;
  canDecide: boolean;
}

const CONTACT_TYPES: Record<CompareLead['contactPoints'][number]['type'], string> = {
  PHONE: 'Telefone',
  EMAIL: 'E-mail',
  INSTAGRAM: 'Instagram',
};

/** Comparação lado a lado e decisão do par (F3-09 a F3-11). */
export function DuplicateCompare({ detail }: { detail: DuplicateDetail }) {
  const router = useRouter();
  const [survivorId, setSurvivorId] = useState(detail.suggestedSurvivorId);
  const [choices, setChoices] = useState<MergeChoices>(
    detail.defaultChoices[detail.suggestedSurvivorId]!,
  );
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [a, b] = detail.leads as [CompareLead, CompareLead];
  const survivor = survivorId === a.id ? a : b;
  const merged = survivorId === a.id ? b : a;
  const survivorIndex = survivorId === a.id ? 0 : 1;

  function chooseSurvivor(id: string) {
    setSurvivorId(id);
    setChoices(detail.defaultChoices[id]!);
    setConfirming(false);
  }

  /** Lado (0 = coluna da esquerda) de onde vem o valor do campo. */
  const sideOf = (field: MergeField) =>
    choices[field] === 'survivor' ? survivorIndex : 1 - survivorIndex;
  const pick = (field: MergeField, side: number) =>
    setChoices((c) => ({
      ...c,
      [field]: (side === survivorIndex ? 'survivor' : 'merged') as MergeChoice,
    }));

  async function decide(path: 'merge' | 'keep-separate' | 'ignore') {
    setBusy(true);
    setError(null);
    try {
      const body =
        path === 'merge'
          ? {
              survivorId,
              choices,
              versions: { survivor: survivor.version, merged: merged.version },
              note: note || null,
            }
          : { note: note || null };
      await api(`/duplicates/${detail.id}/${path}`, { method: 'POST', body });
      if (path === 'merge') router.push(`/leads/${survivorId}`);
      else router.push('/duplicados');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível concluir a decisão.');
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={`${a.code} × ${b.code}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={confidenceVariant(detail.confidence)}>
              Confiança {detail.confidenceLabel.toLowerCase()} · {Math.round(detail.score * 100)}%
            </Badge>
            {detail.reasons.map((r, i) => (
              <span key={i}>
                {r.label}
                {r.detail ? ` (${r.detail})` : ''}
                {i < detail.reasons.length - 1 ? ' ·' : ''}
              </span>
            ))}
          </span>
        }
        actions={
          <Button variant="outline" asChild>
            <Link href="/duplicados">Voltar à fila</Link>
          </Button>
        }
      />
      <div className="space-y-4">
        {!detail.canDecide ? (
          <Alert title={detail.statusLabel}>
            {detail.decidedByName
              ? `Decidido por ${detail.decidedByName} em ${formatDateTime(detail.decidedAt)}.`
              : 'Um dos leads não está mais disponível para mesclagem.'}
            {detail.decisionNote ? ` Observação: ${detail.decisionNote}` : ''}
          </Alert>
        ) : null}
        {error ? <Alert variant="error">{error}</Alert> : null}

        <div className="grid gap-4 md:grid-cols-2">
          {detail.leads.map((lead) => (
            <Card
              key={lead.id}
              className={cn(detail.canDecide && lead.id === survivorId && 'border-primary')}
            >
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <Link href={`/leads/${lead.id}`} target="_blank" className="hover:underline">
                    {lead.displayName}
                  </Link>
                  <span className="font-mono text-xs font-normal text-muted-foreground">
                    {lead.code}
                  </span>
                  <Badge variant="muted">{lead.statusLabel}</Badge>
                </CardTitle>
                <CardDescription>
                  {lead.originSourceName} · cadastrado em {formatDate(lead.createdAt)} ·{' '}
                  {lead.counts.notes} observações · {lead.counts.events} eventos ·{' '}
                  {lead.counts.origins} origens
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {detail.canDecide ? (
                  <label className="flex cursor-pointer items-center gap-2 font-medium">
                    <input
                      type="radio"
                      name="survivor"
                      checked={lead.id === survivorId}
                      onChange={() => chooseSurvivor(lead.id)}
                    />
                    Este lead fica (o outro é mesclado nele)
                  </label>
                ) : null}
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">Contatos</p>
                  {lead.contactPoints.length === 0 ? (
                    <p className="text-muted-foreground">Nenhum</p>
                  ) : (
                    lead.contactPoints.map((cp) => (
                      <p key={cp.id}>
                        {CONTACT_TYPES[cp.type]}: {cp.display}
                        {cp.status !== 'ACTIVE' ? (
                          <span className="text-muted-foreground">
                            {' '}
                            ({cp.status.toLowerCase()})
                          </span>
                        ) : null}
                      </p>
                    ))
                  )}
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">Pessoas</p>
                  <p>
                    {lead.people.length
                      ? lead.people
                          .map((p) => (p.roleTitle ? `${p.fullName} (${p.roleTitle})` : p.fullName))
                          .join(', ')
                      : 'Nenhuma'}
                  </p>
                </div>
                {lead.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {lead.tags.map((t) => (
                      <Badge key={t.id} variant="muted">
                        {t.name}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Campos</CardTitle>
            <CardDescription>
              {detail.canDecide
                ? 'Escolha o valor que fica em cada campo diferente. Contatos, pessoas, observações, histórico e origens dos dois são reunidos; o lead mesclado fica guardado, sem exclusão.'
                : 'Valores de cada lead.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <THead>
                <Tr>
                  <Th>Campo</Th>
                  <Th>{a.code}</Th>
                  <Th>{b.code}</Th>
                </Tr>
              </THead>
              <TBody>
                {detail.fields.map((field) => (
                  <Tr key={field.key}>
                    <Td className="font-medium">{field.label}</Td>
                    {[0, 1].map((side) => {
                      const value = field.values[side];
                      const chosen = sideOf(field.key) === side;
                      return (
                        <Td
                          key={side}
                          className={cn(
                            field.differs && detail.canDecide && chosen && 'bg-accent',
                            !value && 'text-muted-foreground',
                          )}
                        >
                          {field.differs && detail.canDecide ? (
                            <label className="flex cursor-pointer items-start gap-2">
                              <input
                                type="radio"
                                name={`field-${field.key}`}
                                aria-label={`${field.label}: ${value ?? 'vazio'}`}
                                checked={chosen}
                                onChange={() => pick(field.key, side)}
                                className="mt-1"
                              />
                              <span>{value ?? '—'}</span>
                            </label>
                          ) : (
                            (value ?? '—')
                          )}
                        </Td>
                      );
                    })}
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        {detail.canDecide ? (
          <Card>
            <CardContent className="space-y-4 pt-6">
              <Field label="Observação (opcional)" htmlFor="decision-note">
                <Textarea
                  id="decision-note"
                  value={note}
                  maxLength={500}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ex.: confirmado por telefone que é o mesmo escritório."
                />
              </Field>
              {confirming ? (
                <Alert title={`Mesclar ${merged.code} em ${survivor.code}?`}>
                  {merged.code} passa a constar como mesclado e tudo dele vai para {survivor.code}.
                  Nada é excluído, e a cópia de {merged.code} fica guardada.
                </Alert>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" disabled={busy} onClick={() => decide('ignore')}>
                  Ignorar por agora
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => decide('keep-separate')}>
                  Manter separados
                </Button>
                {confirming ? (
                  <>
                    <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
                      Voltar
                    </Button>
                    <Button disabled={busy} onClick={() => decide('merge')}>
                      Confirmar mesclagem
                    </Button>
                  </>
                ) : (
                  <Button disabled={busy} onClick={() => setConfirming(true)}>
                    Mesclar em {survivor.code}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
