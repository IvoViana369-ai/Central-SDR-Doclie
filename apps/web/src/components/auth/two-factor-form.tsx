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

/** Segunda etapa do login: código do aplicativo ou, sem o celular, um código de recuperação. */
export function TwoFactorForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code') ?? '').trim();
    setLoading(true);
    setError(null);
    const { error: verifyError } = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, '') });
    if (verifyError) {
      setError(authErrorMessage(verifyError));
      setLoading(false);
      return;
    }
    router.replace(safeNextPath(params.get('next')));
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <Alert variant="error">{error}</Alert> : null}
      {useBackup ? (
        <Field
          label="Código de recuperação"
          htmlFor="code"
          hint="Um dos códigos guardados ao ativar a verificação. Cada código vale uma vez."
        >
          <Input id="code" name="code" autoComplete="off" required autoFocus key="backup" />
        </Field>
      ) : (
        <Field label="Código do aplicativo" htmlFor="code">
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={7}
            required
            autoFocus
            key="totp"
          />
        </Field>
      )}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <LoaderCircle className="animate-spin" /> : null}
        Verificar e entrar
      </Button>
      <div className="flex flex-col items-center gap-2 text-sm">
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={() => {
            setUseBackup((v) => !v);
            setError(null);
          }}
        >
          {useBackup
            ? 'Usar o código do aplicativo'
            : 'Estou sem o celular: usar código de recuperação'}
        </button>
        <Link href="/login" className="text-muted-foreground hover:underline">
          Voltar ao login
        </Link>
      </div>
    </form>
  );
}
