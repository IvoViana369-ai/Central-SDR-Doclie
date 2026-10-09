import type { DbTransaction } from '@docline/db';
import type { Actor } from '../../../shared/actor';
import { DEFAULT_TIME_ZONE, localDayBounds } from '../../../shared/calendar';
import { loadContactRules, loadLeadCalendar } from '../../settings';
import { evaluateContactTiming, type ContactTimingResult } from '../domain/contact-timing';
import {
  GATE_CHANNELS,
  evaluateAllChannels,
  type ContactMode,
  type GateChannel,
  type GateInput,
  type GateResult,
} from '../domain/contactability';
import { loadLeadSuppressions } from './contact-state';

/** Monta a entrada do gate de contactabilidade a partir do banco. */
export async function loadGateInput(
  tx: DbTransaction,
  leadId: string,
  now: Date,
): Promise<GateInput> {
  const lead = await tx.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: {
      id: true,
      status: true,
      cnpjHash: true,
      contactPoints: {
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          type: true,
          valueHash: true,
          phoneKind: true,
          whatsappStatus: true,
          // Opt-in do WhatsApp do número e janela de atendimento aberta (Fase 7).
          // A conversa é do canal do contato: telefone no WhatsApp, @ no
          // Instagram (Fase 8, só responder a quem escreveu).
          permissions: {
            where: { channel: 'WHATSAPP', optInStatus: 'GRANTED' },
            select: { id: true },
          },
          conversations: {
            where: { serviceWindowExpiresAt: { gt: now } },
            select: { id: true },
          },
        },
      },
      permissions: {
        where: { personId: null, contactPointId: null },
        select: { channel: true, legalBasis: true, optInStatus: true },
      },
    },
  });
  const suppressions = await loadLeadSuppressions(tx, lead, lead.contactPoints);
  const general = lead.permissions.find((p) => p.channel === 'ALL');
  return {
    leadStatus: lead.status,
    legalBasis: general?.legalBasis ?? null,
    channelPermissions: lead.permissions.flatMap((p) =>
      (GATE_CHANNELS as readonly string[]).includes(p.channel)
        ? [
            {
              channel: p.channel as GateChannel,
              legalBasis: p.legalBasis,
              optInStatus: p.optInStatus,
            },
          ]
        : [],
    ),
    organizationSuppressions: suppressions.organization,
    contactPoints: lead.contactPoints.map((cp) => ({
      id: cp.id,
      type: cp.type,
      phoneKind: cp.phoneKind,
      whatsappStatus: cp.whatsappStatus,
      suppressions: suppressions.byContactPoint.get(cp.id) ?? [],
      whatsappOptIn: cp.permissions.length > 0,
      serviceWindowOpen: cp.conversations.length > 0,
    })),
  };
}

/** Mensagens que contam como contato feito (enviadas, entregues ou lidas). */
const SENT_STATUSES = ['SENT', 'DELIVERED', 'READ'] as const;

/** Limites que passam com o tempo para um contato deste ator com o lead, agora. */
export async function loadContactTiming(
  tx: DbTransaction,
  leadId: string,
  actor: Actor,
  now: Date,
): Promise<ContactTimingResult> {
  const [lead, rules] = await Promise.all([
    tx.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: {
        municipalityCode: true,
        stateUf: true,
        firstContactAt: true,
        lastContactAt: true,
        lastInboundAt: true,
      },
    }),
    loadContactRules(tx),
  ]);
  const calendar = await loadLeadCalendar(tx, lead, now, { rules });
  let firstContactsToday = 0;
  if (actor.kind === 'user' && lead.firstContactAt === null) {
    // "Por dia" no fuso do SDR.
    const user = await tx.user.findUnique({ where: { id: actor.id }, select: { timezone: true } });
    const day = localDayBounds(now, user?.timezone ?? DEFAULT_TIME_ZONE);
    firstContactsToday = await tx.message.count({
      where: {
        sentById: actor.id,
        isFirstContact: true,
        status: { in: [...SENT_STATUSES] },
        sentAt: { gte: day.start, lt: day.end },
      },
    });
  }
  return evaluateContactTiming({
    now,
    calendar,
    lastContactAt: lead.lastContactAt,
    lastInboundAt: lead.lastInboundAt,
    minHoursBetweenContacts: rules.minHoursBetweenContacts,
    firstContact: lead.firstContactAt === null,
    firstContactsToday,
    maxFirstContactsPerDay: rules.maxFirstContactsPerDay,
  });
}

/**
 * Gate completo por canal (docs/SDR-FLOW.md §9): bloqueios permanentes (Lista
 * Não Contatar, base legal, contato, situação do lead) e, quando nada disso
 * bloqueia, os limites de horário e frequência, com a hora de liberação.
 */
export async function evaluateLeadGate(
  tx: DbTransaction,
  leadId: string,
  options: { mode: ContactMode; actor: Actor; now: Date },
): Promise<{ channels: GateResult[]; timing: ContactTimingResult }> {
  const [input, timing] = await Promise.all([
    loadGateInput(tx, leadId, options.now),
    loadContactTiming(tx, leadId, options.actor, options.now),
  ]);
  const channels = evaluateAllChannels(input, options.mode).map((result) =>
    result.allowed && !timing.allowed
      ? {
          ...result,
          allowed: false,
          reasons: timing.reasons,
          usableContactPointIds: [],
          availableAt: timing.availableAt,
        }
      : { ...result, availableAt: null },
  );
  return { channels, timing };
}
