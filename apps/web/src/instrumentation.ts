import type { Instrumentation } from 'next';

/**
 * Erros do servidor que escapam dos handlers da API (páginas, server actions)
 * vão para o Sentry, se `SENTRY_DSN` estiver configurado. Os da API v1 são
 * enviados pelo próprio `apiHandler`.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { getContainer } = await import('./server/container');
  const requestId = request.headers['x-request-id'];
  getContainer().errors.capture(error, {
    route: context.routePath,
    ...(typeof requestId === 'string' ? { requestId } : {}),
  });
};
