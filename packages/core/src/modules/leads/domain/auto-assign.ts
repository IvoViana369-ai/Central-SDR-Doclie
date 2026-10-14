import { z } from 'zod';

/**
 * Distribuição automática dos leads do pool (F11-05; docs/SDR-FLOW.md §10.2).
 * Desligada por padrão; quando ligada, a cada hora os leads sem responsável
 * vão para os SDRs disponíveis. Puro e determinístico: com as mesmas entradas,
 * a mesma distribuição.
 *
 * - **Território**: primeiro quem cobre a cidade do lead; depois quem cobre a
 *   UF inteira; sem ninguém (ou todos no limite), só vai para o rodízio geral
 *   se a opção estiver ligada.
 * - **Rodízio**: entre todos os disponíveis.
 * - **Disponibilidade**: fora quem não participa, está ausente ou chegou ao
 *   limite de leads ativos (o da pessoa ou o padrão).
 * - Entre os candidatos, vai para quem recebeu lead há mais tempo; empate:
 *   menos leads ativos, depois o id (estável).
 */

export const AUTO_ASSIGN_KEY = 'leads.auto_assign';

export const AUTO_ASSIGN_STRATEGIES = ['TERRITORY', 'ROUND_ROBIN'] as const;
export type AutoAssignStrategy = (typeof AUTO_ASSIGN_STRATEGIES)[number];

export const AUTO_ASSIGN_STRATEGY_LABELS: Record<AutoAssignStrategy, string> = {
  TERRITORY: 'Por território (cidade, depois UF)',
  ROUND_ROBIN: 'Rodízio entre todos os SDRs',
};

export const autoAssignSettingsSchema = z.object({
  enabled: z.boolean(),
  strategy: z.enum(AUTO_ASSIGN_STRATEGIES),
  /** Território: sem SDR que cubra o lead, ele entra no rodízio geral. */
  fallbackToAll: z.boolean(),
  /** Limite de leads ativos por SDR quando a pessoa não tem um próprio. */
  defaultCapacity: z.number().int().min(1).max(5000),
  /** Também o pool que já existia ao ligar (não só os leads novos). */
  includeExistingPool: z.boolean(),
  /** Quando foi ligada: "novos" são os criados a partir daqui. */
  enabledAt: z.string().datetime().nullable(),
});

export type AutoAssignSettings = z.infer<typeof autoAssignSettingsSchema>;

export const DEFAULT_AUTO_ASSIGN_SETTINGS: AutoAssignSettings = {
  enabled: false,
  strategy: 'TERRITORY',
  fallbackToAll: false,
  defaultCapacity: 300,
  includeExistingPool: false,
  enabledAt: null,
};

export function resolveAutoAssignSettings(stored: unknown): AutoAssignSettings {
  const record =
    typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? stored : {};
  const parsed = autoAssignSettingsSchema.safeParse({ ...DEFAULT_AUTO_ASSIGN_SETTINGS, ...record });
  return parsed.success ? parsed.data : DEFAULT_AUTO_ASSIGN_SETTINGS;
}

/** No máximo isto por execução; o resto fica para a próxima hora. */
export const AUTO_ASSIGN_BATCH = 500;

export interface AssignableSdr {
  userId: string;
  autoAssign: boolean;
  /** Último dia de ausência (AAAA-MM-DD), inclusive. */
  awayUntil: string | null;
  maxActiveLeads: number | null;
  activeLeads: number;
  lastAssignedAt: Date | null;
  territories: readonly { stateUf: string; municipalityCode: number | null }[];
}

export interface AssignableLead {
  leadId: string;
  stateUf: string | null;
  municipalityCode: number | null;
  /** Maior primeiro (score). */
  priority: number;
}

export type AutoAssignSkip = 'NO_SDR' | 'NO_TERRITORY' | 'NO_CAPACITY';

export const AUTO_ASSIGN_SKIP_LABELS: Record<AutoAssignSkip, string> = {
  NO_SDR: 'Nenhum SDR disponível',
  NO_TERRITORY: 'Nenhum SDR cobre a cidade ou a UF',
  NO_CAPACITY: 'SDRs do território no limite de leads ativos',
};

export interface AutoAssignPlan {
  assignments: { leadId: string; userId: string; strategy: AutoAssignStrategy }[];
  skipped: { leadId: string; reason: AutoAssignSkip }[];
}

/** Participa da distribuição e não está ausente hoje. */
export function isAvailable(
  sdr: Pick<AssignableSdr, 'autoAssign' | 'awayUntil'>,
  todayIso: string,
): boolean {
  return sdr.autoAssign && (sdr.awayUntil === null || sdr.awayUntil < todayIso);
}

export function capacityOf(sdr: Pick<AssignableSdr, 'maxActiveLeads'>, fallback: number): number {
  return sdr.maxActiveLeads ?? fallback;
}

export function planAutoAssign(
  leads: readonly AssignableLead[],
  sdrs: readonly AssignableSdr[],
  settings: Pick<AutoAssignSettings, 'strategy' | 'fallbackToAll' | 'defaultCapacity'>,
  todayIso: string,
): AutoAssignPlan {
  const plan: AutoAssignPlan = { assignments: [], skipped: [] };
  const available = sdrs.filter((s) => isAvailable(s, todayIso));
  const load = new Map(available.map((s) => [s.userId, s.activeLeads]));
  const last = new Map(
    available.map((s) => [s.userId, s.lastAssignedAt?.getTime() ?? Number.NEGATIVE_INFINITY]),
  );
  // Quem recebe agora passa a ser o "mais recente", depois de qualquer data real.
  let clock = Math.max(0, ...[...last.values()].filter(Number.isFinite));
  const hasRoom = (s: AssignableSdr) =>
    load.get(s.userId)! < capacityOf(s, settings.defaultCapacity);
  const pick = (candidates: readonly AssignableSdr[]) =>
    [...candidates].sort(
      (a, b) =>
        last.get(a.userId)! - last.get(b.userId)! ||
        load.get(a.userId)! - load.get(b.userId)! ||
        a.userId.localeCompare(b.userId),
    )[0];

  const ordered = [...leads].sort(
    (a, b) => b.priority - a.priority || a.leadId.localeCompare(b.leadId),
  );
  for (const lead of ordered) {
    let chosen: AssignableSdr | undefined;
    let strategy: AutoAssignStrategy = 'ROUND_ROBIN';
    let reason: AutoAssignSkip = available.length === 0 ? 'NO_SDR' : 'NO_CAPACITY';
    if (settings.strategy === 'TERRITORY') {
      const city =
        lead.municipalityCode === null
          ? []
          : available.filter((s) =>
              s.territories.some((t) => t.municipalityCode === lead.municipalityCode),
            );
      const state =
        lead.stateUf === null
          ? []
          : available.filter((s) =>
              s.territories.some((t) => t.municipalityCode === null && t.stateUf === lead.stateUf),
            );
      if (city.length + state.length === 0 && available.length > 0) reason = 'NO_TERRITORY';
      chosen = pick(city.filter(hasRoom)) ?? pick(state.filter(hasRoom));
      if (chosen) strategy = 'TERRITORY';
      else if (settings.fallbackToAll && available.length > 0) {
        chosen = pick(available.filter(hasRoom));
        reason = 'NO_CAPACITY';
      }
    } else {
      chosen = pick(available.filter(hasRoom));
    }
    if (!chosen) {
      plan.skipped.push({ leadId: lead.leadId, reason });
      continue;
    }
    plan.assignments.push({ leadId: lead.leadId, userId: chosen.userId, strategy });
    load.set(chosen.userId, load.get(chosen.userId)! + 1);
    clock += 1;
    last.set(chosen.userId, clock);
  }
  return plan;
}
