'use client';

import { LEGAL_BASIS_LABELS } from '@docline/core/compliance-domain';
import Link from 'next/link';
import { useState } from 'react';
import { useAction } from '@/components/leads/use-action';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api, ApiError } from '@/lib/api-client';
import { cn, formatDate, formatDateTime } from '@/lib/utils';

export interface SuppressionRow {
  id: string;
  type: string;
  valueMasked: string;
  scope: string;
  reason: string;
  source: string;
  createdAt: string | Date;
  createdByName: string | null;
  revokedAt: string | Date | null;
  revokeReason: string | null;
  lead: { id: string; code: number; displayName: string } | null;
}

export interface DsrRow {
  id: string;
  requesterName: string;
  requesterContact: string;
  type: string;
  status: string;
  receivedAt: string | Date;
  dueAt: string | Date;
  resolvedAt: string | Date | null;
  overdue: boolean;
  lead: { id: string; displayName: string } | null;
}

export interface AssessmentRow {
  id: string;
  name: string;
  legalBasis: keyof typeof LEGAL_BASIS_LABELS;
  purpose: string;
  version: number;
  approvedBy: string | null;
  approvedAt: string | Date | null;
  documentUrl: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  PHONE: 'Telefone',
  EMAIL: 'E-mail',
  INSTAGRAM: 'Instagram',
  CNPJ: 'CNPJ',
  LEAD: 'Lead',
};
const SCOPE_LABELS: Record<string, string> = {
  ALL_CHANNELS: 'Todos os canais',
  WHATSAPP: 'WhatsApp',
  PHONE: 'Ligações',
  EMAIL: 'E-mail',
  INSTAGRAM: 'Instagram',
};
const REASON_LABELS: Record<string, string> = {
  OPT_OUT: 'Pediu para não ser contatado',
  DATA_SUBJECT_REQUEST: 'Solicitação do titular',
  COMPLAINT: 'Reclamação',
  LEGAL: 'Determinação legal',
  INVALID_CONTACT: 'Contato inválido',
  INTERNAL_DECISION: 'Decisão interna',
};
const DSR_TYPE_LABELS: Record<string, string> = {
  CONFIRMATION: 'Confirmação de tratamento',
  ACCESS: 'Acesso aos dados',
  CORRECTION: 'Correção',
  ANONYMIZATION: 'Anonimização ou bloqueio',
  DELETION: 'Eliminação',
  PORTABILITY: 'Portabilidade',
  SHARING_INFO: 'Informação sobre compartilhamento',
  CONSENT_REVOCATION: 'Revogação do consentimento',
  OPPOSITION: 'Oposição',
};
const DSR_STATUS_LABELS: Record<string, string> = {
  RECEIVED: 'Recebida',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluída',
  REJECTED: 'Recusada',
};

type Tab = 'suppressions' | 'requests' | 'assessments';

/** Central de conformidade (LGPD): Lista Não Contatar, titulares e bases legais. */
export function ComplianceCenter({
  suppressions: initialSuppressions,
  requests,
  assessments,
  permissions,
}: {
  suppressions: { data: SuppressionRow[]; nextCursor: string | null };
  requests: DsrRow[] | null;
  assessments: AssessmentRow[];
  permissions: {
    canRevoke: boolean;
    canAdd: boolean;
    canManageRequests: boolean;
    canManageAssessments: boolean;
  };
}) {
  const [tab, setTab] = useState<Tab>('suppressions');
  const { run, notice } = useAction();
  const [suppressions, setSuppressions] = useState(initialSuppressions);
  const [status, setStatus] = useState('ACTIVE');
  const [value, setValue] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [newEntry, setNewEntry] = useState({
    type: 'PHONE',
    value: '',
    scope: 'ALL_CHANNELS',
    reason: 'OPT_OUT',
    notes: '',
  });
  const [newRequest, setNewRequest] = useState({
    requesterName: '',
    requesterContact: '',
    type: 'ACCESS',
    receivedAt: new Date().toISOString().slice(0, 10),
    notes: '',
  });
  const [newAssessment, setNewAssessment] = useState({
    name: '',
    legalBasis: 'LEGITIMATE_INTEREST',
    purpose: '',
    documentUrl: '',
    approvedBy: '',
  });

  async function searchSuppressions(nextStatus = status) {
    setSearchError(null);
    try {
      const params = new URLSearchParams({
        status: nextStatus,
        ...(value.trim() ? { value: value.trim() } : {}),
      });
      setSuppressions(await api(`/suppressions?${params.toString()}`));
    } catch (err) {
      setSearchError(err instanceof ApiError ? err.message : 'Falha na busca.');
    }
  }

  const tabs: [Tab, string][] = [
    ['suppressions', 'Lista Não Contatar'],
    ...(permissions.canManageRequests
      ? ([['requests', 'Solicitações de titulares']] as [Tab, string][])
      : []),
    ['assessments', 'Bases legais (LIA)'],
  ];

  return (
    <>
      <PageHeader
        title="Conformidade"
        description="LGPD: quem não quer ser contatado, pedidos dos titulares e as avaliações que fundamentam o contato."
      />
      <div role="tablist" aria-label="Conformidade" className="mb-4 flex flex-wrap gap-1">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              'rounded-full px-3 py-1 text-sm transition-colors',
              tab === value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {notice ? (
        <Alert variant={notice.variant} className="mb-4">
          {notice.text}
        </Alert>
      ) : null}

      {tab === 'suppressions' ? (
        <div className="space-y-4">
          {permissions.canAdd ? (
            <Card>
              <CardHeader>
                <CardTitle>Incluir na lista</CardTitle>
                <CardDescription>
                  Para pedidos recebidos fora de um lead (e-mail, telefone). O valor é guardado só
                  como hash e exibido mascarado.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const ok = await run(
                      () =>
                        api('/suppressions', {
                          method: 'POST',
                          body: { ...newEntry, notes: newEntry.notes || null },
                        }),
                      'Incluído na Lista Não Contatar.',
                    );
                    if (ok) {
                      setNewEntry((n) => ({ ...n, value: '', notes: '' }));
                      void searchSuppressions();
                    }
                  }}
                >
                  <Field label="Tipo" htmlFor="supType">
                    <Select
                      id="supType"
                      value={newEntry.type}
                      onChange={(e) => setNewEntry((n) => ({ ...n, type: e.target.value }))}
                    >
                      {['PHONE', 'EMAIL', 'INSTAGRAM', 'CNPJ'].map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABELS[t]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Valor" htmlFor="supValue">
                    <Input
                      id="supValue"
                      value={newEntry.value}
                      onChange={(e) => setNewEntry((n) => ({ ...n, value: e.target.value }))}
                    />
                  </Field>
                  <Field label="Escopo" htmlFor="supScope">
                    <Select
                      id="supScope"
                      value={newEntry.scope}
                      onChange={(e) => setNewEntry((n) => ({ ...n, scope: e.target.value }))}
                    >
                      {Object.entries(SCOPE_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Motivo" htmlFor="supReason">
                    <Select
                      id="supReason"
                      value={newEntry.reason}
                      onChange={(e) => setNewEntry((n) => ({ ...n, reason: e.target.value }))}
                    >
                      {Object.entries(REASON_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
                    <Button type="submit" disabled={!newEntry.value.trim()}>
                      Incluir
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : null}

          <Card className="p-4">
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void searchSuppressions();
              }}
            >
              <Input
                aria-label="Buscar na lista pelo valor"
                placeholder="Buscar pelo telefone, e-mail, @instagram ou CNPJ (qualquer formato)"
                className="min-w-60 flex-1"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              <Select
                aria-label="Situação"
                className="w-auto"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  void searchSuppressions(e.target.value);
                }}
              >
                <option value="ACTIVE">Vigentes</option>
                <option value="REVOKED">Revogados</option>
                <option value="ALL">Todos</option>
              </Select>
              <Button type="submit" variant="outline">
                Buscar
              </Button>
            </form>
            {searchError ? <p className="mt-2 text-sm text-destructive">{searchError}</p> : null}
          </Card>

          <Card>
            <Table>
              <THead>
                <Tr>
                  <Th>Identificador</Th>
                  <Th>Escopo</Th>
                  <Th className="hidden md:table-cell">Motivo</Th>
                  <Th className="hidden md:table-cell">Lead</Th>
                  <Th className="hidden lg:table-cell">Desde</Th>
                  {permissions.canRevoke ? <Th className="text-right">Ações</Th> : null}
                </Tr>
              </THead>
              <TBody>
                {suppressions.data.length === 0 ? (
                  <Tr>
                    <Td colSpan={6} className="py-8 text-center text-muted-foreground">
                      Nenhum registro.
                    </Td>
                  </Tr>
                ) : (
                  suppressions.data.map((s) => (
                    <Tr key={s.id}>
                      <Td>
                        <span className="font-medium">{s.valueMasked}</span>
                        <span className="block text-xs text-muted-foreground">
                          {TYPE_LABELS[s.type]}
                        </span>
                        {s.revokedAt ? (
                          <Badge variant="muted">revogado em {formatDate(s.revokedAt)}</Badge>
                        ) : null}
                      </Td>
                      <Td>{SCOPE_LABELS[s.scope]}</Td>
                      <Td className="hidden md:table-cell">{REASON_LABELS[s.reason]}</Td>
                      <Td className="hidden md:table-cell">
                        {s.lead ? (
                          <Link className="underline" href={`/leads/${s.lead.id}`}>
                            {s.lead.displayName}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td className="hidden whitespace-nowrap lg:table-cell">
                        {formatDateTime(s.createdAt)}
                        {s.createdByName ? (
                          <span className="block text-xs text-muted-foreground">
                            {s.createdByName}
                          </span>
                        ) : null}
                      </Td>
                      {permissions.canRevoke ? (
                        <Td className="text-right">
                          {!s.revokedAt ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={async () => {
                                const reason = window.prompt(
                                  'Motivo da revogação (ex.: o titular pediu para voltar a receber contato, com evidência):',
                                );
                                if (!reason) return;
                                const ok = await run(
                                  () =>
                                    api(`/suppressions/${s.id}/revoke`, {
                                      method: 'POST',
                                      body: { reason },
                                    }),
                                  'Registro revogado.',
                                );
                                if (ok) void searchSuppressions();
                              }}
                            >
                              Revogar
                            </Button>
                          ) : null}
                        </Td>
                      ) : null}
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>
          </Card>
        </div>
      ) : null}

      {tab === 'requests' && requests ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Registrar solicitação</CardTitle>
              <CardDescription>
                Prazo padrão de resposta: 15 dias a partir do recebimento.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const ok = await run(
                    () =>
                      api('/data-subject-requests', {
                        method: 'POST',
                        body: { ...newRequest, notes: newRequest.notes || null },
                      }),
                    'Solicitação registrada.',
                  );
                  if (ok)
                    setNewRequest((r) => ({
                      ...r,
                      requesterName: '',
                      requesterContact: '',
                      notes: '',
                    }));
                }}
              >
                <Field label="Nome do titular" htmlFor="dsrName">
                  <Input
                    id="dsrName"
                    value={newRequest.requesterName}
                    onChange={(e) =>
                      setNewRequest((r) => ({ ...r, requesterName: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Contato do titular" htmlFor="dsrContact">
                  <Input
                    id="dsrContact"
                    value={newRequest.requesterContact}
                    onChange={(e) =>
                      setNewRequest((r) => ({ ...r, requesterContact: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Tipo" htmlFor="dsrType">
                  <Select
                    id="dsrType"
                    value={newRequest.type}
                    onChange={(e) => setNewRequest((r) => ({ ...r, type: e.target.value }))}
                  >
                    {Object.entries(DSR_TYPE_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Recebida em" htmlFor="dsrReceived">
                  <Input
                    id="dsrReceived"
                    type="date"
                    value={newRequest.receivedAt}
                    onChange={(e) => setNewRequest((r) => ({ ...r, receivedAt: e.target.value }))}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Observações" htmlFor="dsrNotes">
                    <Textarea
                      id="dsrNotes"
                      value={newRequest.notes}
                      onChange={(e) => setNewRequest((r) => ({ ...r, notes: e.target.value }))}
                    />
                  </Field>
                </div>
                <div className="flex justify-end sm:col-span-2">
                  <Button type="submit">Registrar</Button>
                </div>
              </form>
            </CardContent>
          </Card>
          <Card>
            <Table>
              <THead>
                <Tr>
                  <Th>Titular</Th>
                  <Th>Tipo</Th>
                  <Th>Situação</Th>
                  <Th className="hidden md:table-cell">Prazo</Th>
                  <Th className="text-right">Ações</Th>
                </Tr>
              </THead>
              <TBody>
                {requests.length === 0 ? (
                  <Tr>
                    <Td colSpan={5} className="py-8 text-center text-muted-foreground">
                      Nenhuma solicitação registrada.
                    </Td>
                  </Tr>
                ) : (
                  requests.map((r) => (
                    <Tr key={r.id}>
                      <Td>
                        <span className="font-medium">{r.requesterName}</span>
                        <span className="block text-xs text-muted-foreground">
                          {r.requesterContact}
                        </span>
                      </Td>
                      <Td>{DSR_TYPE_LABELS[r.type]}</Td>
                      <Td>
                        <Badge
                          variant={r.overdue ? 'destructive' : r.resolvedAt ? 'success' : 'warning'}
                        >
                          {r.overdue ? 'Atrasada' : DSR_STATUS_LABELS[r.status]}
                        </Badge>
                      </Td>
                      <Td className="hidden md:table-cell">{formatDate(r.dueAt)}</Td>
                      <Td className="text-right">
                        {!r.resolvedAt ? (
                          <Select
                            aria-label={`Situação da solicitação de ${r.requesterName}`}
                            className="ml-auto w-auto"
                            value={r.status}
                            onChange={(e) =>
                              run(
                                () =>
                                  api(`/data-subject-requests/${r.id}`, {
                                    method: 'PATCH',
                                    body: { status: e.target.value },
                                  }),
                                'Solicitação atualizada.',
                              )
                            }
                          >
                            {Object.entries(DSR_STATUS_LABELS).map(([v, l]) => (
                              <option key={v} value={v}>
                                {l}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            em {formatDate(r.resolvedAt)}
                          </span>
                        )}
                      </Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>
          </Card>
        </div>
      ) : null}

      {tab === 'assessments' ? (
        <div className="space-y-4">
          {permissions.canManageAssessments ? (
            <Card>
              <CardHeader>
                <CardTitle>Nova avaliação</CardTitle>
                <CardDescription>
                  Registre a LIA (ou outra avaliação) aprovada pelo jurídico. Um novo registro com o
                  mesmo nome vira uma nova versão.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="grid gap-3 sm:grid-cols-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const ok = await run(
                      () =>
                        api('/legal-basis-assessments', {
                          method: 'POST',
                          body: {
                            ...newAssessment,
                            documentUrl: newAssessment.documentUrl || null,
                            approvedBy: newAssessment.approvedBy || null,
                          },
                        }),
                      'Avaliação registrada.',
                    );
                    if (ok)
                      setNewAssessment((a) => ({
                        ...a,
                        name: '',
                        purpose: '',
                        documentUrl: '',
                        approvedBy: '',
                      }));
                  }}
                >
                  <Field label="Nome" htmlFor="liaName">
                    <Input
                      id="liaName"
                      value={newAssessment.name}
                      onChange={(e) => setNewAssessment((a) => ({ ...a, name: e.target.value }))}
                    />
                  </Field>
                  <Field label="Base legal" htmlFor="liaBasis">
                    <Select
                      id="liaBasis"
                      value={newAssessment.legalBasis}
                      onChange={(e) =>
                        setNewAssessment((a) => ({ ...a, legalBasis: e.target.value }))
                      }
                    >
                      {(['LEGITIMATE_INTEREST', 'CONSENT', 'CONTRACT'] as const).map((v) => (
                        <option key={v} value={v}>
                          {LEGAL_BASIS_LABELS[v]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Finalidade" htmlFor="liaPurpose">
                      <Textarea
                        id="liaPurpose"
                        value={newAssessment.purpose}
                        onChange={(e) =>
                          setNewAssessment((a) => ({ ...a, purpose: e.target.value }))
                        }
                      />
                    </Field>
                  </div>
                  <Field label="Link do documento" htmlFor="liaDoc">
                    <Input
                      id="liaDoc"
                      value={newAssessment.documentUrl}
                      onChange={(e) =>
                        setNewAssessment((a) => ({ ...a, documentUrl: e.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Aprovada por" htmlFor="liaApprover">
                    <Input
                      id="liaApprover"
                      value={newAssessment.approvedBy}
                      onChange={(e) =>
                        setNewAssessment((a) => ({ ...a, approvedBy: e.target.value }))
                      }
                    />
                  </Field>
                  <div className="flex justify-end sm:col-span-2">
                    <Button type="submit">Registrar avaliação</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <Table>
              <THead>
                <Tr>
                  <Th>Avaliação</Th>
                  <Th>Base legal</Th>
                  <Th className="hidden md:table-cell">Aprovação</Th>
                </Tr>
              </THead>
              <TBody>
                {assessments.length === 0 ? (
                  <Tr>
                    <Td colSpan={3} className="py-8 text-center text-muted-foreground">
                      Nenhuma avaliação registrada. A LIA de prospecção B2B deve ser aprovada pelo
                      jurídico antes do uso com dados reais (docs/LGPD.md §5).
                    </Td>
                  </Tr>
                ) : (
                  assessments.map((a) => (
                    <Tr key={a.id}>
                      <Td>
                        <span className="font-medium">
                          {a.name} <span className="text-muted-foreground">v{a.version}</span>
                        </span>
                        <span className="block text-xs text-muted-foreground">{a.purpose}</span>
                      </Td>
                      <Td>{LEGAL_BASIS_LABELS[a.legalBasis]}</Td>
                      <Td className="hidden md:table-cell">
                        {a.approvedBy ?? '—'}
                        {a.approvedAt ? ` · ${formatDate(a.approvedAt)}` : ''}
                      </Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>
          </Card>
        </div>
      ) : null}
    </>
  );
}
