'use client';

import type { Permission, TwoFactorGate } from '@docline/core';
import { Menu, ShieldAlert, X } from 'lucide-react';
import Link from 'next/link';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { Brand } from './brand';
import { NotificationsBell } from './notifications-bell';
import { SidebarNav } from './sidebar-nav';
import { UserMenu } from './user-menu';

interface AppShellProps {
  user: { name: string; roleLabel: string };
  permissions: Permission[];
  /**
   * ADMIN/GESTOR sem verificação em duas etapas: `pending` mostra o lembrete;
   * `blocked` restringe a "Minha conta" (menu e avisos ficam ocultos).
   */
  twoFactor?: TwoFactorGate;
  children: ReactNode;
}

function SidebarBody({
  user,
  permissions,
  restricted,
  onNavigate,
}: Omit<AppShellProps, 'children' | 'twoFactor'> & {
  restricted: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-6 bg-sidebar px-3 py-5 text-sidebar-foreground">
      <Brand className="px-2" />
      <div className="flex-1 overflow-y-auto">
        {restricted ? (
          <p className="px-2 text-sm text-sidebar-foreground/80">
            O menu é liberado depois de ativar a verificação em duas etapas.
          </p>
        ) : (
          <SidebarNav permissions={permissions} onNavigate={onNavigate} />
        )}
      </div>
      <UserMenu name={user.name} roleLabel={user.roleLabel} />
    </div>
  );
}

/** Layout autenticado: menu lateral fixo no desktop, gaveta no celular. */
export function AppShell({ user, permissions, twoFactor = 'ok', children }: AppShellProps) {
  const [open, setOpen] = useState(false);
  const restricted = twoFactor === 'blocked';

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15.5rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh lg:block">
        <SidebarBody user={user} permissions={permissions} restricted={restricted} />
      </aside>

      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur lg:hidden">
          <DialogPrimitive.Trigger
            className="rounded-md p-2 hover:bg-muted"
            aria-label="Abrir menu"
          >
            <Menu className="size-5" />
          </DialogPrimitive.Trigger>
          <Brand subtitle={false} />
        </header>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50 lg:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] shadow-xl lg:hidden">
            <DialogPrimitive.Title className="sr-only">Menu</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Navegação principal
            </DialogPrimitive.Description>
            <DialogPrimitive.Close
              className="absolute right-3 top-5 z-10 rounded-md p-1.5 text-sidebar-muted hover:text-sidebar-foreground"
              aria-label="Fechar menu"
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
            <SidebarBody
              user={user}
              permissions={permissions}
              restricted={restricted}
              onNavigate={() => setOpen(false)}
            />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <main id="conteudo" className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl">
          <div className="-mt-2 mb-2 flex justify-end lg:-mt-4">
            {restricted ? null : <NotificationsBell />}
          </div>
          {twoFactor === 'pending' ? (
            <p
              role="status"
              className="mb-6 flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
            >
              <ShieldAlert className="size-4 shrink-0" aria-hidden />
              <span className="flex-1">
                Proteja sua conta: ative a verificação em duas etapas. Ela é exigida para
                administradores e gestores.
              </span>
              <Link href="/conta" className="font-medium text-primary hover:underline">
                Ativar agora
              </Link>
            </p>
          ) : null}
          {restricted ? (
            <p
              role="status"
              className="mb-6 flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
            >
              <ShieldAlert className="size-4 shrink-0" aria-hidden />
              <span className="flex-1">
                Acesso restrito: administradores e gestores precisam ativar a verificação em duas
                etapas. Ative abaixo para liberar o sistema.
              </span>
            </p>
          ) : null}
          {children}
        </div>
      </main>
    </div>
  );
}
