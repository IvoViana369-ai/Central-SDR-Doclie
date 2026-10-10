'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { ApiError } from '@/lib/api-client';

export type Notice = { variant: 'success' | 'error' | 'info'; text: string } | null;

/**
 * Executa uma ação da API, mostra o resultado e recarrega os dados do servidor
 * (Server Components) para a tela refletir o estado novo.
 */
export function useAction() {
  const router = useRouter();
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async <T>(
      action: () => Promise<T>,
      success?: string | ((result: T) => string),
    ): Promise<T | null> => {
      setBusy(true);
      setNotice(null);
      try {
        const result = await action();
        if (success) {
          setNotice({
            variant: 'success',
            text: typeof success === 'function' ? success(result) : success,
          });
        }
        router.refresh();
        return result;
      } catch (err) {
        setNotice({
          variant: 'error',
          text: err instanceof ApiError ? err.message : 'Não foi possível concluir a operação.',
        });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  return { run, notice, setNotice, busy };
}
