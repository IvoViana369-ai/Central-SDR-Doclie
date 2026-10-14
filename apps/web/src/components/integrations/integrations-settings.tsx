'use client';

import { API_SCOPES, type ApiScope } from '@docline/core/api-scopes';
import {
  KNOWN_SYSTEMS,
  WEBHOOK_EVENTS,
  type WebhookEventType,
} from '@docline/core/integrations-domain';
import { Copy, KeyRound, RefreshCw, Send, Webhook } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAction } from '@/components/leads/use-action';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';

type Date_ = string | Date;

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  systemLabel: string | null;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  rateLimitPerMinute: number;
  expiresAt: Date_ | null;
  lastUsedAt: Date_ | null;
  createdAt: Date_;
  createdByName: string | null;
  revokedAt: Date_ | null;
  revokeReason: string | null;
}

export interface EndpointRow {
  id: string;
  name: string;
  url: string;
  systemLabel: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'DISABLED';
  eventLabels: string[];
  consecutiveFailures: number;
  lastSuccessAt: Date_ | null;
  lastFailureAt: Date_ | null;
  disabledReason: string | null;
  pendingDeliveries: number;
  failedLastWeek: number;
}

export interface DeliveryRow {
  id: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  attempts: number;
  nextAttemptAt: Date_;
  lastAttemptAt: Date_ | null;
  lastStatusCode: number | null;
  lastError: string | null;
  manual: boolean;
  createdAt: Date_;
  eventLabel: string;
  endpoint: { id: string; name: string };
}

const KEY_STATUS = {
  ACTIVE: { label: 'Ativa', variant: 'success' },
  EXPIRED: { label: 'Vencida', variant: 'muted' },
  REVOKED: { label: 'Revogada', variant: 'destructive' },
} as const;

const ENDPOINT_STATUS = {
  ACTIVE: { label: 'Ativo', variant: 'success' },
  PAUSED: { label: 'Pausado', variant: 'warning' },
  DISABLED: { label: 'Desligado por falhas', variant: 'destructive' },
} as const;

const DELIVERY_STATUS = {
  PENDING: { label: 'Na fila', variant: 'warning' },
  SUCCEEDED: { label: 'Entregue', variant: 'success' },
  FAILED: { label: 'Falhou', variant: 'destructive' },
  CANCELLED: { label: 'Cancelada', variant: 'muted' },
} as const;

const SCOPE_KEYS = Object.keys(API_SCOPES) as ApiScope[];
const EVENT_KEYS = Object.keys(WEBHOOK_EVENTS) as WebhookEventType[];

/** Segredo mostrado uma única vez, com botão de copiar. */
function OneTimeSecret({ title, value }: { title: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Alert variant="success" title={title}>
      <p>Copie agora e guarde no cofre do outro sistema: este valor não aparece de novo.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code
          className="break-all rounded bg-muted px-2 py-1 font-mono text-xs"
          data-testid="secret"
        >
          {value}
        </code>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void navigator.clipboard?.writeText(value).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          <Copy /> {copied ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
    </Alert>
  );
}

function SystemSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange(v: string): void;
}) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Nenhum</option>
      {Object.entries(KNOWN_SYSTEMS).map(([code, label]) => (
        <option key={code} value={code}>
          {label}
        </option>
      ))}
    </Select>
  );
}

function ApiKeys({ keys }: { keys: ApiKeyRow[] }) {
  const { run, notice, busy } = useAction();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>([]);
  const [system, setSystem] = useState('');
  const [limit, setLimit] = useState('120');
  const [expires, setExpires] = useState('');
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);

  const create = async () => {
    const result = await run(
      () =>
        api<{ key: string; apiKey: { name: string } }>('/integrations/api-keys', {
          method: 'POST',
          body: {
            name,
            scopes,
            system: system || null,
            rateLimitPerMinute: Number(limit) || undefined,
            // Fim do dia escolhido, no fuso da equipe (Fortaleza, UTC−3).
            expiresAt: expires ? `${expires}T23:59:59-03:00` : null,
          },
        }),
      'Chave criada.',
    );
    if (result) {
      setCreated({ name: result.apiKey.name, key: result.key });
      setName('');
      setScopes([]);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" aria-hidden /> Chaves de API
        </CardTitle>
        <CardDescription>
          Para o CRM, o n8n e o BI usarem a API com <code>Authorization: Bearer</code>. Cada chave
          só faz o que os escopos liberam; nenhuma mexe em usuários, configurações ou outras chaves.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}
        {created ? <OneTimeSecret title={`Chave “${created.name}”`} value={created.key} /> : null}

        <form
          className="space-y-3 rounded-lg border p-3"
          aria-label="Nova chave de API"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Nome da chave" htmlFor="apiKeyName" hint="Ex.: CRM Docline (produção)">
              <Input id="apiKeyName" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field
              label="Sistema"
              htmlFor="apiKeySystem"
              hint="Referências externas gravadas por ela"
            >
              <SystemSelect id="apiKeySystem" value={system} onChange={setSystem} />
            </Field>
            <Field label="Limite por minuto" htmlFor="apiKeyLimit">
              <Input
                id="apiKeyLimit"
                type="number"
                min={1}
                max={6000}
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
            </Field>
            <Field label="Válida até (opcional)" htmlFor="apiKeyExpires">
              <Input
                id="apiKeyExpires"
                type="date"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
              />
            </Field>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Escopos</legend>
            {SCOPE_KEYS.map((scope) => (
              <label key={scope} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={scopes.includes(scope)}
                  onChange={(e) =>
                    setScopes((current) =>
                      e.target.checked ? [...current, scope] : current.filter((s) => s !== scope),
                    )
                  }
                />
                <span>
                  {API_SCOPES[scope].label} <code className="text-xs">{scope}</code>
                  <span className="block text-xs text-muted-foreground">
                    {API_SCOPES[scope].description}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <Button type="submit" disabled={busy}>
            Criar chave
          </Button>
        </form>

        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma chave criada.</p>
        ) : (
          <Table aria-label="Chaves de API">
            <THead>
              <Tr>
                <Th>Nome</Th>
                <Th>Prefixo</Th>
                <Th>Escopos</Th>
                <Th>Situação</Th>
                <Th>Último uso</Th>
                <Th>Criada</Th>
                <Th>
                  <span className="sr-only">Ações</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {keys.map((key) => (
                <Tr key={key.id}>
                  <Td>
                    {key.name}
                    {key.systemLabel ? (
                      <span className="block text-xs text-muted-foreground">{key.systemLabel}</span>
                    ) : null}
                  </Td>
                  <Td>
                    <code className="text-xs">{key.prefix}…</code>
                  </Td>
                  <Td className="text-xs">{key.scopes.join(', ')}</Td>
                  <Td>
                    <Badge variant={KEY_STATUS[key.status].variant}>
                      {KEY_STATUS[key.status].label}
                    </Badge>
                    {key.revokeReason ? (
                      <span className="block text-xs text-muted-foreground">
                        {key.revokeReason}
                      </span>
                    ) : null}
                  </Td>
                  <Td>{formatDateTime(key.lastUsedAt)}</Td>
                  <Td>
                    {formatDateTime(key.createdAt)}
                    {key.createdByName ? (
                      <span className="block text-xs text-muted-foreground">
                        por {key.createdByName}
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    {key.status !== 'REVOKED' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        aria-label={`Revogar ${key.name}`}
                        onClick={() => {
                          const reason = window.prompt('Motivo da revogação:');
                          if (!reason) return;
                          void run(
                            () =>
                              api(`/integrations/api-keys/${key.id}/revoke`, {
                                method: 'POST',
                                body: { reason },
                              }),
                            `Chave “${key.name}” revogada.`,
                          );
                        }}
                      >
                        Revogar
                      </Button>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function Endpoints({ endpoints, enabled }: { endpoints: EndpointRow[]; enabled: boolean }) {
  const { run, notice, busy } = useAction();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEventType[]>([]);
  const [system, setSystem] = useState('');
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);

  const create = async () => {
    const result = await run(
      () =>
        api<{ secret: string; endpoint: { name: string } }>('/integrations/webhooks', {
          method: 'POST',
          body: { name, url, events, system: system || null },
        }),
      'Destino cadastrado.',
    );
    if (result) {
      setSecret({ title: `Segredo de “${result.endpoint.name}”`, value: result.secret });
      setName('');
      setUrl('');
      setEvents([]);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Webhook className="size-4" aria-hidden /> Webhooks de saída
        </CardTitle>
        <CardDescription>
          Avisos assinados (cabeçalho <code>Docline-Signature</code>) para o CRM e outros sistemas
          Docline. O corpo leva ids e códigos; o resto, o sistema busca pela API com chave. Falhas
          voltam a ser tentadas por cerca de 45 horas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!enabled ? (
          <Alert variant="info" title="Webhooks de saída desligados">
            Configure <code>OUTBOUND_WEBHOOK_SIGNING_SECRET</code> no ambiente (web e worker) para
            cadastrar destinos.
          </Alert>
        ) : null}
        {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}
        {secret ? <OneTimeSecret title={secret.title} value={secret.value} /> : null}

        {enabled ? (
          <form
            className="space-y-3 rounded-lg border p-3"
            aria-label="Novo destino de webhook"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Nome do destino" htmlFor="webhookName">
                <Input id="webhookName" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Sistema" htmlFor="webhookSystem">
                <SystemSelect id="webhookSystem" value={system} onChange={setSystem} />
              </Field>
            </div>
            <Field
              label="URL do destino"
              htmlFor="webhookUrl"
              hint="https:// e endereço público; redes internas são recusadas."
            >
              <Input
                id="webhookUrl"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </Field>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Eventos</legend>
              {EVENT_KEYS.map((type) => (
                <label key={type} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={events.includes(type)}
                    onChange={(e) =>
                      setEvents((current) =>
                        e.target.checked ? [...current, type] : current.filter((t) => t !== type),
                      )
                    }
                  />
                  <span>
                    {WEBHOOK_EVENTS[type].label} <code className="text-xs">{type}</code>
                    <span className="block text-xs text-muted-foreground">
                      {WEBHOOK_EVENTS[type].description}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            <Button type="submit" disabled={busy}>
              Cadastrar destino
            </Button>
          </form>
        ) : null}

        {endpoints.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum destino cadastrado.</p>
        ) : (
          <ul className="divide-y" aria-label="Destinos de webhook">
            {endpoints.map((endpoint) => (
              <li key={endpoint.id} className="space-y-1.5 py-3 first:pt-0">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{endpoint.name}</span>
                  <Badge variant={ENDPOINT_STATUS[endpoint.status].variant}>
                    {ENDPOINT_STATUS[endpoint.status].label}
                  </Badge>
                  {endpoint.systemLabel ? (
                    <Badge variant="muted">{endpoint.systemLabel}</Badge>
                  ) : null}
                </p>
                <p className="break-all text-xs text-muted-foreground">{endpoint.url}</p>
                <p className="text-xs">{endpoint.eventLabels.join(' · ')}</p>
                <p className="text-xs text-muted-foreground">
                  Na fila: {endpoint.pendingDeliveries} · Falhas na semana:{' '}
                  {endpoint.failedLastWeek} · Última entrega:{' '}
                  {formatDateTime(endpoint.lastSuccessAt)}
                </p>
                {endpoint.disabledReason ? (
                  <Alert variant="error">{endpoint.disabledReason}</Alert>
                ) : null}
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !enabled}
                    aria-label={`Enviar teste para ${endpoint.name}`}
                    onClick={() =>
                      run(
                        () =>
                          api(`/integrations/webhooks/${endpoint.id}/test`, {
                            method: 'POST',
                            body: {},
                          }),
                        'Teste na fila: o worker envia em instantes.',
                      )
                    }
                  >
                    <Send /> Enviar teste
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          api(`/integrations/webhooks/${endpoint.id}/status`, {
                            method: 'POST',
                            body: { status: endpoint.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' },
                          }),
                        endpoint.status === 'ACTIVE' ? 'Destino pausado.' : 'Destino reativado.',
                      )
                    }
                  >
                    {endpoint.status === 'ACTIVE' ? 'Pausar' : 'Reativar'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !enabled}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          'Gerar um novo segredo? O atual deixa de valer na hora; atualize o outro sistema.',
                        )
                      ) {
                        return;
                      }
                      const result = await run(
                        () =>
                          api<{ secret: string }>(
                            `/integrations/webhooks/${endpoint.id}/rotate-secret`,
                            { method: 'POST', body: {} },
                          ),
                        'Novo segredo gerado.',
                      );
                      if (result) {
                        setSecret({
                          title: `Novo segredo de “${endpoint.name}”`,
                          value: result.secret,
                        });
                      }
                    }}
                  >
                    <KeyRound /> Novo segredo
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Deliveries({ deliveries }: { deliveries: DeliveryRow[] }) {
  const router = useRouter();
  const { run, notice, busy } = useAction();
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle>Entregas recentes</CardTitle>
          <CardDescription>As últimas 30 tentativas, de todos os destinos.</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => router.refresh()}>
          <RefreshCw /> Atualizar
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}
        {deliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma entrega ainda.</p>
        ) : (
          <Table aria-label="Entregas de webhook">
            <THead>
              <Tr>
                <Th>Quando</Th>
                <Th>Evento</Th>
                <Th>Destino</Th>
                <Th>Situação</Th>
                <Th>Resposta</Th>
                <Th>
                  <span className="sr-only">Ações</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {deliveries.map((d) => (
                <Tr key={d.id}>
                  <Td>{formatDateTime(d.lastAttemptAt ?? d.createdAt)}</Td>
                  <Td>
                    {d.eventLabel}
                    {d.manual ? <Badge variant="muted">manual</Badge> : null}
                  </Td>
                  <Td>{d.endpoint.name}</Td>
                  <Td>
                    <Badge variant={DELIVERY_STATUS[d.status].variant}>
                      {DELIVERY_STATUS[d.status].label}
                    </Badge>
                    <span className="block text-xs text-muted-foreground">
                      {d.attempts} {d.attempts === 1 ? 'tentativa' : 'tentativas'}
                      {d.status === 'PENDING' && d.attempts > 0
                        ? ` · próxima ${formatDateTime(d.nextAttemptAt)}`
                        : ''}
                    </span>
                  </Td>
                  <Td className="max-w-xs text-xs">
                    {d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : null}
                    {d.lastError ? (
                      <span className="block text-destructive">{d.lastError}</span>
                    ) : null}
                  </Td>
                  <Td>
                    {d.status === 'FAILED' || d.status === 'SUCCEEDED' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () =>
                              api(`/integrations/webhook-deliveries/${d.id}/resend`, {
                                method: 'POST',
                                body: {},
                              }),
                            'Reenvio na fila.',
                          )
                        }
                      >
                        Reenviar
                      </Button>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/** Configurações → Integrações Docline (F12-01, F12-02). */
export function IntegrationsSettings(props: {
  keys: ApiKeyRow[];
  endpoints: EndpointRow[];
  webhooksEnabled: boolean;
  deliveries: DeliveryRow[];
}) {
  return (
    <div className="space-y-6">
      <ApiKeys keys={props.keys} />
      <Endpoints endpoints={props.endpoints} enabled={props.webhooksEnabled} />
      <Deliveries deliveries={props.deliveries} />
    </div>
  );
}
