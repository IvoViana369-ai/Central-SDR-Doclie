'use client';

import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient();

/** Traduz erros do Better Auth para mensagens em português. */
export function authErrorMessage(
  error: { code?: string; message?: string; status?: number } | null | undefined,
): string {
  if (!error) return 'Não foi possível concluir a operação.';
  switch (error.code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'E-mail ou senha incorretos.';
    case 'INVALID_TOKEN':
      return 'Link inválido ou expirado. Solicite uma nova redefinição.';
    case 'PASSWORD_TOO_SHORT':
      return 'A senha deve ter pelo menos 12 caracteres.';
    case 'PASSWORD_TOO_LONG':
      return 'A senha deve ter no máximo 128 caracteres.';
    case 'ACCOUNT_THROTTLED':
      return error.message ?? 'Muitas tentativas com senha errada. Aguarde e tente novamente.';
  }
  if (error.status === 429) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  if (error.status === 403 && error.message) return error.message;
  return error.message || 'Não foi possível concluir a operação.';
}
