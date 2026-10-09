'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { Popover } from 'radix-ui';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { cn, formatDateTime } from '@/lib/utils';

interface NotificationItem {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationsPage {
  unread: number;
  items: NotificationItem[];
}

/** Atualização dos avisos com a aba visível. */
const POLL_MS = 60_000;

/**
 * Avisos da pessoa (Fase 5): transferência recebida, aceite atrasado,
 * tarefas atrasadas, leads esquecidos. Abrir um aviso o marca como lido.
 */
export function NotificationsBell() {
  const [data, setData] = useState<NotificationsPage | null>(null);
  const [open, setOpen] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<NotificationsPage>('/notifications'));
    } catch (err) {
      // Sessão encerrada: para de consultar (a próxima navegação leva ao login).
      if (err instanceof ApiError && err.status === 401) setStopped(true);
    }
  }, []);

  useEffect(() => {
    if (stopped) return;
    const tick = () => {
      if (document.visibilityState === 'visible') void load();
    };
    tick();
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load, stopped]);

  async function markRead(ids?: string[]) {
    setError(null);
    try {
      await api('/notifications/read', { method: 'POST', body: ids ? { ids } : {} });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível marcar como lido.');
    }
    await load();
  }

  const unread = data?.unread ?? 0;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <Popover.Trigger
        className="relative rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={unread > 0 ? `Avisos (${unread} não lidos)` : 'Avisos'}
      >
        <Bell className="size-5" />
        {unread > 0 ? (
          <span
            className="absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white"
            aria-hidden
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[min(24rem,calc(100vw-2rem))] rounded-xl border bg-card p-2 shadow-lg"
          aria-label="Avisos"
        >
          <div className="flex items-center justify-between gap-2 px-2 py-1">
            <p className="text-sm font-medium">Avisos</p>
            {unread > 0 ? (
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => void markRead()}
              >
                Marcar todos como lidos
              </button>
            ) : null}
          </div>
          {error ? (
            <p className="px-2 pb-1 text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {!data || data.items.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              Nenhum aviso por enquanto.
            </p>
          ) : (
            <ul className="max-h-96 space-y-1 overflow-y-auto" aria-label="Lista de avisos">
              {data.items.map((n) => {
                const content = (
                  <>
                    <span className="flex items-start gap-2">
                      {!n.readAt ? (
                        <span
                          className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                          aria-label="Não lido"
                        />
                      ) : null}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{n.title}</span>
                        {n.body ? (
                          <span className="block text-xs text-muted-foreground">{n.body}</span>
                        ) : null}
                        <span className="block text-xs text-muted-foreground">
                          {formatDateTime(n.createdAt)}
                        </span>
                      </span>
                    </span>
                  </>
                );
                const itemClass = cn(
                  'block w-full rounded-md p-2 text-left hover:bg-muted',
                  n.readAt && 'opacity-70',
                );
                return (
                  <li key={n.id}>
                    {n.link ? (
                      <Link
                        href={n.link}
                        className={itemClass}
                        onClick={() => {
                          setOpen(false);
                          if (!n.readAt) void markRead([n.id]);
                        }}
                      >
                        {content}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className={itemClass}
                        onClick={() => (!n.readAt ? void markRead([n.id]) : undefined)}
                      >
                        {content}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
