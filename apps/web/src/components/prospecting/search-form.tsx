'use client';

import { CNAE_LABELS, formatCnae } from '@docline/core/prospecting-domain';
import { Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  MunicipalityPicker,
  type MunicipalityOption,
} from '@/components/leads/municipality-picker';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api-client';

const LIMITS = [50, 100, 200, 500];

/** Busca na base aberta do CNPJ (F9-02): UF, cidades, atividade, só matriz, nome e quantidade. */
export function SearchForm({
  states,
  initialUf,
  initialCity,
  datasetReference,
}: {
  states: { uf: string; name: string }[];
  initialUf: string;
  initialCity: MunicipalityOption | null;
  datasetReference: string | null;
}) {
  const router = useRouter();
  const [uf, setUf] = useState(initialCity?.uf ?? initialUf);
  const [cities, setCities] = useState<MunicipalityOption[]>(initialCity ? [initialCity] : []);
  const [cnae, setCnae] = useState('');
  const [name, setName] = useState('');
  const [limit, setLimit] = useState(100);
  const [headOfficeOnly, setHeadOfficeOnly] = useState(true);
  const [onlyNew, setOnlyNew] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addCity(city: MunicipalityOption | null) {
    if (!city) return;
    // A busca é dentro de uma UF: escolher cidade de outra UF troca a UF.
    if (city.uf !== uf) {
      setUf(city.uf);
      setCities([city]);
    } else if (!cities.some((c) => c.ibgeCode === city.ibgeCode)) {
      setCities([...cities, city]);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ searchId: string }>('/prospecting/searches', {
        method: 'POST',
        body: {
          uf,
          municipalityCodes: cities.map((c) => c.ibgeCode),
          cnae: cnae || null,
          headOfficeOnly,
          onlyNew,
          name: name.trim() || null,
          limit,
        },
      });
      router.push(`/prospeccao?busca=${result.searchId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível buscar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Buscar escritórios</CardTitle>
        <CardDescription>
          {datasetReference
            ? `Base aberta do CNPJ da Receita Federal, mês ${datasetReference}: escritórios ativos de contabilidade. Nada vira lead sem aprovação.`
            : 'A base aberta do CNPJ ainda não foi carregada.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-4 md:grid-cols-4">
            <Field label="UF" htmlFor="prospectUf">
              <Select
                id="prospectUf"
                value={uf}
                onChange={(e) => {
                  setUf(e.target.value);
                  setCities([]);
                }}
              >
                {states.map((s) => (
                  <option key={s.uf} value={s.uf}>
                    {s.uf} — {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="md:col-span-2">
              <Field
                label="Cidades"
                htmlFor="prospectCity"
                hint="Sem cidade, a UF inteira (até 20 cidades)."
              >
                <MunicipalityPicker id="prospectCity" value={null} onChange={addCity} />
              </Field>
            </div>
            <Field label="Atividade (CNAE)" htmlFor="prospectCnae">
              <Select id="prospectCnae" value={cnae} onChange={(e) => setCnae(e.target.value)}>
                <option value="">As duas</option>
                {Object.entries(CNAE_LABELS).map(([code, label]) => (
                  <option key={code} value={code}>
                    {formatCnae(code)} · {label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {cities.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label="Cidades escolhidas">
              {cities.map((city) => (
                <li
                  key={city.ibgeCode}
                  className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm"
                >
                  {city.name}
                  <button
                    type="button"
                    aria-label={`Tirar ${city.name}`}
                    className="rounded-full p-0.5 hover:bg-muted"
                    onClick={() => setCities(cities.filter((c) => c.ibgeCode !== city.ibgeCode))}
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="grid gap-4 md:grid-cols-4">
            <div className="md:col-span-2">
              <Field label="Nome (parte)" htmlFor="prospectName">
                <Input
                  id="prospectName"
                  value={name}
                  maxLength={100}
                  placeholder="Ex.: contadores"
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Quantidade" htmlFor="prospectLimit">
              <Select
                id="prospectLimit"
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
              >
                {LIMITS.map((l) => (
                  <option key={l} value={l}>
                    Até {l}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex flex-col justify-end gap-1.5 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={headOfficeOnly}
                  onChange={(e) => setHeadOfficeOnly(e.target.checked)}
                />
                Só matriz
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={onlyNew}
                  onChange={(e) => setOnlyNew(e.target.checked)}
                />
                Só quem ainda não é lead
              </label>
            </div>
          </div>
          {error ? <Alert variant="error">{error}</Alert> : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !datasetReference}>
              <Search /> Buscar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
