'use client';

import { Copy, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { PasswordInput } from '@/components/auth/password-input';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { authClient, authErrorMessage } from '@/lib/auth-client';
import { QrCode } from './qr-code';

type Step =
  | { kind: 'idle' }
  | { kind: 'password'; purpose: 'enable' | 'disable' | 'codes' }
  | { kind: 'scan'; totpURI: string; backupCodes: string[] }
  | { kind: 'codes'; backupCodes: string[]; justEnabled: boolean };

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP" (para digitar no aplicativo). */
function secretFrom(totpURI: string): string {
  const secret = new URL(totpURI).searchParams.get('secret') ?? '';
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

function BackupCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3">
      <ul
        className="grid grid-cols-2 gap-2 rounded-md bg-muted p-3 font-mono text-sm"
        aria-label="Códigos de recuperação"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={async () => {
          await navigator.clipboard.writeText(codes.join('\n'));
          setCopied(true);
        }}
      >
        <Copy /> {copied ? 'Copiados' : 'Copiar códigos'}
      </Button>
    </div>
  );
}

/**
 * Verificação em duas etapas (TOTP) da própria conta (docs/SECURITY.md §3):
 * ativar com a senha, ler o QR no aplicativo, confirmar com um código e
 * guardar os códigos de recuperação.
 */
export function TwoFactorSettings({ enabled, required }: { enabled: boolean; required: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  function onPassword(event: FormEvent<HTMLFormElement>, purpose: 'enable' | 'disable' | 'codes') {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    void run(async () => {
      if (purpose === 'enable') {
        const { data, error: e } = await authClient.twoFactor.enable({ password });
        if (e || !data || !('totpURI' in data)) return setError(authErrorMessage(e));
        setStep({ kind: 'scan', totpURI: data.totpURI, backupCodes: data.backupCodes });
      } else if (purpose === 'disable') {
        const { error: e } = await authClient.twoFactor.disable({ password });
        if (e) return setError(authErrorMessage(e));
        setStep({ kind: 'idle' });
        router.refresh();
      } else {
        const { data, error: e } = await authClient.twoFactor.generateBackupCodes({ password });
        if (e || !data) return setError(authErrorMessage(e));
        setStep({ kind: 'codes', backupCodes: data.backupCodes, justEnabled: false });
      }
    });
  }

  function onConfirm(event: FormEvent<HTMLFormElement>, backupCodes: string[]) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code') ?? '').replace(/\s/g, '');
    void run(async () => {
      const { error: e } = await authClient.twoFactor.verifyTotp({ code });
      if (e) return setError(authErrorMessage(e));
      setStep({ kind: 'codes', backupCodes, justEnabled: true });
      router.refresh();
    });
  }

  const passwordLabels = {
    enable: 'Continuar',
    disable: 'Desativar a verificação',
    codes: 'Gerar novos códigos',
  } as const;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="size-5 text-muted-foreground" aria-hidden />
        <span className="font-medium">Situação:</span>
        {enabled ? (
          <Badge variant="success">Ativada</Badge>
        ) : (
          <Badge variant={required ? 'warning' : 'muted'}>Desativada</Badge>
        )}
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}

      {step.kind === 'idle' ? (
        <div className="flex flex-wrap gap-2">
          {enabled ? (
            <>
              <Button
                variant="outline"
                onClick={() => setStep({ kind: 'password', purpose: 'codes' })}
              >
                Gerar novos códigos de recuperação
              </Button>
              <Button
                variant="outline"
                onClick={() => setStep({ kind: 'password', purpose: 'disable' })}
              >
                Desativar
              </Button>
            </>
          ) : (
            <Button onClick={() => setStep({ kind: 'password', purpose: 'enable' })}>
              Ativar verificação em duas etapas
            </Button>
          )}
        </div>
      ) : null}

      {step.kind === 'password' ? (
        <form
          className="max-w-sm space-y-3"
          onSubmit={(e) => onPassword(e, step.purpose)}
          noValidate
        >
          {step.purpose === 'disable' && required ? (
            <Alert variant="info">
              Para o seu perfil a verificação em duas etapas é recomendada (e será obrigatória antes
              do envio automático de mensagens).
            </Alert>
          ) : null}
          <Field label="Confirme sua senha" htmlFor="twoFactorPassword">
            <PasswordInput
              id="twoFactorPassword"
              name="password"
              autoComplete="current-password"
              required
              autoFocus
            />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {passwordLabels[step.purpose]}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setStep({ kind: 'idle' })}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : null}

      {step.kind === 'scan' ? (
        <div className="space-y-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Abra o aplicativo autenticador no celular e adicione uma conta.</li>
            <li>Leia o QR code abaixo (ou digite a chave).</li>
            <li>Digite o código de 6 dígitos que aparecer no aplicativo.</li>
          </ol>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <QrCode value={step.totpURI} label="QR code para o aplicativo autenticador" />
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">Chave para digitar:</p>
              <p className="break-all font-mono" data-testid="totp-secret">
                {secretFrom(step.totpURI)}
              </p>
            </div>
          </div>
          <form
            className="max-w-sm space-y-3"
            onSubmit={(e) => onConfirm(e, step.backupCodes)}
            noValidate
          >
            <Field label="Código do aplicativo" htmlFor="twoFactorCode">
              <Input
                id="twoFactorCode"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                required
              />
            </Field>
            <Button type="submit" disabled={busy}>
              Confirmar e ativar
            </Button>
          </form>
        </div>
      ) : null}

      {step.kind === 'codes' ? (
        <div className="space-y-3">
          <Alert variant="success">
            {step.justEnabled
              ? 'Verificação em duas etapas ativada. A partir do próximo login, o código do aplicativo será pedido.'
              : 'Novos códigos gerados. Os anteriores deixaram de valer.'}
          </Alert>
          <p className="text-sm">
            Guarde estes <strong>códigos de recuperação</strong> em local seguro (ex.: gerenciador
            de senhas). Cada um vale uma vez e serve para entrar se você perder o celular. Eles não
            serão mostrados de novo.
          </p>
          <BackupCodes codes={step.backupCodes} />
          <Button onClick={() => setStep({ kind: 'idle' })}>Concluir</Button>
        </div>
      ) : null}
    </div>
  );
}
