import { ROLE_LABELS, roleHasPermission } from '@docline/core';
import { ArrowRight, CircleCheck, Clock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'Dashboard' };

const NEXT_PHASES = [
  {
    phase: 2,
    title: 'CRM de leads',
    text: 'Cadastro de leads, contatos, filtros avançados, timeline e Lista Não Contatar.',
  },
  {
    phase: 3,
    title: 'Importação e deduplicação',
    text: 'Planilhas CSV/XLSX com prévia, normalização e revisão de duplicados.',
  },
  { phase: 4, title: 'Pipeline SDR', text: 'Kanban das etapas e lead scoring configurável.' },
  {
    phase: 5,
    title: 'Fila e follow-ups',
    text: 'Minha Fila, cadência D0/D2/D5/D10 e contato assistido.',
  },
  {
    phase: 6,
    title: 'IA de prospecção',
    text: 'Abordagens personalizadas com aprovação humana e dashboard completo.',
  },
];

export default async function DashboardPage() {
  const { user } = await getPageContext();
  const firstName = user.name.split(' ')[0];
  const role = user.actor.role;
  const available = [
    {
      label: 'Equipe: usuários, perfis e convites',
      href: '/equipe',
      show: roleHasPermission(role, 'user.read'),
    },
    {
      label: 'Auditoria de acessos e alterações',
      href: '/configuracoes/auditoria',
      show: roleHasPermission(role, 'audit.read'),
    },
    {
      label: 'Status das integrações',
      href: '/integracoes',
      show: roleHasPermission(role, 'integration.manage'),
    },
  ].filter((item) => item.show);

  return (
    <>
      <PageHeader
        title={`Olá, ${firstName}!`}
        description={`Você está conectado como ${ROLE_LABELS[role]}.`}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Disponível agora</CardTitle>
            <CardDescription>
              Fundação técnica (Fase 1): acesso seguro, perfis e auditoria.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {available.length > 0 ? (
              <ul className="space-y-2">
                {available.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="group flex items-center gap-2 rounded-md p-2 text-sm hover:bg-muted"
                    >
                      <CircleCheck className="size-4 text-success" aria-hidden />
                      <span className="flex-1">{item.label}</span>
                      <ArrowRight
                        className="size-4 opacity-0 transition-opacity group-hover:opacity-100"
                        aria-hidden
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Seu acesso está ativo. As telas de operação do SDR chegam nas próximas fases.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Próximas entregas</CardTitle>
            <CardDescription>Ordem do roadmap até o MVP.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {NEXT_PHASES.map((item) => (
                <li key={item.phase} className="flex gap-3 text-sm">
                  <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div>
                    <p className="font-medium">
                      {item.title} <Badge variant="muted">Fase {item.phase}</Badge>
                    </p>
                    <p className="text-muted-foreground">{item.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
