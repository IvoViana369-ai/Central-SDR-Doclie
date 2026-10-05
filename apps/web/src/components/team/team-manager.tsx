'use client';

import {
  ROLE_LABELS,
  ROLES,
  USER_STATUS_LABELS,
  type Role,
  type UserStatus,
} from '@docline/core/roles';
import { MailCheck, UserCheck, UserX } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api, ApiError } from '@/lib/api-client';
import { cn, formatDateTime } from '@/lib/utils';
import { InviteDialog } from './invite-dialog';

export interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  lastLoginAt: Date | string | null;
}

type Notice = { variant: 'success' | 'error' | 'info'; text: string } | null;
const FILTERS: { value: UserStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'ACTIVE', label: 'Ativos' },
  { value: 'INVITED', label: 'Convidados' },
  { value: 'INACTIVE', label: 'Inativos' },
];
const STATUS_VARIANT = { ACTIVE: 'success', INVITED: 'warning', INACTIVE: 'muted' } as const;

export function TeamManager({
  users,
  currentUserId,
  canManage,
}: {
  users: TeamUser[];
  currentUserId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<UserStatus | 'ALL'>('ALL');
  const [notice, setNotice] = useState<Notice>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const visible = filter === 'ALL' ? users : users.filter((u) => u.status === filter);

  async function run(userId: string, action: () => Promise<unknown>, success: string) {
    setBusyId(userId);
    setNotice(null);
    try {
      await action();
      setNotice({ variant: 'success', text: success });
      router.refresh();
    } catch (err) {
      setNotice({
        variant: 'error',
        text: err instanceof ApiError ? err.message : 'Não foi possível concluir a operação.',
      });
    } finally {
      setBusyId(null);
    }
  }

  const changeRole = (user: TeamUser, role: Role) =>
    run(
      user.id,
      () => api(`/users/${user.id}`, { method: 'PATCH', body: { role } }),
      `Perfil de ${user.name} alterado para ${ROLE_LABELS[role]}.`,
    );

  const setStatus = (user: TeamUser, status: 'ACTIVE' | 'INACTIVE') => {
    if (
      status === 'INACTIVE' &&
      !window.confirm(`Desativar ${user.name}? As sessões abertas serão encerradas imediatamente.`)
    )
      return;
    return run(
      user.id,
      () => api(`/users/${user.id}`, { method: 'PATCH', body: { status } }),
      status === 'INACTIVE' ? `${user.name} foi desativado.` : `${user.name} foi reativado.`,
    );
  };

  const resend = (user: TeamUser) =>
    run(
      user.id,
      async () => {
        const result = await api<{ emailSent: boolean }>(`/users/${user.id}/resend-invitation`, {
          method: 'POST',
        });
        if (!result.emailSent)
          throw new ApiError(
            502,
            'EMAIL',
            'Convite renovado, mas o e-mail não foi enviado. Verifique o provedor de e-mail.',
          );
      },
      `Novo convite enviado para ${user.email}.`,
    );

  return (
    <>
      <PageHeader
        title="Equipe"
        description="Usuários com acesso ao Docline SDR. Novos usuários entram somente por convite."
        actions={
          canManage ? (
            <InviteDialog
              onInvited={(result) => {
                setNotice(
                  result.emailSent
                    ? { variant: 'success', text: `Convite enviado para ${result.email}.` }
                    : {
                        variant: 'error',
                        text: `Usuário criado, mas o e-mail para ${result.email} falhou. Use "Reenviar convite".`,
                      },
                );
                router.refresh();
              }}
            />
          ) : null
        }
      />
      {notice ? (
        <Alert variant={notice.variant} className="mb-4">
          {notice.text}
        </Alert>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="Filtrar por status">
        {FILTERS.map((item) => {
          const count =
            item.value === 'ALL'
              ? users.length
              : users.filter((u) => u.status === item.value).length;
          return (
            <button
              key={item.value}
              role="tab"
              aria-selected={filter === item.value}
              onClick={() => setFilter(item.value)}
              className={cn(
                'rounded-full px-3 py-1 text-sm transition-colors',
                filter === item.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {item.label} <span className="opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <Card>
        <Table>
          <THead>
            <Tr>
              <Th>Usuário</Th>
              <Th>Perfil</Th>
              <Th>Status</Th>
              <Th className="hidden md:table-cell">Último acesso</Th>
              {canManage ? <Th className="text-right">Ações</Th> : null}
            </Tr>
          </THead>
          <TBody>
            {visible.length === 0 ? (
              <Tr>
                <Td colSpan={5} className="py-10 text-center text-muted-foreground">
                  Nenhum usuário neste filtro.
                </Td>
              </Tr>
            ) : (
              visible.map((user) => {
                const self = user.id === currentUserId;
                const busy = busyId === user.id;
                return (
                  <Tr key={user.id}>
                    <Td>
                      <p className="font-medium">
                        {user.name} {self ? <Badge variant="muted">você</Badge> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                    </Td>
                    <Td>
                      {canManage && !self ? (
                        <Select
                          aria-label={`Perfil de ${user.name}`}
                          value={user.role}
                          disabled={busy}
                          onChange={(e) => changeRole(user, e.target.value as Role)}
                          className="h-8 w-36"
                        >
                          {ROLES.map((role) => (
                            <option key={role} value={role}>
                              {ROLE_LABELS[role]}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        ROLE_LABELS[user.role]
                      )}
                    </Td>
                    <Td>
                      <Badge variant={STATUS_VARIANT[user.status]}>
                        {USER_STATUS_LABELS[user.status]}
                      </Badge>
                    </Td>
                    <Td className="hidden text-muted-foreground md:table-cell">
                      {formatDateTime(user.lastLoginAt)}
                    </Td>
                    {canManage ? (
                      <Td className="text-right">
                        {self ? null : user.status === 'INVITED' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => resend(user)}
                          >
                            <MailCheck /> Reenviar convite
                          </Button>
                        ) : user.status === 'ACTIVE' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => setStatus(user, 'INACTIVE')}
                          >
                            <UserX /> Desativar
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => setStatus(user, 'ACTIVE')}
                          >
                            <UserCheck /> Reativar
                          </Button>
                        )}
                      </Td>
                    ) : null}
                  </Tr>
                );
              })
            )}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
