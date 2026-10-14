import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { maskEmail } from '../../../shared/mask';
import { auditData, type CoreDeps, type RequestMeta } from '../../../shared/use-case';
import { LOGIN_THROTTLE, throttleDelaySeconds } from '../domain/login-throttle';
import { loginAlertEmail } from './emails';

type ThrottleDeps = Pick<CoreDeps, 'db' | 'identifiers' | 'email' | 'logger' | 'appUrl'>;

export interface LoginAttempt {
  email: string;
  ip: string | undefined;
  /** Dispositivo conhecido (cookie emitido em login anterior bem-sucedido desta conta). */
  deviceId?: string | null;
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const accountHash = (deps: Pick<CoreDeps, 'identifiers'>, email: string) =>
  deps.identifiers.hash('EMAIL', normalizeEmail(email));

/**
 * Contador da tentativa. Com dispositivo conhecido, o contador é só daquele
 * navegador: ninguém mais consegue atrasar o dono da conta, nem um colega
 * no mesmo escritório (mesmo IP público).
 */
function throttleKey(deps: Pick<CoreDeps, 'identifiers'>, attempt: LoginAttempt) {
  const account = accountHash(deps, attempt.email);
  return attempt.deviceId
    ? `device:${account}:${attempt.deviceId}`
    : `pair:${account}:${attempt.ip ?? 'unknown'}`;
}

// --- Dispositivo conhecido ---------------------------------------------------

const sign = (secret: string, account: string, deviceId: string) =>
  createHmac('sha256', secret).update(`device:${account}:${deviceId}`).digest('base64url');

/** Cookie de dispositivo conhecido para esta conta (emitido após login bem-sucedido). */
export function issueDeviceToken(
  deps: Pick<CoreDeps, 'identifiers'>,
  secret: string,
  email: string,
): string {
  const deviceId = randomBytes(16).toString('base64url');
  return `${deviceId}.${sign(secret, accountHash(deps, email), deviceId)}`;
}

/** Id do dispositivo, se o cookie é válido para esta conta; senão, nulo. */
export function deviceIdFromToken(
  deps: Pick<CoreDeps, 'identifiers'>,
  secret: string,
  email: string,
  token: string | null | undefined,
): string | null {
  const [deviceId, signature] = (token ?? '').split('.');
  if (!deviceId || !signature) return null;
  const expected = Buffer.from(sign(secret, accountHash(deps, email), deviceId));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received)
    ? deviceId
    : null;
}

// --- Limite ------------------------------------------------------------------

/** Antes de conferir a senha: segundos de espera exigidos (0 = pode tentar). */
export async function loginRetryAfter(
  deps: Pick<CoreDeps, 'db' | 'identifiers'>,
  attempt: LoginAttempt,
): Promise<number> {
  const rows = await deps.db.$queryRaw<{ seconds: number }[]>`
    SELECT ceil(extract(epoch FROM blocked_until - now()))::int AS seconds
    FROM login_throttles
    WHERE key = ${throttleKey(deps, attempt)} AND blocked_until > now()`;
  return rows[0]?.seconds ?? 0;
}

/**
 * Depois de uma falha: soma no contador da tentativa (com atraso progressivo)
 * e no da conta (todos os IPs e dispositivos). Ao passar de 20 falhas na
 * janela, audita e avisa os administradores por e-mail (uma vez por janela).
 * Usa a hora do banco do começo ao fim.
 */
export async function recordLoginFailure(
  deps: ThrottleDeps,
  attempt: LoginAttempt,
  meta: RequestMeta,
): Promise<void> {
  const account = accountHash(deps, attempt.email);
  const key = throttleKey(deps, attempt);
  const window = `${LOGIN_THROTTLE.windowMinutes} minutes`;

  const alert = await deps.db.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM login_throttles WHERE updated_at < now() - interval '1 day'`;
    const bump = async (k: string) => {
      const [row] = await tx.$queryRaw<{ failures: number; alerted_at: Date | null }[]>`
        INSERT INTO login_throttles (key, failures, window_started_at, updated_at)
        VALUES (${k}, 1, now(), now())
        ON CONFLICT (key) DO UPDATE SET
          failures = CASE WHEN login_throttles.window_started_at < now() - ${window}::interval
            THEN 1 ELSE login_throttles.failures + 1 END,
          alerted_at = CASE WHEN login_throttles.window_started_at < now() - ${window}::interval
            THEN NULL ELSE login_throttles.alerted_at END,
          window_started_at = CASE WHEN login_throttles.window_started_at < now() - ${window}::interval
            THEN now() ELSE login_throttles.window_started_at END,
          updated_at = now()
        RETURNING failures, alerted_at`;
      return row!;
    };

    const own = await bump(key);
    const delay = throttleDelaySeconds(own.failures);
    if (delay > 0) {
      await tx.$executeRaw`
        UPDATE login_throttles SET blocked_until = now() + ${delay} * interval '1 second'
        WHERE key = ${key}`;
    }

    const total = await bump(`account:${account}`);
    if (total.failures < LOGIN_THROTTLE.alertFailures || total.alerted_at) return null;
    await tx.$executeRaw`UPDATE login_throttles SET alerted_at = now() WHERE key = ${`account:${account}`}`;
    const [sources] = await tx.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM login_throttles
      WHERE (key LIKE ${`pair:${account}:%`} OR key LIKE ${`device:${account}:%`})
        AND window_started_at >= now() - ${window}::interval`;
    const user = await tx.user.findUnique({
      where: { email: normalizeEmail(attempt.email) },
      select: { id: true },
    });
    const masked = maskEmail(normalizeEmail(attempt.email));
    await tx.auditLog.create({
      data: auditData({ kind: 'anonymous' }, meta, {
        action: 'auth.login_alert',
        entityType: 'user',
        entityId: user?.id ?? null,
        metadata: { email: masked, failures: total.failures, sources: sources?.count ?? 0 },
      }),
    });
    return { masked, failures: total.failures, sources: sources?.count ?? 0 };
  });

  if (!alert) return;
  try {
    const admins = await deps.db.user.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: { email: true, name: true },
    });
    for (const admin of admins) {
      await deps.email.send(
        loginAlertEmail({
          to: admin.email,
          name: admin.name,
          maskedEmail: alert.masked,
          failures: alert.failures,
          sources: alert.sources,
          windowMinutes: LOGIN_THROTTLE.windowMinutes,
          auditUrl: `${deps.appUrl}/configuracoes/auditoria`,
        }),
      );
    }
  } catch (error) {
    deps.logger.error({ err: error }, 'Falha ao enviar o alerta de tentativas de login');
  }
}

/** Login bem-sucedido: zera o contador da tentativa (o da conta segue para o alerta). */
export async function clearLoginThrottle(
  deps: Pick<CoreDeps, 'db' | 'identifiers'>,
  attempt: LoginAttempt,
): Promise<void> {
  await deps.db.loginThrottle.deleteMany({ where: { key: throttleKey(deps, attempt) } });
}
