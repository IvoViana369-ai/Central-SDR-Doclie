import 'server-only';
import {
  listApproaches,
  listCadences,
  listSavedViews,
  listUsers,
  type CoreDeps,
  type RequestMeta,
} from '@docline/core';
import type { CampaignFormOptions } from '@/components/campaigns/campaign-form';
import type { SessionUser } from './session';

/** Opções do formulário de campanha: gestores, SDRs, cadências, abordagens e visões salvas. */
export async function loadCampaignFormOptions(
  user: SessionUser,
  deps: CoreDeps,
  meta: RequestMeta,
): Promise<CampaignFormOptions> {
  const actor = user.actor;
  const [users, cadences, approaches, views] = await Promise.all([
    listUsers(deps, actor, { status: 'ACTIVE' }, meta),
    listCadences(deps, actor, {}, meta),
    listApproaches(deps, actor, {}, meta),
    listSavedViews(deps, actor, {}, meta),
  ]);
  return {
    owners: users
      .filter((u) => u.role === 'ADMIN' || u.role === 'MANAGER')
      .map((u) => ({ id: u.id, name: u.name })),
    // Quem prospecta: SDR, gestor e ADMIN (o Comercial recebe oportunidades).
    sdrs: users
      .filter((u) => u.role !== 'SALES')
      .sort((a, b) => Number(b.role === 'SDR') - Number(a.role === 'SDR'))
      .map((u) => ({ id: u.id, name: u.name, role: u.role })),
    cadences: cadences.map((c) => ({ id: c.id, name: c.name, isDefault: c.isDefault })),
    approaches: approaches.map((a) => ({ id: a.id, name: a.name, hypothesis: a.hypothesis })),
    views: views.map((v) => ({ id: v.id, name: v.name, filter: v.filter })),
  };
}
