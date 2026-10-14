import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Esqueci minha senha' };

export default function ForgotPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Esqueci minha senha</CardTitle>
        <CardDescription>Informe seu e-mail para receber um link de redefinição.</CardDescription>
      </CardHeader>
      <CardContent>
        <ForgotPasswordForm />
      </CardContent>
    </Card>
  );
}
