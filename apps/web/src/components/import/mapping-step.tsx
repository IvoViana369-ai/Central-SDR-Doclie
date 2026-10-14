'use client';

import { LEGAL_BASIS_LABELS } from '@docline/core/compliance-domain';
import {
  customKeyOf,
  IMPORT_FIELDS,
  POLICY_LABELS,
  suggestMapping,
  type ColumnTarget,
} from '@docline/core/import-domain';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type {
  BatchDetail,
  ColumnMapping,
  DuplicatePolicy,
  ImportOptions,
  LegalBasis,
} from './types';
import { uploadSpreadsheet } from './upload';

const TARGETS: { value: ColumnTarget; label: string }[] = [
  ...(Object.entries(IMPORT_FIELDS) as [ColumnTarget, { label: string }][]).map(
    ([value, field]) => ({ value, label: field.label }),
  ),
  { value: 'custom', label: 'Campo extra' },
  { value: 'ignore', label: 'Ignorar coluna' },
];

const today = () => new Date().toISOString().slice(0, 10);

function headersAt(batch: BatchDetail, headerRow: number): string[] {
  const row = batch.sampleRows.find((r) => r.number === headerRow)?.cells ?? [];
  const width = Math.max(row.length, ...batch.sampleRows.map((r) => r.cells.length), 0);
  return Array.from({ length: width }, (_, i) => row[i] || `Coluna ${i + 1}`);
}

/** Etapa 2: colunas → campos, política de duplicados, origem e base legal (F3-04). */
export function MappingStep({
  batch,
  options,
  maxFileMb,
  onConfigured,
  onCancelEdit,
}: {
  batch: BatchDetail;
  options: ImportOptions;
  maxFileMb: number;
  onConfigured: () => Promise<void>;
  onCancelEdit?: () => void;
}) {
  const router = useRouter();
  const initialSource = options.sources.find((s) => s.id === batch.sourceId) ?? null;
  const [headerRow, setHeaderRow] = useState(batch.headerRow);
  const [columns, setColumns] = useState<ColumnMapping[]>(batch.suggestedMapping);
  const [settings, setSettings] = useState({
    duplicatePolicy: batch.duplicatePolicy as DuplicatePolicy,
    sourceId: batch.sourceId ?? '',
    sourceDetail: batch.sourceDetail ?? '',
    collectedAt: batch.collectedAt ? String(batch.collectedAt).slice(0, 10) : today(),
    legalBasis: (batch.defaultLegalBasis ?? initialSource?.defaultLegalBasis ?? '') as
      LegalBasis | '',
    legalBasisAssessmentId: batch.legalBasisAssessmentId ?? '',
    ownerId: batch.defaultOwnerId ?? '',
    tagIds: batch.defaultTagIds,
    saveTemplateAs: '',
  });
  const [errors, setErrors] = useState<{ path: string; message: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [otherSheet, setOtherSheet] = useState({ sheet: '', file: null as File | null });
  const [sheetError, setSheetError] = useState<string | null>(null);

  const dataRows = useMemo(
    () => batch.sampleRows.filter((r) => r.number > headerRow).slice(0, 3),
    [batch.sampleRows, headerRow],
  );
  const errorOf = (path: string) => errors.find((e) => e.path === path)?.message;
  const set = <K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));

  function changeHeaderRow(value: number) {
    setHeaderRow(value);
    setColumns(suggestMapping(headersAt(batch, value)));
  }

  function changeTarget(index: number, target: ColumnTarget) {
    setColumns((cols) =>
      cols.map((c) =>
        c.index === index
          ? {
              ...c,
              target,
              ...(target === 'custom' ? { customKey: c.customKey ?? customKeyOf(c.header) } : {}),
            }
          : c,
      ),
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors([]);
    try {
      await api(`/imports/${batch.id}/mapping`, {
        method: 'PUT',
        body: {
          headerRow,
          columns: columns.map((c) =>
            c.target === 'custom' ? c : { index: c.index, header: c.header, target: c.target },
          ),
          duplicatePolicy: settings.duplicatePolicy,
          sourceId: settings.sourceId,
          sourceDetail: settings.sourceDetail || null,
          collectedAt: settings.collectedAt,
          legalBasis: settings.legalBasis,
          legalBasisAssessmentId: settings.legalBasisAssessmentId || null,
          ownerId: settings.ownerId || null,
          tagIds: settings.tagIds,
          saveTemplateAs: settings.saveTemplateAs || null,
        },
      });
      await onConfigured();
    } catch (err) {
      setErrors(
        err instanceof ApiError
          ? err.errors.length
            ? err.errors
            : [{ path: '', message: err.message }]
          : [{ path: '', message: 'Não foi possível salvar o mapeamento.' }],
      );
    } finally {
      setBusy(false);
    }
  }

  async function readOtherSheet() {
    if (!otherSheet.file || !otherSheet.sheet) return;
    setSheetError(null);
    const result = await uploadSpreadsheet(otherSheet.file, otherSheet.sheet, maxFileMb);
    if (!result.ok) {
      setSheetError(result.message);
      return;
    }
    await api(`/imports/${batch.id}/cancel`, { method: 'POST' }).catch(() => null);
    router.push(`/importar/${result.batchId}`);
  }

  const generalError = errors.find((e) => e.path === '' || e.path === 'columns')?.message;

  return (
    <form onSubmit={submit} className="space-y-4">
      {batch.templateUsed ? (
        <Alert>
          Mapeamento sugerido pelo modelo salvo “{batch.templateUsed.name}” (mesmo cabeçalho).
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Colunas da planilha</CardTitle>
          <CardDescription>
            Confira para onde vai cada coluna. Colunas sem campo correspondente viram “campo extra”
            e ficam guardadas no lead.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Linha do cabeçalho"
              htmlFor="header-row"
              hint="Detectada automaticamente; mude se o título da planilha ocupar as primeiras linhas."
              error={errorOf('headerRow')}
            >
              <Select
                id="header-row"
                value={headerRow}
                onChange={(e) => changeHeaderRow(Number(e.target.value))}
              >
                {batch.sampleRows.slice(0, 10).map((r) => (
                  <option key={r.number} value={r.number}>
                    Linha {r.number}: {r.cells.filter(Boolean).slice(0, 3).join(' · ').slice(0, 60)}
                  </option>
                ))}
              </Select>
            </Field>
            {batch.sheetNames.length > 1 ? (
              <div className="space-y-2 sm:col-span-2">
                <p className="text-sm font-medium">
                  Aba lida: {batch.sheetName ?? batch.sheetNames[0]}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Select
                    aria-label="Outra aba"
                    value={otherSheet.sheet}
                    onChange={(e) => setOtherSheet((s) => ({ ...s, sheet: e.target.value }))}
                  >
                    <option value="">Ler outra aba…</option>
                    {batch.sheetNames
                      .filter((n) => n !== (batch.sheetName ?? batch.sheetNames[0]))
                      .map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                  </Select>
                  <Input
                    type="file"
                    accept=".xlsx"
                    aria-label="Arquivo de novo (o original já foi descartado)"
                    onChange={(e) =>
                      setOtherSheet((s) => ({ ...s, file: e.target.files?.[0] ?? null }))
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!otherSheet.sheet || !otherSheet.file}
                    onClick={readOtherSheet}
                  >
                    Ler aba
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  O arquivo enviado é apagado depois da leitura; para outra aba, escolha-o de novo.
                </p>
                {sheetError ? <p className="text-xs text-destructive">{sheetError}</p> : null}
              </div>
            ) : null}
          </div>

          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Tr>
                  <Th>Coluna</Th>
                  <Th>Exemplos</Th>
                  <Th className="min-w-48">Vai para</Th>
                </Tr>
              </THead>
              <TBody>
                {columns.map((column) => (
                  <Tr key={column.index}>
                    <Td className="font-medium">{column.header}</Td>
                    <Td className="max-w-64 text-xs text-muted-foreground">
                      {dataRows
                        .map((r) => r.cells[column.index])
                        .filter(Boolean)
                        .map((v) => v!.slice(0, 40))
                        .join(' · ') || '—'}
                    </Td>
                    <Td className="space-y-2">
                      <Select
                        aria-label={`Destino da coluna ${column.header}`}
                        value={column.target}
                        onChange={(e) => changeTarget(column.index, e.target.value as ColumnTarget)}
                      >
                        {TARGETS.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </Select>
                      {column.target === 'custom' ? (
                        <Input
                          aria-label={`Nome do campo extra (${column.header})`}
                          value={column.customKey ?? ''}
                          onChange={(e) =>
                            setColumns((cols) =>
                              cols.map((c) =>
                                c.index === column.index
                                  ? { ...c, customKey: e.target.value.toLowerCase() }
                                  : c,
                              ),
                            )
                          }
                        />
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Origem, base legal e duplicados</CardTitle>
          <CardDescription>
            Valem para todos os leads do lote e ficam registrados em cada um (LGPD).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Origem" htmlFor="import-source" error={errorOf('sourceId')}>
            <Select
              id="import-source"
              value={settings.sourceId}
              onChange={(e) => {
                const source = options.sources.find((s) => s.id === e.target.value);
                setSettings((s) => ({
                  ...s,
                  sourceId: e.target.value,
                  legalBasis: s.legalBasis || source?.defaultLegalBasis || '',
                }));
              }}
            >
              <option value="">Escolha…</option>
              {options.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Detalhe da origem"
            htmlFor="import-source-detail"
            hint="Ex.: nome do evento ou da lista."
            error={errorOf('sourceDetail')}
          >
            <Input
              id="import-source-detail"
              value={settings.sourceDetail}
              maxLength={200}
              onChange={(e) => set('sourceDetail', e.target.value)}
            />
          </Field>
          <Field label="Data da coleta" htmlFor="import-collected" error={errorOf('collectedAt')}>
            <Input
              id="import-collected"
              type="date"
              value={settings.collectedAt}
              max={today()}
              onChange={(e) => set('collectedAt', e.target.value)}
            />
          </Field>
          <Field label="Base legal" htmlFor="import-legal-basis" error={errorOf('legalBasis')}>
            <Select
              id="import-legal-basis"
              value={settings.legalBasis}
              onChange={(e) => set('legalBasis', e.target.value as LegalBasis)}
            >
              <option value="">Escolha…</option>
              {(Object.entries(LEGAL_BASIS_LABELS) as [LegalBasis, string][]).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          {options.assessments.length > 0 ? (
            <Field
              label="Avaliação da base legal (opcional)"
              htmlFor="import-assessment"
              error={errorOf('legalBasisAssessmentId')}
            >
              <Select
                id="import-assessment"
                value={settings.legalBasisAssessmentId}
                onChange={(e) => set('legalBasisAssessmentId', e.target.value)}
              >
                <option value="">Nenhuma</option>
                {options.assessments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {options.owners ? (
            <Field label="Responsável (opcional)" htmlFor="import-owner" error={errorOf('ownerId')}>
              <Select
                id="import-owner"
                value={settings.ownerId}
                onChange={(e) => set('ownerId', e.target.value)}
              >
                <option value="">Sem responsável (pool)</option>
                {options.owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field
            label="Quando o lead já existe"
            htmlFor="import-policy"
            hint="Na dúvida (possível duplicado), nada é alterado no lead existente."
          >
            <Select
              id="import-policy"
              value={settings.duplicatePolicy}
              onChange={(e) => set('duplicatePolicy', e.target.value as DuplicatePolicy)}
            >
              {(Object.entries(POLICY_LABELS) as [DuplicatePolicy, string][]).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          {options.tags.length > 0 ? (
            <fieldset className="space-y-2 sm:col-span-2">
              <legend className="text-sm font-medium">Tags para todos os leads (opcional)</legend>
              <div className="flex flex-wrap gap-2">
                {options.tags.map((tag) => {
                  const checked = settings.tagIds.includes(tag.id);
                  return (
                    <label
                      key={tag.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-xs',
                        checked ? 'border-primary bg-accent' : 'border-input',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={checked}
                        onChange={() =>
                          set(
                            'tagIds',
                            checked
                              ? settings.tagIds.filter((id) => id !== tag.id)
                              : [...settings.tagIds, tag.id],
                          )
                        }
                      />
                      {tag.name}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : null}
          <Field
            label="Salvar este mapeamento como modelo (opcional)"
            htmlFor="import-template"
            hint="Na próxima planilha com o mesmo cabeçalho, o mapeamento vem pronto."
            error={errorOf('saveTemplateAs')}
          >
            <Input
              id="import-template"
              value={settings.saveTemplateAs}
              maxLength={80}
              placeholder="Ex.: Lista do evento anual"
              onChange={(e) => set('saveTemplateAs', e.target.value)}
            />
          </Field>
        </CardContent>
      </Card>

      {generalError ? <Alert variant="error">{generalError}</Alert> : null}
      {errors.length > 0 && !generalError ? (
        <Alert variant="error">Confira os campos destacados.</Alert>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancelEdit ? (
          <Button type="button" variant="outline" onClick={onCancelEdit}>
            Voltar à prévia
          </Button>
        ) : null}
        <Button type="submit" disabled={busy}>
          {busy ? 'Salvando…' : 'Gerar prévia'}
        </Button>
      </div>
    </form>
  );
}
