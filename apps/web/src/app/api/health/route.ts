import { WORKER_HEARTBEAT_KEY } from '@docline/core';
import { getContainer } from '@/server/container';

const NO_STORE = { 'cache-control': 'no-store' };

/** Saúde para o balanceador (Render). Sem autenticação e sem dados sensíveis. */
export async function GET() {
  try {
    const { deps } = getContainer();
    await deps.db.$queryRawUnsafe('SELECT 1');
    const heartbeat = await deps.db.appSetting.findUnique({ where: { key: WORKER_HEARTBEAT_KEY } });
    const at = (heartbeat?.value as { at?: string } | null)?.at;
    const ageSeconds = at ? Math.round((Date.now() - new Date(at).getTime()) / 1000) : null;
    const worker = ageSeconds === null ? 'unknown' : ageSeconds <= 180 ? 'ok' : 'stale';
    return Response.json(
      {
        status: worker === 'ok' ? 'ok' : 'degraded',
        database: 'ok',
        worker,
        workerHeartbeatAgeSeconds: ageSeconds,
      },
      { headers: NO_STORE },
    );
  } catch {
    return Response.json({ status: 'down', database: 'down' }, { status: 503, headers: NO_STORE });
  }
}
