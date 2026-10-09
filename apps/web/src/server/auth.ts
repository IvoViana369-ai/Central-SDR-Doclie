import 'server-only';
import { newId } from '@docline/db';
import {
  clearLoginThrottle,
  deviceIdFromToken,
  formatWait,
  issueDeviceToken,
  loginRetryAfter,
  passwordProblems,
  passwordResetEmail,
  recordLoginFailure,
  recordSignIn,
  recordTwoFactorEvent,
  type LoginAttempt,
} from '@docline/core';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { twoFactor } from 'better-auth/plugins';
import { getContainer } from './container';
import { ipAddressOptions, requestMetaFrom } from './request-meta';

const SESSION_DAYS = 7;
/** Cookie de dispositivo conhecido (limite de login por conta, docs/SECURITY.md §12). */
const DEVICE_COOKIE = 'docline.login_device';
const DEVICE_COOKIE_DAYS = 365;
/** Verificação do código no login (com o desafio aberto pela senha) ou na ativação. */
const TWO_FACTOR_VERIFY = new Set(['/two-factor/verify-totp', '/two-factor/verify-backup-code']);

function createAuth() {
  const { env, deps, logger } = getContainer();
  const secureCookies = env.APP_ENV === 'staging' || env.APP_ENV === 'production';
  // Mesma resolução de IP para o rate limit do Better Auth e para a auditoria.
  const ipOptions = ipAddressOptions(env.TRUSTED_PROXIES);
  const authSecret = env.BETTER_AUTH_SECRET;

  /** Tentativa de login (e-mail, IP e dispositivo conhecido) a partir do contexto do Better Auth. */
  function loginAttempt(ctx: {
    body?: unknown;
    headers?: Headers;
    getCookie: (key: string) => string | null;
  }): LoginAttempt | null {
    const email = (ctx.body as { email?: unknown } | undefined)?.email;
    if (typeof email !== 'string' || email.trim() === '') return null;
    return {
      email,
      ip: requestMetaFrom(ctx.headers ?? new Headers(), ipOptions).ip,
      deviceId: deviceIdFromToken(deps, authSecret, email, ctx.getCookie(DEVICE_COOKIE)),
    };
  }

  return betterAuth({
    appName: 'Docline SDR',
    baseURL: env.BETTER_AUTH_URL ?? env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    database: prismaAdapter(deps.db, { provider: 'postgresql' }),

    emailAndPassword: {
      enabled: true,
      // Sem cadastro público: usuários entram por convite (docs/SECURITY.md §3).
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 30 * 60,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, url }) {
        await deps.email.send(
          passwordResetEmail({ to: user.email, name: user.name, resetUrl: url }),
        );
      },
    },

    user: {
      additionalFields: {
        role: { type: 'string', input: false, required: false },
        status: { type: 'string', input: false, required: false },
      },
    },

    session: {
      expiresIn: SESSION_DAYS * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
    },

    rateLimit: {
      enabled: env.APP_ENV !== 'test',
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 15 * 60, max: 10 },
        '/request-password-reset': { window: 60 * 60, max: 5 },
        '/reset-password': { window: 15 * 60, max: 10 },
      },
    },

    advanced: {
      cookiePrefix: 'docline',
      useSecureCookies: secureCookies,
      database: { generateId: () => newId() },
      ipAddress: ipOptions,
    },

    databaseHooks: {
      session: {
        create: {
          // Só usuários ativos abrem sessão (convidados e desativados são barrados).
          async before(session) {
            const user = await deps.db.user.findUnique({
              where: { id: String(session.userId) },
              select: { status: true },
            });
            if (user?.status !== 'ACTIVE') {
              throw new APIError('FORBIDDEN', {
                message: 'Usuário sem acesso ativo. Fale com o administrador.',
              });
            }
          },
        },
      },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Limite por conta: quem errou demais espera antes de tentar de novo
        // (a senha nem é conferida). Tentativa barrada não soma no contador.
        if (ctx.path === '/sign-in/email') {
          const attempt = loginAttempt(ctx);
          if (!attempt) return;
          const wait = await loginRetryAfter(deps, attempt);
          if (wait > 0) {
            const meta = requestMetaFrom(ctx.headers ?? new Headers(), ipOptions);
            await recordSignIn(deps.db, meta, {
              success: false,
              email: attempt.email,
              reason: 'THROTTLED',
            }).catch((error: unknown) => logger.error({ err: error }, 'Falha ao auditar login'));
            throw new APIError('TOO_MANY_REQUESTS', {
              code: 'ACCOUNT_THROTTLED',
              message: `Muitas tentativas com senha errada. Tente de novo em ${formatWait(wait)}.`,
            });
          }
        }
        // Política de senha completa também na redefinição (o Better Auth só checa o tamanho).
        if (ctx.path === '/reset-password') {
          const password = (ctx.body as { newPassword?: unknown } | undefined)?.newPassword;
          const problems = typeof password === 'string' ? passwordProblems(password) : [];
          if (problems.length > 0) throw new APIError('BAD_REQUEST', { message: problems[0] });
        }
      }),
      // Auditoria de login (sucesso e falha, com e-mail mascarado) e da verificação em duas etapas.
      // Este hook roda antes dos hooks do plugin two-factor.
      after: createAuthMiddleware(async (ctx) => {
        const meta = requestMetaFrom(ctx.headers ?? new Headers(), ipOptions);
        const failed = ctx.context.returned instanceof APIError;
        const deviceCookie = ctx.getCookie(DEVICE_COOKIE);

        /** Login concluído: auditoria, contador zerado e navegador marcado como conhecido. */
        async function completeSignIn(user: { id: string; email: string }) {
          await recordSignIn(deps.db, meta, { success: true, userId: user.id });
          await clearLoginThrottle(deps, {
            email: user.email,
            ip: meta.ip,
            deviceId: deviceIdFromToken(deps, authSecret, user.email, deviceCookie),
          });
          ctx.setCookie(DEVICE_COOKIE, issueDeviceToken(deps, authSecret, user.email), {
            httpOnly: true,
            secure: secureCookies,
            sameSite: 'strict',
            path: '/api/auth',
            maxAge: DEVICE_COOKIE_DAYS * 24 * 60 * 60,
          });
        }

        function failureReason() {
          const returned = ctx.context.returned;
          return returned instanceof APIError
            ? String(returned.body?.code ?? returned.status)
            : 'UNKNOWN';
        }

        try {
          if (ctx.path === '/sign-in/email') {
            const newSession = ctx.context.newSession;
            const attempt = loginAttempt(ctx);
            if (!newSession) {
              if (attempt) await recordLoginFailure(deps, attempt, meta);
              await recordSignIn(deps.db, meta, {
                success: false,
                email: attempt?.email ?? '',
                reason: failureReason(),
              });
            } else if ((newSession.user as { twoFactorEnabled?: boolean }).twoFactorEnabled) {
              // Senha certa, mas o login só termina com o código do aplicativo.
              if (attempt) await clearLoginThrottle(deps, attempt);
              await recordTwoFactorEvent(deps.db, meta, {
                type: 'challenge',
                userId: newSession.user.id,
              });
            } else {
              await completeSignIn(newSession.user);
            }
            return;
          }

          if (TWO_FACTOR_VERIFY.has(ctx.path)) {
            const challenge = ctx.getCookie(ctx.context.createAuthCookie('two_factor').name);
            const newSession = ctx.context.newSession;
            if (challenge) {
              if (newSession) await completeSignIn(newSession.user);
              else {
                await recordSignIn(deps.db, meta, {
                  success: false,
                  email: '',
                  reason: `2FA_${failureReason()}`,
                });
              }
            } else if (newSession && !failed) {
              // Primeiro código válido depois de "ativar": a verificação passa a valer.
              await recordTwoFactorEvent(deps.db, meta, {
                type: 'enabled',
                userId: newSession.user.id,
              });
            }
            return;
          }

          const sessionUser = ctx.context.session?.user;
          if (!failed && sessionUser) {
            if (ctx.path === '/two-factor/disable') {
              await recordTwoFactorEvent(deps.db, meta, {
                type: 'disabled',
                userId: sessionUser.id,
              });
            } else if (ctx.path === '/two-factor/generate-backup-codes') {
              await recordTwoFactorEvent(deps.db, meta, {
                type: 'backup_codes_regenerated',
                userId: sessionUser.id,
              });
            }
          }
        } catch (error) {
          logger.error({ err: error }, 'Falha ao auditar autenticação');
        }
      }),
    },

    plugins: [
      // Verificação em duas etapas por aplicativo autenticador (TOTP), com códigos de
      // recuperação. Segredos cifrados com BETTER_AUTH_SECRET (docs/SECURITY.md §3).
      twoFactor({ issuer: 'Docline SDR' }),
      // Precisa ser o último plugin.
      nextCookies(),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { __doclineAuth?: Auth };

export function getAuth(): Auth {
  globalForAuth.__doclineAuth ??= createAuth();
  return globalForAuth.__doclineAuth;
}
