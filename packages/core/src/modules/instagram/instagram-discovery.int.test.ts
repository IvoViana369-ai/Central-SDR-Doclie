import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstagramProviderError } from '../../ports/instagram';
import type { Actor } from '../../shared/actor';
import { BusinessRuleError } from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import { createLead } from '../leads';
import {
  DEFAULT_INSTAGRAM_SETTINGS,
  getInstagramOverview,
  getLeadInstagram,
  refreshLeadInstagram,
  runInstagramDiscovery,
  updateInstagramSettings,
} from '.';

type UserActor = Extract<Actor, { kind: 'user' }>;

const { db, deps, instagram: fake, createActor } = createTestDeps();
let clockTime = new Date('2026-10-13T12:00:00Z');
deps.clock = { now: () => clockTime };
const at = (iso: string) => {
  clockTime = new Date(iso);
};
const DAY = 86_400_000;
const SOBRAL = 2312908;

describe('Instagram: consulta de perfis e "Instagram ativo" (F8-04)', () => {
  let admin: UserActor;
  let sdr: UserActor;
  let sourceId: string;

  async function leadWith(name: string, handle: string) {
    const { id } = await createLead(deps, sdr, {
      tradeName: name,
      municipalityCode: SOBRAL,
      origin: { sourceId, collectedAt: '2026-10-01' },
      legalBasis: 'LEGITIMATE_INTEREST',
      contactPoints: [{ type: 'INSTAGRAM', value: `@${handle}` }],
      acknowledgeDuplicates: true,
    });
    await db.lead.update({ where: { id }, data: { ownerId: sdr.id } });
    const point = await db.contactPoint.findFirstOrThrow({ where: { leadId: id } });
    return { leadId: id, contactPointId: point.id };
  }
  const scoreOf = async (leadId: string) =>
    (await db.lead.findUniqueOrThrow({ where: { id: leadId } })).score;
  const profileOf = (contactPointId: string) =>
    db.instagramProfile.findUnique({ where: { contactPointId } });

  beforeEach(async () => {
    at('2026-10-13T12:00:00Z');
    await resetTestData(db);
    fake.discovered.length = 0;
    deps.instagram = fake;
    vi.restoreAllMocks();
    sourceId = (await db.leadSource.findUniqueOrThrow({ where: { key: 'EVENT' } })).id;
    admin = (await createActor('ADMIN')).actor as UserActor;
    sdr = (await createActor('SDR')).actor as UserActor;
    // O ADMIN liga o critério depois de ligar a consulta (no seed ele vem inativo).
    await db.scoringRule.updateMany({
      where: { criterionKey: 'instagram_active' },
      data: { active: true },
    });
  });
  afterAll(() => closeTestDb());

  it('consulta cada @ uma vez, só de leads em contato, e o score passa a contar', async () => {
    const active = await leadWith('Escritório Ativo', 'escritorio.ativo');
    const inactive = await leadWith('Escritório Parado', 'escritorio.inativo');
    const missing = await leadWith('Escritório Sem Conta', 'conta.naoexiste');
    const shared = [
      await leadWith('Escritório Dupla', 'escritorio.dupla'),
      await leadWith('Escritório Dupla Filial', 'escritorio.dupla'),
    ];
    const optedOut = await leadWith('Escritório Fora', 'escritorio.fora');
    await db.lead.update({ where: { id: optedOut.leadId }, data: { contactStatus: 'OPTED_OUT' } });
    const before = await scoreOf(active.leadId);
    expect(before).toBe(await scoreOf(inactive.leadId));

    expect(await runInstagramDiscovery(deps)).toMatchObject({
      status: 'processed',
      checked: 4,
      found: 3,
      notFound: 1,
      errors: 0,
      stopped: null,
    });
    expect([...fake.discovered].sort()).toEqual([
      'conta.naoexiste',
      'escritorio.ativo',
      'escritorio.dupla',
      'escritorio.inativo',
    ]);
    expect(await profileOf(active.contactPointId)).toMatchObject({
      handle: 'escritorio.ativo',
      status: 'FOUND',
      checkedAt: clockTime,
    });
    expect((await profileOf(inactive.contactPointId))?.lastPostAt?.getTime()).toBe(
      clockTime.getTime() - 120 * DAY,
    );
    expect(await profileOf(missing.contactPointId)).toMatchObject({
      status: 'NOT_FOUND',
      followersCount: null,
      lastPostAt: null,
    });
    for (const s of shared) {
      expect((await profileOf(s.contactPointId))?.status).toBe('FOUND');
    }
    expect(await profileOf(optedOut.contactPointId)).toBeNull();

    // Publicou há poucos dias: pontua; há 120 dias, não.
    expect(await scoreOf(active.leadId)).toBeGreaterThan(before!);
    expect(await scoreOf(inactive.leadId)).toBe(before);
    expect(
      await db.leadScoreHistory.count({ where: { leadId: active.leadId, trigger: 'instagram' } }),
    ).toBe(1);

    // Ficha e visão do mês.
    expect(await getLeadInstagram(deps, sdr, { leadId: active.leadId })).toMatchObject({
      profiles: [{ handle: 'escritorio.ativo', metrics: { status: 'FOUND' } }],
    });
    expect((await getInstagramOverview(deps, admin, {})).discovery).toMatchObject({
      found: 4,
      notFound: 1,
      errors: 0,
    });

    // Nada vencido: a rodada seguinte não consulta ninguém.
    expect(await runInstagramDiscovery(deps)).toMatchObject({ checked: 0 });
    // Trocou o @: o dado antigo deixa de valer e o novo é consultado primeiro.
    await db.contactPoint.update({
      where: { id: active.contactPointId },
      data: { valueNormalized: 'escritorio.ativo.novo' },
    });
    expect(
      (await getLeadInstagram(deps, sdr, { leadId: active.leadId })).profiles[0]?.metrics,
    ).toBeNull();
    expect(await runInstagramDiscovery(deps)).toMatchObject({ checked: 1 });
    expect((await profileOf(active.contactPointId))?.handle).toBe('escritorio.ativo.novo');
    // Depois da validade (30 dias), todos de novo.
    at(new Date(clockTime.getTime() + 31 * DAY).toISOString());
    expect(await runInstagramDiscovery(deps)).toMatchObject({ checked: 4 });
  });

  it('teto por hora, limite e falhas da Meta, configuração e "Atualizar" pela ficha', async () => {
    await updateInstagramSettings(deps, admin, {
      ...DEFAULT_INSTAGRAM_SETTINGS,
      discoveryPerHour: 2,
    });
    const a = await leadWith('Escritório A', 'escritorio.a');
    const b = await leadWith('Escritório B', 'escritorio.b');
    const c = await leadWith('Escritório C', 'escritorio.c');
    expect(await runInstagramDiscovery(deps)).toMatchObject({ checked: 2 });
    expect(await runInstagramDiscovery(deps)).toMatchObject({ checked: 1 });

    // Limite da Meta: a rodada para sem gravar nada (a próxima continua).
    const limited = await leadWith('Escritório Limite', 'escritorio.limite');
    expect(await runInstagramDiscovery(deps)).toMatchObject({
      checked: 0,
      stopped: 'RATE_LIMITED',
    });
    expect(await profileOf(limited.contactPointId)).toBeNull();
    await db.contactPoint.update({
      where: { id: limited.contactPointId },
      data: { status: 'REMOVED' },
    });

    // Falha de um @: guarda o código e mantém o que se sabia; volta no dia seguinte.
    const known = await profileOf(a.contactPointId);
    at('2026-11-20T12:00:00Z');
    vi.spyOn(fake, 'discover').mockRejectedValueOnce(
      new InstagramProviderError('Erro', { outcome: 'NOT_SENT', retryable: false, code: '1' }),
    );
    expect(await runInstagramDiscovery(deps)).toMatchObject({ checked: 2, errors: 1 });
    expect(await profileOf(a.contactPointId)).toMatchObject({
      status: 'ERROR',
      errorCode: '1',
      lastPostAt: known!.lastPostAt,
      followersCount: known!.followersCount,
    });
    expect((await profileOf(b.contactPointId))?.status).toBe('FOUND');

    // Token recusado: a rodada para e a integração fica em erro, com aviso aos ADMINs.
    vi.spyOn(fake, 'discover').mockRejectedValueOnce(
      new InstagramProviderError('Token', { outcome: 'NOT_SENT', retryable: false, code: '190' }),
    );
    expect(await runInstagramDiscovery(deps)).toMatchObject({ stopped: 'AUTH' });
    expect(
      await db.integrationConnection.findUniqueOrThrow({ where: { provider: 'instagram:fake' } }),
    ).toMatchObject({ status: 'ERROR' });
    expect(
      await db.notification.count({ where: { type: 'instagram.integration', userId: admin.id } }),
    ).toBe(1);

    // "Atualizar" pela ficha: consulta na hora, mas não repete em menos de 1 hora.
    fake.discovered.length = 0;
    expect(await refreshLeadInstagram(deps, sdr, { leadId: c.leadId })).toMatchObject({
      checked: 1,
    });
    expect(await refreshLeadInstagram(deps, sdr, { leadId: c.leadId })).toMatchObject({
      checked: 0,
    });
    expect(fake.discovered).toEqual(['escritorio.c']);
    expect(await db.auditLog.count({ where: { action: 'instagram.discovery.refresh' } })).toBe(1);

    // Consulta desligada ou API desligada: nada é consultado.
    await updateInstagramSettings(deps, admin, {
      ...DEFAULT_INSTAGRAM_SETTINGS,
      discoveryEnabled: false,
    });
    expect(await runInstagramDiscovery(deps)).toEqual({ status: 'disabled' });
    await expect(refreshLeadInstagram(deps, sdr, { leadId: c.leadId })).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    deps.instagram = null;
    expect(await runInstagramDiscovery(deps)).toEqual({ status: 'disabled' });
  });
});
