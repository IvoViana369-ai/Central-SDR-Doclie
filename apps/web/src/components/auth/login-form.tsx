'use client';

import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { authClient, authErrorMessage } from '@/lib/auth-client';
import { safeNextPath } from '@/lib/safe-redirect';
import { PasswordInput } from './password-input';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    setError(null);
    const { error: signInError } = await authClient.signIn.email({
      email: String(form.get('email') ?? '').trim(),
      password: String(form.get('password') ?? ''),
    });
    if (signInError) {
      setError(authErrorMessage(signInError));
      setLoading(false);
      return;
    }
    router.replace(safeNextPath(params.get('next')));
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {params.get('senha') === 'redefinida' ? (
        <Alert variant="success" title="Senha redefinida">
          Entre com a sua nova senha.
        </Alert>
      ) : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      <Field label="E-mail" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <Field label="Senha" htmlFor="password">
        <PasswordInput id="password" name="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <LoaderCircle className="animate-spin" /> : null}
        Entrar
      </Button>
      <p className="text-center text-sm">
        <Link href="/esqueci-senha" className="text-primary hover:underline">
          Esqueci minha senha
        </Link>
      </p>
    </form>
  );
}
