import type { IntegrationHealth } from '@docline/db';
import type { UseCaseContext } from '../../../shared/use-case';
import { notify } from '../../notifications';

/** Linha de `integration_connections` do Instagram (separada da do WhatsApp). */
export const instagramConnectionKey = (providerName: string) => `instagram:${providerName}`;

/** Situação da integração do Instagram; avisa os ADMINs quando ela piora. */
export async function markInstagramConnection(
  ctx: UseCaseContext,
  providerName: string,
  status: IntegrationHealth,
  error: string | null,
  config?: Record<string, unknown>,
) {
  const provider = instagramConnectionKey(providerName);
  const before = await ctx.tx.integrationConnection.findUnique({ where: { provider } });
  const data = {
    status,
    lastError: error,
    lastCheckAt: ctx.now,
    ...(config ? { config: JSON.parse(JSON.stringify(config)) } : {}),
  };
  await ctx.tx.integrationConnection.upsert({
    where: { provider },
    create: { provider, ...data },
    update: data,
  });
  const worse =
    (status === 'ERROR' || status === 'DEGRADED') &&
    before?.status !== status &&
    before?.status !== 'ERROR';
  if (!worse) return;
  const admins = await ctx.tx.user.findMany({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    select: { id: true },
  });
  for (const admin of admins) {
    await notify(ctx.tx, {
      userId: admin.id,
      type: 'instagram.integration',
      title: status === 'ERROR' ? 'Instagram pela API parou' : 'Instagram pela API com problema',
      body: error,
      link: '/configuracoes/instagram',
    });
  }
}
