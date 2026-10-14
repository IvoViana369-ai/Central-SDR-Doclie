import { systemActor } from '../shared/actor';
import type { CoreDeps } from '../shared/use-case';
import {
  addNote,
  archiveLead,
  createLead,
  createTag,
  listTags,
  registerOptOut,
} from '../modules/leads';
import { FAKE_TAGS, generateFakeLeads } from './fake-leads';

const TAG_COLORS = ['violet', 'teal', 'red', 'amber'] as const;

export interface SeedDevResult {
  skipped: boolean;
  created: number;
  duplicates: number;
  optedOut: number;
  archived: number;
}

/**
 * Base de desenvolvimento com empresas fictícias (F2-13), cadastradas pelos
 * mesmos casos de uso da interface (normalização, auditoria, timeline e Lista
 * Não Contatar). Os leads ficam marcados com `is_test_data`. Se já existe base
 * fictícia, não faz nada (para recomeçar, recrie o banco de desenvolvimento).
 */
export async function seedDevLeads(
  deps: CoreDeps,
  options: { count: number; seed: number; onProgress?: (done: number) => void },
): Promise<SeedDevResult> {
  const result: SeedDevResult = {
    skipped: false,
    created: 0,
    duplicates: 0,
    optedOut: 0,
    archived: 0,
  };
  if ((await deps.db.lead.count({ where: { isTestData: true } })) > 0) {
    return { ...result, skipped: true };
  }
  const actor = systemActor('seed:dev');
  const [municipalities, sources, segments, sdrs] = await Promise.all([
    deps.db.municipality.findMany({
      select: { ibgeCode: true, uf: true, ddd: true, isCapital: true },
      orderBy: { ibgeCode: 'asc' },
    }),
    deps.db.leadSource.findMany({
      where: { active: true },
      select: { id: true, key: true, defaultLegalBasis: true },
      orderBy: { position: 'asc' },
    }),
    deps.db.segment.findMany({
      where: { active: true },
      select: { id: true },
      orderBy: { key: 'asc' },
    }),
    deps.db.user.findMany({
      where: { role: 'SDR', status: 'ACTIVE' },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const tags = new Map((await listTags(deps, actor, {})).map((t) => [t.name, t.id]));
  for (const [index, name] of FAKE_TAGS.entries()) {
    if (!tags.has(name)) {
      const tag = await createTag(deps, actor, { name, color: TAG_COLORS[index] });
      tags.set(name, tag.id);
    }
  }

  const plans = generateFakeLeads({
    count: options.count,
    seed: options.seed,
    now: deps.clock.now(),
    municipalities,
    sources,
    segmentIds: segments.map((s) => s.id),
  });

  let assigned = 0;
  for (const plan of plans) {
    const ownerId = plan.assign && sdrs.length > 0 ? sdrs[assigned++ % sdrs.length]!.id : null;
    const lead = await createLead(deps, actor, {
      ...plan.input,
      ownerId,
      tagIds: plan.tags.map((name) => tags.get(name)!),
    });
    await deps.db.lead.update({ where: { id: lead.id }, data: { isTestData: true } });
    result.created++;
    if (plan.duplicateKind) result.duplicates++;

    if (plan.note) await addNote(deps, actor, { leadId: lead.id, body: plan.note });
    if (plan.optOut === 'LEAD') {
      await registerOptOut(deps, actor, { leadId: lead.id, notes: 'Opt-out fictício (seed).' });
      result.optedOut++;
    } else if (plan.optOut === 'PHONE') {
      const phone = await deps.db.contactPoint.findFirst({
        where: { leadId: lead.id, type: 'PHONE' },
        select: { id: true },
      });
      if (phone) {
        await registerOptOut(deps, actor, {
          leadId: lead.id,
          contactPointId: phone.id,
          notes: 'Opt-out fictício (seed).',
        });
        result.optedOut++;
      }
    }
    if (plan.archive) {
      await archiveLead(deps, actor, { leadId: lead.id, reason: 'Arquivado no seed fictício.' });
      result.archived++;
    }
    options.onProgress?.(result.created);
  }
  return result;
}
