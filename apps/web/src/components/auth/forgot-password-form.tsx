'use client';

import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
    setLoading(true);
    setError(null);
    const { error: requestError } = await authClient.requestPasswordReset({
      email,
      redirectTo: '/redefinir-senha',
    });
    setLoading(false);
    // Resposta igual exista ou não o e-mail (não revela quem tem acesso).
    if (requestError?.status === 429) {
      setError('Muitas solicitações. Aguarde alguns minutos.');
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <Alert variant="success" title="Verifique seu e-mail">
          Se houver uma conta ativa com esse endereço, enviamos um link para criar uma nova senha. O
          link vale por 30 minutos.
        </Alert>
        <Link href="/login" className="block text-center text-sm text-primary hover:underline">
          Voltar para o login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? <Alert variant="error">{error}</Alert> : null}
      <Field label="E-mail" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <LoaderCircle className="animate-spin" /> : null}
        Enviar link
      </Button>
      <Link href="/login" className="block text-center text-sm text-primary hover:underline">
        Voltar para o login
      </Link>
    </form>
  );
}
