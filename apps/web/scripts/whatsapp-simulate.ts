/**
 * Simulador de webhooks do WhatsApp (docs/INTEGRATIONS.md §6.2), para
 * demonstração e homologação com WHATSAPP_PROVIDER=fake, sem conta da Meta.
 * Monta o corpo no formato da Cloud API, assina com META_APP_SECRET (como a
 * Meta) e envia para /api/webhooks/whatsapp do servidor em APP_URL.
 *
 *   pnpm whatsapp:simulate resposta --de "(88) 99999-0000" --texto "Tenho interesse"
 *   pnpm whatsapp:simulate status --status delivered            # última mensagem enviada
 *   pnpm whatsapp:simulate status --mensagem wamid.x --status failed --codigo 131050
 *
 * Só números e textos fictícios. Recusa rodar com WHATSAPP_PROVIDER=meta_cloud.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { getServerEnv } from '@docline/config';
import { normalizePhone } from '@docline/core';
import { createDbClient } from '@docline/db';
import { signMetaPayload } from '@docline/integrations';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    de: { type: 'string' },
    texto: { type: 'string' },
    nome: { type: 'string' },
    mensagem: { type: 'string' },
    status: { type: 'string' },
    codigo: { type: 'string' },
  },
});

const env = getServerEnv();
if (env.WHATSAPP_PROVIDER !== 'fake') {
  console.error('Use só com WHATSAPP_PROVIDER=fake (nunca contra a conta real da Meta).');
  process.exit(1);
}
if (!env.META_APP_SECRET || !env.META_WEBHOOK_VERIFY_TOKEN) {
  console.error('Defina META_APP_SECRET e META_WEBHOOK_VERIFY_TOKEN (valores de teste) no .env.');
  process.exit(1);
}

const now = String(Math.floor(Date.now() / 1000));
const envelope = (value: object) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'simulado', changes: [{ field: 'messages', value }] }],
});

async function payloadFor(command: string | undefined): Promise<object> {
  if (command === 'resposta') {
    const phone = normalizePhone(values.de ?? '');
    if (!phone.ok || !values.texto) {
      throw new Error('Informe --de (telefone) e --texto.');
    }
    const waId = phone.value.e164.slice(1);
    return envelope({
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: 'simulado' },
      contacts: [{ wa_id: waId, profile: { name: values.nome ?? 'Contato simulado' } }],
      messages: [
        {
          from: waId,
          id: `wamid.simulado-${Date.now()}`,
          timestamp: now,
          type: 'text',
          text: { body: values.texto },
        },
      ],
    });
  }
  if (command === 'status') {
    const status = values.status ?? 'delivered';
    if (!['sent', 'delivered', 'read', 'failed'].includes(status)) {
      throw new Error('--status: sent, delivered, read ou failed.');
    }
    let id = values.mensagem;
    let recipient = 'simulado';
    if (!id) {
      const db = createDbClient(env.DATABASE_URL, { maxConnections: 1 });
      const last = await db.message.findFirst({
        where: {
          channel: 'WHATSAPP',
          mode: 'API',
          direction: 'OUTBOUND',
          providerMessageId: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        select: { providerMessageId: true, conversation: { select: { externalThreadId: true } } },
      });
      await db.$disconnect();
      if (!last?.providerMessageId) throw new Error('Nenhuma mensagem enviada pela API.');
      id = last.providerMessageId;
      recipient = last.conversation?.externalThreadId ?? recipient;
    }
    return envelope({
      messaging_product: 'whatsapp',
      statuses: [
        {
          id,
          status,
          timestamp: now,
          recipient_id: recipient,
          ...(status === 'failed'
            ? { errors: [{ code: Number(values.codigo ?? 131026), title: 'Simulado' }] }
            : {}),
          ...(status === 'delivered'
            ? {
                pricing: {
                  billable: true,
                  pricing_model: 'PMP',
                  type: 'regular',
                  category: 'marketing',
                },
              }
            : {}),
        },
      ],
    });
  }
  throw new Error('Comandos: resposta, status.');
}

try {
  const body = JSON.stringify(await payloadFor(positionals[0]));
  const response = await fetch(new URL('/api/webhooks/whatsapp', env.APP_URL), {
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
