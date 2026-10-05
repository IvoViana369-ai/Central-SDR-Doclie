'use client';

import type { Permission } from '@docline/core';
import { Menu, X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { Brand } from './brand';
import { SidebarNav } from './sidebar-nav';
import { UserMenu } from './user-menu';

interface AppShellProps {
  user: { name: string; roleLabel: string };
  permissions: Permission[];
  children: ReactNode;
}

function SidebarBody({
  user,
  permissions,
  onNavigate,
}: Omit<AppShellProps, 'children'> & { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6 bg-sidebar px-3 py-5 text-sidebar-foreground">
      <Brand className="px-2" />
      <div className="flex-1 overflow-y-auto">
        <SidebarNav permissions={permissions} onNavigate={onNavigate} />
      </div>
      <UserMenu name={user.name} roleLabel={user.roleLabel} />
    </div>
  );
}

/** Layout autenticado: menu lateral fixo no desktop, gaveta no celular. */
export function AppShell({ user, permissions, children }: AppShellProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15.5rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh lg:block">
        <SidebarBody user={user} permissions={permissions} />
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
            <SidebarBody user={user} permissions={permissions} onNavigate={() => setOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <main id="conteudo" className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
