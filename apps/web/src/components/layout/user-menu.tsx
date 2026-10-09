'use client';

import { LogOut, Monitor, Moon, Sun } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { initials } from '@/lib/utils';

const THEMES = [
  { value: 'light', label: 'Tema claro', Icon: Sun },
  { value: 'dark', label: 'Tema escuro', Icon: Moon },
  { value: 'system', label: 'Tema do sistema', Icon: Monitor },
] as const;

export function UserMenu({ name, roleLabel }: { name: string; roleLabel: string }) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [signingOut, setSigningOut] = useState(false);
  const current = THEMES.find((t) => t.value === theme) ?? THEMES[2];
  const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]!;

  async function signOut() {
    setSigningOut(true);
    await authClient.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3 border-t border-white/10 pt-4">
      <Link
        href="/conta"
        className="-m-1 flex min-w-0 flex-1 items-center gap-3 rounded-md p-1 hover:bg-sidebar-active"
        title="Minha conta"
        aria-label={`Minha conta (${name})`}
      >
        <span
          className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-active text-xs font-semibold"
          aria-hidden
        >
          {initials(name)}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className="block truncate text-xs text-sidebar-muted">{roleLabel}</span>
        </span>
      </Link>
      <button
        type="button"
        onClick={() => setTheme(next.value)}
        className="rounded-md p-2 text-sidebar-muted hover:bg-sidebar-active hover:text-sidebar-foreground"
        aria-label={`${current.label} (alternar para ${next.label.toLowerCase()})`}
        title={current.label}
      >
        <current.Icon className="size-4" />
      </button>
      <button
        type="button"
        onClick={signOut}
        disabled={signingOut}
        className="rounded-md p-2 text-sidebar-muted hover:bg-sidebar-active hover:text-sidebar-foreground disabled:opacity-50"
        aria-label="Sair"
        title="Sair"
      >
        <LogOut className="size-4" />
      </button>
    </div>
  );
}
