import { getCurrentUser, ROLE_LABELS, TWO_FACTOR_ROLES } from '@docline/core';
import type { Metadata } from 'next';
import { TwoFactorSettings } from '@/components/account/two-factor-settings';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/utils';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'Minha conta' };

export default async function AccountPage() {
  // Única página liberada para quem ainda precisa ativar a verificação.
  const { deps, user, meta } = await getPageContext({ allowWithoutTwoFactor: true });
  const me = await getCurrentUser(deps, user.actor, {}, meta);
  const required = TWO_FACTOR_ROLES.includes(me.role);

  return (
    <>
      <PageHeader title="Minha conta" description="Seus dados de acesso e a segurança do login." />
      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle>{me.name}</CardTitle>
            <CardDescription>{ROLE_LABELS[me.role]}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>{me.email}</p>
            <p className="text-muted-foreground">
              Último login: {me.lastLoginAt ? formatDateTime(me.lastLoginAt) : '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Verificação em duas etapas</CardTitle>
            <CardDescription>
              Além da senha, o login pede um código do aplicativo autenticador do seu celular.
              {required ? ' Exigida para administradores e gestores.' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TwoFactorSettings enabled={me.twoFactorEnabled} required={required} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
