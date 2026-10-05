'use client';

import { LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api-client';
import { authClient, authErrorMessage } from '@/lib/auth-client';
import { NewPasswordFields, validateNewPassword } from './new-password-fields';

export function AcceptInvitationForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const problem = validateNewPassword(password, String(form.get('confirmation') ?? ''));
    if (problem) {
      setError(problem);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { email } = await api<{ email: string }>('/invitations/accept', {
        method: 'POST',
        body: { token, password },
      });
      const { error: signInError } = await authClient.signIn.email({ email, password });
      if (signInError) {
        setError(
          `Senha definida, mas não foi possível entrar automaticamente: ${authErrorMessage(signInError)}`,
        );
        setLoading(false);
        return;
      }
      router.replace('/dashboard');
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Não foi possível concluir. Tente novamente.',
      );
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <Alert variant="error">{error}</Alert> : null}
      <NewPasswordFields />
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <LoaderCircle className="animate-spin" /> : null}
        Definir senha e entrar
      </Button>
    </form>
  );
}
