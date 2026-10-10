'use client';

import { ROLE_LABELS, ROLES, type Role } from '@docline/core/roles';
import { LoaderCircle, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api-client';

export interface InviteOutcome {
  email: string;
  emailSent: boolean;
}

export function InviteDialog({ onInvited }: { onInvited: (outcome: InviteOutcome) => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await api<InviteOutcome>('/users', {
        method: 'POST',
        body: { name: form.get('name'), email: form.get('email'), role: form.get('role') as Role },
      });
      setOpen(false);
      onInvited(result);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.errors.length > 0 ? 'Revise os campos destacados.' : err.message);
        setFieldErrors(Object.fromEntries(err.errors.map((e) => [e.path, e.message])));
      } else {
        setError('Não foi possível enviar o convite.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        setError(null);
        setFieldErrors({});
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus /> Convidar usuário
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Convidar usuário"
        description="A pessoa recebe um e-mail para definir a senha. O link vale por 72 horas."
      >
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error ? <Alert variant="error">{error}</Alert> : null}
          <Field label="Nome completo" htmlFor="invite-name" error={fieldErrors.name}>
            <Input
              id="invite-name"
              name="name"
              required
              autoComplete="off"
              aria-invalid={Boolean(fieldErrors.name)}
            />
          </Field>
          <Field label="E-mail corporativo" htmlFor="invite-email" error={fieldErrors.email}>
            <Input
              id="invite-email"
              name="email"
              type="email"
              required
              autoComplete="off"
              aria-invalid={Boolean(fieldErrors.email)}
            />
          </Field>
          <Field
            label="Perfil"
            htmlFor="invite-role"
            hint="Define o que a pessoa pode ver e fazer."
          >
            <Select id="invite-role" name="role" defaultValue="SDR">
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? <LoaderCircle className="animate-spin" /> : null}
              Enviar convite
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
