import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TwoFactorForm } from '@/components/auth/two-factor-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Verificação em duas etapas' };

export default function TwoFactorPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Verificação em duas etapas</CardTitle>
        <CardDescription>
          Digite o código de 6 dígitos do aplicativo autenticador (Google Authenticator, Microsoft
          Authenticator, 1Password…).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense>
          <TwoFactorForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
