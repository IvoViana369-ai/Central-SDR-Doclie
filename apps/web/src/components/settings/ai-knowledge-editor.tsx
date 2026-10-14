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
import { formatDateTime } from '@/lib/utils';

export interface KnowledgeItem {
  id: string;
  key: string;
  title: string;
  content: string;
  active: boolean;
  version: number;
  approvedAt: string | Date | null;
  approvedBy: { id: string; name: string } | null;
}

interface Draft {
  key: string;
  title: string;
  content: string;
  active: boolean;
}

const EMPTY: Draft = { key: '', title: '', content: '', active: true };

/**
 * Base de conhecimento da IA (docs/AI-SDR.md §5): os únicos fatos sobre a
 * Docline que a IA pode afirmar. Quem salva aprova o texto; mudar o conteúdo
 * sobe a versão, e cada rascunho registra as versões que usou.
 */
export function AiKnowledgeEditor({ items }: { items: KnowledgeItem[] }) {
  const { run, notice, busy } = useAction();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [isNew, setIsNew] = useState(false);

  async function save() {
    if (!editing) return;
    const result = await run(
      () => api('/ai/knowledge', { method: 'PUT', body: editing }),
      'Fato salvo e aprovado.',
    );
    if (result) setEditing(null);
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>Base de conhecimento</CardTitle>
          <CardDescription>
            Fatos aprovados sobre a Docline. Sem fatos, a IA só se apresenta e pergunta se faz
            sentido conversar; preço, prazo ou presença local só entram se estiverem aqui.
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setEditing(EMPTY);
            setIsNew(true);
          }}
        >
          <Plus /> Novo fato
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
              <Field label="Chave" htmlFor="kbKey" hint="Ex.: PARCERIA_COMISSAO">
                <Input
                  id="kbKey"
                  value={editing.key}
                  disabled={!isNew}
                  maxLength={60}
                  onChange={(e) => setEditing({ ...editing, key: e.target.value })}
                />
              </Field>
              <Field label="Título" htmlFor="kbTitle">
                <Input
                  id="kbTitle"
                  value={editing.title}
                  maxLength={120}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                />
              </Field>
            </div>
            <Field
              label="Conteúdo"
              htmlFor="kbContent"
              hint="Uma afirmação verdadeira e verificável, como seria dita a um escritório."
            >
              <Textarea
                id="kbContent"
                rows={4}
                maxLength={2000}
                value={editing.content}
                onChange={(e) => setEditing({ ...editing, content: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editing.active}
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
              />
              Ativo (a IA pode usar)
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                Salvar e aprovar
              </Button>
            </div>
          </form>
        ) : null}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum fato cadastrado. Comece pelo que a Docline oferece aos escritórios parceiros.
          </p>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 py-3">
                <div className="space-y-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {item.title}
                    <Badge variant="muted">
                      {item.key} · v{item.version}
                    </Badge>
                    {item.active ? null : <Badge variant="warning">Inativo</Badge>}
                  </p>
                  <p className="text-sm whitespace-pre-line">{item.content}</p>
                  <p className="text-xs text-muted-foreground">
                    Aprovado
                    {item.approvedBy ? ` por ${item.approvedBy.name}` : ''}
                    {item.approvedAt ? ` em ${formatDateTime(item.approvedAt)}` : ''}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Editar ${item.title}`}
                  onClick={() => {
                    setEditing({
                      key: item.key,
                      title: item.title,
                      content: item.content,
                      active: item.active,
                    });
                    setIsNew(false);
                  }}
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
