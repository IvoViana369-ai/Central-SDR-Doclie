'use client';

import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useAction } from '@/components/leads/use-action';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api-client';

export interface ApproachItem {
  id: string;
  key: string;
  name: string;
  description: string | null;
  hypothesis: string | null;
  guidance: string | null;
  active: boolean;
  _count: { messages: number; generations: number };
}

interface Draft {
  id: string | null;
  key: string;
  name: string;
  description: string;
  hypothesis: string;
  guidance: string;
  active: boolean;
}

const EMPTY: Draft = {
  id: null,
  key: '',
  name: '',
  description: '',
  hypothesis: '',
  guidance: '',
  active: true,
};

/**
 * Abordagens (docs/AI-SDR.md §11): hipóteses de mensagem que o SDR escolhe ao
 * gerar e que os relatórios comparam (resposta e conversão por abordagem).
 */
export function AiApproachesEditor({ items }: { items: ApproachItem[] }) {
  const { run, notice, busy } = useAction();
  const [editing, setEditing] = useState<Draft | null>(null);

  async function save() {
    if (!editing) return;
    const { id, key, ...rest } = editing;
    const body = {
      ...rest,
      description: rest.description || null,
      hypothesis: rest.hypothesis || null,
      guidance: rest.guidance || null,
    };
    const result = await run(
      () =>
        id
          ? api(`/approaches/${id}`, { method: 'PATCH', body })
          : api('/approaches', { method: 'POST', body: { ...body, key } }),
      'Abordagem salva.',
    );
    if (result) setEditing(null);
  }

  const text = (field: 'description' | 'hypothesis' | 'guidance', label: string, hint: string) =>
    editing ? (
      <Field label={label} htmlFor={`approach-${field}`} hint={hint}>
        <Textarea
          id={`approach-${field}`}
          rows={2}
          maxLength={field === 'guidance' ? 800 : 300}
          value={editing[field]}
          onChange={(e) => setEditing({ ...editing, [field]: e.target.value })}
        />
      </Field>
    ) : null;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>Abordagens</CardTitle>
          <CardDescription>
            Ângulos de mensagem para testar. A orientação vai para a IA junto com o pedido.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditing(EMPTY)}>
          <Plus /> Nova abordagem
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}
        {editing ? (
          <form
            className="space-y-3 rounded-md border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Chave" htmlFor="approachKey" hint="Ex.: COMISSAO_INDICACAO">
                <Input
                  id="approachKey"
                  value={editing.key}
                  disabled={Boolean(editing.id)}
                  maxLength={60}
                  onChange={(e) => setEditing({ ...editing, key: e.target.value })}
                />
              </Field>
              <Field label="Nome" htmlFor="approachName">
                <Input
                  id="approachName"
                  value={editing.name}
                  maxLength={80}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </Field>
            </div>
            {text('description', 'Descrição', 'Para a equipe saber quando usar.')}
            {text('hypothesis', 'Hipótese', 'O que se espera que aconteça (ex.: mais respostas).')}
            {text(
              'guidance',
              'Orientação para a IA',
              'Ex.: destaque o atendimento por vídeo. Só fatos da base de conhecimento.',
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editing.active}
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
              />
              Ativa
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                Salvar
              </Button>
            </div>
          </form>
        ) : null}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma abordagem cadastrada.</p>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 py-3">
                <div className="space-y-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {item.name}
                    <Badge variant="muted">{item.key}</Badge>
                    {item.active ? null : <Badge variant="warning">Inativa</Badge>}
                  </p>
                  {item.description ? <p className="text-sm">{item.description}</p> : null}
                  <p className="text-xs text-muted-foreground">
                    {item._count.generations} rascunhos · {item._count.messages} mensagens
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Editar ${item.name}`}
                  onClick={() =>
                    setEditing({
                      id: item.id,
                      key: item.key,
                      name: item.name,
                      description: item.description ?? '',
                      hypothesis: item.hypothesis ?? '',
                      guidance: item.guidance ?? '',
                      active: item.active,
                    })
                  }
                >
                  <Pencil />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
