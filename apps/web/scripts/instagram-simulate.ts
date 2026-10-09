/**
 * Simulador de webhooks do Instagram (docs/INTEGRATIONS.md §7.2), para
 * demonstração e homologação com INSTAGRAM_PROVIDER=fake, sem conta da Meta.
 * Monta o corpo no formato da Meta, assina com META_APP_SECRET (como a Meta) e
 * envia para /api/webhooks/instagram do servidor em APP_URL.
 *
 *   pnpm instagram:simulate mensagem --de @escritorio.exemplo --texto "Tenho interesse"
 *   pnpm instagram:simulate comentario --de @escritorio.exemplo --texto "Que post bom!"
 *   pnpm instagram:simulate eco --de @escritorio.exemplo --texto "Respondido pelo app"
 *   pnpm instagram:simulate visto --de @escritorio.exemplo
 *
 * O IGSID simulado sai do @ (`fake-igsid-<@>`); o provedor simulado devolve o
 * mesmo @ no perfil. Só perfis e textos fictícios. Recusa rodar com
 * INSTAGRAM_PROVIDER=meta_graph.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { getServerEnv } from '@docline/config';
import { FakeInstagramProvider, fakeInstagramUserId, normalizeInstagram } from '@docline/core';
import { signMetaPayload } from '@docline/integrations';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    de: { type: 'string' },
    texto: { type: 'string' },
    publicacao: { type: 'string' },
  },
});

const env = getServerEnv();
if (env.INSTAGRAM_PROVIDER !== 'fake') {
  console.error('Use só com INSTAGRAM_PROVIDER=fake (nunca contra a conta real da Meta).');
  process.exit(1);
}
if (!env.META_APP_SECRET || !env.META_WEBHOOK_VERIFY_TOKEN) {
  console.error('Defina META_APP_SECRET e META_WEBHOOK_VERIFY_TOKEN (valores de teste) no .env.');
  process.exit(1);
}

const ACCOUNT = new FakeInstagramProvider().accountId;
const nowMs = Date.now();
const entry = (content: object) => ({
  object: 'instagram',
  entry: [{ id: ACCOUNT, time: Math.floor(nowMs / 1000), ...content }],
});

function handleOf(value: string | undefined) {
  const normalized = normalizeInstagram(value ?? '');
  if (!normalized.ok) throw new Error('Informe --de com o @ (ex.: @escritorio.exemplo).');
  return normalized.value.handle;
}

function payloadFor(command: string | undefined): object {
  const handle = handleOf(values.de);
  const igsid = fakeInstagramUserId(handle);
  const mid = `mid.simulado-${nowMs}`;
  switch (command) {
    case 'mensagem':
      if (!values.texto) throw new Error('Informe --texto.');
      return entry({
        messaging: [
          {
            sender: { id: igsid },
            recipient: { id: ACCOUNT },
            timestamp: nowMs,
            message: { mid, text: values.texto },
          },
        ],
      });
    case 'eco':
      if (!values.texto) throw new Error('Informe --texto.');
      return entry({
        messaging: [
          {
            sender: { id: ACCOUNT },
            recipient: { id: igsid },
            timestamp: nowMs,
            message: { mid, text: values.texto, is_echo: true },
          },
        ],
      });
    case 'visto':
      return entry({
        messaging: [
          {
            sender: { id: igsid },
            recipient: { id: ACCOUNT },
            timestamp: nowMs,
            read: { mid: 'simulado' },
          },
        ],
      });
    case 'comentario':
      if (!values.texto) throw new Error('Informe --texto.');
      return entry({
        changes: [
          {
            field: 'comments',
            value: {
              id: `comentario-simulado-${nowMs}`,
              text: values.texto,
              from: { id: igsid, username: handle },
              media: { id: values.publicacao ?? 'publicacao-simulada', media_product_type: 'FEED' },
            },
          },
        ],
      });
    default:
      throw new Error('Comandos: mensagem, comentario, eco, visto.');
  }
}

try {
  const body = JSON.stringify(payloadFor(positionals[0]));
  const response = await fetch(new URL('/api/webhooks/instagram', env.APP_URL), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': signMetaPayload(body, env.META_APP_SECRET),
    },
    body,
  });
  console.log(`Webhook enviado: HTTP ${response.status}`);
  if (!response.ok) process.exit(1);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
