'use client';

import { setNonce } from 'get-nonce';

let registered = false;

/**
 * Registra o nonce da CSP para bibliotecas que injetam <style> em tempo de
 * execução (ex.: trava de rolagem dos diálogos do Radix), sem liberar
 * 'unsafe-inline' na política de estilos.
 *
 * Usa o nonce do PRÓPRIO documento (lido de um <script> do Next), não o da
 * requisição atual: após router.refresh() o proxy gera um nonce novo que não
 * vale para a CSP já aplicada à página. Registra uma única vez.
 */
export function CspNonce({ nonce }: { nonce?: string }) {
  if (!registered && typeof document !== 'undefined') {
    const documentNonce =
      document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce || nonce;
    if (documentNonce) {
      setNonce(documentNonce);
      registered = true;
    }
  }
  return null;
}
