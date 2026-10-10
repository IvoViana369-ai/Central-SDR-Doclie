'use client';

import { WEEKDAY_LABELS, type ContactRules } from '@docline/core/settings-domain';
import { useState } from 'react';
import { useAction } from '@/components/leads/use-action';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api-client';

type NumberKey = {
  [K in keyof ContactRules]: ContactRules[K] extends number ? K : never;
}[keyof ContactRules];

const LIMITS: { key: NumberKey; label: string; hint: string }[] = [
  {
    key: 'minHoursBetweenContacts',
    label: 'Intervalo mínimo entre contatos (horas)',
    hint: 'Ao mesmo lead. Responder a quem escreveu não conta.',
  },
  {
    key: 'maxFirstContactsPerDay',
    label: 'Primeiros contatos por SDR por dia',
    hint: 'Evita disparos em volume.',
  },
  {
    key: 'replySlaHours',
    label: 'Prazo para agir sobre uma resposta (horas)',
    hint: 'Depois disso, a resposta fica em destaque na fila.',
  },
  {
    key: 'handoffAcceptBusinessDays',
    label: 'Prazo do Comercial para aceitar (dias úteis)',
    hint: 'Após a transferência.',
  },
  {
    key: 'forgottenAfterDays',
    label: 'Lead "esquecido" após (dias sem atividade)',
    hint: 'Em etapa aberta e sem próxima ação.',
  },
  {
    key: 'newLeadDays',
    label: '"Novos leads" na fila (dias)',
    hint: 'Atribuídos ao SDR neste período.',
  },
];

/**
 * Regras de contato (ADMIN; docs/SDR-FLOW.md §4.2 e §6): janela, limites,
 * prazos e palavras de opt-out procuradas nas respostas.
 */
export function ContactRulesForm({ initial }: { initial: ContactRules }) {
  const { run, notice, busy } = useAction();
  const [rules, setRules] = useState(initial);
  const [keywords, setKeywords] = useState(initial.optOutKeywords.join('\n'));
  const [errors, setErrors] = useState<{ path: string; message: string }[]>([]);
  const set = (patch: Partial<ContactRules>) => setRules((r) => ({ ...r, ...patch }));
  const errorOf = (path: string) =>
    errors.find((e) => e.path === path || e.path.startsWith(`${path}.`))?.message;

  async function save() {
    setErrors([]);
    const body: ContactRules = {
      ...rules,
      optOutKeywords: keywords
        .split('\n')
        .map((k) => k.trim())
        .filter(Boolean),
    };
    await run(async () => {
      try {
        return await api('/settings/contact-rules', { method: 'PUT', body });
      } catch (err) {
        if (err instanceof ApiError) setErrors(err.errors);
        throw err;
      }
    }, 'Regras salvas. Valem a partir do próximo contato.');
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}
      <Card>
        <CardHeader>
          <CardTitle>Janela de contato</CardTitle>
          <CardDescription>Na hora local do lead. Feriados cadastrados ficam fora.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Início"
              htmlFor="rulesWindowStart"
              hint="HH:MM"
              error={errorOf('windowStart')}
            >
              <Input
                id="rulesWindowStart"
                value={rules.windowStart}
                inputMode="numeric"
                maxLength={5}
                onChange={(e) => set({ windowStart: e.target.value })}
              />
            </Field>
            <Field
              label="Fim"
              htmlFor="rulesWindowEnd"
              hint="HH:MM (24:00 vai até o fim do dia)"
              error={errorOf('windowEnd')}
            >
              <Input
                id="rulesWindowEnd"
                value={rules.windowEnd}
                inputMode="numeric"
                maxLength={5}
                onChange={(e) => set({ windowEnd: e.target.value })}
              />
            </Field>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Dias com contato</legend>
            <div className="flex flex-wrap gap-3">
              {WEEKDAY_LABELS.map((label, day) => (
                <label key={day} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={rules.workDays.includes(day)}
                    onChange={(e) =>
                      set({
                        workDays: e.target.checked
                          ? [...rules.workDays, day].sort((a, b) => a - b)
                          : rules.workDays.filter((d) => d !== day),
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            {errorOf('workDays') ? (
              <p className="mt-1 text-xs text-destructive" role="alert">
                {errorOf('workDays')}
              </p>
            ) : null}
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Limites e prazos</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {LIMITS.map(({ key, label, hint }) => (
            <Field
              key={key}
              label={label}
              htmlFor={`rules-${key}`}
              hint={hint}
              error={errorOf(key)}
            >
              <Input
                id={`rules-${key}`}
                type="number"
                min={0}
                value={rules[key]}
                onChange={(e) => set({ [key]: Number(e.target.value) })}
              />
            </Field>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Palavras de opt-out</CardTitle>
          <CardDescription>
            Uma por linha. Resposta curta com uma delas (ou com uma frase) coloca o lead na Lista
            Não Contatar; dentro de um texto maior, vira tarefa para o SDR decidir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Field
            label="Palavras e frases"
            htmlFor="rulesKeywords"
            hint="Acentos e maiúsculas não importam."
            error={errorOf('optOutKeywords')}
          >
            <Textarea
              id="rulesKeywords"
              rows={10}
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
            />
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          Salvar regras
        </Button>
      </div>
    </form>
  );
}
