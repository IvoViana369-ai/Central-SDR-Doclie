import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Redefinir senha' };

export default function ResetPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Criar nova senha</CardTitle>
        <CardDescription>
          Ao salvar, as sessões abertas em outros dispositivos são encerradas.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense>
          <ResetPasswordForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
