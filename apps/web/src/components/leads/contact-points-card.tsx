'use client';

import type { GateResult } from '@docline/core/compliance-domain';
import { WHATSAPP_STATUS_LABELS } from '@docline/core/leads-domain';
import { AtSign, Mail, MessageCircle, Phone, Plus } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import { formatDate } from '@/lib/utils';
import { DuplicateList, type DuplicateMatch } from './duplicate-list';

type ContactType = 'PHONE' | 'EMAIL' | 'INSTAGRAM';

export interface ContactPointView {
  id: string;
  type: ContactType;
  display: string;
  label: string | null;
  personId: string | null;
  phoneKind: string | null;
  whatsappStatus: keyof typeof WHATSAPP_STATUS_LABELS;
  isPrimary: boolean;
  status: string;
  links: { tel?: string; whatsapp?: string | null; mailto?: string; instagram?: string };
  suppressions: { id: string; reason: string; scope: string; since: string | Date }[];
}

const ICONS = { PHONE: Phone, EMAIL: Mail, INSTAGRAM: AtSign } as const;

/** Link de contato liberado pelo gate; bloqueado mostra o motivo (MVP M13/M14). */
function ContactLink({
  href,
  allowed,
  reason,
  children,
}: {
  href?: string | null;
  allowed: boolean;
  reason?: string;
  children: React.ReactNode;
}) {
  if (!href) return null;
  if (!allowed) {
    return (
      <Button size="sm" variant="outline" disabled title={reason}>
        {children}
      </Button>
    );
  }
  return (
    <Button size="sm" variant="outline" asChild>
      <a
        href={href}
        target={href.startsWith('http') ? '_blank' : undefined}
        rel="noopener noreferrer"
      >
        {children}
      </a>
    </Button>
  );
}

export function ContactPointsCard({
  leadId,
  contactPoints,
  people,
  gate,
  canEdit,
  canOptOut,
  run,
  busy,
}: {
  leadId: string;
  contactPoints: ContactPointView[];
  people: { id: string; fullName: string }[];
  gate: GateResult[];
  canEdit: boolean;
  canOptOut: boolean;
  run: <T>(action: () => Promise<T>, success?: string) => Promise<T | null>;
  busy: boolean;
}) {
  const [type, setType] = useState<ContactType>('PHONE');
  const [value, setValue] = useState('');
  const [isWhatsapp, setIsWhatsapp] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const channel = (name: GateResult['channel']) => gate.find((g) => g.channel === name);
  const usable = (name: GateResult['channel'], id: string) =>
    channel(name)?.usableContactPointIds.includes(id) ?? false;
  const reasonOf = (name: GateResult['channel']) =>
    channel(name)?.reasons.join(' ') || 'Contato não permitido.';
  const personName = (id: string | null) => people.find((p) => p.id === id)?.fullName;

  async function add() {
    const result = await run(
      () =>
        api<{ duplicates: DuplicateMatch[] }>(`/leads/${leadId}/contact-points`, {
          method: 'POST',
          body: { type, value, isWhatsapp: type === 'PHONE' && isWhatsapp },
        }),
      'Contato adicionado.',
    );
    if (result) {
      setValue('');
      setIsWhatsapp(false);
      setDuplicates(result.duplicates);
    }
  }

  const patch = (id: string, body: object, message: string) =>
    run(() => api(`/leads/${leadId}/contact-points/${id}`, { method: 'PATCH', body }), message);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contatos</CardTitle>
        <CardDescription>
          Os botões só ficam ativos quando o contato é permitido (base legal, Lista Não Contatar).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {contactPoints.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum contato cadastrado.</p>
        ) : (
          <ul className="divide-y">
            {contactPoints.map((cp) => {
              const Icon = ICONS[cp.type];
              const person = personName(cp.personId);
              return (
                <li key={cp.id} className="space-y-2 py-3 first:pt-0" data-testid="contact-point">
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon className="size-4 text-muted-foreground" aria-hidden />
                    <span className="font-medium">{cp.display}</span>
                    {cp.isPrimary ? <Badge variant="muted">principal</Badge> : null}
                    {cp.label ? (
                      <span className="text-xs text-muted-foreground">{cp.label}</span>
                    ) : null}
                    {person ? (
                      <span className="text-xs text-muted-foreground">· {person}</span>
                    ) : null}
                    {cp.status !== 'ACTIVE' ? (
                      <Badge variant="warning">
                        {cp.status === 'INVALID' ? 'inválido' : cp.status.toLowerCase()}
                      </Badge>
                    ) : null}
                    {cp.suppressions.map((s) => (
                      <Badge key={s.id} variant="destructive">
                        Não contatar
                        {s.scope !== 'ALL_CHANNELS' ? ` (${s.scope.toLowerCase()})` : ''} desde{' '}
                        {formatDate(s.since)}
                      </Badge>
                    ))}
                  </div>
                  {cp.type === 'PHONE' ? (
                    <p className="text-xs text-muted-foreground">
                      WhatsApp: {WHATSAPP_STATUS_LABELS[cp.whatsappStatus]}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {cp.type === 'PHONE' ? (
                      <>
                        <ContactLink
                          href={cp.links.tel}
                          allowed={usable('PHONE', cp.id)}
                          reason={reasonOf('PHONE')}
                        >
                          <Phone /> Ligar
                        </ContactLink>
                        <ContactLink
                          href={cp.links.whatsapp}
                          allowed={usable('WHATSAPP', cp.id)}
                          reason={reasonOf('WHATSAPP')}
                        >
                          <MessageCircle /> WhatsApp
                        </ContactLink>
                      </>
                    ) : null}
                    {cp.type === 'EMAIL' ? (
                      <ContactLink
                        href={cp.links.mailto}
                        allowed={usable('EMAIL', cp.id)}
                        reason={reasonOf('EMAIL')}
                      >
                        <Mail /> E-mail
                      </ContactLink>
                    ) : null}
                    {cp.type === 'INSTAGRAM' ? (
                      <ContactLink
                        href={cp.links.instagram}
                        allowed={usable('INSTAGRAM', cp.id)}
                        reason={reasonOf('INSTAGRAM')}
                      >
                        <AtSign /> Abrir perfil
                      </ContactLink>
                    ) : null}
                    {canEdit ? (
                      <>
                        {!cp.isPrimary && cp.status === 'ACTIVE' ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              patch(cp.id, { isPrimary: true }, 'Contato principal alterado.')
                            }
                          >
                            Tornar principal
                          </Button>
                        ) : null}
                        {cp.type === 'PHONE' && cp.whatsappStatus !== 'NOT_ON_WHATSAPP' ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              patch(
                                cp.id,
                                { whatsappStatus: 'NOT_ON_WHATSAPP' },
                                'Marcado como sem WhatsApp.',
                              )
                            }
                          >
                            Não usa WhatsApp
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            patch(
                              cp.id,
                              { status: cp.status === 'ACTIVE' ? 'INVALID' : 'ACTIVE' },
                              cp.status === 'ACTIVE'
                                ? 'Contato marcado como inválido.'
                                : 'Contato reativado.',
                            )
                          }
                        >
                          {cp.status === 'ACTIVE' ? 'Marcar inválido' : 'Reativar'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            window.confirm(`Remover ${cp.display} deste lead?`) &&
                            run(
                              () =>
                                api(`/leads/${leadId}/contact-points/${cp.id}`, {
                                  method: 'DELETE',
                                }),
                              'Contato removido.',
                            )
                          }
                        >
                          Remover
                        </Button>
                      </>
                    ) : null}
                    {canOptOut && cp.suppressions.length === 0 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={busy}
                        onClick={() =>
                          window.confirm(
                            `Registrar que ${cp.display} não quer mais ser contatado?`,
                          ) &&
                          run(
                            () =>
                              api(`/leads/${leadId}/opt-out`, {
                                method: 'POST',
                                body: { contactPointId: cp.id },
                              }),
                            'Contato incluído na Lista Não Contatar.',
                          )
                        }
                      >
                        Não contatar este
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {canEdit ? (
          <div className="grid gap-2 border-t pt-3 sm:grid-cols-[8rem_1fr_auto_auto] sm:items-center">
            <Select
              aria-label="Tipo do novo contato"
              value={type}
              onChange={(e) => setType(e.target.value as ContactType)}
            >
              <option value="PHONE">Telefone</option>
              <option value="EMAIL">E-mail</option>
              <option value="INSTAGRAM">Instagram</option>
            </Select>
            <Input
              aria-label="Novo contato"
              placeholder="Telefone, e-mail ou @instagram"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                disabled={type !== 'PHONE'}
                checked={isWhatsapp}
                onChange={(e) => setIsWhatsapp(e.target.checked)}
              />
              WhatsApp
            </label>
            <Button size="sm" disabled={busy || !value.trim()} onClick={add}>
              <Plus /> Adicionar
            </Button>
          </div>
        ) : null}
        {duplicates.length > 0 ? (
          <DuplicateList duplicates={duplicates} title="Este contato também está em outros leads" />
        ) : null}
      </CardContent>
    </Card>
  );
}
