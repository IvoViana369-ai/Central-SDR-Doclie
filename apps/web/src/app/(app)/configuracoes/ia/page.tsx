import { getAiRules, listApproaches, listKnowledgeItems, roleHasPermission } from '@docline/core';
import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AccessDenied } from '@/components/access-denied';
import { PageHeader } from '@/components/page-header';
import { AiApproachesEditor } from '@/components/settings/ai-approaches-editor';
import { AiKnowledgeEditor } from '@/components/settings/ai-knowledge-editor';
import { AiRulesForm } from '@/components/settings/ai-rules-form';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'IA de prospecção' };

/** Configuração da IA (ADMIN): fatos aprovados, abordagens e regras dos rascunhos. */
export default async function AiSettingsPage() {
  const { user, deps, meta } = await getPageContext();
  if (!roleHasPermission(user.actor.role, 'settings.manage')) return <AccessDenied />;
  const [knowledge, approaches, rules] = await Promise.all([
    listKnowledgeItems(deps, user.actor, { includeInactive: true }, meta),
    listApproaches(deps, user.actor, { includeInactive: true }, meta),
    getAiRules(deps, user.actor, {}, meta),
  ]);
  const { ai, aiLimits } = deps;

  return (
    <>
      <PageHeader
        title="IA de prospecção"
        description="O que a IA pode dizer sobre a Docline, as abordagens e as regras de cada rascunho. Nada é enviado sem a aprovação de uma pessoa."
        actions={
          <Button asChild variant="outline">
            <Link href="/relatorios/ia">
              Uso e custos <ArrowRight aria-hidden />
            </Link>
          </Button>
        }
      />
      <div className="space-y-4">
        {ai.name === 'fake' ? (
          <Alert title="IA real desligada">
            O sistema está com o provedor de demonstração (AI_PROVIDER=fake): os rascunhos são
            modelos fixos e nenhum dado sai para terceiros. Ligar a IA real é uma decisão da Docline
            (envolve transferência internacional de dados, LGPD).
          </Alert>
        ) : (
          <Alert>
            Provedor {ai.name}: geração com {ai.models.generation} (esforço{' '}
            {aiLimits.effortGeneration}), classificação com {ai.models.classification}. Limite de{' '}
            {aiLimits.maxGenerationsPerUserPerDay} usos por pessoa por dia
            {aiLimits.monthlyBudgetUsd !== null
              ? ` e orçamento de US$ ${aiLimits.monthlyBudgetUsd} por mês`
              : ', sem orçamento mensal definido'}
            .
          </Alert>
        )}
        <AiKnowledgeEditor items={knowledge} />
        <AiApproachesEditor items={approaches} />
        <AiRulesForm initial={rules} />
      </div>
    </>
  );
}
