import type { Metadata } from 'next';
import { AcceptInvitationForm } from '@/components/auth/accept-invitation-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Ativar acesso', referrer: 'no-referrer' };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bem-vindo ao Docline SDR</CardTitle>
        <CardDescription>
          Defina sua senha para ativar o acesso. O link do convite vale uma única vez.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AcceptInvitationForm token={token} />
      </CardContent>
    </Card>
  );
}
