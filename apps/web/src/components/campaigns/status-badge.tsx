import { CAMPAIGN_STATUS_LABELS } from '@docline/core/campaigns-domain';
import { Badge } from '@/components/ui/badge';

type Status = keyof typeof CAMPAIGN_STATUS_LABELS;

const VARIANTS: Record<Status, 'default' | 'muted' | 'success' | 'warning' | 'destructive'> = {
  DRAFT: 'muted',
  BUILDING: 'warning',
  READY: 'default',
  ACTIVE: 'success',
  PAUSED: 'warning',
  COMPLETED: 'muted',
  ARCHIVED: 'muted',
};

export function CampaignStatusBadge({ status }: { status: Status }) {
  return <Badge variant={VARIANTS[status]}>{CAMPAIGN_STATUS_LABELS[status]}</Badge>;
}
