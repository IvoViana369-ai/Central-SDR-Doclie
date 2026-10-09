import { roleHasPermission } from '@docline/core';
import {
  Clock,
  Gauge,
  History,
  ListOrdered,
  MapPin,
  SquareKanban,
  type LucideIcon,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AccessDenied } from '@/components/access-denied';
import { PageHeader } from '@/components/page-header';
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
  {
    href: '/configuracoes/cadencias',
    title: 'Cadências',
    description: 'Passos de contato (D0, D2, D5…), canais e etapas de destino.',
    Icon: ListOrdered,
  },
  {
    href: '/configuracoes/contato',
    title: 'Regras de contato',
    description: 'Horário, limites, prazos da fila e palavras de opt-out.',
    Icon: Clock,
  },
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
      </div>
    </>
  );
}
