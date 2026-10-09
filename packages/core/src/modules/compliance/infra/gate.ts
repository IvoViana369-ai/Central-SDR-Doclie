import type { DbTransaction } from '@docline/db';
import { GATE_CHANNELS, type GateChannel, type GateInput } from '../domain/contactability';
import { loadLeadSuppressions } from './contact-state';

/** Monta a entrada do gate de contactabilidade a partir do banco. */
export async function loadGateInput(tx: DbTransaction, leadId: string): Promise<GateInput> {
  const lead = await tx.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: {
      id: true,
      status: true,
      cnpjHash: true,
      contactPoints: {
        where: { status: 'ACTIVE' },
        select: { id: true, type: true, valueHash: true, phoneKind: true, whatsappStatus: true },
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
    })),
  };
}
