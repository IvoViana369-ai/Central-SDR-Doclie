import { permissionsOf, ROLE_LABELS } from '@docline/core';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { getSessionUser } from '@/server/session';

/** Área autenticada: sessão validada no servidor a cada requisição. */
export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <AppShell
      user={{ name: user.name, roleLabel: ROLE_LABELS[user.actor.role] }}
      permissions={permissionsOf(user.actor.role)}
    >
      {children}
    </AppShell>
  );
}
