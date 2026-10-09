import { describe, expect, it } from 'vitest';
import { InstagramProviderError } from '../../../ports/instagram';
import { FakeInstagramProvider, fakeInstagramUserId } from '../infra/fake-provider';
import { describeInstagramError, isRetryableInstagramError } from './errors';
import {
  InstagramWebhookFormatError,
  instagramMessageBody,
  instagramWebhookContacts,
  parseInstagramWebhook,
} from './meta-webhook';
import { discoveryCutoffs, resolveInstagramSettings } from './settings';
import { messagingWindow, messagingWindowExpiry, privateReplyState } from './window';

const ACCOUNT = '17841400000000000';
const USER = '6543210987654321';

function messaging(items: unknown[]) {
  return { object: 'instagram', entry: [{ id: ACCOUNT, time: 1760356800000, messaging: items }] };
}

describe('leitura do webhook do Instagram', () => {
  it('mensagem recebida: texto, mídia sem texto, botão e eco da conta da Docline', () => {
    const events = parseInstagramWebhook(
      messaging([
        {
          sender: { id: USER },
          recipient: { id: ACCOUNT },
          timestamp: 1760356800000,
          message: { mid: 'mid-1', text: 'Tenho interesse (fictício)' },
        },
        {
          sender: { id: USER },
          recipient: { id: ACCOUNT },
          timestamp: 1760356801000,
          message: { mid: 'mid-2', attachments: [{ type: 'image', payload: { url: 'x' } }] },
        },
        {
          sender: { id: USER },
          recipient: { id: ACCOUNT },
          timestamp: 1760356802000,
          postback: { mid: 'mid-3', title: 'Quero conversar', payload: 'TALK' },
        },
        {
          sender: { id: ACCOUNT },
          recipient: { id: USER },
          timestamp: 1760356803000,
          message: { mid: 'mid-4', text: 'Oi! Aqui é da Docline.', is_echo: true },
        },
      ]),
    );
    expect(events).toEqual([
      {
        type: 'message',
        accountId: ACCOUNT,
        userId: USER,
        providerMessageId: 'mid-1',
        isEcho: false,
        timestamp: new Date(1760356800000),
        messageKind: 'text',
        text: 'Tenho interesse (fictício)',
      },
      expect.objectContaining({ providerMessageId: 'mid-2', messageKind: 'image', text: null }),
      expect.objectContaining({
        providerMessageId: 'mid-3',
        messageKind: 'postback',
        text: 'Quero conversar',
      }),
      // No eco, a outra pessoa é quem recebeu.
      expect.objectContaining({ providerMessageId: 'mid-4', isEcho: true, userId: USER }),
    ]);
  });

  it('"visto", mensagem de teste, apagada e fora do formato', () => {
    const events = parseInstagramWebhook(
      messaging([
        {
          sender: { id: USER },
          recipient: { id: ACCOUNT },
          timestamp: 1760356800000,
          read: { mid: 'mid-1' },
        },
        {
          sender: { id: ACCOUNT },
          recipient: { id: ACCOUNT },
          timestamp: 1760356800000,
          message: { mid: 'mid-5', text: 'teste', is_echo: true, is_self: true },
        },
        {
          sender: { id: USER },
          recipient: { id: ACCOUNT },
          timestamp: 1760356800000,
          message: { mid: 'mid-6', is_deleted: true },
        },
        { sender: { id: USER } },
      ]),
    );
    expect(events.map((e) => e.type)).toEqual(['seen', 'ignored', 'ignored', 'ignored']);
    expect(events[0]).toEqual({
      type: 'seen',
      userId: USER,
      providerMessageId: 'mid-1',
      timestamp: new Date(1760356800000),
    });
  });

  it('comentário com id ou comment_id; data do evento em segundos; outros campos ignorados', () => {
    const events = parseInstagramWebhook({
      object: 'instagram',
      entry: [
        {
          id: ACCOUNT,
          time: 1760356800,
          changes: [
            {
              field: 'comments',
              value: {
                from: { id: USER, username: 'Escritorio.Exemplo' },
                media: { id: 'media-1', media_product_type: 'FEED' },
                id: 'comment-1',
                text: 'Como funciona? (fictício)',
              },
            },
            {
              field: 'comments',
              value: {
                from: { id: USER, username: 'escritorio.exemplo' },
                media: { id: 'media-1' },
                comment_id: 'comment-2',
                parent_id: 'comment-1',
              },
            },
            { field: 'mentions', value: { media_id: 'x' } },
            { field: 'comments', value: { text: 'sem autor' } },
          ],
        },
      ],
    });
    expect(events[0]).toEqual({
      type: 'comment',
      accountId: ACCOUNT,
      commentId: 'comment-1',
      userId: USER,
      username: 'Escritorio.Exemplo',
      mediaId: 'media-1',
      mediaProductType: 'FEED',
      parentCommentId: null,
      text: 'Como funciona? (fictício)',
      timestamp: new Date(1760356800 * 1000),
    });
    expect(events[1]).toMatchObject({
      commentId: 'comment-2',
      parentCommentId: 'comment-1',
      text: null,
    });
    expect(events.slice(2).map((e) => e.type)).toEqual(['ignored', 'ignored']);
    expect(instagramWebhookContacts(events)).toEqual({
      userIds: [USER],
      usernames: ['escritorio.exemplo'],
    });
  });

  it('corpo que não é do Instagram é recusado', () => {
    expect(() => parseInstagramWebhook({ object: 'whatsapp_business_account', entry: [] })).toThrow(
      InstagramWebhookFormatError,
    );
    expect(() => parseInstagramWebhook('lixo')).toThrow(InstagramWebhookFormatError);
  });

  it('texto gravado para mídia sem legenda', () => {
    expect(instagramMessageBody('text', '  Olá  ')).toBe('Olá');
    expect(instagramMessageBody('audio', null)).toBe('[Áudio]');
    expect(instagramMessageBody('story_mention', '')).toBe('[Menção num story]');
    expect(instagramMessageBody('novo_tipo', null)).toBe('[Mensagem do tipo novo_tipo]');
  });
});

describe('prazos da API', () => {
  const now = new Date('2026-10-13T12:00:00Z');

  it('janela de 24 h desde a última mensagem da pessoa', () => {
    const expiry = messagingWindowExpiry(new Date('2026-10-12T13:00:00Z'));
    expect(expiry).toEqual(new Date('2026-10-13T13:00:00Z'));
    expect(messagingWindow(expiry, now)).toEqual({ open: true, expiresAt: expiry });
    expect(messagingWindow(new Date('2026-10-13T11:59:59Z'), now).open).toBe(false);
    expect(messagingWindow(null, now)).toEqual({ open: false, expiresAt: null });
  });

  it('resposta privada: uma por comentário, até 7 dias depois dele', () => {
    const recent = { commentedAt: new Date('2026-10-07T12:00:01Z'), privateReplyMessageId: null };
    const old = { commentedAt: new Date('2026-10-06T12:00:00Z'), privateReplyMessageId: null };
    expect(privateReplyState(recent, now)).toBe('available');
    expect(privateReplyState(old, now)).toBe('expired');
    expect(privateReplyState({ ...recent, privateReplyMessageId: 'msg' }, now)).toBe('sent');
  });
});

describe('erros e configuração', () => {
  it('código com subcódigo, só o código, nosso código e desconhecido', () => {
    expect(describeInstagramError('10/2018278').kind).toBe('WINDOW_CLOSED');
    expect(describeInstagramError('10').kind).toBe('AUTH');
    // Subcódigo desconhecido cai no código principal.
    expect(describeInstagramError('613/123').kind).toBe('RATE_LIMITED');
    expect(describeInstagramError('TIMEOUT').kind).toBe('UNKNOWN_OUTCOME');
    expect(describeInstagramError('99999').message).toContain('99999');
    expect(isRetryableInstagramError('613')).toBe(true);
    expect(isRetryableInstagramError('10/2018278')).toBe(false);
    expect(isRetryableInstagramError('TIMEOUT')).toBe(false);
  });

  it('configuração com padrões e datas de corte da consulta de perfis', () => {
    expect(resolveInstagramSettings(null)).toEqual({
      discoveryEnabled: true,
      discoveryPerHour: 50,
      refreshDays: 30,
      autoSuggestClassification: true,
    });
    expect(resolveInstagramSettings({ refreshDays: 7, discoveryPerHour: 10 })).toMatchObject({
      refreshDays: 7,
      discoveryPerHour: 10,
    });
    // Valor inválido não derruba: volta ao padrão.
    expect(resolveInstagramSettings({ discoveryPerHour: 5000 }).discoveryPerHour).toBe(50);
    const cutoffs = discoveryCutoffs(
      resolveInstagramSettings(null),
      new Date('2026-10-31T00:00:00Z'),
    );
    expect(cutoffs).toEqual({
      refreshBefore: new Date('2026-10-01T00:00:00Z'),
      errorRetryBefore: new Date('2026-10-30T00:00:00Z'),
    });
  });
});

describe('Instagram simulado', () => {
  const now = new Date('2026-10-13T12:00:00Z');

  it('perfil de quem escreveu pelo IGSID simulado ou pelo mapa dos testes', async () => {
    const fake = new FakeInstagramProvider(() => now);
    expect(await fake.getUserProfile(fakeInstagramUserId('Escritorio.X'))).toEqual({
      username: 'escritorio.x',
      name: null,
    });
    fake.profiles.set('outro', { username: 'outro.perfil', name: 'Outro' });
    expect(await fake.getUserProfile('outro')).toEqual({ username: 'outro.perfil', name: 'Outro' });
    expect(await fake.getUserProfile('desconhecido')).toBeNull();
  });

  it('Business Discovery determinístico e falhas marcadas no texto', async () => {
    const fake = new FakeInstagramProvider(() => now);
    expect(await fake.discover('perfil.naoexiste')).toEqual({ found: false });
    const inactive = await fake.discover('escritorio.inativo');
    expect(inactive).toMatchObject({ found: true });
    expect(inactive.found && inactive.lastPostAt).toEqual(new Date('2026-06-15T12:00:00Z'));
    expect(await fake.discover('escritorio.semposts')).toMatchObject({
      found: true,
      mediaCount: 0,
      lastPostAt: null,
    });
    const active = await fake.discover('escritorio.ativo');
    expect(active.found && active.lastPostAt!.getTime()).toBeGreaterThan(
      now.getTime() - 16 * 86_400_000,
    );
    await expect(fake.discover('perfil.limite')).rejects.toBeInstanceOf(InstagramProviderError);
    expect(fake.discovered).toHaveLength(5);

    await expect(
      fake.sendText({ recipientId: 'x', text: 'Oi [fake:janela-fechada]' }),
    ).rejects.toMatchObject({ details: { code: '10/2018278', outcome: 'NOT_SENT' } });
    await expect(
      fake.sendPrivateReply({ commentId: 'c', text: 'Oi [fake:incerto]' }),
    ).rejects.toMatchObject({ details: { outcome: 'UNKNOWN' } });
    const sent = await fake.sendText({ recipientId: 'x', text: 'Olá!' });
    expect(sent.providerMessageId).toMatch(/^mid\.fake-/);
    expect(fake.sent).toEqual([expect.objectContaining({ kind: 'text', to: 'x', text: 'Olá!' })]);
  });
});
