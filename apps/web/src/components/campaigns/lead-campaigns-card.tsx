import { CAMPAIGN_LEAD_STATUS_LABELS } from '@docline/core/campaigns-domain';
import { Megaphone } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/utils';

export interface LeadCampaignView {
  campaign: { id: string; name: string; status: string };
  status: keyof typeof CAMPAIGN_LEAD_STATUS_LABELS;
  releasedAt: string | Date | null;
  approach: { id: string; name: string } | null;
  variantLabel: string | null;
}

/** Ficha do lead: de qual campanha ele veio e a abordagem sorteada (Fase 10). */
export function LeadCampaignsCard({
  items,
  canManage,
}: {
  items: LeadCampaignView[];
  /** Gestão: o nome leva à campanha. */
  canManage: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Megaphone className="size-4" aria-hidden /> Campanhas
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {items.map((item) => (
          <div key={item.campaign.id} className="space-y-0.5">
            <p className="font-medium">
              {canManage ? (
                <Link href={`/campanhas/${item.campaign.id}`} className="hover:underline">
                  {item.campaign.name}
                </Link>
              ) : (
                item.campaign.name
              )}
            </p>
            <p className="text-muted-foreground">
              {item.status === 'RELEASED' && item.releasedAt
                ? `Na fila desde ${formatDate(item.releasedAt)}`
                : CAMPAIGN_LEAD_STATUS_LABELS[item.status]}
            </p>
            {item.approach ? (
              <p>
                Abordagem sugerida: {item.approach.name}
                {item.variantLabel ? ` (variante ${item.variantLabel} do teste A/B)` : ''}
              </p>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
