'use client';

import { LEGAL_BASIS_LABELS } from '@docline/core/compliance-domain';
import { useState, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api-client';

type Run = <T>(action: () => Promise<T>, success?: string) => Promise<T | null>;

function ActionDialog({
  trigger,
  title,
  description,
  children,
  open,
  onOpenChange,
}: {
  trigger: ReactNode;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={title} description={description}>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function AssignDialog({
  leadId,
  currentOwnerId,
  owners,
  run,
}: {
  leadId: string;
  currentOwnerId: string | null;
  owners: { id: string; name: string }[];
  run: Run;
}) {
  const [open, setOpen] = useState(false);
  const [ownerId, setOwnerId] = useState(currentOwnerId ?? '');
  const [reason, setReason] = useState('');
  return (
    <ActionDialog
      open={open}
      onOpenChange={setOpen}
      title="Atribuir responsável"
      trigger={<Button variant="outline">Atribuir</Button>}
    >
      <div className="space-y-4">
        <Field label="Responsável" htmlFor="assignOwner">
          <Select id="assignOwner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            <option value="">Sem responsável (devolver ao pool)</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Motivo (opcional)" htmlFor="assignReason">
          <Input id="assignReason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Button
            onClick={async () => {
              const ok = await run(
                () =>
                  api(`/leads/${leadId}/assign`, {
                    method: 'POST',
                    body: { ownerId: ownerId || null, reason: reason || null },
                  }),
                'Responsável atualizado.',
              );
              if (ok) setOpen(false);
            }}
          >
            Salvar
          </Button>
        </div>
      </div>
    </ActionDialog>
  );
}

const SCOPES = [
  ['ALL_CHANNELS', 'Todos os canais'],
  ['WHATSAPP', 'Só WhatsApp'],
  ['PHONE', 'Só ligações'],
  ['EMAIL', 'Só e-mail'],
  ['INSTAGRAM', 'Só Instagram'],
] as const;

/** Opt-out em 1 clique (MVP M14), com escopo e motivo. */
export function OptOutDialog({ leadId, run }: { leadId: string; run: Run }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<string>('ALL_CHANNELS');
  const [reason, setReason] = useState('OPT_OUT');
  const [notes, setNotes] = useState('');
  return (
    <ActionDialog
      open={open}
      onOpenChange={setOpen}
      title="Registrar opt-out"
      description="Telefones, e-mails, Instagram e CNPJ do lead entram na Lista Não Contatar. Vale também para outros leads com os mesmos contatos e para reimportações."
      trigger={
        <Button variant="outline" className="text-destructive">
          Não contatar
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Escopo" htmlFor="optOutScope">
          <Select id="optOutScope" value={scope} onChange={(e) => setScope(e.target.value)}>
            {SCOPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Motivo" htmlFor="optOutReason">
          <Select id="optOutReason" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="OPT_OUT">Pediu para não ser contatado</option>
            <option value="COMPLAINT">Reclamação</option>
            <option value="INVALID_CONTACT">Contato inválido</option>
            <option value="INTERNAL_DECISION">Decisão interna</option>
          </Select>
        </Field>
        <Field label="Observação (sem dados sensíveis)" htmlFor="optOutNotes">
          <Input id="optOutNotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Button
            variant="destructive"
            onClick={async () => {
              const ok = await run(
                () =>
                  api(`/leads/${leadId}/opt-out`, {
                    method: 'POST',
                    body: { scope, reason, notes: notes || null },
                  }),
                'Opt-out registrado.',
              );
              if (ok) setOpen(false);
            }}
          >
            Registrar opt-out
          </Button>
        </div>
      </div>
    </ActionDialog>
  );
}

const CHANNELS = [
  ['ALL', 'Todos os canais'],
  ['WHATSAPP', 'WhatsApp'],
  ['PHONE', 'Ligação'],
  ['EMAIL', 'E-mail'],
  ['INSTAGRAM', 'Instagram'],
] as const;

/** Base legal e opt-in por canal (ADMIN/GESTOR). */
export function PermissionDialog({
  leadId,
  current,
  run,
}: {
  leadId: string;
  current: { channel: string; legalBasis: string }[];
  run: Run;
}) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState('ALL');
  const [legalBasis, setLegalBasis] = useState(
    current.find((p) => p.channel === 'ALL')?.legalBasis ?? 'LEGITIMATE_INTEREST',
  );
  const [optIn, setOptIn] = useState(false);
  const [optInMethod, setOptInMethod] = useState('FORM');
  const [evidence, setEvidence] = useState('');
  return (
    <ActionDialog
      open={open}
      onOpenChange={setOpen}
      title="Base legal e opt-in"
      description="Base legal (LGPD) e opt-in de plataforma (ex.: Meta) são exigências diferentes. Consentimento e opt-in exigem evidência."
      trigger={
        <Button variant="outline" size="sm">
          Alterar
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Canal" htmlFor="permChannel">
          <Select id="permChannel" value={channel} onChange={(e) => setChannel(e.target.value)}>
            {CHANNELS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Base legal" htmlFor="permBasis">
          <Select id="permBasis" value={legalBasis} onChange={(e) => setLegalBasis(e.target.value)}>
            {Object.entries(LEGAL_BASIS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        {channel !== 'ALL' ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />
            Opt-in de plataforma registrado
          </label>
        ) : null}
        {optIn && channel !== 'ALL' ? (
          <Field label="Como o opt-in foi obtido" htmlFor="permMethod">
            <Select
              id="permMethod"
              value={optInMethod}
              onChange={(e) => setOptInMethod(e.target.value)}
            >
              <option value="INBOUND_MESSAGE">O lead escreveu primeiro</option>
              <option value="FORM">Formulário</option>
              <option value="EVENT">Evento</option>
              <option value="EXISTING_RELATIONSHIP">Relacionamento existente</option>
              <option value="VERBAL_RECORDED">Verbal, registrado</option>
              <option value="CLICK_TO_WHATSAPP">Anúncio "clique para WhatsApp"</option>
            </Select>
          </Field>
        ) : null}
        <Field label="Evidência" htmlFor="permEvidence" hint="Link, data e descrição do documento.">
          <Textarea
            id="permEvidence"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
          />
        </Field>
        <div className="flex justify-end">
          <Button
            onClick={async () => {
              const ok = await run(
                () =>
                  api(`/leads/${leadId}/permissions/${channel}`, {
                    method: 'PUT',
                    body: {
                      legalBasis,
                      ...(channel !== 'ALL' ? { optInStatus: optIn ? 'GRANTED' : 'NONE' } : {}),
                      ...(optIn && channel !== 'ALL' ? { optInMethod } : {}),
                      evidence: evidence || null,
                    },
                  }),
                'Base legal atualizada.',
              );
              if (ok) setOpen(false);
            }}
          >
            Salvar
          </Button>
        </div>
      </div>
    </ActionDialog>
  );
}

/** Anonimização (ADMIN): irreversível, com motivo. */
export function AnonymizeDialog({
  leadId,
  codeLabel,
  run,
}: {
  leadId: string;
  codeLabel: string;
  run: Run;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  return (
    <ActionDialog
      open={open}
      onOpenChange={setOpen}
      title="Anonimizar lead"
      description="Remove nome, CNPJ, endereço, pessoas, contatos e observações. Os contatos ficam na Lista Não Contatar. Não pode ser desfeito."
      trigger={
        <Button variant="ghost" className="text-destructive">
          Anonimizar
        </Button>
      }
    >
      <div className="space-y-4">
        <Alert variant="error">Esta ação é irreversível.</Alert>
        <Field
          label="Motivo"
          htmlFor="anonReason"
          hint="Ex.: solicitação do titular recebida por e-mail em 10/10."
        >
          <Textarea id="anonReason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label={`Digite ${codeLabel} para confirmar`} htmlFor="anonConfirm">
          <Input id="anonConfirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Button
            variant="destructive"
            disabled={confirm.trim() !== codeLabel || reason.trim().length < 10}
            onClick={async () => {
              const ok = await run(
                () => api(`/leads/${leadId}/anonymize`, { method: 'POST', body: { reason } }),
                'Lead anonimizado.',
              );
              if (ok) setOpen(false);
            }}
          >
            Anonimizar definitivamente
          </Button>
        </div>
      </div>
    </ActionDialog>
  );
}
