import type { RequestMeta } from '@docline/core';
import { randomUUID } from 'node:crypto';

/**
 * Metadados da requisição para auditoria. Na Render, o IP real do cliente é o
 * primeiro valor de X-Forwarded-For.
 */
export function requestMetaFrom(headers: Headers): RequestMeta {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return {
    requestId: headers.get('x-request-id') ?? randomUUID(),
    ip: forwarded || headers.get('x-real-ip') || undefined,
    userAgent: headers.get('user-agent')?.slice(0, 300) || undefined,
  };
}
