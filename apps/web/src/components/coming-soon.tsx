import { Clock } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { findNavItem } from '@/lib/navigation';

const PHASE_NAMES: Record<number, string> = {
  2: 'CRM de leads',
  3: 'Importação, normalização e deduplicação',
  4: 'Pipeline SDR',
  5: 'Fila e follow-ups',
  6: 'IA de prospecção',
  7: 'Integração WhatsApp',
  8: 'Instagram',
  9: 'Google / API de prospecção',
  10: 'Campanhas',
  11: 'Analytics',
  12: 'Integrações Docline',
};

/** Tela de módulo previsto no roadmap, ainda não disponível. */
export function ComingSoon({ href }: { href: string }) {
  const item = findNavItem(href);
  if (!item) return null;
  return (
    <>
      <PageHeader title={item.label} description={item.description} />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <Clock className="size-8 text-muted-foreground" aria-hidden />
          <Badge>
            Fase {item.phase} · {PHASE_NAMES[item.phase] ?? 'Em breve'}
          </Badge>
          <p className="max-w-md text-sm text-muted-foreground">
            Este módulo faz parte do plano do projeto e será liberado na Fase {item.phase}. A
            estrutura de dados e as permissões já estão preparadas.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
