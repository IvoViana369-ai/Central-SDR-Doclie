import { roleHasPermission } from '@docline/core';
import { Gauge, History, MapPin, Settings2, SquareKanban, type LucideIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AccessDenied } from '@/components/access-denied';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'Configurações' };

const SECTIONS: { href: string; title: string; description: string; Icon: LucideIcon }[] = [
  {
    href: '/configuracoes/auditoria',
    title: 'Auditoria',
    description: 'Logins, convites, mudanças de perfil e acessos negados.',
    Icon: History,
  },
  {
    href: '/configuracoes/pipeline',
    title: 'Etapas do pipeline',
    description: 'Nomes, cores, ordem, SLA e etapas novas.',
    Icon: SquareKanban,
  },
  {
    href: '/configuracoes/score',
    title: 'Lead scoring',
    description: 'Pesos, faixas, simulação e versões do modelo.',
    Icon: Gauge,
  },
  {
    href: '/configuracoes/cidades-prioritarias',
    title: 'Cidades prioritárias',
    description: 'Cidades que pontuam no score.',
    Icon: MapPin,
  },
];

const UPCOMING = [
  { title: 'Cadências e horários de contato', phase: 5 },
  { title: 'Palavras de opt-out nas respostas', phase: 5 },
];

export default async function SettingsPage() {
  const { user } = await getPageContext();
  if (!roleHasPermission(user.actor.role, 'audit.read')) return <AccessDenied />;

  return (
    <>
      <PageHeader title="Configurações" description="Administração do sistema." />
      <div className="grid gap-4 md:grid-cols-2">
        {SECTIONS.map(({ href, title, description, Icon }) => (
          <Link key={href} href={href} className="rounded-xl outline-offset-4">
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardHeader>
                <Icon className="mb-1 size-5 text-primary" aria-hidden />
                <CardTitle>{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
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
