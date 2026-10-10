/**
 * Distribuição dos leads aptos da campanha (F10-03) e sorteio das variantes
 * em teste (F10-05). Puro e determinístico: a mesma seleção sempre dá o mesmo
 * resultado.
 *
 * - Lead que já é de um SDR da campanha fica com ele.
 * - Lead sem responsável vai para o SDR com menos leads até ali (empate: a
 *   ordem da lista), em ordem de prioridade, para os melhores ficarem bem
 *   espalhados.
 * - Lead de outra pessoa não é tomado: a elegibilidade o marca como
 *   "responsável fora da campanha".
 */

export interface DistributableLead {
  leadId: string;
  ownerId: string | null;
  /** Maior primeiro (score na montagem). */
  priority: number;
}

export function planDistribution(
  leads: readonly DistributableLead[],
  sdrIds: readonly string[],
): Map<string, string> {
  const result = new Map<string, string>();
  if (sdrIds.length === 0) return result;
  const load = new Map(sdrIds.map((id) => [id, 0]));
  for (const lead of leads) {
    if (lead.ownerId && load.has(lead.ownerId)) {
      result.set(lead.leadId, lead.ownerId);
      load.set(lead.ownerId, load.get(lead.ownerId)! + 1);
    }
  }
  const pool = leads
    .filter((l) => !l.ownerId)
    .sort((a, b) => b.priority - a.priority || a.leadId.localeCompare(b.leadId));
  for (const lead of pool) {
    let chosen = sdrIds[0]!;
    for (const id of sdrIds) if (load.get(id)! < load.get(chosen)!) chosen = id;
    result.set(lead.leadId, chosen);
    load.set(chosen, load.get(chosen)! + 1);
  }
  return result;
}

export interface VariantRef {
  id: string;
  label: string;
}

/**
 * Variantes alternadas dentro da lista de cada SDR (em ordem de prioridade):
 * cada SDR trabalha todas as abordagens na mesma proporção, para a diferença
 * de resultado não ser a diferença entre SDRs. O ponto de partida gira de um
 * SDR para o outro, para o total também ficar equilibrado.
 */
export function assignVariants(
  leads: readonly { leadId: string; assignedTo: string; priority: number }[],
  variants: readonly VariantRef[],
): Map<string, string> {
  const result = new Map<string, string>();
  if (variants.length === 0) return result;
  const ordered = [...variants].sort((a, b) => a.label.localeCompare(b.label));
  const bySdr = new Map<string, { leadId: string; priority: number }[]>();
  for (const lead of leads) {
    const list = bySdr.get(lead.assignedTo) ?? [];
    list.push(lead);
    bySdr.set(lead.assignedTo, list);
  }
  let offset = 0;
  for (const sdr of [...bySdr.keys()].sort()) {
    const list = bySdr
      .get(sdr)!
      .sort((a, b) => b.priority - a.priority || a.leadId.localeCompare(b.leadId));
    list.forEach((lead, index) => {
      result.set(lead.leadId, ordered[(index + offset) % ordered.length]!.id);
    });
    offset += list.length;
  }
  return result;
}

/** Quantos leads ainda podem ser liberados hoje para o SDR. */
export function releaseQuota(dailyLimit: number, releasedToday: number): number {
  return Math.max(0, dailyLimit - releasedToday);
}
