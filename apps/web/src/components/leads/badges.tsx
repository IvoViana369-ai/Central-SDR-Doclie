import { CONTACT_STATUS_LABELS } from '@docline/core/compliance-domain';
import { LEAD_STATUS_LABELS } from '@docline/core/leads-domain';
import { AtSign, Globe, Mail, MessageCircle, Phone } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type ContactStatus = keyof typeof CONTACT_STATUS_LABELS;
type LeadStatus = keyof typeof LEAD_STATUS_LABELS;

const CONTACT_VARIANT: Record<ContactStatus, 'success' | 'warning' | 'destructive' | 'muted'> = {
  CONTACTABLE: 'success',
  RESTRICTED: 'warning',
  NO_LEGAL_BASIS: 'muted',
  OPTED_OUT: 'destructive',
  BLOCKED: 'destructive',
};

/** Selo da situação de contato (Lista Não Contatar, base legal, canais). */
export function ContactStatusBadge({ status }: { status: ContactStatus }) {
  const label = status === 'OPTED_OUT' ? 'Não contatar' : CONTACT_STATUS_LABELS[status];
  return <Badge variant={CONTACT_VARIANT[status]}>{label}</Badge>;
}

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  if (status === 'ACTIVE') return null;
  return <Badge variant="muted">{LEAD_STATUS_LABELS[status]}</Badge>;
}

const TAG_STYLES: Record<string, string> = {
  slate: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  red: 'bg-red-500/15 text-red-700 dark:text-red-300',
  orange: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  amber: 'bg-amber-500/20 text-amber-800 dark:text-amber-300',
  green: 'bg-green-500/15 text-green-700 dark:text-green-300',
  teal: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  blue: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  violet: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  pink: 'bg-pink-500/15 text-pink-700 dark:text-pink-300',
};

export function TagChip({
  tag,
  onRemove,
}: {
  tag: { name: string; color: string };
  onRemove?: () => void;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        TAG_STYLES[tag.color] ?? TAG_STYLES.slate,
      )}
    >
      {tag.name}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="-mr-1 rounded-full px-1 opacity-70 hover:opacity-100"
          aria-label={`Remover a tag ${tag.name}`}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

/** Canais disponíveis do lead (telefone, WhatsApp, e-mail, Instagram, site). */
export function ChannelIcons({
  lead,
}: {
  lead: {
    hasPhone: boolean;
    hasWhatsapp: boolean;
    hasEmail: boolean;
    hasInstagram: boolean;
    hasWebsite: boolean;
  };
}) {
  const items = [
    { on: lead.hasPhone, Icon: Phone, label: 'Telefone' },
    { on: lead.hasWhatsapp, Icon: MessageCircle, label: 'WhatsApp' },
    { on: lead.hasEmail, Icon: Mail, label: 'E-mail' },
    { on: lead.hasInstagram, Icon: AtSign, label: 'Instagram' },
    { on: lead.hasWebsite, Icon: Globe, label: 'Site' },
  ];
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      {items.map(({ on, Icon, label }) => (
        <Icon
          key={label}
          className={cn('size-3.5', on ? 'text-foreground' : 'opacity-25')}
          aria-label={`${label}: ${on ? 'sim' : 'não'}`}
          role="img"
        />
      ))}
    </span>
  );
}
