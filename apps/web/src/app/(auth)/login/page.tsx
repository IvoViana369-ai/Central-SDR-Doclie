import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/login-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Entrar' };

export default function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Entrar</CardTitle>
        <CardDescription>Use o e-mail e a senha do seu convite.</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense>
          <LoginForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
