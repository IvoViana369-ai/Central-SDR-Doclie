'use client';

import type { Permission } from '@docline/core';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CURRENT_PHASE, visibleNavigation } from '@/lib/navigation';
import { cn } from '@/lib/utils';

export function SidebarNav({
  permissions,
  onNavigate,
}: {
  permissions: Permission[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const groups = visibleNavigation(permissions);
  // Só o item mais específico fica ativo (ex.: /equipe/distribuicao não acende Equipe).
  const activeHref = groups
    .flatMap((g) => g.items.map((i) => i.href))
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <nav aria-label="Menu principal" className="space-y-5">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-wider text-sidebar-muted">
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = item.href === activeHref;
              const soon = item.phase > CURRENT_PHASE;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                      active
                        ? 'bg-sidebar-active font-medium text-sidebar-foreground'
                        : soon
                          ? 'text-sidebar-foreground/55 hover:bg-sidebar-active/60 hover:text-sidebar-foreground/80'
                          : 'text-sidebar-foreground/80 hover:bg-sidebar-active/60 hover:text-sidebar-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="flex-1 truncate">{item.label}</span>
                    {soon ? (
                      <span
                        className="whitespace-nowrap text-[10px] text-sidebar-muted"
                        title={`Disponível na Fase ${item.phase} do roadmap`}
                      >
                        Fase {item.phase}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
