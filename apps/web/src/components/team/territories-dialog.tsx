'use client';

import { MapPin, X } from 'lucide-react';
import { useState } from 'react';
import {
  MunicipalityPicker,
  type MunicipalityOption,
} from '@/components/leads/municipality-picker';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api-client';

interface Territory {
  stateUf: string;
  municipalityCode: number | null;
  municipality?: { name: string } | null;
}

const UFS =
  'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');

/**
 * Territórios do SDR (UF inteira ou cidades): definem o pool de leads sem
 * responsável que ele enxerga e pode assumir. Sem território, não há pool.
 */
export function TerritoriesDialog({ user }: { user: { id: string; name: string } }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Territory[]>([]);
  const [uf, setUf] = useState('');
  const [city, setCity] = useState<MunicipalityOption | null>(null);
  const [message, setMessage] = useState<{ variant: 'success' | 'error'; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  async function load() {
    setMessage(null);
    try {
      setItems((await api<{ data: Territory[] }>(`/users/${user.id}/territories`)).data);
    } catch (err) {
      setMessage({
        variant: 'error',
        text: err instanceof ApiError ? err.message : 'Falha ao carregar.',
      });
    }
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api<{ data: Territory[] }>(`/users/${user.id}/territories`, {
        method: 'PUT',
        body: {
          territories: items.map((t) => ({
            stateUf: t.stateUf,
            municipalityCode: t.municipalityCode,
          })),
        },
      });
      setItems(result.data);
      setMessage({ variant: 'success', text: 'Territórios salvos.' });
    } catch (err) {
      setMessage({
        variant: 'error',
        text: err instanceof ApiError ? err.message : 'Não foi possível salvar.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <MapPin /> Territórios
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Territórios de ${user.name}`}
        description="Leads ativos e sem responsável nestas UFs ou cidades aparecem para o SDR, que pode assumi-los."
      >
        <div className="space-y-4">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sem território: o SDR vê só os leads atribuídos a ele.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {items.map((t, index) => (
                <li
                  key={`${t.stateUf}-${t.municipalityCode ?? ''}`}
                  className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-sm"
                >
                  {t.municipalityCode
                    ? `${t.municipality?.name ?? t.municipalityCode}/${t.stateUf}`
                    : `${t.stateUf} (toda a UF)`}
                  <button
                    type="button"
                    aria-label="Remover território"
                    className="opacity-70 hover:opacity-100"
                    onClick={() => setItems((list) => list.filter((_, i) => i !== index))}
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="UF inteira" htmlFor="territoryUf">
              <div className="flex gap-2">
                <Select id="territoryUf" value={uf} onChange={(e) => setUf(e.target.value)}>
                  <option value="">UF</option>
                  {UFS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!uf}
                  onClick={() => {
                    setItems((list) => [
                      ...list.filter((t) => t.stateUf !== uf),
                      { stateUf: uf, municipalityCode: null },
                    ]);
                    setUf('');
                  }}
                >
                  Adicionar
                </Button>
              </div>
            </Field>
            <Field label="Cidade" htmlFor="territoryCity">
              <div className="flex gap-2">
                <MunicipalityPicker id="territoryCity" value={city} onChange={setCity} />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!city}
                  onClick={() => {
                    if (!city) return;
                    setItems((list) => [
                      ...list.filter((t) => t.municipalityCode !== city.ibgeCode),
                      {
                        stateUf: city.uf,
                        municipalityCode: city.ibgeCode,
                        municipality: { name: city.name },
                      },
                    ]);
                    setCity(null);
                  }}
                >
                  Adicionar
                </Button>
              </div>
            </Field>
          </div>
          {message ? <Alert variant={message.variant}>{message.text}</Alert> : null}
          <div className="flex justify-end">
            <Button disabled={busy} onClick={save}>
              Salvar territórios
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
