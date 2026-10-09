import type { Permission } from '@docline/core';
import {
  Building2,
  ChartColumn,
  CopyCheck,
  LayoutDashboard,
  ListTodo,
  Megaphone,
  MessagesSquare,
  Plug,
  Radar,
  Settings,
  ShieldCheck,
  SquareKanban,
  Upload,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Fase do roadmap em que a tela fica disponível (docs/ROADMAP.md). */
  phase: number;
  /** Item oculto para quem não tem a permissão. */
  permission?: Permission;
  description: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Menu lateral (requisito §29), agrupado por uso. */
export const NAVIGATION: NavGroup[] = [
  {
    label: 'Operação',
    items: [
      {
        label: 'Dashboard',
        href: '/dashboard',
        icon: LayoutDashboard,
        phase: 1,
        description: 'Visão geral da prospecção.',
      },
      {
        label: 'Minha Fila',
        href: '/fila',
        icon: ListTodo,
        phase: 5,
        permission: 'lead.read',
        description: 'Contatos, follow-ups e respostas do dia, por prioridade.',
      },
      {
        label: 'Leads',
        href: '/leads',
        icon: Building2,
        phase: 2,
        permission: 'lead.read',
        description: 'Base de leads com filtros, timeline e histórico.',
      },
      {
        label: 'Pipeline',
        href: '/pipeline',
        icon: SquareKanban,
        phase: 4,
        permission: 'lead.read',
        description: 'Kanban das etapas do SDR.',
      },
    ],
  },
  {
    label: 'Prospecção',
    items: [
      {
        label: 'Campanhas',
        href: '/campanhas',
        icon: Megaphone,
        phase: 10,
        permission: 'lead.bulk',
        description: 'Campanhas com elegibilidade e limites de contato.',
      },
      {
        label: 'Prospecção',
        href: '/prospeccao',
        icon: Radar,
        phase: 9,
        permission: 'lead.import',
        description: 'Descoberta de escritórios em fontes autorizadas.',
      },
      {
        label: 'Importar',
        href: '/importar',
        icon: Upload,
        phase: 3,
        permission: 'lead.import',
        description: 'Importação de planilhas com prévia e deduplicação.',
      },
      {
        label: 'Duplicados',
        href: '/duplicados',
        icon: CopyCheck,
        phase: 3,
        permission: 'duplicate.decide',
        description: 'Revisão de possíveis duplicados.',
      },
      {
        label: 'Mensagens',
        href: '/mensagens',
        icon: MessagesSquare,
        phase: 5,
        permission: 'lead.read',
        description: 'Mensagens enviadas, pendentes e respostas.',
      },
    ],
  },
  {
    label: 'Gestão',
    items: [
      {
        label: 'Relatórios',
        href: '/relatorios',
        icon: ChartColumn,
        phase: 6,
        permission: 'report.read',
        description: 'Funil, conversão e desempenho, com exportação.',
      },
      {
        label: 'Equipe',
        href: '/equipe',
        icon: Users,
        phase: 1,
        permission: 'user.read',
        description: 'Usuários, perfis e convites.',
      },
      {
        label: 'Conformidade',
        href: '/conformidade',
        icon: ShieldCheck,
        phase: 2,
        permission: 'suppression.read',
        description: 'Lista Não Contatar, solicitações de titulares e bases legais.',
      },
      {
        label: 'Integrações',
        href: '/integracoes',
        icon: Plug,
        phase: 1,
        permission: 'integration.manage',
        description: 'Status das integrações externas.',
      },
      {
        label: 'Configurações',
        href: '/configuracoes',
        icon: Settings,
        phase: 1,
        permission: 'audit.read',
        description: 'Auditoria e configurações do sistema.',
      },
    ],
  },
];

/** Fase em desenvolvimento nesta versão. Itens de fases posteriores aparecem como "Em breve". */
export const CURRENT_PHASE = 6;

export function visibleNavigation(permissions: readonly Permission[]): NavGroup[] {
  const granted = new Set(permissions);
  return NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || granted.has(item.permission)),
  })).filter((group) => group.items.length > 0);
}

export function findNavItem(href: string): NavItem | undefined {
  return NAVIGATION.flatMap((g) => g.items).find((item) => item.href === href);
}
