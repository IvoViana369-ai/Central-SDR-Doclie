import 'server-only';
import { newId } from '@docline/db';
import { passwordProblems, passwordResetEmail, recordSignIn } from '@docline/core';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { getContainer } from './container';
import { requestMetaFrom } from './request-meta';

const SESSION_DAYS = 7;

function createAuth() {
  const { env, deps, logger } = getContainer();
  const secureCookies = env.APP_ENV === 'staging' || env.APP_ENV === 'production';

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
      ipAddress: { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'] },
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
      // Política de senha completa também na redefinição (o Better Auth só checa o tamanho).
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/reset-password') {
          const password = (ctx.body as { newPassword?: unknown } | undefined)?.newPassword;
          const problems = typeof password === 'string' ? passwordProblems(password) : [];
          if (problems.length > 0) throw new APIError('BAD_REQUEST', { message: problems[0] });
        }
      }),
      // Auditoria de login (sucesso e falha, com e-mail mascarado).
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email') return;
        const meta = requestMetaFrom(ctx.headers ?? new Headers());
        try {
          const newSession = ctx.context.newSession;
          if (newSession) {
            await recordSignIn(deps.db, meta, { success: true, userId: newSession.user.id });
          } else {
            const returned = ctx.context.returned;
            const reason =
              returned instanceof APIError
                ? String(returned.body?.code ?? returned.status)
                : 'UNKNOWN';
            const email = (ctx.body as { email?: unknown } | undefined)?.email;
            await recordSignIn(deps.db, meta, {
              success: false,
              email: typeof email === 'string' ? email : '',
              reason,
            });
          }
        } catch (error) {
          logger.error({ err: error }, 'Falha ao auditar login');
        }
      }),
    },

    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { __doclineAuth?: Auth };

export function getAuth(): Auth {
  globalForAuth.__doclineAuth ??= createAuth();
  return globalForAuth.__doclineAuth;
}
