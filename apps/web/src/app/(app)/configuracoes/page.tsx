import { roleHasPermission } from '@docline/core';
import { History, Settings2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AccessDenied } from '@/components/access-denied';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'Configurações' };

const UPCOMING = [
  { title: 'Etapas do pipeline', phase: 4 },
  { title: 'Lead scoring (pesos e faixas)', phase: 4 },
  { title: 'Cadências e horários de contato', phase: 5 },
  { title: 'Lista Não Contatar e palavras de opt-out', phase: 2 },
];

export default async function SettingsPage() {
  const { user } = await getPageContext();
  if (!roleHasPermission(user.actor.role, 'audit.read')) return <AccessDenied />;

  return (
    <>
      <PageHeader title="Configurações" description="Administração do sistema." />
      <div className="grid gap-4 md:grid-cols-2">
        <Link href="/configuracoes/auditoria" className="rounded-xl outline-offset-4">
          <Card className="h-full transition-colors hover:bg-muted/50">
            <CardHeader>
              <History className="mb-1 size-5 text-primary" aria-hidden />
              <CardTitle>Auditoria</CardTitle>
              <CardDescription>
                Logins, convites, mudanças de perfil e acessos negados.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        {UPCOMING.map((item) => (
          <Card key={item.title} className="opacity-70">
            <CardHeader>
              <Settings2 className="mb-1 size-5 text-muted-foreground" aria-hidden />
              <CardTitle>{item.title}</CardTitle>
              <CardDescription>
                <Badge variant="muted">Fase {item.phase}</Badge>
              </CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </>
  );
}
