'use client';

import { LEGAL_BASIS_LABELS } from '@docline/core/compliance-domain';
import { LEAD_TYPE_LABELS } from '@docline/core/leads-domain';
import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api-client';
import { DuplicateList, type DuplicateMatch } from './duplicate-list';
import { MunicipalityPicker, type MunicipalityOption } from './municipality-picker';

type LegalBasis = keyof typeof LEGAL_BASIS_LABELS;
type LeadType = keyof typeof LEAD_TYPE_LABELS;
type ContactType = 'PHONE' | 'EMAIL' | 'INSTAGRAM';

export interface LeadFormOptions {
  sources: { id: string; key: string; name: string; defaultLegalBasis: LegalBasis }[];
  segments: { id: string; name: string }[];
  tags: { id: string; name: string; color: string }[];
  /** Responsáveis possíveis (só para quem pode atribuir). */
  owners?: { id: string; name: string }[];
}

export interface EditableLead {
  id: string;
  version: number;
  companyName: string | null;
  tradeName: string | null;
  leadType: LeadType;
  segment: { id: string } | null;
  category: string | null;
  cnpj: string | null;
  websiteUrl: string | null;
  addressLine: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  postalCode: string | null;
  municipalityCode: number | null;
  cityRaw: string | null;
  stateUf: string | null;
  description: string | null;
}

interface ContactRow {
  type: ContactType;
  value: string;
  isWhatsapp: boolean;
}

interface PersonRow {
  fullName: string;
  roleTitle: string;
  isDecisionMaker: boolean;
}

const CONTACT_LABELS: Record<ContactType, string> = {
  PHONE: 'Telefone',
  EMAIL: 'E-mail',
  INSTAGRAM: 'Instagram',
};
const CONTACT_PLACEHOLDERS: Record<ContactType, string> = {
  PHONE: '(88) 99999-0000',
  EMAIL: 'contato@escritorio.com.br',
  INSTAGRAM: '@escritorio ou link do perfil',
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Cadastro e edição de lead (MVP M02). No cadastro: contatos, pessoas, origem,
 * data da coleta e base legal (obrigatórias, com padrão por origem) e aviso de
 * possíveis duplicados antes de salvar. Na edição: dados da empresa e endereço
 * (contatos e pessoas são editados no detalhe do lead).
 */
export function LeadForm({
  mode,
  options,
  lead,
}: {
  mode: 'create' | 'edit';
  options: LeadFormOptions;
  lead?: EditableLead;
}) {
  const router = useRouter();
  const [fields, setFields] = useState({
    tradeName: lead?.tradeName ?? '',
    companyName: lead?.companyName ?? '',
    leadType: (lead?.leadType ?? 'ACCOUNTING_FIRM') as LeadType,
    segmentId: lead?.segment?.id ?? '',
    category: lead?.category ?? '',
    cnpj: lead?.cnpj ?? '',
    website: lead?.websiteUrl ?? '',
    addressLine: lead?.addressLine ?? '',
    addressNumber: lead?.addressNumber ?? '',
    addressComplement: lead?.addressComplement ?? '',
    neighborhood: lead?.neighborhood ?? '',
    postalCode: lead?.postalCode ?? '',
    description: lead?.description ?? '',
  });
  const [municipality, setMunicipality] = useState<MunicipalityOption | null>(
    lead?.municipalityCode && lead.cityRaw && lead.stateUf
      ? { ibgeCode: lead.municipalityCode, name: lead.cityRaw, uf: lead.stateUf }
      : null,
  );
  const firstSource = options.sources[0];
  const [origin, setOrigin] = useState({
    sourceId: firstSource?.id ?? '',
    collectedAt: today(),
    detail: '',
    url: '',
    referrerName: '',
  });
  const [legalBasis, setLegalBasis] = useState<LegalBasis>(
    firstSource?.defaultLegalBasis ?? 'NOT_ASSESSED',
  );
  const [legalBasisEvidence, setLegalBasisEvidence] = useState('');
  const [contacts, setContacts] = useState<ContactRow[]>([
    { type: 'PHONE', value: '', isWhatsapp: false },
  ]);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [ownerId, setOwnerId] = useState<string>('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [mustConfirm, setMustConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof fields) => (value: string) =>
    setFields((f) => ({ ...f, [key]: value }));
  const errorOf = (path: string) => errors[path];
  const source = options.sources.find((s) => s.id === origin.sourceId);

  async function checkDuplicates() {
    if (mode !== 'create') return;
    const filled = contacts.filter((c) => c.value.trim().length >= 3);
    if (!fields.cnpj && filled.length === 0 && !fields.website) return;
    try {
      const result = await api<{ data: DuplicateMatch[] }>('/leads/check-duplicates', {
        method: 'POST',
        body: {
          cnpj: fields.cnpj || null,
          website: fields.website || null,
          tradeName: fields.tradeName || null,
          companyName: fields.companyName || null,
          municipalityCode: municipality?.ibgeCode ?? null,
          contactPoints: filled.map((c) => ({ type: c.type, value: c.value })),
        },
      });
      setDuplicates(result.data);
    } catch {
      // A verificação é um aviso; o servidor confere de novo ao salvar.
    }
  }

  function payload(acknowledgeDuplicates: boolean) {
    const base = {
      tradeName: fields.tradeName || null,
      companyName: fields.companyName || null,
      leadType: fields.leadType,
      segmentId: fields.segmentId || null,
      category: fields.category || null,
      cnpj: fields.cnpj || null,
      website: fields.website || null,
      addressLine: fields.addressLine || null,
      addressNumber: fields.addressNumber || null,
      addressComplement: fields.addressComplement || null,
      neighborhood: fields.neighborhood || null,
      postalCode: fields.postalCode || null,
      municipalityCode: municipality?.ibgeCode ?? null,
      description: fields.description || null,
    };
    if (mode === 'edit') return { ...base, version: lead!.version };
    return {
      ...base,
      origin: {
        sourceId: origin.sourceId,
        collectedAt: origin.collectedAt,
        detail: origin.detail || null,
        url: origin.url || null,
        referrerName: origin.referrerName || null,
      },
      legalBasis,
      legalBasisEvidence: legalBasisEvidence || null,
      contactPoints: contacts
        .filter((c) => c.value.trim())
        .map(({ type, value, isWhatsapp }) => ({ type, value, isWhatsapp })),
      people: people
        .filter((p) => p.fullName.trim())
        .map((p) => ({
          fullName: p.fullName,
          roleTitle: p.roleTitle || null,
          isDecisionMaker: p.isDecisionMaker,
        })),
      tagIds,
      ...(options.owners ? { ownerId: ownerId || null } : {}),
      acknowledgeDuplicates,
    };
  }

  async function submit(event: { preventDefault(): void }, acknowledgeDuplicates = false) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      if (mode === 'create') {
        const created = await api<{ id: string }>('/leads', {
          method: 'POST',
          body: payload(acknowledgeDuplicates),
        });
        router.push(`/leads/${created.id}`);
      } else {
        await api(`/leads/${lead!.id}`, { method: 'PATCH', body: payload(false) });
        router.push(`/leads/${lead!.id}`);
        router.refresh();
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'POSSIBLE_DUPLICATE') {
        const list = (err.body.duplicates ?? []) as DuplicateMatch[];
        setDuplicates(list);
        setMustConfirm(!list.some((d) => d.reasons.some((r) => r.blocking)));
        setFormError(err.message);
      } else if (err instanceof ApiError && err.errors.length > 0) {
        setErrors(Object.fromEntries(err.errors.map((e) => [e.path, e.message])));
        setFormError('Confira os campos destacados.');
      } else {
        setFormError(err instanceof ApiError ? err.message : 'Não foi possível salvar.');
      }
      setBusy(false);
    }
  }

  // Contatos repetidos no formulário e campos de contato inválidos aparecem por linha.
  const contactError = (index: number) => {
    const filledIndex = contacts
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.value.trim())
      .findIndex(({ i }) => i === index);
    return filledIndex >= 0 ? errorOf(`contactPoints.${filledIndex}.value`) : undefined;
  };

  return (
    <form onSubmit={(e) => submit(e)} className="space-y-5" noValidate>
      {formError ? <Alert variant="error">{formError}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>Empresa</CardTitle>
          <CardDescription>
            Informe o nome fantasia ou a razão social (ao menos um).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome fantasia" htmlFor="tradeName" error={errorOf('tradeName')}>
            <Input
              id="tradeName"
              value={fields.tradeName}
              onChange={(e) => set('tradeName')(e.target.value)}
              aria-invalid={!!errorOf('tradeName') || undefined}
            />
          </Field>
          <Field label="Razão social" htmlFor="companyName" error={errorOf('companyName')}>
            <Input
              id="companyName"
              value={fields.companyName}
              onChange={(e) => set('companyName')(e.target.value)}
            />
          </Field>
          <Field label="Tipo" htmlFor="leadType">
            <Select
              id="leadType"
              value={fields.leadType}
              onChange={(e) => set('leadType')(e.target.value)}
            >
              {Object.entries(LEAD_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Segmento" htmlFor="segmentId">
            <Select
              id="segmentId"
              value={fields.segmentId}
              onChange={(e) => set('segmentId')(e.target.value)}
            >
              <option value="">Não informado</option>
              {options.segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="CNPJ"
            htmlFor="cnpj"
            hint="Numérico ou alfanumérico, com ou sem pontuação."
            error={errorOf('cnpj')}
          >
            <Input
              id="cnpj"
              value={fields.cnpj}
              onChange={(e) => set('cnpj')(e.target.value)}
              onBlur={checkDuplicates}
              aria-invalid={!!errorOf('cnpj') || undefined}
            />
          </Field>
          <Field label="Site" htmlFor="website" error={errorOf('website')}>
            <Input
              id="website"
              value={fields.website}
              placeholder="escritorio.com.br"
              onChange={(e) => set('website')(e.target.value)}
              onBlur={checkDuplicates}
              aria-invalid={!!errorOf('website') || undefined}
            />
          </Field>
          <Field label="Categoria (da fonte)" htmlFor="category">
            <Input
              id="category"
              value={fields.category}
              onChange={(e) => set('category')(e.target.value)}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Endereço</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Cidade"
            htmlFor="municipality"
            hint="O DDD da cidade completa telefones digitados sem DDD."
            error={errorOf('municipalityCode')}
          >
            <MunicipalityPicker
              id="municipality"
              value={municipality}
              onChange={setMunicipality}
              invalid={!!errorOf('municipalityCode')}
            />
          </Field>
          <Field label="CEP" htmlFor="postalCode" error={errorOf('postalCode')}>
            <Input
              id="postalCode"
              value={fields.postalCode}
              onChange={(e) => set('postalCode')(e.target.value)}
              aria-invalid={!!errorOf('postalCode') || undefined}
            />
          </Field>
          <Field label="Logradouro" htmlFor="addressLine">
            <Input
              id="addressLine"
              value={fields.addressLine}
              onChange={(e) => set('addressLine')(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Número" htmlFor="addressNumber">
              <Input
                id="addressNumber"
                value={fields.addressNumber}
                onChange={(e) => set('addressNumber')(e.target.value)}
              />
            </Field>
            <Field label="Complemento" htmlFor="addressComplement">
              <Input
                id="addressComplement"
                value={fields.addressComplement}
                onChange={(e) => set('addressComplement')(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Bairro" htmlFor="neighborhood">
            <Input
              id="neighborhood"
              value={fields.neighborhood}
              onChange={(e) => set('neighborhood')(e.target.value)}
            />
          </Field>
        </CardContent>
      </Card>

      {mode === 'create' ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Contatos</CardTitle>
              <CardDescription>
                Telefone com WhatsApp informado pela fonte fica como &quot;provável&quot;. Encontrar
                um telefone não significa autorização de contato.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {contacts.map((contact, index) => (
                <div
                  key={index}
                  className="grid gap-2 sm:grid-cols-[9rem_1fr_auto_auto] sm:items-start"
                >
                  <Select
                    aria-label={`Tipo do contato ${index + 1}`}
                    value={contact.type}
                    onChange={(e) =>
                      setContacts((list) =>
                        list.map((c, i) =>
                          i === index
                            ? { ...c, type: e.target.value as ContactType, isWhatsapp: false }
                            : c,
                        ),
                      )
                    }
                  >
                    {Object.entries(CONTACT_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                  <div className="space-y-1">
                    <Input
                      aria-label={`${CONTACT_LABELS[contact.type]} (contato ${index + 1})`}
                      placeholder={CONTACT_PLACEHOLDERS[contact.type]}
                      value={contact.value}
                      aria-invalid={!!contactError(index) || undefined}
                      onChange={(e) =>
                        setContacts((list) =>
                          list.map((c, i) => (i === index ? { ...c, value: e.target.value } : c)),
                        )
                      }
                      onBlur={checkDuplicates}
                    />
                    {contactError(index) ? (
                      <p className="text-xs text-destructive" role="alert">
                        {contactError(index)}
                      </p>
                    ) : null}
                  </div>
                  <label className="flex h-9 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={contact.type !== 'PHONE'}
                      checked={contact.isWhatsapp}
                      onChange={(e) =>
                        setContacts((list) =>
                          list.map((c, i) =>
                            i === index ? { ...c, isWhatsapp: e.target.checked } : c,
                          ),
                        )
                      }
                    />
                    WhatsApp
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remover contato ${index + 1}`}
                    onClick={() => setContacts((list) => list.filter((_, i) => i !== index))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              {errorOf('contactPoints') ? (
                <p className="text-xs text-destructive">{errorOf('contactPoints')}</p>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setContacts((list) => [...list, { type: 'PHONE', value: '', isWhatsapp: false }])
                }
              >
                <Plus /> Adicionar contato
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pessoas</CardTitle>
              <CardDescription>Contador(a), sócio(a), recepção…</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {people.map((person, index) => (
                <div
                  key={index}
                  className="grid gap-2 sm:grid-cols-[1fr_12rem_auto_auto] sm:items-center"
                >
                  <Input
                    aria-label={`Nome da pessoa ${index + 1}`}
                    placeholder="Nome completo"
                    value={person.fullName}
                    onChange={(e) =>
                      setPeople((list) =>
                        list.map((p, i) => (i === index ? { ...p, fullName: e.target.value } : p)),
                      )
                    }
                  />
                  <Input
                    aria-label={`Cargo da pessoa ${index + 1}`}
                    placeholder="Cargo"
                    value={person.roleTitle}
                    onChange={(e) =>
                      setPeople((list) =>
                        list.map((p, i) => (i === index ? { ...p, roleTitle: e.target.value } : p)),
                      )
                    }
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={person.isDecisionMaker}
                      onChange={(e) =>
                        setPeople((list) =>
                          list.map((p, i) =>
                            i === index ? { ...p, isDecisionMaker: e.target.checked } : p,
                          ),
                        )
                      }
                    />
                    Decide
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remover pessoa ${index + 1}`}
                    onClick={() => setPeople((list) => list.filter((_, i) => i !== index))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setPeople((list) => [
                    ...list,
                    { fullName: '', roleTitle: '', isDecisionMaker: false },
                  ])
                }
              >
                <Plus /> Adicionar pessoa
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Origem e base legal</CardTitle>
              <CardDescription>
                Obrigatórias (LGPD). A base legal sugerida depende da origem; confirme antes de
                salvar. &quot;Não avaliada&quot; bloqueia o contato até a revisão.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Origem" htmlFor="sourceId" error={errorOf('origin.sourceId')}>
                <Select
                  id="sourceId"
                  value={origin.sourceId}
                  onChange={(e) => {
                    const next = options.sources.find((s) => s.id === e.target.value);
                    setOrigin((o) => ({ ...o, sourceId: e.target.value }));
                    if (next) setLegalBasis(next.defaultLegalBasis);
                  }}
                >
                  {options.sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Data da coleta"
                htmlFor="collectedAt"
                error={errorOf('origin.collectedAt')}
              >
                <Input
                  id="collectedAt"
                  type="date"
                  value={origin.collectedAt}
                  max={today()}
                  onChange={(e) => setOrigin((o) => ({ ...o, collectedAt: e.target.value }))}
                  aria-invalid={!!errorOf('origin.collectedAt') || undefined}
                />
              </Field>
              <Field
                label="Detalhe da origem"
                htmlFor="originDetail"
                hint="Ex.: busca “contabilidade Sobral”."
              >
                <Input
                  id="originDetail"
                  value={origin.detail}
                  onChange={(e) => setOrigin((o) => ({ ...o, detail: e.target.value }))}
                />
              </Field>
              {source?.key === 'REFERRAL' ? (
                <Field label="Quem indicou" htmlFor="referrerName">
                  <Input
                    id="referrerName"
                    value={origin.referrerName}
                    onChange={(e) => setOrigin((o) => ({ ...o, referrerName: e.target.value }))}
                  />
                </Field>
              ) : (
                <Field label="Link da origem" htmlFor="originUrl">
                  <Input
                    id="originUrl"
                    value={origin.url}
                    onChange={(e) => setOrigin((o) => ({ ...o, url: e.target.value }))}
                  />
                </Field>
              )}
              <Field label="Base legal" htmlFor="legalBasis" error={errorOf('legalBasis')}>
                <Select
                  id="legalBasis"
                  value={legalBasis}
                  onChange={(e) => setLegalBasis(e.target.value as LegalBasis)}
                >
                  {Object.entries(LEGAL_BASIS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Evidência da base legal"
                htmlFor="legalBasisEvidence"
                hint="Ex.: formulário do evento, cliente desde 2021."
              >
                <Input
                  id="legalBasisEvidence"
                  value={legalBasisEvidence}
                  onChange={(e) => setLegalBasisEvidence(e.target.value)}
                />
              </Field>
            </CardContent>
          </Card>

          {options.tags.length > 0 || options.owners ? (
            <Card>
              <CardHeader>
                <CardTitle>Organização</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {options.owners ? (
                  <Field
                    label="Responsável"
                    htmlFor="ownerId"
                    hint="Sem responsável, o lead fica no pool."
                  >
                    <Select
                      id="ownerId"
                      value={ownerId}
                      onChange={(e) => setOwnerId(e.target.value)}
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
                {options.tags.length > 0 ? (
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium">Tags</legend>
                    <div className="flex flex-wrap gap-3">
                      {options.tags.map((tag) => (
                        <label key={tag.id} className="flex items-center gap-1.5 text-sm">
                          <input
                            type="checkbox"
                            checked={tagIds.includes(tag.id)}
                            onChange={(e) =>
                              setTagIds((ids) =>
                                e.target.checked
                                  ? [...ids, tag.id]
                                  : ids.filter((id) => id !== tag.id),
                              )
                            }
                          />
                          {tag.name}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Observações gerais</CardTitle>
          <CardDescription>
            Não registre dados sensíveis nem opiniões pessoais sobre pessoas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            aria-label="Observações gerais"
            value={fields.description}
            onChange={(e) => set('description')(e.target.value)}
          />
        </CardContent>
      </Card>

      {duplicates.length > 0 ? <DuplicateList duplicates={duplicates} /> : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancelar
        </Button>
        {mustConfirm ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={(e) => submit(e, true)}
          >
            Cadastrar mesmo assim
          </Button>
        ) : null}
        <Button type="submit" disabled={busy}>
          {mode === 'create' ? 'Cadastrar lead' : 'Salvar alterações'}
        </Button>
      </div>
    </form>
  );
}
