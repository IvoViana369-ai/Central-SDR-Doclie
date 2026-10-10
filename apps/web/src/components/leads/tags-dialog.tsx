'use client';

import { Tags } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api-client';
import { TagChip } from './badges';

const COLORS = [
  ['slate', 'Cinza'],
  ['blue', 'Azul'],
  ['green', 'Verde'],
  ['teal', 'Turquesa'],
  ['amber', 'Amarelo'],
  ['orange', 'Laranja'],
  ['red', 'Vermelho'],
  ['violet', 'Roxo'],
  ['pink', 'Rosa'],
] as const;

/** Gestão de tags (ADMIN/GESTOR): criar e desativar. Aplicar tags a leads é permitido a todos. */
export function TagsDialog({ tags }: { tags: { id: string; name: string; color: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('blue');
  const [message, setMessage] = useState<{ variant: 'success' | 'error'; text: string } | null>(
    null,
  );

  async function act(action: () => Promise<unknown>, success: string) {
    setMessage(null);
    try {
      await action();
      setMessage({ variant: 'success', text: success });
      router.refresh();
    } catch (err) {
      setMessage({
        variant: 'error',
        text: err instanceof ApiError ? err.message : 'Não foi possível salvar.',
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Tags /> Tags
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Tags"
        description="Etiquetas para organizar os leads (ex.: Parceiro, Evento 2026)."
      >
        <div className="space-y-4">
          <ul className="flex flex-wrap gap-2">
            {tags.length === 0 ? (
              <li className="text-sm text-muted-foreground">Nenhuma tag criada.</li>
            ) : null}
            {tags.map((tag) => (
              <li key={tag.id}>
                <TagChip
                  tag={tag}
                  onRemove={() =>
                    window.confirm(
                      `Desativar a tag "${tag.name}"? Ela sai das opções, mas continua nos leads.`,
                    ) &&
                    act(
                      () => api(`/tags/${tag.id}`, { method: 'PATCH', body: { active: false } }),
                      'Tag desativada.',
                    )
                  }
                />
              </li>
            ))}
          </ul>
          <form
            className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end"
            onSubmit={async (e) => {
              e.preventDefault();
              await act(
                () => api('/tags', { method: 'POST', body: { name, color } }),
                `Tag "${name}" criada.`,
              );
              setName('');
            }}
          >
            <Field label="Nova tag" htmlFor="newTagName">
              <Input
                id="newTagName"
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Cor" htmlFor="newTagColor">
              <Select id="newTagColor" value={color} onChange={(e) => setColor(e.target.value)}>
                {COLORS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" disabled={!name.trim()}>
              Criar
            </Button>
          </form>
          {message ? <Alert variant={message.variant}>{message.text}</Alert> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
