'use client';

import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { authClient, authErrorMessage } from '@/lib/auth-client';
import { NewPasswordFields, validateNewPassword } from './new-password-fields';

export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');
  const [error, setError] = useState<string | null>(
    params.get('error') ? 'Link inválido ou expirado. Solicite uma nova redefinição.' : null,
  );
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <div className="space-y-4">
        <Alert variant="error">{error ?? 'Link de redefinição incompleto.'}</Alert>
        <Link
          href="/esqueci-senha"
          className="block text-center text-sm text-primary hover:underline"
        >
          Solicitar novo link
        </Link>
      </div>
    );
  }

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
    const { error: resetError } = await authClient.resetPassword({
      newPassword: password,
      token: token!,
    });
    if (resetError) {
      setError(authErrorMessage(resetError));
      setLoading(false);
      return;
    }
    router.replace('/login?senha=redefinida');
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <Alert variant="error">{error}</Alert> : null}
      <NewPasswordFields />
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <LoaderCircle className="animate-spin" /> : null}
        Salvar nova senha
      </Button>
    </form>
  );
}
