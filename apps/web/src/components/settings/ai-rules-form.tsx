'use client';

import { AI_KIND_LABELS, OUTREACH_KINDS, type AiRules } from '@docline/core/ai-domain';
import { useState } from 'react';
import { useAction } from '@/components/leads/use-action';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api-client';

/**
 * Regras dos guardrails da IA (ADMIN; docs/AI-SDR.md §7 e §9.2): limites de
 * tamanho por tipo, opt-out exigido, termos que bloqueiam a aprovação,
 * personalização mínima e o limite de parecença com mensagens a outros leads.
 */
export function AiRulesForm({ initial }: { initial: AiRules }) {
  const { run, notice, busy } = useAction();
  const [rules, setRules] = useState(initial);
  const [terms, setTerms] = useState(initial.forbiddenTerms.join('\n'));
  const [errors, setErrors] = useState<{ path: string; message: string }[]>([]);
  const errorOf = (path: string) =>
    errors.find((e) => e.path === path || e.path.startsWith(`${path}.`))?.message;

  async function save() {
    setErrors([]);
    const body: AiRules = {
      ...rules,
      forbiddenTerms: terms
        .split('\n')
        .map((t) => t.trim())
        .filter(Boolean),
    };
    await run(async () => {
      try {
        return await api('/ai/rules', { method: 'PUT', body });
      } catch (err) {
        if (err instanceof ApiError) setErrors(err.errors);
        throw err;
      }
    }, 'Regras da IA salvas. Valem para os próximos rascunhos.');
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>Regras dos rascunhos</CardTitle>
          <CardDescription>
            Conferidas em todo rascunho e de novo no texto editado. Termo proibido, telefone, link
            ou valor fora da base de conhecimento bloqueiam a aprovação até a pessoa corrigir.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Limite de caracteres por tipo</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {OUTREACH_KINDS.map((kind) => (
                <Field
                  key={kind}
                  label={AI_KIND_LABELS[kind]}
                  htmlFor={`aiMax-${kind}`}
                  error={errorOf(`maxChars.${kind}`)}
                >
                  <Input
                    id={`aiMax-${kind}`}
                    type="number"
                    min={80}
                    max={2000}
                    value={rules.maxChars[kind]}
                    onChange={(e) =>
                      setRules({
                        ...rules,
                        maxChars: { ...rules.maxChars, [kind]: Number(e.target.value) },
                      })
                    }
                  />
                </Field>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Tipos que oferecem o opt-out</legend>
            <div className="flex flex-wrap gap-3">
              {OUTREACH_KINDS.map((kind) => (
                <label key={kind} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={rules.optOutRequiredKinds.includes(kind)}
                    onChange={(e) =>
                      setRules({
                        ...rules,
                        optOutRequiredKinds: e.target.checked
                          ? [...rules.optOutRequiredKinds, kind]
                          : rules.optOutRequiredKinds.filter((k) => k !== kind),
                      })
                    }
                  />
                  {AI_KIND_LABELS[kind]}
                </label>
              ))}
            </div>
          </fieldset>
          <Field
            label="Frase de opt-out sugerida"
            htmlFor="aiOptOutLine"
            error={errorOf('optOutLine')}
          >
            <Input
              id="aiOptOutLine"
              maxLength={160}
              value={rules.optOutLine}
              onChange={(e) => setRules({ ...rules, optOutLine: e.target.value })}
            />
          </Field>
          <Field
            label="Termos que bloqueiam a aprovação"
            htmlFor="aiForbiddenTerms"
            hint="Um por linha. Acentos e maiúsculas não importam."
            error={errorOf('forbiddenTerms')}
          >
            <Textarea
              id="aiForbiddenTerms"
              rows={6}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Personalização mínima"
              htmlFor="aiMinPersonalization"
              hint="Referências concretas ao lead (nome, cidade, responsável, origem)."
              error={errorOf('minPersonalization')}
            >
              <Input
                id="aiMinPersonalization"
                type="number"
                min={0}
                max={5}
                value={rules.minPersonalization}
                onChange={(e) => setRules({ ...rules, minPersonalization: Number(e.target.value) })}
              />
            </Field>
            <Field
              label="Parecença que indica envio em massa"
              htmlFor="aiMassSimilarity"
              hint="De 0,5 a 1. Acima disso, o rascunho é avisado como texto repetido."
              error={errorOf('massSimilarity')}
            >
              <Input
                id="aiMassSimilarity"
                type="number"
                min={0.5}
                max={1}
                step={0.05}
                value={rules.massSimilarity}
                onChange={(e) => setRules({ ...rules, massSimilarity: Number(e.target.value) })}
              />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              Salvar regras
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
