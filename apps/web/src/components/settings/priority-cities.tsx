'use client';

import { X } from 'lucide-react';
import { useState } from 'react';
import { useAction } from '@/components/leads/use-action';
import {
  MunicipalityPicker,
  type MunicipalityOption,
} from '@/components/leads/municipality-picker';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api } from '@/lib/api-client';
import { formatDate } from '@/lib/utils';

export interface PriorityCityView {
  municipalityCode: number;
  name: string;
  uf: string;
  notes: string | null;
  createdAt: string | Date;
  createdByName: string | null;
  activeLeads: number;
}

/** Cidades prioritárias (F4-08): entram no critério "Em cidade prioritária" do score. */
export function PriorityCities({ cities }: { cities: PriorityCityView[] }) {
  const { run, notice, busy } = useAction();
  const [city, setCity] = useState<MunicipalityOption | null>(null);
  const [notes, setNotes] = useState('');
  const [pickerKey, setPickerKey] = useState(0);

  return (
    <div className="space-y-4">
      {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}
      <Card>
        <CardContent className="pt-5">
          <form
            className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!city) return;
              const ok = await run(
                () =>
                  api('/priority-cities', {
                    method: 'POST',
                    body: { municipalityCode: city.ibgeCode, notes: notes || null },
                  }),
                `${city.name}/${city.uf} incluída. O score dos leads da cidade é recalculado em segundo plano.`,
              );
              if (ok) {
                setCity(null);
                setNotes('');
                setPickerKey((k) => k + 1);
              }
            }}
          >
            <Field label="Cidade" htmlFor="priorityCity">
              <MunicipalityPicker
                key={pickerKey}
                id="priorityCity"
                value={city}
                onChange={setCity}
              />
            </Field>
            <Field label="Observação (opcional)" htmlFor="priorityNotes">
              <Input
                id="priorityNotes"
                maxLength={200}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex.: foco do trimestre"
              />
            </Field>
            <Button type="submit" disabled={busy || !city}>
              Incluir
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <Table>
          <THead>
            <Tr>
              <Th>Cidade</Th>
              <Th className="hidden sm:table-cell">Observação</Th>
              <Th>Leads ativos</Th>
              <Th className="hidden md:table-cell">Desde</Th>
              <Th className="w-10" />
            </Tr>
          </THead>
          <TBody>
            {cities.length === 0 ? (
              <Tr>
                <Td colSpan={5} className="py-8 text-center text-muted-foreground">
                  Nenhuma cidade prioritária.
                </Td>
              </Tr>
            ) : (
              cities.map((c) => (
                <Tr key={c.municipalityCode}>
                  <Td className="font-medium">
                    {c.name}/{c.uf}
                  </Td>
                  <Td className="hidden text-muted-foreground sm:table-cell">{c.notes ?? '—'}</Td>
                  <Td className="tabular-nums">{c.activeLeads}</Td>
                  <Td className="hidden text-muted-foreground md:table-cell">
                    {formatDate(c.createdAt)}
                    {c.createdByName ? ` · ${c.createdByName}` : ''}
                  </Td>
                  <Td>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label={`Retirar ${c.name}`}
                      disabled={busy}
                      onClick={() =>
                        window.confirm(`Retirar ${c.name}/${c.uf} das cidades prioritárias?`) &&
                        run(
                          () => api(`/priority-cities/${c.municipalityCode}`, { method: 'DELETE' }),
                          `${c.name}/${c.uf} retirada. O score dos leads da cidade é recalculado em segundo plano.`,
                        )
                      }
                    >
                      <X />
                    </Button>
                  </Td>
                </Tr>
              ))
            )}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
